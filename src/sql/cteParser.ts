// Extracts top-level CTEs (`WITH name AS ( ... ), name2 AS ( ... )`) and, for each, the
// column aliases of its own outer-most SELECT. Deliberately shallow: no resolution of nested
// CTEs' internals, no type inference, no `SELECT *` expansion. If a column's alias can't be
// determined unambiguously (e.g. a bare expression with no AS), it is simply omitted.

export interface CteDefinition {
  name: string;
  columns: string[];
}

// Matches T-SQL bracket identifiers ([Some Column]) or plain identifiers.
const IDENT = `(?:\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_]*)`;
const CTE_NAME_RE = new RegExp(`\\b(${IDENT})\\s+AS\\s*\\(`, 'gi');

export function parseCtes(documentText: string): CteDefinition[] {
  const withMatch = /\bWITH\b/i.exec(documentText);
  if (!withMatch) return [];

  const ctes: CteDefinition[] = [];
  CTE_NAME_RE.lastIndex = withMatch.index;

  let match: RegExpExecArray | null;
  let expectMore = true;
  while (expectMore && (match = CTE_NAME_RE.exec(documentText))) {
    const cteName = stripBrackets(match[1]);
    const openParenIndex = match.index + match[0].length - 1;
    const closeParenIndex = findMatchingParen(documentText, openParenIndex);
    if (closeParenIndex === -1) break;

    const body = documentText.slice(openParenIndex + 1, closeParenIndex);
    const columns = extractTopLevelSelectColumns(body);
    if (columns.length > 0) {
      ctes.push({ name: cteName, columns });
    }

    // A CTE list is comma-separated; once the char after the closing paren isn't a comma,
    // we've reached the final SELECT and there are no more CTEs to parse.
    const afterParen = /^\s*(,)?/.exec(documentText.slice(closeParenIndex + 1));
    expectMore = Boolean(afterParen?.[1]);
    CTE_NAME_RE.lastIndex = closeParenIndex + 1;
  }

  return ctes;
}

function extractTopLevelSelectColumns(body: string): string[] {
  const selectMatch = /\bSELECT\b/i.exec(body);
  if (!selectMatch) return [];

  const selectListStart = selectMatch.index + selectMatch[0].length;
  const fromIndex = findTopLevelKeyword(body, /\bFROM\b/iy, selectListStart);
  const columnListText = body.slice(selectListStart, fromIndex === -1 ? body.length : fromIndex);

  return splitTopLevel(columnListText, ',')
    .map(extractColumnAlias)
    .filter((alias): alias is string => alias !== undefined);
}

function extractColumnAlias(expr: string): string | undefined {
  const trimmed = expr.trim();
  if (!trimmed) return undefined;

  const asMatch = new RegExp(`\\bAS\\s+(${IDENT})\\s*$`, 'i').exec(trimmed);
  if (asMatch) return stripBrackets(asMatch[1]);

  // No explicit alias: only resolve unambiguous bare references (`col`, `t.col`, `t.[col]`).
  // Anything else — function calls, arithmetic, string concatenation — is left unresolved.
  const bareMatch = new RegExp(`^(?:${IDENT}\\.)?(${IDENT})$`).exec(trimmed);
  if (bareMatch) return stripBrackets(bareMatch[1]);

  return undefined;
}

function stripBrackets(ident: string): string {
  return ident.startsWith('[') && ident.endsWith(']') ? ident.slice(1, -1) : ident;
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Finds the first match of a sticky (`y`-flagged) regex that occurs at paren depth 0. */
function findTopLevelKeyword(text: string, stickyRe: RegExp, fromIndex: number): number {
  let depth = 0;
  for (let i = fromIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth--;
      continue;
    }
    if (depth === 0) {
      stickyRe.lastIndex = i;
      if (stickyRe.test(text)) return i;
    }
  }
  return -1;
}

/** Splits on `separator` only at paren depth 0 (so commas inside function calls are kept intact). */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
