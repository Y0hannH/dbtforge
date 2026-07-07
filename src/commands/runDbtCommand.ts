import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DbtForgeConfig } from '../config';

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
  const dbtExecutable = resolveDbtExecutable(config);
  if (!dbtExecutable) {
    vscode.window.showErrorMessage(
      `dbt Forge: no "dbt" executable found next to the configured pythonPath (${config.pythonPath}). Make sure dbt-core is installed in that venv.`
    );
    return;
  }

  const terminal = getTerminal();
  terminal.show();
  terminal.sendText(`cd ${quotePath(config.projectDir)}`);
  terminal.sendText(`${quoteExecutable(dbtExecutable)} ${args.join(' ')}`);
}

// dbt-core has no `__main__.py`, so `python -m dbt` always fails with
// "No module named dbt.__main__; 'dbt' is a package and cannot be directly executed" —
// the venv's own `dbt` script (installed next to python.exe via its console-script entry
// point) has to be invoked directly instead.
function resolveDbtExecutable(config: DbtForgeConfig): string | undefined {
  if (!config.pythonPath) return 'dbt'; // no venv configured: fall back to PATH

  const scriptsDir = path.dirname(config.pythonPath);
  const candidate = path.join(scriptsDir, process.platform === 'win32' ? 'dbt.exe' : 'dbt');
  return fs.existsSync(candidate) ? candidate : undefined;
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
