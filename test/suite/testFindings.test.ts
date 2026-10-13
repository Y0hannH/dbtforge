import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { DbtNode, LineageEntity } from '../../src/index/manifestTypes';
import type { NodeRunResult, RunOutcome } from '../../src/index/runResults';
import { collectTestFindings } from '../../src/index/testFindings';

const result = (outcome: RunOutcome, extra: Partial<NodeRunResult> = {}): NodeRunResult => ({
  outcome,
  status: outcome === 'failed' ? 'fail' : outcome,
  command: 'build',
  generatedAt: '2026-10-13T14:02:11Z',
  ...extra,
});

function node(uniqueId: string, extra: Partial<DbtNode> = {}): DbtNode {
  return {
    unique_id: uniqueId,
    resource_type: 'test',
    name: uniqueId.split('.')[2],
    package_name: 'p',
    path: 't.sql',
    original_file_path: 'models/schema.yml',
    ...extra,
  };
}

const entities: Record<string, DbtNode | LineageEntity> = {
  'model.p.fct_orders': node('model.p.fct_orders', { resource_type: 'model', name: 'fct_orders' }),
  'source.p.raw.orders': {
    unique_id: 'source.p.raw.orders',
    resource_type: 'source',
    name: 'orders',
    source_name: 'raw',
    package_name: 'p',
    original_file_path: 'models/sources.yml',
  },
  'test.p.unique_fct_orders_order_id': node('test.p.unique_fct_orders_order_id', {
    attached_node: 'model.p.fct_orders',
    column_name: 'order_id',
    test_metadata: { name: 'unique' },
  }),
  'test.p.not_null_orders_id': node('test.p.not_null_orders_id', {
    attached_node: 'source.p.raw.orders',
    column_name: 'id',
    test_metadata: { name: 'not_null' },
  }),
  'test.p.assert_positive_totals': node('test.p.assert_positive_totals', {
    original_file_path: 'tests/assert_positive_totals.sql',
  }),
  'test.p.legacy': node('test.p.legacy', {
    file_key_name: 'models.fct_orders',
    column_name: 'order_id',
    test_metadata: { name: 'unique' },
  }),
};

function sourceWith(results: Record<string, NodeRunResult>) {
  return {
    getAllRunResults: () => new Map(Object.entries(results)),
    getAnyEntity: (id: string) => entities[id] as DbtNode | undefined,
    getLineageEntity: (id: string) => entities[id] as LineageEntity | undefined,
  };
}

void test('a failed test is an error that names the test, the column and the rows', () => {
  const [finding] = collectTestFindings(
    sourceWith({ 'test.p.unique_fct_orders_order_id': result('failed', { failures: 3 }) }),
  );

  assert.equal(finding.severity, 'error');
  assert.match(finding.message, /Test "unique" on fct_orders\.order_id failed — 3 rows returned\./);
  assert.match(finding.message, /Last run: .* \(dbt build\)\./);
  assert.deepEqual(finding.target, {
    section: 'models',
    name: 'fct_orders',
    sourceName: undefined,
    columnName: 'order_id',
    testName: 'unique',
    namespace: undefined,
  });
});

void test('a warning test is a warning', () => {
  const [finding] = collectTestFindings(
    sourceWith({ 'test.p.unique_fct_orders_order_id': result('warned', { failures: 1 }) }),
  );

  assert.equal(finding.severity, 'warning');
  assert.match(finding.message, /warned — 1 row returned/);
});

void test('passed and skipped tests, and models, are not findings', () => {
  const findings = collectTestFindings(
    sourceWith({
      'test.p.unique_fct_orders_order_id': result('passed'),
      'test.p.not_null_orders_id': result('skipped'),
      'model.p.fct_orders': result('failed'),
    }),
  );

  assert.deepEqual(findings, []);
});

void test('a test on a source targets its table, with the source it belongs to', () => {
  const [finding] = collectTestFindings(
    sourceWith({ 'test.p.not_null_orders_id': result('failed', { failures: 2 }) }),
  );

  assert.equal(finding.target?.section, 'sources');
  assert.equal(finding.target?.name, 'orders');
  assert.equal(finding.target?.sourceName, 'raw');
});

void test('a singular test has no target and is named by its own name', () => {
  const [finding] = collectTestFindings(
    sourceWith({ 'test.p.assert_positive_totals': result('failed', { failures: 5 }) }),
  );

  assert.equal(finding.target, undefined);
  assert.match(finding.message, /^Test "assert_positive_totals" failed — 5 rows returned\./);
});

void test('a manifest without attached_node is located through file_key_name', () => {
  const [finding] = collectTestFindings(
    sourceWith({ 'test.p.legacy': result('failed', { failures: 1 }) }),
  );

  assert.equal(finding.target?.section, 'models');
  assert.equal(finding.target?.name, 'fct_orders');
});

void test('a test that errored without rows carries dbt’s own message', () => {
  const [finding] = collectTestFindings(
    sourceWith({
      'test.p.unique_fct_orders_order_id': result('failed', {
        status: 'error',
        message: 'Compilation Error in test:\n  column "x" does not exist',
      }),
    }),
  );

  assert.match(finding.message, /failed — Compilation Error in test: column "x" does not exist\./);
});

void test('findings come back in a stable order', () => {
  const findings = collectTestFindings(
    sourceWith({
      'test.p.unique_fct_orders_order_id': result('failed', { failures: 1 }),
      'test.p.assert_positive_totals': result('failed', { failures: 1 }),
      'test.p.not_null_orders_id': result('warned', { failures: 1 }),
    }),
  );

  assert.deepEqual(
    findings.map((f) => f.node.name),
    ['assert_positive_totals', 'not_null_orders_id', 'unique_fct_orders_order_id'],
  );
});
