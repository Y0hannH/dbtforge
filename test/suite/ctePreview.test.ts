import { strict as assert } from 'assert';
import { test } from 'node:test';
import { buildCtePreviewSql, cteNameAtOffset, listCteNames } from '../../src/sql/ctePreview';

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

/** The offset of `needle` in MODEL, so a cursor can be placed on real text rather than a number. */
function offsetOf(needle: string, source = MODEL): number {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `fixture does not contain ${needle}`);
  return index;
}

test('cteNameAtOffset: a cursor inside a CTE body names that CTE', () => {
  assert.equal(cteNameAtOffset(MODEL, offsetOf('customer_id')), 'orders');
});

test('cteNameAtOffset: a cursor on the declaration line counts as inside', () => {
  // That line is where the Preview CTE lens is drawn; the shortcut has to agree with it.
  assert.equal(cteNameAtOffset(MODEL, offsetOf('joined as (')), 'joined');
});

test('cteNameAtOffset: a cursor on the closing parenthesis still names the CTE', () => {
  const sql = 'with a as (select 1 as x) select * from a';
  assert.equal(cteNameAtOffset(sql, sql.indexOf(')')), 'a');
});

test('cteNameAtOffset: a cursor in the final select names nothing', () => {
  assert.equal(cteNameAtOffset(MODEL, offsetOf('select distinct')), undefined);
});

test('cteNameAtOffset: a cursor above the WITH clause names nothing', () => {
  assert.equal(cteNameAtOffset(MODEL, offsetOf('config(')), undefined);
});

test('cteNameAtOffset: a cursor between two CTEs names nothing', () => {
  // The blank line separating two CTEs belongs to neither, so neither may claim a cursor on it.
  assert.equal(cteNameAtOffset(MODEL, offsetOf('orders as (') - 1), undefined);
});

test('cteNameAtOffset: a model with no CTEs names nothing', () => {
  assert.equal(cteNameAtOffset('select 1 as x', 3), undefined);
});

test('cteNameAtOffset: unparseable SQL names nothing, rather than a guess', () => {
  assert.equal(cteNameAtOffset('with a as (select 1', 14), undefined);
});

test('cteNameAtOffset: a nested CTE resolves to the top-level one containing it', () => {
  // Only top-level CTEs can be previewed, so the enclosing one is the closest true answer.
  const sql = 'with outer_cte as (with inner_cte as (select 1 as x) select * from inner_cte) select * from outer_cte';
  assert.equal(cteNameAtOffset(sql, sql.indexOf('inner_cte')), 'outer_cte');
});

test('cteNameAtOffset: the name it reports can be previewed', () => {
  const name = cteNameAtOffset(MODEL, offsetOf('c.name, o.total'));

  assert.ok(name);
  assert.ok(buildCtePreviewSql(MODEL, name));
});
