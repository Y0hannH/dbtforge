import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { isReferenceable } from '../index/refIndex';
import { parseCtes } from '../sql/cteParser';

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
    if (!node) return [];

    const uri = document.uri;
    if (node.resource_type === 'model') return [...this.modelLenses(uri), ...ctePreviewLenses(document)];
    // A seed's .csv and a snapshot have no model SQL to build, test or preview, but they are
    // nodes in the graph like any other — so at least offer the one action that applies.
    if (isReferenceable(node)) return [lineageLens(uri)];
    return [];
  }

  private modelLenses(uri: vscode.Uri): vscode.CodeLens[] {
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
        title: '$(table) Preview Data',
        command: 'dbtForge.previewData',
        arguments: [uri],
      }),
      lineageLens(uri),
      new vscode.CodeLens(TOP_OF_FILE, {
        title: '$(rocket) Build Project',
        command: 'dbtForge.buildProject',
      }),
    ];
  }
}

function lineageLens(uri: vscode.Uri): vscode.CodeLens {
  return new vscode.CodeLens(TOP_OF_FILE, {
    title: '$(git-merge) Lineage',
    command: 'dbtForge.showLineage',
    arguments: [uri],
  });
}

/**
 * One preview action per CTE, on the line where the CTE is declared — so an intermediate step can
 * be inspected where it is written, rather than by commenting out the rest of the query.
 */
function ctePreviewLenses(document: vscode.TextDocument): vscode.CodeLens[] {
  return parseCtes(document.getText()).map((cte) => {
    const position = document.positionAt(cte.nameStart);
    return new vscode.CodeLens(new vscode.Range(position, position), {
      title: '$(table) Preview CTE',
      command: 'dbtForge.previewCte',
      arguments: [document.uri, cte.name],
    });
  });
}
