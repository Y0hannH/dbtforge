import type { DbtNode } from '../index/manifestTypes';

/**
 * How much of the DAG the lineage view is currently showing, and what it leaves out.
 *
 * This is the local half of dbt's node selection: `3+model+1` is a pair of depths, and excluding
 * tests or a materialization is a filter on properties every node already carries in the manifest.
 * Nothing here needs dbt to run — it is all `parent_map` / `child_map` and `config`, which is why
 * the controls can react on every keystroke instead of shelling out to `dbt ls`.
 */

/** Depth meaning "every hop in this direction". JSON can't carry Infinity, hence a sentinel. */
export const UNLIMITED_DEPTH = -1;

export interface LineageScope {
  /** Hops of parents to walk from the root. */
  upstreamDepth: number;
  /** Hops of children to walk from the root. */
  downstreamDepth: number;
  /** Tests are children of the node they test, so they arrive in the graph like any other child. */
  includeTests: boolean;
  /** Materializations to leave out, matched against `config.materialized`. */
  excludedMaterializations: string[];
}

/**
 * One hop each way, tests hidden.
 *
 * Tests are excluded by default because they are children in `child_map` and were therefore
 * being drawn as ordinary nodes — a model with six tests rendered as a model with six children,
 * and the expand button counted them. The graph is for reading data flow; the tests on a model
 * are already one click away in the Parents/Children/Tests panel.
 */
export const DEFAULT_SCOPE: LineageScope = {
  upstreamDepth: 1,
  downstreamDepth: 1,
  includeTests: false,
  excludedMaterializations: [],
};

/**
 * Whether a node is shown under `scope`.
 *
 * A hidden node is not traversed through either, which is how dbt's own `--exclude` behaves: the
 * node drops out, and so does anything only reachable through it. That is the predictable rule
 * rather than the clever one — and for tests, the case this exists for, nothing is ever lost,
 * since a test is always a leaf.
 */
export function isInScope(node: DbtNode, scope: LineageScope): boolean {
  if (!scope.includeTests && node.resource_type === 'test') return false;
  const materialized = node.config?.materialized;
  return !(materialized !== undefined && scope.excludedMaterializations.includes(materialized));
}

/** Whether a walk that has already taken `depth` hops may take one more. */
export function canDescend(depth: number, limit: number): boolean {
  return limit === UNLIMITED_DEPTH || depth < limit;
}

/**
 * A scope that came in over the webview message channel, coerced back into something safe to
 * walk with: depths are integers ≥ 0 (or the unlimited sentinel), and the exclusion list is
 * strings. The webview is trusted code, but it is still a separate document posting JSON.
 */
export function sanitizeScope(raw: Partial<LineageScope> | undefined): LineageScope {
  if (!raw) return DEFAULT_SCOPE;
  return {
    upstreamDepth: sanitizeDepth(raw.upstreamDepth, DEFAULT_SCOPE.upstreamDepth),
    downstreamDepth: sanitizeDepth(raw.downstreamDepth, DEFAULT_SCOPE.downstreamDepth),
    includeTests: raw.includeTests === true,
    excludedMaterializations: Array.isArray(raw.excludedMaterializations)
      ? raw.excludedMaterializations.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

function sanitizeDepth(value: unknown, fallback: number): number {
  if (value === UNLIMITED_DEPTH) return UNLIMITED_DEPTH;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return fallback;
  return value;
}
