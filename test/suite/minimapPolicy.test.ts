import { test } from 'node:test';

import { strict as assert } from 'assert';

import { MINIMAP_MIN_NODES, shouldShowMinimap } from '../../src/lineage/minimapPolicy';

void test('shouldShowMinimap: an editor tab with a graph too big to take in at once', () => {
  assert.equal(shouldShowMinimap('editor', MINIMAP_MIN_NODES), true);
  assert.equal(shouldShowMinimap('editor', 200), true);
});

void test('shouldShowMinimap: a small graph fits the viewport, so the minimap adds nothing', () => {
  assert.equal(shouldShowMinimap('editor', MINIMAP_MIN_NODES - 1), false);
  assert.equal(shouldShowMinimap('editor', 0), false);
});

void test('shouldShowMinimap: never in the bottom panel, however large the graph', () => {
  assert.equal(shouldShowMinimap('panel', 3), false);
  assert.equal(shouldShowMinimap('panel', 500), false);
});
