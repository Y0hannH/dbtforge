import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { DbtForgeConfig } from '../config';
import { DbtNode } from '../index/manifestTypes';

export const COMPILED_SQL_SCHEME = 'dbtforge-compiled';

export function getCompiledSqlPath(config: DbtForgeConfig, node: DbtNode): string {
  // dbt writes compiled models to target/compiled/<package>/models/<path-within-models-dir>,
  // mirroring `node.path` (relative to the resource-type root) under the package's `models/`.
  return path.join(config.compiledDir, node.package_name, 'models', node.path);
}

function toCompiledSqlUri(compiledFilePath: string): vscode.Uri {
  return vscode.Uri.file(compiledFilePath).with({ scheme: COMPILED_SQL_SCHEME });
}

/** Serves target/compiled/*.sql as read-only virtual documents (edits are disallowed by VS Code
 *  for TextDocumentContentProvider-backed documents — no extra readonly plumbing needed). */
export class CompiledSqlContentProvider implements vscode.TextDocumentContentProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      return await fs.readFile(uri.fsPath, 'utf8');
    } catch {
      return `-- dbt Forge: no compiled SQL found at ${uri.fsPath}\n-- Run "dbt compile" (or "dbt build") first.`;
    }
  }

  /** Forces VS Code to re-fetch content for an already-open virtual document (e.g. after a
   *  recompile) — without this, openTextDocument() on the same URI just returns the stale
   *  cached copy from the first preview. */
  refresh(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }
}

export const compiledSqlContentProvider = new CompiledSqlContentProvider();

export async function previewCompiledSql(config: DbtForgeConfig, node: DbtNode): Promise<void> {
  const compiledPath = getCompiledSqlPath(config, node);

  const exists = await fs
    .access(compiledPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    vscode.window.showWarningMessage(
      `dbt Forge: no compiled SQL found for "${node.name}" at ${compiledPath}. Run "dbt compile" first.`
    );
    return;
  }

  const uri = toCompiledSqlUri(compiledPath);
  compiledSqlContentProvider.refresh(uri);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(doc, 'sql');
  await vscode.window.showTextDocument(doc, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}
