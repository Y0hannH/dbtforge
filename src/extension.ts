import * as vscode from 'vscode';
import { previewCompiledSql, compiledSqlContentProvider, COMPILED_SQL_SCHEME } from './commands/compiledSqlPreview';
import { showLineage } from './commands/lineageFlow';
import { disposeSharedTerminal, handleTerminalClosed, runDbtCommand } from './commands/runDbtCommand';
import { resolveConfig } from './config';
import { DbtProjectIndex } from './index/DbtProjectIndex';
import { DbtNode } from './index/manifestTypes';
import { BuildCodeLensProvider } from './providers/buildCodeLens';
import { ColumnCompletionProvider } from './providers/columnCompletion';
import { RefSourceDefinitionProvider } from './providers/definitionProvider';
import { JinjaSnippetCompletionProvider } from './providers/jinjaSnippetCompletion';
import { RefSourceCompletionProvider } from './providers/refSourceCompletion';
import { RelativesTreeProvider } from './providers/relativesTreeView';

// One DbtProjectIndex per workspace folder that actually contains a dbt project.
const indexes = new Map<string, DbtProjectIndex>();

// dbt models are plain .sql files with embedded Jinja — we don't require a dedicated
// language id, just scope providers to .sql files inside a workspace folder that has an index.
const DBT_SQL_SELECTOR: vscode.DocumentSelector = { scheme: 'file', pattern: '**/*.sql' };

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('dbt Forge');
  context.subscriptions.push(output);

  await setupWorkspaceFolders(context, output);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      disposeAllIndexes();
      await setupWorkspaceFolders(context, output);
    })
  );

  const relativesTree = new RelativesTreeProvider(getIndexForResource);
  const codeLensProvider = new BuildCodeLensProvider(getIndexForResource);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('dbtForge.relatives', relativesTree),
    vscode.window.onDidChangeActiveTextEditor((editor) => relativesTree.refresh(editor))
  );
  relativesTree.refresh(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      DBT_SQL_SELECTOR,
      new RefSourceCompletionProvider(getIndexForResource),
      "'",
      '"',
      ','
    ),
    vscode.languages.registerCompletionItemProvider(
      DBT_SQL_SELECTOR,
      new ColumnCompletionProvider(getIndexForResource),
      '.'
    ),
    vscode.languages.registerCompletionItemProvider(DBT_SQL_SELECTOR, new JinjaSnippetCompletionProvider()),
    vscode.languages.registerDefinitionProvider(
      DBT_SQL_SELECTOR,
      new RefSourceDefinitionProvider(getIndexForResource)
    ),
    vscode.languages.registerCodeLensProvider(DBT_SQL_SELECTOR, codeLensProvider),
    vscode.workspace.registerTextDocumentContentProvider(COMPILED_SQL_SCHEME, compiledSqlContentProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbtForge.refreshIndex', async () => {
      for (const index of indexes.values()) {
        await index.initialize();
      }
      codeLensProvider.refresh();
      relativesTree.refresh(vscode.window.activeTextEditor);
      vscode.window.showInformationMessage('dbt Forge: index refreshed.');
    }),
    vscode.commands.registerCommand('dbtForge.buildModel', (uri?: vscode.Uri) =>
      withModelNode(uri, (index, node) =>
        runDbtCommand(index.getConfig(), ['build', '--select', node.name])
      )
    ),
    vscode.commands.registerCommand('dbtForge.buildUpstream', (uri?: vscode.Uri) =>
      withModelNode(uri, (index, node) =>
        runDbtCommand(index.getConfig(), ['build', '--select', `+${node.name}`])
      )
    ),
    vscode.commands.registerCommand('dbtForge.buildDownstream', (uri?: vscode.Uri) =>
      withModelNode(uri, (index, node) =>
        runDbtCommand(index.getConfig(), ['build', '--select', `${node.name}+`])
      )
    ),
    vscode.commands.registerCommand('dbtForge.testModel', (uri?: vscode.Uri) =>
      withModelNode(uri, (index, node) =>
        runDbtCommand(index.getConfig(), ['test', '--select', node.name])
      )
    ),
    vscode.commands.registerCommand('dbtForge.previewCompiledSql', (uri?: vscode.Uri) =>
      withModelNode(uri, (index, node) => previewCompiledSql(index.getConfig(), node))
    ),
    vscode.commands.registerCommand('dbtForge.showLineage', (uri?: vscode.Uri) =>
      withModelNode(uri, (index, node) => showLineage(context, index, node.unique_id))
    ),
    vscode.commands.registerCommand('dbtForge.buildProject', async () => {
      const index = await resolveAnyIndex();
      if (!index) return;
      runDbtCommand(index.getConfig(), ['build']);
    }),
    vscode.commands.registerCommand('dbtForge.compileProject', async () => {
      const index = await resolveAnyIndex();
      if (!index) return;
      runDbtCommand(index.getConfig(), ['compile']);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(handleTerminalClosed),
    { dispose: disposeSharedTerminal },
    { dispose: disposeAllIndexes }
  );
}

/** Resolves the dbt model backing `uri` (or the active editor if omitted) and runs `action`. */
function withModelNode(
  uri: vscode.Uri | undefined,
  action: (index: DbtProjectIndex, node: DbtNode) => void
): void {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    vscode.window.showWarningMessage('dbt Forge: no active SQL file.');
    return;
  }

  const index = getIndexForResource(targetUri);
  const node = index?.getNodeByFileUri(targetUri);
  if (!index || !node || node.resource_type !== 'model') {
    vscode.window.showWarningMessage('dbt Forge: this file is not a known dbt model.');
    return;
  }

  action(index, node);
}

/**
 * Resolves which dbt project to run a project-wide command against, since (unlike the
 * per-model commands) there's no file to derive it from. Prefers the active editor's
 * project; falls back to the only indexed project if there's just one; prompts if there
 * are several (e.g. a Fabric workspace with multiple dbt projects).
 */
async function resolveAnyIndex(): Promise<DbtProjectIndex | undefined> {
  const active = vscode.window.activeTextEditor;
  if (active) {
    const index = getIndexForResource(active.document.uri);
    if (index) return index;
  }

  const all = [...indexes.values()];
  if (all.length === 0) {
    vscode.window.showWarningMessage('dbt Forge: no dbt project detected in this workspace.');
    return undefined;
  }
  if (all.length === 1) return all[0];

  const picked = await vscode.window.showQuickPick(
    all.map((index) => ({ label: index.getConfig().projectDir, index })),
    { placeHolder: 'Select a dbt project' }
  );
  return picked?.index;
}

async function setupWorkspaceFolders(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const config = await resolveConfig(folder, output);
    if (!config) continue;

    const index = new DbtProjectIndex(config);
    indexes.set(folder.uri.toString(), index);
    context.subscriptions.push(index);

    output.appendLine(`dbt Forge: indexing project at ${config.projectDir}`);
    await index.initialize();
  }
}

function disposeAllIndexes(): void {
  for (const index of indexes.values()) index.dispose();
  indexes.clear();
}

export function getIndexForResource(uri: vscode.Uri): DbtProjectIndex | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return undefined;
  return indexes.get(folder.uri.toString());
}

export function deactivate(): void {
  disposeAllIndexes();
  disposeSharedTerminal();
}
