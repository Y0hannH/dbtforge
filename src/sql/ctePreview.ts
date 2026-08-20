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

/**
 * The CTE containing `offset`, for a keyboard preview that follows the cursor — or undefined when
 * it sits outside every CTE, which is the signal to preview the whole model instead.
 *
 * A CTE owns everything from its name to its closing parenthesis, so the declaration line counts
 * as inside it: that is where the Preview CTE action is drawn, and pressing the shortcut there has
 * to mean the same thing as clicking it. Only top-level CTEs are addressable, so a cursor in a
 * nested one resolves to the enclosing CTE — the innermost thing that can actually be previewed.
 */
export function cteNameAtOffset(modelSql: string, offset: number): string | undefined {
  const containing = parseCtes(modelSql).find(
    (cte) => offset >= cte.nameStart && offset <= cte.bodyEnd
  );
  return containing?.name;
}
