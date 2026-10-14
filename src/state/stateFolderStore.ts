import { createHash } from 'crypto';
import * as path from 'path';
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

/**
 * Where a project's saved copy of its own manifest lives, under the extension's storage.
 *
 * Inside the extension's storage and never in the project: dbt Forge reads a project's files and
 * does not add to them, so a reference never shows up in `git status` or in a commit. Keyed by the
 * project's full path — two projects can share a folder name — with the name kept for whoever
 * opens the folder to see what it is.
 */
export function savedReferenceDir(storageRoot: string, projectDir: string): string {
  const hash = createHash('sha256').update(projectDir).digest('hex').slice(0, 10);
  return path.join(storageRoot, 'reference', `${path.basename(projectDir)}-${hash}`);
}
