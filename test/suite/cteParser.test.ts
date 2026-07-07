import { strict as assert } from 'assert';
import { test } from 'node:test';
import { parseCtes } from '../../src/sql/cteParser';

test('parseCtes: single CTE with explicit and bare aliases', () => {
  const sql = `
    with customers as (
      select
        c.customer_id,
        c.first_name as fname,
        c.last_name
      from {{ ref('stg_customers') }} c
    )
    select * from customers
  `;
  const ctes = parseCtes(sql);
  assert.equal(ctes.length, 1);
  assert.equal(ctes[0].name, 'customers');
  assert.deepEqual(ctes[0].columns, ['customer_id', 'fname', 'last_name']);
});

test('parseCtes: multiple comma-separated CTEs', () => {
  const sql = `
    with a as (
      select x, y from t1
    ), b as (
      select z from t2
    )
    select * from a join b on a.x = b.z
  `;
  const ctes = parseCtes(sql);
  assert.equal(ctes.length, 2);
  assert.deepEqual(ctes[0], { name: 'a', columns: ['x', 'y'] });
  assert.deepEqual(ctes[1], { name: 'b', columns: ['z'] });
});

test('parseCtes: unaliased expression column is omitted, not guessed', () => {
  const sql = `
    with a as (
      select x, x + 1, count(*) as cnt from t1
    )
    select * from a
  `;
  const ctes = parseCtes(sql);
  assert.deepEqual(ctes[0].columns, ['x', 'cnt']);
});

test('parseCtes: bracketed T-SQL identifiers', () => {
  const sql = `
    with a as (
      select [Customer Id], t.[First Name] as [fname] from t1 t
    )
    select * from a
  `;
  const ctes = parseCtes(sql);
  assert.deepEqual(ctes[0].columns, ['Customer Id', 'fname']);
});

test('parseCtes: no WITH clause returns empty array', () => {
  assert.deepEqual(parseCtes('select * from t1'), []);
});

test('parseCtes: commas inside function calls do not split columns', () => {
  const sql = `
    with a as (
      select coalesce(x, 0) as x, y from t1
    )
    select * from a
  `;
  const ctes = parseCtes(sql);
  assert.deepEqual(ctes[0].columns, ['x', 'y']);
});
