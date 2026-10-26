import type { DbtNode } from '../index/manifestTypes';
import { versionedName } from '../index/modelVersions';
import { isReferenceable } from '../index/refIndex';

export interface ModelSearchItem {
  uniqueId: string;
  /** `dim_customers`, or `dim_customers (v2)` — each version is its own entry, as in the lineage. */
  label: string;
  /** The folder under the project (or package) root, so two `stg_orders` can be told apart. */
  description: string;
  /** Drives the row's icon: a seed or snapshot is told apart from a model by it, not by a label. */
  resourceType: string;
}

/**
 * What the search offers: every model, seed and snapshot, each version of a versioned model
 * separately. Not `getAllRefTargets()`, which holds one entry per name — a versioned model
 * answers to its latest version there, so v1 would be unreachable from a search.
 *
 * Sorted by name so the list is stable between reloads; the picker's own fuzzy matching decides
 * the order once something is typed.
 */
export function buildModelSearchItems(
  nodes: readonly DbtNode[],
  projectName: string,
): ModelSearchItem[] {
  return nodes
    .filter(isReferenceable)
    .map((node) => ({
      uniqueId: node.unique_id,
      label: versionedName(node),
      description: describeLocation(node, projectName),
      resourceType: node.resource_type,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.description.localeCompare(b.description));
}

// The package is named only when it isn't the project itself: on a project that installs
// packages, `dbt_utils` models would otherwise look like the user's own.
function describeLocation(node: DbtNode, projectName: string): string {
  const folder = node.original_file_path.split('/').slice(0, -1).join('/');
  return node.package_name === projectName ? folder : `${node.package_name} · ${folder}`;
}
