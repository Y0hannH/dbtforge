// Finds `FROM/JOIN {{ ref('X') }} alias` and `FROM/JOIN {{ source('a', 'b') }} alias`
// (with or without explicit AS) in the open document. Scope limited to this exact shape —
// no resolution of `SELECT *` or multi-line ref()/source() calls.

export type AliasSource =
  | { kind: 'ref'; alias: string; modelName: string }
  | { kind: 'source'; alias: string; sourceName: string; tableName: string };

const REF_ALIAS_RE =
  /\b(?:FROM|JOIN)\s+\{\{\s*ref\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;

const SOURCE_ALIAS_RE =
  /\b(?:FROM|JOIN)\s+\{\{\s*source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;

export function parseAliases(documentText: string): AliasSource[] {
  const results: AliasSource[] = [];

  for (const match of documentText.matchAll(REF_ALIAS_RE)) {
    results.push({ kind: 'ref', modelName: match[1], alias: match[2] });
  }

  for (const match of documentText.matchAll(SOURCE_ALIAS_RE)) {
    results.push({ kind: 'source', sourceName: match[1], tableName: match[2], alias: match[3] });
  }

  return results;
}
