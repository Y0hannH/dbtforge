import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { DbtNode } from '../../src/index/manifestTypes';
import { privateRefWarning } from '../../src/index/modelAccess';

function model(name: string, group?: string | null, access?: string | null): DbtNode {
  return {
    unique_id: `model.pkg.${name}`,
    resource_type: 'model',
    name,
    package_name: 'pkg',
    path: `${name}.sql`,
    original_file_path: `models/${name}.sql`,
    group,
    access,
  };
}

void test('privateRefWarning: a private model referenced from another group is flagged', () => {
  const warning = privateRefWarning(model('ledger', 'finance', 'private'), model('kpi', 'sales'));

  assert.match(warning ?? '', /"ledger" is private to group "finance"/);
  assert.match(warning ?? '', /this model is in group "sales"/);
});

void test('privateRefWarning: from a model with no group, it says so', () => {
  const warning = privateRefWarning(model('ledger', 'finance', 'private'), model('kpi', null));

  assert.match(warning ?? '', /this model is in no group/);
});

void test('privateRefWarning: the same group may reference it', () => {
  assert.equal(
    privateRefWarning(model('ledger', 'finance', 'private'), model('kpi', 'finance')),
    undefined,
  );
});

void test('privateRefWarning: protected, public and unset access are open to the project', () => {
  for (const access of ['protected', 'public', null, undefined]) {
    assert.equal(
      privateRefWarning(model('ledger', 'finance', access), model('kpi', 'sales')),
      undefined,
      String(access),
    );
  }
});

void test('privateRefWarning: a private model with no group can be referenced by no one', () => {
  const warning = privateRefWarning(model('orphan', null, 'private'), model('kpi', 'sales'));

  assert.match(warning ?? '', /"orphan" is private and belongs to no group/);
  // Two models with no group are not "the same group".
  assert.match(
    privateRefWarning(model('orphan', null, 'private'), model('kpi', null)) ?? '',
    /no group/,
  );
});

void test('privateRefWarning: says nothing when the caller is not a known model', () => {
  const target = model('ledger', 'finance', 'private');

  assert.equal(privateRefWarning(target, undefined), undefined);
  assert.equal(
    privateRefWarning(target, { ...model('t', 'sales'), resource_type: 'test' }),
    undefined,
  );
});
