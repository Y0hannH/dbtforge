import { test } from 'node:test';

import { strict as assert } from 'assert';

import { locateTest } from '../../src/yaml/testLocation';

const SCHEMA = `version: 2

models:
  - name: fct_orders
    tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns: [order_id, line]
    columns:
      - name: order_id
        tests:
          - unique
          - not_null:
              severity: warn
      - name: status
        data_tests:
          - accepted_values:
              values: [open, closed]
      - name: email
        tests:
          - not_null
          - not_null

sources:
  - name: raw
    tables:
      - name: orders
        columns:
          - name: id
            tests:
              - unique
`;

function textAt(span: { offset: number; length: number } | undefined): string | undefined {
  return span ? SCHEMA.slice(span.offset, span.offset + span.length) : undefined;
}

void test('finds a scalar test under its column', () => {
  const span = locateTest(SCHEMA, {
    section: 'models',
    name: 'fct_orders',
    columnName: 'order_id',
    testName: 'unique',
  });

  assert.equal(span?.precision, 'test');
  assert.equal(textAt(span), 'unique');
  // The `unique` under order_id, not anywhere else a word could match.
  assert.equal(SCHEMA.slice(0, span?.offset).split('\n').length, 11);
});

void test('finds a test written as a mapping by its key', () => {
  const span = locateTest(SCHEMA, {
    section: 'models',
    name: 'fct_orders',
    columnName: 'order_id',
    testName: 'not_null',
  });

  assert.equal(span?.precision, 'test');
  assert.equal(textAt(span), 'not_null');
});

void test('finds a test under data_tests as well as tests', () => {
  const span = locateTest(SCHEMA, {
    section: 'models',
    name: 'fct_orders',
    columnName: 'status',
    testName: 'accepted_values',
  });

  assert.equal(span?.precision, 'test');
  assert.equal(textAt(span), 'accepted_values');
});

void test('finds a model-level test, including one written with its package', () => {
  const span = locateTest(SCHEMA, {
    section: 'models',
    name: 'fct_orders',
    testName: 'unique_combination_of_columns',
    namespace: 'dbt_utils',
  });

  assert.equal(span?.precision, 'test');
  assert.equal(textAt(span), 'dbt_utils.unique_combination_of_columns');
});

void test('stops at the column when two entries could both be the test', () => {
  const span = locateTest(SCHEMA, {
    section: 'models',
    name: 'fct_orders',
    columnName: 'email',
    testName: 'not_null',
  });

  // Picking one of two identical entries would be a guess; the column is true of both.
  assert.equal(span?.precision, 'column');
  assert.equal(textAt(span), 'email');
});

void test('falls back to the column, then to the model, as far as the file goes', () => {
  const noTest = locateTest(SCHEMA, {
    section: 'models',
    name: 'fct_orders',
    columnName: 'order_id',
    testName: 'relationships',
  });
  assert.equal(noTest?.precision, 'column');
  assert.equal(textAt(noTest), 'order_id');

  const noColumn = locateTest(SCHEMA, {
    section: 'models',
    name: 'fct_orders',
    columnName: 'vanished',
    testName: 'unique',
  });
  assert.equal(noColumn?.precision, 'entity');
  assert.equal(textAt(noColumn), 'fct_orders');
});

void test('a test on a source is found under the table of that source', () => {
  const span = locateTest(SCHEMA, {
    section: 'sources',
    name: 'orders',
    sourceName: 'raw',
    columnName: 'id',
    testName: 'unique',
  });

  assert.equal(span?.precision, 'test');
  // The last `unique` in the file is the one under the source's column.
  assert.equal(span?.offset, SCHEMA.lastIndexOf('unique'));
});

void test('says nothing for a model the file does not declare', () => {
  assert.equal(
    locateTest(SCHEMA, { section: 'models', name: 'someone_else', testName: 'unique' }),
    undefined,
  );
  assert.equal(
    locateTest(SCHEMA, { section: 'seeds', name: 'fct_orders', testName: 'unique' }),
    undefined,
  );
});

void test('says nothing for a file that does not parse', () => {
  assert.equal(
    locateTest('models:\n  - name: a\n   bad: [', {
      section: 'models',
      name: 'a',
      testName: 'unique',
    }),
    undefined,
  );
});
