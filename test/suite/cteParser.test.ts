import { strict as assert } from 'assert';
import { test } from 'node:test';
import { parseCtes, parseModelSql } from '../../src/sql/cteParser';

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
  assert.deepEqual(
    ctes.map((cte) => ({ name: cte.name, columns: cte.columns })),
    [
      { name: 'a', columns: ['x', 'y'] },
      { name: 'b', columns: ['z'] },
    ]
  );
  // Offsets must delimit each CTE's own body, which is what the preview rewrite splices around.
  assert.equal(sql.slice(ctes[0].bodyStart, ctes[0].bodyEnd).trim(), 'select x, y from t1');
  assert.equal(sql.slice(ctes[1].bodyStart, ctes[1].bodyEnd).trim(), 'select z from t2');
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

test('parseCtes: a CTE whose columns cannot be resolved is still reported', () => {
  // The rewrite needs every CTE; autocomplete is what filters the column-less ones out.
  const ctes = parseCtes('with a as (select * from t) select * from a');
  assert.equal(ctes.length, 1);
  assert.deepEqual(ctes[0].columns, []);
});

test('parseModelSql: locates the final select after the CTE list', () => {
  const sql = `with a as (\n  select x from t\n)\nselect distinct x from a`;
  const parsed = parseModelSql(sql);

  assert.equal(sql.slice(parsed.finalSelectStart), 'select distinct x from a');
  assert.equal(parsed.isDistinct, true);
  assert.equal(parsed.hasOrderBy, false);
});

test('parseModelSql: a parenthesis inside a comment does not shift the structure', () => {
  const sql = `-- a stray ( bracket\nselect distinct a from t`;
  const parsed = parseModelSql(sql);

  assert.equal(sql.slice(parsed.finalSelectStart), 'select distinct a from t');
  assert.equal(parsed.isDistinct, true);
});

test('parseModelSql: a parenthesis inside a string literal does not shift the structure', () => {
  const parsed = parseModelSql("select distinct ')' as paren from t");
  assert.equal(parsed.isDistinct, true);
  assert.equal(parsed.finalSelectStart, 0);
});

test('parseModelSql: Jinja blocks are skipped rather than read as SQL', () => {
  const sql = `{{ config(materialized='table') }}\nselect distinct a from t`;
  const parsed = parseModelSql(sql);

  assert.equal(sql.slice(parsed.finalSelectStart), 'select distinct a from t');
  assert.equal(parsed.isDistinct, true);
});

test('parseModelSql: a nested block comment is one comment, as in T-SQL', () => {
  const sql = `/* outer /* inner */ still comment */\nselect distinct a from t`;
  assert.equal(parseModelSql(sql).isDistinct, true);
});

test('parseModelSql: an unbalanced CTE reports failure instead of a position', () => {
  assert.equal(parseModelSql('with a as (select 1').finalSelectStart, -1);
});

test('parseModelSql: a statement that is not a select reports failure', () => {
  assert.equal(parseModelSql('insert into t values (1)').finalSelectStart, -1);
});

test('parseModelSql: a top-level ORDER BY is distinguished from a windowed one', () => {
  assert.equal(parseModelSql('select a from t order by a').hasOrderBy, true);
  assert.equal(parseModelSql('select rank() over (order by a) from t').hasOrderBy, false);
});

test('parseCtes: an explicit CTE column list is accepted', () => {
  const ctes = parseCtes('with a (x, y) as (select 1 as x, 2 as y) select * from a');
  assert.equal(ctes.length, 1);
  assert.equal(ctes[0].name, 'a');
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
