import * as vscode from 'vscode';

/**
 * Expands a bare `docs` typed in a markdown file into a full `{% docs %} … {% enddocs %}` block.
 *
 * On its own this is static text, which is somebody else's snippet extension — it earns its place
 * here only as the other half of the doc() features: the block this writes is what the doc()
 * completion will then suggest, what Go to Definition lands on, and what the doc() diagnostic
 * stops warning about. Offered in .md because that is the only file type dbt reads doc blocks from.
 */
export class DocBlockSnippetProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const lineTextBeforeCursor = document.lineAt(position.line).text.slice(0, position.character);
    // Inside an already-open tag the user is past the point this helps.
    if (lineTextBeforeCursor.includes('{%')) return undefined;

    const item = new vscode.CompletionItem('docs', vscode.CompletionItemKind.Snippet);
    item.insertText = new vscode.SnippetString('{% docs ${1:block_name} %}\n$0\n{% enddocs %}');
    item.detail = '{% docs %} … {% enddocs %}';
    item.documentation = new vscode.MarkdownString(
      'A dbt doc block. Reference it from a schema .yml with `{{ doc("block_name") }}`.'
    );
    item.filterText = 'docs';
    return [item];
  }
}
