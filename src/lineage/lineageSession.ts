import * as vscode from 'vscode';

import { DbtLsCancelledError } from '../dbt/lsRunner';
import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import type { DbtNode } from '../index/manifestTypes';
import { versionedName } from '../index/modelVersions';
import { buildScopedSubgraph, buildSelectionSubgraph, expandNode } from './buildLineageGraph';
import type { LineageLocation } from './lineagePlacement';
import type { LineageScope } from './lineageScope';
import { DEFAULT_SCOPE, sanitizeScope } from './lineageScope';
import { MAX_SELECTION_NODES, partitionMatches, rootSelector } from './lineageSelection';
import type {
  HostToWebviewMessage,
  LineageBootstrap,
  SelectorOutcome,
  WebviewToHostMessage,
} from './messages';
import { buildRunStatuses } from './runStatus';

/**
 * Runs a dbt selection and returns the unique ids it selected. Supplied by the extension, which is
 * what knows the venv and the chosen profile; the session only knows what to do with the answer.
 */
export type SelectionRunner = (
  index: DbtProjectIndex,
  select: string,
  exclude: string,
  signal: AbortSignal,
) => Promise<string[]>;

/** What `dbt ls` returned for the selection on screen, kept so the filters can be re-applied. */
interface Selection {
  known: string[];
  matched: number;
  missing: number;
  notDrawn: number;
}

/**
 * One lineage view's behaviour: which node it is rooted on, how much of the DAG it is showing,
 * and what it does with the messages the webview sends.
 *
 * Deliberately independent of *where* the webview lives. An editor tab (WebviewPanel) and a
 * bottom-panel view (WebviewView) are different VS Code objects with no common interface, but
 * both expose a `Webview` — so keeping the logic here is what lets the same lineage run in
 * either placement without a second implementation to keep in sync.
 */
export class LineageSession {
  private scope: LineageScope;
  private selection: Selection | undefined;
  private inFlight: AbortController | undefined;

  constructor(
    private readonly index: DbtProjectIndex,
    readonly rootId: string,
    scope: LineageScope = DEFAULT_SCOPE,
    private readonly runSelection?: SelectionRunner,
  ) {
    this.scope = scope;
  }

  /**
   * Whether the graph is the result of a `dbt ls` selection rather than a walk from the root.
   * Following the active editor must leave such a graph alone: clicking a node opens its file,
   * and retargeting then would throw the selection away the moment it was used.
   */
  get hasSelection(): boolean {
    return this.selection !== undefined;
  }

  /** The depth/exclusion choices in force, so a follow-up session can keep them. */
  get currentScope(): LineageScope {
    return this.scope;
  }

  get rootName(): string {
    const entity = this.index.getLineageEntity(this.rootId);
    if (!entity) return this.rootId;
    return entity.resource_type === 'source' || entity.resource_type === 'exposure'
      ? entity.name
      : versionedName(entity as DbtNode);
  }

  /**
   * An independent session on the same root with the scope as it is now. The panel's lineage and
   * the editor tab opened from it are two graphs the user then moves around separately, so they
   * must not share a scope object that one of them reassigns.
   */
  fork(): LineageSession {
    return new LineageSession(this.index, this.rootId, this.scope, this.runSelection);
  }

  bootstrap(placement: LineageLocation): LineageBootstrap {
    const root = this.index.getLineageEntity(this.rootId);
    return {
      rootId: this.rootId,
      rootName: this.rootName,
      placement,
      scope: this.scope,
      subgraph: buildScopedSubgraph(this.index, this.rootId, this.scope),
      materializations: this.index.getAllMaterializations(),
      runStatuses: buildRunStatuses(this.index),
      // Only the larger view has room for the field, and only a session that can run dbt has any
      // use for it.
      selectorRoot:
        placement === 'editor' && this.runSelection && root ? rootSelector(root) : undefined,
    };
  }

