import { test } from 'node:test';

import { strict as assert } from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import type { DbtProjectIndex } from '../../src/index/dbtProjectIndex';
import { buildDocIndex } from '../../src/index/docIndex';
import { resolveEntityPath } from '../../src/index/entityPaths';
import { buildDependencyGraph } from '../../src/index/graph';
import { buildMacroIndex } from '../../src/index/macroIndex';
import type { DbtManifest, LineageEntity } from '../../src/index/manifestTypes';
import { buildRefIndex, isReferenceable } from '../../src/index/refIndex';
import { collectTags } from '../../src/index/tags';
import { buildScopedSubgraph } from '../../src/lineage/buildLineageGraph';
import { UNLIMITED_DEPTH } from '../../src/lineage/lineageScope';
import { readNodeColor } from '../../src/lineage/nodeDisplay';

// A matrix over manifest *shapes*, not over dbt versions: each fixture is a hand-written manifest
// carrying the traits that differ between what dbt has written over time (missing optional
// sections, the sections added by unit tests and the semantic layer, versioned models). They are
// synthetic — see fixtures/manifests/README.md — so this guards "does not throw, does not draw a
// dangling edge" and nothing about how faithful the fixture is to any one dbt release.

const FIXTURES_DIR = join(__dirname, '../fixtures/manifests');
const SAMPLE = join(__dirname, '../fixtures/manifest.sample.json');

function load(file: string): DbtManifest {
  return JSON.parse(readFileSync(file, 'utf8')) as DbtManifest;
}

const fixtures: Array<{ name: string; manifest: DbtManifest }> = [
  { name: 'manifest.sample.json', manifest: load(SAMPLE) },
  ...readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({ name: file, manifest: load(join(FIXTURES_DIR, file)) })),
];

// Mirrors DbtProjectIndex.getLineageEntity without the VS Code host the real class needs.
function indexFor(manifest: DbtManifest): DbtProjectIndex {
  const graph = buildDependencyGraph(manifest);
  return {
    getGraph: () => graph,
    getLineageEntity: (id: string): LineageEntity | undefined =>
      manifest.nodes[id] ?? manifest.sources[id] ?? manifest.exposures?.[id],
    getCatalogColumns: () => undefined,
  } as unknown as DbtProjectIndex;
}

const wholeDag = {
  upstreamDepth: UNLIMITED_DEPTH,
  downstreamDepth: UNLIMITED_DEPTH,
  includeTests: true,
  excludedMaterializations: [],
};

for (const { name, manifest } of fixtures) {
  void test(`${name}: every index builds without throwing`, () => {
    assert.doesNotThrow(() => buildRefIndex(manifest));
    assert.doesNotThrow(() => buildDependencyGraph(manifest));
    assert.doesNotThrow(() => buildDocIndex(manifest));
    assert.doesNotThrow(() => buildMacroIndex(manifest));
    assert.doesNotThrow(() => collectTags(manifest));
  });

  void test(`${name}: the ref index holds only what ref() can target`, () => {
    for (const ref of buildRefIndex(manifest).values()) {
      assert.equal(isReferenceable(ref.node), true, `${ref.uniqueId} is not referenceable`);
    }
  });

  void test(`${name}: every node resolves to a path and a colour read never throws`, () => {
    for (const node of Object.values(manifest.nodes)) {
      assert.doesNotThrow(() => readNodeColor(node), node.unique_id);
      assert.equal(typeof resolveEntityPath('/p', manifest.metadata.project_name, node), 'string');
    }
  });

  void test(`${name}: the whole-DAG lineage of every node is self-consistent`, () => {
    const index = indexFor(manifest);

    for (const node of Object.values(manifest.nodes)) {
      const { nodes, edges } = buildScopedSubgraph(index, node.unique_id, wholeDag);
      const ids = nodes.map((drawn) => drawn.id);

      assert.equal(new Set(ids).size, ids.length, `${node.unique_id}: a node is drawn twice`);
      assert.ok(ids.includes(node.unique_id), `${node.unique_id}: the root is missing`);
      for (const edge of edges) {
        assert.ok(ids.includes(edge.source), `${node.unique_id}: edge from undrawn ${edge.source}`);
        assert.ok(ids.includes(edge.target), `${node.unique_id}: edge to undrawn ${edge.target}`);
      }
    }
  });
}

const modern = fixtures.find((f) => f.name === 'recent-unit-tests-and-semantic-layer.json');

void test('resources the lineage does not draw yet are left out, not drawn dangling', () => {
  assert.ok(modern);
  const { nodes } = buildScopedSubgraph(
    indexFor(modern.manifest),
    'model.modern_project.fct_orders',
    wholeDag,
  );
  const drawn = nodes.map((n) => n.id);

  // Known limit, stated in the 0.17.0 changelog: they sit in child_map, and are skipped.
  for (const prefix of ['unit_test.', 'semantic_model.', 'metric.', 'saved_query.']) {
    assert.equal(
      drawn.some((id) => id.startsWith(prefix)),
      false,
      `${prefix}* should not be drawn yet`,
    );
  }
  // What *is* drawn around a model with all of these attached.
  assert.ok(drawn.includes('exposure.modern_project.revenue_dashboard'));
  assert.ok(drawn.includes('test.modern_project.unique_fct_orders_order_id.9f8e7d'));
});

void test('a bare ref() on a versioned model resolves to its latest_version', () => {
  const versioned = fixtures.find((f) => f.name === 'versioned-models.json');
  assert.ok(versioned);

  // latest_version is 1 while v2 exists as a prerelease, and v2 is the one listed last.
  const resolved = buildRefIndex(versioned.manifest).get('dim_customers');

  assert.equal(resolved?.uniqueId, 'model.versioned_project.dim_customers.v1');
});

// --- Known gap. `todo` keeps it in the report without failing the run; it is on the roadmap,
// --- and the assertion is the behaviour the item should deliver.

void test(
  'a manifest with no `sources` section is read like one with no `exposures` section',
  { todo: 'treat every section other than `nodes` as optional' },
  () => {
    const { sources: _omitted, ...withoutSources } = load(
      join(FIXTURES_DIR, 'legacy-no-optional-sections.json'),
    );

    assert.doesNotThrow(() => collectTags(withoutSources as unknown as DbtManifest));
  },
);
