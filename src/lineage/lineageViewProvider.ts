import * as vscode from 'vscode';
import { lineageWebviewOptions, renderLineageHtml } from './lineageHtml';
import { configuredLineageLocation, LineageLocation } from './lineagePlacement';
import { LineageSession } from './lineageSession';

/**
 * Hosts the lineage graph in the bottom panel, beside Data Preview and Terminal.
 *
 * A panel container can only hold views, never editor tabs, so this is a WebviewView where the
 * editor placement uses a WebviewPanel. It is a singleton by construction — a view has one
 * instance — which is also why asking for a second model's lineage retargets it rather than
 * opening anything new.
 *
 * The view is registered whether or not the panel is the configured destination: registration
 * only declares where the graph *can* render, and making it appear or vanish with a setting would
 * mean a window reload to change placement. The cost is that a user can find an empty Lineage view
 * while their lineages are opening in the editor — which is what the empty state has to explain,
 * rather than promising a graph that will never arrive.
 */
export class LineageViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'dbtForge.lineage';

  private view: vscode.WebviewView | undefined;
  private session: LineageSession | undefined;
  private attached: vscode.Disposable | undefined;
  private readonly configListener: vscode.Disposable;

  constructor(private readonly extensionUri: vscode.Uri) {
    // The empty state names the current placement, so it goes stale the moment that setting
    // changes — including when it is changed from this view's own title bar.
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('dbtForge.lineageLocation')) return;
      if (!this.session) this.render();
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = lineageWebviewOptions(this.extensionUri);
    this.render();

    view.onDidDispose(() => {
      this.detach();
      this.view = undefined;
    });
  }

  /** Points the panel at `session` and brings it forward, resolving the view on first use. */
  async show(session: LineageSession): Promise<void> {
    this.session = session;
    if (!this.view) {
      // Resolving the view renders whatever session is set, so nothing more to do afterwards.
      await vscode.commands.executeCommand(`${LineageViewProvider.viewType}.focus`);
      return;
    }
    this.view.show(true); // preserve the editor's focus
    this.render();
  }

  private render(): void {
    const view = this.view;
    if (!view) return;

    this.detach();

    if (!this.session) {
      view.webview.html = renderEmptyHtml(configuredLineageLocation());
      return;
    }

    view.webview.html = renderLineageHtml(view.webview, this.extensionUri, this.session.bootstrap());
    this.attached = this.session.attach(view.webview);
  }

  private detach(): void {
    this.attached?.dispose();
    this.attached = undefined;
  }

  dispose(): void {
    this.detach();
    this.configListener.dispose();
  }
}

/**
 * Shown when the panel holds no graph yet — and it has two quite different things to say, because
 * an empty Lineage view means something else entirely depending on where lineages actually open.
 */
function renderEmptyHtml(location: LineageLocation): string {
  const body =
    location === 'panel'
      ? 'Open a dbt model, seed or snapshot and run <strong>Show Lineage</strong> to draw its graph here.'
      : 'Show Lineage currently opens the graph in an <strong>editor tab</strong>, not here. ' +
        'Use the <strong>Switch Lineage Placement</strong> button in this view&rsquo;s title bar to change that ' +
        '(it sets <code>dbtForge.lineageLocation</code> to <code>panel</code>).';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
</head>
<body style="font-family: var(--vscode-font-family, sans-serif); font-size: 13px; color: var(--vscode-descriptionForeground); padding: 12px; line-height: 1.5;">
  ${body}
</body>
</html>`;
}
