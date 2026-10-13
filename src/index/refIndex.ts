import type { DbtManifest, DbtNode } from './manifestTypes';
import { isVersioned } from './modelVersions';

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
  /** Set on a versioned model only — what `ref('name', v=<version>)` names. */
  version?: string;
  node: DbtNode;
}

export function isReferenceable(node: DbtNode): boolean {
  return REFERENCEABLE_RESOURCE_TYPES.has(node.resource_type);
}

function toModelRef(node: DbtNode): ModelRef {
  return {
    uniqueId: node.unique_id,
    name: node.name,
    packageName: node.package_name,
    resourceType: node.resource_type,
    ...(isVersioned(node) ? { version: String(node.version) } : {}),
    node,
  };
}

/**
 * name -> node, for a bare `ref('name')`. dbt requires referenceable names to be unique across the
 * project by default (a seed and a model can't share a name), so a flat map keyed by name is
 * sufficient — with one exception: the versions of a model all carry the same `name`.
 *
 * A bare ref to a versioned model goes to its `latest_version`, which is not necessarily the
 * highest version (a newer one can be a prerelease), so the entry is picked by that field and not
 * by manifest order. A call that names a version is answered by buildVersionedRefIndex instead.
 */
export function buildRefIndex(manifest: DbtManifest): Map<string, ModelRef> {
  const byName = new Map<string, ModelRef>();
  const versionsByName = new Map<string, DbtNode[]>();

  for (const node of Object.values(manifest.nodes)) {
    if (!isReferenceable(node)) continue;
    if (isVersioned(node)) {
      versionsByName.set(node.name, [...(versionsByName.get(node.name) ?? []), node]);
      continue;
    }
    byName.set(node.name, toModelRef(node));
  }

  for (const [name, versions] of versionsByName) {
    const latest = latestVersion(versions);
    if (latest) byName.set(name, toModelRef(latest));
  }

  return byName;
}

/**
 * `name` + version -> node, for `ref('name', v=2)`. Holds versioned models only: pinning a version
 * on a model that has none is an error in dbt too, so it is left to resolve to nothing.
 */
export function buildVersionedRefIndex(manifest: DbtManifest): Map<string, ModelRef> {
  const byVersion = new Map<string, ModelRef>();

  for (const node of Object.values(manifest.nodes)) {
    if (!isReferenceable(node) || !isVersioned(node)) continue;
    byVersion.set(versionKey(node.name, String(node.version)), toModelRef(node));
  }

  return byVersion;
}

/** The key a `ref(name, v=version)` is looked up under in buildVersionedRefIndex. */
export function versionKey(name: string, version: string): string {
  return `${name}\u0000${version}`;
}

// The version `latest_version` names, which dbt writes on every version of a model. Absent from
// a partial or hand-edited manifest, it falls back to the highest version — the rule dbt applies
// itself when a yml doesn't declare one — rather than leaving a model that exists unresolved.
function latestVersion(versions: DbtNode[]): DbtNode | undefined {
  const declared = versions.find((node) => node.latest_version != null)?.latest_version;
  if (declared !== undefined && declared !== null) {
    return versions.find((node) => String(node.version) === String(declared));
  }
  return [...versions].sort((a, b) => compareVersions(String(b.version), String(a.version)))[0];
}

function compareVersions(left: string, right: string): number {
  const l = Number(left);
  const r = Number(right);
  return Number.isFinite(l) && Number.isFinite(r) ? l - r : left.localeCompare(right);
}
