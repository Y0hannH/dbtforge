// What `cte.` completes to. Kept apart from the VS Code provider so the one decision that matters —
// when a list of columns is complete enough to show — can be tested without an editor.

import type { SourceRef } from './aliasParser';
import type { CteDefinition } from './cteParser';

export interface CteColumn {
  name: string;
  /** The warehouse type, when the column comes from the catalog. */
  type?: string;
}

/**
 * The columns a CTE exposes, or undefined when they can't be stated in full.
 *
 * A CTE that expands a `*` has the columns the text names plus the ones the star adds, and the
 * second set is only known from the catalog. Showing the first set alone would read as "these are
 * all the columns", which is wrong and hides most of them — so when the expansion can't be resolved
 * (several tables, a join, a macro, a model never built) nothing is offered at all.
 *
 * @param catalogColumns the columns of one model or source as catalog.json knows them, or
 *   undefined when it doesn't
 */
export function resolveCteColumns(
  cte: CteDefinition,
  catalogColumns: (source: SourceRef) => CteColumn[] | undefined,
): CteColumn[] | undefined {
  const named = cte.columns.map((name): CteColumn => ({ name }));

  if (!cte.expansion) return named.length > 0 ? named : undefined;
  if (!cte.expansion.source) return undefined;

  const expanded = catalogColumns(cte.expansion.source);
  if (!expanded) return undefined;

  // Warehouses report their own case (Snowflake upper, others lower) while the text is written
  // however its author types, so `gmv_id` and `GMV_ID` are the same column.
  const seen = new Set(named.map((column) => column.name.toLowerCase()));
  return [...named, ...expanded.filter((column) => !seen.has(column.name.toLowerCase()))];
}
