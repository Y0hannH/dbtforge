import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { DbtExposureNode, DbtNode, DbtSourceNode } from '../../src/index/manifestTypes';
import { DEFAULT_SCOPE, UNLIMITED_DEPTH } from '../../src/lineage/lineageScope';
import {
  describeSelectorOutcome,
  partitionMatches,
  rootSelector,
  selectorFromScope,
} from '../../src/lineage/lineageSelection';
import type { SelectorCounts } from '../../src/lineage/messages';

const scope = (upstreamDepth: number, downstreamDepth: number) => ({
  ...DEFAULT_SCOPE,
  upstreamDepth,
  downstreamDepth,
});

void test('selectorFromScope: writes the depths the way dbt reads them', () => {
  assert.equal(selectorFromScope('orders', scope(3, 1)), '3+orders+1');
  assert.equal(selectorFromScope('orders', scope(1, 1)), '1+orders+1');
  assert.equal(selectorFromScope('orders', scope(5, 2)), '5+orders+2');
});

void test('selectorFromScope: depth 0 writes nothing, and All writes a bare plus', () => {
  assert.equal(selectorFromScope('orders', scope(0, 0)), 'orders');
  assert.equal(selectorFromScope('orders', scope(0, 2)), 'orders+2');
  assert.equal(selectorFromScope('orders', scope(UNLIMITED_DEPTH, UNLIMITED_DEPTH)), '+orders+');
  assert.equal(selectorFromScope('orders', scope(UNLIMITED_DEPTH, 0)), '+orders');
});

void test('selectorFromScope: ignores tests and materializations, which stay display filters', () => {
  const filtered = { ...scope(1, 1), includeTests: true, excludedMaterializations: ['view'] };
  assert.equal(selectorFromScope('orders', filtered), '1+orders+1');
});

void test('rootSelector: a model by name, a versioned one by its file', () => {
  const model: DbtNode = {
    unique_id: 'model.pkg.orders',
    resource_type: 'model',
    name: 'orders',
    package_name: 'pkg',
    path: 'orders.sql',
    original_file_path: 'models/orders.sql',
  };
  assert.equal(rootSelector(model), 'orders');
  assert.equal(
    rootSelector({ ...model, version: 2, original_file_path: 'models/orders_v2.sql' }),
    'path:models/orders_v2.sql',
  );
});

void test('rootSelector: a source is qualified by its source, an exposure by kind', () => {
  const source: DbtSourceNode = {
    unique_id: 'source.pkg.raw.customers',
    resource_type: 'source',
    name: 'customers',
    source_name: 'raw',
    package_name: 'pkg',
    original_file_path: 'models/sources.yml',
  };
  const exposure: DbtExposureNode = {
    unique_id: 'exposure.pkg.weekly',
    resource_type: 'exposure',
    name: 'weekly',
    package_name: 'pkg',
    path: 'exposures.yml',
    original_file_path: 'models/exposures.yml',
  };
  assert.equal(rootSelector(source), 'source:raw.customers');
  assert.equal(rootSelector(exposure), 'exposure:weekly');
});

void test('partitionMatches: separates what the manifest knows from what it does not', () => {
  const known = new Set(['model.pkg.a', 'test.pkg.t']);
  const result = partitionMatches(
    ['model.pkg.a', 'model.pkg.new', 'test.pkg.t', 'seed.pkg.fresh'],
    (id) => known.has(id),
  );

  assert.deepEqual(result.known, ['model.pkg.a', 'test.pkg.t']);
  assert.equal(result.missing, 2);
  assert.equal(result.notDrawn, 0);
});

void test('partitionMatches: kinds the graph never draws are not "missing"', () => {
  const result = partitionMatches(
    ['metric.pkg.revenue', 'semantic_model.pkg.orders', 'model.pkg.new'],
    () => false,
  );

  assert.equal(result.notDrawn, 2);
  assert.equal(result.missing, 1);
});

const counts = (overrides: Partial<SelectorCounts> = {}): SelectorCounts => ({
  matched: 10,
  drawn: 10,
  missing: 0,
  notDrawn: 0,
  filteredOut: 0,
  ...overrides,
});

const ok = (c: SelectorCounts) => ({
  status: 'ok' as const,
  subgraph: { nodes: [], edges: [] },
  counts: c,
});

void test('describeSelectorOutcome: a clean result just reports its size', () => {
  const status = describeSelectorOutcome(ok(counts()));
  assert.equal(status?.tone, 'note');
  assert.equal(status?.text, '10 nodes drawn, 10 selected by dbt.');
});

void test('describeSelectorOutcome: every node dbt selected but the graph lacks is accounted for', () => {
  const text =
    describeSelectorOutcome(
      ok(counts({ matched: 14, drawn: 10, filteredOut: 2, missing: 1, notDrawn: 1 })),
    )?.text ?? '';

  assert.match(text, /2 hidden by the filters/);
  assert.match(text, /1 node not in the manifest/);
  assert.match(text, /dbt compile/);
  assert.match(text, /1 of a kind this graph doesn't draw/);
});

void test('describeSelectorOutcome: an empty selection says so', () => {
  assert.equal(
    describeSelectorOutcome(ok(counts({ matched: 0, drawn: 0 })))?.text,
    'dbt selected no nodes.',
  );
});

void test('describeSelectorOutcome: over the ceiling it gives the count and asks to narrow', () => {
  const status = describeSelectorOutcome({
    status: 'tooMany',
    limit: 300,
    counts: counts({ matched: 800, drawn: 640 }),
  });
  assert.match(status?.text ?? '', /640 nodes/);
  assert.match(status?.text ?? '', /300/);
  assert.match(status?.text ?? '', /Narrow/);
});

void test('describeSelectorOutcome: an error is shown as one, a cancellation not at all', () => {
  assert.deepEqual(describeSelectorOutcome({ status: 'error', message: 'boom' }), {
    tone: 'error',
    text: 'boom',
  });
  assert.equal(describeSelectorOutcome({ status: 'cancelled' }), undefined);
});
