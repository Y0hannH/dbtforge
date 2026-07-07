import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { DbtForgeConfig } from '../config';
import { DbtCatalog, DbtCatalogColumn } from './catalogTypes';
import { watchFile } from './fileWatcher';
import { buildDependencyGraph, DependencyGraph } from './graph';
import { DbtManifest, DbtNode, DbtSourceNode } from './manifestTypes';

export interface ModelRef {
  uniqueId: string;
  name: string;
  packageName: string;
  node: DbtNode;
}

export interface SourceRef {
  uniqueId: string;
  sourceName: string; // first arg to source()
  tableName: string; // second arg to source()
  node: DbtSourceNode;
}

/**
 * Central, per-workspace-folder index over manifest.json / catalog.json.
 * Loads once, then reloads on file change. Every feature provider reads from this
 * instance instead of parsing the JSON itself.
 */
export class DbtProjectIndex implements vscode.Disposable {
  private manifest: DbtManifest | undefined;
  private catalog: DbtCatalog | undefined;
  private graph: DependencyGraph | undefined;

  // name -> node, for ref() resolution. dbt itself requires unique model names across
  // packages by default, so a flat map keyed by name is sufficient for v1.
  private modelsByName = new Map<string, ModelRef>();
  // "source_name.table_name" -> node, for source() resolution.
  private sourcesByKey = new Map<string, SourceRef>();
  // normalized absolute file path -> unique_id, to map the active editor to a manifest node.
  private uniqueIdByFilePath = new Map<string, string>();

