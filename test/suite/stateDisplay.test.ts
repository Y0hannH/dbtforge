import { test } from 'node:test';

import { strict as assert } from 'assert';
import * as path from 'path';

import { resolveStateDir } from '../../src/dbt/stateArgs';
import type { DbtProjectIndex } from '../../src/index/dbtProjectIndex';
import type { DependencyGraph } from '../../src/index/graph';
import type { DbtNode } from '../../src/index/manifestTypes';
import type { StateChange } from '../../src/index/stateComparison';
import { buildInitialSubgraph } from '../../src/lineage/buildLineageGraph';
import { nodeMetaLabel } from '../../src/lineage/nodeDisplay';

void test('the meta row says how a node differs from the reference', () => {
  assert.equal(
    nodeMetaLabel('model', { materialization: 'table', stateChange: 'modified' }),
    'model · table · modified',
  );
  assert.equal(
    nodeMetaLabel('model', { materialization: 'view', stateChange: 'new' }),
    'model · view · new',
  );
  assert.equal(
    nodeMetaLabel('model', { materialization: 'view', stateChange: 'impacted' }),
    'model · view · impacted',
  );
});

void test('with no reference there is nothing on the row', () => {
  assert.equal(nodeMetaLabel('model', { materialization: 'table' }), 'model · table');
});

void test('the state mark follows the version mark and precedes the column count', () => {
  assert.equal(
    nodeMetaLabel('model', {
      materialization: 'table',
      latestVersion: true,
      stateChange: 'modified',
      columnCount: 4,
    }),
    'model · table · latest · modified · 4 cols',
  );
});

void test('the lineage marks the nodes the reference comparison found', () => {
  const make = (name: string): DbtNode => ({
    unique_id: `model.p.${name}`,
    resource_type: 'model',
    name,
    package_name: 'p',
    path: `${name}.sql`,
    original_file_path: `models/${name}.sql`,
    config: { materialized: 'table' },
  });
  const nodes: Record<string, DbtNode> = {
    'model.p.a': make('a'),
    'model.p.b': make('b'),
    'model.p.c': make('c'),
  };
  const children: Record<string, string[]> = { 'model.p.a': ['model.p.b', 'model.p.c'] };
  const graph: DependencyGraph = {
    getParents: () => [],
    getChildren: (id) => children[id] ?? [],
    getTests: () => [],
    getMacroCallers: () => [],
  };
  const changes: Record<string, StateChange> = {
    'model.p.b': { kind: 'modified', reasons: ['SQL changed'] },
    'model.p.c': { kind: 'impacted', reasons: ['downstream of a changed node'] },
  };
  const index = {
    getGraph: () => graph,
    getLineageEntity: (id: string) => nodes[id],
    getCatalogColumns: () => undefined,
    getStateChange: (id: string) => changes[id],
  } as unknown as DbtProjectIndex;

  const drawn = Object.fromEntries(
    buildInitialSubgraph(index, 'model.p.a').nodes.map((n) => [n.id, n.metaLabel]),
  );

  assert.equal(drawn['model.p.a'], 'model · table');
  assert.equal(drawn['model.p.b'], 'model · table · modified');
  assert.equal(drawn['model.p.c'], 'model · table · impacted');
});

void test('a relative state folder is relative to the project, an absolute one is kept', () => {
  const project = path.join(path.sep, 'work', 'proj');

  assert.equal(resolveStateDir(project, ''), '');
  assert.equal(resolveStateDir(project, '   '), '');
  assert.equal(resolveStateDir(project, 'prod-state'), path.join(project, 'prod-state'));
  const absolute = path.resolve(path.sep, 'ci', 'artifacts');
  assert.equal(resolveStateDir(project, absolute), absolute);
});
