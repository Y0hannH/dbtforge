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
  | { type: 'openFull' }
  // The larger view's selector field: run these through `dbt ls` and draw what they select.
  | { type: 'runSelector'; select: string; exclude: string }
  | { type: 'cancelSelector' }
  // Back to the manifest view rooted on the open model.
  | { type: 'clearSelector' };

/** What came of running a selection, as the webview needs to say it. */
export type SelectorOutcome =
  | { status: 'ok'; subgraph: LineageSubgraph; counts: SelectorCounts }
  // Too many to draw: the graph is cleared and the count is the message.
  | { status: 'tooMany'; limit: number; counts: SelectorCounts }
  | { status: 'error'; message: string }
  // The user stopped it, which is not a failure to report.
  | { status: 'cancelled' };

export interface SelectorCounts {
  /** What dbt selected, before anything was left out. */
  matched: number;
  /** What the graph draws, or would draw were it not over the ceiling. */
  drawn: number;
  /** Selected by dbt but absent from the manifest: it is older than the files. */
  missing: number;
  /** Selected, but of a kind the graph never draws (metrics and the like). */
  notDrawn: number;
  /** In the manifest but hidden by the tests toggle or a hidden materialization. */
  filteredOut: number;
}

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
  | { type: 'runStatuses'; statuses: Record<string, RunStatusView> }
  // Answers a selection run, and also a scope change made while a selection is shown (the filters
  // apply to its result), so the scope travels with it just as it does in scopeResult.
  | { type: 'selectorResult'; scope: LineageScope; outcome: SelectorOutcome };

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
  /**
   * The root as a dbt selector, when this view offers the selector field (the larger view, with a
   * way to run dbt). The webview formats the depths itself so the field can follow the toggles.
   */
  selectorRoot?: string;
}
