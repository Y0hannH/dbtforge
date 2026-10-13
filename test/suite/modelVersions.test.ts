import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { DbtProjectIndex } from '../../src/index/dbtProjectIndex';
import type { DependencyGraph } from '../../src/index/graph';
import type { DbtNode } from '../../src/index/manifestTypes';
import { isLatestVersion, nodeSelector, versionedName } from '../../src/index/modelVersions';
import { buildInitialSubgraph } from '../../src/lineage/buildLineageGraph';
import { nodeMetaLabel } from '../../src/lineage/nodeDisplay';

function model(extra: Partial<DbtNode> = {}): DbtNode {
  return {
    unique_id: 'model.p.dim_customers',
    resource_type: 'model',
    name: 'dim_customers',
    package_name: 'p',
    path: 'marts/dim_customers.sql',
    original_file_path: 'models/marts/dim_customers.sql',
    ...extra,
  };
}

void test('an unversioned model keeps its plain name', () => {
  assert.equal(versionedName(model()), 'dim_customers');
  assert.equal(versionedName(model({ version: null })), 'dim_customers');
});

void test('a version is named after the model, so two versions are not two identical labels', () => {
  assert.equal(versionedName(model({ version: 1 })), 'dim_customers (v1)');
  assert.equal(versionedName(model({ version: '2024-01' })), 'dim_customers (v2024-01)');
});

void test('isLatestVersion says yes, no, or nothing when the manifest does not say', () => {
  assert.equal(isLatestVersion(model({ version: 1, latest_version: 1 })), true);
  assert.equal(isLatestVersion(model({ version: 2, latest_version: 1 })), false);
  // A version that might be the latest is not "not the latest".
  assert.equal(isLatestVersion(model({ version: 2 })), undefined);
  assert.equal(isLatestVersion(model()), undefined);
});

void test('isLatestVersion compares a number with the same value written as text', () => {
  assert.equal(isLatestVersion(model({ version: 2, latest_version: '2' })), true);
});

void test('nodeSelector picks a plain model by name and a version by its file', () => {
  assert.equal(nodeSelector(model()), 'dim_customers');
  assert.equal(
    nodeSelector(model({ version: 2, original_file_path: 'models/marts/dim_customers_v2.sql' })),
    'path:models/marts/dim_customers_v2.sql',
  );
});

void test('the meta row marks the latest version, and only that one', () => {
  assert.equal(
    nodeMetaLabel('model', { materialization: 'table', latestVersion: true }),
    'model · table · latest',
  );
  assert.equal(
    nodeMetaLabel('model', { materialization: 'table', latestVersion: false }),
    'model · table',
  );
  assert.equal(nodeMetaLabel('model', { materialization: 'table' }), 'model · table');
});

void test('the lineage draws two versions of a model as two distinct boxes', () => {
  const v1 = model({
    unique_id: 'model.p.dim_customers.v1',
    version: 1,
    latest_version: 1,
    config: { materialized: 'table' },
  });
  const v2 = model({
    unique_id: 'model.p.dim_customers.v2',
    version: 2,
    latest_version: 1,
    config: { materialized: 'table' },
  });
  const consumer = model({ unique_id: 'model.p.fct', name: 'fct' });
  const nodes: Record<string, DbtNode> = {
    [v1.unique_id]: v1,
    [v2.unique_id]: v2,
    [consumer.unique_id]: consumer,
  };
  const parents: Record<string, string[]> = { [consumer.unique_id]: [v1.unique_id, v2.unique_id] };
  const graph: DependencyGraph = {
    getParents: (id) => parents[id] ?? [],
    getChildren: () => [],
    getTests: () => [],
    getMacroCallers: () => [],
  };
  const index = {
    getGraph: () => graph,
    getLineageEntity: (id: string) => nodes[id],
    getCatalogColumns: () => undefined,
    getStateChange: () => undefined,
  } as unknown as DbtProjectIndex;

  const { nodes: drawn } = buildInitialSubgraph(index, consumer.unique_id);
  const byId = Object.fromEntries(drawn.map((n) => [n.id, n]));

  assert.equal(byId['model.p.dim_customers.v1'].name, 'dim_customers (v1)');
  assert.equal(byId['model.p.dim_customers.v2'].name, 'dim_customers (v2)');
  assert.match(byId['model.p.dim_customers.v1'].metaLabel, /· latest$/);
  assert.doesNotMatch(byId['model.p.dim_customers.v2'].metaLabel, /latest/);
});
