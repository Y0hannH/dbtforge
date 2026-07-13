import { strict as assert } from 'assert';
import { test } from 'node:test';
import { buildInitialSubgraph, expandNode } from '../../src/lineage/buildLineageGraph';
import type { DbtProjectIndex } from '../../src/index/DbtProjectIndex';
import { DependencyGraph } from '../../src/index/graph';
import { DbtNode } from '../../src/index/manifestTypes';

function makeNode(uniqueId: string, name: string): DbtNode {
  return {
    unique_id: uniqueId,
    resource_type: 'model',
    name,
    package_name: 'pkg',
    path: `${name}.sql`,
    original_file_path: `models/${name}.sql`,
  };
}

// a -> b -> c, and a -> b -> d (root = b): two parents-of-c... actually b has one parent (a)
// and two children (c, d); a itself has a further parent (z), two hops from root.
const nodes: Record<string, DbtNode> = {
  'model.pkg.z': makeNode('model.pkg.z', 'z'),
  'model.pkg.a': makeNode('model.pkg.a', 'a'),
  'model.pkg.b': makeNode('model.pkg.b', 'b'),
  'model.pkg.c': makeNode('model.pkg.c', 'c'),
  'model.pkg.d': makeNode('model.pkg.d', 'd'),
};

const parents: Record<string, string[]> = {
  'model.pkg.a': ['model.pkg.z'],
  'model.pkg.b': ['model.pkg.a'],
};
const children: Record<string, string[]> = {
  'model.pkg.z': ['model.pkg.a'],
  'model.pkg.a': ['model.pkg.b'],
  'model.pkg.b': ['model.pkg.c', 'model.pkg.d'],
};

const fakeGraph: DependencyGraph = {
  getParents: (id) => parents[id] ?? [],
  getChildren: (id) => children[id] ?? [],
  getTests: () => [],
  getMacroCallers: () => [],
};

const fakeIndex = {
  getGraph: () => fakeGraph,
  getNode: (id: string) => nodes[id],
} as unknown as DbtProjectIndex;

test('buildInitialSubgraph: includes root, direct parents and direct children only', () => {
  const { nodes: resultNodes, edges } = buildInitialSubgraph(fakeIndex, 'model.pkg.b');
  const ids = resultNodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ['model.pkg.a', 'model.pkg.b', 'model.pkg.c', 'model.pkg.d'].sort());
  assert.equal(resultNodes.find((n) => n.id === 'model.pkg.b')?.isRoot, true);
  assert.equal(resultNodes.find((n) => n.id === 'model.pkg.a')?.isRoot, false);
  assert.equal(edges.length, 3); // a->b, b->c, b->d
});

test('buildInitialSubgraph: root node reports correct parent/child counts', () => {
  const { nodes: resultNodes } = buildInitialSubgraph(fakeIndex, 'model.pkg.b');
  const root = resultNodes.find((n) => n.id === 'model.pkg.b');
  assert.equal(root?.parentCount, 1);
  assert.equal(root?.childCount, 2);
});

test('expandNode: "up" returns the next hop of parents with correctly directed edges', () => {
  const { nodes: resultNodes, edges } = expandNode(fakeIndex, 'model.pkg.a', 'up');
  assert.deepEqual(
    resultNodes.map((n) => n.id),
    ['model.pkg.z']
  );
  assert.deepEqual(edges, [{ source: 'model.pkg.z', target: 'model.pkg.a' }]);
});

test('expandNode: "down" returns the next hop of children with correctly directed edges', () => {
  const { nodes: resultNodes, edges } = expandNode(fakeIndex, 'model.pkg.b', 'down');
  const ids = resultNodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ['model.pkg.c', 'model.pkg.d']);
  assert.deepEqual(
    edges.sort((e1, e2) => e1.target.localeCompare(e2.target)),
    [
      { source: 'model.pkg.b', target: 'model.pkg.c' },
      { source: 'model.pkg.b', target: 'model.pkg.d' },
    ]
  );
});

test('expandNode: no more neighbors in a direction returns empty subgraph', () => {
  const result = expandNode(fakeIndex, 'model.pkg.z', 'up');
  assert.deepEqual(result, { nodes: [], edges: [] });
});
