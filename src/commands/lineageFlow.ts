import * as vscode from 'vscode';
import { buildInitialSubgraph, expandNode } from '../lineage/buildLineageGraph';
import { WebviewToHostMessage } from '../lineage/messages';
import { DbtProjectIndex } from '../index/DbtProjectIndex';

export function showLineage(
  context: vscode.ExtensionContext,
  index: DbtProjectIndex,
  rootId: string
): void {
  const node = index.getNode(rootId);

  const panel = vscode.window.createWebviewPanel(
    'dbtForgeLineage',
    `Lineage: ${node?.name ?? rootId}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    }
  );

  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'lineage.js')
  );
  const styleUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'lineage.css')
  );

  const initialGraph = buildInitialSubgraph(index, rootId);
  panel.webview.html = renderHtml(panel.webview, scriptUri, styleUri, rootId, initialGraph);

  const messageListener = panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
    if (message.type === 'expand') {
      const subgraph = expandNode(index, message.nodeId, message.direction);
      panel.webview.postMessage({
        type: 'expandResult',
        nodeId: message.nodeId,
        direction: message.direction,
        subgraph,
      });
      return;
    }

    if (message.type === 'open') {
      const targetNode = index.getNode(message.nodeId);
      if (targetNode) {
        vscode.window.showTextDocument(index.getFileUri(targetNode), { preview: true });
      }
    }
  });
  panel.onDidDispose(() => messageListener.dispose());
}

function renderHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri,
  rootId: string,
  initialGraph: ReturnType<typeof buildInitialSubgraph>
): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <link nonce="${nonce}" rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.__DBT_FORGE_ROOT_ID__ = ${JSON.stringify(rootId)};
    window.__DBT_FORGE_INITIAL_GRAPH__ = ${JSON.stringify(initialGraph)};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
