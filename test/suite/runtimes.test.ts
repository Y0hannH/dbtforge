import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { DbtNode } from '../../src/index/manifestTypes';
import type { NodeRunResult, RunOutcome } from '../../src/index/runResults';
import { slowestFirst } from '../../src/index/runtimes';

function node(uniqueId: string, resourceType = 'model'): DbtNode {
  return {
    unique_id: uniqueId,
    resource_type: resourceType,
    name: uniqueId.split('.').pop() ?? uniqueId,
    package_name: 'p',
    path: 'x.sql',
    original_file_path: 'models/x.sql',
  };
}

const result = (outcome: RunOutcome, executionTime?: number): NodeRunResult => ({
  outcome,
  status: outcome === 'passed' ? 'success' : outcome,
  command: 'build',
  executionTime,
});

const nodes: Record<string, DbtNode> = {
  'model.p.fast': node('model.p.fast'),
  'model.p.slow': node('model.p.slow'),
  'model.p.medium': node('model.p.medium'),
  'model.p.broken': node('model.p.broken'),
  'model.p.skipped': node('model.p.skipped'),
  'model.p.untimed': node('model.p.untimed'),
  'seed.p.countries': node('seed.p.countries', 'seed'),
  'snapshot.p.history': node('snapshot.p.history', 'snapshot'),
  'test.p.not_null': node('test.p.not_null', 'test'),
  'unit_test.p.check': node('unit_test.p.check', 'unit_test'),
};

const ids = (results: Record<string, NodeRunResult>): string[] =>
  slowestFirst(new Map(Object.entries(results)), (id) => nodes[id]).map((r) => r.node.unique_id);

void test('models come slowest first', () => {
  assert.deepEqual(
    ids({
      'model.p.fast': result('passed', 0.4),
      'model.p.slow': result('passed', 125),
      'model.p.medium': result('passed', 12.3),
    }),
    ['model.p.slow', 'model.p.medium', 'model.p.fast'],
  );
});

void test('a failed or warned model keeps its place: the time was still spent', () => {
  assert.deepEqual(
    ids({
      'model.p.fast': result('passed', 1),
      'model.p.broken': result('failed', 40),
      'model.p.medium': result('warned', 5),
    }),
    ['model.p.broken', 'model.p.medium', 'model.p.fast'],
  );
});

void test('skipped and untimed results are left out', () => {
  assert.deepEqual(
    ids({
      'model.p.fast': result('passed', 1),
      'model.p.skipped': result('skipped', 0),
      'model.p.untimed': result('passed'),
    }),
    ['model.p.fast'],
  );
});

void test('seeds and snapshots are listed, tests and unit tests are not', () => {
  assert.deepEqual(
    ids({
      'seed.p.countries': result('passed', 3),
      'snapshot.p.history': result('passed', 8),
      'test.p.not_null': result('passed', 90),
      'unit_test.p.check': result('passed', 60),
    }),
    ['snapshot.p.history', 'seed.p.countries'],
  );
});

void test('a result whose node left the manifest is dropped', () => {
  assert.deepEqual(
    ids({ 'model.p.renamed_away': result('passed', 99), 'model.p.fast': result('passed', 1) }),
    ['model.p.fast'],
  );
});

void test('equal times keep a stable order', () => {
  assert.deepEqual(
    ids({ 'model.p.slow': result('passed', 2), 'model.p.fast': result('passed', 2) }),
    ['model.p.fast', 'model.p.slow'],
  );
});
