import * as vscode from 'vscode';

/**
 * Reads a file as lines, or undefined if it can't be read (missing, or not a file).
 *
 * Deliberately not vscode.workspace.openTextDocument: features that scan many files at once
 * would otherwise materialize a TextDocument per file, which stays in VS Code's document cache
 * and is far more expensive than reading bytes. Unsaved editor state isn't a concern here —
 * these scans are driven by the manifest, which reflects what's on disk anyway.
 */
export async function readFileLines(uri: vscode.Uri): Promise<string[] | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8').split(/\r?\n/);
  } catch {
    return undefined;
  }
}
