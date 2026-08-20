import * as path from 'path';
import * as vscode from 'vscode';
import { previewCompiledSql, compiledSqlContentProvider, COMPILED_SQL_SCHEME } from './commands/compiledSqlPreview';
import { disposeLineagePanel, showLineage } from './commands/lineageFlow';
import { disposeSharedTerminal, handleTerminalClosed, runDbtCommand } from './commands/runDbtCommand';
import { selectProfile } from './commands/selectProfile';
import { DbtForgeConfig, resolveConfig } from './config';
import { DbtProjectIndex } from './index/DbtProjectIndex';
import { toggleLineageLocation } from './lineage/lineagePlacement';
import { LineageViewProvider } from './lineage/lineageViewProvider';
import { DbtNode } from './index/manifestTypes';
import { isReferenceable } from './index/refIndex';
import { PreviewController } from './preview/previewController';
import { PreviewViewProvider } from './preview/previewViewProvider';
import { ProfileStore } from './profiles/profileStore';
import { BuildCodeLensProvider } from './providers/buildCodeLens';
import { ColumnCompletionProvider } from './providers/columnCompletion';
import { DocBlockSnippetProvider } from './providers/docBlockSnippet';
import { DocCompletionProvider } from './providers/docCompletion';
import { DocDefinitionProvider } from './providers/docDefinitionProvider';
import { RefSourceDefinitionProvider } from './providers/definitionProvider';
import { DbtDiagnosticsController } from './providers/diagnostics';
import { DbtHoverProvider } from './providers/hoverProvider';
import { JinjaSnippetCompletionProvider } from './providers/jinjaSnippetCompletion';
import { ProfileStatusBar } from './providers/profileStatusBar';
import { RefSourceCompletionProvider } from './providers/refSourceCompletion';
import { DbtReferenceProvider } from './providers/referenceProvider';
import { RelativesTreeProvider } from './providers/relativesTreeView';
import { TagItem, TagsTreeProvider } from './providers/tagsTreeView';

// One DbtProjectIndex per workspace folder that actually contains a dbt project.
const indexes = new Map<string, DbtProjectIndex>();

// dbt models are plain .sql files with embedded Jinja — we don't require a dedicated
// language id, just scope providers to .sql files inside a workspace folder that has an index.
const DBT_SQL_SELECTOR: vscode.DocumentSelector = { scheme: 'file', pattern: '**/*.sql' };

// Seeds are .csv, and the only editor feature that applies to one is its lineage — the CodeLens
// provider returns nothing for a .csv that isn't a seed in the manifest.
const DBT_NODE_SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', pattern: '**/*.sql' },
  { scheme: 'file', pattern: '**/*.csv' },
];

// doc() is written in schema .yml descriptions far more than in SQL, so the doc block features
// are scoped to both rather than to models only. The blocks themselves are declared in .md.
const DBT_DOC_SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', pattern: '**/*.sql' },
  { scheme: 'file', pattern: '**/*.yml' },
  { scheme: 'file', pattern: '**/*.yaml' },
];

