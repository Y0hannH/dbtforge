// Builds the argv for `dbt ls` and reads what it prints, for the lineage's selector field. Kept
// free of any `vscode` import so both halves can be unit-tested directly.

/** A selection the user typed that cannot be handed to dbt as it is. */
export class SelectorSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectorSyntaxError';
  }
}

export interface LsArgsOptions {
  /** dbt selection syntax, as typed: space-separated terms are a union, commas an intersection. */
  select: string;
  /** Same syntax, passed as `--exclude`. May be empty. */
  exclude: string;
  /** `--profile`/`--target` for the selected environment, from ProfileStore.toCliArgs(). */
  profileArgs: string[];
  /** Empty when unset — dbt then looks where it normally would. Mirrors runDbtCommand. */
  profilesDir: string;
}

export function buildLsArgs(options: LsArgsOptions): string[] {
  const select = splitSelector(options.select);
  // `dbt ls` with no selection lists the whole project, which is the opposite of a selection and
  // would only ever come back as "too many nodes".
  if (select.length === 0) throw new SelectorSyntaxError('Type a selection to run.');
  const exclude = splitSelector(options.exclude);

  // Same flag placement as `dbt show`: global flags before the subcommand, where they have always
  // been valid. `--quiet` keeps dbt's log lines out of stdout so it carries only the node list.
  const args = ['--quiet', '--no-use-colors', 'ls', '--output', 'json', '--select', ...select];
  if (exclude.length > 0) args.push('--exclude', ...exclude);

  args.push(...options.profileArgs);
  if (options.profilesDir) args.push('--profiles-dir', options.profilesDir);

  return args;
}

/**
 * Splits a selection into the separate arguments dbt expects after `--select`.
 *
 * dbt takes a union as several arguments, not as one string with spaces, and the process is spawned
 * without a shell, so there is no quoting to lean on. A term starting with `-` is refused for the
 * same reason: handed over as an argument it would be read as one of dbt's own flags
 * (`--vars`, `--target`), and a selection field has no business changing those.
 */
export function splitSelector(text: string): string[] {
  const terms = text.split(/\s+/).filter((term) => term.length > 0);
  const flag = terms.find((term) => term.startsWith('-'));
  if (flag !== undefined) {
    throw new SelectorSyntaxError(
      `"${flag}" looks like a dbt option, not a selection. Terms can't start with "-".`,
    );
  }
  return terms;
}

/**
 * The `unique_id` of every node in `dbt ls --output json`, in the order printed, once each.
 *
 * Only lines that are a JSON object with a string `unique_id` count. Anything else on stdout — a
 * deprecation warning, a banner a wrapper script prints — is not a node, and reading it as one
 * would turn noise into a missing-node count.
 */
export function parseLsOutput(stdout: string): string[] {
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const id = (parsed as { unique_id?: unknown } | null)?.unique_id;
    if (typeof id === 'string') seen.add(id);
  }
  return [...seen];
}
