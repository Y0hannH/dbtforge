import type { DbtNode, LineageEntity } from '../index/manifestTypes';
import { nodeSelector } from '../index/modelVersions';
import { type LineageScope, UNLIMITED_DEPTH } from './lineageScope';
import type { SelectorOutcome } from './messages';

/**
 * The other half of dbt's node selection: the part only dbt can resolve (`tag:`, `config.*:`,
 * intersections, exclusions). The larger lineage view runs the user's selection through
 * `dbt ls` and draws what comes back; this is the pure logic around that call.
 */

/**
 * Most nodes the selection view will draw. Past it the graph stops answering anything — it is a
 * hairball — and dagre's layout starts to cost visible time, so the user gets the count and a
 * prompt to narrow the selection instead of a truncated graph that looks complete.
 */
export const MAX_SELECTION_NODES = 300;

/**
 * Kinds of node that `dbt ls` can return but that are not in the manifest's `nodes`, `sources` or
 * `exposures` and have no place in a lineage graph. They are counted apart so that a selection
 * which happens to include a metric doesn't tell the user to recompile.
 */
const NOT_DRAWN_KINDS = new Set(['metric', 'semantic_model', 'saved_query', 'unit_test', 'group']);

/**
 * The selector that picks exactly this node, as dbt would be asked for it: a name, or the
 * defining file for a versioned model (see nodeSelector), `source:<source>.<table>` for a source.
 */
export function rootSelector(entity: LineageEntity): string {
  if (entity.resource_type === 'source') {
    return `source:${(entity as { source_name: string }).source_name}.${entity.name}`;
  }
  if (entity.resource_type === 'exposure') return `exposure:${entity.name}`;
  return nodeSelector(entity as DbtNode);
}

/**
 * The selection the panel's depth choices amount to: `3+orders+1` for three up and one down. This
 * is what the selector field starts with, so the manifest view and the `dbt ls` view read as one
 * continuous thing instead of an empty box.
 *
 * Tests and materializations are not part of it. They are display filters here, and stay filters
 * in the larger view; writing them into the selection would apply them twice.
 */
export function selectorFromScope(root: string, scope: LineageScope): string {
  return `${depthPrefix(scope.upstreamDepth)}${root}${depthSuffix(scope.downstreamDepth)}`;
}

function depthPrefix(depth: number): string {
  if (depth === UNLIMITED_DEPTH) return '+';
  return depth > 0 ? `${depth}+` : '';
}

function depthSuffix(depth: number): string {
  if (depth === UNLIMITED_DEPTH) return '+';
  return depth > 0 ? `+${depth}` : '';
}

export interface SelectionMatches {
  /** Ids the manifest knows, in the order dbt printed them. */
  known: string[];
  /**
   * Ids dbt selected that the manifest has no entry for — the manifest is older than the files
   * `dbt ls` just parsed. Never drawn from a guess; counted so the user can be told to recompile.
   */
  missing: number;
  /** Ids of a kind the graph doesn't draw at all (metrics and the like). */
  notDrawn: number;
}

export function partitionMatches(
  ids: string[],
  isKnown: (id: string) => boolean,
): SelectionMatches {
  const known: string[] = [];
  let missing = 0;
  let notDrawn = 0;

  for (const id of ids) {
    if (isKnown(id)) known.push(id);
    else if (NOT_DRAWN_KINDS.has(id.slice(0, id.indexOf('.')))) notDrawn += 1;
    else missing += 1;
  }

  return { known, missing, notDrawn };
}

export interface SelectorStatus {
  /** `error` is drawn as a failure, `note` as plain information. */
  tone: 'note' | 'error';
  text: string;
}

/**
 * What the line under the selector field says about a settled outcome. Every selected node that
 * the graph does not show is accounted for here, because a count that quietly differs from what
 * dbt reported reads as a bug in the graph.
 */
export function describeSelectorOutcome(outcome: SelectorOutcome): SelectorStatus | undefined {
  switch (outcome.status) {
    case 'cancelled':
      return undefined;

    case 'error':
      return { tone: 'error', text: outcome.message };

    case 'tooMany':
      return {
        tone: 'note',
        text:
          `This selection draws ${outcome.counts.drawn} nodes, and the graph stops at ` +
          `${outcome.limit}. Narrow it — a tighter depth, an exclusion, or the filters above.`,
      };

    case 'ok': {
      const { matched, drawn, missing, notDrawn, filteredOut } = outcome.counts;
      if (matched === 0) return { tone: 'note', text: 'dbt selected no nodes.' };

      const parts = [`${nodes(drawn)} drawn, ${matched} selected by dbt`];
      if (filteredOut > 0) parts.push(`${filteredOut} hidden by the filters above`);
      if (missing > 0) {
        parts.push(
          `${nodes(missing)} not in the manifest, so not drawn — run \`dbt compile\` to bring it up to date`,
        );
      }
      if (notDrawn > 0)
        parts.push(`${notDrawn} of a kind this graph doesn't draw (metrics and the like)`);
      return { tone: 'note', text: `${parts.join(' · ')}.` };
    }
  }
}

function nodes(count: number): string {
  return `${count} node${count === 1 ? '' : 's'}`;
}
