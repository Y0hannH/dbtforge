import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import type { NodeRunResult, RunOutcome } from '../index/runResults';
import { formatDuration, formatWhen, worseOutcome } from '../index/runResults';

/**
 * What a node says about its last run, ready to draw. Plain data, because it crosses into the
 * webview and into tree items alike.
 */
export interface RunStatusView {
  /** Decides the glyph and the colour. */
  outcome: RunOutcome;
  /** The short line shown on the node: `4.2s`, `failed`, `2 tests failing`. */
  label: string;
  /** The long form, for a tooltip: command, dbt's status, duration, when, and its message. */
  title: string;
}

type RunSource = Pick<DbtProjectIndex, 'getRunResult' | 'getGraph'>;

// A dbt error message can be a screenful of SQL. A tooltip that long is not read.
const MAX_MESSAGE_LENGTH = 300;

/**
 * The status of one node, or undefined when there is nothing to say about it.
 *
 * Its own run and the tests attached to it are folded into one outcome — the worse of the two —
 * because `dbt build` builds a model fine and then fails its test, and a green node there would
 * be the wrong summary. The tests are named in the label, so the node never reads as "failed"
 * without saying why.
 *
 * A node with no run of its own and no test results gets nothing. It is not "passing": nothing
 * has been said about it.
 */
export function runStatusOf(index: RunSource, uniqueId: string): RunStatusView | undefined {
  const own = index.getRunResult(uniqueId);
  const tests = (index.getGraph()?.getTests(uniqueId) ?? [])
    .map((test) => index.getRunResult(test.unique_id))
    .filter((result): result is NodeRunResult => result !== undefined);

  if (!own && tests.length === 0) return undefined;

  const failing = tests.filter((test) => test.outcome === 'failed').length;
  const warning = tests.filter((test) => test.outcome === 'warned').length;

  let outcome: RunOutcome | undefined = own?.outcome;
  if (failing > 0) outcome = outcome ? worseOutcome(outcome, 'failed') : 'failed';
  else if (warning > 0) outcome = outcome ? worseOutcome(outcome, 'warned') : 'warned';
  else if (!outcome)
    outcome = tests.some((test) => test.outcome === 'skipped') ? 'skipped' : 'passed';

  const parts: string[] = [];
  if (own) parts.push(ownLabel(own));
  if (failing > 0) parts.push(`${failing} ${failing === 1 ? 'test' : 'tests'} failing`);
  if (warning > 0) parts.push(`${warning} ${warning === 1 ? 'warning' : 'warnings'}`);

  const label =
    parts.length > 0
      ? parts.join(' · ')
      : // Tests only, all passing: say so rather than leave a green mark with no words.
        `${tests.length} ${tests.length === 1 ? 'test' : 'tests'} passed`;

  return { outcome, label, title: titleOf(own, failing, warning) };
}

/**
 * Every node that has something to show, for the lineage webview to look up by id. Includes the
 * models a test result is attached to, since the test node itself is hidden by default.
 */
export function buildRunStatuses(
  index: RunSource & { getAllRunResults(): ReadonlyMap<string, NodeRunResult> },
): Record<string, RunStatusView> {
  const graph = index.getGraph();
  const ids = new Set<string>();
  for (const id of index.getAllRunResults().keys()) {
    ids.add(id);
    // A test's parents are what it is attached to.
    for (const parent of graph?.getParents(id) ?? []) ids.add(parent);
  }

  const statuses: Record<string, RunStatusView> = {};
  for (const id of ids) {
    const status = runStatusOf(index, id);
    if (status) statuses[id] = status;
  }
  return statuses;
}

function ownLabel(result: NodeRunResult): string {
  if (result.outcome === 'passed') {
    return result.executionTime === undefined ? 'passed' : formatDuration(result.executionTime);
  }
  if (result.outcome === 'warned') return 'warning';
  if (result.outcome === 'skipped') return 'skipped';
  // A failed test says how many rows it returned; a failed model has no such number.
  if (result.failures !== undefined && result.failures > 0) {
    return `failed · ${result.failures} ${result.failures === 1 ? 'row' : 'rows'}`;
  }
  return 'failed';
}

function titleOf(own: NodeRunResult | undefined, failing: number, warning: number): string {
  const lines: string[] = [];

  if (own) {
    const facts = [own.command, own.status];
    if (own.executionTime !== undefined) facts.push(formatDuration(own.executionTime));
    lines.push(facts.join(' · '));
    if (own.generatedAt) lines.push(`ran ${formatWhen(own.generatedAt)}`);
    if (own.message) lines.push(truncate(own.message));
  }
  if (failing > 0) lines.push(`${failing} attached ${failing === 1 ? 'test' : 'tests'} failing`);
  if (warning > 0) lines.push(`${warning} attached ${warning === 1 ? 'test' : 'tests'} warning`);

  return lines.join('\n');
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_MESSAGE_LENGTH ? `${flat.slice(0, MAX_MESSAGE_LENGTH)}…` : flat;
}
