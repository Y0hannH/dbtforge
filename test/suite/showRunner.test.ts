import { strict as assert } from 'assert';
import { test } from 'node:test';
import { execDbt } from '../../src/dbt/showRunner';

// dbt isn't a dependency of this repo, so the process-handling contract is verified against node
// itself standing in for the dbt binary: what matters here is how a captured child process reports
// success, failure, cancellation and a failed launch — not what dbt happens to print.
const NODE = process.execPath;
const CWD = process.cwd();

function runScript(script: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  return execDbt(NODE, ['-e', script], {
    cwd: CWD,
    timeoutMs: options.timeoutMs ?? 10_000,
    signal: options.signal,
  });
}

test('execDbt: a successful run reports code 0 and its stdout', async () => {
  const result = await runScript('console.log(JSON.stringify({m: [{a: 1}]}))');

  assert.equal(result.code, 0);
  assert.equal(result.cancelled, false);
  assert.equal(result.timedOut, false);
  assert.equal(result.spawnFailed, undefined);
  assert.ok(result.stdout.includes('"a"'));
});

test('execDbt: a non-zero exit keeps both streams instead of discarding them', async () => {
  const result = await runScript(
    'console.log("compiling"); console.error("Database Error"); process.exit(2)'
  );

  assert.equal(result.code, 2);
  assert.equal(result.cancelled, false);
  assert.equal(result.timedOut, false);
  assert.ok(result.stdout.includes('compiling'));
  assert.ok(result.stderr.includes('Database Error'));
});

test('execDbt: aborting reports cancellation, not a timeout', async () => {
  const controller = new AbortController();
  const pending = runScript('setTimeout(() => {}, 10000)', { signal: controller.signal });
  controller.abort();

  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
});

test('execDbt: exceeding the timeout reports a timeout, not a cancellation', async () => {
  const result = await runScript('setTimeout(() => {}, 10000)', { timeoutMs: 150 });

  assert.equal(result.timedOut, true);
  assert.equal(result.cancelled, false);
});

test('execDbt: a binary that cannot be launched is distinguished from one that failed', async () => {
  const result = await execDbt('dbt-forge-no-such-executable', ['--version'], {
    cwd: CWD,
    timeoutMs: 10_000,
  });

  assert.ok(result.spawnFailed);
  assert.equal(result.timedOut, false);
  assert.equal(result.cancelled, false);
});
