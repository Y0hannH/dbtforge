import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { DbtProjectIndex } from '../../src/index/dbtProjectIndex';
import type { DependencyGraph } from '../../src/index/graph';
import type { DbtNode } from '../../src/index/manifestTypes';
import type { NodeRunResult, RunOutcome } from '../../src/index/runResults';
import { buildRunStatuses, runStatusOf } from '../../src/lineage/runStatus';

const result = (outcome: RunOutcome, extra: Partial<NodeRunResult> = {}): NodeRunResult => ({
  outcome,
  status: outcome === 'passed' ? 'success' : outcome === 'failed' ? 'error' : outcome,
  command: 'build',
  ...extra,
});

function testNode(id: string): DbtNode {
  return {
    unique_id: id,
    resource_type: 'test',
    name: id,
    package_name: 'p',
    path: 't.sql',
    original_file_path: 'models/schema.yml',
  };
}

// model.p.a has two tests, model.p.b has none, model.p.c has one.
const tests: Record<string, DbtNode[]> = {
  'model.p.a': [testNode('test.p.a1'), testNode('test.p.a2')],
  'model.p.c': [testNode('test.p.c1')],
};
const parents: Record<string, string[]> = {
  'test.p.a1': ['model.p.a'],
  'test.p.a2': ['model.p.a'],
  'test.p.c1': ['model.p.c'],
};

function indexWith(results: Record<string, NodeRunResult>) {
  const graph: DependencyGraph = {
    getParents: (id) => parents[id] ?? [],
    getChildren: () => [],
    getTests: (id) => tests[id] ?? [],
    getMacroCallers: () => [],
  };
  return {
    getGraph: () => graph,
    getRunResult: (id: string) => results[id],
    getAllRunResults: () => new Map(Object.entries(results)),
  } as unknown as DbtProjectIndex;
}

void test('a passed model shows its duration', () => {
  const status = runStatusOf(
    indexWith({ 'model.p.b': result('passed', { executionTime: 4.24 }) }),
    'model.p.b',
  );

  assert.equal(status?.outcome, 'passed');
  assert.equal(status?.label, '4.2s');
});

void test('a failed model says failed, and carries dbt’s message in the tooltip', () => {
  const status = runStatusOf(
    indexWith({ 'model.p.b': result('failed', { message: 'Database Error: no such table' }) }),
    'model.p.b',
  );

  assert.equal(status?.outcome, 'failed');
  assert.equal(status?.label, 'failed');
  assert.match(status?.title ?? '', /Database Error: no such table/);
  assert.match(status?.title ?? '', /build · error/);
});

void test('a model that built fine but fails a test is not shown as passing', () => {
  const status = runStatusOf(
    indexWith({
      'model.p.a': result('passed', { executionTime: 2 }),
      'test.p.a1': result('failed', { failures: 3 }),
      'test.p.a2': result('passed'),
    }),
    'model.p.a',
  );

  assert.equal(status?.outcome, 'failed');
  assert.equal(status?.label, '2.0s · 1 test failing');
});

void test('several failing tests are counted', () => {
  const status = runStatusOf(
    indexWith({
      'model.p.a': result('passed', { executionTime: 2 }),
      'test.p.a1': result('failed'),
      'test.p.a2': result('failed'),
    }),
    'model.p.a',
  );

  assert.equal(status?.label, '2.0s · 2 tests failing');
});

void test('a warning test is a warning, not a failure', () => {
  const status = runStatusOf(
    indexWith({
      'model.p.c': result('passed', { executionTime: 1 }),
      'test.p.c1': result('warned'),
    }),
    'model.p.c',
  );

  assert.equal(status?.outcome, 'warned');
  assert.equal(status?.label, '1.0s · 1 warning');
});

void test('a model only tested — not run in that invocation — still shows its tests', () => {
  const status = runStatusOf(
    indexWith({ 'test.p.a1': result('failed'), 'test.p.a2': result('passed') }),
    'model.p.a',
  );

  assert.equal(status?.outcome, 'failed');
  assert.equal(status?.label, '1 test failing');
});

void test('a model whose tests all passed, and that was not run, says so plainly', () => {
  const status = runStatusOf(
    indexWith({ 'test.p.a1': result('passed'), 'test.p.a2': result('passed') }),
    'model.p.a',
  );

  assert.equal(status?.outcome, 'passed');
  assert.equal(status?.label, '2 tests passed');
});

void test('a node nothing was said about has no status', () => {
  assert.equal(runStatusOf(indexWith({}), 'model.p.b'), undefined);
  assert.equal(runStatusOf(indexWith({ 'model.p.a': result('passed') }), 'model.p.b'), undefined);
});

void test('a failed test reports how many rows it returned', () => {
  const status = runStatusOf(
    indexWith({ 'test.p.a1': result('failed', { failures: 12 }) }),
    'test.p.a1',
  );

  assert.equal(status?.label, 'failed · 12 rows');
});

void test('buildRunStatuses includes the model a test result belongs to', () => {
  const statuses = buildRunStatuses(indexWith({ 'test.p.c1': result('failed') }));

  assert.deepEqual(Object.keys(statuses).sort(), ['model.p.c', 'test.p.c1']);
  assert.equal(statuses['model.p.c'].outcome, 'failed');
});

void test('a long error message is cut before it reaches a tooltip', () => {
  const status = runStatusOf(
    indexWith({ 'model.p.b': result('failed', { message: 'x'.repeat(2000) }) }),
    'model.p.b',
  );

  assert.ok((status?.title.length ?? 0) < 400);
});
