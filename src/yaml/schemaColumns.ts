import { isMap, isScalar, isSeq, parseDocument, YAMLMap } from 'yaml';

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

  const columns: DocumentedColumn[] = [];
  const columnsNode = map.get('columns', true);
  if (isSeq(columnsNode)) {
    for (const item of columnsNode.items) {
      if (!isMap(item)) continue;
      const column = readName(item);
      if (column)
        columns.push({ name: column.value, offset: column.offset, length: column.length });
    }
  }

  return { kind, name: name.value, offset: name.offset, length: name.length, columns };
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
