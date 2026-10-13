import type { DbtManifest, DbtNode } from './manifestTypes';

/**
 * What differs between the project as it is and a reference manifest — a `main` build, or a CI
 * artefact — for the nodes dbt builds.
 *
 * This is a subset of what dbt's own `state:modified` selects, and it is meant to be. dbt also
 * counts a changed macro a node depends on, a changed relation name or a changed contract; getting
 * every one of those right here would mean re-implementing dbt's comparison, and a node this says
 * nothing about is *not* a claim that dbt would leave it alone. So a mark is only ever a positive:
 * it names a difference that was actually found, and the absence of one means "nothing found".
 */

export type StateChangeKind = 'new' | 'modified' | 'impacted';

export interface StateChange {
  kind: StateChangeKind;
  /** What was found, in words — the tooltip's content. */
  reasons: string[];
}

// What `dbt build --select state:modified` can pick that this knows how to compare. A test has no
// body worth marking, and a source or exposure isn't built.
const COMPARABLE: ReadonlySet<string> = new Set(['model', 'seed', 'snapshot']);

export function compareToReference(
  current: DbtManifest,
  reference: DbtManifest,
): Map<string, StateChange> {
  const changes = new Map<string, StateChange>();

  for (const node of Object.values(current.nodes)) {
    if (!COMPARABLE.has(node.resource_type)) continue;

    const before = reference.nodes[node.unique_id];
    if (!before) {
      changes.set(node.unique_id, { kind: 'new', reasons: ['not in the reference manifest'] });
      continue;
    }

    const reasons = differences(node, before);
    if (reasons.length > 0) changes.set(node.unique_id, { kind: 'modified', reasons });
  }

  addImpacted(changes, current);
  return changes;
}

function differences(now: DbtNode, before: DbtNode): string[] {
  const reasons: string[] = [];

  // Both sides must carry a checksum: its absence is not a difference.
  const nowSum = now.checksum?.checksum;
  const beforeSum = before.checksum?.checksum;
  if (nowSum && beforeSum && nowSum !== beforeSum) {
    reasons.push(now.resource_type === 'seed' ? 'file changed' : 'SQL changed');
  }

  // `unrendered_config` is what dbt itself compares: the config as written, before Jinja is
  // evaluated, so an environment-dependent value doesn't read as a change.
  if (
    now.unrendered_config &&
    before.unrendered_config &&
    stableStringify(now.unrendered_config) !== stableStringify(before.unrendered_config)
  ) {
    reasons.push('config changed');
  }

  return reasons;
}

/**
 * Everything downstream of a change that isn't itself changed — what `state:modified+` would also
 * build. Walked through the manifest's own `child_map`, like the lineage is.
 */
function addImpacted(changes: Map<string, StateChange>, current: DbtManifest): void {
  const childMap = current.child_map ?? {};
  const queue = [...changes.keys()];
  const seen = new Set(queue);

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const child of childMap[id] ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);

      // Tests are children of what they test and are built with it; marking each would bury the
      // models under their own checks.
      if (current.nodes[child]?.resource_type === 'test') continue;
      if (!changes.has(child)) {
        changes.set(child, { kind: 'impacted', reasons: ['downstream of a changed node'] });
      }
    }
  }
}

// JSON.stringify depends on key order, and two manifests written by different dbt runs don't
// promise the same one.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => `${JSON.stringify(key)}:${stableStringify(inner)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
