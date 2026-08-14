import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { test } from 'node:test';
import { DbtManifest } from '../../src/index/manifestTypes';
import { buildRefIndex, isReferenceable } from '../../src/index/refIndex';

const manifest: DbtManifest = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/manifest.sample.json'), 'utf8')
);

test('buildRefIndex resolves models by name', () => {
  const index = buildRefIndex(manifest);
  assert.equal(index.get('dim_customers')?.uniqueId, 'model.example_project.dim_customers');
  assert.equal(index.get('dim_customers')?.resourceType, 'model');
});

test('buildRefIndex resolves seeds, which ref() targets exactly like models', () => {
  const index = buildRefIndex(manifest);
  const seed = index.get('country_codes');
  assert.equal(seed?.uniqueId, 'seed.example_project.country_codes');
  assert.equal(seed?.resourceType, 'seed');
  assert.equal(seed?.packageName, 'example_project');
});

test('buildRefIndex resolves snapshots', () => {
  const snapshot = buildRefIndex(manifest).get('orders_snapshot');
  assert.equal(snapshot?.uniqueId, 'snapshot.example_project.orders_snapshot');
  assert.equal(snapshot?.resourceType, 'snapshot');
});

test('buildRefIndex leaves out what ref() cannot target', () => {
  const index = buildRefIndex(manifest);
  assert.equal(index.get('ad_hoc_revenue'), undefined);
  assert.equal(index.get('not_null_dim_customers_customer_id'), undefined);
});

test('buildRefIndex returns an empty map for a manifest with no nodes', () => {
  assert.equal(buildRefIndex({ ...manifest, nodes: {} }).size, 0);
});

test('isReferenceable accepts models, seeds and snapshots only', () => {
  const of = (resourceType: string) => ({
    unique_id: `${resourceType}.p.x`,
    resource_type: resourceType,
    name: 'x',
    package_name: 'p',
    path: 'x.sql',
    original_file_path: 'x.sql',
  });

  assert.equal(isReferenceable(of('model')), true);
  assert.equal(isReferenceable(of('seed')), true);
  assert.equal(isReferenceable(of('snapshot')), true);
  assert.equal(isReferenceable(of('test')), false);
  assert.equal(isReferenceable(of('analysis')), false);
  assert.equal(isReferenceable(of('operation')), false);
});
