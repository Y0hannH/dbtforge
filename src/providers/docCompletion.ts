import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { parseDocCompletionContext } from '../sql/jinjaRefParser';

/** How much of a block's markdown to preview in the completion popup. */
const PREVIEW_CHARS = 200;

/**
 * Suggests the `{% docs %}` blocks the project declares, inside `{{ doc('` — mostly in schema
 * .yml files, where doc() is actually used.
 *
 * The value here is the same one Go to Definition and the doc() diagnostic provide: the hard part
 * of doc blocks is not typing the tag, it is remembering what you already named things. The
 * preview text comes from the manifest, so a block's content is visible without opening its file.
 */
export class DocCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const lineTextBeforeCursor = document.lineAt(position.line).text.slice(0, position.character);
    if (!parseDocCompletionContext(lineTextBeforeCursor)) return undefined;

    return index.getAllDocs().map((block, rank) => {
      const item = new vscode.CompletionItem(block.name, vscode.CompletionItemKind.Text);
      item.detail = `doc block (${block.packageName})`;
      const preview = previewOf(block.node.block_contents);
      if (preview) item.documentation = new vscode.MarkdownString(preview);
      // getAllDocs() already puts the project's own blocks first; sortText preserves that against
      // VS Code's alphabetical default, which would otherwise mix package blocks back in.
      item.sortText = String(rank).padStart(5, '0');
      return item;
    });
  }
}

function previewOf(contents: string | undefined): string | undefined {
  const trimmed = contents?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > PREVIEW_CHARS ? `${trimmed.slice(0, PREVIEW_CHARS)}…` : trimmed;
}
