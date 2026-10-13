import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { SourceRef } from '../../src/sql/aliasParser';
import type { CteColumn } from '../../src/sql/cteColumns';
import { resolveCteColumns } from '../../src/sql/cteColumns';
import { parseCtes } from '../../src/sql/cteParser';

function cteOf(sql: string) {
  const [cte] = parseCtes(sql);
  assert.ok(cte, 'expected a CTE');
  return cte;
}

const NEVER: (source: SourceRef) => CteColumn[] | undefined = () => {
  assert.fail('the catalog should not have been consulted');
};

void test('resolveCteColumns: a CTE with no star answers from the text alone', () => {
  const cte = cteOf(`with a as (select x, y as z from {{ ref('t') }}) select * from a`);
  assert.deepEqual(resolveCteColumns(cte, NEVER), [{ name: 'x' }, { name: 'z' }]);
});

void test('resolveCteColumns: a declared column list answers alone, whatever the star would add', () => {
  const cte = cteOf(`with a (x, y) as (select * from {{ ref('t') }}) select * from a`);
  assert.deepEqual(resolveCteColumns(cte, NEVER), [{ name: 'x' }, { name: 'y' }]);
});

void test('resolveCteColumns: an unreadable column list offers nothing, not the SELECT list', () => {
  const cte = cteOf(`with a ({{ var('c') }}) as (select p, q from {{ ref('t') }}) select * from a`);
  assert.equal(resolveCteColumns(cte, NEVER), undefined);
});

void test('resolveCteColumns: a star adds the table columns to the ones the text names', () => {
  const cte = cteOf(`with a as (select 1 as gmv_id, * from {{ ref('gmv') }}) select * from a`);
  const asked: SourceRef[] = [];
  const result = resolveCteColumns(cte, (source) => {
    asked.push(source);
    return [
      { name: 'INVOICE_ID', type: 'NUMBER' },
      { name: 'GMV_ID', type: 'NUMBER' },
    ];
  });

  assert.deepEqual(asked, [{ kind: 'ref', modelName: 'gmv' }]);
  // GMV_ID is the gmv_id the text already named: once, and as written.
  assert.deepEqual(result, [{ name: 'gmv_id' }, { name: 'INVOICE_ID', type: 'NUMBER' }]);
});

void test('resolveCteColumns: a star over a model the catalog does not know offers nothing', () => {
  // The one named column must not be shown on its own: it would read as the whole list.
  const cte = cteOf(`with a as (select 1 as gmv_id, * from {{ ref('gmv') }}) select * from a`);
  assert.equal(
    resolveCteColumns(cte, () => undefined),
    undefined,
  );
});

void test('resolveCteColumns: an unresolved star offers nothing and asks no one', () => {
  const cte = cteOf(`
    with a as (
      select 1 as gmv_id, * from {{ ref('gmv') }} g join {{ ref('other') }} o on o.id = g.id
    ) select * from a
  `);
  assert.equal(resolveCteColumns(cte, NEVER), undefined);
});

void test('resolveCteColumns: a CTE that names and expands nothing offers nothing', () => {
  const cte = cteOf(`with a as (select count(*) from {{ ref('t') }}) select * from a`);
  assert.equal(resolveCteColumns(cte, NEVER), undefined);
});
