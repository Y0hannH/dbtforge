import type { YAMLMap } from 'yaml';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

/**
 * The entities a dbt schema .yml documents, and the columns declared under each — with the source
 * offsets a diagnostic needs to point at them.
 *
 * Parsed with the `yaml` package rather than by scanning lines, because the point of the file is
 * to say *where* something is: quoted names, block scalars and comments all move the position of a
 * name relative to its line, and a hand-rolled scanner would anchor warnings on the wrong text.
 *
 * Offsets, not line/character pairs: the parser has no business knowing about a TextDocument, and
 * positionAt() converts one into the other at the call site.
 */

export interface DocumentedColumn {
  name: string;
  offset: number;
  length: number;
}

/**
 * One entry of a model's `versions:`. Its columns are the ones that apply to that version alone;
 * the entity's own top-level columns apply to all of them.
 */
export interface DocumentedVersion {
  /** The `v:` value as text — a version is a number or a string in a .yml, never compared as either. */
  version: string;
  /** Where the `v:` value sits, which is where a finding about the version as a whole is anchored. */
  offset: number;
  length: number;
  columns: DocumentedColumn[];
}

export interface DocumentedEntity {
  /** What the entity is, which decides how it resolves against the manifest. */
  kind: 'model' | 'seed' | 'snapshot' | 'source';
  /** The model/seed/snapshot name, or — for a source — the table name. */
  name: string;
  /** The source (schema) name, i.e. the first argument to source(). Sources only. */
  sourceName?: string;
  offset: number;
  length: number;
  columns: DocumentedColumn[];
  /** Present on a model that declares `versions:`. */
  versions?: DocumentedVersion[];
}

/** Top-level keys that hold entities the catalog can also describe. */
const NODE_SECTIONS: ReadonlyArray<['models' | 'seeds' | 'snapshots', DocumentedEntity['kind']]> = [
  ['models', 'model'],
  ['seeds', 'seed'],
  ['snapshots', 'snapshot'],
];

/**
 * Every documented entity in a schema .yml, or an empty list when the file says nothing this
 * function understands.
 *
 * A file that doesn't parse yields nothing rather than a partial reading — half a schema file is
 * indistinguishable from a schema file being typed, and warning about the half that parsed would
 * flag columns the author is in the middle of writing.
 */
export function parseSchemaEntities(text: string): DocumentedEntity[] {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return [];

  const root = doc.contents;
  if (!isMap(root)) return [];

  const entities: DocumentedEntity[] = [];

  for (const [section, kind] of NODE_SECTIONS) {
    const seq = root.get(section, true);
    if (!isSeq(seq)) continue;
    for (const item of seq.items) {
      if (!isMap(item)) continue;
      const entity = readEntity(item, kind);
      if (entity) entities.push(entity);
    }
  }

  // A source declares its tables one level deeper, and it is the *table* that has columns and a
  // catalog entry — the source itself is only the schema it lives in.
  const sources = root.get('sources', true);
  if (isSeq(sources)) {
    for (const source of sources.items) {
      if (!isMap(source)) continue;
      const sourceName = readName(source)?.value;
      if (sourceName === undefined) continue;

      const tables = source.get('tables', true);
      if (!isSeq(tables)) continue;
      for (const table of tables.items) {
        if (!isMap(table)) continue;
        const entity = readEntity(table, 'source');
        if (entity) entities.push({ ...entity, sourceName });
      }
    }
  }

  return entities;
}

function readEntity(map: YAMLMap, kind: DocumentedEntity['kind']): DocumentedEntity | undefined {
  const name = readName(map);
  if (!name) return undefined;

  const versions = readVersions(map);

  return {
    kind,
    name: name.value,
    offset: name.offset,
    length: name.length,
    columns: readColumns(map),
    ...(versions.length > 0 ? { versions } : {}),
  };
}

/**
 * The columns a mapping documents by name. An entry that is not a plain `name:` — the
 * `include: all` / `exclude: […]` form versions use — documents no one column, so it is skipped.
 */
function readColumns(map: YAMLMap): DocumentedColumn[] {
  const columns: DocumentedColumn[] = [];
  const columnsNode = map.get('columns', true);
  if (!isSeq(columnsNode)) return columns;

  for (const item of columnsNode.items) {
    if (!isMap(item)) continue;
    const column = readName(item);
    if (column) columns.push({ name: column.value, offset: column.offset, length: column.length });
  }
  return columns;
}

function readVersions(map: YAMLMap): DocumentedVersion[] {
  const versions: DocumentedVersion[] = [];
  const node = map.get('versions', true);
  if (!isSeq(node)) return versions;

  for (const item of node.items) {
    if (!isMap(item)) continue;
    const v = item.get('v', true);
    // dbt writes a version as a number (`v: 2`) or a string (`v: "2024-01"`); both are text here.
    if (!isScalar(v) || !v.range || (typeof v.value !== 'number' && typeof v.value !== 'string')) {
      continue;
    }
    const [start, end] = v.range;
    versions.push({
      version: String(v.value),
      offset: start,
      length: Math.max(end - start, 1),
      columns: readColumns(item),
    });
  }
  return versions;
}

/**
 * The `name:` of a mapping, with where it sits in the source.
 *
 * A name that isn't a plain string — a number, a null, an anchor — is treated as absent: dbt
 * itself would reject it, and there is nothing to compare it against.
 */
function readName(map: YAMLMap): { value: string; offset: number; length: number } | undefined {
  const node = map.get('name', true);
  if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return undefined;

  const [start, valueEnd] = node.range;
  return { value: node.value, offset: start, length: Math.max(valueEnd - start, 1) };
}
