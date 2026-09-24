import { test } from 'node:test';

import { strict as assert } from 'assert';

import { resolveUnqualifiedSource } from '../../src/sql/unqualifiedSource';

/** `|` marks the cursor. */
function resolve(sqlWithCursor: string) {
  const offset = sqlWithCursor.indexOf('|');
  assert.notEqual(offset, -1, 'the fixture must mark the cursor with |');
  return resolveUnqualifiedSource(sqlWithCursor.replace('|', ''), offset);
}

void test('single unaliased ref: columns resolve against it', () => {
  assert.deepEqual(resolve("select ord|\nfrom {{ ref('orders') }}\nwhere 1 = 1"), {
    kind: 'ref',
    modelName: 'orders',
  });
});

void test('single unaliased source: same', () => {
  assert.deepEqual(resolve("select cust|\nfrom {{ source('raw', 'customers') }}"), {
    kind: 'source',
    sourceName: 'raw',
    tableName: 'customers',
  });
});

void test('an alias is present: the alias. path owns this file', () => {
  assert.equal(resolve("select o|\nfrom {{ ref('orders') }} o"), undefined);
});

void test('two tables: ambiguous, so nothing', () => {
  assert.equal(
    resolve("select i|\nfrom {{ ref('orders') }}\njoin {{ ref('customers') }} on 1 = 1"),
    undefined,
  );
});

void test('comma join: still two tables, even though the second has no FROM/JOIN', () => {
  assert.equal(resolve("select i|\nfrom {{ ref('orders') }}, {{ ref('customers') }}"), undefined);
});

void test('a ref anywhere else in the file also makes it ambiguous', () => {
  assert.equal(
    resolve("select i|\nfrom {{ ref('orders') }}\nwhere id in (select id from {{ ref('vip') }})"),
    undefined,
  );
});

void test('a CTE puts a second candidate in scope, for the final SELECT', () => {
  assert.equal(
    resolve("with recent as (\n  select * from {{ ref('orders') }}\n)\nselect r|\nfrom recent"),
    undefined,
  );
});

void test('inside a CTE body with a single unaliased ref: columns resolve against it', () => {
  assert.deepEqual(
    resolve("with recent as (\n  select ord|\n  from {{ ref('orders') }}\n)\nselect * from recent"),
    { kind: 'ref', modelName: 'orders' },
  );
});

void test('inside a CTE body: an alias there is still the alias. path', () => {
  assert.equal(
    resolve(
      "with recent as (\n  select o|\n  from {{ ref('orders') }} o\n)\nselect * from recent",
    ),
    undefined,
  );
});

void test('inside a CTE body with two tables: still ambiguous', () => {
  assert.equal(
    resolve(
      "with recent as (\n  select i|\n  from {{ ref('orders') }}\n  join {{ ref('customers') }} on 1 = 1\n)\nselect * from recent",
    ),
    undefined,
  );
});

void test('a second CTE elsewhere in the file does not leak into this one', () => {
  assert.deepEqual(
    resolve(
      "with a as (\n  select ord|\n  from {{ ref('orders') }}\n), b as (\n  select * from {{ ref('customers') }}\n)\nselect * from a, b",
    ),
    { kind: 'ref', modelName: 'orders' },
  );
});

void test('directly after FROM a table name is being typed, not a column', () => {
  assert.equal(resolve("select *\nfrom or|\nfrom {{ ref('orders') }}"), undefined);
});

void test('inside a jinja tag: the ref completion owns that context', () => {
  assert.equal(resolve("select *\nfrom {{ ref('or|') }}"), undefined);
});

void test('inside a string literal', () => {
  assert.equal(resolve("select 'ord|'\nfrom {{ ref('orders') }}"), undefined);
});

void test('inside a line comment', () => {
  assert.equal(resolve("select 1 -- ord|\nfrom {{ ref('orders') }}"), undefined);
});

void test('inside a block comment', () => {
  assert.equal(resolve("/* ord|\n*/ select 1 from {{ ref('orders') }}"), undefined);
});

void test('no table reference at all', () => {
  assert.equal(resolve('select 1|'), undefined);
});
