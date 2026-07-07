import * as path from 'path';
import * as vscode from 'vscode';

export interface DbtForgeConfig {
  projectDir: string; // absolute
  pythonPath: string; // absolute or empty (fallback to PATH `dbt`)
  manifestPath: string; // absolute
  catalogPath: string; // absolute
  compiledDir: string; // absolute
}

const NESTED_PROJECT_SEARCH_EXCLUDE = '**/{node_modules,target,dbt_packages,.venv,venv}/**';

/**
 * Locates the dbt project root for a workspace folder and builds its config from there.
 * Returns undefined if no dbt_project.yml can be found — directly at the folder root (the
 * common case), or nested inside it (e.g. a larger Fabric workspace with the dbt project a
 * level or two down, alongside notebooks/pipelines).
 */
export async function resolveConfig(
  workspaceFolder: vscode.WorkspaceFolder,
  output: vscode.OutputChannel
): Promise<DbtForgeConfig | undefined> {
  const projectDir = await resolveProjectDir(workspaceFolder, output);
  if (!projectDir) return undefined;

  const cfg = vscode.workspace.getConfiguration('dbtForge', workspaceFolder.uri);
  const manifestPathSetting = cfg.get<string>('manifestPath', 'target/manifest.json');
  const catalogPathSetting = cfg.get<string>('catalogPath', 'target/catalog.json');
  const compiledDirSetting = cfg.get<string>('compiledDir', 'target/compiled');

  return {
    projectDir,
    pythonPath: cfg.get<string>('pythonPath', ''), // empty string means "fall back to `dbt` on PATH"
    manifestPath: path.join(projectDir, manifestPathSetting),
    catalogPath: path.join(projectDir, catalogPathSetting),
    compiledDir: path.join(projectDir, compiledDirSetting),
  };
}

async function resolveProjectDir(
  workspaceFolder: vscode.WorkspaceFolder,
  output: vscode.OutputChannel
): Promise<string | undefined> {
  const configured = vscode.workspace
    .getConfiguration('dbtForge', workspaceFolder.uri)
    .get<string>('projectDir', '');
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(workspaceFolder.uri.fsPath, configured);
  }

  const rootMatch = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, 'dbt_project.yml'),
    null,
    1
  );
  if (rootMatch.length > 0) return workspaceFolder.uri.fsPath;

  const nestedMatches = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, '**/dbt_project.yml'),
    NESTED_PROJECT_SEARCH_EXCLUDE,
    5
  );
  if (nestedMatches.length === 0) return undefined;
  if (nestedMatches.length > 1) {
    output.appendLine(
      `dbt Forge: found multiple dbt_project.yml under ${workspaceFolder.uri.fsPath}; using ` +
        `${nestedMatches[0].fsPath}. Set "dbtForge.projectDir" to pick a specific one.`
    );
  }
  return path.dirname(nestedMatches[0].fsPath);
}
