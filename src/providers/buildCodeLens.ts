import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';

const TOP_OF_FILE = new vscode.Range(0, 0, 0, 0);

export class BuildCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const index = this.getIndex(document.uri);
    const node = index?.getNodeByFileUri(document.uri);
    if (!node || node.resource_type !== 'model') return [];

    const uri = document.uri;
    return [
      new vscode.CodeLens(TOP_OF_FILE, {
        title: '$(target) Build Model',
        command: 'dbtForge.buildModel',
        arguments: [uri],
      }),
      new vscode.CodeLens(TOP_OF_FILE, {
        title: '$(arrow-up) Build Upstream',
        command: 'dbtForge.buildUpstream',
        arguments: [uri],
      }),
      new vscode.CodeLens(TOP_OF_FILE, {
        title: '$(arrow-down) Build Downstream',
        command: 'dbtForge.buildDownstream',
        arguments: [uri],
      }),
      new vscode.CodeLens(TOP_OF_FILE, {
        title: '$(beaker) Test',
        command: 'dbtForge.testModel',
        arguments: [uri],
      }),
      new vscode.CodeLens(TOP_OF_FILE, {
        title: '$(eye) Preview Compiled SQL',
        command: 'dbtForge.previewCompiledSql',
        arguments: [uri],
      }),
      new vscode.CodeLens(TOP_OF_FILE, {
        title: '$(git-merge) Lineage',
        command: 'dbtForge.showLineage',
        arguments: [uri],
      }),
      new vscode.CodeLens(TOP_OF_FILE, {
        title: '$(rocket) Build Project',
        command: 'dbtForge.buildProject',
      }),
    ];
  }
}
