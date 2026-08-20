import { strict as assert } from 'assert';
import { test } from 'node:test';
import { buildDocIndex } from '../../src/index/docIndex';
import { DbtDocNode, DbtManifest } from '../../src/index/manifestTypes';

function makeDoc(packageName: string, name: string, contents?: string): DbtDocNode {
  return {
    unique_id: `doc.${packageName}.${name}`,
    resource_type: 'doc',
    name,
    package_name: packageName,
    path: 'docs.md',
    original_file_path: 'models/docs.md',
    block_contents: contents,
  };
}

function makeManifest(docs: DbtDocNode[]): DbtManifest {
  return {
    metadata: { dbt_schema_version: 'v12', project_name: 'my_project' },
    nodes: {},
    sources: {},
    docs: Object.fromEntries(docs.map((doc) => [doc.unique_id, doc])),
  };
}

test('buildDocIndex: resolves a block declared by the root project', () => {
  const index = buildDocIndex(makeManifest([makeDoc('my_project', 'customer_id', 'The id.')]));
  const block = index.resolve('customer_id');
  assert.equal(block?.uniqueId, 'doc.my_project.customer_id');
  assert.equal(block?.node.block_contents, 'The id.');
});

test('buildDocIndex: an unknown name resolves to nothing rather than to a guess', () => {
  const index = buildDocIndex(makeManifest([makeDoc('my_project', 'customer_id')]));
  assert.equal(index.resolve('customer_di'), undefined);
});

test('buildDocIndex: the root project wins a name collision with a package', () => {
  // Manifest order deliberately puts the package first, so a naive last-write-wins map would
  // resolve to the wrong block.
  const index = buildDocIndex(
    makeManifest([makeDoc('dbt_utils', 'shared', 'from the package'), makeDoc('my_project', 'shared', 'mine')])
  );
  assert.equal(index.resolve('shared')?.packageName, 'my_project');
});

test('buildDocIndex: a namespaced call resolves exactly, with no fallback', () => {
  const index = buildDocIndex(
    makeManifest([makeDoc('my_project', 'shared'), makeDoc('dbt_utils', 'shared')])
  );
  assert.equal(index.resolve('shared', 'dbt_utils')?.packageName, 'dbt_utils');
  // Naming a package that doesn't declare the block must not silently fall back to another one.
  assert.equal(index.resolve('shared', 'nowhere'), undefined);
});

test('buildDocIndex: all() lists the project blocks first, then packages, each alphabetically', () => {
  const index = buildDocIndex(
    makeManifest([
      makeDoc('dbt_utils', 'a_package_block'),
      makeDoc('my_project', 'zebra'),
      makeDoc('my_project', 'apple'),
    ])
  );
  assert.deepEqual(
    index.all().map((block) => block.name),
    ['apple', 'zebra', 'a_package_block']
  );
});

test('buildDocIndex: a manifest with no docs section yields an empty index', () => {
  const manifest: DbtManifest = {
    metadata: { dbt_schema_version: 'v12', project_name: 'my_project' },
    nodes: {},
    sources: {},
  };
  const index = buildDocIndex(manifest);
  assert.deepEqual(index.all(), []);
  assert.equal(index.resolve('anything'), undefined);
});
