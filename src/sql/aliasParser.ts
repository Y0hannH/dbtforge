// Finds the table references a model's SQL declares — `FROM/JOIN {{ ref('X') }}` and
// `FROM/JOIN {{ source('a', 'b') }}`, with an alias, with `AS alias`, or with no alias at all.
// `ref()` is read in the shapes dbt accepts: `ref('X')`, `ref('package', 'X')` and either with a
// pinned version (`ref('X', v=2)`). Scope limited to single-line calls — no resolution of
// `SELECT *` or multi-line ref()/source() calls.

import type { RefVersion } from './jinjaRefParser';
import { versionOf } from './jinjaRefParser';

export type SourceRef =
  | ({ kind: 'ref'; modelName: string; packageName?: string } & RefVersion)
  | { kind: 'source'; sourceName: string; tableName: string };

/** A table reference that carries an alias, which is what `alias.` completion resolves against. */
export type AliasSource = SourceRef & { alias: string };

/** Any table reference, aliased or not. `alias` is absent when the model names none. */
export type TableReference = SourceRef & { alias?: string };

// Group 1 is the package (absent for the one-argument form), group 2 the model, group 3 whatever
// keyword arguments trail it. The keyword part allows one level of parentheses so that
// `v=var('orders_version')` is read to its end rather than cut at the first `)`.
const REF_TABLE_RE =
  /\b(?:FROM|JOIN)\s+\{\{\s*ref\(\s*(?:['"]([^'"]+)['"]\s*,\s*)?['"]([^'"]+)['"]\s*(?:,((?:[^()]|\([^()]*\))*))?\)\s*\}\}(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;

const SOURCE_TABLE_RE =
  /\b(?:FROM|JOIN)\s+\{\{\s*source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;

// A word sitting where an alias would sit is only an alias if it isn't SQL's own vocabulary.
// Without this, `from {{ ref('orders') }}` followed by WHERE reads as an alias named "where" —
// which invents an alias nobody typed, and hides the one fact the unaliased completion path
// depends on: that this model has none.
const NOT_AN_ALIAS = new Set([
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'fetch',
  'qualify',
  'window',
  'union',
  'intersect',
  'except',
  'minus',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'outer',
  'cross',
  'natural',
  'lateral',
  'straight_join',
  'on',
  'using',
  'as',
  'select',
  'from',
  'with',
  'when',
  'pivot',
  'unpivot',
  'tablesample',
  'sample',
  'partition',
  'settings',
  'prewhere',
  'cluster',
  'distribute',
  'sort',
  'for',
]);

function aliasOf(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  return NOT_AN_ALIAS.has(candidate.toLowerCase()) ? undefined : candidate;
}

/** Every FROM/JOIN table reference in the document, in the order they are written. */
export function parseTableReferences(documentText: string): TableReference[] {
  const found: Array<{ at: number; reference: TableReference }> = [];

  for (const match of documentText.matchAll(REF_TABLE_RE)) {
    const alias = aliasOf(match[4]);
    found.push({
      at: match.index,
      reference: {
        kind: 'ref',
        modelName: match[2],
        ...(match[1] ? { packageName: match[1] } : {}),
        ...versionOf(match[3]),
        ...(alias ? { alias } : {}),
      },
    });
  }

  for (const match of documentText.matchAll(SOURCE_TABLE_RE)) {
    const alias = aliasOf(match[3]);
    found.push({
      at: match.index,
      reference: {
        kind: 'source',
        sourceName: match[1],
        tableName: match[2],
        ...(alias ? { alias } : {}),
      },
    });
  }

  return found.sort((a, b) => a.at - b.at).map(({ reference }) => reference);
}

/** The table a reference points at, without the alias it was given. */
export function withoutAlias(reference: TableReference): SourceRef {
  const { alias: _alias, ...source } = reference;
  return source;
}

/** The subset that named an alias — `FROM {{ ref('X') }} x` and friends. */
export function parseAliases(documentText: string): AliasSource[] {
  return parseTableReferences(documentText).filter(
    (reference): reference is AliasSource => reference.alias !== undefined,
  );
}
