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

/** The CTE's name when `resolve` found one, so a test reads as "resolves to this CTE". */
function resolveCteName(sqlWithCursor: string): string | undefined {
  const origin = resolve(sqlWithCursor);
  return origin?.kind === 'cte' ? origin.cte.name : undefined;
}

const RECENT = "with recent as (\n  select id from {{ ref('orders') }}\n)\n";
const TWO_CTES =
  "with a as (select x from {{ ref('one') }}), b as (select y from {{ ref('two') }})\n";

void test('final SELECT reading one unaliased CTE: columns resolve against that CTE', () => {
  assert.equal(resolveCteName(`${RECENT}select i|\nfrom recent`), 'recent');
});

void test('final SELECT after CTEs, with a WHERE: still the one table', () => {
  assert.equal(resolveCteName(`${RECENT}select i|\n  from recent\n where id > 1`), 'recent');
});

void test('the CTE name is matched ignoring case and delimiters', () => {
  assert.equal(
    resolveCteName('with "Recent" as (\n  select id from t\n)\nselect i|\nfrom RECENT'),
    'Recent',
  );
});

void test('final SELECT reading one CTE out of several resolves against the one it reads', () => {
  assert.equal(resolveCteName(`${TWO_CTES}select y|\nfrom b`), 'b');
});

void test('final SELECT reading a single ref() after CTEs resolves against it, not the CTEs', () => {
  assert.deepEqual(resolve(`${RECENT}select i|\nfrom {{ ref('customers') }}`), {
    kind: 'ref',
    modelName: 'customers',
  });
});

void test('final SELECT: an alias on the CTE is the alias. path', () => {
  assert.equal(resolve(`${RECENT}select r|\nfrom recent r`), undefined);
});

void test('final SELECT joining the CTE to another table: ambiguous again', () => {
  assert.equal(
    resolve(
      `${RECENT}select i|\nfrom recent\njoin {{ ref('customers') }} as c on c.id = recent.id`,
    ),
    undefined,
  );
});

void test('final SELECT with a comma join between two CTEs', () => {
  assert.equal(resolve(`${TWO_CTES}select x|\nfrom a, b`), undefined);
});

void test('final SELECT reading a table that is not a CTE of this file', () => {
  assert.equal(resolve(`${RECENT}select i|\nfrom raw.public.orders`), undefined);
});

void test('final SELECT with a subquery: the cursor may be in either statement', () => {
  assert.equal(resolve(`${TWO_CTES}select x|\nfrom a\nwhere x in (select y from b)`), undefined);
});

void test('final SELECT with a UNION: two statements', () => {
  assert.equal(
    resolve(
      "with a as (select x from {{ ref('one') }})\nselect x|\nfrom a\nunion all\nselect x from a",
    ),
    undefined,
  );
});

void test('a pivot reshapes the columns, so the table is not plain', () => {
  assert.equal(
    resolve(
      "with a as (select x from {{ ref('one') }})\nselect x|\nfrom a pivot (sum(x) for y in ('p'))",
    ),
    undefined,
  );
});

void test('between two CTEs there is no statement to be in', () => {
  assert.equal(
    resolve(
      "with a as (select x from {{ ref('one') }}),\n| b as (select y from {{ ref('two') }})\nselect * from a",
    ),
    undefined,
  );
});

void test('inside a CTE body reading one earlier CTE: columns resolve against it', () => {
  assert.equal(
    resolveCteName(
      "with a as (select x from {{ ref('one') }}), b as (\n  select x|\n  from a\n)\nselect * from b",
    ),
    'a',
  );
});

void test('a CTE cannot read one written after it, or itself', () => {
  assert.equal(
    resolve(
      "with a as (\n  select x|\n  from b\n), b as (select y from {{ ref('two') }})\nselect * from a",
    ),
    undefined,
  );
  assert.equal(resolve('with a as (\n  select x|\n  from a\n)\nselect * from a'), undefined);
});

void test('a CTE body mixing a CTE and a ref() in one FROM is two tables', () => {
  assert.equal(
    resolve(
      "with a as (select x from {{ ref('one') }}), b as (\n  select x|\n  from {{ ref('two') }}\n  join a on a.x = 1\n)\nselect * from b",
    ),
    undefined,
  );
  assert.equal(
    resolve(
      "with a as (select x from {{ ref('one') }}), b as (\n  select x|\n  from {{ ref('two') }}, a\n)\nselect * from b",
    ),
    undefined,
  );
});

void test('a subquery on a plain table stands the statement down, though it holds one ref()', () => {
  assert.equal(
    resolve("select x|\nfrom {{ ref('two') }} where id in (select id from raw.public.vip)"),
    undefined,
  );
});

const STYLE_GUIDE_MODEL = [
  'with cte1 as (',
  "    select column1 from {{ source('source_name', 'table_name') }}",
  "     where lower(column2) = 'active'",
  '    qualify row_number() over (partition by column1 order by column1) = 1',
  ')',
  ', cte2 as (',
  "    select table1.column1, table2.column2 from {{ ref('table_name1') }} as table1",
  "      join {{ ref('table_name2') }} as table2 on table2.column1 = table1.column1",
  ')',
  ', cte3 as (',
  '    select cte1.column1, cte2.column2 from cte1 join cte2 on cte1.column1 = left(cte2.column1, 5)',
  ')',
  'select column1',
  '     , column2',
  '  from cte3',
].join('\n');

void test('style-guide model: the single-source CTE resolves against its source', () => {
  assert.deepEqual(
    resolve(STYLE_GUIDE_MODEL.replace('select column1 from', 'select column1| from')),
    {
      kind: 'source',
      sourceName: 'source_name',
      tableName: 'table_name',
    },
  );
});

void test('style-guide model: the joined CTE has no single origin', () => {
  assert.equal(
    resolve(STYLE_GUIDE_MODEL.replace('select cte1.column1,', 'select cte1.column1|,')),
    undefined,
  );
});

void test('style-guide model: the final SELECT resolves against the CTE it reads', () => {
  assert.equal(
    resolveCteName(STYLE_GUIDE_MODEL.replace('     , column2', '     , column2|')),
    'cte3',
  );
});

void test('a file that opens with WITH but does not parse is not read as having no CTEs', () => {
  assert.equal(
    resolve("with a as (select x from {{ ref('one') }}\nselect x|\nfrom {{ ref('two') }}"),
    undefined,
  );
});

void test('a function that takes FROM does not count as a second table', () => {
  assert.deepEqual(resolve("select extract(year from created_at), i|\nfrom {{ ref('orders') }}"), {
    kind: 'ref',
    modelName: 'orders',
  });
});

void test('inside a CTE body with a single unaliased ref: columns resolve against it', () => {
  assert.deepEqual(
    resolve("with recent as (\n  select ord|\n  from {{ ref('orders') }}\n)\nselect * from recent"),
    { kind: 'ref', modelName: 'orders' },
  );
});

void test('inside a CTE body: an alias there is still the alias. path', () => {
  assert.equal(
    resolve("with recent as (\n  select o|\n  from {{ ref('orders') }} o\n)\nselect * from recent"),
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
