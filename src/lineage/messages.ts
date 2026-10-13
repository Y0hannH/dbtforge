import type { LineageSubgraph } from './buildLineageGraph';
import type { LineageLocation } from './lineagePlacement';
import type { LineageScope } from './lineageScope';

export type ExpandDirection = 'up' | 'down';

export type WebviewToHostMessage =
  | { type: 'expand'; nodeId: string; direction: ExpandDirection }
  | { type: 'open'; nodeId: string }
  | { type: 'setScope'; scope: LineageScope }
  // From the bottom panel: draw this lineage again in an editor tab, where there is room for it.
  | { type: 'openFull' };

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
  /**
   * Where this webview is hosted. The graph is the same in both; what differs is the room it has,
   * and so which controls are worth drawing (a minimap in the tab, a way to reach the tab from
   * the panel).
   */
  placement: LineageLocation;
  scope: LineageScope;
  subgraph: LineageSubgraph;
  /** Materializations present in this project, to populate the exclusion chips. */
  materializations: string[];
}
