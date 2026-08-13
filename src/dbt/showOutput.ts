// Parses what `dbt show --output json` writes to stdout into a flat table.
//
// dbt does not emit the same top-level shape for both call styles: an inline query prints a bare
// array of row objects, while `--select <node>` wraps that array in an object keyed by the node
// name. Both are accepted here, and the payload is located by scanning rather than by assuming
// stdout contains nothing else — `--quiet` silences dbt's ordinary logging, but a deprecation
// notice or a `{{ print() }}` in a macro still lands on the same stream.

export type PreviewCell = string | number | boolean | null;

export interface PreviewTable {
  columns: string[];
  rows: PreviewCell[][];
}

export class ShowOutputError extends Error {}

export function parseShowOutput(stdout: string): PreviewTable {
  const parsed = parseFirstJsonValue(stdout);
  if (parsed === undefined) {
    throw new ShowOutputError('dbt returned no JSON result to preview.');
  }

  return toPreviewTable(unwrapRows(parsed));
}

/** Accepts both the inline (bare array) and named-node (`{ "<node>": [...] }`) shapes. */
function unwrapRows(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;

  if (parsed && typeof parsed === 'object') {
    const arrayValue = Object.values(parsed as Record<string, unknown>).find(Array.isArray);
    if (arrayValue) return arrayValue as unknown[];
  }

  throw new ShowOutputError('dbt returned a JSON result with no rows in it.');
}

function toPreviewTable(rows: unknown[]): PreviewTable {
  // A zero-row result carries no column names with it — dbt prints `[]`, not an empty-but-typed
  // table — so "no rows" is reported as exactly that rather than as an empty grid with headers.
  const columns = collectColumns(rows);

  return {
    columns,
    rows: rows.map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      return columns.map((column) => normalizeCell(record[column]));
    }),
  };
}

/**
 * Column order follows first appearance across rows, which preserves dbt's own ordering for
 * ordinary column names. Names that look like array indices ("0", "1") are an exception: JSON.parse
 * hoists integer-like keys to the front of the object, and that reordering can't be undone here.
 */
function collectColumns(rows: unknown[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row as Record<string, unknown>)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }

  return columns;
}

/** Warehouse types that survive JSON as containers (structs, arrays) are shown as their JSON text. */
function normalizeCell(value: unknown): PreviewCell {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/**
 * Returns the first JSON array or object in `text` that actually parses.
 *
 * "First bracket wins" is not good enough: dbt prefixes its log lines with a level in brackets
 * (`[WARNING]: ...`), so the first `[` in the output is routinely not the payload. Candidates are
 * therefore filtered to bracket pairs that could open a row collection, then each is parsed until
 * one succeeds.
 */
function parseFirstJsonValue(text: string): unknown {
  let attempts = 0;

  for (let i = 0; i < text.length && attempts < MAX_PARSE_ATTEMPTS; i++) {
    if (!opensJsonPayload(text, i)) continue;

    attempts++;
    const candidate = extractBalancedValue(text, i);
    if (candidate === undefined) continue;

    try {
      return JSON.parse(candidate);
    } catch {
      continue; // a plausible-looking opener that wasn't the payload after all
    }
  }

  return undefined;
}

// Bounded so that pathological output can't turn the scan into a quadratic walk.
const MAX_PARSE_ATTEMPTS = 50;

/** True when `index` starts `[{`, `[]`, `{"` or `{}` — the only shapes a row payload can begin with. */
function opensJsonPayload(text: string, index: number): boolean {
  const char = text[index];
  if (char !== '[' && char !== '{') return false;

  const next = nextNonWhitespace(text, index + 1);
  return char === '[' ? next === '{' || next === ']' : next === '"' || next === '}';
}

function nextNonWhitespace(text: string, from: number): string | undefined {
  for (let i = from; i < text.length; i++) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return undefined;
}

/**
 * Returns the complete bracketed value starting at `start`, tracking string literals and escapes
 * so that a brace inside a value can't end the scan early. Undefined when it never closes.
 */
function extractBalancedValue(text: string, start: number): string | undefined {
  const opener = text[start];
  const closer = opener === '[' ? ']' : '}';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === opener) depth++;
    else if (char === closer) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return undefined; // truncated output: an opening bracket that never closes
}

/**
 * Best-effort extraction of why dbt failed, for a message the user can act on. dbt reports
 * compilation and database errors on stdout even under `--quiet`; stderr usually only carries a
 * Python traceback (a broken venv, a missing adapter), which is worth surfacing ahead of it.
 */
export function extractDbtError(stdout: string, stderr: string): string {
  const fromStderr = lastMeaningfulLines(stderr);
  if (fromStderr) return fromStderr;

  const fromStdout = lastMeaningfulLines(stdout);
  return fromStdout || 'dbt exited with an error but reported no message.';
}

const MAX_ERROR_LINES = 12;

function lastMeaningfulLines(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  return lines.length === 0 ? undefined : lines.slice(-MAX_ERROR_LINES).join('\n');
}
