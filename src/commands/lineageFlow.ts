import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { lineageWebviewOptions, renderLineageHtml } from '../lineage/lineageHtml';
import { configuredLineageLocation } from '../lineage/lineagePlacement';
import { LineageSession } from '../lineage/lineageSession';
import { LineageViewProvider } from '../lineage/lineageViewProvider';

// One lineage tab, retargeted rather than duplicated. Every call used to create a new panel, so
// looking at three models in a row left three "Lineage: x" tabs open.
let editorPanel: vscode.WebviewPanel | undefined;
let editorAttachment: vscode.Disposable | undefined;

export function showLineage(
  context: vscode.ExtensionContext,
  index: DbtProjectIndex,
  rootId: string,
  panelView: LineageViewProvider
): void {
  const session = new LineageSession(index, rootId);

  if (configuredLineageLocation(vscode.window.activeTextEditor?.document.uri) === 'panel') {
    void panelView.show(session);
    return;
  }

  showInEditor(context, session);
}

function showInEditor(context: vscode.ExtensionContext, session: LineageSession): void {
  if (!editorPanel) {
    editorPanel = vscode.window.createWebviewPanel(
      'dbtForgeLineage',
      lineageTitle(session),
      vscode.ViewColumn.Beside,
      { ...lineageWebviewOptions(context.extensionUri), retainContextWhenHidden: true }
    );
    editorPanel.onDidDispose(() => {
      editorAttachment?.dispose();
      editorAttachment = undefined;
      editorPanel = undefined;
    });
  } else {
    editorPanel.reveal(editorPanel.viewColumn ?? vscode.ViewColumn.Beside, true);
  }

  editorPanel.title = lineageTitle(session);
  // Replacing the html tears down the old document, so the listener bound to it goes with it.
  editorAttachment?.dispose();
  editorPanel.webview.html = renderLineageHtml(
    editorPanel.webview,
    context.extensionUri,
    session.bootstrap()
  );
  editorAttachment = session.attach(editorPanel.webview);
}

function lineageTitle(session: LineageSession): string {
  return `Lineage: ${session.rootName}`;
}

/** Closes the shared lineage tab — called when the extension shuts down. */
export function disposeLineagePanel(): void {
  editorAttachment?.dispose();
  editorAttachment = undefined;
  editorPanel?.dispose();
  editorPanel = undefined;
}
