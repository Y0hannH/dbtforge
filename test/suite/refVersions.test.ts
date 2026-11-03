import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { DbtManifest, DbtNode } from '../../src/index/manifestTypes';
import {
  buildPackageRefIndex,
  buildRefIndex,
  buildVersionedRefIndex,
  packageKey,
  versionKey,
} from '../../src/index/refIndex';
import {
  findAllRefCallLocations,
  findAllRefCalls,
  findCallAtPosition,
} from '../../src/sql/jinjaRefParser';

// Model versions: one `name`, several nodes, told apart by `version`.

function versioned(version: number, latestVersion?: number): DbtNode {
  return {
    unique_id: `model.example_project.dim_orders.v${version}`,
    resource_type: 'model',
    name: 'dim_orders',
    package_name: 'example_project',
    path: `dim_orders_v${version}.sql`,
    original_file_path: `models/dim_orders_v${version}.sql`,
    version,
    ...(latestVersion === undefined ? {} : { latest_version: latestVersion }),
  };
}

function manifestOf(...nodes: DbtNode[]): DbtManifest {
  return {
    metadata: { dbt_schema_version: 'v12', project_name: 'example_project' },
    nodes: Object.fromEntries(nodes.map((node) => [node.unique_id, node])),
    sources: {},
  };
}

void test('buildRefIndex sends a bare ref to latest_version, not to the last version listed', () => {
  // v2 is a prerelease: the highest version, and the last one in the manifest.
  const resolved = buildRefIndex(manifestOf(versioned(1, 1), versioned(2, 1))).get('dim_orders');

  assert.equal(resolved?.uniqueId, 'model.example_project.dim_orders.v1');
  assert.equal(resolved?.version, '1');
});

void test('buildRefIndex does not depend on the order the versions are written in', () => {
  const resolved = buildRefIndex(manifestOf(versioned(2, 1), versioned(1, 1))).get('dim_orders');

  assert.equal(resolved?.uniqueId, 'model.example_project.dim_orders.v1');
});

void test('buildRefIndex falls back to the highest version when latest_version is not written', () => {
  const index = buildRefIndex(manifestOf(versioned(2), versioned(10), versioned(1)));

  // Numerically, not as text: 10 is higher than 2.
  assert.equal(index.get('dim_orders')?.uniqueId, 'model.example_project.dim_orders.v10');
});

void test('buildRefIndex leaves the version off a model that has none', () => {
  const plain: DbtNode = {
    ...versioned(1),
    unique_id: 'model.example_project.plain',
    name: 'plain',
  };
  delete plain.version;

  assert.equal(buildRefIndex(manifestOf(plain)).get('plain')?.version, undefined);
});

void test('buildVersionedRefIndex answers each version exactly, and only versioned models', () => {
  const plain: DbtNode = {
    ...versioned(1),
    unique_id: 'model.example_project.plain',
    name: 'plain',
  };
  delete plain.version;

  const byVersion = buildVersionedRefIndex(manifestOf(versioned(1, 2), versioned(2, 2), plain));

  assert.equal(
    byVersion.get(versionKey('dim_orders', '1'))?.uniqueId,
    'model.example_project.dim_orders.v1',
  );
  assert.equal(
    byVersion.get(versionKey('dim_orders', '2'))?.uniqueId,
    'model.example_project.dim_orders.v2',
  );
  assert.equal(byVersion.get(versionKey('dim_orders', '3')), undefined);
  assert.equal(byVersion.get(versionKey('plain', '1')), undefined);
});

// `v=` and `version=` pin one; an expression pins one the scan can't see.

void test('findAllRefCalls: reads a literal version from v= and version=', () => {
  const calls = findAllRefCalls(
    "{{ ref('dim_orders', v=2) }} {{ ref('dim_orders', version='3') }}",
  );

  assert.equal(calls[0].version, '2');
  assert.equal(calls[1].version, '3');
});

void test('findAllRefCalls: a version after a package argument', () => {
  const [call] = findAllRefCalls("{{ ref('pkg', 'dim_orders', v=2) }}");

  assert.equal(call.name, 'dim_orders');
  assert.equal(call.packageName, 'pkg');
  assert.equal(call.version, '2');
});

