import * as path from 'path';
import * as vscode from 'vscode';
import { previewCompiledSql, compiledSqlContentProvider, COMPILED_SQL_SCHEME } from './commands/compiledSqlPreview';
import { showLineage } from './commands/lineageFlow';
import { disposeSharedTerminal, handleTerminalClosed, runDbtCommand } from './commands/runDbtCommand';
import { selectProfile } from './commands/selectProfile';
import { DbtForgeConfig, resolveConfig } from './config';
import { DbtProjectIndex } from './index/DbtProjectIndex';
import { DbtNode } from './index/manifestTypes';
import { ProfileStore } from './profiles/profileStore';
import { BuildCodeLensProvider } from './providers/buildCodeLens';
import { ColumnCompletionProvider } from './providers/columnCompletion';
import { RefSourceDefinitionProvider } from './providers/definitionProvider';
import { DbtDiagnosticsController } from './providers/diagnostics';
import { DbtHoverProvider } from './providers/hoverProvider';
import { JinjaSnippetCompletionProvider } from './providers/jinjaSnippetCompletion';
import { ProfileStatusBar } from './providers/profileStatusBar';
import { RefSourceCompletionProvider } from './providers/refSourceCompletion';
import { DbtReferenceProvider } from './providers/referenceProvider';
import { RelativesTreeProvider } from './providers/relativesTreeView';

// One DbtProjectIndex per workspace folder that actually contains a dbt project.
const indexes = new Map<string, DbtProjectIndex>();

