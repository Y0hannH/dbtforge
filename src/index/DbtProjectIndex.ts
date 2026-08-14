import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { DbtForgeConfig } from '../config';
import { DbtCatalog, DbtCatalogColumn } from './catalogTypes';
import { isOneNodePerFilePath, ManifestEntity, resolveEntityPath } from './entityPaths';
import { watchFile } from './fileWatcher';
import { buildDependencyGraph, DependencyGraph } from './graph';
import { buildMacroIndex, MacroIndex, MacroRef } from './macroIndex';
import { DbtManifest, DbtMacroNode, DbtNode, DbtSourceNode } from './manifestTypes';
import { buildRefIndex, ModelRef } from './refIndex';
import { collectTags, TagRef } from './tags';

export interface SourceRef {
  uniqueId: string;
  sourceName: string; // first arg to source()
  tableName: string; // second arg to source()
  node: DbtSourceNode;
}

export type { MacroRef, ModelRef };


/**
 * Central, per-workspace-folder index over manifest.json / catalog.json.
 * Loads once, then reloads on file change. Every feature provider reads from this
 * instance instead of parsing the JSON itself.
 */
export class DbtProjectIndex implements vscode.Disposable {
  private manifest: DbtManifest | undefined;
  private catalog: DbtCatalog | undefined;
  private graph: DependencyGraph | undefined;

  // name -> node, for ref() resolution — models, seeds and snapshots alike. See refIndex.
  private refsByName = new Map<string, ModelRef>();
  // "source_name.table_name" -> node, for source() resolution.
  private sourcesByKey = new Map<string, SourceRef>();
  // Macro names collide across packages, so this one needs real resolution rules — see macroIndex.
  private macros: MacroIndex | undefined;
  // normalized absolute file path -> unique_id, to map the active editor to a manifest node.
  private uniqueIdByFilePath = new Map<string, string>();
  // Every tag declared in the project, for the Tags view and `--select tag:x` shortcuts.
  private tags: TagRef[] = [];

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
      this.refsByName.clear();
      this.sourcesByKey.clear();
      this.macros = undefined;
      this.tags = [];
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
    this.sourcesByKey.clear();
    this.refsByName = buildRefIndex(manifest);
    this.macros = buildMacroIndex(manifest);
    this.uniqueIdByFilePath.clear();
    this.tags = collectTags(manifest);

    for (const node of Object.values(manifest.nodes)) {
      // Only nodes that own their file get a path entry — a seed's .csv does, a schema test
      // sharing a schema.yml doesn't, and mapping that .yml back would hand getNodeByFileUri()
      // an arbitrary one of the tests declared in it.
      if (isOneNodePerFilePath(node.original_file_path)) {
        this.uniqueIdByFilePath.set(
          this.normalizeFilePath(resolveEntityPath(this.config.projectDir, manifest.metadata.project_name, node)),
          node.unique_id
        );
      }
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

  /** Everything `ref()` can point at: models, seeds and snapshots. */
  getAllRefTargets(): ModelRef[] {
    return [...this.refsByName.values()];
  }

  getAllSources(): SourceRef[] {
    return [...this.sourcesByKey.values()];
  }

  /** Every tag declared anywhere in the project, alphabetically. */
  getAllTags(): TagRef[] {
    return this.tags;
  }

  /** Resolves the argument of a `ref()` — a model, seed or snapshot name. */
  resolveRef(name: string): ModelRef | undefined {
    return this.refsByName.get(name);
  }

  resolveSource(sourceName: string, tableName: string): SourceRef | undefined {
    return this.sourcesByKey.get(sourceKey(sourceName, tableName));
  }

  /** `packageName` is the namespace of a `dbt_utils.star(...)`-style call, when there is one. */
  resolveMacro(name: string, packageName?: string): MacroRef | undefined {
    return this.macros?.resolve(name, packageName);
  }

  /**
   * The macro named `name` defined in `uri`, if any. Used when the starting point is a macro's own
   * `{% macro %}` line: the file identifies the package exactly, where a by-name lookup could
   * resolve to a same-named macro from a different package.
   */
  resolveMacroInFile(uri: vscode.Uri, name: string): MacroRef | undefined {
    const target = this.normalizeFilePath(uri.fsPath);
    return this.macros
      ?.findAllByName(name)
      .find((macro) => this.normalizeFilePath(this.getFileUri(macro.node).fsPath) === target);
  }

  getNode(uniqueId: string): DbtNode | undefined {
    return this.manifest?.nodes[uniqueId];
  }

  getMacroNode(uniqueId: string): DbtMacroNode | undefined {
    return this.manifest?.macros?.[uniqueId];
  }

  getSourceNode(uniqueId: string): DbtSourceNode | undefined {
    return this.manifest?.sources[uniqueId];
  }

  /** Resolves a caller unique_id from getChildren()/getMacroCallers() to its node or macro. */
  getAnyEntity(uniqueId: string): DbtNode | DbtMacroNode | undefined {
    return this.manifest?.nodes[uniqueId] ?? this.manifest?.macros?.[uniqueId];
  }

  getCatalogColumns(uniqueId: string): DbtCatalogColumn[] | undefined {
    const entry = this.catalog?.nodes[uniqueId] ?? this.catalog?.sources[uniqueId];
    if (!entry) return undefined;
    return Object.values(entry.columns).sort((a, b) => a.index - b.index);
  }

  getGraph(): DependencyGraph | undefined {
    return this.graph;
  }

  /**
   * Absolute file URI for a model/source/macro node. Package-aware: an entity from an installed
   * package resolves under dbt_packages/, since its original_file_path is relative to the package
   * root. The file is not guaranteed to exist (dbt-core's built-in macros ship with the Python
   * package) — use getExistingFileUri() before navigating to it.
   */
  getFileUri(node: ManifestEntity): vscode.Uri {
    return vscode.Uri.file(
      resolveEntityPath(this.config.projectDir, this.manifest?.metadata.project_name ?? '', node)
    );
  }

  /**
   * getFileUri(), but undefined when the file isn't on disk — the case for dbt-core's built-in
   * macros (installed with the Python package, not vendored under dbt_packages/). Navigation
   * features use this so they degrade to "no result" instead of opening a nonexistent file.
   */
  async getExistingFileUri(node: ManifestEntity): Promise<vscode.Uri | undefined> {
    const uri = this.getFileUri(node);
    try {
      await fs.access(uri.fsPath);
      return uri;
    } catch {
      return undefined;
    }
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
