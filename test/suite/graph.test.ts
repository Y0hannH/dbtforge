import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { test } from 'node:test';
import { buildDependencyGraph } from '../../src/index/graph';
import { DbtManifest } from '../../src/index/manifestTypes';

const manifest: DbtManifest = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/manifest.sample.json'), 'utf8')
);

test('getParents returns direct upstream nodes', () => {
  const graph = buildDependencyGraph(manifest);
  assert.deepEqual(graph.getParents('model.example_project.dim_customers'), [
    'model.example_project.stg_customers',
  ]);
});

test('getChildren returns direct downstream nodes', () => {
  const graph = buildDependencyGraph(manifest);
  assert.deepEqual(graph.getChildren('model.example_project.stg_customers'), [
    'model.example_project.dim_customers',
  ]);
});

test('getTests returns tests whose depends_on includes the node', () => {
  const graph = buildDependencyGraph(manifest);
  const tests = graph.getTests('model.example_project.dim_customers');
  assert.equal(tests.length, 1);
  assert.equal(tests[0].name, 'not_null_dim_customers_customer_id');
});

test('getParents/getChildren return empty array for unknown node', () => {
  const graph = buildDependencyGraph(manifest);
  assert.deepEqual(graph.getParents('model.example_project.unknown'), []);
  assert.deepEqual(graph.getChildren('model.example_project.unknown'), []);
});

test('getMacroCallers returns nodes whose depends_on.macros includes the macro', () => {
  const graph = buildDependencyGraph(manifest);
  assert.deepEqual(graph.getMacroCallers('macro.example_project.generate_surrogate_key'), [
    'model.example_project.dim_customers',
  ]);
});

test('getMacroCallers returns empty array for a macro with no callers', () => {
  const graph = buildDependencyGraph(manifest);
  assert.deepEqual(graph.getMacroCallers('macro.example_project.unknown'), []);
});
