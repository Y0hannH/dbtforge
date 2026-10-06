import * as vscode from 'vscode';

import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import { lineageWebviewOptions, renderLineageHtml } from '../lineage/lineageHtml';
import { configuredLineageLocation } from '../lineage/lineagePlacement';
import { LineageSession } from '../lineage/lineageSession';
import type { LineageViewProvider } from '../lineage/lineageViewProvider';

// One lineage tab, retargeted rather than duplicated. Every call used to create a new panel, so
// looking at three models in a row left three "Lineage: x" tabs open.
let editorPanel: vscode.WebviewPanel | undefined;
let editorAttachment: vscode.Disposable | undefined;
let editorSession: LineageSession | undefined;

export function showLineage(
  context: vscode.ExtensionContext,
  index: DbtProjectIndex,
  rootId: string,
  panelView: LineageViewProvider,
): void {
  const session = new LineageSession(index, rootId);

  if (configuredLineageLocation(vscode.window.activeTextEditor?.document.uri) === 'panel') {
    void panelView.show(session);
    return;
  }

  showInEditor(context, session);
}

/**
 * Points whichever lineage is already open at `rootId`, quietly: nothing is opened, revealed or
 * focused, so following the active editor never steals the user's place. A no-op when no lineage
 * is open or it already shows this node. The depth/exclusion choices carry over, since the user
 * made them for the graph they are reading, not for one particular model.
 */
export function followActiveEditor(
  context: vscode.ExtensionContext,
  index: DbtProjectIndex,
  rootId: string,
  panelView: LineageViewProvider,
): void {
  if (editorPanel && editorSession && editorSession.rootId !== rootId) {
    const session = new LineageSession(index, rootId, editorSession.currentScope);
    attachToEditorPanel(context, editorPanel, session);
  }

  const panelSession = panelView.currentSession;
  if (panelSession && panelSession.rootId !== rootId) {
    panelView.retarget(new LineageSession(index, rootId, panelSession.currentScope));
  }
}

function attachToEditorPanel(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  session: LineageSession,
): void {
  editorSession = session;
  panel.title = lineageTitle(session);
  // Replacing the html tears down the old document, so the listener bound to it goes with it.
  editorAttachment?.dispose();
  panel.webview.html = renderLineageHtml(panel.webview, context.extensionUri, session.bootstrap());
  editorAttachment = session.attach(panel.webview);
}

function showInEditor(context: vscode.ExtensionContext, session: LineageSession): void {
  if (!editorPanel) {
    editorPanel = vscode.window.createWebviewPanel(
      'dbtForgeLineage',
      lineageTitle(session),
      vscode.ViewColumn.Beside,
      { ...lineageWebviewOptions(context.extensionUri), retainContextWhenHidden: true },
    );
    editorPanel.onDidDispose(() => {
      editorAttachment?.dispose();
      editorAttachment = undefined;
      editorPanel = undefined;
      editorSession = undefined;
    });
  } else {
    editorPanel.reveal(editorPanel.viewColumn ?? vscode.ViewColumn.Beside, true);
  }

  attachToEditorPanel(context, editorPanel, session);
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
  editorSession = undefined;
}
