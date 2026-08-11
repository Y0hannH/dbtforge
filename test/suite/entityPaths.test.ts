import { strict as assert } from 'assert';
import * as path from 'path';
import { test } from 'node:test';
import { resolveEntityPath } from '../../src/index/entityPaths';
import { DbtMacroNode } from '../../src/index/manifestTypes';

const PROJECT_DIR = path.join('C:', 'projects', 'analytics');

function macro(packageName: string, originalFilePath: string): DbtMacroNode {
  return {
    unique_id: `macro.${packageName}.m`,
    resource_type: 'macro',
    name: 'm',
    package_name: packageName,
    path: originalFilePath,
    original_file_path: originalFilePath,
  };
}

test('resolveEntityPath: root-project entity resolves under the project dir', () => {
  assert.equal(
    resolveEntityPath(PROJECT_DIR, 'analytics', macro('analytics', 'macros/m.sql')),
    path.join(PROJECT_DIR, 'macros', 'm.sql')
  );
});

test('resolveEntityPath: package entity resolves under dbt_packages/<package>', () => {
  // original_file_path is relative to the package root, not the project root — resolving it
  // against the project dir is what produced paths that don't exist.
  assert.equal(
    resolveEntityPath(PROJECT_DIR, 'analytics', macro('dbt_utils', 'macros/sql/star.sql')),
    path.join(PROJECT_DIR, 'dbt_packages', 'dbt_utils', 'macros', 'sql', 'star.sql')
  );
});
