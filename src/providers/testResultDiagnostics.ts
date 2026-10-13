import * as vscode from 'vscode';

import type { DbtProjectIndex } from '../index/dbtProjectIndex';
import type { TestFinding } from '../index/testFindings';
import { collectTestFindings } from '../index/testFindings';
import { readFileLines } from '../index/textFiles';
import { locateTest } from '../yaml/testLocation';

/**
 * Puts the tests that failed in the last run into the Problems panel, on the line that declares
 * each one.
 *
 * Kept apart from the diagnostics that follow the open editor: those are computed from the text
 * of a document as it is typed, whereas these come from a run that already happened and have to
 * be there for files nobody has opened. They are set for every file that declares a failing test,
 * and replaced as a whole on each run — a test that passes next time simply isn't in the new set.
 */
export class TestResultDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('dbtForgeTestResults');

  // What each project last put in the collection, so a rebuild clears its own entries and not
  // another project's in the same window.
  private readonly owned = new Map<DbtProjectIndex, Set<string>>();
  private readonly generation = new Map<DbtProjectIndex, number>();

  async update(index: DbtProjectIndex): Promise<void> {
    const mine = (this.generation.get(index) ?? 0) + 1;
    this.generation.set(index, mine);

    const byFile = new Map<string, { uri: vscode.Uri; findings: TestFinding[] }>();
    for (const finding of collectTestFindings(index)) {
      const uri = index.getFileUri(finding.node);
      const entry = byFile.get(uri.toString()) ?? { uri, findings: [] };
      entry.findings.push(finding);
      byFile.set(uri.toString(), entry);
    }

    const next = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
    for (const [key, { uri, findings }] of byFile) {
      const lines = await readFileLines(uri);
      next.set(key, { uri, diagnostics: findings.map((f) => this.toDiagnostic(f, uri, lines)) });
    }

    // A newer run of update() started while this one was reading files; its answer is the one
    // that matches the current results, so this one must not overwrite it.
    if (this.generation.get(index) !== mine) return;

    for (const key of this.owned.get(index) ?? []) {
      if (!next.has(key)) this.collection.delete(vscode.Uri.parse(key));
    }
    for (const { uri, diagnostics } of next.values()) this.collection.set(uri, diagnostics);
    this.owned.set(index, new Set(next.keys()));
  }

  private toDiagnostic(
    finding: TestFinding,
    uri: vscode.Uri,
    lines: string[] | undefined,
  ): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(
      this.rangeOf(finding, uri, lines),
      finding.message,
      finding.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'dbt Forge';
    return diagnostic;
  }

  /**
   * The test's own entry when it can be found; otherwise the first line of the file, which is
   * where a singular test lives and the least a .yml can be pinned to.
   */
  private rangeOf(
    finding: TestFinding,
    uri: vscode.Uri,
    lines: string[] | undefined,
  ): vscode.Range {
    const firstLine = new vscode.Range(0, 0, 0, lines?.[0]?.length ?? 0);
    if (!finding.target || !lines || !/\.ya?ml$/i.test(uri.fsPath)) return firstLine;

    const text = lines.join('\n');
    const span = locateTest(text, finding.target);
    if (!span) return firstLine;

    // `positionAt` on a document that isn't open: walk the lines, the offsets are in `\n` text.
    return new vscode.Range(
      offsetToPosition(lines, span.offset),
      offsetToPosition(lines, span.offset + span.length),
    );
  }

  /** Forgets everything — for when the indexes are rebuilt and the old ones can no longer say. */
  clear(): void {
    this.collection.clear();
    this.owned.clear();
    this.generation.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function offsetToPosition(lines: string[], offset: number): vscode.Position {
  let remaining = offset;
  for (let line = 0; line < lines.length; line++) {
    // +1 for the newline the text was joined with.
    if (remaining <= lines[line].length) return new vscode.Position(line, remaining);
    remaining -= lines[line].length + 1;
  }
  const last = Math.max(lines.length - 1, 0);
  return new vscode.Position(last, lines[last]?.length ?? 0);
}
