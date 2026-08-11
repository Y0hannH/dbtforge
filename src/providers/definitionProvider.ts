import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { ManifestEntity } from '../index/entityPaths';
import { readFileLines } from '../index/textFiles';
import {
  findCallAtPosition,
  findMacroCallAtPosition,
  findMacroDefinitionLine,
} from '../sql/jinjaRefParser';

export class RefSourceDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location | undefined> {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const lineText = document.lineAt(position.line).text;
    const call = findCallAtPosition(lineText, position.character);
    if (call) {
      if (call.kind === 'ref') {
        const model = index.resolveRef(call.name);
        return model ? this.locateFile(index, model.node) : undefined;
      }

      const source = index.resolveSource(call.sourceName, call.tableName);
      return source ? this.locateFile(index, source.node) : undefined;
    }

    const macroCall = findMacroCallAtPosition(lineText, position.character);
    if (macroCall) {
      const macro = index.resolveMacro(macroCall.name, macroCall.packageName);
      if (macro) return this.locateMacro(index, macro.node, macro.name);
    }

    return undefined;
  }

  /**
   * A model/source definition is the top of its file. The file is checked first because an entity
   * can come from a package that isn't vendored in the project, and returning a Location for a
   * path that doesn't exist makes VS Code open a broken editor.
   */
  private async locateFile(
    index: DbtProjectIndex,
    node: ManifestEntity
  ): Promise<vscode.Location | undefined> {
    const uri = await index.getExistingFileUri(node);
    return uri ? new vscode.Location(uri, new vscode.Position(0, 0)) : undefined;
  }

  /** A macro definition is its `{% macro %}` line — one file can define several macros. */
  private async locateMacro(
    index: DbtProjectIndex,
    node: ManifestEntity,
    macroName: string
  ): Promise<vscode.Location | undefined> {
    const uri = index.getFileUri(node);
    // Missing file: a dbt-core built-in macro, which ships with the Python package rather than
    // living under the project. Nothing to navigate to.
    const lines = await readFileLines(uri);
    if (!lines) return undefined;
    return new vscode.Location(uri, new vscode.Position(findMacroDefinitionLine(lines, macroName) ?? 0, 0));
  }
}
