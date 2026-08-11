import { strict as assert } from 'assert';
import { test } from 'node:test';
import { buildMacroIndex } from '../../src/index/macroIndex';
import { DbtManifest, DbtMacroNode } from '../../src/index/manifestTypes';

function macro(packageName: string, name: string): DbtMacroNode {
  return {
    unique_id: `macro.${packageName}.${name}`,
    resource_type: 'macro',
    name,
    package_name: packageName,
    path: `macros/${name}.sql`,
    original_file_path: `macros/${name}.sql`,
  };
}

function manifestWith(...macros: DbtMacroNode[]): DbtManifest {
  return {
    metadata: { dbt_schema_version: 'v11', project_name: 'analytics' },
    nodes: {},
    sources: {},
    macros: Object.fromEntries(macros.map((m) => [m.unique_id, m])),
  };
}

test('buildMacroIndex: the root project wins over a package with the same macro name', () => {
  const packageFirst = buildMacroIndex(manifestWith(macro('dbt_utils', 'star'), macro('analytics', 'star')));
  const projectFirst = buildMacroIndex(manifestWith(macro('analytics', 'star'), macro('dbt_utils', 'star')));

  // Manifest order must not decide the winner — it's arbitrary.
  assert.equal(packageFirst.resolve('star')?.packageName, 'analytics');
  assert.equal(projectFirst.resolve('star')?.packageName, 'analytics');
});

test('buildMacroIndex: between two packages, the first in the manifest wins deterministically', () => {
  const index = buildMacroIndex(manifestWith(macro('dbt_utils', 'star'), macro('spark_utils', 'star')));
  assert.equal(index.resolve('star')?.packageName, 'dbt_utils');
});

test('buildMacroIndex: a namespaced call resolves to that exact package', () => {
  const index = buildMacroIndex(manifestWith(macro('analytics', 'star'), macro('spark_utils', 'star')));
  assert.equal(index.resolve('star', 'spark_utils')?.uniqueId, 'macro.spark_utils.star');
});

test('buildMacroIndex: a namespaced call to an unknown package does not fall back to the by-name entry', () => {
  const index = buildMacroIndex(manifestWith(macro('analytics', 'star')));
  assert.equal(index.resolve('star', 'dbt_utils'), undefined);
});

test('buildMacroIndex: findAllByName returns every package defining the name', () => {
  const index = buildMacroIndex(manifestWith(macro('analytics', 'star'), macro('dbt_utils', 'star')));
  assert.deepEqual(
    index.findAllByName('star').map((m) => m.packageName),
    ['analytics', 'dbt_utils']
  );
  assert.deepEqual(index.findAllByName('missing'), []);
});

test('buildMacroIndex: a manifest without macros resolves nothing', () => {
  const index = buildMacroIndex(manifestWith());
  assert.equal(index.resolve('star'), undefined);
});
