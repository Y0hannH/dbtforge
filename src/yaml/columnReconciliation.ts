import type { DocumentedColumn, DocumentedEntity, DocumentedVersion } from './schemaColumns';

/**
 * Compares what a schema .yml claims about an entity's columns with what the warehouse actually
 * has, and reports the disagreements.
 *
 * Kept free of VS Code and of the index so the rules can be tested on their own: the caller
 * supplies the real columns, this decides what is worth saying about them.
 */

export interface ColumnFinding {
  /** What the finding is, so a fix can be offered for the right one — see schemaQuickFixes. */
  kind: 'duplicate-column' | 'unknown-column' | 'undocumented-columns';
  offset: number;
  length: number;
  message: string;
}

export interface ReconciliationOptions {
  /**
   * Whether a real column that nobody documented is worth a warning. Off by default, and a
   * setting rather than a rule: documenting only the columns that need explaining is a legitimate
   * house style, and on a 60-column model the other reading turns the file into 55 warnings.
   */
  flagUndocumented: boolean;
}

/** How many missing column names are named before the message stops listing them. */
const MAX_NAMED_COLUMNS = 6;

/**
 * @param catalogColumns the entity's real columns, or undefined when catalog.json cannot answer —
 * either because `dbt docs generate` has never run or because the entity was never built. Undefined
 * silences every catalog-based check for that entity: an absent catalog is not evidence of
 * anything, and warning from the manifest's documented columns instead would compare the file
 * against itself. Called with a version for each entry of a model's `versions:`, since each is its
 * own table.
 */
export function reconcileColumns(
  entities: DocumentedEntity[],
  catalogColumns: (entity: DocumentedEntity, version?: string) => string[] | undefined,
  options: ReconciliationOptions,
): ColumnFinding[] {
  const findings: ColumnFinding[] = [];

  for (const entity of entities) {
    const label = entityLabel(entity);

    // Duplicates are checked whether or not the catalog knows this entity: the mistake is inside
    // the file, and it is invisible everywhere else — dbt reads the columns into a mapping keyed
    // by name, so the second entry silently overwrites the first.
    findings.push(...duplicates(entity.columns, label));
    for (const version of entity.versions ?? []) {
      findings.push(...duplicates(version.columns, `${label} v${version.version}`));
    }

    findings.push(
      ...(entity.versions
        ? reconcileVersions(entity, entity.versions, label, catalogColumns, options)
        : reconcileTable(entity.columns, catalogColumns(entity), label, entity, options)),
    );
  }

  return findings.sort((a, b) => a.offset - b.offset);
}

function duplicates(columns: DocumentedColumn[], label: string): ColumnFinding[] {
  const findings: ColumnFinding[] = [];
  const seen = new Set<string>();
  for (const column of columns) {
    const key = column.name.toLowerCase();
    if (seen.has(key)) {
      findings.push({
        kind: 'duplicate-column',
        offset: column.offset,
        length: column.length,
        message:
          `Column "${column.name}" is documented twice under "${label}". dbt keeps the last ` +
          `entry, so the description above this one is dropped.`,
      });
    }
    seen.add(key);
  }
  return findings;
}

/** One table, one list of documented columns: the whole check for a model with no versions. */
function reconcileTable(
  documentedColumns: DocumentedColumn[],
  real: string[] | undefined,
  label: string,
  anchor: { offset: number; length: number },
  options: ReconciliationOptions,
): ColumnFinding[] {
  if (!real) return [];
  const findings: ColumnFinding[] = [];

  // Compared case-insensitively on purpose: warehouses disagree about the case they report —
  // Snowflake stores unquoted identifiers upper case, others lower — while a .yml is written
  // however the author types. Matching exactly would flag every column of a whole project.
  const realByKey = new Map(real.map((name) => [name.toLowerCase(), name]));

  for (const column of documentedColumns) {
    if (realByKey.has(column.name.toLowerCase())) continue;
    findings.push({
      kind: 'unknown-column',
      offset: column.offset,
      length: column.length,
      message:
        `"${label}" has no column "${column.name}" in catalog.json, so this description ` +
        `documents nothing. Run dbt docs generate if the column was just added or renamed.`,
    });
  }

  if (options.flagUndocumented) {
    findings.push(...undocumented(documentedColumns, realByKey, label, anchor));
  }
  return findings;
}

