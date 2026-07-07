import { strict as assert } from 'assert';
import { test } from 'node:test';
import { parseAliases } from '../../src/sql/aliasParser';

test('parseAliases: ref with explicit AS', () => {
  const sql = "select * from {{ ref('dim_customers') }} AS c";
  assert.deepEqual(parseAliases(sql), [{ kind: 'ref', modelName: 'dim_customers', alias: 'c' }]);
});

test('parseAliases: ref without AS', () => {
  const sql = "select * from {{ ref('dim_customers') }} c";
  assert.deepEqual(parseAliases(sql), [{ kind: 'ref', modelName: 'dim_customers', alias: 'c' }]);
});

test('parseAliases: source with alias', () => {
  const sql = "select * from {{ source('raw', 'customers') }} src";
  assert.deepEqual(parseAliases(sql), [
    { kind: 'source', sourceName: 'raw', tableName: 'customers', alias: 'src' },
  ]);
});

test('parseAliases: JOIN clause is also matched', () => {
  const sql =
    "select * from {{ ref('a') }} a join {{ ref('b') }} b on a.id = b.id";
  assert.deepEqual(parseAliases(sql), [
    { kind: 'ref', modelName: 'a', alias: 'a' },
    { kind: 'ref', modelName: 'b', alias: 'b' },
  ]);
});

test('parseAliases: no alias present yields no results', () => {
  assert.deepEqual(parseAliases('select 1'), []);
});
