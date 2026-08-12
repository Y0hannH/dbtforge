import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { DbtNode, DbtSourceNode } from '../index/manifestTypes';

type TreeElement = TagItem | TaggedResourceItem;

/**
 * A tag declared in the project. Carries its own index so the build commands wired to the
 * inline buttons know which dbt project to run in, without re-resolving from the active
 * editor (which may well be a file from another project, or nothing at all).
 */
export class TagItem extends vscode.TreeItem {
  constructor(
    public readonly tag: string,
    public readonly uniqueIds: string[],
    modelCount: number,
    public readonly index: DbtProjectIndex
  ) {
    super(tag, vscode.TreeItemCollapsibleState.Collapsed);
    // Resources carrying a tag aren't only models — tests and sources can be tagged too, and
    // `--select tag:x` picks all of them up. Show both counts when they differ so the button
    // isn't misread as "builds N models" when N of them are tests.
    this.description =
      modelCount === uniqueIds.length
        ? `${modelCount} model${modelCount === 1 ? '' : 's'}`
        : `${modelCount} model${modelCount === 1 ? '' : 's'} / ${uniqueIds.length} resources`;
    this.iconPath = new vscode.ThemeIcon('tag');
    this.tooltip = `dbt build --select tag:${tag}`;
    this.contextValue = 'dbtForge.tag';
  }
}

class TaggedResourceItem extends vscode.TreeItem {
  constructor(node: DbtNode | DbtSourceNode, uri: vscode.Uri) {
    super(node.name, vscode.TreeItemCollapsibleState.None);
    this.description = node.resource_type === 'model' ? node.package_name : node.resource_type;
    this.iconPath = new vscode.ThemeIcon(node.resource_type === 'test' ? 'beaker' : 'symbol-file');
    this.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [uri],
    };
    this.contextValue = 'dbtForge.taggedResource';
  }
}

/**
 * Lists every tag declared in the project, each expandable to the resources carrying it, with
 * inline build/test buttons. Unlike the relatives view this isn't keyed to the active file —
 * tags are project-wide — so it resolves its project once via `getIndex` and shows nothing
 * when that's ambiguous (several dbt projects in the workspace and no active editor to
 * disambiguate), rather than silently picking one and building the wrong project.
 */
export class TagsTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly getIndex: () => DbtProjectIndex | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    const index = this.getIndex();
    if (!index) return [];

    if (!element) {
      return index
        .getAllTags()
        .map((t) => new TagItem(t.tag, t.uniqueIds, t.modelCount, index));
    }

    if (element instanceof TagItem) {
      return element.uniqueIds
        .map((id) => index.getNode(id) ?? index.getSourceNode(id))
        .filter((n): n is DbtNode | DbtSourceNode => n !== undefined)
        .map((n) => new TaggedResourceItem(n, index.getFileUri(n)));
    }

    return [];
  }
}
