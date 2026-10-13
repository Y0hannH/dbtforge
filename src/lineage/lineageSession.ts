import * as vscode from 'vscode';

import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import { buildScopedSubgraph, expandNode } from './buildLineageGraph';
import type { LineageLocation } from './lineagePlacement';
import type { LineageScope } from './lineageScope';
import { DEFAULT_SCOPE, sanitizeScope } from './lineageScope';
import type { HostToWebviewMessage, LineageBootstrap, WebviewToHostMessage } from './messages';

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

  constructor(
    private readonly index: DbtProjectIndex,
    readonly rootId: string,
    scope: LineageScope = DEFAULT_SCOPE,
  ) {
    this.scope = scope;
  }

  /** The depth/exclusion choices in force, so a follow-up session can keep them. */
  get currentScope(): LineageScope {
    return this.scope;
  }

  get rootName(): string {
    return this.index.getLineageEntity(this.rootId)?.name ?? this.rootId;
  }

  /**
   * An independent session on the same root with the scope as it is now. The panel's lineage and
   * the editor tab opened from it are two graphs the user then moves around separately, so they
   * must not share a scope object that one of them reassigns.
   */
  fork(): LineageSession {
    return new LineageSession(this.index, this.rootId, this.scope);
  }

  bootstrap(placement: LineageLocation): LineageBootstrap {
    return {
      rootId: this.rootId,
      rootName: this.rootName,
      placement,
      scope: this.scope,
      subgraph: buildScopedSubgraph(this.index, this.rootId, this.scope),
      materializations: this.index.getAllMaterializations(),
    };
  }

  /**
   * Wires the webview's messages to this session; dispose to unwire.
   *
   * `onOpenFull` is the host's to supply because opening an editor tab is not something a session
   * knows how to do: only the panel offers the action, and only its host has somewhere to send it.
   */
  attach(webview: vscode.Webview, onOpenFull?: () => void): vscode.Disposable {
    return webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
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
  }
}
