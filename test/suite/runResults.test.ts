import { test } from 'node:test';

import { strict as assert } from 'assert';

import { formatDuration, parseRunResults, worseOutcome } from '../../src/index/runResults';

function file(which: string | undefined, results: unknown[], generatedAt = '2026-10-13T14:02:11Z') {
  return {
    metadata: { generated_at: generatedAt },
    args: which === undefined ? {} : { which },
    results,
  };
}

const entry = (unique_id: string, status: string, extra: object = {}) => ({
  unique_id,
  status,
  execution_time: 1.5,
  failures: null,
  message: null,
  ...extra,
});

void test('parseRunResults maps the statuses dbt writes onto four outcomes', () => {
  const parsed = parseRunResults(
    file('build', [
      entry('model.p.a', 'success'),
      entry('test.p.b', 'pass'),
      entry('test.p.c', 'warn'),
      entry('model.p.d', 'partial success'),
      entry('model.p.e', 'error'),
      entry('test.p.f', 'fail'),
      entry('test.p.g', 'runtime error'),
      entry('model.p.h', 'skipped'),
    ]),
  );

  const outcomes = Object.fromEntries([...parsed].map(([id, r]) => [id, r.outcome]));
  assert.deepEqual(outcomes, {
    'model.p.a': 'passed',
    'test.p.b': 'passed',
    'test.p.c': 'warned',
    'model.p.d': 'warned',
    'model.p.e': 'failed',
    'test.p.f': 'failed',
    'test.p.g': 'failed',
    'model.p.h': 'skipped',
  });
});

void test('parseRunResults keeps dbt’s own words and numbers', () => {
  const [result] = [
    ...parseRunResults(
      file('test', [
        entry('test.p.x', 'fail', { execution_time: 0.43, failures: 3, message: 'Got 3 results' }),
      ]),
    ).values(),
  ];

  assert.equal(result.status, 'fail');
  assert.equal(result.command, 'test');
  assert.equal(result.executionTime, 0.43);
  assert.equal(result.failures, 3);
  assert.equal(result.message, 'Got 3 results');
  assert.equal(result.generatedAt, '2026-10-13T14:02:11Z');
});

void test('parseRunResults ignores an invocation that did not execute the nodes', () => {
  // A compile marks every node 'success' — which is not "ran fine".
  for (const which of ['compile', 'docs generate', 'show', 'run-operation', 'list']) {
    assert.equal(parseRunResults(file(which, [entry('model.p.a', 'success')])).size, 0, which);
  }
});

void test('parseRunResults accepts the commands that execute nodes', () => {
  for (const which of ['run', 'build', 'test', 'seed', 'snapshot', 'retry']) {
    assert.equal(parseRunResults(file(which, [entry('model.p.a', 'success')])).size, 1, which);
  }
});

void test('parseRunResults says nothing when the file does not name its command', () => {
  assert.equal(parseRunResults(file(undefined, [entry('model.p.a', 'success')])).size, 0);
});

void test('parseRunResults skips a status it does not know instead of calling it a success', () => {
  const parsed = parseRunResults(
    file('run', [entry('model.p.a', 'something-new'), entry('model.p.b', 'success')]),
  );

  assert.deepEqual([...parsed.keys()], ['model.p.b']);
});

void test('parseRunResults survives anything that is not a run_results.json', () => {
  for (const raw of [undefined, null, 42, 'text', [], {}, { args: { which: 'run' } }]) {
    assert.equal(parseRunResults(raw).size, 0);
  }
  assert.equal(
    parseRunResults(file('run', [null, 7, { status: 'success' }, { unique_id: 'x' }])).size,
    0,
  );
});

void test('formatDuration is compact at every scale', () => {
  assert.equal(formatDuration(0.43), '430ms');
  assert.equal(formatDuration(4.24), '4.2s');
  assert.equal(formatDuration(59.9), '59.9s');
  assert.equal(formatDuration(125), '2m 05s');
});

void test('worseOutcome orders failed above warned above skipped above passed', () => {
  assert.equal(worseOutcome('passed', 'failed'), 'failed');
  assert.equal(worseOutcome('failed', 'passed'), 'failed');
  assert.equal(worseOutcome('warned', 'skipped'), 'warned');
  assert.equal(worseOutcome('passed', 'skipped'), 'skipped');
  assert.equal(worseOutcome('passed', 'passed'), 'passed');
});
