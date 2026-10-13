// What a dbt invocation wrote to run_results.json, reduced to what dbt Forge shows. Like the
// manifest types this is a subset: the file carries timings per phase, adapter responses and the
// compiled code of every node, none of which anything here reads.

/** The four things worth telling apart on a node. dbt's own word stays in `status`. */
export type RunOutcome = 'passed' | 'warned' | 'failed' | 'skipped';

export interface NodeRunResult {
  outcome: RunOutcome;
  /** dbt's own word for it: 'success', 'pass', 'fail', 'error', 'warn', 'skipped'… */
  status: string;
  /** The dbt command that produced it — 'build', 'run', 'test'… */
  command: string;
  /** Seconds, as dbt measured it. */
  executionTime?: number;
  /** For a test: how many rows it returned, i.e. how many failures. */
  failures?: number;
  message?: string;
  /** When the invocation wrote the file (`metadata.generated_at`), as dbt recorded it. */
  generatedAt?: string;
}

// An invocation that *executes* nodes. `compile`, `docs generate`, `show` and the like write a
// run_results.json too, with every node 'success' — which would read as "this model ran fine"
// when all that happened is that its SQL was rendered. Those are left out rather than guessed at,
// and so is a file that doesn't say which command wrote it.
//
// `retry` is here because it re-executes what failed; whether dbt records it as itself or as the
// command it retried, one of the two is in this set.
const EXECUTING_COMMANDS: ReadonlySet<string> = new Set([
  'run',
  'build',
  'test',
  'seed',
  'snapshot',
  'retry',
]);

// dbt's statuses across resource types and versions. Anything not listed is skipped, not mapped
// to a default: a status this does not know is not evidence of success or of failure.
const OUTCOME_BY_STATUS: Readonly<Record<string, RunOutcome>> = {
  success: 'passed',
  pass: 'passed',
  warn: 'warned',
  // A microbatch model with some batches failed: built, but not all of it.
  'partial success': 'warned',
  error: 'failed',
  fail: 'failed',
  'runtime error': 'failed',
  skipped: 'skipped',
};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The results of one invocation, by unique_id. Empty — never throws — for anything that is not a
 * run_results.json of a command that executed nodes: a file mid-write, one from another tool, or
 * the output of `dbt compile`.
 */
export function parseRunResults(raw: unknown): Map<string, NodeRunResult> {
  const results = new Map<string, NodeRunResult>();
  if (!isRecord(raw)) return results;

  const args = isRecord(raw.args) ? raw.args : undefined;
  const command = asString(args?.which);
  if (!command || !EXECUTING_COMMANDS.has(command)) return results;

  const generatedAt = isRecord(raw.metadata) ? asString(raw.metadata.generated_at) : undefined;
  if (!Array.isArray(raw.results)) return results;

  for (const entry of raw.results) {
    if (!isRecord(entry)) continue;
    const uniqueId = asString(entry.unique_id);
    const status = asString(entry.status);
    const outcome = status === undefined ? undefined : OUTCOME_BY_STATUS[status.toLowerCase()];
    if (!uniqueId || !status || !outcome) continue;

    results.set(uniqueId, {
      outcome,
      status,
      command,
      executionTime: asNumber(entry.execution_time),
      // `failures` is null on anything that is not a test.
      failures: asNumber(entry.failures),
      message: asString(entry.message),
      generatedAt,
    });
  }

  return results;
}

/** 430ms, 4.2s, 2m 05s — compact enough for the row of a lineage node. */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

const SEVERITY: Record<RunOutcome, number> = { passed: 0, skipped: 1, warned: 2, failed: 3 };

/** The worse of two outcomes — what a node shows when its own run and its tests disagree. */
export function worseOutcome(left: RunOutcome, right: RunOutcome): RunOutcome {
  return SEVERITY[right] > SEVERITY[left] ? right : left;
}
