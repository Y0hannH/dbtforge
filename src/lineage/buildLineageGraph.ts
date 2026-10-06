import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import type { DependencyGraph } from '../index/graph';
import type {
  DbtExposureNode,
  DbtNode,
  DbtSourceNode,
  LineageEntity,
} from '../index/manifestTypes';
import type { LineageScope } from './lineageScope';
import { canDescend, DEFAULT_SCOPE, isInScope } from './lineageScope';
import { nodeMetaLabel, readNodeColor } from './nodeDisplay';
import { hasResolvableTargetLag } from './targetLagResolution';

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
  return isSource(entity) ? `${entity.source_name}.${entity.name}` : entity.name;
}

function toLineageNode(
  index: DbtProjectIndex,
  id: string,
  isRoot: boolean,
  scope: LineageScope,
  lagMemo: Map<string, boolean>,
): LineageNode | undefined {
  const entity = index.getLineageEntity(id);
  const graph = index.getGraph();
  if (!entity || !graph) return undefined;

  // Sources and exposures are not built by dbt: no materialization, no target lag, no colour to
  // declare. Only the models, seeds and snapshots in `nodes` carry those.
  const node = isBuiltNode(entity) ? entity : undefined;
  const materialization = isExposure(entity) ? entity.type : node?.config?.materialized;
  const targetLag = node?.config?.target_lag;

  return {
    id,
    name: displayName(entity),
    resourceType: entity.resource_type,
    metaLabel: nodeMetaLabel(entity.resource_type, {
      // For an exposure this is its kind ('dashboard'), which the row renders the same way:
      // `exposure · dashboard`, as `model · view` says what a model is.
      materialization,
      targetLag,
      // The catalog, not the manifest: the manifest only carries the columns someone documented
      // in a .yml, so counting those would confidently report 4 on a 60-column model. Absent
      // until `dbt docs generate` has run, and absent for anything never built — in both cases
      // the label simply says nothing rather than guessing a number.
      columnCount: index.getCatalogColumns(id)?.length,
      // Only worth walking the downstream closure for the one case it can answer: a dynamic
      // table that has deferred its schedule and may have nothing to defer to.
      targetLagUnresolved:
        materialization === 'dynamic_table' && targetLag === 'downstream'
          ? !hasResolvableTargetLag(index, id, lagMemo)
          : undefined,
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
  lagMemo: Map<string, boolean>,
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
  const lagMemo = new Map<string, boolean>();
  const root = toLineageNode(index, rootId, true, scope, lagMemo);
  if (!graph || !root) return { nodes: [], edges: [] };

  const nodes = new Map<string, LineageNode>([[rootId, root]]);
  const edges = new Map<string, LineageEdge>();

  walk(index, graph, rootId, 'up', scope.upstreamDepth, scope, nodes, edges, lagMemo);
  walk(index, graph, rootId, 'down', scope.downstreamDepth, scope, nodes, edges, lagMemo);

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
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
  const lagMemo = new Map<string, boolean>();

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
