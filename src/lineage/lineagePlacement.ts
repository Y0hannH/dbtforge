import * as vscode from 'vscode';

export type LineageLocation = 'editor' | 'panel';

/**
 * Where the lineage graph opens.
 *
 * Read at call time rather than resolved once with the rest of the project config: this is a
 * placement preference, and switching it should take effect on the next lineage the user opens,
 * not on the next window reload.
 */
export function configuredLineageLocation(resource?: vscode.Uri): LineageLocation {
  const value = vscode.workspace
    .getConfiguration('dbtForge', resource)
    .get<string>('lineageLocation', 'editor');
  return value === 'panel' ? 'panel' : 'editor';
}

/**
 * Flips the placement and returns what it became.
 *
 * Exists because the setting alone is a trap: the Lineage view is registered whether or not it is
 * the configured destination, so a user who finds it in the panel sees an empty view that nothing
 * they do from the editor will ever fill. This is the one-click way out of that, sitting in the
 * view's own title bar where the confusion happens.
 */
export async function toggleLineageLocation(): Promise<LineageLocation> {
  const next: LineageLocation = configuredLineageLocation() === 'panel' ? 'editor' : 'panel';
  // Written to the workspace when there is one, so the choice travels with the project rather
  // than following the user into unrelated windows.
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration('dbtForge').update('lineageLocation', next, target);
  return next;
}
