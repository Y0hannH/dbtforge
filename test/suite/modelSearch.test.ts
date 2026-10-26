import { test } from 'node:test';

import { strict as assert } from 'assert';

import type { DbtNode } from '../../src/index/manifestTypes';
import { buildModelSearchItems } from '../../src/search/modelSearch';

function node(extra: Partial<DbtNode>): DbtNode {
  return {
    unique_id: 'model.shop.orders',
    resource_type: 'model',
    name: 'orders',
    package_name: 'shop',
    path: 'marts/orders.sql',
    original_file_path: 'models/marts/orders.sql',
    ...extra,
  };
}

void test('models, seeds and snapshots are searchable; tests and analyses are not', () => {
  const items = buildModelSearchItems(
    [
      node({}),
      node({ unique_id: 'seed.shop.countries', resource_type: 'seed', name: 'countries' }),
      node({ unique_id: 'snapshot.shop.snap', resource_type: 'snapshot', name: 'snap' }),
      node({ unique_id: 'test.shop.t', resource_type: 'test', name: 't' }),
      node({ unique_id: 'analysis.shop.a', resource_type: 'analysis', name: 'a' }),
    ],
    'shop',
  );
  assert.deepEqual(
    items.map((i) => i.uniqueId),
    ['seed.shop.countries', 'model.shop.orders', 'snapshot.shop.snap'],
  );
});

void test('every version of a versioned model is its own entry', () => {
  const items = buildModelSearchItems(
    [
      node({ unique_id: 'model.shop.dim.v1', name: 'dim', version: 1 }),
      node({ unique_id: 'model.shop.dim.v2', name: 'dim', version: 2 }),
    ],
    'shop',
  );
  assert.deepEqual(
    items.map((i) => i.label),
    ['dim (v1)', 'dim (v2)'],
  );
});

void test('the folder is the description, and an installed package is named', () => {
  const [own, installed] = buildModelSearchItems(
    [
      node({ name: 'a_own' }),
      node({
        unique_id: 'model.dbt_utils.b',
        name: 'b_pkg',
        package_name: 'dbt_utils',
        original_file_path: 'models/utils/b.sql',
      }),
    ],
    'shop',
  );
  assert.equal(own?.description, 'models/marts');
  assert.equal(installed?.description, 'dbt_utils · models/utils');
});

void test('two models with the same name are told apart by their folder', () => {
  const items = buildModelSearchItems(
    [
      node({ unique_id: 'model.shop.x2', name: 'stg', original_file_path: 'models/b/stg.sql' }),
      node({ unique_id: 'model.shop.x1', name: 'stg', original_file_path: 'models/a/stg.sql' }),
    ],
    'shop',
  );
  assert.deepEqual(
    items.map((i) => i.description),
    ['models/a', 'models/b'],
  );
});
