import * as vscode from 'vscode';

import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import { versionedName } from '../index/modelVersions';
import type { RunOutcome } from '../index/runResults';
import { formatDuration, formatWhen } from '../index/runResults';
import type { BuildRuntime } from '../index/runtimes';
import { slowestFirst } from '../index/runtimes';

// A dbt error message can be a screenful of SQL; the tooltip only needs to say what went wrong.
const MAX_MESSAGE_LENGTH = 300;

const ICON_BY_OUTCOME: Record<Exclude<RunOutcome, 'skipped'>, vscode.ThemeIcon> = {
  passed: new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed')),
  warned: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')),
  failed: new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')),
};

class RuntimeItem extends vscode.TreeItem {
  constructor({ node, result, seconds }: BuildRuntime, uri: vscode.Uri) {
    super(versionedName(node), vscode.TreeItemCollapsibleState.None);

    // The duration first: it is what the list is sorted by and what the eye scans down. The
    // outcome only when it isn't a plain success — a failed model's time is time until it failed,
    // which reads differently from a build that finished.
    const facts = [formatDuration(seconds)];
    if (result.outcome === 'failed') facts.push('failed');
    if (result.outcome === 'warned') facts.push('warning');
    if (node.resource_type !== 'model') facts.push(node.resource_type);
    this.description = facts.join(' · ');

    // Each time comes with the invocation that measured it: the list can mix a full build from
    // this morning with a single model rebuilt a minute ago, and the times are only comparable
    // knowing that.
    const lines = [`${result.command} · ${result.status} · ${formatDuration(seconds)}`];
    if (result.generatedAt) lines.push(`ran ${formatWhen(result.generatedAt)}`);
    lines.push(node.original_file_path);
    if (result.message && result.outcome !== 'passed') lines.push(truncate(result.message));
    this.tooltip = lines.join('\n');

    this.iconPath = ICON_BY_OUTCOME[result.outcome as Exclude<RunOutcome, 'skipped'>];
    this.resourceUri = uri;
    this.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
    this.contextValue = 'dbtForge.runtime';
  }
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_MESSAGE_LENGTH ? `${flat.slice(0, MAX_MESSAGE_LENGTH)}…` : flat;
}

/**
 * Every model, seed and snapshot that has a build time, slowest first — where to start when a
 * build is too long. The times are dbt's own, from run_results.json; nothing here measures
 * anything.
 *
 * dbt rewrites that file on every invocation, so the index keeps the latest result of each node
 * across invocations rather than only the last file: rebuilding one model updates its line
 * without emptying the list. On a fresh window, though, only the last file on disk is known — a
 * full `dbt build` is what fills the list.
 *
 * Project-wide like the Tags view, so it resolves its project the same way and shows nothing when
 * that's ambiguous rather than listing another project's models.
 */
export class RuntimesTreeProvider implements vscode.TreeDataProvider<RuntimeItem> {
  private readonly treeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.treeDataEmitter.event;

  constructor(private readonly getIndex: () => DbtProjectIndex | undefined) {}

  refresh(): void {
    this.treeDataEmitter.fire();
  }

  getTreeItem(element: RuntimeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: RuntimeItem): RuntimeItem[] {
    if (element) return [];
    const index = this.getIndex();
    if (!index) return [];

    return slowestFirst(index.getAllRunResults(), (id) => index.getNode(id)).map(
      (runtime) => new RuntimeItem(runtime, index.getFileUri(runtime.node)),
    );
  }
}
