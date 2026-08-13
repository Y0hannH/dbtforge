import * as vscode from 'vscode';
import { PreviewState } from './previewState';
import { renderPreviewHtml } from './previewHtml';

/**
 * Hosts the results grid in the bottom panel, beside Terminal and Problems.
 *
 * A WebviewView (rather than the WebviewPanel the lineage view uses) is what makes the panel
 * placement possible at all — a panel container can only hold views, not editor tabs. The state
 * lives here rather than in the webview so that a reload, or the view being resolved long after
 * the first preview ran, still shows the latest result.
 */
export class PreviewViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'dbtForge.preview';

  private view: vscode.WebviewView | undefined;
  private state: PreviewState = { kind: 'idle' };

  private readonly _onDidRequestCancel = new vscode.EventEmitter<void>();
  readonly onDidRequestCancel = this._onDidRequestCancel.event;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = renderPreviewHtml();

    view.webview.onDidReceiveMessage((message: { type?: string }) => {
      // The webview asks for state once its script is live. Without that handshake, a result
      // produced while the panel was still resolving would be posted into a void and lost.
      if (message.type === 'ready') this.post();
      else if (message.type === 'cancel') this._onDidRequestCancel.fire();
    });

    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  setState(state: PreviewState): void {
    this.state = state;
    this.post();
  }

  /** Brings the panel forward, resolving the view on first use. */
  async reveal(): Promise<void> {
    if (this.view) {
      this.view.show(true); // preserve the editor's focus
      return;
    }
    await vscode.commands.executeCommand(`${PreviewViewProvider.viewType}.focus`);
  }

  private post(): void {
    void this.view?.webview.postMessage({ type: 'state', state: this.state });
  }

  dispose(): void {
    this._onDidRequestCancel.dispose();
  }
}
