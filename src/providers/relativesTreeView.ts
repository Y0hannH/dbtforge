import * as vscode from 'vscode';

import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import type { DbtNode, LineageEntity } from '../index/manifestTypes';
import { versionedName } from '../index/modelVersions';
import type { RunOutcome } from '../index/runResults';
import type { RunStatusView } from '../lineage/runStatus';
import { runStatusOf } from '../lineage/runStatus';

type TreeElement = CategoryItem | NodeItem;

class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly nodeIds: string[],
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'dbtForge.category';
  }
}

class NodeItem extends vscode.TreeItem {
  constructor(
    public readonly node: LineageEntity,
    uri: vscode.Uri,
    run?: RunStatusView,
  ) {
    super(isBuilt(node) ? versionedName(node) : node.name, vscode.TreeItemCollapsibleState.None);
    const kind = node.resource_type === 'model' ? node.package_name : node.resource_type;
    // The last run, when there is one, replaces the kind of node as the description: the icon
    // already says which kind it is, and the run is the news.
    this.description = run ? run.label : kind;
    this.iconPath = run ? statusIcon(run.outcome) : new vscode.ThemeIcon(iconFor(node));
    if (run)
      this.tooltip = `${node.name}
${run.title}`;
    this.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [uri],
    };
    this.contextValue = 'dbtForge.node';
  }
}

// A source or an exposure has no version; the rest are nodes dbt builds.
function isBuilt(node: LineageEntity): node is DbtNode {
  return node.resource_type !== 'source' && node.resource_type !== 'exposure';
}

// Theme colours the Testing view already uses for the same four states, so a failed test reads
// the same here as it does there.
function statusIcon(outcome: RunOutcome): vscode.ThemeIcon {
  switch (outcome) {
    case 'passed':
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    case 'failed':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    case 'warned':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    case 'skipped':
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconSkipped'));
  }
}

// Sources and exposures are the two kinds a model's neighbours can be besides other dbt nodes:
// the table it reads from, and the dashboard or app that reads it.
function iconFor(node: LineageEntity): string {
  switch (node.resource_type) {
    case 'test':
      return 'beaker';
    case 'source':
      return 'database';
    case 'exposure':
      return 'dashboard';
    default:
      return 'symbol-file';
  }
}

/**
 * Shows Parents / Children / Tests for whichever dbt model is open in the active editor.
 * Scope limited to direct (one-hop) relationships, matching manifest depends_on/child_map —
 * no transitive closure, no visualization beyond a flat list.
 */
export class RelativesTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private readonly treeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.treeDataEmitter.event;

  private currentNode: DbtNode | undefined;
  private currentIndex: DbtProjectIndex | undefined;

  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  refresh(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      this.currentNode = undefined;
      this.currentIndex = undefined;
      this.treeDataEmitter.fire();
      return;
    }

    const index = this.getIndex(editor.document.uri);
    this.currentIndex = index;
    this.currentNode = index?.getNodeByFileUri(editor.document.uri);
    this.treeDataEmitter.fire();
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    const index = this.currentIndex;
    const node = this.currentNode;
    if (!index || !node) return [];

    if (!element) {
      const graph = index.getGraph();
      if (!graph) return [];
      return [
        new CategoryItem('Parents', graph.getParents(node.unique_id)),
        new CategoryItem('Children', graph.getChildren(node.unique_id)),
        new CategoryItem(
          'Tests',
          graph.getTests(node.unique_id).map((t) => t.unique_id),
        ),
      ];
    }

    if (element instanceof CategoryItem) {
      return element.nodeIds
        .map((id) => index.getLineageEntity(id))
        .filter((n): n is LineageEntity => n !== undefined)
        .map((n) => new NodeItem(n, index.getFileUri(n), runStatusOf(index, n.unique_id)));
    }

    return [];
  }
}
