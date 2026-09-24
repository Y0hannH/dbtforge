import * as vscode from 'vscode';

import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import { findAllDocCalls, findAllRefCalls, findAllSourceCalls } from '../sql/jinjaRefParser';
import { reconcileColumns } from '../yaml/columnReconciliation';
import type { DocumentedEntity } from '../yaml/schemaColumns';
import { parseSchemaEntities } from '../yaml/schemaColumns';

const VALIDATE_DEBOUNCE_MS = 400;

/**
 * Which calls are worth looking for in a file.
 *
 * ref()/source() only ever appear in models, so scanning YAML for them would be wasted work;
 * doc() is the opposite — it is written almost exclusively in schema .yml descriptions, and is
 * checked in .sql too only because the same call syntax is legal there.
 */
type ValidatableKind = 'sql' | 'yaml';

function validatableKind(uri: vscode.Uri): ValidatableKind | undefined {
  const path = uri.fsPath.toLowerCase();
  if (path.endsWith('.sql')) return 'sql';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
  return undefined;
}

/**
 * Flags ref()/source() calls that don't resolve against the loaded manifest, as warnings in the
 * Problems panel. Scoped to ref()/source() only (not macros): their call syntax is unambiguous,
 * whereas a bare `name(...)` in Jinja could be a macro call or a built-in (config(), var(),
 * is_incremental(), a plain SQL function...) — flagging those would produce too many false
 * positives. A model/source not resolving can also mean "just added, not yet compiled", not
 * necessarily a real error, hence Warning rather than Error severity.
 *
 * Schema .yml files are checked for a second thing: the columns they document against the columns
 * the warehouse reports. That half is the only part of this controller that reads catalog.json,
 * and it is silent whenever the catalog cannot answer — see columnDiagnostics.
 */
export class DbtDiagnosticsController implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('dbtForge');
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  validate(document: vscode.TextDocument): void {
    const kind = validatableKind(document.uri);
    if (!kind) return;

    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) {
      this.collection.delete(document.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const lineText = document.lineAt(line).text;

      for (const call of findAllDocCalls(lineText)) {
        if (index.resolveDoc(call.name, call.packageName)) continue;
        diagnostics.push(
          this.makeDiagnostic(
            line,
            call.start,
            call.end,
            `No {% docs %} block named "${call.name}" in the manifest. Run dbt compile if it was just added.`,
          ),
        );
      }

      if (kind !== 'sql') continue;

      for (const call of findAllRefCalls(lineText)) {
        if (index.resolveRef(call.name)) continue;
        diagnostics.push(
          this.makeDiagnostic(
            line,
            call.start,
            call.end,
            `No model, seed or snapshot named "${call.name}" in the manifest. Run dbt compile if it was just added.`,
          ),
        );
      }

      for (const call of findAllSourceCalls(lineText)) {
        if (index.resolveSource(call.sourceName, call.tableName)) continue;
        diagnostics.push(
          this.makeDiagnostic(
            line,
            call.start,
            call.end,
            `Source "${call.sourceName}.${call.tableName}" not found in the manifest. Run dbt compile if it was just added.`,
          ),
        );
      }
    }

    if (kind === 'yaml') diagnostics.push(...this.columnDiagnostics(document, index));

    this.collection.set(document.uri, diagnostics);
  }

  /**
   * Warnings about the columns a schema .yml documents: one that the table doesn't have, one
   * documented twice, and — only when asked for — the real columns the file leaves out.
   *
   * Everything here needs catalog.json, which exists only after `dbt docs generate` and only for
   * entities that have been built. Absent, this says nothing at all rather than falling back to
   * the manifest's `columns`, which holds what this very file documents and would agree with
   * itself every time.
   */
  private columnDiagnostics(
    document: vscode.TextDocument,
    index: DbtProjectIndex,
  ): vscode.Diagnostic[] {
    const entities = parseSchemaEntities(document.getText());
    if (entities.length === 0) return [];

    const flagUndocumented = vscode.workspace
      .getConfiguration('dbtForge', document.uri)
      .get<boolean>('flagUndocumentedColumns', false);

    const findings = reconcileColumns(
      entities,
      (entity) => this.catalogColumnNames(index, entity),
      { flagUndocumented },
    );

    return findings.map((finding) => {
      const range = new vscode.Range(
        document.positionAt(finding.offset),
        document.positionAt(finding.offset + finding.length),
      );
      const diagnostic = new vscode.Diagnostic(
        range,
        finding.message,
        vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = 'dbt Forge';
      return diagnostic;
    });
  }

  /** The entity's real columns, or undefined when neither the manifest nor the catalog can say. */
  private catalogColumnNames(
    index: DbtProjectIndex,
    entity: DocumentedEntity,
  ): string[] | undefined {
    const uniqueId =
      entity.kind === 'source'
        ? index.resolveSource(entity.sourceName ?? '', entity.name)?.uniqueId
        : index.resolveRef(entity.name)?.uniqueId;
    if (!uniqueId) return undefined;

    return index.getCatalogColumns(uniqueId)?.map((column) => column.name);
  }

  /** Debounced re-validation while typing, so a call mid-edit doesn't flash a warning. */
  validateDebounced(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.validate(document);
      }, VALIDATE_DEBOUNCE_MS),
    );
  }

  /** Re-checks every currently open document — used when a project's manifest reloads. */
  revalidateOpenDocuments(): void {
    for (const document of vscode.workspace.textDocuments) this.validate(document);
  }

  clear(uri: vscode.Uri): void {
    const key = uri.toString();
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    this.collection.delete(uri);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.collection.dispose();
  }

  private makeDiagnostic(
    line: number,
    start: number,
    end: number,
    message: string,
  ): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, start, line, end),
      message,
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'dbt Forge';
    return diagnostic;
  }
}
