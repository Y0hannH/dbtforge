// Works around dbt-fabric's `fabric__get_limit_sql`, which appends its limit clause to the model's
// own SQL instead of wrapping it:
//
//     {{ sql }} order by (select null) offset 0 rows fetch first {{ limit }} rows only
//
// On a `SELECT DISTINCT` that is invalid — SQL Server rejects an ORDER BY whose items aren't in the
// select list (error 145), because after deduplication the sort key has no single value per row.
// Every DISTINCT model on the SQL Server family is therefore unpreviewable through `--limit`.
//
// The fix is to stop asking dbt to limit (`--limit -1` leaves the SQL untouched) and to carry the
// limit ourselves via T-SQL's own primitive, TOP, which needs no ORDER BY at all. The final SELECT
// becomes a derived table so that DISTINCT — and UNION, and anything else — is contained:
//
//     with a as (...)                     -- CTEs stay at the top level, where T-SQL requires them
//     select top 100 * from ( select distinct ... ) as dbtforge_preview
//
// Applied only to models that would otherwise fail, so everything else keeps the ordinary
// `--select` path along with the model config that `--inline` would drop.

import { parseModelSql } from '../sql/cteParser';

const SUBQUERY_ALIAS = 'dbtforge_preview';

/** Adapters whose `get_limit_sql` appends the clause rather than wrapping. */
const TSQL_ADAPTERS = new Set(['fabric', 'sqlserver', 'synapse']);

export function isTsqlAdapter(adapterType: string): boolean {
  return TSQL_ADAPTERS.has(adapterType.trim().toLowerCase());
}

/**
 * True when this model's final SELECT would collide with the appended ORDER BY. Deliberately
 * narrow: it answers "will dbt's limit clause break this", not "is this SQL unusual".
 */
export function needsTopRewrite(sql: string): boolean {
  return parseModelSql(sql).isDistinct;
}

/**
 * Rewrites the model so it carries its own TOP limit, or returns undefined when the structure
 * isn't understood well enough to splice safely.
 *
 * Refusing is the correct outcome here: a preview that doesn't render is an annoyance, while a
 * mis-spliced query that loses its limit would pull an entire fact table across the wire.
 */
export function rewriteWithTopLimit(sql: string, limit: number): string | undefined {
  if (!Number.isInteger(limit) || limit < 1) return undefined;

  const parsed = parseModelSql(sql);
  if (parsed.finalSelectStart === -1) return undefined;

  // A derived table cannot contain ORDER BY without its own TOP/OFFSET, so wrapping a query that
  // ends in one would trade error 145 for error 1033. dbt handles that case on its own anyway:
  // its macro skips the dummy sort when the last line already starts with `order by`.
  if (parsed.hasOrderBy) return undefined;

  const prefix = sql.slice(0, parsed.finalSelectStart);
  const finalSelect = stripStatementTerminator(sql.slice(parsed.finalSelectStart));
  if (!finalSelect) return undefined;

  return `${prefix}select top ${limit} * from (\n${finalSelect}\n) as ${SUBQUERY_ALIAS}`;
}

/** A trailing `;` would land inside the derived table and break it. */
function stripStatementTerminator(sql: string): string {
  return sql.replace(/\s*;\s*$/, '').trimEnd();
}
