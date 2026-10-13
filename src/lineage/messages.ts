import type { LineageSubgraph } from './buildLineageGraph';
import type { LineageLocation } from './lineagePlacement';
import type { LineageScope } from './lineageScope';
import type { RunStatusView } from './runStatus';

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
  | { type: 'scopeResult'; scope: LineageScope; subgraph: LineageSubgraph }
  // A dbt run finished while the graph was open. Sent on its own, not folded into a rebuilt
  // subgraph, so what the user had expanded by hand stays as it was.
  | { type: 'runStatuses'; statuses: Record<string, RunStatusView> };

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
  /** The last run's outcome per node, by unique_id — only for nodes with something to say. */
  runStatuses: Record<string, RunStatusView>;
}
