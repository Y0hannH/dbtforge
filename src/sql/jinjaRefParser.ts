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
