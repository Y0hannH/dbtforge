// Structural parsing of a dbt model's SQL: its top-level CTEs, and the final SELECT they feed.
//
// Two consumers with very different tolerances share this. Column autocomplete only needs CTE
// names and their output columns, and a miss there costs nothing. The preview rewrite needs to know
// exactly where the final SELECT starts and what shape it has, because it splices text around it —
// so every function here reports "I could not tell" rather than returning a best guess.

import type { SourceRef } from './aliasParser';
import { parseTableReferences } from './aliasParser';
import { findAllRefCalls, findAllSourceCalls } from './jinjaRefParser';
import {
  findMatchingParen,
  findTopLevelKeyword,
  matchesWordAt,
  skipIgnorable,
  splitTopLevel,
} from './scanner';

/**
 * What a CTE's SELECT list holds beyond the columns it names: `*`, `alias.*`, or a Jinja macro such
 * as `dbt_utils.star(...)`. Each expands into columns this parser cannot read off the text.
 */
export interface CteExpansion {
  /**
   * The one table every expanded column comes from, when that can be told: the CTE's first SELECT
   * (a UNION takes its column names from it) reads exactly one ref()/source(), with nothing else in
   * its FROM clause, and nothing in the list expands from anywhere else. Absent otherwise, which
   * means the expanded columns are unknown — not that there are none.
   */
  source?: SourceRef;
}

export interface CteDefinition {
  /** Delimiters stripped, for matching against an alias the user typed. */
  name: string;
  /** Exactly as written, so a quoted or bracketed name can be re-emitted verbatim. */
  rawName: string;
  /** Offset of the name in the document, for placing a CodeLens on the CTE. */
  nameStart: number;
  /**
   * Output columns of the CTE's own outer-most SELECT that the text names; empty when they can't be
   * resolved. When `expansion` is set this is only part of the answer, and must not be presented
   * as the CTE's columns on its own — the rest are the ones the expansion adds.
   */
  columns: string[];
  /** Present when the SELECT list also expands into columns that aren't named in the text. */
  expansion?: CteExpansion;
  /** Offset just past the CTE's opening parenthesis. */
  bodyStart: number;
  /** Offset of the CTE's closing parenthesis. */
  bodyEnd: number;
}

export interface ParsedModelSql {
  ctes: CteDefinition[];
  /**
   * Offset where the statement's final SELECT begins — after the WITH clause, if any.
   * -1 when the statement could not be understood, which is the signal to leave it alone.
   */
  finalSelectStart: number;
  /** `SELECT DISTINCT`, which constrains what an ORDER BY bolted onto it may reference. */
  isDistinct: boolean;
  /** A top-level ORDER BY, which a derived table cannot contain without TOP or OFFSET. */
  hasOrderBy: boolean;
}

const IDENT = `(?:\\[[^\\]]+\\]|"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)`;

export function parseModelSql(sql: string): ParsedModelSql {
  const unparsed: ParsedModelSql = {
    ctes: [],
    finalSelectStart: -1,
    isDistinct: false,
    hasOrderBy: false,
  };

  const withClause = parseWithClause(sql);
  if (!withClause) return unparsed;

  const selectStart = withClause.endIndex;
  if (!matchesWordAt(sql, selectStart, 'select')) {
    // Not a SELECT statement at all, or a form this parser doesn't model. Either way, nothing
    // downstream may assume it knows where to splice.
    return { ...unparsed, ctes: withClause.ctes };
  }

  const afterSelect = skipIgnorable(sql, selectStart + 'select'.length);

  return {
    ctes: withClause.ctes,
    finalSelectStart: selectStart,
    isDistinct: matchesWordAt(sql, afterSelect, 'distinct'),
    hasOrderBy: hasTopLevelOrderBy(sql, selectStart),
  };
}

/** CTE names and columns only, for autocomplete. */
export function parseCtes(sql: string): CteDefinition[] {
  return parseWithClause(sql)?.ctes ?? [];
}

interface WithClause {
  ctes: CteDefinition[];
  /** Offset of the first code character after the CTE list. */
  endIndex: number;
}

