import { strict as assert } from 'assert';
import { test } from 'node:test';
import { describeTarget } from '../../src/preview/previewState';

test('describeTarget: a default environment shows the model name alone', () => {
  assert.equal(describeTarget('stg_customers', []), 'stg_customers');
});

test('describeTarget: an overridden target is named, so the panel says what it queried', () => {
  assert.equal(describeTarget('stg_customers', ['--target', 'dev']), 'stg_customers · target: dev');
});

test('describeTarget: profile and target are both shown when both are overridden', () => {
  const label = describeTarget('m', ['--profile', 'fabric', '--target', 'prod']);
  assert.equal(label, 'm · profile: fabric, target: prod');
});
