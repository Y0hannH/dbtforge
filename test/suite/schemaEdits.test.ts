import { test } from 'node:test';

import { strict as assert } from 'assert';
import { parse } from 'yaml';

import type { SchemaEdit } from '../../src/yaml/schemaEdits';
import { addColumnsEdit, removeColumnEdit } from '../../src/yaml/schemaEdits';

function apply(text: string, edit: SchemaEdit | undefined): string {
  assert.ok(edit, 'expected an edit');
  return text.slice(0, edit.offset) + edit.insert + text.slice(edit.offset + edit.deleteLength);
}

/** The offset of the `name:` value that reads `column`, the way a diagnostic would sit on it. */
function offsetOf(text: string, column: string): number {
  const at = text.indexOf(`name: ${column}`);
  assert.notEqual(at, -1, `no column ${column}`);
  return at + 'name: '.length;
}

const SCHEMA = `version: 2

models:
  - name: fct_orders
    description: Orders.
    columns:
      # the key
      - name: order_id
        description: One per order.
        tests:
          - unique
      - name: legacy_flag
        description: Dropped last year.
        tests:
          - not_null
      - name: status
`;

void test('removeColumnEdit removes the whole entry and nothing around it', () => {
  const result = apply(SCHEMA, removeColumnEdit(SCHEMA, offsetOf(SCHEMA, 'legacy_flag')));

  assert.equal(
    result,
    `version: 2

models:
  - name: fct_orders
    description: Orders.
    columns:
      # the key
      - name: order_id
        description: One per order.
        tests:
          - unique
      - name: status
`,
  );
  assert.deepEqual(
    parse(result).models[0].columns.map((c: { name: string }) => c.name),
    ['order_id', 'status'],
  );
});

void test('removeColumnEdit removes the last column, in a file with no final newline', () => {
  const text = SCHEMA.trimEnd();
  const result = apply(text, removeColumnEdit(text, offsetOf(text, 'status')));

  assert.equal(result.endsWith('- not_null\n'), true);
  assert.deepEqual(
    parse(result).models[0].columns.map((c: { name: string }) => c.name),
    ['order_id', 'legacy_flag'],
  );
});

void test('removeColumnEdit takes the columns: key too when it was the only column', () => {
  const text = `models:
  - name: a
    description: x
    columns:
      - name: only
        description: y
  - name: b
`;
  const result = apply(text, removeColumnEdit(text, offsetOf(text, 'only')));

  assert.equal(
    result,
    `models:
  - name: a
    description: x
  - name: b
`,
  );
});

void test('removeColumnEdit declines flow style rather than risk mangling it', () => {
  const text = `models:
  - name: a
    columns: [{name: x}, {name: y}]
`;

  assert.equal(removeColumnEdit(text, offsetOf(text, 'x}')), undefined);
});

void test('removeColumnEdit declines a name that is not a column of any entity', () => {
  assert.equal(removeColumnEdit(SCHEMA, 3), undefined);
});

void test('addColumnsEdit appends after the last column, at the same indent', () => {
  const entity = SCHEMA.indexOf('name: fct_orders') + 'name: '.length;
  const result = apply(SCHEMA, addColumnsEdit(SCHEMA, entity, ['amount', 'created_at']));

  assert.equal(
    result,
    `${SCHEMA}      - name: amount
      - name: created_at
`,
  );
  assert.deepEqual(
    parse(result).models[0].columns.map((c: { name: string }) => c.name),
    ['order_id', 'legacy_flag', 'status', 'amount', 'created_at'],
  );
});

void test('addColumnsEdit creates the columns: key when the entity has none', () => {
  const text = `models:
  - name: a
    description: x
  - name: b
    description: y
`;
  const entity = text.indexOf('name: a') + 'name: '.length;
  const result = apply(text, addColumnsEdit(text, entity, ['id']));

  assert.equal(
    result,
    `models:
  - name: a
    description: x
    columns:
      - name: id
  - name: b
    description: y
`,
  );
  assert.deepEqual(parse(result).models[0].columns, [{ name: 'id' }]);
});

void test('addColumnsEdit ends the last line first when the file has no final newline', () => {
  const text = 'models:\n  - name: a\n    description: x';
  const entity = text.indexOf('name: a') + 'name: '.length;
  const result = apply(text, addColumnsEdit(text, entity, ['id']));

  assert.deepEqual(parse(result).models[0].columns, [{ name: 'id' }]);
});

void test('addColumnsEdit quotes a column name that is not a plain word', () => {
  const text = 'models:\n  - name: a\n';
  const entity = text.indexOf('name: a') + 'name: '.length;
  const result = apply(text, addColumnsEdit(text, entity, ['Order Id', 'plain_one']));

  assert.deepEqual(parse(result).models[0].columns, [{ name: 'Order Id' }, { name: 'plain_one' }]);
});

void test('addColumnsEdit works on the table of a source', () => {
  const text = `sources:
  - name: raw
    tables:
      - name: orders
        description: Raw orders.
`;
  const entity = text.indexOf('name: orders') + 'name: '.length;
  const result = apply(text, addColumnsEdit(text, entity, ['id']));

  assert.deepEqual(parse(result).sources[0].tables[0].columns, [{ name: 'id' }]);
});

void test('addColumnsEdit has nothing to add, and declines a columns: that is not a list', () => {
  const entity = SCHEMA.indexOf('name: fct_orders') + 'name: '.length;
  assert.equal(addColumnsEdit(SCHEMA, entity, []), undefined);

  const text = 'models:\n  - name: a\n    columns:\n';
  assert.equal(addColumnsEdit(text, text.indexOf('name: a') + 6, ['id']), undefined);
});

void test('neither edit touches a model that declares versions', () => {
  // Top-level columns apply to every version, while the catalog describes one table.
  const text = `models:
  - name: a
    columns:
      - name: shared
      - name: only_in_v2
    versions:
      - v: 1
      - v: 2
`;
  assert.equal(removeColumnEdit(text, text.indexOf('name: only_in_v2') + 6), undefined);
  assert.equal(addColumnsEdit(text, text.indexOf('name: a') + 6, ['x']), undefined);
});
