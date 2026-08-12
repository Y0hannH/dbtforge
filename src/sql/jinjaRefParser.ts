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

/**
 * Same as isInsideJinjaTag but also counts statement tags (`{% ... %}`), where macro calls are
 * just as common (`{% set x = my_macro() %}`, `{% do my_macro() %}`). Used to gate macro-call
 * detection: without it, any SQL function call would be treated as a candidate macro call.
 */
export function isInsideJinjaExpression(lineTextBeforeIndex: string): boolean {
  const lastOpen = Math.max(lineTextBeforeIndex.lastIndexOf('{{'), lineTextBeforeIndex.lastIndexOf('{%'));
  const lastClose = Math.max(lineTextBeforeIndex.lastIndexOf('}}'), lineTextBeforeIndex.lastIndexOf('%}'));
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
  | { kind: 'ref'; name: string; packageName?: string; argStart: number; argEnd: number }
  | { kind: 'source'; sourceName: string; tableName: string; argStart: number; argEnd: number };

// The `d` flag (match indices) gives exact per-group offsets, so short names that happen to
// be substrings of the literal "ref(" / "source(" text (e.g. a model named "f") can't be
// confused with the call syntax the way a match[0].indexOf(match[1]) search would.
// ref() is matched in all the shapes dbt accepts: ref('model'), the cross-package
// ref('package', 'model'), and either of those with a trailing kwarg (ref('model', version=2)).
// Group 1 is the package (absent for the one-arg form), group 2 is always the model name.
const REF_CALL = /\bref\(\s*(?:['"]([^'"]+)['"]\s*,\s*)?['"]([^'"]+)['"]\s*(?:,[^)]*)?\)/gd;
const SOURCE_CALL = /\bsource\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gd;

// `indices` entries are undefined for optional groups that didn't participate in the match.
type RegExpMatchWithIndices = RegExpExecArray & { indices: Array<[number, number] | undefined> };

/**
 * Scans a full line for ref()/source() calls and returns the one whose argument span
 * (the quoted string, not the whole call) contains `character`. Used for Go to Definition,
 * where the cursor can be anywhere inside an already-written call, not just at a prefix.
 */
