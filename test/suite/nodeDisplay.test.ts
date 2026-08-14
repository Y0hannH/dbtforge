import { strict as assert } from 'assert';
import { test } from 'node:test';
import { DbtNode } from '../../src/index/manifestTypes';
import { nodeMetaLabel, readNodeColor, sanitizeNodeColor } from '../../src/lineage/nodeDisplay';

function node(overrides: Partial<DbtNode>): DbtNode {
  return {
    unique_id: 'model.pkg.x',
    resource_type: 'model',
    name: 'x',
    package_name: 'pkg',
    path: 'x.sql',
    original_file_path: 'models/x.sql',
    ...overrides,
  };
}

test('nodeMetaLabel: a model shows what it materializes as', () => {
  assert.equal(nodeMetaLabel('model', 'incremental'), 'model · incremental');
  assert.equal(nodeMetaLabel('model', 'ephemeral'), 'model · ephemeral');
});

test('nodeMetaLabel: nothing to add when the materialization repeats the resource type', () => {
  assert.equal(nodeMetaLabel('seed', 'seed'), 'seed');
  assert.equal(nodeMetaLabel('snapshot', 'snapshot'), 'snapshot');
});

test('nodeMetaLabel: an unbuilt or partial manifest entry still labels itself', () => {
  assert.equal(nodeMetaLabel('model', undefined), 'model');
  assert.equal(nodeMetaLabel('model', ''), 'model');
});

test('sanitizeNodeColor: accepts the two forms dbt documents', () => {
  assert.equal(sanitizeNodeColor('#FF00AA'), '#ff00aa');
  assert.equal(sanitizeNodeColor('#f0a'), '#f0a');
  assert.equal(sanitizeNodeColor('  red  '), 'red');
});

test('sanitizeNodeColor: refuses anything that is not one of them', () => {
  assert.equal(sanitizeNodeColor('#ff00'), undefined);
  assert.equal(sanitizeNodeColor('rgb(255,0,0)'), undefined);
  assert.equal(sanitizeNodeColor('url(evil.png)'), undefined);
  assert.equal(sanitizeNodeColor('red; background: url(x)'), undefined);
  assert.equal(sanitizeNodeColor('var(--vscode-editor-background)'), undefined);
});

test('sanitizeNodeColor: an absent or empty value is simply no colour', () => {
  assert.equal(sanitizeNodeColor(undefined), undefined);
  assert.equal(sanitizeNodeColor(null), undefined);
  assert.equal(sanitizeNodeColor('   '), undefined);
});

test('readNodeColor: reads node_color from either place dbt writes it', () => {
  assert.equal(readNodeColor(node({ docs: { node_color: '#123456' } })), '#123456');
  assert.equal(readNodeColor(node({ config: { docs: { node_color: 'teal' } } })), 'teal');
});

test('readNodeColor: the node\'s own docs wins over the one nested in config', () => {
  const both = node({ docs: { node_color: '#111111' }, config: { docs: { node_color: '#222222' } } });
  assert.equal(readNodeColor(both), '#111111');
});

test('readNodeColor: a node declaring no colour gets none', () => {
  assert.equal(readNodeColor(node({})), undefined);
  assert.equal(readNodeColor(node({ docs: { show: true } })), undefined);
});
