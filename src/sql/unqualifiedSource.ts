// Resolves the single table a statement reads from, for column completion with nothing typed
// before the dot — the case a project whose style guide forbids redundant aliases lives in.
//
// The rule is deliberately all-or-nothing. Column completion elsewhere refuses to guess, and
// this path only exists because there is nothing to guess: one table in the statement the cursor
// is in, no alias, no join, so an unqualified column can only have come from one place. The
// moment a second table appears the statement is ambiguous again and this returns nothing, which
// is the alias requirement doing its job rather than a gap.
//
// "The statement the cursor is in" is a CTE's own body, or the final SELECT. A CTE elsewhere in
// the file is not a candidate for either: what a CTE reads is irrelevant to the statement that
// merely sits next to it.

import type { SourceRef } from './aliasParser';
import { parseTableReferences } from './aliasParser';
import type { CteDefinition } from './cteParser';
import { parseCtes, parseModelSql, stripDelimiters } from './cteParser';
import { findAllRefCalls, findAllSourceCalls, isInsideJinjaExpression } from './jinjaRefParser';
import { findTopLevelKeyword, matchesWordAt, skipIgnorable, skipNonCode } from './scanner';

/**
 * Where an unqualified column resolves against: a model or source (columns from catalog.json), or a
 * CTE of the same file (columns from its own SELECT list).
 */
export type UnqualifiedOrigin = SourceRef | { kind: 'cte'; cte: CteDefinition };

// What may follow the one table of a FROM clause without changing which columns the statement
// reads. Anything else — an alias, a comma, a `pivot (...)`, a dotted name — either names the
// table something the alias path owns or reshapes its columns, so it is not a plain single table.
const AFTER_A_PLAIN_TABLE = new Set([
  'where',
  'group',
  'order',
  'having',
  'qualify',
  'window',
  'limit',
  'offset',
  'fetch',
]);

const PLAIN_IDENTIFIER = /^(?:"[^"]+"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)/;

/**
 * The table an unqualified column at `offset` can be resolved against, or undefined when the
 * statement is anything less than unambiguous.
 */
export function resolveUnqualifiedSource(
  documentText: string,
  offset: number,
): UnqualifiedOrigin | undefined {
  // Cheapest checks first: this runs on every keystroke that opens the suggest widget, and the
  // cursor guards reject the common cases (mid-tag, mid-string) without scanning the document.
  if (!isColumnPosition(documentText, offset)) return undefined;

  const parsed = parseModelSql(documentText);
  const enclosing = parsed.ctes.find((cte) => offset >= cte.bodyStart && offset <= cte.bodyEnd);

  let statement: string;
  let earlierCtes: CteDefinition[];

  if (enclosing) {
    statement = documentText.slice(enclosing.bodyStart, enclosing.bodyEnd);
    // A CTE can only read the ones written before it, and never itself.
    earlierCtes = parsed.ctes.filter((cte) => cte.bodyEnd < enclosing.bodyStart);
  } else if (parsed.ctes.length === 0) {
    // A file that opens with WITH but yielded no CTEs did not parse — an unbalanced parenthesis
    // mid-edit — so it may well have some this can't see. Same refusal as any other file it
    // can't read.
    if (matchesWordAt(documentText, skipIgnorable(documentText, 0), 'with')) return undefined;
    statement = documentText;
    earlierCtes = [];
  } else {
    // The final SELECT, which starts after the WITH clause. Between two CTEs there is no
    // statement to be in.
    if (parsed.finalSelectStart === -1 || offset < parsed.finalSelectStart) return undefined;
    statement = documentText.slice(parsed.finalSelectStart);
    earlierCtes = parsed.ctes;
  }

  return singleOrigin(statement, earlierCtes);
}

/** The one table `statement` reads, or undefined when it reads more than one or can't be told. */
function singleOrigin(
  statement: string,
  candidateCtes: CteDefinition[],
): UnqualifiedOrigin | undefined {
  // A CTE nested inside this statement puts a second candidate in scope.
  if (parseCtes(statement).length > 0) return undefined;

  // One SELECT, so there is no subquery for the cursor to be in and no UNION branch to tell
  // apart. It also means any further `from` at depth 0 is a second table, not a nested one.
  if (countWord(statement, 'select') !== 1) return undefined;

  const fromIndex = findTopLevelKeyword(statement, 'from', 0);
  if (fromIndex === -1) return undefined;
  const afterKeyword = fromIndex + 'from'.length;
  if (findTopLevelKeyword(statement, 'from', afterKeyword) !== -1) return undefined;
  if (findTopLevelKeyword(statement, 'join', afterKeyword) !== -1) return undefined;

  // Every ref()/source() in scope, not just the one in FROM: a second call anywhere — a comma
  // join, a WHERE clause, a shape this parser doesn't model — means more than one candidate,
  // whether or not it can be read.
  const dbtCalls = findAllRefCalls(statement).length + findAllSourceCalls(statement).length;

  const tableStart = skipBlank(statement, afterKeyword);
  let tableEnd: number;
  let origin: UnqualifiedOrigin | undefined;

  if (statement.startsWith('{{', tableStart)) {
    if (dbtCalls !== 1) return undefined;
    tableEnd = skipNonCode(statement, tableStart);
    const [reference] = parseTableReferences(`from ${statement.slice(tableStart, tableEnd)}`);
    if (!reference) return undefined;
    origin =
      reference.kind === 'ref'
        ? { kind: 'ref', modelName: reference.modelName }
        : { kind: 'source', sourceName: reference.sourceName, tableName: reference.tableName };
  } else {
    // A bare name is a CTE of this file or a table this extension knows nothing about.
    if (dbtCalls !== 0) return undefined;
    const name = PLAIN_IDENTIFIER.exec(statement.slice(tableStart))?.[0];
    if (!name) return undefined;
    tableEnd = tableStart + name.length;
    const wanted = stripDelimiters(name).toLowerCase();
    const cte = candidateCtes.find((candidate) => candidate.name.toLowerCase() === wanted);
    if (!cte) return undefined;
    origin = { kind: 'cte', cte };
  }

  return isPlainTableEnd(statement, tableEnd) ? origin : undefined;
}

function isPlainTableEnd(statement: string, tableEnd: number): boolean {
  const next = skipBlank(statement, tableEnd);
  if (next >= statement.length) return true;

  const word = /^[A-Za-z_]+/.exec(statement.slice(next))?.[0];
  return word !== undefined && AFTER_A_PLAIN_TABLE.has(word.toLowerCase());
}

// Whitespace and comments only. skipIgnorable would also step over a `{{ … }}` block, which here
// is the table itself — landing past it would read the clause after as if it were the table.
function skipBlank(text: string, index: number): number {
  let i = index;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    const pair = text.slice(i, i + 2);
    if (pair !== '--' && pair !== '/*') return i;
    i = skipNonCode(text, i);
  }
}

/** Occurrences of `word` in code — not in a comment, string or Jinja block. */
function countWord(text: string, word: string): number {
  let count = 0;
  let i = 0;

  while (i < text.length) {
    const skipped = skipNonCode(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    if (matchesWordAt(text, i, word)) {
      count++;
      i += word.length;
      continue;
    }
    i++;
  }

  return count;
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
