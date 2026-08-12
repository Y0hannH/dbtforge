import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { findAllRefCalls, findAllSourceCalls } from '../sql/jinjaRefParser';

const VALIDATE_DEBOUNCE_MS = 400;

/**
 * Flags ref()/source() calls that don't resolve against the loaded manifest, as warnings in the
 * Problems panel. Scoped to ref()/source() only (not macros): their call syntax is unambiguous,
 * whereas a bare `name(...)` in Jinja could be a macro call or a built-in (config(), var(),
 * is_incremental(), a plain SQL function...) — flagging those would produce too many false
 * positives. A model/source not resolving can also mean "just added, not yet compiled", not
 * necessarily a real error, hence Warning rather than Error severity.
 */
export class DbtDiagnosticsController implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('dbtForge');
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  validate(document: vscode.TextDocument): void {
    if (!document.uri.fsPath.toLowerCase().endsWith('.sql')) return;

    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) {
      this.collection.delete(document.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const lineText = document.lineAt(line).text;

      for (const call of findAllRefCalls(lineText)) {
        if (index.resolveRef(call.name)) continue;
        diagnostics.push(
          this.makeDiagnostic(
            line,
            call.start,
            call.end,
            `Model "${call.name}" not found in the manifest. Run dbt compile if it was just added.`
          )
        );
      }

      for (const call of findAllSourceCalls(lineText)) {
        if (index.resolveSource(call.sourceName, call.tableName)) continue;
        diagnostics.push(
          this.makeDiagnostic(
            line,
            call.start,
            call.end,
            `Source "${call.sourceName}.${call.tableName}" not found in the manifest. Run dbt compile if it was just added.`
          )
        );
      }
    }

    this.collection.set(document.uri, diagnostics);
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
      }, VALIDATE_DEBOUNCE_MS)
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

  private makeDiagnostic(line: number, start: number, end: number, message: string): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, start, line, end),
      message,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = 'dbt Forge';
    return diagnostic;
  }
}
