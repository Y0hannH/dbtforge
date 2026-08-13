import { strict as assert } from 'assert';
import { test } from 'node:test';
import { isTsqlAdapter, needsTopRewrite, rewriteWithTopLimit } from '../../src/dbt/previewRewrite';

test('isTsqlAdapter: only the SQL Server family appends its limit clause', () => {
  assert.equal(isTsqlAdapter('fabric'), true);
  assert.equal(isTsqlAdapter('sqlserver'), true);
  assert.equal(isTsqlAdapter('synapse'), true);
  assert.equal(isTsqlAdapter('SQLServer'), true);

  assert.equal(isTsqlAdapter('postgres'), false);
  assert.equal(isTsqlAdapter('snowflake'), false);
  assert.equal(isTsqlAdapter('databricks'), false);
});

test('needsTopRewrite: only a DISTINCT final select collides with the appended ORDER BY', () => {
  assert.equal(needsTopRewrite('select distinct a, b from t'), true);
  assert.equal(needsTopRewrite('select a, b from t'), false);
});

test('needsTopRewrite: a DISTINCT inside a CTE is harmless, only the final select matters', () => {
  const sql = `
    with deduped as (
      select distinct a from t
    )
    select a from deduped
  `;
  assert.equal(needsTopRewrite(sql), false);
});

test('needsTopRewrite: a CTE without DISTINCT downstream needs nothing', () => {
  const sql = `
    with a as (select x from t)
    select x from a
  `;
  assert.equal(needsTopRewrite(sql), false);
});

test('rewriteWithTopLimit: wraps the final select so DISTINCT sits inside a derived table', () => {
  const rewritten = rewriteWithTopLimit('select distinct a, b from t', 100);

  assert.ok(rewritten);
  assert.ok(rewritten.startsWith('select top 100 * from ('));
  assert.ok(rewritten.includes('select distinct a, b from t'));
  assert.ok(rewritten.trimEnd().endsWith(') as dbtforge_preview'));
});

test('rewriteWithTopLimit: CTEs stay at the top level, where T-SQL requires them', () => {
  const sql = `with a as (\n  select x from t\n)\nselect distinct x from a`;
  const rewritten = rewriteWithTopLimit(sql, 50);

  assert.ok(rewritten);
  // The WITH clause must precede the wrapper: a CTE inside a derived table is invalid in T-SQL.
  assert.ok(rewritten.startsWith('with a as ('));
  assert.ok(rewritten.indexOf('select top 50 * from (') > rewritten.indexOf('select x from t'));
  assert.ok(rewritten.includes('select distinct x from a'));
});

test('rewriteWithTopLimit: Jinja is preserved, since --inline compiles it', () => {
  const sql = `select distinct id from {{ ref('stg_orders') }}`;
  const rewritten = rewriteWithTopLimit(sql, 10);

  assert.ok(rewritten?.includes("{{ ref('stg_orders') }}"));
});

test('rewriteWithTopLimit: a trailing semicolon would break the derived table, so it goes', () => {
  const rewritten = rewriteWithTopLimit('select distinct a from t;', 10);

  assert.ok(rewritten);
  assert.ok(!rewritten.includes(';'));
  assert.ok(rewritten.trimEnd().endsWith(') as dbtforge_preview'));
});

test('rewriteWithTopLimit: refuses a query ending in ORDER BY rather than trading one error for another', () => {
  assert.equal(rewriteWithTopLimit('select distinct a from t order by a', 10), undefined);
});

test('rewriteWithTopLimit: an ORDER BY inside a window function is not the statement\'s own', () => {
  const sql = 'select distinct row_number() over (order by a) as rn from t';
  assert.ok(rewriteWithTopLimit(sql, 10));
});

test('rewriteWithTopLimit: refuses what it cannot parse instead of splicing blindly', () => {
  assert.equal(rewriteWithTopLimit('with a as (select 1', 10), undefined);
  assert.equal(rewriteWithTopLimit('insert into t values (1)', 10), undefined);
});

test('rewriteWithTopLimit: refuses a non-positive limit, which carries no TOP', () => {
  assert.equal(rewriteWithTopLimit('select distinct a from t', -1), undefined);
  assert.equal(rewriteWithTopLimit('select distinct a from t', 0), undefined);
});

test('rewriteWithTopLimit: a UNION is contained by the derived table', () => {
  const sql = 'select distinct a from t union select b from u';
  const rewritten = rewriteWithTopLimit(sql, 10);

  assert.ok(rewritten);
  // TOP on the first branch alone would not limit the union; wrapping the whole thing does.
  assert.ok(rewritten.startsWith('select top 10 * from ('));
  assert.ok(rewritten.includes('union select b from u'));
});
