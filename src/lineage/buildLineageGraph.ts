import type { DbtProjectIndex } from '../index/DbtProjectIndex';

export interface LineageNode {
  id: string;
  name: string;
  resourceType: string;
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

function toLineageNode(index: DbtProjectIndex, id: string, isRoot: boolean): LineageNode | undefined {
  const node = index.getNode(id);
  const graph = index.getGraph();
  if (!node || !graph) return undefined;

  return {
    id,
    name: node.name,
    resourceType: node.resource_type,
    isRoot,
    parentCount: graph.getParents(id).length,
    childCount: graph.getChildren(id).length,
  };
}

/**
 * The initial one-hop neighborhood (direct parents + direct children) around `rootId` — what
 * the webview renders before the user expands anything further. Mirrors the one-hop scope of
 * the Parents/Children/Tests TreeView; the interactive graph is what lets the user go deeper
 * without dumping the whole transitive closure at once.
 */
export function buildInitialSubgraph(index: DbtProjectIndex, rootId: string): LineageSubgraph {
  const graph = index.getGraph();
  const root = toLineageNode(index, rootId, true);
  if (!graph || !root) return { nodes: [], edges: [] };

  const nodes = new Map<string, LineageNode>([[rootId, root]]);
  const edges: LineageEdge[] = [];

  for (const parentId of graph.getParents(rootId)) {
    const parentNode = toLineageNode(index, parentId, false);
    if (!parentNode) continue;
    nodes.set(parentId, parentNode);
    edges.push({ source: parentId, target: rootId });
  }

  for (const childId of graph.getChildren(rootId)) {
    const childNode = toLineageNode(index, childId, false);
    if (!childNode) continue;
    nodes.set(childId, childNode);
    edges.push({ source: rootId, target: childId });
  }

  return { nodes: [...nodes.values()], edges };
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
  direction: 'up' | 'down'
): LineageSubgraph {
  const graph = index.getGraph();
  if (!graph) return { nodes: [], edges: [] };

  const neighborIds = direction === 'up' ? graph.getParents(nodeId) : graph.getChildren(nodeId);
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];

  for (const neighborId of neighborIds) {
    const neighborNode = toLineageNode(index, neighborId, false);
    if (!neighborNode) continue;
    nodes.push(neighborNode);
    edges.push(
      direction === 'up' ? { source: neighborId, target: nodeId } : { source: nodeId, target: neighborId }
    );
  }

  return { nodes, edges };
}
