// Builds the argv for `dbt show`, the command behind data preview. Kept free of any `vscode`
// import so the argument shape can be unit-tested directly.

/** What to preview: a model by name, or a raw SQL string compiled on the fly. */
export type ShowTarget =
  | { kind: 'node'; name: string }
  /** Jinja is still compiled, so `ref()`/`source()` work — that's what makes CTE preview possible. */
  | { kind: 'inline'; sql: string };

export const DEFAULT_ROW_LIMIT = 100;

/** dbt's own sentinel for "every row"; the only non-positive limit it accepts. */
export const NO_ROW_LIMIT = -1;

export interface ShowArgsOptions {
  rowLimit: number;
  /** `--profile`/`--target` for the selected environment, from ProfileStore.toCliArgs(). */
  profileArgs: string[];
  /** Empty when unset — dbt then looks where it normally would. Mirrors runDbtCommand. */
  profilesDir: string;
}

export function buildShowArgs(target: ShowTarget, options: ShowArgsOptions): string[] {
  // Both global flags go *before* the subcommand: passing them after it only became valid in
  // dbt 1.5, while the leading position has always worked. `--quiet` suppresses dbt's ordinary
  // logging so stdout carries the result payload rather than a run summary wrapped around it, and
  // `--no-use-colors` keeps ANSI escapes out of the error text we show when it fails.
  const args = [
    '--quiet',
    '--no-use-colors',
    'show',
    '--output',
    'json',
    '--limit',
    String(normalizeRowLimit(options.rowLimit)),
  ];

  if (target.kind === 'node') {
    args.push('--select', target.name);
  } else {
    args.push('--inline', target.sql);
  }

  args.push(...options.profileArgs);
  if (options.profilesDir) args.push('--profiles-dir', options.profilesDir);

  return args;
}

/** Anything that isn't a positive row count falls back to the default, except dbt's own -1. */
export function normalizeRowLimit(rowLimit: number): number {
  if (rowLimit === NO_ROW_LIMIT) return NO_ROW_LIMIT;
  if (!Number.isInteger(rowLimit) || rowLimit < 1) return DEFAULT_ROW_LIMIT;
  return rowLimit;
}

// Windows caps a process command line at 32767 characters, and we spawn dbt directly (no shell,
// so no shell-specific limit on top). A model whose SQL approaches that ceiling would otherwise
// fail inside CreateProcess with an error that says nothing about the actual cause.
const WINDOWS_COMMAND_LINE_LIMIT = 32767;
const COMMAND_LINE_HEADROOM = 768; // quoting and inter-argument spaces the caller can't see

/**
 * Returns a human-readable reason when the assembled command line can't be spawned, or undefined
 * when it can. Only Windows has a limit low enough to hit in practice; POSIX allows ~2MB.
 */
export function checkCommandLineLength(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (platform !== 'win32') return undefined;

  const length = executable.length + args.reduce((total, arg) => total + arg.length + 1, 0);
  if (length + COMMAND_LINE_HEADROOM <= WINDOWS_COMMAND_LINE_LIMIT) return undefined;

  return (
    `the query is too long to pass to dbt on Windows (${length} characters, limit ` +
    `${WINDOWS_COMMAND_LINE_LIMIT}). Preview a smaller CTE, or preview the model itself.`
  );
}
