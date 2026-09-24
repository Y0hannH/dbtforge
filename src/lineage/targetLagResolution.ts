import type { DependencyGraph } from '../index/graph';
import type { DbtNode } from '../index/manifestTypes';

// A dynamic table declared `target_lag: downstream` defers its schedule to whatever reads it.
// dbt records the word, not the inherited value (see manifestTypes.ts), so the extension can't
// show what that lag actually is. What it can show is whether there is anything to defer to —
// a dynamic table somewhere downstream that names an actual lag rather than deferring further.
// Without one, the node is a dead end: nothing in the DAG ever gives it a schedule to run on.

/** The minimum this needs from a project index — narrow so a test fixture is trivial to build. */
export interface TargetLagLookup {
  getNode(uniqueId: string): DbtNode | undefined;
  getGraph(): DependencyGraph | undefined;
}

/**
 * Whether `nodeId`'s downstream closure contains a dynamic table with a real (non-'downstream')
 * target lag — i.e. whether a `downstream` declaration on `nodeId` has anything to resolve to.
 *
 * Walks child_map once, memoized, so a graph touching the same downstream nodes from several
 * roots (a wide fan-in, or a second dynamic table on the same branch) never re-walks them: each
 * node's answer is computed at most once per call.
 */
export function hasResolvableTargetLag(
  index: TargetLagLookup,
  nodeId: string,
  memo: Map<string, boolean> = new Map(),
): boolean {
  const cached = memo.get(nodeId);
  if (cached !== undefined) return cached;

  // dbt refuses to build a cyclic DAG, so this is a safety net against a malformed manifest,
  // not an expected path — without it, a cycle would recurse forever instead of answering "no".
  memo.set(nodeId, false);

  const graph = index.getGraph();
  let resolvable = false;
  for (const childId of graph?.getChildren(nodeId) ?? []) {
    const child = index.getNode(childId);
    const childLag = child?.config?.target_lag;
    if (child?.config?.materialized === 'dynamic_table' && childLag && childLag !== 'downstream') {
      resolvable = true;
      break;
    }
    if (hasResolvableTargetLag(index, childId, memo)) {
      resolvable = true;
      break;
    }
  }

  memo.set(nodeId, resolvable);
  return resolvable;
}
