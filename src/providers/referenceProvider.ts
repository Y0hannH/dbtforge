import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { ManifestEntity } from '../index/entityPaths';
import { DbtMacroNode, DbtNode, DbtSourceNode } from '../index/manifestTypes';
import { isReferenceable } from '../index/refIndex';
import { readFileLines } from '../index/textFiles';
import {
  CallLocation,
  findAllMacroCallLocations,
  findAllRefCallLocations,
  findAllSourceCallLocations,
  findCallAtPosition,
  findMacroCallAtPosition,
  findMacroDefinitionAtPosition,
  findMacroDefinitionLine,
} from '../sql/jinjaRefParser';

type ReferenceTarget =
  | { kind: 'model'; uniqueId: string; name: string; packageName: string; entity: DbtNode }
  | { kind: 'source'; uniqueId: string; sourceName: string; tableName: string; entity: DbtSourceNode }
  | { kind: 'macro'; uniqueId: string; name: string; packageName: string; entity: DbtMacroNode };

// Caller files are read concurrently, but in batches: a widely-used source can have hundreds of
// children, and firing every read at once buys nothing over a bounded window.
const READ_BATCH_SIZE = 20;

/**
 * Find All References (Shift+F12 / right-click) for models, sources, and macros. Scoped to direct
 * callers only (one hop), same semantics as the Parents/Children relatives tree — every call site,
 * not the whole downstream lineage.
 */
export class DbtReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken
  ): Promise<vscode.Location[] | undefined> {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const target = this.resolveTarget(index, document, position);
    if (!target) return undefined;

    const graph = index.getGraph();
    const callerIds =
      target.kind === 'macro'
        ? (graph?.getMacroCallers(target.uniqueId) ?? [])
        : (graph?.getChildren(target.uniqueId) ?? []);

    const callers = callerIds
      .map((id) => index.getAnyEntity(id))
      .filter((entity): entity is DbtNode | DbtMacroNode => isScannable(entity));

    const locations: vscode.Location[] = [];
    for (let i = 0; i < callers.length; i += READ_BATCH_SIZE) {
      if (token.isCancellationRequested) return locations;
      const batch = await Promise.all(
        callers.slice(i, i + READ_BATCH_SIZE).map((entity) => this.findCallSites(index, target, entity))
      );
      for (const found of batch) locations.push(...found);
    }

    if (context.includeDeclaration) {
      const declaration = await this.findDeclaration(index, target);
      if (declaration) locations.push(declaration);
    }

    return locations;
  }

  private async findCallSites(
    index: DbtProjectIndex,
    target: ReferenceTarget,
    caller: ManifestEntity
  ): Promise<vscode.Location[]> {
    const uri = index.getFileUri(caller);
    const lines = await readFileLines(uri);
    if (!lines) return [];

    const locations: vscode.Location[] = [];
    for (let line = 0; line < lines.length; line++) {
      for (const span of this.findSpans(target, lines[line])) {
        locations.push(new vscode.Location(uri, new vscode.Range(line, span.start, line, span.end)));
      }
    }

    // The manifest says this file depends on the target, so a call site exists even when the
    // line-based scan can't pin it down — a multi-line ref(), or a call built by Jinja. Pointing
    // at the file beats dropping it from the results silently.
    //
    // Not done for macros: dbt records macros pulled in indirectly (adapter dispatch, generic
    // tests, materializations) in depends_on.macros, so a caller with no visible call site is
    // normal there and the fallback would be noise rather than a near miss.
    if (locations.length === 0 && target.kind !== 'macro') {
      return [new vscode.Location(uri, new vscode.Position(0, 0))];
    }
    return locations;
  }

  private async findDeclaration(
    index: DbtProjectIndex,
    target: ReferenceTarget
  ): Promise<vscode.Location | undefined> {
    const uri = await index.getExistingFileUri(target.entity);
    if (!uri) return undefined;
    if (target.kind !== 'macro') return new vscode.Location(uri, new vscode.Position(0, 0));

    // A macro file can define several macros, so the declaration is a line, not the file top.
    const lines = await readFileLines(uri);
    const line = lines ? (findMacroDefinitionLine(lines, target.name) ?? 0) : 0;
    return new vscode.Location(uri, new vscode.Position(line, 0));
  }

  private resolveTarget(
    index: DbtProjectIndex,
    document: vscode.TextDocument,
    position: vscode.Position
  ): ReferenceTarget | undefined {
    const lineText = document.lineAt(position.line).text;

    const call = findCallAtPosition(lineText, position.character);
    if (call?.kind === 'ref') {
      const model = index.resolveRef(call.name);
      if (model) {
        return {
          kind: 'model',
          uniqueId: model.uniqueId,
          name: model.name,
          packageName: model.packageName,
          entity: model.node,
        };
      }
    }
    if (call?.kind === 'source') {
      const source = index.resolveSource(call.sourceName, call.tableName);
      if (source) {
        return {
          kind: 'source',
          uniqueId: source.uniqueId,
          sourceName: source.sourceName,
          tableName: source.tableName,
          entity: source.node,
        };
      }
    }

    const macroDef = findMacroDefinitionAtPosition(lineText, position.character);
    if (macroDef) {
      // A macro's own definition line names no package, so resolve it against the file being
      // edited rather than through the by-name index, which could point at another package.
      const macro = index.resolveMacroInFile(document.uri, macroDef.name);
      if (macro) return macroTarget(macro);
    }

    const macroCall = findMacroCallAtPosition(lineText, position.character);
    if (macroCall) {
      const macro = index.resolveMacro(macroCall.name, macroCall.packageName);
      if (macro) return macroTarget(macro);
    }

    // Whole-file fallback: a model's or snapshot's .sql file is 1:1 with a manifest node, so
    // invoking Find All References anywhere in it (not on a call) means "who references this".
    // Not offered for macro files since one file can define more than one macro.
    const node = index.getNodeByFileUri(document.uri);
    if (node && isReferenceable(node)) {
      return {
        kind: 'model',
        uniqueId: node.unique_id,
        name: node.name,
        packageName: node.package_name,
        entity: node,
      };
    }

    return undefined;
  }

  private findSpans(target: ReferenceTarget, lineText: string): CallLocation[] {
    switch (target.kind) {
      case 'model':
        return findAllRefCallLocations(lineText, target.name, target.packageName);
      case 'source':
        return findAllSourceCallLocations(lineText, target.sourceName, target.tableName);
      case 'macro':
        return findAllMacroCallLocations(lineText, target.name, target.packageName);
    }
  }
}

function macroTarget(macro: {
  uniqueId: string;
  name: string;
  packageName: string;
  node: DbtMacroNode;
}): ReferenceTarget {
  return {
    kind: 'macro',
    uniqueId: macro.uniqueId,
    name: macro.name,
    packageName: macro.packageName,
    entity: macro.node,
  };
}

/**
 * Only .sql callers are worth opening. A generic test's manifest entry points at the schema.yml
 * that declares it, which contains no ref()/source()/macro call to find — scanning it is pure
 * cost, and it would trip the "no span found" file-level fallback.
 */
function isScannable(entity: ManifestEntity | undefined): boolean {
  return entity !== undefined && entity.original_file_path.toLowerCase().endsWith('.sql');
}
