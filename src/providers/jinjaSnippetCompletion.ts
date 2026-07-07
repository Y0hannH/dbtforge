import * as vscode from 'vscode';
import { isInsideJinjaTag } from '../sql/jinjaRefParser';

const SNIPPETS: Array<{ label: string; detail: string; snippet: string }> = [
  { label: 'ref', detail: '{{ ref("") }}', snippet: '{{ ref("$1") }}$0' },
  { label: 'source', detail: '{{ source("", "") }}', snippet: '{{ source("$1", "$2") }}$0' },
];

/**
 * Expands a bare `ref`/`source` word typed in plain SQL into the full `{{ ref("") }}` /
 * `{{ source("", "") }}` tag, with the cursor left inside the first quoted argument.
 * Only offered outside an existing {{ ... }} tag — inside one, RefSourceCompletionProvider
 * already owns suggesting model/source names.
 */
export class JinjaSnippetCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const lineTextBeforeCursor = document.lineAt(position.line).text.slice(0, position.character);
    if (isInsideJinjaTag(lineTextBeforeCursor)) return undefined;

    return SNIPPETS.map(({ label, detail, snippet }) => {
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
      item.insertText = new vscode.SnippetString(snippet);
      item.detail = detail;
      item.filterText = label;
      // Snippet insertion doesn't "type" the quote character the cursor lands next to, so the
      // ref()/source() name completion's trigger character never fires on its own — chain an
      // explicit re-trigger so the model/source list pops up immediately without Ctrl+Space.
      item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' };
      return item;
    });
  }
}
