// Structural parsing of a dbt model's SQL: its top-level CTEs, and the final SELECT they feed.
//
// Two consumers with very different tolerances share this. Column autocomplete only needs CTE
// names and their output columns, and a miss there costs nothing. The preview rewrite needs to know
// exactly where the final SELECT starts and what shape it has, because it splices text around it —
// so every function here reports "I could not tell" rather than returning a best guess.

import {
  findMatchingParen,
  findTopLevelKeyword,
  matchesWordAt,
  skipIgnorable,
  splitTopLevel,
} from './scanner';

export interface CteDefinition {
  /** Delimiters stripped, for matching against an alias the user typed. */
  name: string;
  /** Exactly as written, so a quoted or bracketed name can be re-emitted verbatim. */
  rawName: string;
  /** Offset of the name in the document, for placing a CodeLens on the CTE. */
  nameStart: number;
  /** Output columns of the CTE's own outer-most SELECT; empty when they can't be resolved. */
  columns: string[];
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

    ctes.push({
      name: stripDelimiters(name.value),
      rawName: name.value,
      nameStart: name.startIndex,
      columns: extractTopLevelSelectColumns(sql.slice(bodyStart, bodyEnd)),
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

function extractTopLevelSelectColumns(body: string): string[] {
  const selectIndex = findTopLevelKeyword(body, 'select', 0);
  if (selectIndex === -1) return [];

  const listStart = selectIndex + 'select'.length;
  const fromIndex = findTopLevelKeyword(body, 'from', listStart);
  const columnList = body.slice(listStart, fromIndex === -1 ? body.length : fromIndex);

  return splitTopLevel(columnList, ',')
    .map(extractColumnAlias)
    .filter((alias): alias is string => alias !== undefined);
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
