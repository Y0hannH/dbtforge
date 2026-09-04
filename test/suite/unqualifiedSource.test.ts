import { strict as assert } from 'assert';
import { test } from 'node:test';
import { resolveUnqualifiedSource } from '../../src/sql/unqualifiedSource';

/** `|` marks the cursor. */
function resolve(sqlWithCursor: string) {
  const offset = sqlWithCursor.indexOf('|');
  assert.notEqual(offset, -1, 'the fixture must mark the cursor with |');
  return resolveUnqualifiedSource(sqlWithCursor.replace('|', ''), offset);
}

test('single unaliased ref: columns resolve against it', () => {
  assert.deepEqual(resolve("select ord|\nfrom {{ ref('orders') }}\nwhere 1 = 1"), {
    kind: 'ref',
    modelName: 'orders',
  });
});

test('single unaliased source: same', () => {
  assert.deepEqual(resolve("select cust|\nfrom {{ source('raw', 'customers') }}"), {
    kind: 'source',
    sourceName: 'raw',
    tableName: 'customers',
  });
});

test('an alias is present: the alias. path owns this file', () => {
  assert.equal(resolve("select o|\nfrom {{ ref('orders') }} o"), undefined);
});

test('two tables: ambiguous, so nothing', () => {
  assert.equal(
    resolve("select i|\nfrom {{ ref('orders') }}\njoin {{ ref('customers') }} on 1 = 1"),
    undefined
  );
});

test('comma join: still two tables, even though the second has no FROM/JOIN', () => {
  assert.equal(resolve("select i|\nfrom {{ ref('orders') }}, {{ ref('customers') }}"), undefined);
});

test('a ref anywhere else in the file also makes it ambiguous', () => {
  assert.equal(
    resolve("select i|\nfrom {{ ref('orders') }}\nwhere id in (select id from {{ ref('vip') }})"),
    undefined
  );
});

test('a CTE puts a second candidate in scope', () => {
  assert.equal(
    resolve("with recent as (\n  select * from {{ ref('orders') }}\n)\nselect r|\nfrom recent"),
    undefined
  );
});

test('directly after FROM a table name is being typed, not a column', () => {
  assert.equal(resolve("select *\nfrom or|\nfrom {{ ref('orders') }}"), undefined);
});

test('inside a jinja tag: the ref completion owns that context', () => {
  assert.equal(resolve("select *\nfrom {{ ref('or|') }}"), undefined);
});

test('inside a string literal', () => {
  assert.equal(resolve("select 'ord|'\nfrom {{ ref('orders') }}"), undefined);
});

test('inside a line comment', () => {
  assert.equal(resolve("select 1 -- ord|\nfrom {{ ref('orders') }}"), undefined);
});

test('inside a block comment', () => {
  assert.equal(resolve("/* ord|\n*/ select 1 from {{ ref('orders') }}"), undefined);
});

test('no table reference at all', () => {
  assert.equal(resolve('select 1|'), undefined);
});
