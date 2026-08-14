import { DbtManifest, DbtNode } from './manifestTypes';

/**
 * Resource types `ref()` can resolve to. Seeds and snapshots are referenced exactly like models
 * — `{{ ref('country_codes') }}` on a seed is the documented way to join one — so an index that
 * only knew about models reported every such call as an unresolved model.
 *
 * Analyses and tests are deliberately absent: dbt itself refuses to `ref()` them.
 */
export const REFERENCEABLE_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'model',
  'seed',
  'snapshot',
]);

export interface ModelRef {
  uniqueId: string;
  name: string;
  packageName: string;
  /** 'model' | 'seed' | 'snapshot' — what the ref() actually points at, for labelling. */
  resourceType: string;
  node: DbtNode;
}

export function isReferenceable(node: DbtNode): boolean {
  return REFERENCEABLE_RESOURCE_TYPES.has(node.resource_type);
}

/**
 * name -> node, for ref() resolution. dbt requires referenceable names to be unique across the
 * project by default (a seed and a model can't share a name), so a flat map keyed by name is
 * sufficient — same assumption the model-only index made before seeds and snapshots joined it.
 */
export function buildRefIndex(manifest: DbtManifest): Map<string, ModelRef> {
  const byName = new Map<string, ModelRef>();

  for (const node of Object.values(manifest.nodes)) {
    if (!isReferenceable(node)) continue;
    byName.set(node.name, {
      uniqueId: node.unique_id,
      name: node.name,
      packageName: node.package_name,
      resourceType: node.resource_type,
      node,
    });
  }

  return byName;
}
