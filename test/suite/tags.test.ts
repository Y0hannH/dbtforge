import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { test } from 'node:test';
import { DbtManifest } from '../../src/index/manifestTypes';
import { collectTags } from '../../src/index/tags';

const manifest: DbtManifest = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/manifest.sample.json'), 'utf8')
);

test('collectTags returns every declared tag, alphabetically', () => {
  assert.deepEqual(
    collectTags(manifest).map((t) => t.tag),
    ['marts', 'nightly', 'raw', 'staging']
  );
});

test('collectTags unions top-level tags with config.tags, without duplicating', () => {
  // dim_customers declares "marts" in both places and "nightly" only under config.
  const marts = collectTags(manifest).find((t) => t.tag === 'marts');
  assert.deepEqual(marts?.uniqueIds, ['model.example_project.dim_customers']);

  const nightly = collectTags(manifest).find((t) => t.tag === 'nightly');
  assert.ok(nightly?.uniqueIds.includes('model.example_project.dim_customers'));
});

test('collectTags picks up tags declared only under config.tags', () => {
  // The test node carries "nightly" via config.tags alone.
  const nightly = collectTags(manifest).find((t) => t.tag === 'nightly');
  assert.ok(
    nightly?.uniqueIds.includes('test.example_project.not_null_dim_customers_customer_id')
  );
});

test('modelCount counts models only, while uniqueIds keeps every tagged resource', () => {
  // "nightly" is on 2 models + 1 test: `--select tag:nightly` matches all three.
  const nightly = collectTags(manifest).find((t) => t.tag === 'nightly');
  assert.equal(nightly?.uniqueIds.length, 3);
  assert.equal(nightly?.modelCount, 2);
});

test('collectTags includes sources, which count as zero models', () => {
  const raw = collectTags(manifest).find((t) => t.tag === 'raw');
  assert.deepEqual(raw?.uniqueIds, ['source.example_project.raw.customers']);
  assert.equal(raw?.modelCount, 0);
});

test('collectTags returns an empty list for a manifest with no tags', () => {
  assert.deepEqual(collectTags({ ...manifest, nodes: {}, sources: {} }), []);
});
