import type { LineageSubgraph } from './buildLineageGraph';
import type { LineageScope } from './lineageScope';

export type ExpandDirection = 'up' | 'down';

export type WebviewToHostMessage =
  | { type: 'expand'; nodeId: string; direction: ExpandDirection }
  | { type: 'open'; nodeId: string }
  | { type: 'setScope'; scope: LineageScope };

export type HostToWebviewMessage =
  | {
      type: 'expandResult';
      nodeId: string;
      direction: ExpandDirection;
      subgraph: LineageSubgraph;
    }
  // A scope change rebuilds the graph from the root rather than adding to it, so the webview
  // replaces its node set wholesale — including the record of what had been expanded by hand.
  | { type: 'scopeResult'; scope: LineageScope; subgraph: LineageSubgraph };

/** Everything the webview needs at first paint, serialized into the page by the host. */
export interface LineageBootstrap {
  rootId: string;
  rootName: string;
  scope: LineageScope;
  subgraph: LineageSubgraph;
  /** Materializations present in this project, to populate the exclusion chips. */
  materializations: string[];
}