function parseWithClause(sql: string): WithClause | undefined {
  let i = skipIgnorable(sql, 0);
  if (!matchesWordAt(sql, i, 'with')) return { ctes: [], endIndex: i };

  const ctes: CteDefinition[] = [];
  i = skipIgnorable(sql, i + 'with'.length);

  for (;;) {
    const name = readIdentifier(sql, i);
    if (!name) return undefined;
    i = skipIgnorable(sql, name.endIndex);

    // `with a (x, y) as (...)`: an explicit column list sits between the name and AS.
    if (sql[i] === '(') {
      const listEnd = findMatchingParen(sql, i);
      if (listEnd === -1) return undefined;
      i = skipIgnorable(sql, listEnd + 1);
    }

    if (!matchesWordAt(sql, i, 'as')) return undefined;
    i = skipIgnorable(sql, i + 'as'.length);

    if (sql[i] !== '(') return undefined;
    const bodyStart = i + 1;
    const bodyEnd = findMatchingParen(sql, i);
    if (bodyEnd === -1) return undefined;

    const output = describeOutput(sql.slice(bodyStart, bodyEnd));
    ctes.push({
      name: stripDelimiters(name.value),
      rawName: name.value,
      nameStart: name.startIndex,
      columns: output.columns,
      ...(output.expansion ? { expansion: output.expansion } : {}),
      bodyStart,
      bodyEnd,
    });

    i = skipIgnorable(sql, bodyEnd + 1);
    if (sql[i] !== ',') return { ctes, endIndex: i };
    i = skipIgnorable(sql, i + 1);
  }
}

interface Identifier {
  /** Source text, delimiters included. */
  value: string;
  startIndex: number;
  endIndex: number;
}

function readIdentifier(sql: string, index: number): Identifier | undefined {
  const match = new RegExp(`^${IDENT}`).exec(sql.slice(index));
  if (!match) return undefined;
  return { value: match[0], startIndex: index, endIndex: index + match[0].length };
}

function hasTopLevelOrderBy(sql: string, fromIndex: number): boolean {
  const orderIndex = findTopLevelKeyword(sql, 'order', fromIndex);
  if (orderIndex === -1) return false;
  return matchesWordAt(sql, skipIgnorable(sql, orderIndex + 'order'.length), 'by');
}

// `*` or `alias.*`, with whatever follows it: `* exclude (a)`, `* replace (...)`, `* ilike '...'`.
const STAR_ITEM = new RegExp(`^(?:(${IDENT})\\.)?\\*(?:\\s+([\\s\\S]*))?$`);

// An item that is nothing but a Jinja expression and was given no alias: `{{ dbt_utils.star(...) }}`.
// The macro writes out a column list the parser never sees.
const BARE_JINJA_ITEM = /^\{\{[\s\S]*\}\}$/;

// Where a SELECT's FROM clause ends, and where its UNION branches begin.
const CLAUSES_AFTER_FROM = ['where', 'group', 'order', 'having', 'qualify', 'window', 'limit'];
const SET_OPERATORS = ['union', 'intersect', 'except', 'minus'];

// A single table in a FROM clause: one Jinja block, then at most an alias. Anything past that
// (`pivot (...)`, `sample (10)`) reshapes the columns, so it is not a single plain table.
const SINGLE_TABLE = new RegExp(
  `^\\{\\{(?:(?!\\}\\}).)*\\}\\}(?:\\s+(?:as\\s+)?(${IDENT}))?$`,
  'is',
);

interface SelectOutput {
  columns: string[];
  expansion?: CteExpansion;
}

