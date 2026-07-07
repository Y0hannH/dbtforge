import type { LineageSubgraph } from './buildLineageGraph';

export type ExpandDirection = 'up' | 'down';

export type WebviewToHostMessage =
  | { type: 'expand'; nodeId: string; direction: ExpandDirection }
  | { type: 'open'; nodeId: string };

export interface HostToWebviewMessage {
  type: 'expandResult';
  nodeId: string;
  direction: ExpandDirection;
  subgraph: LineageSubgraph;
}