const DBT_MARKDOWN_SELECTOR: vscode.DocumentSelector = { scheme: 'file', pattern: '**/*.md' };

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('dbt Forge');
  context.subscriptions.push(output);

  const diagnostics = new DbtDiagnosticsController(getIndexForResource);
  context.subscriptions.push(diagnostics);

  const relativesTree = new RelativesTreeProvider(getIndexForResource);
  const tagsTree = new TagsTreeProvider(getActiveIndex);
  const codeLensProvider = new BuildCodeLensProvider(getIndexForResource);

  // A manifest reload can turn an unknown file into a known model (typically right after
  // "Compile This File" on a freshly created one). Every view derived from the index has to
  // be re-driven from that event, not just from the active-editor change — otherwise the
  // panel stays empty until the user switches tabs and comes back.
  const onIndexChanged = (): void => {
    diagnostics.revalidateOpenDocuments();
    codeLensProvider.refresh();
    refreshActiveEditorViews(relativesTree);
    tagsTree.refresh();
  };

  await setupWorkspaceFolders(context, output, onIndexChanged);

  const profileStore = new ProfileStore(context.workspaceState);
  const profileStatusBar = new ProfileStatusBar(profileStore, activeProjectConfig);
  context.subscriptions.push(profileStore, profileStatusBar);

  // The lineage can be hosted in an editor tab or in the bottom panel (dbtForge.lineageLocation).
  // The view is registered either way: registration only declares where it *could* render, and a
  // user flipping the setting shouldn't have to reload the window for the panel to exist.
  const lineageView = new LineageViewProvider(context.extensionUri);
  context.subscriptions.push(
    lineageView,
    vscode.window.registerWebviewViewProvider(LineageViewProvider.viewType, lineageView, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const previewView = new PreviewViewProvider();
  const previewController = new PreviewController(previewView, profileStore, output);
  context.subscriptions.push(
    previewView,
    previewController,
    previewView.onDidRequestCancel(() => previewController.cancel()),
    // Retaining the context keeps a result (and its scroll position) alive while the user switches
    // to the Terminal tab and back — the panel is shared real estate, so that happens constantly.
    vscode.window.registerWebviewViewProvider(PreviewViewProvider.viewType, previewView, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      disposeAllIndexes();
      await setupWorkspaceFolders(context, output, onIndexChanged);
      onIndexChanged();
      profileStatusBar.refresh();
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => diagnostics.validate(doc)),
    vscode.workspace.onDidChangeTextDocument((e) => diagnostics.validateDebounced(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.clear(doc.uri))
  );
  for (const doc of vscode.workspace.textDocuments) diagnostics.validate(doc);

  // Every dbt invocation carries the project's selected environment, so a build launched from a
  // CodeLens can't quietly run against a different workspace than the status bar advertises.
  const runDbt = (index: DbtProjectIndex, args: string[]): void => {
    const config = index.getConfig();
    runDbtCommand(config, [...args, ...profileStore.toCliArgs(config.projectDir)]);
  };


  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('dbtForge.relatives', relativesTree),
    vscode.window.registerTreeDataProvider('dbtForge.tags', tagsTree),
    vscode.window.onDidChangeActiveTextEditor(() => {
      refreshActiveEditorViews(relativesTree);
      // Which project the tags view describes follows the active editor in a multi-root
      // workspace, so it has to re-read on editor change too, not just on manifest reload.
      tagsTree.refresh();
    })
  );
  refreshActiveEditorViews(relativesTree);

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
    vscode.languages.registerCompletionItemProvider(
      DBT_DOC_SELECTOR,
      new DocCompletionProvider(getIndexForResource),
      "'",
      '"'
    ),
    vscode.languages.registerCompletionItemProvider(
      DBT_MARKDOWN_SELECTOR,
      new DocBlockSnippetProvider()
    ),
    vscode.languages.registerDefinitionProvider(
      DBT_DOC_SELECTOR,
      new DocDefinitionProvider(getIndexForResource)
    ),
    vscode.languages.registerDefinitionProvider(
      DBT_SQL_SELECTOR,
      new RefSourceDefinitionProvider(getIndexForResource)
    ),
    vscode.languages.registerReferenceProvider(DBT_SQL_SELECTOR, new DbtReferenceProvider(getIndexForResource)),
    vscode.languages.registerHoverProvider(DBT_SQL_SELECTOR, new DbtHoverProvider(getIndexForResource)),
    vscode.languages.registerCodeLensProvider(DBT_NODE_SELECTOR, codeLensProvider),
    vscode.workspace.registerTextDocumentContentProvider(COMPILED_SQL_SCHEME, compiledSqlContentProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbtForge.refreshIndex', async () => {
      for (const index of indexes.values()) {
        await index.initialize();
      }
      onIndexChanged();
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
      withRefTargetNode(uri, (index, node) =>
        showLineage(context, index, node.unique_id, lineageView)
      )
    ),
    vscode.commands.registerCommand('dbtForge.previewData', (uri?: vscode.Uri) =>
      withModelNode(uri, (index, node) => void previewController.previewModel(index, node))
    ),
    vscode.commands.registerCommand('dbtForge.previewCte', (uri: vscode.Uri, cteName: string) =>
      withModelNode(uri, (index, node) => void previewController.previewCte(index, node, cteName))
    ),
    vscode.commands.registerCommand('dbtForge.rerunPreview', () => previewController.rerun()),
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
    }),
    vscode.commands.registerCommand('dbtForge.compileFile', (uri?: vscode.Uri) =>
      withSqlFileSelector(uri, (index, selectorPath) =>
        runDbt(index, ['compile', '--select', `path:${selectorPath}`])
      )
    ),
    vscode.commands.registerCommand('dbtForge.parseProject', async () => {
      const index = await resolveAnyIndex();
      if (!index) return;
      runDbt(index, ['parse']);
    }),
    vscode.commands.registerCommand('dbtForge.buildTag', (item?: TagItem) =>
      withTag(item, (index, tag) => runDbt(index, ['build', '--select', `tag:${tag}`]))
    ),
    vscode.commands.registerCommand('dbtForge.buildTagUpstream', (item?: TagItem) =>
      withTag(item, (index, tag) => runDbt(index, ['build', '--select', `+tag:${tag}`]))
    ),
    vscode.commands.registerCommand('dbtForge.buildTagDownstream', (item?: TagItem) =>
      withTag(item, (index, tag) => runDbt(index, ['build', '--select', `tag:${tag}+`]))
    ),
    vscode.commands.registerCommand('dbtForge.testTag', (item?: TagItem) =>
      withTag(item, (index, tag) => runDbt(index, ['test', '--select', `tag:${tag}`]))
    ),
    vscode.commands.registerCommand('dbtForge.refreshTags', () => tagsTree.refresh()),
    // Flipping the setting is only half the job: the button lives in an empty Lineage view, so it
    // has to leave a graph behind rather than the same empty view with different placeholder text.
    vscode.commands.registerCommand('dbtForge.toggleLineageLocation', async () => {
      const location = await toggleLineageLocation();
      if (location === 'editor') {
        vscode.window.showInformationMessage('dbt Forge: lineage now opens in an editor tab.');
        return;
      }

      const uri = vscode.window.activeTextEditor?.document.uri;
      const index = uri ? getIndexForResource(uri) : undefined;
      const node = index?.getNodeByFileUri(uri!);
      if (index && node && isReferenceable(node)) {
        showLineage(context, index, node.unique_id, lineageView);
        return;
      }
      vscode.window.showInformationMessage(
        'dbt Forge: lineage now opens in the bottom panel. Run Show Lineage on a model to draw one.'
      );
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
  withNode(uri, (node) => node.resource_type === 'model', 'this file is not a known dbt model.', action);
}

/**
 * Same, but for the actions that make sense on anything `ref()` can point at. Lineage is the
 * case in point: a seed is a real node in the graph, so opening the lineage *of* one has to work
 * the same way opening it from the model downstream of it does.
 */
function withRefTargetNode(
  uri: vscode.Uri | undefined,
  action: (index: DbtProjectIndex, node: DbtNode) => void
): void {
  withNode(uri, isReferenceable, 'this file is not a known dbt model, seed or snapshot.', action);
}

function withNode(
  uri: vscode.Uri | undefined,
  accepts: (node: DbtNode) => boolean,
  rejectionMessage: string,
  action: (index: DbtProjectIndex, node: DbtNode) => void
): void {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    vscode.window.showWarningMessage('dbt Forge: no active file.');
    return;
  }

  const index = getIndexForResource(targetUri);
  const node = index?.getNodeByFileUri(targetUri);
  if (!index || !node || !accepts(node)) {
    vscode.window.showWarningMessage(`dbt Forge: ${rejectionMessage}`);
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

  const selectorPath = toSelectorPath(index, uri);
  if (!selectorPath) {
    vscode.window.showWarningMessage('dbt Forge: this folder is outside the dbt project.');
    return;
  }

  action(index, selectorPath);
}

/**
 * Same `path:` selector resolution as withProjectFolder(), but for a single .sql file — and,
 * unlike withModelNode(), deliberately *without* requiring the file to exist in the manifest.
 * That's the point of "Compile This File": a model that was just created or renamed isn't
 * indexed yet, so a selector has to be derivable from the file path alone (`path:` also avoids
 * guessing the model name from the filename).
 */
function withSqlFileSelector(
  uri: vscode.Uri | undefined,
  action: (index: DbtProjectIndex, selectorPath: string) => void
): void {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri || !isDbtSqlFile(targetUri)) {
    vscode.window.showWarningMessage('dbt Forge: no active SQL file.');
    return;
  }

  const index = getIndexForResource(targetUri);
  if (!index) {
    vscode.window.showWarningMessage('dbt Forge: this file is not part of an indexed dbt project.');
    return;
  }

  const selectorPath = toSelectorPath(index, targetUri);
  if (!selectorPath) {
    vscode.window.showWarningMessage('dbt Forge: this file is outside the dbt project.');
    return;
  }

  action(index, selectorPath);
}