  /**
   * Wires the webview's messages to this session; dispose to unwire.
   *
   * `onOpenFull` is the host's to supply because opening an editor tab is not something a session
   * knows how to do: only the panel offers the action, and only its host has somewhere to send it.
   */
  attach(webview: vscode.Webview, onOpenFull?: () => void): vscode.Disposable {
    // A run finishing is the one thing that changes what is drawn without the user touching the
    // graph, and the index already says when it happened. Only the statuses are re-sent: a
    // rebuilt subgraph would collapse whatever was expanded by hand.
    const statusSubscription = this.index.onDidChange(() => {
      const update: HostToWebviewMessage = {
        type: 'runStatuses',
        statuses: buildRunStatuses(this.index),
      };
      void webview.postMessage(update);
    });

    const messageSubscription = webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
      switch (message.type) {
        case 'expand': {
          const response: HostToWebviewMessage = {
            type: 'expandResult',
            nodeId: message.nodeId,
            direction: message.direction,
            subgraph: expandNode(this.index, message.nodeId, message.direction, this.scope),
          };
          void webview.postMessage(response);
          return;
        }

        case 'setScope': {
          this.scope = sanitizeScope(message.scope);
          // With a selection on screen the filters apply to its result, not to a walk from the
          // root: the depths are the selection's business then.
          const response: HostToWebviewMessage = this.selection
            ? { type: 'selectorResult', scope: this.scope, outcome: this.selectionOutcome() }
            : {
                type: 'scopeResult',
                scope: this.scope,
                subgraph: buildScopedSubgraph(this.index, this.rootId, this.scope),
              };
          void webview.postMessage(response);
          return;
        }

        case 'runSelector':
          void this.runSelector(webview, message.select, message.exclude);
          return;

        case 'cancelSelector':
          this.inFlight?.abort();
          return;

        case 'clearSelector': {
          this.inFlight?.abort();
          this.selection = undefined;
          const response: HostToWebviewMessage = {
            type: 'scopeResult',
            scope: this.scope,
            subgraph: buildScopedSubgraph(this.index, this.rootId, this.scope),
          };
          void webview.postMessage(response);
          return;
        }

        case 'openFull':
          onOpenFull?.();
          return;

        case 'open': {
          const target = this.index.getLineageEntity(message.nodeId);
          if (target) {
            void vscode.window.showTextDocument(this.index.getFileUri(target), { preview: true });
          }
          return;
        }
      }
    });

    return vscode.Disposable.from(statusSubscription, messageSubscription, {
      // A run for a webview that has been replaced would only post into the void.
      dispose: () => this.inFlight?.abort(),
    });
  }

  private async runSelector(
    webview: vscode.Webview,
    select: string,
    exclude: string,
  ): Promise<void> {
    if (!this.runSelection) return;

    // A second run supersedes the first, which then finds it no longer owns the answer.
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    const post = (outcome: SelectorOutcome): void => {
      const message: HostToWebviewMessage = { type: 'selectorResult', scope: this.scope, outcome };
      void webview.postMessage(message);
    };

    let ids: string[];
    try {
      ids = await this.runSelection(this.index, select, exclude, controller.signal);
    } catch (error) {
      if (this.inFlight !== controller) return;
      this.inFlight = undefined;
      post(
        error instanceof DbtLsCancelledError
          ? { status: 'cancelled' }
          : { status: 'error', message: error instanceof Error ? error.message : String(error) },
      );
      return;
    }
    if (this.inFlight !== controller) return;
    this.inFlight = undefined;

    const { known, missing, notDrawn } = partitionMatches(
      ids,
      (id) => this.index.getLineageEntity(id) !== undefined,
    );
    this.selection = { known, matched: ids.length, missing, notDrawn };
    post(this.selectionOutcome());
  }

  /** The selection on screen under the scope now in force. */
  private selectionOutcome(): SelectorOutcome {
    const selection = this.selection;
    if (!selection) return { status: 'cancelled' };

    const result = buildSelectionSubgraph(this.index, selection.known, this.scope);
    const counts = {
      matched: selection.matched,
      drawn: result.kind === 'ok' ? result.subgraph.nodes.length : result.nodeCount,
      missing: selection.missing,
      notDrawn: selection.notDrawn,
      filteredOut: result.filteredOut,
    };
    return result.kind === 'ok'
      ? { status: 'ok', subgraph: result.subgraph, counts }
      : { status: 'tooMany', limit: MAX_SELECTION_NODES, counts };
  }
}
