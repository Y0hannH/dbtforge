import type { DocumentedEntity } from './schemaColumns';

/**
 * Compares what a schema .yml claims about an entity's columns with what the warehouse actually
 * has, and reports the disagreements.
 *
 * Kept free of VS Code and of the index so the rules can be tested on their own: the caller
 * supplies the real columns, this decides what is worth saying about them.
 */

export interface ColumnFinding {
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
 * against itself.
 */
export function reconcileColumns(
  entities: DocumentedEntity[],
  catalogColumns: (entity: DocumentedEntity) => string[] | undefined,
  options: ReconciliationOptions,
): ColumnFinding[] {
  const findings: ColumnFinding[] = [];

  for (const entity of entities) {
    const label = entityLabel(entity);

    // Duplicates are checked whether or not the catalog knows this entity: the mistake is inside
    // the file, and it is invisible everywhere else — dbt reads the columns into a mapping keyed
    // by name, so the second entry silently overwrites the first.
    const seen = new Set<string>();
    for (const column of entity.columns) {
      const key = column.name.toLowerCase();
      if (seen.has(key)) {
        findings.push({
          offset: column.offset,
          length: column.length,
          message:
            `Column "${column.name}" is documented twice under "${label}". dbt keeps the last ` +
            `entry, so the description above this one is dropped.`,
        });
      }
      seen.add(key);
    }

    const real = catalogColumns(entity);
    if (!real) continue;

    // Compared case-insensitively on purpose: warehouses disagree about the case they report —
    // Snowflake stores unquoted identifiers upper case, others lower — while a .yml is written
    // however the author types. Matching exactly would flag every column of a whole project.
    const realByKey = new Map(real.map((name) => [name.toLowerCase(), name]));

    for (const column of entity.columns) {
      if (realByKey.has(column.name.toLowerCase())) continue;
      findings.push({
        offset: column.offset,
        length: column.length,
        message:
          `"${label}" has no column "${column.name}" in catalog.json, so this description ` +
          `documents nothing. Run dbt docs generate if the column was just added or renamed.`,
      });
    }

    if (!options.flagUndocumented) continue;

    const documented = new Set(entity.columns.map((column) => column.name.toLowerCase()));
    const missing = [...realByKey].filter(([key]) => !documented.has(key)).map(([, name]) => name);
    if (missing.length === 0) continue;

    // One finding for the whole entity rather than one per column, and anchored on the entity's
    // own name: the point is "this file is incomplete", which is said once. A warning per column
    // would bury the two checks above under its own noise.
    findings.push({
      offset: entity.offset,
      length: entity.length,
      message:
        `${missing.length} column${missing.length > 1 ? 's' : ''} of "${label}" ` +
        `${missing.length > 1 ? 'are' : 'is'} not documented here: ${nameList(missing)}.`,
    });
  }

  return findings.sort((a, b) => a.offset - b.offset);
}

function entityLabel(entity: DocumentedEntity): string {
  return entity.sourceName ? `${entity.sourceName}.${entity.name}` : entity.name;
}

function nameList(names: string[]): string {
  if (names.length <= MAX_NAMED_COLUMNS) return names.join(', ');
  const shown = names.slice(0, MAX_NAMED_COLUMNS).join(', ');
  return `${shown} and ${names.length - MAX_NAMED_COLUMNS} more`;
}
