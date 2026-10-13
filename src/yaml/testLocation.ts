import type { YAMLMap } from 'yaml';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

/**
 * Where a dbt test is declared in a schema .yml — so a failure can be shown on the line that
 * declares the test rather than on the top of the file.
 *
 * The answer is as precise as the file allows and no more: the test's own entry when exactly one
 * entry could be it, otherwise the column it is attached to, otherwise the model. Each step is a
 * true location for "this test", just a coarser one. Picking one of two identical-looking entries
 * would not be, so that case stops at the column.
 */

export type TestSection = 'models' | 'seeds' | 'snapshots' | 'sources';

export interface TestTarget {
  section: TestSection;
  /** The model, seed or snapshot name — or, for a source, the table name. */
  name: string;
  /** Sources only: the source (schema) the table is declared under. */
  sourceName?: string;
  columnName?: string;
  /** The test as written in the .yml: `unique`, `not_null`, `accepted_values`… */
  testName: string;
  /** A package's tests are written `dbt_utils.unique_combination_of_columns`. */
  namespace?: string;
}

export interface TestSpan {
  /** Offset and length in the source text, for `document.positionAt()`. */
  offset: number;
  length: number;
  /** How exactly it was found — what the caller can honestly say about the location. */
  precision: 'test' | 'column' | 'entity';
}

// dbt 1.8 renamed `tests:` to `data_tests:` and still accepts both.
const TEST_KEYS = ['tests', 'data_tests'] as const;

export function locateTest(text: string, target: TestTarget): TestSpan | undefined {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return undefined;
  const root = doc.contents;
  if (!isMap(root)) return undefined;

  const entity = findEntity(root, target);
  if (!entity) return undefined;

  const entityName = nameSpan(entity);
  if (!entityName) return undefined;

  if (target.columnName === undefined) {
    return testSpan(entity, target) ?? { ...entityName, precision: 'entity' };
  }

  const column = findNamed(entity.get('columns', true), target.columnName);
  if (!column) return { ...entityName, precision: 'entity' };

  return testSpan(column, target) ?? { ...(nameSpan(column) ?? entityName), precision: 'column' };
}

function findEntity(root: YAMLMap, target: TestTarget): YAMLMap | undefined {
  if (target.section !== 'sources') return findNamed(root.get(target.section, true), target.name);

  const source = findNamed(root.get('sources', true), target.sourceName ?? '');
  return source ? findNamed(source.get('tables', true), target.name) : undefined;
}

/** The mapping in a sequence whose `name:` is `name`. */
function findNamed(seq: unknown, name: string): YAMLMap | undefined {
  if (!isSeq(seq)) return undefined;
  for (const item of seq.items) {
    if (isMap(item) && nameSpan(item) && scalarName(item) === name) return item;
  }
  return undefined;
}

function scalarName(map: YAMLMap): string | undefined {
  const node = map.get('name', true);
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined;
}

function nameSpan(map: YAMLMap): { offset: number; length: number } | undefined {
  const node = map.get('name', true);
  if (!isScalar(node) || !node.range) return undefined;
  const [start, end] = node.range;
  return { offset: start, length: Math.max(end - start, 1) };
}

/** The one entry that is this test, or undefined when there is none or it could be several. */
function testSpan(
  owner: YAMLMap,
  target: TestTarget,
):
  | (Omit<TestSpan, 'precision'> & {
      precision: 'test';
    })
  | undefined {
  const wanted = new Set([target.testName]);
  if (target.namespace) wanted.add(`${target.namespace}.${target.testName}`);

  const matches: Array<{ offset: number; length: number }> = [];
  for (const key of TEST_KEYS) {
    const tests = owner.get(key, true);
    if (!isSeq(tests)) continue;

    for (const item of tests.items) {
      // `- unique` is a scalar; `- accepted_values: {…}` is a one-key mapping, and the key is the
      // test's name.
      const node = isMap(item) ? item.items[0]?.key : item;
      if (!isScalar(node) || typeof node.value !== 'string' || !node.range) continue;
      if (!wanted.has(node.value)) continue;
      const [start, end] = node.range;
      matches.push({ offset: start, length: Math.max(end - start, 1) });
    }
  }

  return matches.length === 1 ? { ...matches[0], precision: 'test' } : undefined;
}
