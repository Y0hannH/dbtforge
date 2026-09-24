import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { DependencyGraph } from '../../src/index/graph';
import type { DbtNode } from '../../src/index/manifestTypes';
import type { TargetLagLookup } from '../../src/lineage/targetLagResolution';
import { hasResolvableTargetLag } from '../../src/lineage/targetLagResolution';

function dt(id: string, targetLag: string): DbtNode {
  return {
    unique_id: id,
    resource_type: 'model',
    name: id,
    package_name: 'pkg',
    path: `${id}.sql`,
    original_file_path: `models/${id}.sql`,
    config: { materialized: 'dynamic_table', target_lag: targetLag },
  };
}

function table(id: string): DbtNode {
  return {
    unique_id: id,
    resource_type: 'model',
    name: id,
    package_name: 'pkg',
    path: `${id}.sql`,
    original_file_path: `models/${id}.sql`,
    config: { materialized: 'table' },
  };
}

function makeIndex(
  nodes: Record<string, DbtNode>,
  children: Record<string, string[]>,
): TargetLagLookup {
  const graph: DependencyGraph = {
    getParents: () => [],
    getChildren: (id) => children[id] ?? [],
    getTests: () => [],
    getMacroCallers: () => [],
  };
  return {
    getNode: (id: string) => nodes[id],
    getGraph: () => graph,
  };
}

void test('a downstream DT feeding a table with no further DT is a dead end', () => {
  const index = makeIndex({ a: dt('a', 'downstream'), b: table('b') }, { a: ['b'] });
  assert.equal(hasResolvableTargetLag(index, 'a'), false);
});

void test('a downstream DT feeding a DT with a real lag resolves', () => {
  const index = makeIndex({ a: dt('a', 'downstream'), b: dt('b', '5 minutes') }, { a: ['b'] });
  assert.equal(hasResolvableTargetLag(index, 'a'), true);
});

void test('a chain of downstream DTs resolves only if something at the end has a real lag', () => {
  const unresolved = makeIndex(
    { a: dt('a', 'downstream'), b: dt('b', 'downstream'), c: table('c') },
    { a: ['b'], b: ['c'] },
  );
  assert.equal(hasResolvableTargetLag(unresolved, 'a'), false);

  const resolved = makeIndex(
    { a: dt('a', 'downstream'), b: dt('b', 'downstream'), c: dt('c', '1 hour') },
    { a: ['b'], b: ['c'] },
  );
  assert.equal(hasResolvableTargetLag(resolved, 'a'), true);
});

void test('a real lag past an intervening plain table still resolves', () => {
  const index = makeIndex(
    { a: dt('a', 'downstream'), b: table('b'), c: dt('c', '10 minutes') },
    { a: ['b'], b: ['c'] },
  );
  assert.equal(hasResolvableTargetLag(index, 'a'), true);
});

void test('a node with no children at all is a dead end', () => {
  const index = makeIndex({ a: dt('a', 'downstream') }, {});
  assert.equal(hasResolvableTargetLag(index, 'a'), false);
});

void test('one resolving branch among several is enough', () => {
  const index = makeIndex(
    {
      a: dt('a', 'downstream'),
      b: table('b'),
      c: dt('c', '15 minutes'),
    },
    { a: ['b', 'c'] },
  );
  assert.equal(hasResolvableTargetLag(index, 'a'), true);
});
