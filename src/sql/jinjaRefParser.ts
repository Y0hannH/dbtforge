// Parsing helpers for `{{ ref('...') }}` and `{{ source('...', '...') }}` calls.
// Scope is deliberately limited to single-line calls — this matches how dbt models are
// written in practice (multi-line ref()/source() calls are vanishingly rare) and keeps the
// parsing regex-based instead of pulling in a Jinja parser.

export type CompletionContext =
  | { kind: 'ref'; partial: string }
  | { kind: 'source-name'; partial: string }
  | { kind: 'source-table'; sourceName: string; partial: string };

/**
 * True when the cursor (based on the line text before it) is inside an unclosed `{{ ... }}`
 * tag. Used to gate the bare `ref`/`source` snippet completion — it should only fire on plain
 * SQL text, not when the user is already mid-way through typing a tag (where the ref()/source()
 * name-completion context takes over instead).
 */
export function isInsideJinjaTag(lineTextBeforeCursor: string): boolean {
  const lastOpen = lineTextBeforeCursor.lastIndexOf('{{');
  const lastClose = lineTextBeforeCursor.lastIndexOf('}}');
  return lastOpen > lastClose;
}

const REF_PREFIX = /\{\{\s*ref\(\s*['"]([^'"]*)$/;
const SOURCE_NAME_PREFIX = /\{\{\s*source\(\s*['"]([^'"]*)$/;
const SOURCE_TABLE_PREFIX = /\{\{\s*source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)$/;

/**
 * Determines whether the cursor sits inside a ref()/source() string argument, based on the
 * line text up to (not including) the cursor. Used to drive completion — prefix-only, no
 * awareness of what follows the cursor on the line.
 */
export function parseCompletionContext(lineTextBeforeCursor: string): CompletionContext | undefined {
  const sourceTableMatch = SOURCE_TABLE_PREFIX.exec(lineTextBeforeCursor);
  if (sourceTableMatch) {
    return { kind: 'source-table', sourceName: sourceTableMatch[1], partial: sourceTableMatch[2] };
  }

  const sourceNameMatch = SOURCE_NAME_PREFIX.exec(lineTextBeforeCursor);
  if (sourceNameMatch) {
    return { kind: 'source-name', partial: sourceNameMatch[1] };
  }

  const refMatch = REF_PREFIX.exec(lineTextBeforeCursor);
  if (refMatch) {
    return { kind: 'ref', partial: refMatch[1] };
  }

  return undefined;
}

export type CallMatch =
  | { kind: 'ref'; name: string; argStart: number; argEnd: number }
  | { kind: 'source'; sourceName: string; tableName: string; argStart: number; argEnd: number };

// The `d` flag (match indices) gives exact per-group offsets, so short names that happen to
// be substrings of the literal "ref(" / "source(" text (e.g. a model named "f") can't be
// confused with the call syntax the way a match[0].indexOf(match[1]) search would.
const REF_CALL = /ref\(\s*['"]([^'"]+)['"]\s*\)/gd;
const SOURCE_CALL = /source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gd;

type RegExpMatchWithIndices = RegExpExecArray & { indices: Array<[number, number]> };

/**
 * Scans a full line for ref()/source() calls and returns the one whose argument span
 * (the quoted string, not the whole call) contains `character`. Used for Go to Definition,
 * where the cursor can be anywhere inside an already-written call, not just at a prefix.
 */
export function findCallAtPosition(lineText: string, character: number): CallMatch | undefined {
  for (const match of lineText.matchAll(REF_CALL) as IterableIterator<RegExpMatchWithIndices>) {
    const [argStart, argEnd] = match.indices[1];
    if (character >= argStart && character <= argEnd) {
      return { kind: 'ref', name: match[1], argStart, argEnd };
    }
  }

  for (const match of lineText.matchAll(SOURCE_CALL) as IterableIterator<RegExpMatchWithIndices>) {
    const [sourceStart, sourceEnd] = match.indices[1];
    if (character >= sourceStart && character <= sourceEnd) {
      return {
        kind: 'source',
        sourceName: match[1],
        tableName: match[2],
        argStart: sourceStart,
        argEnd: sourceEnd,
      };
    }

    const [tableStart, tableEnd] = match.indices[2];
    if (character >= tableStart && character <= tableEnd) {
      return {
        kind: 'source',
        sourceName: match[1],
        tableName: match[2],
        argStart: tableStart,
        argEnd: tableEnd,
      };
    }
  }

  return undefined;
}

export interface CallLocation {
  start: number;
  end: number;
}

/** Every ref() call to `modelName` on a line — a file can reference the same model more than once. */
export function findAllRefCallLocations(lineText: string, modelName: string): CallLocation[] {
  const results: CallLocation[] = [];
  for (const match of lineText.matchAll(REF_CALL) as IterableIterator<RegExpMatchWithIndices>) {
    if (match[1] !== modelName) continue;
    const [start, end] = match.indices[1];
    results.push({ start, end });
  }
  return results;
}

/** Every source() call to (sourceName, tableName) on a line, pointing at the table-name arg. */
export function findAllSourceCallLocations(
  lineText: string,
  sourceName: string,
  tableName: string
): CallLocation[] {
  const results: CallLocation[] = [];
  for (const match of lineText.matchAll(SOURCE_CALL) as IterableIterator<RegExpMatchWithIndices>) {
    if (match[1] !== sourceName || match[2] !== tableName) continue;
    const [start, end] = match.indices[2];
    results.push({ start, end });
  }
  return results;
}

/**
 * Every call to `macroName` on a line, bare or namespaced (e.g. `dbt_utils.macroName(`) — `\b`
 * matches right after the `.` too, so this resolves to just the macro name's span either way.
 * Macro names are Jinja/Python identifiers, so no regex escaping is needed.
 */
export function findAllMacroCallLocations(lineText: string, macroName: string): CallLocation[] {
  const results: CallLocation[] = [];
  const pattern = new RegExp(`\\b${macroName}\\s*\\(`, 'g');
  for (const match of lineText.matchAll(pattern)) {
    const start = match.index!;
    results.push({ start, end: start + macroName.length });
  }
  return results;
}

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Detects "cursor is on a macro call" for Find All References / Go to Definition: the identifier
 * under the cursor, provided it's followed (modulo whitespace) by `(`. Resolving the returned name
 * against the macro index naturally filters out plain SQL function calls (e.g. `sum(`, `coalesce(`)
 * that happen to look like a call but aren't a known macro.
 */
export function findMacroCallAtPosition(
  lineText: string,
  character: number
): { name: string; start: number; end: number } | undefined {
  for (const match of lineText.matchAll(IDENTIFIER)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (character < start || character > end) continue;
    if (!/^\s*\(/.test(lineText.slice(end))) continue;
    return { name: match[0], start, end };
  }
  return undefined;
}

const MACRO_DEFINITION = /\{%-?\s*macro\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/d;

/**
 * Detects "cursor is on a `{% macro name(...) %}` definition line". Used so Find All References
 * works from inside a macro's own file even though the whole-file fallback (used for models,
 * which are 1:1 with a file) doesn't apply — a macro file can define more than one macro.
 */
export function findMacroDefinitionAtPosition(
  lineText: string,
  character: number
): { name: string; start: number; end: number } | undefined {
  const match = MACRO_DEFINITION.exec(lineText) as RegExpMatchWithIndices | null;
  if (!match) return undefined;
  const [start, end] = match.indices[1];
  if (character < start || character > end) return undefined;
  return { name: match[1], start, end };
}
