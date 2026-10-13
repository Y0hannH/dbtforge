import type { DocumentedEntity } from '../yaml/schemaColumns';
import type { DbtProjectIndex } from './dbtProjectIndex';

/**
 * The real columns of a documented entity, in table order, or undefined when neither the manifest
 * nor the catalog can say — never run, never built, or not in the project at all.
 *
 * Shared by the warnings and their fixes: both must agree on what "the table's columns" means, or
 * a fix could be offered for a warning the file never showed.
 */
export function catalogColumnNames(
  index: Pick<DbtProjectIndex, 'resolveRef' | 'resolveSource' | 'getCatalogColumns'>,
  entity: DocumentedEntity,
): string[] | undefined {
  const uniqueId =
    entity.kind === 'source'
      ? index.resolveSource(entity.sourceName ?? '', entity.name)?.uniqueId
      : index.resolveRef(entity.name)?.uniqueId;
  if (!uniqueId) return undefined;

  return index.getCatalogColumns(uniqueId)?.map((column) => column.name);
}
