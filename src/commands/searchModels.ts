import * as vscode from 'vscode';

import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import type { ModelSearchItem } from '../search/modelSearch';

const ICONS: Record<string, string> = {
  model: 'symbol-file',
  seed: 'table',
  snapshot: 'history',
};

interface ModelPickItem extends vscode.QuickPickItem {
  uniqueId: string;
}

/**
 * Quick Pick over every model, seed and snapshot of a project, opening the chosen one's file.
 *
 * Matching on the description as well as the label is the point on a large project: typing
 * `marts/fin` narrows to a folder, and `dbt_utils` to a package, which the name alone can't.
 */
export async function searchModels(index: DbtProjectIndex): Promise<void> {
  if (!index.isManifestLoaded()) {
    void vscode.window.showWarningMessage(
      'dbt Forge: no manifest loaded yet. Run "dbt compile" or "dbt build" to generate it.',
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(index.getSearchItems().map(toPickItem), {
    placeHolder: 'Search models, seeds and snapshots',
    matchOnDescription: true,
  });
  if (!picked) return;

  const node = index.getNode(picked.uniqueId);
  if (!node) return;

  // A model whose file moved since the last compile is in the manifest and not on disk: say so
  // instead of opening an empty untitled document.
  const uri = await index.getExistingFileUri(node);
  if (!uri) {
    void vscode.window.showWarningMessage(
      `dbt Forge: ${node.original_file_path} doesn't exist — the manifest is older than your files. Run "dbt compile".`,
    );
    return;
  }
  await vscode.window.showTextDocument(uri);
}

function toPickItem(item: ModelSearchItem): ModelPickItem {
  return {
    label: `$(${ICONS[item.resourceType] ?? 'symbol-file'}) ${item.label}`,
    description: item.description,
    uniqueId: item.uniqueId,
  };
}
