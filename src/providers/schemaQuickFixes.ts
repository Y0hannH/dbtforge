import * as vscode from 'vscode';

import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import { catalogColumnNames } from '../index/entityColumns';
import { parseSchemaEntities } from '../yaml/schemaColumns';
import type { SchemaEdit } from '../yaml/schemaEdits';
import { addColumnsEdit, removeColumnEdit } from '../yaml/schemaEdits';

/**
 * Fixes for what the column diagnostics point out in a schema .yml: a documented column the table
 * doesn't have can be removed, and the real columns a file leaves out can be added as stubs.
 *
 * Both are offered only where catalog.json can answer, like the warnings they follow. Without it
 * there is no list of real columns to add, and no evidence that a documented one is wrong.
 */
export class SchemaQuickFixProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
  };

  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] | undefined {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const text = document.getText();
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'dbt Forge' || diagnostic.code !== 'unknown-column') continue;

      const edit = removeColumnEdit(text, document.offsetAt(diagnostic.range.start));
      if (!edit) continue;
      const name = document.getText(diagnostic.range);
      actions.push(
        this.action(`Remove column "${name}" from this file`, document, edit, [diagnostic]),
      );
    }

    const cursor = document.offsetAt(range.start);
    for (const entity of parseSchemaEntities(text)) {
      // Offered on the entity's own name: that is where the warning for it sits, and a lightbulb
      // on every line of a model would be noise.
      if (cursor < entity.offset || cursor > entity.offset + entity.length) continue;

      const real = catalogColumnNames(index, entity);
      if (!real) continue;
      // Compared case-insensitively, as the warnings are: a warehouse's own casing is not a
      // missing column.
      const documented = new Set(entity.columns.map((column) => column.name.toLowerCase()));
      const missing = real.filter((name) => !documented.has(name.toLowerCase()));

      const edit = addColumnsEdit(text, entity.offset, missing);
      if (!edit) continue;
      const plural = missing.length > 1 ? 's' : '';
      actions.push(
        this.action(
          `Add the ${missing.length} undocumented column${plural} from catalog.json`,
          document,
          edit,
          context.diagnostics.filter((d) => d.code === 'undocumented-columns'),
        ),
      );
    }

    return actions;
  }

  private action(
    title: string,
    document: vscode.TextDocument,
    edit: SchemaEdit,
    diagnostics: vscode.Diagnostic[],
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = diagnostics;

    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(edit.offset),
        document.positionAt(edit.offset + edit.deleteLength),
      ),
      edit.insert,
    );
    action.edit = workspaceEdit;
    return action;
  }
}
