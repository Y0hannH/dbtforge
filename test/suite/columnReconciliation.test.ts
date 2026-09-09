import { strict as assert } from 'assert';
import { test } from 'node:test';
import { reconcileColumns } from '../../src/yaml/columnReconciliation';
import { DocumentedColumn, DocumentedEntity } from '../../src/yaml/schemaColumns';

function column(name: string, offset = 0): DocumentedColumn {
  return { name, offset, length: name.length };
}

function model(name: string, columns: string[]): DocumentedEntity {
  return {
    kind: 'model',
    name,
    offset: 0,
    length: name.length,
    columns: columns.map((columnName, i) => column(columnName, 100 + i * 10)),
  };
}

const ALL_KNOWN = (columns: string[]) => (): string[] => columns;
const NOTHING_KNOWN = (): undefined => undefined;
const OFF = { flagUndocumented: false };
const ON = { flagUndocumented: true };

test('a documented column the table does not have is flagged', () => {
  const findings = reconcileColumns(
    [model('orders', ['order_id', 'custmer_id'])],
    ALL_KNOWN(['order_id', 'customer_id']),
    OFF
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /has no column "custmer_id"/);
  assert.match(findings[0].message, /dbt docs generate/);
});

test('case is not a difference: warehouses report it their own way', () => {
  const findings = reconcileColumns(
    [model('orders', ['order_id', 'customer_id'])],
    ALL_KNOWN(['ORDER_ID', 'CUSTOMER_ID']),
    OFF
  );
  assert.deepEqual(findings, []);
});

test('an unknown catalog silences every comparison', () => {
  const findings = reconcileColumns(
    [model('orders', ['nothing_like_a_real_column'])],
    NOTHING_KNOWN,
    ON
  );
  assert.deepEqual(findings, []);
});

test('a column documented twice is flagged on its second entry', () => {
  const entity = model('orders', ['order_id', 'status', 'order_id']);
  const findings = reconcileColumns([entity], ALL_KNOWN(['order_id', 'status']), OFF);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].offset, entity.columns[2].offset);
  assert.match(findings[0].message, /documented twice/);
  assert.match(findings[0].message, /the description above this one is dropped/);
});

test('duplicates are caught without a catalog, because the mistake is inside the file', () => {
  const findings = reconcileColumns([model('orders', ['id', 'ID'])], NOTHING_KNOWN, OFF);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /documented twice/);
});

test('undocumented columns say nothing unless asked', () => {
  const entity = model('orders', ['order_id']);
  assert.deepEqual(reconcileColumns([entity], ALL_KNOWN(['order_id', 'status']), OFF), []);

  const findings = reconcileColumns([entity], ALL_KNOWN(['order_id', 'status']), ON);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].offset, entity.offset); // anchored on the model, not on a column
  assert.match(findings[0].message, /1 column of "orders" is not documented here: status/);
});

test('a long list of undocumented columns stops naming them', () => {
  const real = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const findings = reconcileColumns([model('wide', [])], ALL_KNOWN(real), ON);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /9 columns of "wide" are not documented here/);
  assert.match(findings[0].message, /a, b, c, d, e, f and 3 more\./);
});

test('a source table is named source.table in the message', () => {
  const table: DocumentedEntity = {
    kind: 'source',
    name: 'raw_orders',
    sourceName: 'jaffle',
    offset: 0,
    length: 10,
    columns: [column('nope', 40)],
  };
  const findings = reconcileColumns([table], ALL_KNOWN(['id']), OFF);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /"jaffle\.raw_orders" has no column "nope"/);
});

test('findings come back in source order, whichever entity they belong to', () => {
  const first = { ...model('a', ['x']), offset: 0 };
  const second = { ...model('b', ['y']), columns: [column('y', 5)] };
  const findings = reconcileColumns([first, second], ALL_KNOWN([]), OFF);
  assert.deepEqual(
    findings.map((f) => f.offset),
    [5, 100]
  );
});
