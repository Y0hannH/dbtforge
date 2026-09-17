import { strict as assert } from 'assert';
import { test } from 'node:test';
import { parseSchemaEntities } from '../../src/yaml/schemaColumns';

const SCHEMA = `version: 2

models:
  - name: orders
    description: One row per order.
    columns:
      - name: order_id
        description: Primary key.
      - name: customer_id
  - name: customers
    columns:
      - name: customer_id

seeds:
  - name: country_codes
    columns:
      - name: code

snapshots:
  - name: orders_snapshot
    columns:
      - name: order_id

sources:
  - name: jaffle
    tables:
      - name: raw_orders
        columns:
          - name: id
          - name: placed_at
      - name: raw_customers
`;

test('parseSchemaEntities: reads models, seeds, snapshots and source tables', () => {
  const entities = parseSchemaEntities(SCHEMA);
  assert.deepEqual(
    entities.map((e) => `${e.kind}:${e.sourceName ? e.sourceName + '.' : ''}${e.name}`),
    [
      'model:orders',
      'model:customers',
      'seed:country_codes',
      'snapshot:orders_snapshot',
      'source:jaffle.raw_orders',
      'source:jaffle.raw_customers',
    ],
  );
});

test('parseSchemaEntities: columns belong to the entity that declares them', () => {
  const entities = parseSchemaEntities(SCHEMA);
  const byName = (name: string) => entities.find((e) => e.name === name);
  assert.deepEqual(
    byName('orders')?.columns.map((c) => c.name),
    ['order_id', 'customer_id'],
  );
  assert.deepEqual(
    byName('raw_orders')?.columns.map((c) => c.name),
    ['id', 'placed_at'],
  );
  // A table with no columns block is still an entity — it just documents nothing.
  assert.deepEqual(byName('raw_customers')?.columns, []);
});

test('parseSchemaEntities: offsets point at the name in the source', () => {
  const entities = parseSchemaEntities(SCHEMA);
  const column = entities
    .find((e) => e.name === 'orders')
    ?.columns.find((c) => c.name === 'customer_id');
  assert.ok(column);
  assert.equal(SCHEMA.slice(column.offset, column.offset + column.length), 'customer_id');
});

test('parseSchemaEntities: a quoted name is located including its quotes', () => {
  const text = 'models:\n  - name: orders\n    columns:\n      - name: "order id"\n';
  const column = parseSchemaEntities(text)[0].columns[0];
  assert.equal(column.name, 'order id');
  assert.equal(text.slice(column.offset, column.offset + column.length), '"order id"');
});

test('parseSchemaEntities: a file that does not parse yields nothing', () => {
  // Half-written YAML is indistinguishable from YAML being typed; a partial reading of it would
  // warn about columns the author has not finished writing.
  assert.deepEqual(parseSchemaEntities('models:\n  - name: orders\n   columns:\n  bad: ['), []);
});

test('parseSchemaEntities: files that are not schema files yield nothing', () => {
  assert.deepEqual(parseSchemaEntities(''), []);
  assert.deepEqual(parseSchemaEntities('name: my_project\nprofile: default\n'), []);
  // dbt_project.yml has a models: key too, but it holds a config tree, not a list of entities.
  assert.deepEqual(parseSchemaEntities('models:\n  my_project:\n    +materialized: view\n'), []);
});

test('parseSchemaEntities: an entry without a usable name is skipped, the rest survives', () => {
  const text = 'models:\n  - description: nameless\n  - name: orders\n';
  assert.deepEqual(
    parseSchemaEntities(text).map((e) => e.name),
    ['orders'],
  );
});