void test('findAllRefCalls: an expression is flagged, not read as unpinned', () => {
  const [call] = findAllRefCalls("{{ ref('dim_orders', v=var('orders_version')) }}");

  assert.equal(call.version, undefined);
  assert.equal(call.versionUnreadable, true);
});

void test('findAllRefCalls: a plain call carries neither version key', () => {
  const [call] = findAllRefCalls("{{ ref('dim_orders') }}");

  assert.equal('version' in call, false);
  assert.equal('versionUnreadable' in call, false);
});

void test('findCallAtPosition: the version is on the call under the cursor', () => {
  const line = "select * from {{ ref('dim_orders', v=2) }}";
  const call = findCallAtPosition(line, line.indexOf('dim_orders') + 2);

  assert.equal(call?.kind === 'ref' && call.version, '2');
});

void test('findAllRefCallLocations: a bare call counts for the latest version only', () => {
  const line = "{{ ref('dim_orders') }} {{ ref('dim_orders', v=1) }} {{ ref('dim_orders', v=2) }}";

  assert.equal(findAllRefCallLocations(line, 'dim_orders').length, 3);
  // Latest is v2: the bare call and the v=2 call, not v=1.
  const latest = { value: '2', isLatest: true };
  assert.equal(findAllRefCallLocations(line, 'dim_orders', undefined, latest).length, 2);
  // v1 is not the latest: only the call that names it.
  const older = { value: '1', isLatest: false };
  assert.equal(findAllRefCallLocations(line, 'dim_orders', undefined, older).length, 1);
});

void test('findAllRefCallLocations: a version it cannot read is kept rather than dropped', () => {
  const line = "{{ ref('dim_orders', v=var('v')) }}";
  const older = { value: '1', isLatest: false };

  assert.equal(findAllRefCallLocations(line, 'dim_orders', undefined, older).length, 1);
});

// ref('package', 'model'): the one form that separates same-named models of different packages.

function inPackage(node: DbtNode, packageName: string): DbtNode {
  return {
    ...node,
    unique_id: node.unique_id.replace('example_project', packageName),
    package_name: packageName,
  };
}

void test('buildPackageRefIndex tells same-named models of two packages apart', () => {
  const mine = { ...versioned(1), unique_id: 'model.example_project.dim', name: 'dim' } as DbtNode;
  delete mine.version;
  const theirs = inPackage(mine, 'shared');

  const index = buildPackageRefIndex(manifestOf(mine, theirs));

  assert.equal(index.get(packageKey('example_project', 'dim'))?.uniqueId, mine.unique_id);
  assert.equal(index.get(packageKey('shared', 'dim'))?.uniqueId, theirs.unique_id);
  assert.equal(index.get(packageKey('other', 'dim')), undefined);
});

void test('buildPackageRefIndex sends a versioned model to its latest_version per package', () => {
  const index = buildPackageRefIndex(
    manifestOf(versioned(1, 1), versioned(2, 1), inPackage(versioned(2, 2), 'shared')),
  );

  assert.equal(
    index.get(packageKey('example_project', 'dim_orders'))?.uniqueId,
    'model.example_project.dim_orders.v1',
  );
  assert.equal(
    index.get(packageKey('shared', 'dim_orders'))?.uniqueId,
    'model.shared.dim_orders.v2',
  );
});

void test('buildVersionedRefIndex answers a version within one package', () => {
  const byVersion = buildVersionedRefIndex(
    manifestOf(versioned(1, 2), versioned(2, 2), inPackage(versioned(1, 1), 'shared')),
  );

  assert.equal(
    byVersion.get(versionKey('dim_orders', '1', 'shared'))?.uniqueId,
    'model.shared.dim_orders.v1',
  );
  assert.equal(
    byVersion.get(versionKey('dim_orders', '1', 'example_project'))?.uniqueId,
    'model.example_project.dim_orders.v1',
  );
  // The package that has no v2 does not borrow the other's.
  assert.equal(byVersion.get(versionKey('dim_orders', '2', 'shared')), undefined);
});
