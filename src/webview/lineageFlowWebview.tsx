import dagre from 'dagre';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import './lineageFlow.css';
import type { LineageEdge, LineageNode, LineageSubgraph } from '../lineage/buildLineageGraph';
import type { ExpandDirection, HostToWebviewMessage, WebviewToHostMessage } from '../lineage/messages';
import { lineageNodeWidth, NODE_HEIGHT } from '../lineage/nodeSize';

declare global {
  interface Window {
    __DBT_FORGE_ROOT_ID__?: string;
    __DBT_FORGE_INITIAL_GRAPH__?: LineageSubgraph;
  }
  function acquireVsCodeApi(): { postMessage(message: WebviewToHostMessage): void };
}

const vscode = acquireVsCodeApi();

interface LineageNodeViewData extends LineageNode {
  /** Same width dagre reserved for this node — see nodeSize. */
  width: number;
  expandedUp: boolean;
  expandedDown: boolean;
  pendingUp: boolean;
  pendingDown: boolean;
  onExpand: (nodeId: string, direction: ExpandDirection) => void;
  onOpen: (nodeId: string) => void;
}

function LineageNodeView({ id, data }: NodeProps<LineageNodeViewData>) {
  const showUpButton = data.parentCount > 0 && !data.expandedUp;
  const showDownButton = data.childCount > 0 && !data.expandedDown;

  return (
    <div
      className={`lineage-node${data.isRoot ? ' is-root' : ''}`}
      // The project's node_color paints a stripe rather than the border: the border already
      // carries the root highlight, and overriding it would make the two indistinguishable.
      style={{ width: data.width, borderLeftColor: data.color, borderLeftWidth: data.color ? 5 : undefined }}
      onClick={() => data.onOpen(id)}
    >
      {showUpButton && (
        <button
          className="lineage-expand-btn lineage-expand-left"
          disabled={data.pendingUp}
          onClick={(event) => {
            event.stopPropagation();
            data.onExpand(id, 'up');
          }}
          title={`Show ${data.parentCount} parent${data.parentCount > 1 ? 's' : ''}`}
        >
          {data.pendingUp ? '…' : `◀ ${data.parentCount}`}
        </button>
      )}
      <Handle type="target" position={Position.Left} />
      <span className="lineage-node-type">{data.metaLabel}</span>
      {/* A name past MAX_NODE_WIDTH is ellipsized, so it has to stay readable on hover. */}
      <span className="lineage-node-name" title={data.name}>
        {data.name}
      </span>
      <Handle type="source" position={Position.Right} />
      {showDownButton && (
        <button
          className="lineage-expand-btn lineage-expand-right"
          disabled={data.pendingDown}
          onClick={(event) => {
            event.stopPropagation();
            data.onExpand(id, 'down');
          }}
          title={`Show ${data.childCount} child${data.childCount > 1 ? 'ren' : ''}`}
        >
          {data.pendingDown ? '…' : `${data.childCount} ▶`}
        </button>
      )}
    </div>
  );
}

const NODE_TYPES = { lineageNode: LineageNodeView };

