import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { DbtNode } from '../index/manifestTypes';

type TreeElement = CategoryItem | NodeItem;

class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly nodeIds: string[]
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'dbtForge.category';
  }
}

class NodeItem extends vscode.TreeItem {
  constructor(public readonly node: DbtNode, uri: vscode.Uri) {
    super(node.name, vscode.TreeItemCollapsibleState.None);
    this.description = node.resource_type === 'model' ? node.package_name : node.resource_type;
    this.iconPath = new vscode.ThemeIcon(node.resource_type === 'test' ? 'beaker' : 'symbol-file');
    this.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [uri],
    };
    this.contextValue = 'dbtForge.node';
  }
}

/**
 * Shows Parents / Children / Tests for whichever dbt model is open in the active editor.
 * Scope limited to direct (one-hop) relationships, matching manifest depends_on/child_map —
 * no transitive closure, no visualization beyond a flat list.
 */
export class RelativesTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private currentNode: DbtNode | undefined;
  private currentIndex: DbtProjectIndex | undefined;

  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  refresh(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      this.currentNode = undefined;
      this.currentIndex = undefined;
      this._onDidChangeTreeData.fire();
      return;
    }

    const index = this.getIndex(editor.document.uri);
    this.currentIndex = index;
    this.currentNode = index?.getNodeByFileUri(editor.document.uri);
    this._onDidChangeTreeData.fire();
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
          graph.getTests(node.unique_id).map((t) => t.unique_id)
        ),
      ];
    }

    if (element instanceof CategoryItem) {
      return element.nodeIds
        .map((id) => index.getNode(id))
        .filter((n): n is DbtNode => n !== undefined)
        .map((n) => new NodeItem(n, index.getFileUri(n)));
    }

    return [];
  }
}
