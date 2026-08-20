import * as vscode from 'vscode';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { readFileLines } from '../index/textFiles';
import { findDocCallAtPosition, findDocsBlockLine } from '../sql/jinjaRefParser';

/**
 * Ctrl+click a `{{ doc('x') }}` to land on the `{% docs x %}` that defines it.
 *
 * Registered on .yml as well as .sql, because that is where doc() is actually written — the
 * ref()/source() definition provider stays SQL-only, since those calls only appear in models.
 */
export class DocDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly getIndex: (uri: vscode.Uri) => DbtProjectIndex | undefined) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location | undefined> {
    const index = this.getIndex(document.uri);
    if (!index || !index.isManifestLoaded()) return undefined;

    const call = findDocCallAtPosition(document.lineAt(position.line).text, position.character);
    if (!call) return undefined;

    const block = index.resolveDoc(call.name, call.packageName);
    if (!block) return undefined;

    const uri = await index.getExistingFileUri(block.node);
    if (!uri) return undefined;

    // A .md file normally holds several blocks, so the definition is the block's own line. Falling
    // back to the top of the file is still better than refusing to navigate: the manifest says the
    // block is in there, and a tag written across two lines is the plausible reason for a miss.
    const lines = await readFileLines(uri);
    const line = lines ? (findDocsBlockLine(lines, block.name) ?? 0) : 0;
    return new vscode.Location(uri, new vscode.Position(line, 0));
  }
}
