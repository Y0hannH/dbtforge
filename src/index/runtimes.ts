import type { DbtNode } from './manifestTypes';
import type { NodeRunResult } from './runResults';

/** A resource that took time to build, as dbt measured it, with what it is in the manifest. */
export interface BuildRuntime {
  node: DbtNode;
  result: NodeRunResult;
  /** Seconds — `result.executionTime`, known to be there. */
  seconds: number;
}

// What a build produces: the things whose build time someone would set out to shorten. Tests and
// unit tests are left out — they verify a build rather than being one, and a slow test is a
// different conversation from a slow model. Sources, exposures and the semantic layer never run.
const BUILT_TYPES: ReadonlySet<string> = new Set(['model', 'seed', 'snapshot']);

/**
 * Every built resource with a measured time, slowest first. Left out rather than guessed at: a
 * skipped node (dbt records the near-zero time it spent not running it), a result without a
 * time, and a result whose node is no longer in the manifest — there is no file to open for it,
 * and a time for a model that no longer exists is not a starting point for anything.
 */
export function slowestFirst(
  results: ReadonlyMap<string, NodeRunResult>,
  getNode: (uniqueId: string) => DbtNode | undefined,
): BuildRuntime[] {
  const runtimes: BuildRuntime[] = [];
  for (const [uniqueId, result] of results) {
    if (result.outcome === 'skipped' || result.executionTime === undefined) continue;
    const node = getNode(uniqueId);
    if (!node || !BUILT_TYPES.has(node.resource_type)) continue;
    runtimes.push({ node, result, seconds: result.executionTime });
  }
  // Ties broken by unique_id so the list doesn't reshuffle between two refreshes of the same run.
  return runtimes.sort(
    (left, right) =>
      right.seconds - left.seconds || left.node.unique_id.localeCompare(right.node.unique_id),
  );
}
