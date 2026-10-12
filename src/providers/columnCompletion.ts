import * as vscode from 'vscode';

import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import type { SourceRef } from '../sql/aliasParser';
import { parseAliases } from '../sql/aliasParser';
import type { CteColumn } from '../sql/cteColumns';
import { resolveCteColumns } from '../sql/cteColumns';
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
      return source ? toItems(this.catalogColumns(index, source)) : undefined;
    }

    const alias = prefixMatch[1];

    // A CTE that names no column and expands none is skipped rather than matched: the parser
    // reports every CTE (the preview rewrite needs them all), so matching one blindly would answer
    // "no columns" where the alias resolution below might still have found some.
    const cte = parseCtes(documentText).find(
      (c) => c.name === alias && (c.columns.length > 0 || c.expansion !== undefined),
    );
    if (cte) {
      // A CTE with a `*` is answered whole or not at all, never with the columns it names alone.
      return toItems(resolveCteColumns(cte, (source) => this.catalogColumns(index, source)));
    }

    const aliasSource = parseAliases(documentText).find((a) => a.alias === alias);
    if (!aliasSource) return undefined;

    return toItems(this.catalogColumns(index, aliasSource));
  }

  /** Columns of a model or source as catalog.json knows them, or nothing when it doesn't. */
  private catalogColumns(index: DbtProjectIndex, source: SourceRef): CteColumn[] | undefined {
    const uniqueId =
      source.kind === 'ref'
        ? index.resolveRef(source.modelName)?.uniqueId
        : index.resolveSource(source.sourceName, source.tableName)?.uniqueId;
    if (!uniqueId) return undefined;

    // Absent until the model has been built — nothing to suggest, not a guess.
    return index.getCatalogColumns(uniqueId)?.map((col) => ({ name: col.name, type: col.type }));
  }
}

function toItems(columns: CteColumn[] | undefined): vscode.CompletionItem[] | undefined {
  return columns?.map((column) => {
    const item = new vscode.CompletionItem(column.name, vscode.CompletionItemKind.Field);
    if (column.type) item.detail = column.type;
    return item;
  });
}
