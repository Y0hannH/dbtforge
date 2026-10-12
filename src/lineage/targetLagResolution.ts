import type { DependencyGraph } from '../index/graph';
import type { DbtNode } from '../index/manifestTypes';

// A dynamic table declared `target_lag: downstream` has no schedule of its own: Snowflake refreshes
// it as often as the most demanding table that reads it needs. dbt records the word, not the
// inherited value (see manifestTypes.ts), but the rule is documented and the inputs are all
// declared in the project, so the shortest lag downstream can be read off the DAG.
//
// It is an upper bound, never an exact value: the manifest only knows the consumers dbt builds, and
// a dynamic table created by hand or read by another project can only make the real lag shorter.
// Callers therefore show it as "at most", and anything that can't be read with confidence falls back
// to saying nothing rather than to a plausible number.

/** The minimum this needs from a project index — narrow so a test fixture is trivial to build. */
export interface TargetLagLookup {
  getNode(uniqueId: string): DbtNode | undefined;
  getGraph(): DependencyGraph | undefined;
}

/**
 * What a `downstream` declaration resolves to, from the nodes dbt builds:
 * - `lag`: the shortest declared lag reachable downstream, with its text as the project wrote it.
 * - `dead-end`: nothing downstream names a lag, so nothing ever gives this table a schedule.
 * - `unreadable`: a lag exists downstream but at least one can't be read as a duration, so no
 *   minimum can be claimed — the same "say nothing" as before any of this was computed.
 */
export type InheritedTargetLag =
  { kind: 'lag'; text: string; seconds: number } | { kind: 'dead-end' } | { kind: 'unreadable' };

const DEAD_END: InheritedTargetLag = { kind: 'dead-end' };
const UNREADABLE: InheritedTargetLag = { kind: 'unreadable' };

const SECONDS_PER_UNIT: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
};

// Snowflake's grammar is `<num> { seconds | minutes | hours | days }`. Anything else — a decimal,
// a Jinja expression that was never rendered, a unit it doesn't know — is not read, because a
// guessed duration would be compared against real ones and could win the minimum.
const DURATION = /^(\d+)\s+(second|minute|hour|day)s?$/i;

/** `'10 minutes'` → 600, or undefined when the text isn't a duration Snowflake accepts. */
export function parseTargetLagSeconds(raw: string): number | undefined {
  const match = DURATION.exec(raw.trim());
  if (!match) return undefined;
  return Number(match[1]) * SECONDS_PER_UNIT[match[2].toLowerCase()];
}

/** Snowflake takes the keyword in any case, and dbt passes the project's text through verbatim. */
export function isDownstreamLag(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === 'downstream';
}

/**
 * The lag `nodeId` inherits when it is declared `downstream`: the shortest lag among the dynamic
 * tables that read it, directly or through plain tables and views.
 *
 * The walk stops at a dynamic table with a real lag — that table's own schedule is what its
 * upstream serves, whatever is further down. A `downstream` table in between is walked through,
 * since it passes its own effective lag up.
 *
 * Memoized, so a graph touching the same downstream nodes from several roots (a wide fan-in, or a
 * second dynamic table on the same branch) never re-walks them: each node's answer is computed at
 * most once per memo.
 */
export function resolveInheritedTargetLag(
  index: TargetLagLookup,
  nodeId: string,
  memo: Map<string, InheritedTargetLag> = new Map(),
): InheritedTargetLag {
  const cached = memo.get(nodeId);
  if (cached) return cached;

  // dbt refuses to build a cyclic DAG, so this is a safety net against a malformed manifest,
  // not an expected path — without it, a cycle would recurse forever instead of answering "no".
  memo.set(nodeId, DEAD_END);

  const graph = index.getGraph();
  let shortest: { text: string; seconds: number } | undefined;
  let sawUnreadable = false;

  for (const childId of graph?.getChildren(nodeId) ?? []) {
    const child = index.getNode(childId);
    const childLag = child?.config?.target_lag?.trim();

    let candidate: InheritedTargetLag;
    if (child?.config?.materialized === 'dynamic_table' && childLag && !isDownstreamLag(childLag)) {
      const seconds = parseTargetLagSeconds(childLag);
      candidate = seconds === undefined ? UNREADABLE : { kind: 'lag', text: childLag, seconds };
    } else {
      candidate = resolveInheritedTargetLag(index, childId, memo);
    }

    if (candidate.kind === 'unreadable') {
      sawUnreadable = true;
    } else if (candidate.kind === 'lag' && (!shortest || candidate.seconds < shortest.seconds)) {
      shortest = { text: candidate.text, seconds: candidate.seconds };
    }
  }

  // A lag that couldn't be read might have been the shortest one, so a minimum over the others
  // would be a claim the manifest doesn't support.
  let resolved: InheritedTargetLag = DEAD_END;
  if (sawUnreadable) resolved = UNREADABLE;
  else if (shortest) resolved = { kind: 'lag', ...shortest };

  memo.set(nodeId, resolved);
  return resolved;
}
