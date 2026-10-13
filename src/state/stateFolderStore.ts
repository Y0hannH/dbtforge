import type * as vscode from 'vscode';

const STORAGE_PREFIX = 'dbtForge.stateFolder:';

/**
 * Remembers which folder holds each project's reference manifest.
 *
 * Stored in workspaceState rather than in settings, for the reason the environment choice is: the
 * folder is a path on this machine — a download of a CI artefact, a checkout of main — and has no
 * business being committed to .vscode/settings.json for the whole team. `dbtForge.stateDir` stays
 * for anyone who wants a project-relative path committed; a choice made here overrides it.
 */
export class StateFolderStore {
  constructor(private readonly state: vscode.Memento) {}

  get(projectDir: string): string | undefined {
    return this.state.get<string>(STORAGE_PREFIX + projectDir) || undefined;
  }

  async set(projectDir: string, folder: string | undefined): Promise<void> {
    await this.state.update(STORAGE_PREFIX + projectDir, folder);
  }
}
