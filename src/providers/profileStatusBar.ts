import * as vscode from 'vscode';
import { DbtForgeConfig } from '../config';
import { ProfileStore } from '../profiles/profileStore';

/**
 * Status bar item showing which profile/target the next dbt command will use, and opening the
 * picker when clicked. Follows the active editor, so a multi-root workspace with several dbt
 * projects shows the environment of the project being edited.
 */
export class ProfileStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: ProfileStore,
    /** The project the status bar speaks for: the active editor's, or the only one indexed. */
    private readonly getActiveConfig: () => DbtForgeConfig | undefined
  ) {
    // Just left of the git branch indicator, which is the sibling piece of "where am I" context.
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'dbtForge.selectProfile';
    this.disposables.push(
      this.item,
      store.onDidChange(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh())
    );
    this.refresh();
  }

  refresh(): void {
    const config = this.getActiveConfig();
    if (!config) {
      this.item.hide();
      return;
    }

    const selection = this.store.get(config.projectDir);
    const label = [selection.profile, selection.target].filter(Boolean).join(' / ');

    this.item.text = `$(server-environment) dbt: ${label || 'default'}`;
    this.item.tooltip = label
      ? `dbt Forge runs dbt with: --profile ${selection.profile}${selection.target ? ` --target ${selection.target}` : ''}\nClick to switch environment`
      : 'dbt Forge runs dbt with the profiles.yml default (no --profile/--target)\nClick to switch environment';
    // A forced environment is worth noticing at a glance — an unnoticed --profile pointing at the
    // wrong workspace is exactly the mistake this feature exists to prevent.
    this.item.backgroundColor = label
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    this.item.show();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}