function describeOutput(body: string): SelectOutput {
  const selectIndex = findTopLevelKeyword(body, 'select', 0);
  if (selectIndex === -1) return { columns: [] };

  const listStart = selectIndex + 'select'.length;
  const fromIndex = findTopLevelKeyword(body, 'from', listStart);
  const columnList = body.slice(listStart, fromIndex === -1 ? body.length : fromIndex);

  const columns: string[] = [];
  const qualifiers: string[] = [];
  let expands = false;
  let unreadable = false;

  for (const item of splitTopLevel(columnList, ',')) {
    // Comments are dropped for recognising a star or a macro only: a `-- note` above `*` is still
    // a star. They are not dropped before reading a column name, which has always been read as is.
    const trimmed = item
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')
      .trim();

    const star = STAR_ITEM.exec(trimmed);
    if (star) {
      expands = true;
      if (star[2]?.trim()) unreadable = true; // `* exclude (...)`: not every column survives
      if (star[1]) qualifiers.push(stripDelimiters(star[1]));
      continue;
    }

    const column = extractColumnAlias(item);
    if (column !== undefined) {
      columns.push(column);
    } else if (BARE_JINJA_ITEM.test(trimmed)) {
      expands = true;
      unreadable = true;
    }
  }

  if (!expands) return { columns };

  const source = unreadable ? undefined : resolveExpansionSource(body, fromIndex, qualifiers);
  return { columns, expansion: source ? { source } : {} };
}

/**
 * The single ref()/source() the first SELECT of `body` reads, or undefined when anything about its
 * FROM clause could put columns from somewhere else into a `*`: a join, a comma, a subquery, a CTE
 * name, a pivot, an alias that isn't the one the star was qualified with.
 */
function resolveExpansionSource(
  body: string,
  fromIndex: number,
  qualifiers: string[],
): SourceRef | undefined {
  if (fromIndex === -1) return undefined;
  const afterFrom = fromIndex + 'from'.length;

  // UNION branches share their first branch's column names, so only that branch is read.
  const branchEnd = firstOf(body, SET_OPERATORS, afterFrom, body.length);
  const clauseEnd = firstOf(body, CLAUSES_AFTER_FROM, afterFrom, branchEnd);
  const fromClause = body.slice(afterFrom, clauseEnd).trim();

  if (findTopLevelKeyword(fromClause, 'join', 0) !== -1) return undefined;
  if (splitTopLevel(fromClause, ',').length !== 1) return undefined;
  if (findAllRefCalls(fromClause).length + findAllSourceCalls(fromClause).length !== 1) {
    return undefined;
  }

  const table = SINGLE_TABLE.exec(fromClause);
  if (!table) return undefined;

  const [reference] = parseTableReferences(`from ${fromClause}`);
  if (!reference) return undefined;

  // The alias the regex read must be the one the reference parser accepted: a keyword where an
  // alias would sit is not an alias, and then there is something after the table that isn't one.
  const alias = table[1] ? stripDelimiters(table[1]) : undefined;
  if (alias !== reference.alias) return undefined;

  // `a.*` is only this table's columns when `a` is the alias this table was given.
  if (qualifiers.some((qualifier) => qualifier.toLowerCase() !== alias?.toLowerCase())) {
    return undefined;
  }

  return reference.kind === 'ref'
    ? { kind: 'ref', modelName: reference.modelName }
    : { kind: 'source', sourceName: reference.sourceName, tableName: reference.tableName };
}

/** Offset of the earliest top-level occurrence of any of `words` in [from, to), or `to`. */
function firstOf(text: string, words: string[], from: number, to: number): number {
  let earliest = to;
  for (const word of words) {
    const at = findTopLevelKeyword(text, word, from, earliest);
    if (at !== -1) earliest = at;
  }
  return earliest;
}

function extractColumnAlias(expression: string): string | undefined {
  const trimmed = expression.trim();
  if (!trimmed) return undefined;

  const aliased = new RegExp(`\\bAS\\s+(${IDENT})\\s*$`, 'i').exec(trimmed);
  if (aliased) return stripDelimiters(aliased[1]);

  // No explicit alias: only resolve unambiguous bare references (`col`, `t.col`, `t.[col]`).
  // Anything else — function calls, arithmetic, string concatenation — is left unresolved.
  const bare = new RegExp(`^(?:${IDENT}\\.)?(${IDENT})$`).exec(trimmed);
  if (bare) return stripDelimiters(bare[1]);

  return undefined;
}

function stripDelimiters(identifier: string): string {
  const first = identifier[0];
  const last = identifier[identifier.length - 1];
  if ((first === '[' && last === ']') || (first === '"' && last === '"')) {
    return identifier.slice(1, -1);
  }
  return identifier;
}
