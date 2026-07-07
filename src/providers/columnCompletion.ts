import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { parseAliases } from '../sql/aliasParser';
import { parseCtes } from '../sql/cteParser';

const ALIAS_PREFIX_RE = /([A-Za-z_][A-Za-z0-9_]*)\.$/;

/**
 * Suggests column names after `alias.`, where `alias` is either:
 *  - a `FROM/JOIN {{ ref()/source() }} alias` in the current file, resolved against
 *    catalog.json (only covers models that have been built at least once), or
 *  - a same-file CTE name, resolved from its own top-level SELECT column list.
 * If the alias can't be resolved through either path, no suggestions are offered —
 * this provider never guesses.
 */
export class ColumnCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const lineTextBeforeCursor = document.lineAt(position.line).text.slice(0, position.character);
    const prefixMatch = ALIAS_PREFIX_RE.exec(lineTextBeforeCursor);
    if (!prefixMatch) return undefined;
    const alias = prefixMatch[1];

    const documentText = document.getText();

    const cte = parseCtes(documentText).find((c) => c.name === alias);
    if (cte) {
      return cte.columns.map(
        (name) => new vscode.CompletionItem(name, vscode.CompletionItemKind.Field)
      );
    }

    const aliasSource = parseAliases(documentText).find((a) => a.alias === alias);
    if (!aliasSource) return undefined;

    const uniqueId =
      aliasSource.kind === 'ref'
        ? index.resolveRef(aliasSource.modelName)?.uniqueId
        : index.resolveSource(aliasSource.sourceName, aliasSource.tableName)?.uniqueId;
    if (!uniqueId) return undefined;

    const columns = index.getCatalogColumns(uniqueId);
    if (!columns) return undefined; // not built yet — nothing to suggest, not a guess

    return columns.map((col) => {
      const item = new vscode.CompletionItem(col.name, vscode.CompletionItemKind.Field);
      item.detail = col.type;
      return item;
    });
  }
}
