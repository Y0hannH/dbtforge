import * as vscode from 'vscode';

export interface ProfileSelection {
  /** Passed as `--profile`. Undefined means "whatever dbt_project.yml points at". */
  profile?: string;
  /** Passed as `--target`. Undefined means "the profile's own `target:`". */
  target?: string;
}

const STORAGE_PREFIX = 'dbtForge.profileSelection:';

/**
 * Remembers which profile/target each dbt project runs against.
 *
 * Stored in workspaceState rather than settings: the choice is per machine and per checkout (the
 * whole point is that a dev branch points at a different Fabric workspace than main), so it has
 * no business being committed to .vscode/settings.json alongside the team's shared config.
 */
export class ProfileStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly state: vscode.Memento) {}

  get(projectDir: string): ProfileSelection {
    return this.state.get<ProfileSelection>(STORAGE_PREFIX + projectDir) ?? {};
  }

  async set(projectDir: string, selection: ProfileSelection): Promise<void> {
    const hasSelection = Boolean(selection.profile || selection.target);
    await this.state.update(STORAGE_PREFIX + projectDir, hasSelection ? selection : undefined);
    this._onDidChange.fire();
  }

  /** The `--profile`/`--target` flags for a dbt invocation; empty when nothing is overridden. */
  toCliArgs(projectDir: string): string[] {
    const { profile, target } = this.get(projectDir);
    const args: string[] = [];
    if (profile) args.push('--profile', profile);
    if (target) args.push('--target', target);
    return args;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
