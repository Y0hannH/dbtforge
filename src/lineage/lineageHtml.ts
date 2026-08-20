import * as vscode from 'vscode';
import { getNonce } from '../webview/nonce';
import { LineageBootstrap } from './messages';

/**
 * The webview document, identical whether it is hosted in an editor tab or in the bottom panel —
 * the two hosts differ only in where VS Code puts the frame, never in what runs inside it.
 */
export function renderLineageHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  bootstrap: LineageBootstrap
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'lineage.js')
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'lineage.css')
  );
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
    window.__DBT_FORGE_LINEAGE__ = ${embedJson(bootstrap)};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * JSON for inlining in a <script> block. Model names come from the user's project, so `<` is
 * escaped rather than trusted: a literal `</script>` anywhere in the payload would otherwise
 * close the block early.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\u003c');
}

/** Webview options shared by both hosts: scripts on, and assets limited to our own bundle dir. */
export function lineageWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
  };
}
