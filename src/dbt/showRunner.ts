// Runs `dbt show` as a captured child process and returns its rows.
//
// This is deliberately not the terminal path used by every other dbt command in the extension:
// runDbtCommand() sends text to a shared integrated terminal and never sees the output, which is
// right for a build the user wants to watch, but a preview has to read what dbt printed. Spawning
// directly (no shell) also means arguments need no quoting, so a model name or a CTE query
// containing spaces or quotes can't be mangled on the way in.

import { execFile } from 'child_process';
import { resolveDbtExecutable } from './executable';
import { ShowTarget, buildShowArgs, checkCommandLineLength } from './showCommand';
import { PreviewTable, ShowOutputError, extractDbtError, parseShowOutput } from './showOutput';

export interface DbtShowRequest {
  /** Python inside the project's venv; empty falls back to `dbt` on PATH, as elsewhere. */
  pythonPath: string;
  projectDir: string;
  profilesDir: string;
  profileArgs: string[];
  rowLimit: number;
  target: ShowTarget;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** A failure worth showing the user, with dbt's own words kept aside for the output channel. */
export class DbtShowError extends Error {
  constructor(
    message: string,
    readonly details?: string
  ) {
    super(message);
    this.name = 'DbtShowError';
  }
}

export class DbtShowCancelledError extends Error {
  constructor() {
    super('Preview cancelled.');
    this.name = 'DbtShowCancelledError';
  }
}

// A preview runs a real query against the warehouse, so the ceiling is about not leaving a
// spinner up forever, not about how fast the query "should" be.
const DEFAULT_TIMEOUT_MS = 120_000;

// `--limit -1` on a wide table can print far more than the 1MB execFile default, and truncated
// stdout would surface as a JSON parse error rather than as the size problem it actually is.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export async function runDbtShow(request: DbtShowRequest): Promise<PreviewTable> {
  const executable = resolveDbtExecutable(request.pythonPath);
  if (!executable) {
    throw new DbtShowError(
      `no "dbt" executable found next to the configured pythonPath (${request.pythonPath}). ` +
        'Make sure dbt-core is installed in that venv.'
    );
  }

  const args = buildShowArgs(request.target, {
    rowLimit: request.rowLimit,
    profileArgs: request.profileArgs,
    profilesDir: request.profilesDir,
  });

  const tooLong = checkCommandLineLength(executable, args);
  if (tooLong) throw new DbtShowError(tooLong);

  const result = await execDbt(executable, args, {
    cwd: request.projectDir,
    signal: request.signal,
    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  if (result.cancelled) throw new DbtShowCancelledError();

  if (result.timedOut) {
    throw new DbtShowError(
      `dbt show did not finish within ${Math.round((request.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s ` +
        'and was stopped. The query may still be running on the warehouse.',
      extractDbtError(result.stdout, result.stderr)
    );
  }

  if (result.spawnFailed) {
    throw new DbtShowError(`could not start dbt (${executable}): ${result.spawnFailed}`);
  }

  // dbt exits non-zero on a compilation or database error; its message is the useful part, not
  // the exit code. Note that a preview only compiles the *selected* model — its `ref()`s still
  // resolve to relations that have to exist in the warehouse.
  if (result.code !== 0) {
    throw new DbtShowError(
      'dbt show failed. See the dbt Forge output channel for the full error.',
      extractDbtError(result.stdout, result.stderr)
    );
  }

  try {
    return parseShowOutput(result.stdout);
  } catch (error) {
    if (error instanceof ShowOutputError) {
      throw new DbtShowError(error.message, extractDbtError(result.stdout, result.stderr));
    }
    throw error;
  }
}

export interface DbtExecution {
  code: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
  /** Set when the process never started at all (dbt not on PATH, cwd missing). */
  spawnFailed?: string;
}

interface ExecDbtOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export function execDbt(
  executable: string,
  args: string[],
  options: ExecDbtOptions
): Promise<DbtExecution> {
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      {
        cwd: options.cwd,
        signal: options.signal,
        timeout: options.timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr, cancelled: false, timedOut: false });
          return;
        }

        // execFile reports both cancellation and its own timeout by killing the process; only the
        // caller's AbortSignal distinguishes the first, since the error name is the same either way.
        const cancelled = options.signal?.aborted === true;
        const killed = hasKilledFlag(error);

        resolve({
          code: typeof error.code === 'number' ? error.code : null,
          stdout,
          stderr,
          cancelled,
          timedOut: !cancelled && killed,
          spawnFailed: isSpawnFailure(error) ? error.message : undefined,
        });
      }
    );
  });
}

function hasKilledFlag(error: unknown): boolean {
  return Boolean((error as { killed?: boolean }).killed) || (error as Error).name === 'AbortError';
}

/** ENOENT/EACCES mean the binary itself couldn't be launched, as opposed to dbt running and failing. */
function isSpawnFailure(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'EACCES';
}
