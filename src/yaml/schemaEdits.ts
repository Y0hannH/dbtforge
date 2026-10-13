import type { YAMLMap } from 'yaml';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

/**
 * Text edits to a schema .yml, computed from the file as it stands.
 *
 * Done on the parsed document's offsets and applied as plain text, rather than by parsing and
 * re-serialising the file: a re-serialised .yml loses its comments, its blank lines and its quoting
 * style, which is a diff nobody asked for. Each edit touches only the lines it is about.
 *
 * Both edits give up — return undefined — on a layout they can't be sure of (flow style, an item
 * sharing its line with something else). Offering a fix that might mangle the file is worse than
 * offering none.
 *
 * They also decline a model that declares `versions:`. The columns listed at its top level apply
 * to every version, while the catalog describes one table — so "the table has no such column" is
 * a claim about one version, and a fix built on it could break the others.
 */

export interface SchemaEdit {
  offset: number;
  /** How many characters starting at `offset` are replaced; 0 for a pure insertion. */
  deleteLength: number;
  insert: string;
}

/**
 * Removes the column whose `name:` sits at `columnNameOffset`, with its whole entry — description,
 * tests and all. When it is the only column, the `columns:` key goes with it: an empty `columns:`
 * is a null, which dbt reads as a malformed schema.
 */
export function removeColumnEdit(text: string, columnNameOffset: number): SchemaEdit | undefined {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return undefined;

  for (const entity of entityMaps(doc.contents)) {
    if (entity.has('versions')) continue;
    const columns = entity.get('columns', true);
    if (!isSeq(columns) || columns.flow) continue;

    const item = columns.items.find(
      (candidate) => isMap(candidate) && nameOffset(candidate) === columnNameOffset,
    );
    if (!item || !isMap(item) || !item.range) continue;

    const entryStart = ownLineStart(text, item.range[0], /^[ \t]*-[ \t]+$/);
    if (entryStart === undefined) return undefined;
    const entryEnd = lineEndAfter(text, item.range[1]);

    if (columns.items.length > 1) {
      return { offset: entryStart, deleteLength: entryEnd - entryStart, insert: '' };
    }

    const pair = entity.items.find((p) => isScalar(p.key) && p.key.value === 'columns');
    const keyStart = pair && isScalar(pair.key) && pair.key.range ? pair.key.range[0] : undefined;
    if (keyStart === undefined) return undefined;
    const keyLineStart = ownLineStart(text, keyStart, /^[ \t]*$/);
    if (keyLineStart === undefined) return undefined;
    return { offset: keyLineStart, deleteLength: entryEnd - keyLineStart, insert: '' };
  }

  return undefined;
}

/**
 * Appends `names` as `- name:` entries to the entity whose `name:` sits at `entityNameOffset`,
 * creating its `columns:` key when it has none. Entries are stubs — a name and nothing else — for
 * the author to describe.
 */
export function addColumnsEdit(
  text: string,
  entityNameOffset: number,
  names: string[],
): SchemaEdit | undefined {
  if (names.length === 0) return undefined;
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return undefined;

  const entity = entityMaps(doc.contents).find((map) => nameOffset(map) === entityNameOffset);
  if (!entity || !entity.range || entity.has('versions')) return undefined;

  const columns = entity.get('columns', true);

  if (isSeq(columns)) {
    const first = columns.items[0];
    const last = columns.items[columns.items.length - 1];
    if (columns.flow || !isMap(first) || !first.range || !isMap(last) || !last.range) {
      return undefined;
    }

    const indent = /^([ \t]*)-[ \t]+$/.exec(
      text.slice(lineStartOf(text, first.range[0]), first.range[0]),
    );
    if (!indent) return undefined;

    return insertAfterLine(
      text,
      last.range[1],
      names.map((name) => `${indent[1]}- name: ${yamlScalar(name)}\n`).join(''),
    );
  }

  // A `columns:` that exists but isn't a list (a null, a string) is the author's to sort out.
  if (entity.has('columns')) return undefined;

  const firstKey = entity.items[0]?.key;
  if (!isScalar(firstKey) || !firstKey.range) return undefined;
  // Sibling keys sit where the first one does, which — in `- name: x` — is after the dash.
  const keyIndent = ' '.repeat(firstKey.range[0] - lineStartOf(text, firstKey.range[0]));

  return insertAfterLine(
    text,
    entity.range[1],
    `${keyIndent}columns:\n` +
      names.map((name) => `${keyIndent}  - name: ${yamlScalar(name)}\n`).join(''),
  );
}

/** Every mapping that can carry `columns:` — models, seeds, snapshots and source tables. */
function entityMaps(root: YAMLMap): YAMLMap[] {
  const maps: YAMLMap[] = [];

  for (const section of ['models', 'seeds', 'snapshots']) {
    const seq = root.get(section, true);
    if (!isSeq(seq)) continue;
    for (const item of seq.items) if (isMap(item)) maps.push(item);
  }

  const sources = root.get('sources', true);
  if (isSeq(sources)) {
    for (const source of sources.items) {
      if (!isMap(source)) continue;
      const tables = source.get('tables', true);
      if (!isSeq(tables)) continue;
      for (const table of tables.items) if (isMap(table)) maps.push(table);
    }
  }

  return maps;
}

function nameOffset(map: YAMLMap): number | undefined {
  const name = map.get('name', true);
  return isScalar(name) && name.range ? name.range[0] : undefined;
}

function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** The start of the line `offset` is on, but only if what precedes it on that line matches. */
function ownLineStart(text: string, offset: number, before: RegExp): number | undefined {
  const start = lineStartOf(text, offset);
  return before.test(text.slice(start, offset)) ? start : undefined;
}

/** The offset just past the newline of the line holding `valueEnd`, or the end of the text. */
function lineEndAfter(text: string, valueEnd: number): number {
  // `valueEnd` is exclusive: a value ending the line has the newline at `valueEnd`, but a node
  // that swallowed its trailing newline ends just after it, so look from the last character.
  const newline = text.indexOf('\n', Math.max(valueEnd - 1, 0));
  return newline === -1 ? text.length : newline + 1;
}

function insertAfterLine(text: string, valueEnd: number, insert: string): SchemaEdit {
  const offset = lineEndAfter(text, valueEnd);
  // A file with no final newline: the last line has to be ended before anything follows it.
  const needsBreak = offset === text.length && !text.endsWith('\n');
  return { offset, deleteLength: 0, insert: needsBreak ? `\n${insert}` : insert };
}

// A column name is a plain word almost always; one that isn't (a space, a colon, a leading
// symbol) is written as a JSON string, which is a valid YAML double-quoted scalar.
function yamlScalar(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : JSON.stringify(name);
}