/**
 * A model with `versions:` is several tables sharing one list of top-level columns, so a column's
 * absence means different things in different places:
 *
 * - one listed under a version belongs to that version, and is wrong if *that* table lacks it;
 * - one listed at the top applies to every version, and is only wrong when no version has it —
 *   one version missing it is what `exclude:` is for, and is not an error.
 *
 * The top-level check also waits until every version's table is known: a version that was never
 * built might be the one that has the column.
 */
function reconcileVersions(
  entity: DocumentedEntity,
  versions: DocumentedVersion[],
  label: string,
  catalogColumns: (entity: DocumentedEntity, version?: string) => string[] | undefined,
  options: ReconciliationOptions,
): ColumnFinding[] {
  const findings: ColumnFinding[] = [];
  const tables = versions.map((version) => ({
    version,
    real: catalogColumns(entity, version.version),
  }));

  if (tables.every((table) => table.real !== undefined)) {
    const known = tables.map((table) => new Set(table.real!.map((name) => name.toLowerCase())));
    for (const column of entity.columns) {
      if (known.some((set) => set.has(column.name.toLowerCase()))) continue;
      findings.push({
        kind: 'unknown-column',
        offset: column.offset,
        length: column.length,
        message:
          `"${label}" has no column "${column.name}" in any of its versions in catalog.json, so ` +
          `this description documents nothing. Run dbt docs generate if the column was just ` +
          `added or renamed.`,
      });
    }
  }

  for (const { version, real } of tables) {
    // What the version documents is its own columns and the ones every version shares.
    findings.push(
      ...reconcileTable(
        version.columns,
        real,
        `${label} v${version.version}`,
        version,
        // The undocumented check needs the shared columns too, which reconcileTable can't see.
        { flagUndocumented: false },
      ),
    );

    if (options.flagUndocumented && real) {
      const realByKey = new Map(real.map((name) => [name.toLowerCase(), name]));
      findings.push(
        ...undocumented(
          [...entity.columns, ...version.columns],
          realByKey,
          `${label} v${version.version}`,
          version,
        ),
      );
    }
  }

  return findings;
}

function undocumented(
  documentedColumns: DocumentedColumn[],
  realByKey: Map<string, string>,
  label: string,
  anchor: { offset: number; length: number },
): ColumnFinding[] {
  const documented = new Set(documentedColumns.map((column) => column.name.toLowerCase()));
  const missing = [...realByKey].filter(([key]) => !documented.has(key)).map(([, name]) => name);
  if (missing.length === 0) return [];

  // One finding for the whole entity rather than one per column, and anchored on the entity's
  // own name: the point is "this file is incomplete", which is said once. A warning per column
  // would bury the two checks above under its own noise.
  return [
    {
      kind: 'undocumented-columns',
      offset: anchor.offset,
      length: anchor.length,
      message:
        `${missing.length} column${missing.length > 1 ? 's' : ''} of "${label}" ` +
        `${missing.length > 1 ? 'are' : 'is'} not documented here: ${nameList(missing)}.`,
    },
  ];
}

function entityLabel(entity: DocumentedEntity): string {
  return entity.sourceName ? `${entity.sourceName}.${entity.name}` : entity.name;
}

function nameList(names: string[]): string {
  if (names.length <= MAX_NAMED_COLUMNS) return names.join(', ');
  const shown = names.slice(0, MAX_NAMED_COLUMNS).join(', ');
  return `${shown} and ${names.length - MAX_NAMED_COLUMNS} more`;
}
