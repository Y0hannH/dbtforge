import { test } from 'node:test';

import { strict as assert } from 'assert';

import { parseAliases, parseTableReferences } from '../../src/sql/aliasParser';

void test('parseAliases: ref with explicit AS', () => {
  const sql = "select * from {{ ref('dim_customers') }} AS c";
  assert.deepEqual(parseAliases(sql), [{ kind: 'ref', modelName: 'dim_customers', alias: 'c' }]);
});

void test('parseAliases: ref without AS', () => {
  const sql = "select * from {{ ref('dim_customers') }} c";
  assert.deepEqual(parseAliases(sql), [{ kind: 'ref', modelName: 'dim_customers', alias: 'c' }]);
});

void test('parseAliases: source with alias', () => {
  const sql = "select * from {{ source('raw', 'customers') }} src";
  assert.deepEqual(parseAliases(sql), [
    { kind: 'source', sourceName: 'raw', tableName: 'customers', alias: 'src' },
  ]);
});

void test('parseAliases: JOIN clause is also matched', () => {
  const sql = "select * from {{ ref('a') }} a join {{ ref('b') }} b on a.id = b.id";
  assert.deepEqual(parseAliases(sql), [
    { kind: 'ref', modelName: 'a', alias: 'a' },
    { kind: 'ref', modelName: 'b', alias: 'b' },
  ]);
});

void test('parseAliases: no alias present yields no results', () => {
  assert.deepEqual(parseAliases('select 1'), []);
});

void test('parseAliases: a keyword after the ref is not an alias', () => {
  // `from {{ ref('orders') }} where ...` used to report an alias named "where".
  for (const tail of ['where status = 1', 'group by 1', 'order by id', 'limit 10', 'union all']) {
    assert.deepEqual(parseAliases(`select * from {{ ref('orders') }}\n${tail}`), []);
  }
});

void test('parseAliases: a keyword after a source is not an alias either', () => {
  assert.deepEqual(parseAliases("select * from {{ source('raw', 'orders') }}\nwhere id > 0"), []);
});

void test('parseTableReferences: unaliased ref is reported without an alias', () => {
  assert.deepEqual(parseTableReferences("select * from {{ ref('orders') }}\nwhere id > 0"), [
    { kind: 'ref', modelName: 'orders' },
  ]);
});

void test('parseTableReferences: aliased and unaliased references, in document order', () => {
  const sql = "select * from {{ source('raw', 'orders') }}\njoin {{ ref('customers') }} c on 1=1";
  assert.deepEqual(parseTableReferences(sql), [
    { kind: 'source', sourceName: 'raw', tableName: 'orders' },
    { kind: 'ref', modelName: 'customers', alias: 'c' },
  ]);
});