function layoutGraph(
  rawNodes: Map<string, LineageNode>,
  rawEdges: Map<string, LineageEdge>,
  expandedUp: Set<string>,
  expandedDown: Set<string>,
  pending: Set<string>,
  onExpand: (nodeId: string, direction: ExpandDirection) => void,
  onOpen: (nodeId: string) => void
): { nodes: Node<LineageNodeViewData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));

  // Every node is measured from its own name. A single fixed width used to be handed to dagre
  // while the box itself grew to fit its text, so a long-named model overflowed the slot dagre
  // had reserved and landed on top of the next rank.
  const widths = new Map(
    [...rawNodes.values()].map((n) => [n.id, lineageNodeWidth(n.name, n.metaLabel)])
  );

  for (const id of rawNodes.keys()) g.setNode(id, { width: widths.get(id), height: NODE_HEIGHT });
  for (const edge of rawEdges.values()) g.setEdge(edge.source, edge.target);

  dagre.layout(g);

  // dagre centres every node of a rank on the same x. Once widths vary that reads as a ragged
  // column, so each rank is aligned on its left edge — the side the incoming edges arrive at.
  const rankLeft = new Map<number, number>();
  for (const id of rawNodes.keys()) {
    const centre = Math.round(g.node(id).x);
    const left = centre - (widths.get(id) ?? 0) / 2;
    rankLeft.set(centre, Math.min(rankLeft.get(centre) ?? left, left));
  }

  const nodes: Node<LineageNodeViewData>[] = [...rawNodes.values()].map((n) => {
    const pos = g.node(n.id);
    const width = widths.get(n.id) ?? 0;
    return {
      id: n.id,
      type: 'lineageNode',
      // dagre reports a node's centre; React Flow positions by its top-left corner.
      position: { x: rankLeft.get(Math.round(pos.x)) ?? pos.x - width / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        ...n,
        width,
        expandedUp: n.parentCount === 0 || expandedUp.has(n.id),
        expandedDown: n.childCount === 0 || expandedDown.has(n.id),
        pendingUp: pending.has(`${n.id}:up`),
        pendingDown: pending.has(`${n.id}:down`),
        onExpand,
        onOpen,
      },
    };
  });

  const edges: Edge[] = [...rawEdges.values()].map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
  }));

  return { nodes, edges };
}

function Flow({ nodes, edges }: { nodes: Node<LineageNodeViewData>[]; edges: Edge[] }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 50);
    return () => clearTimeout(timer);
  }, [nodes.length, edges.length, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      proOptions={{ hideAttribution: true }}
      minZoom={0.1}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
    >
      <Background />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}

function App() {
  const rootId = window.__DBT_FORGE_ROOT_ID__ ?? '';
  const initial = window.__DBT_FORGE_INITIAL_GRAPH__ ?? { nodes: [], edges: [] };

  const [rawNodes, setRawNodes] = useState<Map<string, LineageNode>>(
    () => new Map(initial.nodes.map((n) => [n.id, n]))
  );
  const [rawEdges, setRawEdges] = useState<Map<string, LineageEdge>>(
    () => new Map(initial.edges.map((e) => [`${e.source}->${e.target}`, e]))
  );
  const [expandedUp, setExpandedUp] = useState<Set<string>>(new Set());
  const [expandedDown, setExpandedDown] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  const handleExpand = useCallback((nodeId: string, direction: ExpandDirection) => {
    setPending((prev) => new Set(prev).add(`${nodeId}:${direction}`));
    vscode.postMessage({ type: 'expand', nodeId, direction });
  }, []);

  const handleOpen = useCallback((nodeId: string) => {
    vscode.postMessage({ type: 'open', nodeId });
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent<HostToWebviewMessage>) {
      const message = event.data;
      if (message.type !== 'expandResult') return;

      setRawNodes((prev) => {
        const next = new Map(prev);
        for (const n of message.subgraph.nodes) {
          if (!next.has(n.id)) next.set(n.id, n);
        }
        return next;
      });
      setRawEdges((prev) => {
        const next = new Map(prev);
        for (const e of message.subgraph.edges) {
          next.set(`${e.source}->${e.target}`, e);
        }
        return next;
      });
      if (message.direction === 'up') {
        setExpandedUp((prev) => new Set(prev).add(message.nodeId));
      } else {
        setExpandedDown((prev) => new Set(prev).add(message.nodeId));
      }
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(`${message.nodeId}:${message.direction}`);
        return next;
      });
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const { nodes, edges } = useMemo(
    () => layoutGraph(rawNodes, rawEdges, expandedUp, expandedDown, pending, handleExpand, handleOpen),
    [rawNodes, rawEdges, expandedUp, expandedDown, pending, handleExpand, handleOpen]
  );

  if (!rootId || rawNodes.size === 0) {
    return <div style={{ padding: 16 }}>No lineage to display.</div>;
  }

  return (
    <ReactFlowProvider>
      <Flow nodes={nodes} edges={edges} />
    </ReactFlowProvider>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
