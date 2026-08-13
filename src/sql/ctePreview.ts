// Builds the query that previews one CTE of a model, which is the whole point of the feature:
// inspecting an intermediate step without commenting out the rest of the file.
//
// The model is truncated just after the chosen CTE's closing parenthesis and given a new final
// SELECT that reads from it. Everything before it is kept verbatim — earlier CTEs because the
// chosen one may depend on them, and whatever precedes the WITH clause (a `{{ config() }}`, a
// `{% set %}`) because the rest of the query may depend on that.
//
// Later CTEs are dropped, which is safe: a non-recursive CTE can only reference ones declared
// before it, so nothing kept can refer to anything removed.

import { parseCtes } from './cteParser';

/**
 * The preview query for `cteName`, or undefined when the model's CTEs can't be parsed or none
 * carries that name — in which case the caller must not run anything.
 */
export function buildCtePreviewSql(modelSql: string, cteName: string): string | undefined {
  const cte = parseCtes(modelSql).find((candidate) => candidate.name === cteName);
  if (!cte) return undefined;

  const upToCte = modelSql.slice(0, cte.bodyEnd + 1);

  // The name is re-emitted exactly as written: a bracketed or quoted CTE has to be referenced the
  // same way it was declared, and the dialect's quoting style isn't ours to choose.
  return `${upToCte}\nselect * from ${cte.rawName}`;
}

/** CTE names in declaration order, for placing one preview action on each. */
export function listCteNames(modelSql: string): string[] {
  return parseCtes(modelSql).map((cte) => cte.name);
}