export function findCallAtPosition(lineText: string, character: number): CallMatch | undefined {
  for (const match of lineText.matchAll(REF_CALL) as IterableIterator<RegExpMatchWithIndices>) {
    const packageSpan = match.indices[1];
    const [nameStart, nameEnd] = match.indices[2]!;
    // The cursor counts as "on the ref" from either argument of the cross-package form, so
    // Go to Definition works from ref('package', 'model') with the cursor on the package too.
    const span =
      packageSpan && character >= packageSpan[0] && character <= packageSpan[1]
        ? packageSpan
        : character >= nameStart && character <= nameEnd
          ? ([nameStart, nameEnd] as [number, number])
          : undefined;
    if (span) {
      return { kind: 'ref', name: match[2], packageName: match[1], argStart: span[0], argEnd: span[1] };
    }
  }

  for (const match of lineText.matchAll(SOURCE_CALL) as IterableIterator<RegExpMatchWithIndices>) {
    const [sourceStart, sourceEnd] = match.indices[1]!;
    if (character >= sourceStart && character <= sourceEnd) {
      return {
        kind: 'source',
        sourceName: match[1],
        tableName: match[2],
        argStart: sourceStart,
        argEnd: sourceEnd,
      };
    }

    const [tableStart, tableEnd] = match.indices[2]!;
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

export interface RefCallMatch extends CallLocation {
  name: string;
  /** Package named explicitly in `ref('package', 'model')`, absent for a plain `ref('model')`. */
  packageName?: string;
}

export interface SourceCallMatch extends CallLocation {
  sourceName: string;
  tableName: string;
}

/**
 * Every ref() call on a line, regardless of the model name — the span covers the model-name
 * argument, never the optional package prefix.
 */
export function findAllRefCalls(lineText: string): RefCallMatch[] {
  const results: RefCallMatch[] = [];
  for (const match of lineText.matchAll(REF_CALL) as IterableIterator<RegExpMatchWithIndices>) {
    const [start, end] = match.indices[2]!;
    results.push({ name: match[2], packageName: match[1], start, end });
  }
  return results;
}

/** Every source() call on a line, regardless of source/table name — span points at the table-name arg. */
export function findAllSourceCalls(lineText: string): SourceCallMatch[] {
  const results: SourceCallMatch[] = [];
  for (const match of lineText.matchAll(SOURCE_CALL) as IterableIterator<RegExpMatchWithIndices>) {
    const [start, end] = match.indices[2]!;
    results.push({ sourceName: match[1], tableName: match[2], start, end });
  }
  return results;
}

/**
 * Every ref() call to `modelName` on a line — a file can reference the same model more than once.
 * When the call names a package explicitly (ref('package', 'model')) and `packageName` is known,
 * a mismatch is skipped so a same-named model in another package isn't reported as a call site.
 */
export function findAllRefCallLocations(
  lineText: string,
  modelName: string,
  packageName?: string
): CallLocation[] {
  return findAllRefCalls(lineText)
    .filter((call) => call.name === modelName)
    .filter((call) => !call.packageName || !packageName || call.packageName === packageName)
    .map(({ start, end }) => ({ start, end }));
}

/** Every source() call to (sourceName, tableName) on a line, pointing at the table-name arg. */
export function findAllSourceCallLocations(
  lineText: string,
  sourceName: string,
  tableName: string
): CallLocation[] {
  return findAllSourceCalls(lineText)
    .filter((call) => call.sourceName === sourceName && call.tableName === tableName)
    .map(({ start, end }) => ({ start, end }));
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every call to `macroName` on a line, bare or namespaced (e.g. `dbt_utils.macroName(`); the
 * returned span always covers just the macro name, not the package prefix. Two filters keep this
 * from matching plain SQL: the call must sit inside a Jinja tag, and an explicit package prefix
 * must match `packageName` when it's known — dbt ships macros named after common SQL functions
 * (`replace`, `length`, `concat`, `left`, ...), so an unfiltered scan reports call sites that
 * are really just SQL.
 */
export function findAllMacroCallLocations(
  lineText: string,
  macroName: string,
  packageName?: string
): CallLocation[] {
  const results: CallLocation[] = [];
  const pattern = new RegExp(
    `(?:([A-Za-z_][A-Za-z0-9_]*)\\s*\\.\\s*)?\\b(${escapeRegExp(macroName)})\\s*\\(`,
    'gd'
  );
  for (const match of lineText.matchAll(pattern) as IterableIterator<RegExpMatchWithIndices>) {
    if (match[1] && packageName && match[1] !== packageName) continue;
    const [start, end] = match.indices[2]!;
    if (!isInsideJinjaExpression(lineText.slice(0, start))) continue;
    results.push({ start, end });
  }
  return results;
}

const MACRO_CALL = /(?:([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gd;

export interface MacroCallMatch {
  name: string;
  /** The `dbt_utils` in `dbt_utils.star(...)`, when the call is namespaced. */
  packageName?: string;
  start: number;
  end: number;
}

/**
 * Detects "cursor is on a macro call" for Find All References / Go to Definition: the identifier
 * under the cursor, followed (modulo whitespace) by `(` and sitting inside a Jinja tag. The Jinja
 * requirement is what separates a macro call from ordinary SQL — resolving the name against the
 * macro index is not enough on its own, because dbt's own cross-database macros are named after
 * SQL functions (`replace`, `length`, `concat`, `position`, ...), so `replace(col, 'a', 'b')` in
 * plain SQL would otherwise resolve to a macro and jump into dbt's internals.
 */
export function findMacroCallAtPosition(
  lineText: string,
  character: number
): MacroCallMatch | undefined {
  for (const match of lineText.matchAll(MACRO_CALL) as IterableIterator<RegExpMatchWithIndices>) {
    const [start, end] = match.indices[2]!;
    if (character < start || character > end) continue;
    if (!isInsideJinjaExpression(lineText.slice(0, match.index!))) continue;
    return { name: match[2], packageName: match[1], start, end };
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
  const [start, end] = match.indices[1]!;
  if (character < start || character > end) return undefined;
  return { name: match[1], start, end };
}

/**
 * Line index of `{% macro macroName(...) %}` in a file's lines, if present. One .sql file can
 * define several macros, so navigating to a macro means navigating to its line, not to the file.
 */
export function findMacroDefinitionLine(lines: string[], macroName: string): number | undefined {
  for (let line = 0; line < lines.length; line++) {
    const match = MACRO_DEFINITION.exec(lines[line]);
    if (match?.[1] === macroName) return line;
  }
  return undefined;
}
