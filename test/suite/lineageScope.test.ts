import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  canDescend,
  DEFAULT_SCOPE,
  isInScope,
  LineageScope,
  sanitizeScope,
  UNLIMITED_DEPTH,
} from '../../src/lineage/lineageScope';
import { DbtNode } from '../../src/index/manifestTypes';

function makeNode(resourceType: string, materialized?: string): DbtNode {
  return {
    unique_id: `${resourceType}.pkg.x`,
    resource_type: resourceType,
    name: 'x',
    package_name: 'pkg',
    path: 'x.sql',
    original_file_path: 'models/x.sql',
    config: materialized ? { materialized } : undefined,
  };
}

const scope = (overrides: Partial<LineageScope> = {}): LineageScope => ({
  ...DEFAULT_SCOPE,
  ...overrides,
});

test('isInScope: tests are hidden by default, and shown when asked for', () => {
  const testNode = makeNode('test');
  assert.equal(isInScope(testNode, scope()), false);
  assert.equal(isInScope(testNode, scope({ includeTests: true })), true);
});

test('isInScope: a model is never hidden by the tests toggle', () => {
  assert.equal(isInScope(makeNode('model', 'table'), scope()), true);
});

test('isInScope: an excluded materialization is hidden, others are not', () => {
  const excluded = scope({ excludedMaterializations: ['ephemeral'] });
  assert.equal(isInScope(makeNode('model', 'ephemeral'), excluded), false);
  assert.equal(isInScope(makeNode('model', 'table'), excluded), true);
});

test('isInScope: a node declaring no materialization survives any exclusion list', () => {
  const excluded = scope({ excludedMaterializations: ['ephemeral', 'table'] });
  assert.equal(isInScope(makeNode('seed'), excluded), true);
});

test('canDescend: a numeric limit stops the walk once it is reached', () => {
  assert.equal(canDescend(0, 1), true);
  assert.equal(canDescend(1, 1), false);
  assert.equal(canDescend(0, 0), false);
});

test('canDescend: the unlimited sentinel never stops the walk', () => {
  assert.equal(canDescend(0, UNLIMITED_DEPTH), true);
  assert.equal(canDescend(99, UNLIMITED_DEPTH), true);
});

test('sanitizeScope: undefined falls back to the default scope', () => {
  assert.deepEqual(sanitizeScope(undefined), DEFAULT_SCOPE);
});

test('sanitizeScope: keeps a well-formed scope as it is', () => {
  const incoming: LineageScope = {
    upstreamDepth: 3,
    downstreamDepth: UNLIMITED_DEPTH,
    includeTests: true,
    excludedMaterializations: ['ephemeral'],
  };
  assert.deepEqual(sanitizeScope(incoming), incoming);
});

test('sanitizeScope: rejects depths that are not whole numbers ≥ 0', () => {
  const result = sanitizeScope({ upstreamDepth: -5, downstreamDepth: 1.5 } as Partial<LineageScope>);
  assert.equal(result.upstreamDepth, DEFAULT_SCOPE.upstreamDepth);
  assert.equal(result.downstreamDepth, DEFAULT_SCOPE.downstreamDepth);
});

test('sanitizeScope: a non-boolean includeTests is not treated as true', () => {
  const result = sanitizeScope({ includeTests: 'yes' as unknown as boolean });
  assert.equal(result.includeTests, false);
});

test('sanitizeScope: drops non-string entries from the exclusion list', () => {
  const result = sanitizeScope({
    excludedMaterializations: ['ephemeral', 42, null] as unknown as string[],
  });
  assert.deepEqual(result.excludedMaterializations, ['ephemeral']);
});

test('sanitizeScope: a non-array exclusion list becomes an empty one', () => {
  const result = sanitizeScope({ excludedMaterializations: 'ephemeral' as unknown as string[] });
  assert.deepEqual(result.excludedMaterializations, []);
});