/**
 * Resolves the tag to act on. Clicking an inline button in the Tags view passes the TagItem
 * (which already knows its project); invoking the same command from the palette passes
 * nothing, so the tag is picked from a quick pick instead.
 */
async function withTag(
  item: TagItem | undefined,
  action: (index: DbtProjectIndex, tag: string) => void
): Promise<void> {
  if (item) {
    action(item.index, item.tag);
    return;
  }

  const index = await resolveAnyIndex();
  if (!index) return;

  const tags = index.getAllTags();
  if (tags.length === 0) {
    vscode.window.showWarningMessage(
      'dbt Forge: no tags declared in this project (or the manifest predates them — try Compile Project).'
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(
    tags.map((t) => ({
      label: t.tag,
      description: `${t.modelCount} model${t.modelCount === 1 ? '' : 's'}`,
      tag: t.tag,
    })),
    { placeHolder: 'Select a tag' }
  );
  if (picked) action(index, picked.tag);
}

/** Project-relative, forward-slashed path for dbt's `path:` selector; undefined if outside. */
function toSelectorPath(index: DbtProjectIndex, uri: vscode.Uri): string | undefined {
  const relativePath = path.relative(index.getConfig().projectDir, uri.fsPath);
  if (!relativePath || relativePath.startsWith('..')) return undefined;
  return relativePath.split(path.sep).join('/');
}

function isDbtSqlFile(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' && uri.fsPath.toLowerCase().endsWith('.sql');
}

/**
 * Re-drives everything keyed off "which file is in front of the user": the relatives panel,
 * and the `dbtForge.activeFileCompilable` context key that decides which welcome view the
 * panel shows when it's empty (offer to compile this file vs. "open a model").
 */
function refreshActiveEditorViews(relativesTree: RelativesTreeProvider): void {
  const editor = vscode.window.activeTextEditor;
  relativesTree.refresh(editor);

  const uri = editor?.document.uri;
  const compilable = uri !== undefined && isDbtSqlFile(uri) && getIndexForResource(uri) !== undefined;
  void vscode.commands.executeCommand('setContext', 'dbtForge.activeFileCompilable', compilable);
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
  onIndexChanged: () => void
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const config = await resolveConfig(folder, output);
    if (!config) continue;

    const index = new DbtProjectIndex(config);
    indexes.set(folder.uri.toString(), index);
    context.subscriptions.push(index, index.onDidChange(onIndexChanged));

    output.appendLine(`dbt Forge: indexing project at ${config.projectDir}`);
    await index.initialize();
  }
}

function disposeAllIndexes(): void {
  for (const index of indexes.values()) index.dispose();
  indexes.clear();
}

/**
 * Synchronous counterpart to resolveAnyIndex() for views that have to render right now and
 * can't await a quick pick. Deliberately gives up (rather than guessing) when a multi-root
 * workspace has several dbt projects and no active editor says which one is meant.
 */
function getActiveIndex(): DbtProjectIndex | undefined {
  const active = vscode.window.activeTextEditor;
  if (active) {
    const index = getIndexForResource(active.document.uri);
    if (index) return index;
  }
  return indexes.size === 1 ? [...indexes.values()][0] : undefined;
}

export function getIndexForResource(uri: vscode.Uri): DbtProjectIndex | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return undefined;
  return indexes.get(folder.uri.toString());
}

export function deactivate(): void {
  disposeAllIndexes();
  disposeSharedTerminal();
  disposeLineagePanel();
}
