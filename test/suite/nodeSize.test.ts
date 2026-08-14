import { strict as assert } from 'assert';
import { test } from 'node:test';
import { lineageNodeWidth, MAX_NODE_WIDTH, MIN_NODE_WIDTH } from '../../src/lineage/nodeSize';

test('a short name gets the floor width, not a box that hugs the text', () => {
  assert.equal(lineageNodeWidth('orders'), MIN_NODE_WIDTH);
  assert.equal(lineageNodeWidth(''), MIN_NODE_WIDTH);
});

test('a long name gets a wider box instead of overflowing a fixed one', () => {
  // The name from the bug report, which used to render in a box laid out as if it were 170px.
  const width = lineageNodeWidth('hubspot_associations_companies_to_deals');
  assert.ok(width > MIN_NODE_WIDTH, `expected more than ${MIN_NODE_WIDTH}, got ${width}`);
  assert.ok(width <= MAX_NODE_WIDTH);
});

test('width grows with the name, so no two ranks are sized off the same guess', () => {
  assert.ok(lineageNodeWidth('stg_customers_and_their_orders') > lineageNodeWidth('stg_customers'));
});

test('an unbounded name is capped rather than pushing the graph off-screen', () => {
  assert.equal(lineageNodeWidth('x'.repeat(200)), MAX_NODE_WIDTH);
});

test('a long meta row widens the box even when the name is short', () => {
  // A short name under "snapshot · materialized_view" would otherwise be sized off the name
  // alone, and the row above it would overflow the box.
  assert.ok(lineageNodeWidth('orders', 'snapshot · materialized_view') > MIN_NODE_WIDTH);
  assert.equal(lineageNodeWidth('orders', 'model'), MIN_NODE_WIDTH);
});

test('the wider of the two rows decides', () => {
  const longName = 'int_orders_joined_to_customers_and_payments';
  assert.equal(lineageNodeWidth(longName, 'model'), lineageNodeWidth(longName));
});

test('widths are whole pixels', () => {
  for (const name of ['a', 'stg_customers', 'int_orders_joined_to_customers', 'y'.repeat(60)]) {
    assert.equal(lineageNodeWidth(name) % 1, 0, name);
  }
});
