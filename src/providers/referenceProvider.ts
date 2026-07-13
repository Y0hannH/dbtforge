import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { DbtMacroNode, DbtNode, DbtSourceNode } from '../index/manifestTypes';
import {
  findAllMacroCallLocations,
  findAllRefCallLocations,
  findAllSourceCallLocations,
  findCallAtPosition,
  findMacroCallAtPosition,
  findMacroDefinitionAtPosition,
} from '../sql/jinjaRefParser';

type ReferenceTarget =
  | { kind: 'model'; uniqueId: string; name: string; entity: DbtNode }
  | { kind: 'source'; uniqueId: string; sourceName: string; tableName: string; entity: DbtSourceNode }
  | { kind: 'macro'; uniqueId: string; name: string; entity: DbtMacroNode };

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
    context: vscode.ReferenceContext
  ): Promise<vscode.Location[] | undefined> {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const target = this.resolveTarget(index, document, position);
    if (!target) return undefined;

    const graph = index.getGraph();
    const callerIds =
      target.kind === 'macro' ? (graph?.getMacroCallers(target.uniqueId) ?? []) : (graph?.getChildren(target.uniqueId) ?? []);

    const locations: vscode.Location[] = [];
    for (const callerId of callerIds) {
      const entity = index.getAnyEntity(callerId);
      if (!entity) continue;

      const uri = index.getFileUri(entity);
      const doc = await vscode.workspace.openTextDocument(uri);
      for (let line = 0; line < doc.lineCount; line++) {
        const lineText = doc.lineAt(line).text;
        for (const span of this.findSpans(target, lineText)) {
          locations.push(new vscode.Location(uri, new vscode.Range(line, span.start, line, span.end)));
        }
      }
    }

    if (context.includeDeclaration) {
      locations.push(new vscode.Location(index.getFileUri(target.entity), new vscode.Position(0, 0)));
    }

    return locations;
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
      if (model) return { kind: 'model', uniqueId: model.uniqueId, name: model.name, entity: model.node };
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
      const macro = index.resolveMacro(macroDef.name);
      if (macro) return { kind: 'macro', uniqueId: macro.uniqueId, name: macro.name, entity: macro.node };
    }

    const macroCall = findMacroCallAtPosition(lineText, position.character);
    if (macroCall) {
      const macro = index.resolveMacro(macroCall.name);
      if (macro) return { kind: 'macro', uniqueId: macro.uniqueId, name: macro.name, entity: macro.node };
    }

    // Whole-file fallback: a model's .sql file is 1:1 with a manifest node, so invoking Find All
    // References anywhere in it (not on a call) means "who references this model". Not offered for
    // macro files since one file can define more than one macro.
    const node = index.getNodeByFileUri(document.uri);
    if (node?.resource_type === 'model') {
      return { kind: 'model', uniqueId: node.unique_id, name: node.name, entity: node };
    }

    return undefined;
  }

  private findSpans(target: ReferenceTarget, lineText: string): Array<{ start: number; end: number }> {
    switch (target.kind) {
      case 'model':
        return findAllRefCallLocations(lineText, target.name);
      case 'source':
        return findAllSourceCallLocations(lineText, target.sourceName, target.tableName);
      case 'macro':
        return findAllMacroCallLocations(lineText, target.name);
    }
  }
}
