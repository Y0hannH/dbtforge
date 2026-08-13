import * as vscode from 'vscode';
import { DbtForgeConfig } from '../config';
import { resolveDbtExecutable } from '../dbt/executable';

let sharedTerminal: vscode.Terminal | undefined;

export function disposeSharedTerminal(): void {
  sharedTerminal?.dispose();
  sharedTerminal = undefined;
}

export function handleTerminalClosed(closed: vscode.Terminal): void {
  if (closed === sharedTerminal) sharedTerminal = undefined;
}

function getTerminal(): vscode.Terminal {
  if (!sharedTerminal || sharedTerminal.exitStatus !== undefined) {
    sharedTerminal = vscode.window.createTerminal('dbt Forge');
  }
  return sharedTerminal;
}

/** Runs a dbt subcommand (e.g. ["build", "--select", "+my_model"]) in a shared integrated terminal. */
export function runDbtCommand(config: DbtForgeConfig, args: string[]): void {
  const dbtExecutable = resolveDbtExecutable(config.pythonPath);
  if (!dbtExecutable) {
    vscode.window.showErrorMessage(
      `dbt Forge: no "dbt" executable found next to the configured pythonPath (${config.pythonPath}). Make sure dbt-core is installed in that venv.`
    );
    return;
  }

  const terminal = getTerminal();
  terminal.show();
  terminal.sendText(`cd ${quotePath(config.projectDir)}`);
  terminal.sendText(`${quoteExecutable(dbtExecutable)} ${[...args, ...profilesDirArgs(config)].join(' ')}`);
}

// Only passed when the location is configured: dbt already looks in DBT_PROFILES_DIR, in the
// working directory (which is the project dir here) and in ~/.dbt on its own, and spelling those
// out on every command line would be noise.
function profilesDirArgs(config: DbtForgeConfig): string[] {
  return config.profilesDir ? ['--profiles-dir', quotePath(config.profilesDir)] : [];
}

function quotePath(p: string): string {
  return p.includes(' ') ? `"${p}"` : p;
}

// PowerShell (unlike cmd.exe/bash) requires the call operator `&` before a quoted path used
// as the command itself. Detect the default integrated shell to avoid a "not recognized"
// error on venv paths with spaces (e.g. "C:/My Projects/proj/.venv/Scripts/dbt.exe").
function quoteExecutable(execPath: string): string {
  const quoted = quotePath(execPath);
  const isQuoted = quoted !== execPath;
  if (!isQuoted) return quoted;

  const shell = (vscode.env.shell || '').toLowerCase();
  const isPowerShell = shell.includes('powershell') || shell.includes('pwsh');
  return isPowerShell ? `& ${quoted}` : quoted;
}
