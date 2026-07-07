import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { findCallAtPosition } from '../sql/jinjaRefParser';

export class RefSourceDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Definition | undefined {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const lineText = document.lineAt(position.line).text;
    const call = findCallAtPosition(lineText, position.character);
    if (!call) return undefined;

    if (call.kind === 'ref') {
      const model = index.resolveRef(call.name);
      if (!model) return undefined;
      return new vscode.Location(index.getFileUri(model.node), new vscode.Position(0, 0));
    }

    const source = index.resolveSource(call.sourceName, call.tableName);
    if (!source) return undefined;
    return new vscode.Location(index.getFileUri(source.node), new vscode.Position(0, 0));
  }
}
