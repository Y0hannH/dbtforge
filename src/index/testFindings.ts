import type { TestSection, TestTarget } from '../yaml/testLocation';
import type { DbtMacroNode, DbtNode, LineageEntity } from './manifestTypes';
import type { NodeRunResult } from './runResults';
import { formatWhen } from './runResults';

/**
 * Something the last run got wrong, with what a Problems entry needs: the file it lives in, how
 * to find it there, and what to say. A test that failed or warned, or a model that errored.
 */
export interface RunFinding {
  /** The manifest node — the caller resolves its file from it. */
  node: DbtNode;
  severity: 'error' | 'warning';
  message: string;
  /** Absent for a singular test or a model, which are whole files: the first line is the location. */
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
 * Tests only; a model that errored is collectModelFindings().
 */
export function collectTestFindings(source: TestFindingSource): RunFinding[] {
  const findings: RunFinding[] = [];

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

  return `${endSentence(`${subject} ${what}`)}${when}`;
}

// dbt's own messages often end in their own punctuation ("…not found in FROM clause!"), and a
// full stop after that reads as a typo.
function endSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

function flatten(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// What a node that is built, rather than tested, can be called in a message.
const BUILT_KINDS: ReadonlySet<string> = new Set(['model', 'seed', 'snapshot']);

/**
 * Every model, seed or snapshot that errored or partly failed in the last run.
 *
 * Skipped is not a finding: a node is skipped because something upstream failed, and that
 * upstream node is the one worth a Problems entry. Listing both would bury the cause under its
 * consequences.
 */
export function collectModelFindings(source: TestFindingSource): RunFinding[] {
  const findings: RunFinding[] = [];

  for (const [uniqueId, result] of source.getAllRunResults()) {
    if (result.outcome !== 'failed' && result.outcome !== 'warned') continue;
    const node = source.getAnyEntity(uniqueId);
    if (!node || !BUILT_KINDS.has(node.resource_type)) continue;

    const built = node as DbtNode;
    findings.push({
      node: built,
      severity: result.outcome === 'failed' ? 'error' : 'warning',
      message: describeBuilt(built, result),
    });
  }

  return findings.sort((a, b) => a.node.unique_id.localeCompare(b.node.unique_id));
}

/** Tests and built nodes together — everything the last run has to say. */
export function collectRunFindings(source: TestFindingSource): RunFinding[] {
  return [...collectTestFindings(source), ...collectModelFindings(source)];
}

function describeBuilt(node: DbtNode, result: NodeRunResult): string {
  const kind = node.resource_type.charAt(0).toUpperCase() + node.resource_type.slice(1);
  const version = node.version !== undefined && node.version !== null ? ` (v${node.version})` : '';
  const verb = result.outcome === 'warned' ? 'partly failed' : 'failed';
  // dbt's own message is the whole point here: a database error names the column or the table.
  const detail = result.message ? ` — ${flatten(result.message, 300)}` : '';
  const when = result.generatedAt
    ? ` Last run: ${formatWhen(result.generatedAt)} (dbt ${result.command}).`
    : '';

  return `${endSentence(`${kind} "${node.name}"${version} ${verb}${detail}`)}${when}`;
}
