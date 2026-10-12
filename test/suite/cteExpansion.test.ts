import { test } from 'node:test';

import { strict as assert } from 'assert';

import { parseCtes } from '../../src/sql/cteParser';

// A star in a CTE's SELECT list expands into columns the text never names. The parser must say so,
// and say which single table they come from when that can be told — or that it can't. Reporting
// only the named columns, as if they were all of them, is the one answer it must never give.

function firstCte(sql: string) {
  const [cte] = parseCtes(sql);
  assert.ok(cte, 'expected a CTE');
  return cte;
}

void test('expansion: a star beside a named column resolves to the one table it reads', () => {
  const sql = `
    with total_gmv as (
      select {{ dbt_utils.generate_surrogate_key(['invoice_id', 'gmv_event']) }}::varchar as gmv_id
           , * from {{ ref('gmv_finalized') }}
       union
      select {{ dbt_utils.generate_surrogate_key(['invoice_id', 'gmv_event']) }}::varchar as gmv_id
           , * from {{ ref('gmv_voided') }}
    )
    select total_gmv.gmv_id
      from total_gmv
      join {{ ref('util_business_calendar') }} as calendar on calendar.calendar_day = total_gmv.gmv_date
  `;
  const cte = firstCte(sql);
  assert.deepEqual(cte.columns, ['gmv_id']);
  // The first branch names the columns of a UNION; the second is not consulted.
  assert.deepEqual(cte.expansion, { source: { kind: 'ref', modelName: 'gmv_finalized' } });
});

void test('expansion: a bare star names no column and still resolves', () => {
  const cte = firstCte(`with a as (select * from {{ ref('orders') }}) select * from a`);
  assert.deepEqual(cte.columns, []);
  assert.deepEqual(cte.expansion, { source: { kind: 'ref', modelName: 'orders' } });
});

void test('expansion: a source() is a source', () => {
  const cte = firstCte(`with a as (select * from {{ source('raw', 'orders') }}) select * from a`);
  assert.deepEqual(cte.expansion, {
    source: { kind: 'source', sourceName: 'raw', tableName: 'orders' },
  });
});

void test('expansion: `alias.*` resolves when the alias is the one the table was given', () => {
  const cte = firstCte(
    `with a as (select o.*, o.total as amount from {{ ref('orders') }} as o) select * from a`,
  );
  assert.deepEqual(cte.columns, ['amount']);
  assert.deepEqual(cte.expansion, { source: { kind: 'ref', modelName: 'orders' } });
});

void test('expansion: `alias.*` for a different alias is not this table', () => {
  const cte = firstCte(`with a as (select x.* from {{ ref('orders') }} o) select * from a`);
  assert.deepEqual(cte.expansion, {});
});

void test('expansion: a join puts a second table behind the star', () => {
  const cte = firstCte(`
    with a as (
      select * from {{ ref('orders') }} o join {{ ref('customers') }} c on c.id = o.customer_id
    ) select * from a
  `);
  assert.deepEqual(cte.expansion, {});
});

void test('expansion: a comma join does too', () => {
  const cte = firstCte(
    `with a as (select * from {{ ref('orders') }} o, {{ ref('customers') }} c) select * from a`,
  );
  assert.deepEqual(cte.expansion, {});
});

void test('expansion: a star over another CTE or a plain table is unresolved', () => {
  const ctes = parseCtes(`
    with a as (select x from {{ ref('t') }}),
    b as (select * from a),
    c as (select * from analytics.orders)
    select * from b
  `);
  assert.equal(ctes.length, 3);
  assert.equal(ctes[0].expansion, undefined);
  assert.deepEqual(ctes[1].expansion, {});
  assert.deepEqual(ctes[2].expansion, {});
});

void test('expansion: a subquery is not the table inside it', () => {
  const cte = firstCte(
    `with a as (select * from (select x from {{ ref('orders') }}) sub) select * from a`,
  );
  assert.deepEqual(cte.expansion, {});
});

void test('expansion: a pivot reshapes the columns, so the table is not what the star shows', () => {
  const cte = firstCte(
    `with a as (select * from {{ ref('orders') }} pivot (sum(amount) for status in ('a', 'b'))) select * from a`,
  );
  assert.deepEqual(cte.expansion, {});
});

void test('expansion: `* exclude (...)` drops columns the catalog would still list', () => {
  const cte = firstCte(
    `with a as (select * exclude (secret) from {{ ref('orders') }}) select * from a`,
  );
  assert.deepEqual(cte.expansion, {});
});

void test('expansion: a Jinja macro in the list writes columns the parser cannot see', () => {
  const cte = firstCte(`
    with a as (
      select {{ dbt_utils.star(from=ref('orders')) }}, 1 as one from {{ ref('orders') }}
    ) select * from a
  `);
  assert.deepEqual(cte.columns, ['one']);
  assert.deepEqual(cte.expansion, {});
});

void test('expansion: a macro with an alias is a named column, not an expansion', () => {
  const cte = firstCte(`
    with a as (select {{ cents_to_dollars('amount') }} as amount from {{ ref('orders') }})
    select * from a
  `);
  assert.deepEqual(cte.columns, ['amount']);
  assert.equal(cte.expansion, undefined);
});

void test('expansion: a WHERE clause is not part of the FROM clause', () => {
  const cte = firstCte(`
    with a as (
      select * from {{ ref('orders') }}
      where customer_id in (select id from {{ ref('customers') }})
    ) select * from a
  `);
  assert.deepEqual(cte.expansion, { source: { kind: 'ref', modelName: 'orders' } });
});

void test('expansion: a comment above the star does not hide it', () => {
  const cte = firstCte(`
    with a as (
      select
        1 as one,
        -- everything else
        *
      from {{ ref('orders') }}
    ) select * from a
  `);
  assert.deepEqual(cte.columns, ['one']);
  assert.deepEqual(cte.expansion, { source: { kind: 'ref', modelName: 'orders' } });
});

void test('expansion: the first branch decides, so a join there leaves the star unresolved', () => {
  const cte = firstCte(`
    with a as (
      select * from {{ ref('orders') }} o join {{ ref('customers') }} c on c.id = o.customer_id
      union all
      select * from {{ ref('archived_orders') }}
    ) select * from a
  `);
  assert.deepEqual(cte.expansion, {});
});

void test('expansion: no star means the property is absent, not empty', () => {
  const cte = firstCte(`with a as (select x, y as z from {{ ref('t') }}) select * from a`);
  assert.deepEqual(cte.columns, ['x', 'z']);
  assert.equal('expansion' in cte, false);
});
