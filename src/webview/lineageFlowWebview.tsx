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
import type { LineageEdge, LineageNode } from '../lineage/buildLineageGraph';
import { UNLIMITED_DEPTH, type LineageScope } from '../lineage/lineageScope';
import type {
  ExpandDirection,
  HostToWebviewMessage,
  LineageBootstrap,
  WebviewToHostMessage,
} from '../lineage/messages';
import { lineageNodeWidth, NODE_HEIGHT } from '../lineage/nodeSize';

declare global {
  interface Window {
    __DBT_FORGE_LINEAGE__?: LineageBootstrap;
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

/**
 * Below this many nodes the graph fits the viewport on its own, and the minimap is a shrunken
 * copy of what is already fully visible. The initial view is one hop — typically 3 to 8 nodes —
 * so without this the minimap spends most of its life adding nothing but occupying a corner.
 */
const MINIMAP_MIN_NODES = 10;

/**
 * VS Code publishes its theme as CSS custom properties on the document root, but React Flow
 * writes the minimap's colours as SVG presentation attributes, where `var()` is not substituted.
 * So the values have to be read back as real colours.
 */
function readThemeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * `rgba()` form of a theme colour, for the same reason: the dimming mask needs transparency, and
 * an attribute value can't carry an opacity from CSS. A theme colour that isn't a plain 6-digit
 * hex falls back to a neutral grey rather than to an opaque mask, which would black out
 * everything outside the viewport.
 */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return `rgba(127, 127, 127, ${alpha})`;
  const value = parseInt(hex[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Bumps whenever VS Code switches theme, which it signals by rewriting the class list on body. */
function useThemeRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setRevision((current) => current + 1));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return revision;
}

const DEPTH_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '0', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '5', value: 5 },
  { label: 'All', value: UNLIMITED_DEPTH },
];

/**
 * The controls for how much of the DAG is drawn: two depths, and what to leave out.
 *
 * Deliberately not a text field for dbt's selector syntax. Every option here resolves against the
 * manifest alone, so the graph redraws instantly; a selector string would eventually have to shell
 * out to `dbt ls` for the methods that aren't pure graph operators, and the control would then be
 * as slow as its slowest case.
 */
