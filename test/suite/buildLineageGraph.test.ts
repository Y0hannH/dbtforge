import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  buildInitialSubgraph,
  buildScopedSubgraph,
  expandNode,
} from '../../src/lineage/buildLineageGraph';
import { DEFAULT_SCOPE, LineageScope, UNLIMITED_DEPTH } from '../../src/lineage/lineageScope';
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

test('buildInitialSubgraph: carries the materialization and colour the project declared', () => {
  const decorated: Record<string, DbtNode> = {
    ...nodes,
    'model.pkg.b': {
      ...nodes['model.pkg.b'],
      config: { materialized: 'incremental' },
      docs: { node_color: '#ff8800' },
    },
  };
  const index = {
    getGraph: () => fakeGraph,
    getNode: (id: string) => decorated[id],
  } as unknown as DbtProjectIndex;

  const root = buildInitialSubgraph(index, 'model.pkg.b').nodes.find((n) => n.id === 'model.pkg.b');
  assert.equal(root?.metaLabel, 'model · incremental');
  assert.equal(root?.color, '#ff8800');
});

test('buildInitialSubgraph: a node declaring neither still gets a usable label', () => {
  const root = buildInitialSubgraph(fakeIndex, 'model.pkg.b').nodes.find((n) => n.id === 'model.pkg.b');
  assert.equal(root?.metaLabel, 'model');
  assert.equal(root?.color, undefined);
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

// A second fixture, with the two things the scope controls exist for: a test hanging off the root
// (child_map carries those like any other child) and an ephemeral model among the children.
//   z -> a -> b -> c -> f
//             b -> d
//             b -> t   (test)
//             b -> e   (ephemeral)
const scopedNodes: Record<string, DbtNode> = {
  'model.pkg.z': makeNode('model.pkg.z', 'z'),
  'model.pkg.a': makeNode('model.pkg.a', 'a'),
  'model.pkg.b': makeNode('model.pkg.b', 'b'),
  'model.pkg.c': makeNode('model.pkg.c', 'c'),
  'model.pkg.d': makeNode('model.pkg.d', 'd'),
  'model.pkg.f': makeNode('model.pkg.f', 'f'),
  'test.pkg.t': { ...makeNode('test.pkg.t', 't'), resource_type: 'test' },
  'model.pkg.e': { ...makeNode('model.pkg.e', 'e'), config: { materialized: 'ephemeral' } },
};

const scopedParents: Record<string, string[]> = {
  'model.pkg.a': ['model.pkg.z'],
  'model.pkg.b': ['model.pkg.a'],
  'model.pkg.c': ['model.pkg.b'],
  'model.pkg.d': ['model.pkg.b'],
  'model.pkg.e': ['model.pkg.b'],
  'test.pkg.t': ['model.pkg.b'],
  'model.pkg.f': ['model.pkg.c'],
};

const scopedChildren: Record<string, string[]> = {
  'model.pkg.z': ['model.pkg.a'],
  'model.pkg.a': ['model.pkg.b'],
  'model.pkg.b': ['model.pkg.c', 'model.pkg.d', 'test.pkg.t', 'model.pkg.e'],
  'model.pkg.c': ['model.pkg.f'],
};

const scopedIndex = {
  getGraph: () => ({
    getParents: (id: string) => scopedParents[id] ?? [],
    getChildren: (id: string) => scopedChildren[id] ?? [],
    getTests: () => [],
    getMacroCallers: () => [],
  }),
  getNode: (id: string) => scopedNodes[id],
} as unknown as DbtProjectIndex;

const scope = (overrides: Partial<LineageScope> = {}): LineageScope => ({
  ...DEFAULT_SCOPE,
  ...overrides,
});

function idsOf(subgraph: { nodes: Array<{ id: string }> }): string[] {
  return subgraph.nodes.map((n) => n.id).sort();
}

test('buildScopedSubgraph: tests are left out of the graph by default', () => {
  const ids = idsOf(buildScopedSubgraph(scopedIndex, 'model.pkg.b', scope()));
  assert.equal(ids.includes('test.pkg.t'), false);
});

test('buildScopedSubgraph: the child count excludes the hidden test', () => {
  const result = buildScopedSubgraph(scopedIndex, 'model.pkg.b', scope());
  const root = result.nodes.find((n) => n.id === 'model.pkg.b');
  // c, d and e — not the test, which the expand button would otherwise promise to reveal.
  assert.equal(root?.childCount, 3);
});

test('buildScopedSubgraph: includeTests brings the test back as an ordinary node', () => {
  const result = buildScopedSubgraph(scopedIndex, 'model.pkg.b', scope({ includeTests: true }));
  assert.equal(idsOf(result).includes('test.pkg.t'), true);
  assert.equal(result.nodes.find((n) => n.id === 'model.pkg.b')?.childCount, 4);
});

test('buildScopedSubgraph: an excluded materialization drops that node', () => {
  const result = buildScopedSubgraph(
    scopedIndex,
    'model.pkg.b',
    scope({ excludedMaterializations: ['ephemeral'] })
  );
  assert.equal(idsOf(result).includes('model.pkg.e'), false);
  assert.equal(result.nodes.find((n) => n.id === 'model.pkg.b')?.childCount, 2);
});

test('buildScopedSubgraph: upstream depth 2 reaches the grandparent', () => {
  const ids = idsOf(
    buildScopedSubgraph(scopedIndex, 'model.pkg.b', scope({ upstreamDepth: 2, downstreamDepth: 0 }))
  );
  assert.deepEqual(ids, ['model.pkg.a', 'model.pkg.b', 'model.pkg.z']);
});

test('buildScopedSubgraph: downstream depth 2 reaches the grandchild', () => {
  const ids = idsOf(
    buildScopedSubgraph(scopedIndex, 'model.pkg.b', scope({ upstreamDepth: 0, downstreamDepth: 2 }))
  );
  assert.deepEqual(ids, ['model.pkg.b', 'model.pkg.c', 'model.pkg.d', 'model.pkg.e', 'model.pkg.f']);
});

test('buildScopedSubgraph: unlimited depth walks the whole DAG both ways', () => {
  const ids = idsOf(
    buildScopedSubgraph(
      scopedIndex,
      'model.pkg.b',
      scope({ upstreamDepth: UNLIMITED_DEPTH, downstreamDepth: UNLIMITED_DEPTH })
    )
  );
  assert.deepEqual(ids, [
    'model.pkg.a',
    'model.pkg.b',
    'model.pkg.c',
    'model.pkg.d',
    'model.pkg.e',
    'model.pkg.f',
    'model.pkg.z',
  ]);
});

test('buildScopedSubgraph: depth 0 both ways leaves the root on its own', () => {
  const result = buildScopedSubgraph(
    scopedIndex,
    'model.pkg.b',
    scope({ upstreamDepth: 0, downstreamDepth: 0 })
  );
  assert.deepEqual(idsOf(result), ['model.pkg.b']);
  assert.deepEqual(result.edges, []);
});

test('buildScopedSubgraph: the root survives a filter that would otherwise hide it', () => {
  // The user has the ephemeral model open; hiding ephemerals must not blank the view.
  const result = buildScopedSubgraph(
    scopedIndex,
    'model.pkg.e',
    scope({ excludedMaterializations: ['ephemeral'] })
  );
  assert.equal(result.nodes.find((n) => n.id === 'model.pkg.e')?.isRoot, true);
});

test('buildScopedSubgraph: no edge points at a node the scope filtered out', () => {
  const result = buildScopedSubgraph(scopedIndex, 'model.pkg.b', scope());
  const present = new Set(result.nodes.map((n) => n.id));
  for (const edge of result.edges) {
    assert.equal(present.has(edge.source), true, `dangling source ${edge.source}`);
    assert.equal(present.has(edge.target), true, `dangling target ${edge.target}`);
  }
});

test('expandNode: honours the scope it is given rather than the raw child list', () => {
  const withTests = expandNode(scopedIndex, 'model.pkg.b', 'down', scope({ includeTests: true }));
  const withoutTests = expandNode(scopedIndex, 'model.pkg.b', 'down', scope());
  assert.equal(idsOf(withTests).includes('test.pkg.t'), true);
  assert.equal(idsOf(withoutTests).includes('test.pkg.t'), false);
});