// dbt models are plain .sql files with embedded Jinja — we don't require a dedicated
// language id, just scope providers to .sql files inside a workspace folder that has an index.
const DBT_SQL_SELECTOR: vscode.DocumentSelector = { scheme: 'file', pattern: '**/*.sql' };

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('dbt Forge');
  context.subscriptions.push(output);

  const diagnostics = new DbtDiagnosticsController(getIndexForResource);
  context.subscriptions.push(diagnostics);

  await setupWorkspaceFolders(context, output, diagnostics);

  const profileStore = new ProfileStore(context.workspaceState);
  const profileStatusBar = new ProfileStatusBar(profileStore, activeProjectConfig);
  context.subscriptions.push(profileStore, profileStatusBar);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      disposeAllIndexes();
      await setupWorkspaceFolders(context, output, diagnostics);
      profileStatusBar.refresh();
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => diagnostics.validate(doc)),
    vscode.workspace.onDidChangeTextDocument((e) => diagnostics.validateDebounced(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.clear(doc.uri))
  );
  for (const doc of vscode.workspace.textDocuments) diagnostics.validate(doc);

  const relativesTree = new RelativesTreeProvider(getIndexForResource);
  const codeLensProvider = new BuildCodeLensProvider(getIndexForResource);

  // Every dbt invocation carries the project's selected environment, so a build launched from a
  // CodeLens can't quietly run against a different workspace than the status bar advertises.
  const runDbt = (index: DbtProjectIndex, args: string[]): void => {
    const config = index.getConfig();
    runDbtCommand(config, [...args, ...profileStore.toCliArgs(config.projectDir)]);
  };

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
    vscode.languages.registerReferenceProvider(DBT_SQL_SELECTOR, new DbtReferenceProvider(getIndexForResource)),
    vscode.languages.registerHoverProvider(DBT_SQL_SELECTOR, new DbtHoverProvider(getIndexForResource)),
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
      withModelNode(uri, (index, node) => runDbt(index, ['build', '--select', node.name]))
    ),
    vscode.commands.registerCommand('dbtForge.buildUpstream', (uri?: vscode.Uri) =>
      withModelNode(uri, (index, node) => runDbt(index, ['build', '--select', `+${node.name}`]))
    ),
    vscode.commands.registerCommand('dbtForge.buildDownstream', (uri?: vscode.Uri) =>
      withModelNode(uri, (index, node) => runDbt(index, ['build', '--select', `${node.name}+`]))
    ),
    vscode.commands.registerCommand('dbtForge.testModel', (uri?: vscode.Uri) =>
      withModelNode(uri, (index, node) => runDbt(index, ['test', '--select', node.name]))
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
      runDbt(index, ['build']);
    }),
    vscode.commands.registerCommand('dbtForge.buildFolder', (uri?: vscode.Uri) =>
      withProjectFolder(uri, (index, selectorPath) => runDbt(index, ['build', '--select', `path:${selectorPath}`]))
    ),
    vscode.commands.registerCommand('dbtForge.buildFolderUpstream', (uri?: vscode.Uri) =>
      withProjectFolder(uri, (index, selectorPath) => runDbt(index, ['build', '--select', `+path:${selectorPath}`]))
    ),
    vscode.commands.registerCommand('dbtForge.buildFolderDownstream', (uri?: vscode.Uri) =>
      withProjectFolder(uri, (index, selectorPath) => runDbt(index, ['build', '--select', `path:${selectorPath}+`]))
    ),
    vscode.commands.registerCommand('dbtForge.compileProject', async () => {
      const index = await resolveAnyIndex();
      if (!index) return;
      runDbt(index, ['compile']);
    }),
    // catalog.json is what column autocomplete reads, and only `dbt docs generate` writes it —
    // neither compile nor build does. Without this command the extension had no way to produce
    // the one file its column suggestions depend on. No explicit reload afterwards: the index
    // watches catalog.json and picks the new one up on its own.
    vscode.commands.registerCommand('dbtForge.generateDocs', async () => {
      const index = await resolveAnyIndex();
      if (!index) return;
      runDbt(index, ['docs', 'generate']);
    }),
    vscode.commands.registerCommand('dbtForge.selectProfile', async () => {
      const index = await resolveAnyIndex();
      if (!index) return;
      if (!(await selectProfile(index.getConfig(), profileStore))) return;

      // The manifest on disk was compiled against the previous environment, so everything read
      // from it (lineage, columns, compiled SQL) is stale until dbt runs again.
      const action = await vscode.window.showInformationMessage(
        `dbt Forge: dbt commands now run with ${describeSelection(profileStore, index)}. ` +
          'The indexed manifest still reflects the previous environment.',
        'Compile project'
      );
      if (action) runDbt(index, ['compile']);
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
 * Resolves the dbt project a right-clicked explorer folder belongs to, and the `path:`
 * selector (relative to the project root, forward-slashed for dbt's selector matching)
 * that scopes a build to every model under that folder.
 */
function withProjectFolder(
  uri: vscode.Uri | undefined,
  action: (index: DbtProjectIndex, selectorPath: string) => void
): void {
  if (!uri) {
    vscode.window.showWarningMessage('dbt Forge: no folder selected.');
    return;
  }

  const index = getIndexForResource(uri);
  if (!index) {
    vscode.window.showWarningMessage('dbt Forge: this folder is not part of an indexed dbt project.');
    return;
  }

  const relativePath = path.relative(index.getConfig().projectDir, uri.fsPath);
  if (!relativePath || relativePath.startsWith('..')) {
    vscode.window.showWarningMessage('dbt Forge: this folder is outside the dbt project.');
    return;
  }

  action(index, relativePath.split(path.sep).join('/'));
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

function describeSelection(store: ProfileStore, index: DbtProjectIndex): string {
  const args = store.toCliArgs(index.getConfig().projectDir);
  return args.length > 0 ? args.join(' ') : 'the profiles.yml default (no --profile/--target)';
}

/**
 * The project the status bar speaks for: the active editor's, or the only indexed one. Undefined
 * (status bar hidden) when there's no dbt project, or when several are indexed and nothing in the
 * editor says which one is meant.
 */
function activeProjectConfig(): DbtForgeConfig | undefined {
  const active = vscode.window.activeTextEditor;
  const fromActiveEditor = active ? getIndexForResource(active.document.uri) : undefined;
  if (fromActiveEditor) return fromActiveEditor.getConfig();

  const all = [...indexes.values()];
  return all.length === 1 ? all[0].getConfig() : undefined;
}

async function setupWorkspaceFolders(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  diagnostics: DbtDiagnosticsController
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const config = await resolveConfig(folder, output);
    if (!config) continue;

    const index = new DbtProjectIndex(config);
    indexes.set(folder.uri.toString(), index);
    context.subscriptions.push(index, index.onDidChange(() => diagnostics.revalidateOpenDocuments()));

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
