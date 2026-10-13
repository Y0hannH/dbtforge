// The dbt arguments behind the state-aware builds. Kept free of `vscode` so the shape can be
// unit-tested, like showCommand.

import * as path from 'path';

/** The reference folder as an absolute path — a relative setting is relative to the project. */
export function resolveStateDir(projectDir: string, setting: string): string {
  const trimmed = setting.trim();
  if (!trimmed) return '';
  return path.isAbsolute(trimmed) ? trimmed : path.join(projectDir, trimmed);
}

/**
 * `dbt build --select state:modified+ --defer --state <dir>`: what changed against the reference,
 * and everything downstream of it.
 *
 * `--defer` is always there. The upstream models of a modified node are not selected, so without it
 * their `ref()`s resolve to the *current* target — which has never had them built, on a fresh
 * development schema — and the build fails on the first one. Deferring sends those refs to the
 * reference environment instead, which is the whole point of building only what changed.
 */
export function buildModifiedArgs(stateDir: string): string[] {
  return ['build', '--select', 'state:modified+', '--defer', '--state', stateDir];
}

/** One selection, built on top of the reference environment: `selector` is a name or `path:…`. */
export function buildDeferredArgs(selector: string, stateDir: string): string[] {
  return ['build', '--select', selector, '--defer', '--state', stateDir];
}
