import * as path from 'path';
import * as vscode from 'vscode';

// Watches a single absolute file path for create/change/delete and invokes onChange
// (debounced) whenever the content should be reloaded. `dbt` tends to rewrite
// manifest.json/catalog.json in full, which surfaces as change+create in quick succession —
// the debounce collapses that into a single reload.
export function watchFile(
  absolutePath: string,
  onChange: () => void,
  debounceMs = 300
): vscode.Disposable {
  const pattern = new vscode.RelativePattern(
    vscode.Uri.file(path.dirname(absolutePath)),
    path.basename(absolutePath)
  );
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  let timer: NodeJS.Timeout | undefined;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };

  watcher.onDidCreate(trigger);
  watcher.onDidChange(trigger);
  watcher.onDidDelete(trigger);

  return {
    dispose() {
      if (timer) clearTimeout(timer);
      watcher.dispose();
    },
  };
}
