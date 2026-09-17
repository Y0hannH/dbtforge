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
  assert.equal(nodeMetaLabel('model', { materialization: 'incremental' }), 'model · incremental');
  assert.equal(nodeMetaLabel('model', { materialization: 'ephemeral' }), 'model · ephemeral');
});

test('nodeMetaLabel: nothing to add when the materialization repeats the resource type', () => {
  assert.equal(nodeMetaLabel('seed', { materialization: 'seed' }), 'seed');
  assert.equal(nodeMetaLabel('snapshot', { materialization: 'snapshot' }), 'snapshot');
});

test('nodeMetaLabel: an unbuilt or partial manifest entry still labels itself', () => {
  assert.equal(nodeMetaLabel('model'), 'model');
  assert.equal(nodeMetaLabel('model', {}), 'model');
  assert.equal(nodeMetaLabel('model', { materialization: '' }), 'model');
});

test('nodeMetaLabel: a dynamic table carries its target lag, verbatim', () => {
  assert.equal(
    nodeMetaLabel('model', { materialization: 'dynamic_table', targetLag: '3 minutes' }),
    'model · dynamic_table (3 minutes)',
  );
  // 'downstream' means "inherit from whoever reads me"; dbt never records the inherited value,
  // so the word is shown as declared rather than resolved by walking the DAG.
  assert.equal(
    nodeMetaLabel('model', { materialization: 'dynamic_table', targetLag: 'downstream' }),
    'model · dynamic_table (downstream)',
  );
});

test('nodeMetaLabel: no materialization to qualify means no lag either', () => {
  assert.equal(nodeMetaLabel('model', { targetLag: '3 minutes' }), 'model');
  assert.equal(nodeMetaLabel('seed', { materialization: 'seed', targetLag: '1 hour' }), 'seed');
});

test('nodeMetaLabel: the column count is appended when the catalog knows it', () => {
  assert.equal(
    nodeMetaLabel('model', { materialization: 'table', columnCount: 42 }),
    'model · table · 42 cols',
  );
  assert.equal(nodeMetaLabel('model', { columnCount: 1 }), 'model · 1 col');
});

test('nodeMetaLabel: an unknown column count says nothing at all', () => {
  assert.equal(nodeMetaLabel('model', { materialization: 'view' }), 'model · view');
  assert.equal(
    nodeMetaLabel('model', { materialization: 'view', columnCount: undefined }),
    'model · view',
  );
  // Zero is a malformed catalog entry, not a model without columns — never stated as fact.
  assert.equal(nodeMetaLabel('model', { materialization: 'view', columnCount: 0 }), 'model · view');
});

test('nodeMetaLabel: everything known at once, in one row', () => {
  assert.equal(
    nodeMetaLabel('model', {
      materialization: 'dynamic_table',
      targetLag: '3 minutes',
      columnCount: 12,
    }),
    'model · dynamic_table (3 minutes) · 12 cols',
  );
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

test("readNodeColor: the node's own docs wins over the one nested in config", () => {
  const both = node({
    docs: { node_color: '#111111' },
    config: { docs: { node_color: '#222222' } },
  });
  assert.equal(readNodeColor(both), '#111111');
});

test('readNodeColor: a node declaring no colour gets none', () => {
  assert.equal(readNodeColor(node({})), undefined);
  assert.equal(readNodeColor(node({ docs: { show: true } })), undefined);
});
