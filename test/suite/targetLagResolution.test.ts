import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { DependencyGraph } from '../../src/index/graph';
import type { DbtNode } from '../../src/index/manifestTypes';
import type { TargetLagLookup } from '../../src/lineage/targetLagResolution';
import {
  isDownstreamLag,
  parseTargetLagSeconds,
  resolveInheritedTargetLag,
} from '../../src/lineage/targetLagResolution';

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

void test('parseTargetLagSeconds: reads the durations Snowflake accepts', () => {
  assert.equal(parseTargetLagSeconds('30 seconds'), 30);
  assert.equal(parseTargetLagSeconds('1 minute'), 60);
  assert.equal(parseTargetLagSeconds('10 minutes'), 600);
  assert.equal(parseTargetLagSeconds('1 hour'), 3600);
  assert.equal(parseTargetLagSeconds('2 days'), 172800);
  assert.equal(parseTargetLagSeconds('  5 MINUTES '), 300);
});

void test('parseTargetLagSeconds: refuses anything that is not a plain duration', () => {
  assert.equal(parseTargetLagSeconds('downstream'), undefined);
  assert.equal(parseTargetLagSeconds('1.5 hours'), undefined);
  assert.equal(parseTargetLagSeconds('{{ var("lag") }}'), undefined);
  assert.equal(parseTargetLagSeconds('5 fortnights'), undefined);
  assert.equal(parseTargetLagSeconds(''), undefined);
});

void test('isDownstreamLag: the keyword in any case, and nothing else', () => {
  assert.equal(isDownstreamLag('downstream'), true);
  assert.equal(isDownstreamLag(' DOWNSTREAM '), true);
  assert.equal(isDownstreamLag('5 minutes'), false);
  assert.equal(isDownstreamLag(undefined), false);
});

void test('a downstream DT feeding a table with no further DT is a dead end', () => {
  const index = makeIndex({ a: dt('a', 'downstream'), b: table('b') }, { a: ['b'] });
  assert.deepEqual(resolveInheritedTargetLag(index, 'a'), { kind: 'dead-end' });
});

void test('a downstream DT feeding a DT with a real lag inherits it, text as written', () => {
  const index = makeIndex({ a: dt('a', 'downstream'), b: dt('b', '5 minutes') }, { a: ['b'] });
  assert.deepEqual(resolveInheritedTargetLag(index, 'a'), {
    kind: 'lag',
    text: '5 minutes',
    seconds: 300,
  });
});

void test('a chain of downstream DTs resolves only if something at the end has a real lag', () => {
  const unresolved = makeIndex(
    { a: dt('a', 'downstream'), b: dt('b', 'downstream'), c: table('c') },
    { a: ['b'], b: ['c'] },
  );
  assert.equal(resolveInheritedTargetLag(unresolved, 'a').kind, 'dead-end');

  const resolved = makeIndex(
    { a: dt('a', 'downstream'), b: dt('b', 'downstream'), c: dt('c', '1 hour') },
    { a: ['b'], b: ['c'] },
  );
  assert.deepEqual(resolveInheritedTargetLag(resolved, 'a'), {
    kind: 'lag',
    text: '1 hour',
    seconds: 3600,
  });
});

void test('a real lag past an intervening plain table is still found', () => {
  const index = makeIndex(
    { a: dt('a', 'downstream'), b: table('b'), c: dt('c', '10 minutes') },
    { a: ['b'], b: ['c'] },
  );
  assert.deepEqual(resolveInheritedTargetLag(index, 'a'), {
    kind: 'lag',
    text: '10 minutes',
    seconds: 600,
  });
});

void test('a node with no children at all is a dead end', () => {
  const index = makeIndex({ a: dt('a', 'downstream') }, {});
  assert.equal(resolveInheritedTargetLag(index, 'a').kind, 'dead-end');
});

void test('the shortest lag among several branches wins, compared across units', () => {
  const index = makeIndex(
    {
      a: dt('a', 'downstream'),
      b: dt('b', '1 hour'),
      c: dt('c', '15 minutes'),
      d: dt('d', '90 seconds'),
    },
    { a: ['b', 'c', 'd'] },
  );
  assert.deepEqual(resolveInheritedTargetLag(index, 'a'), {
    kind: 'lag',
    text: '90 seconds',
    seconds: 90,
  });
});

void test('the walk stops at a real lag: what lies past it is not the root business', () => {
  // a feeds b (1 hour), which feeds c (1 minute). b's own schedule is what a serves.
  const index = makeIndex(
    { a: dt('a', 'downstream'), b: dt('b', '1 hour'), c: dt('c', '1 minute') },
    { a: ['b'], b: ['c'] },
  );
  assert.deepEqual(resolveInheritedTargetLag(index, 'a'), {
    kind: 'lag',
    text: '1 hour',
    seconds: 3600,
  });
});

void test('a downstream DT in between passes its own effective lag up', () => {
  const index = makeIndex(
    {
      a: dt('a', 'downstream'),
      b: dt('b', 'downstream'),
      c: dt('c', '20 minutes'),
      d: dt('d', '5 minutes'),
    },
    { a: ['b', 'd'], b: ['c'] },
  );
  assert.deepEqual(resolveInheritedTargetLag(index, 'a'), {
    kind: 'lag',
    text: '5 minutes',
    seconds: 300,
  });
  assert.deepEqual(resolveInheritedTargetLag(index, 'b'), {
    kind: 'lag',
    text: '20 minutes',
    seconds: 1200,
  });
});

void test('a lag that cannot be read stops any minimum from being claimed', () => {
  // The unreadable one could be the shortest, so the readable 1 hour must not be reported.
  const index = makeIndex(
    { a: dt('a', 'downstream'), b: dt('b', '1 hour'), c: dt('c', '{{ var("lag") }}') },
    { a: ['b', 'c'] },
  );
  assert.deepEqual(resolveInheritedTargetLag(index, 'a'), { kind: 'unreadable' });
});

void test('a downstream keyword in a different case is deferred through, not read as a duration', () => {
  const index = makeIndex(
    { a: dt('a', 'downstream'), b: dt('b', 'DOWNSTREAM'), c: dt('c', '2 minutes') },
    { a: ['b'], b: ['c'] },
  );
  assert.deepEqual(resolveInheritedTargetLag(index, 'a'), {
    kind: 'lag',
    text: '2 minutes',
    seconds: 120,
  });
});

void test('a cycle in a malformed manifest answers instead of recursing forever', () => {
  const index = makeIndex(
    { a: dt('a', 'downstream'), b: dt('b', 'downstream') },
    { a: ['b'], b: ['a'] },
  );
  assert.equal(resolveInheritedTargetLag(index, 'a').kind, 'dead-end');
});
