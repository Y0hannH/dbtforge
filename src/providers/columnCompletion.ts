import * as vscode from 'vscode';

import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import type { SourceRef } from '../sql/aliasParser';
import { parseAliases } from '../sql/aliasParser';
import { parseCtes } from '../sql/cteParser';
import { resolveUnqualifiedSource } from '../sql/unqualifiedSource';

const ALIAS_PREFIX_RE = /([A-Za-z_][A-Za-z0-9_]*)\.$/;

/**
 * Suggests column names after `alias.`, where `alias` is either:
 *  - a `FROM/JOIN {{ ref()/source() }} alias` in the current file, resolved against
 *    catalog.json (only covers models that have been built at least once), or
 *  - a same-file CTE name, resolved from its own top-level SELECT column list.
 *
 * With nothing before the cursor, the same columns are suggested unqualified — but only when
 * the statement the cursor is in leaves them no other origin: a single table reference,
 * unaliased (see resolveUnqualifiedSource, which scopes this to the enclosing CTE's own body
 * when the cursor is inside one). Anywhere else, no suggestions are offered — this provider
 * never guesses.
 */
export class ColumnCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const documentText = document.getText();
    const lineTextBeforeCursor = document.lineAt(position.line).text.slice(0, position.character);
    const prefixMatch = ALIAS_PREFIX_RE.exec(lineTextBeforeCursor);

    if (!prefixMatch) {
      const source = resolveUnqualifiedSource(documentText, document.offsetAt(position));
      return source ? this.catalogColumns(index, source) : undefined;
    }

    const alias = prefixMatch[1];

    // A CTE whose columns couldn't be resolved is skipped rather than matched: the parser now
    // reports every CTE (the preview rewrite needs them all), so matching one blindly would answer
    // "no columns" where the alias resolution below might still have found some.
    const cte = parseCtes(documentText).find((c) => c.name === alias && c.columns.length > 0);
    if (cte) {
      return cte.columns.map(
        (name) => new vscode.CompletionItem(name, vscode.CompletionItemKind.Field),
      );
    }

    const aliasSource = parseAliases(documentText).find((a) => a.alias === alias);
    if (!aliasSource) return undefined;

    return this.catalogColumns(index, aliasSource);
  }

  /** Columns of a model or source as catalog.json knows them, or nothing when it doesn't. */
  private catalogColumns(
    index: DbtProjectIndex,
    source: SourceRef,
  ): vscode.CompletionItem[] | undefined {
    const uniqueId =
      source.kind === 'ref'
        ? index.resolveRef(source.modelName)?.uniqueId
        : index.resolveSource(source.sourceName, source.tableName)?.uniqueId;
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
