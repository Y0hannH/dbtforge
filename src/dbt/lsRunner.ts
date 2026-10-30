// Runs `dbt ls` as a captured child process and returns the ids it selected. Like `dbt show`, this
// has to read what dbt printed, so it cannot use the shared terminal the build commands go through.

import { resolveDbtExecutable } from './executable';
import { buildLsArgs, parseLsOutput } from './lsCommand';
import { extractDbtError } from './showOutput';
import { execDbt } from './showRunner';

export interface DbtLsRequest {
  /** Python inside the project's venv; empty falls back to `dbt` on PATH, as elsewhere. */
  pythonPath: string;
  projectDir: string;
  profilesDir: string;
  profileArgs: string[];
  select: string;
  exclude: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Where dbt's output goes when it can't be read; the output channel in the extension. */
  log?: (text: string) => void;
}

/** A failure worth showing the user, with dbt's own words kept aside for the output channel. */
export class DbtLsError extends Error {
  constructor(
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'DbtLsError';
  }
}

export class DbtLsCancelledError extends Error {
  constructor() {
    super('Selection cancelled.');
    this.name = 'DbtLsCancelledError';
  }
}

// `ls` parses the project but never queries the warehouse, so this is a ceiling on a slow parse of
// a large project, not on a query. It is long enough not to cut one off and short enough not to
// leave the Run button spinning for good.
const DEFAULT_TIMEOUT_MS = 120_000;

// Enough to see the shape of what dbt printed; a node's JSON is long and a project has many.
const UNREAD_OUTPUT_CHARS = 2000;

export async function runDbtLs(request: DbtLsRequest): Promise<string[]> {
  const executable = resolveDbtExecutable(request.pythonPath);
  if (!executable) {
    throw new DbtLsError(
      `no "dbt" executable found next to the configured pythonPath (${request.pythonPath}). ` +
        'Make sure dbt-core is installed in that venv.',
    );
  }

  // Throws SelectorSyntaxError for an empty selection or a term dbt would read as an option; the
  // message is already written for the person who typed it.
  const args = buildLsArgs(request);
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const result = await execDbt(executable, args, {
    cwd: request.projectDir,
    signal: request.signal,
    timeoutMs,
  });

  if (result.cancelled) throw new DbtLsCancelledError();

  if (result.timedOut) {
    throw new DbtLsError(
      `dbt ls did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped.`,
      extractDbtError(result.stdout, result.stderr),
    );
  }

  if (result.spawnFailed) {
    throw new DbtLsError(`could not start dbt (${executable}): ${result.spawnFailed}`);
  }

  // Typically a selection dbt can't parse or a profile that doesn't load — `ls` reads the profile
  // even though it never connects.
  if (result.code !== 0) {
    throw new DbtLsError(
      'dbt ls failed. See the dbt Forge output channel for the full error.',
      extractDbtError(result.stdout, result.stderr),
    );
  }

  const ids = parseLsOutput(result.stdout);

  // Nothing read from output that was not empty is not the same as dbt matching nothing: it means
  // dbt printed in a shape we don't understand, and the user is otherwise told "no nodes".
  if (ids.length === 0 && result.stdout.trim() && request.log) {
    request.log(
      `dbt ls printed output but no node could be read from it.\n` +
        `command: ${executable} ${args.join(' ')}\n${result.stdout.slice(0, UNREAD_OUTPUT_CHARS)}`,
    );
  }
  return ids;
}
