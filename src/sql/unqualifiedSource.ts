// Resolves the single table a model reads from, for column completion with nothing typed
// before the dot — the case a project whose style guide forbids redundant aliases lives in.
//
// The rule is deliberately all-or-nothing. Column completion elsewhere refuses to guess, and
// this path only exists because there is nothing to guess: one table reference in the whole
// file, no alias, no CTEs, so an unqualified column can only have come from one place. The
// moment a second table appears the model is ambiguous again and this returns nothing, which
// is the alias requirement doing its job rather than a gap.

import type { SourceRef } from './aliasParser';
import { parseTableReferences } from './aliasParser';
import { parseCtes } from './cteParser';
import { findAllRefCalls, findAllSourceCalls, isInsideJinjaExpression } from './jinjaRefParser';

/**
 * The model or source an unqualified column at `offset` can be resolved against, or undefined
 * when the file is anything less than unambiguous.
 */
export function resolveUnqualifiedSource(
  documentText: string,
  offset: number,
): SourceRef | undefined {
  // Cheapest checks first: this runs on every keystroke that opens the suggest widget, and the
  // cursor guards reject the common cases (mid-tag, mid-string) without scanning the document.
  if (!isColumnPosition(documentText, offset)) return undefined;

  // A CTE puts a second candidate in scope — the final SELECT may read from the CTE rather than
  // from the table it wraps. But inside the CTE's own body, that CTE is the only statement the
  // cursor is in: what the final SELECT does with it is irrelevant to what an unqualified column
  // there resolves against. So the search is narrowed to that body rather than given up on —
  // outside of any CTE (the final SELECT itself), a CTE is still a second candidate and this
  // still refuses to guess.
  const ctes = parseCtes(documentText);
  const enclosingCte = ctes.find((cte) => offset >= cte.bodyStart && offset <= cte.bodyEnd);
  if (!enclosingCte && ctes.length > 0) return undefined;

  const scope = enclosingCte
    ? documentText.slice(enclosingCte.bodyStart, enclosingCte.bodyEnd)
    : documentText;

  // Every ref()/source() in scope, not just the ones the FROM-clause regex understands: a
  // second call anywhere — a comma join, a subquery, a shape this parser doesn't model — means
  // the scope has more than one candidate, whether or not it can be read.
  if (findAllRefCalls(scope).length + findAllSourceCalls(scope).length !== 1) {
    return undefined;
  }

  const references = parseTableReferences(scope);
  if (references.length !== 1) return undefined;

  const [reference] = references;
  if (reference.alias) return undefined; // aliased: the `alias.` path already covers it

  // A CTE nested inside this body puts a second candidate in scope, same as at the top level.
  if (parseCtes(scope).length > 0) return undefined;

  return reference.kind === 'ref'
    ? { kind: 'ref', modelName: reference.modelName }
    : { kind: 'source', sourceName: reference.sourceName, tableName: reference.tableName };
}

/** Rejects the places on a line where a bare column name is not what the user is typing. */
function isColumnPosition(documentText: string, offset: number): boolean {
  const textBefore = documentText.slice(0, offset);
  const lineBefore = textBefore.slice(textBefore.lastIndexOf('\n') + 1);

  if (isInsideJinjaExpression(lineBefore)) return false;
  if (lineBefore.includes('--')) return false;
  if (textBefore.lastIndexOf('/*') > textBefore.lastIndexOf('*/')) return false;

  // An odd number of quotes puts the cursor inside a string literal.
  if ((lineBefore.match(/'/g)?.length ?? 0) % 2 === 1) return false;

  // Directly after FROM/JOIN a table name is being typed, not a column.
  return !/\b(?:from|join)\s+[A-Za-z0-9_]*$/i.test(lineBefore);
}
