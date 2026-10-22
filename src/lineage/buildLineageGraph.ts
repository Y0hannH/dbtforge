import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import type { DependencyGraph } from '../index/graph';
import type {
  DbtExposureNode,
  DbtNode,
  DbtSourceNode,
  LineageEntity,
} from '../index/manifestTypes';
import { isLatestVersion, versionedName } from '../index/modelVersions';
import type { LineageScope } from './lineageScope';
import { canDescend, DEFAULT_SCOPE, isInScope } from './lineageScope';
import { MAX_SELECTION_NODES } from './lineageSelection';
import { nodeMetaLabel, readNodeColor } from './nodeDisplay';
import type { InheritedTargetLag } from './targetLagResolution';
import { isDownstreamLag, resolveInheritedTargetLag } from './targetLagResolution';

export interface LineageNode {
  id: string;
  name: string;
  resourceType: string;
  /** Resource type, materialization, target lag and column count — formatted for the row above
   * the name; see nodeDisplay for what is included and when. */
  metaLabel: string;
  /** The project's own `node_color`, validated — see nodeDisplay. */
  color?: string;
  isRoot: boolean;
  parentCount: number;
  childCount: number;
}

export interface LineageEdge {
  source: string; // parent id
  target: string; // child id
}

export interface LineageSubgraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

type Direction = 'up' | 'down';

/**
 * The neighbours of `id` that the current scope actually shows. Everything else in this file
 * goes through here, so a filtered-out node can never leak in as a node, an edge, or a count.
 */
function neighborsInScope(
  index: DbtProjectIndex,
  graph: DependencyGraph,
  id: string,
  direction: Direction,
  scope: LineageScope,
): string[] {
  const neighbors = direction === 'up' ? graph.getParents(id) : graph.getChildren(id);
  return neighbors.filter((neighborId) => {
    const node = index.getLineageEntity(neighborId);
    return node !== undefined && isInScope(node, scope);
  });
}

// `DbtNode.resource_type` is an open string, so a plain `=== 'source'` check does not narrow the
// union; these guards do.
function isSource(entity: LineageEntity): entity is DbtSourceNode {
  return entity.resource_type === 'source';
}

function isExposure(entity: LineageEntity): entity is DbtExposureNode {
  return entity.resource_type === 'exposure';
}

function isBuiltNode(entity: LineageEntity): entity is DbtNode {
  return !isSource(entity) && !isExposure(entity);
}

/**
 * A source table is only unique together with its source (`raw.customers`), and two sources
 * routinely share a table name — so the bare name would draw two identical-looking boxes.
 */
function displayName(entity: LineageEntity): string {
  if (isSource(entity)) return `${entity.source_name}.${entity.name}`;
  // Two versions of a model share a name; without the version they are two identical boxes.
  return isBuiltNode(entity) ? versionedName(entity) : entity.name;
}

function toLineageNode(
  index: DbtProjectIndex,
  id: string,
  isRoot: boolean,
  scope: LineageScope,
  lagMemo: Map<string, InheritedTargetLag>,
): LineageNode | undefined {
  const entity = index.getLineageEntity(id);
  const graph = index.getGraph();
  if (!entity || !graph) return undefined;

  // Sources and exposures are not built by dbt: no materialization, no target lag, no colour to
  // declare. Only the models, seeds and snapshots in `nodes` carry those.
  const node = isBuiltNode(entity) ? entity : undefined;
  const materialization = isExposure(entity) ? entity.type : node?.config?.materialized;
  const targetLag = node?.config?.target_lag;
  const inherited =
    materialization === 'dynamic_table' && isDownstreamLag(targetLag)
      ? resolveInheritedTargetLag(index, id, lagMemo)
      : undefined;

  return {
    id,
    name: displayName(entity),
    resourceType: entity.resource_type,
    metaLabel: nodeMetaLabel(entity.resource_type, {
      // For an exposure this is its kind ('dashboard'), which the row renders the same way:
      // `exposure · dashboard`, as `model · view` says what a model is.
      materialization,
      targetLag,
      // Said only of the version a bare ref() goes to; the others carry no mark, so the one that
      // is latest is the one that stands out.
      latestVersion: node ? isLatestVersion(node) === true : undefined,
      stateChange: index.getStateChange(id)?.kind,
      // The catalog, not the manifest: the manifest only carries the columns someone documented
      // in a .yml, so counting those would confidently report 4 on a 60-column model. Absent
      // until `dbt docs generate` has run, and absent for anything never built — in both cases
      // the label simply says nothing rather than guessing a number.
      columnCount: index.getCatalogColumns(id)?.length,
      // Only worth walking the downstream closure for the one case it can answer: a dynamic
      // table that has deferred its schedule.
      targetLagUnresolved: inherited ? inherited.kind === 'dead-end' : undefined,
      inheritedTargetLag: inherited?.kind === 'lag' ? inherited.text : undefined,
    }),
    color: node ? readNodeColor(node) : undefined,
    isRoot,
    // Counted after filtering, because the count is a promise: the expand button says how many
    // nodes a click will reveal. Counting raw neighbours made it promise the hidden tests too.
    parentCount: neighborsInScope(index, graph, id, 'up', scope).length,
    childCount: neighborsInScope(index, graph, id, 'down', scope).length,
  };
}

/**
 * Walks `limit` hops in one direction from the root, breadth-first, collecting nodes and edges.
 *
 * Edges are recorded even when they lead to an already-collected node, so a diamond in the DAG
 * keeps both of its sides; nodes are only enqueued once, which is also what stops an unlimited
 * walk from ever revisiting.
 */
