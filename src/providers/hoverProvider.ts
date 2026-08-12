import * as vscode from 'vscode';
import { DbtProjectIndex, MacroRef, ModelRef, SourceRef } from '../index/DbtProjectIndex';
import { findCallAtPosition, findMacroCallAtPosition, findMacroDefinitionAtPosition } from '../sql/jinjaRefParser';

/**
 * Hover for ref()/source()/macro calls (and macro definition lines), showing whatever
 * documentation the manifest has for that model/source/macro. Reuses the exact same
 * position-detection functions as Go to Definition / Find All References.
 */
export class DbtHoverProvider implements vscode.HoverProvider {
  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const lineText = document.lineAt(position.line).text;

    const call = findCallAtPosition(lineText, position.character);
    if (call?.kind === 'ref') {
      const model = index.resolveRef(call.name);
      if (!model) return undefined;
      return new vscode.Hover(
        modelMarkdown(model),
        new vscode.Range(position.line, call.argStart, position.line, call.argEnd)
      );
    }
    if (call?.kind === 'source') {
      const source = index.resolveSource(call.sourceName, call.tableName);
      if (!source) return undefined;
      return new vscode.Hover(
        sourceMarkdown(source),
        new vscode.Range(position.line, call.argStart, position.line, call.argEnd)
      );
    }

    const macroMatch = findMacroDefinitionAtPosition(lineText, position.character) ?? findMacroCallAtPosition(lineText, position.character);
    if (macroMatch) {
      const macro = index.resolveMacro(macroMatch.name);
      if (!macro) return undefined;
      return new vscode.Hover(
        macroMarkdown(macro),
        new vscode.Range(position.line, macroMatch.start, position.line, macroMatch.end)
      );
    }

    return undefined;
  }
}

function modelMarkdown(model: ModelRef): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${model.name}** _(model · ${model.packageName})_`);
  if (model.node.description) {
    md.appendMarkdown(`\n\n${model.node.description}`);
  }
  return md;
}

function sourceMarkdown(source: SourceRef): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${source.sourceName}.${source.tableName}** _(source)_`);
  if (source.node.description) {
    md.appendMarkdown(`\n\n${source.node.description}`);
  }
  return md;
}

function macroMarkdown(macro: MacroRef): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  const args = macro.node.arguments?.map((a) => (a.type ? `${a.name}: ${a.type}` : a.name)).join(', ') ?? '';
  md.appendCodeblock(`${macro.name}(${args})`, 'jinja');
  if (macro.node.description) {
    md.appendMarkdown(`${macro.node.description}\n\n`);
  }
  const argDocs = macro.node.arguments?.filter((a) => a.description) ?? [];
  if (argDocs.length > 0) {
    md.appendMarkdown(argDocs.map((a) => `- \`${a.name}\` — ${a.description}`).join('\n'));
  }
  return md;
}
