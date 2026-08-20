import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { buildScopedSubgraph, expandNode } from './buildLineageGraph';
import { DEFAULT_SCOPE, LineageScope, sanitizeScope } from './lineageScope';
import { HostToWebviewMessage, LineageBootstrap, WebviewToHostMessage } from './messages';

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
  private scope: LineageScope = DEFAULT_SCOPE;

  constructor(
    private readonly index: DbtProjectIndex,
    readonly rootId: string
  ) {}

  get rootName(): string {
    return this.index.getNode(this.rootId)?.name ?? this.rootId;
  }

  bootstrap(): LineageBootstrap {
    return {
      rootId: this.rootId,
      rootName: this.rootName,
      scope: this.scope,
      subgraph: buildScopedSubgraph(this.index, this.rootId, this.scope),
      materializations: this.index.getAllMaterializations(),
    };
  }

  /** Wires the webview's messages to this session; dispose to unwire. */
  attach(webview: vscode.Webview): vscode.Disposable {
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

        case 'open': {
          const target = this.index.getNode(message.nodeId);
          if (target) {
            void vscode.window.showTextDocument(this.index.getFileUri(target), { preview: true });
          }
          return;
        }
      }
    });
  }
}
