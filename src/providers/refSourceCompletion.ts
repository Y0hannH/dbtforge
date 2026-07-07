import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { parseCompletionContext } from '../sql/jinjaRefParser';

export class RefSourceCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const lineTextBeforeCursor = document.lineAt(position.line).text.slice(0, position.character);
    const context = parseCompletionContext(lineTextBeforeCursor);
    if (!context) return undefined;

    switch (context.kind) {
      case 'ref':
        return index.getAllModels().map((model) => {
          const item = new vscode.CompletionItem(model.name, vscode.CompletionItemKind.Class);
          item.detail = `model (${model.packageName})`;
          return item;
        });

      case 'source-name': {
        const sourceNames = new Set(index.getAllSources().map((s) => s.sourceName));
        return [...sourceNames].map(
          (name) => new vscode.CompletionItem(name, vscode.CompletionItemKind.Module)
        );
      }

      case 'source-table':
        return index
          .getAllSources()
          .filter((s) => s.sourceName === context.sourceName)
          .map((s) => {
            const item = new vscode.CompletionItem(s.tableName, vscode.CompletionItemKind.Class);
            item.detail = `source table (${context.sourceName})`;
            return item;
          });
    }
  }
}