function ScopeToolbar({
  scope,
  materializations,
  busy,
  onChange,
}: {
  scope: LineageScope;
  materializations: string[];
  busy: boolean;
  onChange: (next: LineageScope) => void;
}) {
  const toggleMaterialization = (name: string) => {
    const excluded = scope.excludedMaterializations.includes(name);
    onChange({
      ...scope,
      excludedMaterializations: excluded
        ? scope.excludedMaterializations.filter((value) => value !== name)
        : [...scope.excludedMaterializations, name],
    });
  };

  return (
    <div className="lineage-toolbar">
      <label className="lineage-field">
        <span className="lineage-field-label">Upstream</span>
        <select
          value={scope.upstreamDepth}
          disabled={busy}
          onChange={(event) => onChange({ ...scope, upstreamDepth: Number(event.target.value) })}
        >
          {DEPTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="lineage-field">
        <span className="lineage-field-label">Downstream</span>
        <select
          value={scope.downstreamDepth}
          disabled={busy}
          onChange={(event) => onChange({ ...scope, downstreamDepth: Number(event.target.value) })}
        >
          {DEPTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="lineage-check">
        <input
          type="checkbox"
          checked={scope.includeTests}
          disabled={busy}
          onChange={(event) => onChange({ ...scope, includeTests: event.target.checked })}
        />
        <span>Tests</span>
      </label>

      {materializations.length > 0 && (
        <div className="lineage-chips">
          <span className="lineage-field-label">Hide</span>
          {materializations.map((name) => {
            const excluded = scope.excludedMaterializations.includes(name);
            return (
              <button
                key={name}
                type="button"
                className={`lineage-chip${excluded ? ' is-excluded' : ''}`}
                aria-pressed={excluded}
                disabled={busy}
                title={excluded ? `Show ${name} nodes again` : `Hide ${name} nodes`}
                onClick={() => toggleMaterialization(name)}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  // An edge can outlive the node at its other end — a scope change drops nodes but the webview
  // keeps edges it was told about. dagre would invent a node for the missing end and lay out an
  // empty box, so those edges are skipped here and again when the React Flow edges are built.
  for (const edge of rawEdges.values()) {
    if (rawNodes.has(edge.source) && rawNodes.has(edge.target)) g.setEdge(edge.source, edge.target);
  }

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

  const edges: Edge[] = [...rawEdges.values()]
    .filter((e) => rawNodes.has(e.source) && rawNodes.has(e.target))
    .map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
    }));

  return { nodes, edges };
}

function Flow({ nodes, edges }: { nodes: Node<LineageNodeViewData>[]; edges: Edge[] }) {
  const { fitView } = useReactFlow();
  const themeRevision = useThemeRevision();

  const minimap = useMemo(
    () => ({
      node: readThemeColor('--vscode-editor-foreground', '#cccccc'),
      root: readThemeColor('--vscode-focusBorder', '#007acc'),
      mask: withAlpha(readThemeColor('--vscode-editor-background', '#1f1f1f'), 0.62),
    }),
    [themeRevision]
  );

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
      {nodes.length >= MINIMAP_MIN_NODES && (
        <MiniMap
          pannable
          zoomable
          // The project's own node_color first, so a coloured region stays recognisable at minimap
          // scale; the focus colour marks the root, which is what the user is oriented around.
          nodeColor={(node) => {
            const data = node.data as LineageNodeViewData;
            return data.color ?? (data.isRoot ? minimap.root : minimap.node);
          }}
          nodeStrokeWidth={0}
          maskColor={minimap.mask}
        />
      )}
    </ReactFlow>
  );
}

const EMPTY_BOOTSTRAP: LineageBootstrap = {
  rootId: '',
  rootName: '',
  scope: { upstreamDepth: 1, downstreamDepth: 1, includeTests: false, excludedMaterializations: [] },
  subgraph: { nodes: [], edges: [] },
  materializations: [],
};

function App() {
  const bootstrap = window.__DBT_FORGE_LINEAGE__ ?? EMPTY_BOOTSTRAP;

  const [rawNodes, setRawNodes] = useState<Map<string, LineageNode>>(
    () => new Map(bootstrap.subgraph.nodes.map((n) => [n.id, n]))
  );
  const [rawEdges, setRawEdges] = useState<Map<string, LineageEdge>>(
    () => new Map(bootstrap.subgraph.edges.map((e) => [`${e.source}->${e.target}`, e]))
  );
  const [scope, setScope] = useState<LineageScope>(bootstrap.scope);
  const [scopePending, setScopePending] = useState(false);
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

  // The control moves immediately and the graph follows. The host answers from the manifest it
  // already holds in memory, so there is no spinner here — only the controls locking for the
  // instant it takes, which is what stops a second change racing the first.
  const handleScopeChange = useCallback((next: LineageScope) => {
    setScope(next);
    setScopePending(true);
    vscode.postMessage({ type: 'setScope', scope: next });
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent<HostToWebviewMessage>) {
      const message = event.data;

      if (message.type === 'scopeResult') {
        setRawNodes(new Map(message.subgraph.nodes.map((n) => [n.id, n])));
        setRawEdges(new Map(message.subgraph.edges.map((e) => [`${e.source}->${e.target}`, e])));
        // A rescope redraws from the root, so hand-expanded branches are gone and the record of
        // them has to go too — otherwise their expand buttons stay hidden on the new graph.
        setExpandedUp(new Set());
        setExpandedDown(new Set());
        setPending(new Set());
        setScope(message.scope);
        setScopePending(false);
        return;
      }

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

  if (!bootstrap.rootId) {
    return <div className="lineage-empty">No lineage to display.</div>;
  }

  return (
    <div className="lineage-layout">
      <ScopeToolbar
        scope={scope}
        materializations={bootstrap.materializations}
        busy={scopePending}
        onChange={handleScopeChange}
      />
      <div className="lineage-canvas">
        {rawNodes.size <= 1 && scope.upstreamDepth === 0 && scope.downstreamDepth === 0 ? (
          <div className="lineage-empty">
            Only <strong>{bootstrap.rootName}</strong> is in scope. Raise Upstream or Downstream to
            draw its neighbours.
          </div>
        ) : (
          <ReactFlowProvider>
            <Flow nodes={nodes} edges={edges} />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