  private readonly disposables: vscode.Disposable[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private manifestMissingWarned = false;
  private catalogMissingWarned = false;

  constructor(private readonly config: DbtForgeConfig) {
    this.disposables.push(
      watchFile(this.config.manifestPath, () => this.reloadManifest()),
      watchFile(this.config.catalogPath, () => this.reloadCatalog())
    );
  }

  async initialize(): Promise<void> {
    await Promise.all([this.reloadManifest(), this.reloadCatalog()]);
  }

  private async reloadManifest(): Promise<void> {
    let parsed: DbtManifest | undefined;
    try {
      parsed = await readJsonIfExists<DbtManifest>(this.config.manifestPath);
    } catch {
      // Most likely a partial read while `dbt` is mid-write (manifest.json is rewritten in
      // full, non-atomically). Keep the last good manifest and let the next debounced
      // file-change event retry, rather than blowing away a working index over a race.
      return;
    }
    if (!parsed) {
      if (!this.manifestMissingWarned) {
        this.manifestMissingWarned = true;
        vscode.window.showWarningMessage(
          `dbt Forge: no manifest.json found at ${this.config.manifestPath}. Run "dbt compile" or "dbt build" to generate it.`
        );
      }
      this.manifest = undefined;
      this.graph = undefined;
      this.modelsByName.clear();
      this.sourcesByKey.clear();
      this._onDidChange.fire();
      return;
    }

    this.manifestMissingWarned = false;
    this.manifest = parsed;
    this.graph = buildDependencyGraph(parsed);
    this.indexModelsAndSources(parsed);
    this._onDidChange.fire();
  }

  private async reloadCatalog(): Promise<void> {
    let parsed: DbtCatalog | undefined;
    try {
      parsed = await readJsonIfExists<DbtCatalog>(this.config.catalogPath);
    } catch {
      // Same partial-write race as reloadManifest(): keep the last good catalog and retry
      // on the next file-change event.
      return;
    }
    if (!parsed && !this.catalogMissingWarned) {
      this.catalogMissingWarned = true;
      // Not an error: catalog.json only exists after `dbt docs generate`, and column
      // completion degrading gracefully without it is expected behavior, not a bug.
      vscode.window.showInformationMessage(
        `dbt Forge: no catalog.json found at ${this.config.catalogPath}. Column autocomplete will be limited until "dbt docs generate" is run.`
      );
    } else if (parsed) {
      this.catalogMissingWarned = false;
    }
    this.catalog = parsed ?? undefined;
    this._onDidChange.fire();
  }

  private indexModelsAndSources(manifest: DbtManifest): void {
    this.modelsByName.clear();
    this.sourcesByKey.clear();
    this.uniqueIdByFilePath.clear();

    for (const node of Object.values(manifest.nodes)) {
      // Only .sql-backed nodes have a 1:1 file->node relationship. Schema tests defined in a
      // shared schema.yml would otherwise collide on that same path (last one wins), giving
      // getNodeByFileUri() an arbitrary wrong node when that .yml is the active editor.
      if (node.original_file_path.toLowerCase().endsWith('.sql')) {
        this.uniqueIdByFilePath.set(this.normalizeFilePath(node.original_file_path), node.unique_id);
      }
      if (node.resource_type !== 'model') continue;
      this.modelsByName.set(node.name, {
        uniqueId: node.unique_id,
        name: node.name,
        packageName: node.package_name,
        node,
      });
    }

    for (const node of Object.values(manifest.sources)) {
      const key = sourceKey(node.source_name, node.name);
      this.sourcesByKey.set(key, {
        uniqueId: node.unique_id,
        sourceName: node.source_name,
        tableName: node.name,
        node,
      });
    }
  }

  private normalizeFilePath(relativeOrAbsolute: string): string {
    const abs = path.isAbsolute(relativeOrAbsolute)
      ? relativeOrAbsolute
      : path.join(this.config.projectDir, relativeOrAbsolute);
    // Windows paths are case-insensitive; normalize so lookups from vscode.Uri (which
    // preserves the on-disk casing of the opened file) still match the manifest's casing.
    return path.normalize(abs).toLowerCase();
  }

  /** Resolves the manifest node (model/test/seed/...) backing an open file, if any. */
  getNodeByFileUri(uri: vscode.Uri): DbtNode | undefined {
    const uniqueId = this.uniqueIdByFilePath.get(this.normalizeFilePath(uri.fsPath));
    return uniqueId ? this.manifest?.nodes[uniqueId] : undefined;
  }

  getConfig(): DbtForgeConfig {
    return this.config;
  }

  isManifestLoaded(): boolean {
    return this.manifest !== undefined;
  }

  isCatalogLoaded(): boolean {
    return this.catalog !== undefined;
  }

  getAllModels(): ModelRef[] {
    return [...this.modelsByName.values()];
  }

  getAllSources(): SourceRef[] {
    return [...this.sourcesByKey.values()];
  }

  resolveRef(modelName: string): ModelRef | undefined {
    return this.modelsByName.get(modelName);
  }

  resolveSource(sourceName: string, tableName: string): SourceRef | undefined {
    return this.sourcesByKey.get(sourceKey(sourceName, tableName));
  }

  getNode(uniqueId: string): DbtNode | undefined {
    return this.manifest?.nodes[uniqueId];
  }

  getCatalogColumns(uniqueId: string): DbtCatalogColumn[] | undefined {
    const entry = this.catalog?.nodes[uniqueId] ?? this.catalog?.sources[uniqueId];
    if (!entry) return undefined;
    return Object.values(entry.columns).sort((a, b) => a.index - b.index);
  }

  getGraph(): DependencyGraph | undefined {
    return this.graph;
  }

  /** Absolute file URI for a model/source node, resolved from its manifest-relative path. */
  getFileUri(node: DbtNode | DbtSourceNode): vscode.Uri {
    return vscode.Uri.file(path.join(this.config.projectDir, node.original_file_path));
  }

  dispose(): void {
    this._onDidChange.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function sourceKey(sourceName: string, tableName: string): string {
  return `${sourceName}.${tableName}`;
}

async function readJsonIfExists<T>(absolutePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(absolutePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return undefined;
    throw err;
  }
}