function walk(
  index: DbtProjectIndex,
  graph: DependencyGraph,
  rootId: string,
  direction: Direction,
  limit: number,
  scope: LineageScope,
  nodes: Map<string, LineageNode>,
  edges: Map<string, LineageEdge>,
  lagMemo: Map<string, InheritedTargetLag>,
): void {
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  let depth = 0;

  while (frontier.length > 0 && canDescend(depth, limit)) {
    const nextFrontier: string[] = [];

    for (const id of frontier) {
      for (const neighborId of neighborsInScope(index, graph, id, direction, scope)) {
        const edge: LineageEdge =
          direction === 'up'
            ? { source: neighborId, target: id }
            : { source: id, target: neighborId };
        edges.set(`${edge.source}->${edge.target}`, edge);

        if (seen.has(neighborId)) continue;
        seen.add(neighborId);

        const node = toLineageNode(index, neighborId, false, scope, lagMemo);
        if (!node) continue;
        if (!nodes.has(neighborId)) nodes.set(neighborId, node);
        nextFrontier.push(neighborId);
      }
    }

    frontier = nextFrontier;
    depth += 1;
  }
}

/**
 * The subgraph around `rootId` described by `scope` — `N` hops of parents, `M` hops of children,
 * minus whatever the scope filters out. This is the local answer to a selector like `3+model+1`,
 * computed entirely from the manifest's `parent_map`/`child_map`.
 *
 * The root is always included, even when the scope would filter it out: it is the file the user
 * has open, and answering "nothing to display" for a model you are looking at is never useful.
 */
export function buildScopedSubgraph(
  index: DbtProjectIndex,
  rootId: string,
  scope: LineageScope = DEFAULT_SCOPE,
): LineageSubgraph {
  const graph = index.getGraph();
  const lagMemo = new Map<string, InheritedTargetLag>();
  const root = toLineageNode(index, rootId, true, scope, lagMemo);
  if (!graph || !root) return { nodes: [], edges: [] };

  const nodes = new Map<string, LineageNode>([[rootId, root]]);
  const edges = new Map<string, LineageEdge>();

  walk(index, graph, rootId, 'up', scope.upstreamDepth, scope, nodes, edges, lagMemo);
  walk(index, graph, rootId, 'down', scope.downstreamDepth, scope, nodes, edges, lagMemo);

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export type SelectionSubgraph =
  | { kind: 'ok'; subgraph: LineageSubgraph; filteredOut: number }
  | { kind: 'tooMany'; nodeCount: number; filteredOut: number };

/**
 * The graph of a selection `dbt ls` returned: exactly those nodes, joined by the manifest's edges
 * between them and by no others.
 *
 * Nothing is expandable. A node's neighbours outside the selection are not part of what the user
 * asked to see, and an expand button would quietly turn the result of a query back into a walk.
 * That also means two unrelated matches are two islands, which is what the selection says.
 *
 * `scope` still filters — tests and hidden materializations stay display choices rather than
 * something the user must rewrite into the selection — but its depths do not apply: the selection
 * has already decided how far to reach.
 */
export function buildSelectionSubgraph(
  index: DbtProjectIndex,
  matchedIds: string[],
  scope: LineageScope,
  limit: number = MAX_SELECTION_NODES,
): SelectionSubgraph {
  const graph = index.getGraph();
  const shown = matchedIds.filter((id) => {
    const entity = index.getLineageEntity(id);
    return entity !== undefined && isInScope(entity, scope);
  });
  const filteredOut = matchedIds.length - shown.length;

  if (!graph) return { kind: 'ok', subgraph: { nodes: [], edges: [] }, filteredOut };
  if (shown.length > limit) return { kind: 'tooMany', nodeCount: shown.length, filteredOut };

  const shownSet = new Set(shown);
  const lagMemo = new Map<string, InheritedTargetLag>();
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];

  for (const id of shown) {
    const node = toLineageNode(index, id, false, scope, lagMemo);
    if (!node) continue;
    nodes.push({ ...node, parentCount: 0, childCount: 0 });

    for (const parentId of graph.getParents(id)) {
      if (shownSet.has(parentId)) edges.push({ source: parentId, target: id });
    }
  }

  return { kind: 'ok', subgraph: { nodes, edges }, filteredOut };
}

/**
 * What the view opens on: one hop each way, tests hidden. Mirrors the Parents/Children/Tests
 * panel, and stays the starting point the graph expands out from rather than a whole DAG dump.
 */
export function buildInitialSubgraph(index: DbtProjectIndex, rootId: string): LineageSubgraph {
  return buildScopedSubgraph(index, rootId, DEFAULT_SCOPE);
}

/**
 * One more hop of parents ('up') or children ('down') around `nodeId`, fetched on demand when
 * the user clicks a node's expand affordance in the webview. The webview is responsible for
 * deduping against nodes/edges it already has — this always returns the full immediate
 * neighborhood regardless of what's already been revealed.
 */
export function expandNode(
  index: DbtProjectIndex,
  nodeId: string,
  direction: Direction,
  scope: LineageScope = DEFAULT_SCOPE,
): LineageSubgraph {
  const graph = index.getGraph();
  if (!graph) return { nodes: [], edges: [] };

  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const lagMemo = new Map<string, InheritedTargetLag>();

  for (const neighborId of neighborsInScope(index, graph, nodeId, direction, scope)) {
    const neighborNode = toLineageNode(index, neighborId, false, scope, lagMemo);
    if (!neighborNode) continue;
    nodes.push(neighborNode);
    edges.push(
      direction === 'up'
        ? { source: neighborId, target: nodeId }
        : { source: nodeId, target: neighborId },
    );
  }

  return { nodes, edges };
}
