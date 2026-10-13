import { test } from 'node:test';

import { strict as assert } from 'assert';

import { buildDeferredArgs, buildModifiedArgs } from '../../src/dbt/stateArgs';
import type { DbtManifest, DbtNode } from '../../src/index/manifestTypes';
import { compareToReference } from '../../src/index/stateComparison';

function node(name: string, extra: Partial<DbtNode> = {}): DbtNode {
  return {
    unique_id: `model.p.${name}`,
    resource_type: 'model',
    name,
    package_name: 'p',
    path: `${name}.sql`,
    original_file_path: `models/${name}.sql`,
    checksum: { name: 'sha256', checksum: `sum-${name}` },
    unrendered_config: { materialized: 'table' },
    ...extra,
  };
}

function manifest(nodes: DbtNode[], childMap: Record<string, string[]> = {}): DbtManifest {
  return {
    metadata: { dbt_schema_version: 'v12', project_name: 'p' },
    nodes: Object.fromEntries(nodes.map((n) => [n.unique_id, n])),
    sources: {},
    child_map: childMap,
  };
}

void test('an identical project has nothing to report', () => {
  const nodes = [node('a'), node('b')];

  assert.equal(compareToReference(manifest(nodes), manifest(nodes)).size, 0);
});

void test('a node whose SQL differs is modified, and says why', () => {
  const now = manifest([node('a', { checksum: { checksum: 'new' } })]);
  const before = manifest([node('a', { checksum: { checksum: 'old' } })]);

  const change = compareToReference(now, before).get('model.p.a');
  assert.equal(change?.kind, 'modified');
  assert.deepEqual(change?.reasons, ['SQL changed']);
});

void test('a seed whose file differs says the file changed, not the SQL', () => {
  const seed = (checksum: string) =>
    node('s', { unique_id: 'seed.p.s', resource_type: 'seed', checksum: { checksum } });

  const change = compareToReference(manifest([seed('new')]), manifest([seed('old')])).get(
    'seed.p.s',
  );
  assert.deepEqual(change?.reasons, ['file changed']);
});

void test('a node absent from the reference is new', () => {
  const change = compareToReference(manifest([node('a')]), manifest([])).get('model.p.a');

  assert.equal(change?.kind, 'new');
});

void test('a changed config is found, whatever order the keys come in', () => {
  const now = manifest([node('a', { unrendered_config: { materialized: 'view', tags: ['x'] } })]);
  const before = manifest([
    node('a', { unrendered_config: { tags: ['x'], materialized: 'table' } }),
  ]);
  assert.deepEqual(compareToReference(now, before).get('model.p.a')?.reasons, ['config changed']);

  const same = manifest([node('a', { unrendered_config: { tags: ['x'], materialized: 'table' } })]);
  const reordered = manifest([
    node('a', { unrendered_config: { materialized: 'table', tags: ['x'] } }),
  ]);
  assert.equal(compareToReference(same, reordered).size, 0);
});

void test('both a SQL change and a config change are reported', () => {
  const now = manifest([
    node('a', { checksum: { checksum: 'new' }, unrendered_config: { materialized: 'view' } }),
  ]);
  const before = manifest([node('a')]);

  assert.deepEqual(compareToReference(now, before).get('model.p.a')?.reasons, [
    'SQL changed',
    'config changed',
  ]);
});

void test('a missing checksum is not a difference', () => {
  const now = manifest([node('a', { checksum: undefined, unrendered_config: undefined })]);
  const before = manifest([node('a')]);

  assert.equal(compareToReference(now, before).size, 0);
});

void test('everything downstream of a change is impacted, but not the change itself', () => {
  const nodes = [node('a', { checksum: { checksum: 'new' } }), node('b'), node('c'), node('d')];
  const reference = [node('a'), node('b'), node('c'), node('d')];
  const childMap = {
    'model.p.a': ['model.p.b'],
    'model.p.b': ['model.p.c'],
    'model.p.d': [],
  };

  const changes = compareToReference(manifest(nodes, childMap), manifest(reference));

  assert.equal(changes.get('model.p.a')?.kind, 'modified');
  assert.equal(changes.get('model.p.b')?.kind, 'impacted');
  assert.equal(changes.get('model.p.c')?.kind, 'impacted');
  assert.equal(changes.has('model.p.d'), false);
});

void test('a modified node downstream of another stays modified', () => {
  const nodes = [
    node('a', { checksum: { checksum: 'new' } }),
    node('b', { checksum: { checksum: 'new' } }),
  ];
  const reference = [node('a'), node('b')];

  const changes = compareToReference(
    manifest(nodes, { 'model.p.a': ['model.p.b'] }),
    manifest(reference),
  );

  assert.equal(changes.get('model.p.b')?.kind, 'modified');
});

void test('tests and sources are not marked, and do not stop the walk reaching what is behind', () => {
  const nodes = [
    node('a', { checksum: { checksum: 'new' } }),
    node('t', { unique_id: 'test.p.t', resource_type: 'test' }),
    node('b'),
  ];
  const reference = [
    node('a'),
    node('t', { unique_id: 'test.p.t', resource_type: 'test' }),
    node('b'),
  ];

  const changes = compareToReference(
    manifest(nodes, { 'model.p.a': ['test.p.t', 'model.p.b'] }),
    manifest(reference),
  );

  assert.equal(changes.has('test.p.t'), false);
  assert.equal(changes.get('model.p.b')?.kind, 'impacted');
});

void test('a cycle in a malformed child_map does not hang the walk', () => {
  const nodes = [node('a', { checksum: { checksum: 'new' } }), node('b')];
  const changes = compareToReference(
    manifest(nodes, { 'model.p.a': ['model.p.b'], 'model.p.b': ['model.p.a'] }),
    manifest([node('a'), node('b')]),
  );

  assert.equal(changes.size, 2);
});

void test('build modified always defers, so the unbuilt upstream resolves to the reference', () => {
  assert.deepEqual(buildModifiedArgs('/ref'), [
    'build',
    '--select',
    'state:modified+',
    '--defer',
    '--state',
    '/ref',
  ]);
});

void test('a deferred build selects what it is given', () => {
  assert.deepEqual(buildDeferredArgs('path:models/a.sql', '/ref'), [
    'build',
    '--select',
    'path:models/a.sql',
    '--defer',
    '--state',
    '/ref',
  ]);
});
