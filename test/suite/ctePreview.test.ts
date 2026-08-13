import { strict as assert } from 'assert';
import { test } from 'node:test';
import { buildCtePreviewSql, listCteNames } from '../../src/sql/ctePreview';

const MODEL = `{{ config(materialized='table') }}

with customers as (
    select id, name from {{ ref('stg_customers') }}
),

orders as (
    select id, customer_id, total from {{ ref('stg_orders') }}
),

joined as (
    select c.name, o.total
    from customers c
    join orders o on o.customer_id = c.id
)

select distinct name, total from joined
`;

test('buildCtePreviewSql: selects from the requested CTE', () => {
  const sql = buildCtePreviewSql(MODEL, 'orders');

  assert.ok(sql);
  assert.ok(sql.trimEnd().endsWith('select * from orders'));
});

test('buildCtePreviewSql: keeps earlier CTEs, which the target may depend on', () => {
  const sql = buildCtePreviewSql(MODEL, 'joined');

  assert.ok(sql?.includes('customers as ('));
  assert.ok(sql?.includes('orders as ('));
});

test('buildCtePreviewSql: drops later CTEs and the model\'s own final select', () => {
  const sql = buildCtePreviewSql(MODEL, 'customers');

  assert.ok(sql);
  assert.ok(!sql.includes('joined as ('));
  assert.ok(!sql.includes('select distinct name, total'));
  // The trailing comma of the truncated CTE list must go with it, or the query won't parse.
  assert.ok(!sql.trimEnd().endsWith(','));
});

test('buildCtePreviewSql: keeps what precedes the WITH clause', () => {
  // A `{{ config() }}` is harmless, but a `{% set %}` the query depends on would not be.
  assert.ok(buildCtePreviewSql(MODEL, 'customers')?.startsWith("{{ config(materialized='table') }}"));
});

test('buildCtePreviewSql: Jinja inside the kept CTEs survives, since --inline compiles it', () => {
  assert.ok(buildCtePreviewSql(MODEL, 'orders')?.includes("{{ ref('stg_orders') }}"));
});

test('buildCtePreviewSql: a quoted or bracketed name is referenced exactly as declared', () => {
  const sql = 'with [My CTE] as (select 1 as x) select * from [My CTE]';
  assert.ok(buildCtePreviewSql(sql, 'My CTE')?.endsWith('select * from [My CTE]'));
});

test('buildCtePreviewSql: an unknown CTE yields nothing to run', () => {
  assert.equal(buildCtePreviewSql(MODEL, 'not_a_cte'), undefined);
});

test('buildCtePreviewSql: a model with no CTEs yields nothing to run', () => {
  assert.equal(buildCtePreviewSql('select 1 as x', 'anything'), undefined);
});

test('buildCtePreviewSql: unparseable SQL is refused rather than truncated at a guess', () => {
  assert.equal(buildCtePreviewSql('with a as (select 1', 'a'), undefined);
});

test('listCteNames: reports every CTE in declaration order', () => {
  assert.deepEqual(listCteNames(MODEL), ['customers', 'orders', 'joined']);
});

test('listCteNames: includes CTEs whose columns could not be resolved', () => {
  // `select *` defeats column extraction, but the CTE still deserves a preview button.
  assert.deepEqual(listCteNames('with a as (select * from t) select * from a'), ['a']);
});
