import type { TestSection, TestTarget } from '../yaml/testLocation';
import type { DbtMacroNode, DbtNode, LineageEntity } from './manifestTypes';
import type { NodeRunResult } from './runResults';
import { formatWhen } from './runResults';

/**
 * A test that failed or warned in the last run, with what a Problems entry needs: the file it is
 * declared in, how to find it there, and what to say.
 */
export interface TestFinding {
  /** The test's manifest node — the caller resolves its file from it. */
  node: DbtNode;
  severity: 'error' | 'warning';
  message: string;
  /** Absent for a singular test, which is a whole .sql file: its first line is the location. */
  target?: TestTarget;
}

export interface TestFindingSource {
  getAllRunResults(): ReadonlyMap<string, NodeRunResult>;
  getAnyEntity(uniqueId: string): DbtNode | DbtMacroNode | undefined;
  getLineageEntity(uniqueId: string): LineageEntity | undefined;
}

// What dbt calls the section an attached node is declared under, by resource type.
const SECTION_BY_RESOURCE: Record<string, TestSection> = {
  model: 'models',
  seed: 'seeds',
  snapshot: 'snapshots',
  source: 'sources',
};

/**
 * Every test whose last result was a failure or a warning, ordered by name so the Problems panel
 * doesn't reshuffle between two runs of the same project.
 *
 * Only tests: a model that errored is a different kind of finding, and its message is dbt's own
 * database error rather than a rule the project wrote.
 */
export function collectTestFindings(source: TestFindingSource): TestFinding[] {
  const findings: TestFinding[] = [];

  for (const [uniqueId, result] of source.getAllRunResults()) {
    if (result.outcome !== 'failed' && result.outcome !== 'warned') continue;
    const node = source.getAnyEntity(uniqueId);
    if (!node || node.resource_type !== 'test') continue;

    const test = node as DbtNode;
    const target = targetOf(source, test);
    findings.push({
      node: test,
      severity: result.outcome === 'failed' ? 'error' : 'warning',
      message: describe(test, result, target),
      target,
    });
  }

  return findings.sort((a, b) => a.node.name.localeCompare(b.node.name));
}

function targetOf(source: TestFindingSource, test: DbtNode): TestTarget | undefined {
  const testName = test.test_metadata?.name;
  if (!testName) return undefined;

  const columnName = test.column_name ?? undefined;
  const namespace = test.test_metadata?.namespace ?? undefined;

  // The attached node says exactly what the test is declared on, and it is the one thing that
  // also tells a source's table from its schema.
  const attached = test.attached_node ? source.getLineageEntity(test.attached_node) : undefined;
  if (attached) {
    const section = SECTION_BY_RESOURCE[attached.resource_type];
    if (!section) return undefined;
    return {
      section,
      name: attached.name,
      sourceName: 'source_name' in attached ? attached.source_name : undefined,
      columnName,
      testName,
      namespace,
    };
  }

  // Older manifests: `models.fct_orders`. A source's key names only its schema, not the table,
  // so it can't be located this way.
  const dot = test.file_key_name?.indexOf('.') ?? -1;
  if (!test.file_key_name || dot < 0) return undefined;
  const section = test.file_key_name.slice(0, dot);
  if (section !== 'models' && section !== 'seeds' && section !== 'snapshots') return undefined;
  return { section, name: test.file_key_name.slice(dot + 1), columnName, testName, namespace };
}

function describe(test: DbtNode, result: NodeRunResult, target: TestTarget | undefined): string {
  const subject = target
    ? `Test "${target.testName}" on ${target.name}${target.columnName ? `.${target.columnName}` : ''}`
    : `Test "${test.name}"`;

  const rows =
    result.failures !== undefined && result.failures > 0
      ? `${result.failures} ${result.failures === 1 ? 'row' : 'rows'} returned`
      : undefined;

  // A test that errored (it didn't compile, say) has no row count; dbt's own message is all
  // there is to say.
  const what =
    result.outcome === 'warned'
      ? `warned${rows ? ` — ${rows}` : ''}`
      : rows
        ? `failed — ${rows}`
        : `failed${result.message ? ` — ${flatten(result.message)}` : ''}`;

  const when = result.generatedAt
    ? ` Last run: ${formatWhen(result.generatedAt)} (dbt ${result.command}).`
    : '';

  return `${subject} ${what}.${when}`;
}

function flatten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}
