import type { DbtNode } from './manifestTypes';

/**
 * What a model's version changes about how it is named, shown and selected.
 *
 * The versions of a model are separate nodes sharing one `name`, so anything keyed or labelled by
 * name alone cannot tell them apart: two boxes both called `dim_customers`, or a `--select
 * dim_customers` that builds both. These helpers are where that is decided once.
 */

type Versioned = Pick<DbtNode, 'name' | 'version' | 'latest_version' | 'original_file_path'>;

export function isVersioned(node: Pick<DbtNode, 'version'>): boolean {
  return node.version !== undefined && node.version !== null;
}

/** `dim_customers`, or `dim_customers (v2)` for a version of it. */
export function versionedName(node: Versioned): string {
  return isVersioned(node) ? `${node.name} (v${node.version})` : node.name;
}

/**
 * Whether this is the version a bare `ref('name')` goes to. Undefined — not false — when the
 * manifest doesn't say which that is, since a version that might be the latest is not "not the
 * latest".
 */
export function isLatestVersion(node: Versioned): boolean | undefined {
  if (!isVersioned(node)) return undefined;
  if (node.latest_version === undefined || node.latest_version === null) return undefined;
  return String(node.version) === String(node.latest_version);
}

/**
 * The argument for `--select` that picks exactly this node.
 *
 * A name picks every version of a model, and `dbt show` refuses to preview more than one node, so
 * a versioned model is selected by the file that defines it instead — the same `path:` selector
 * the folder and compile commands already use. `original_file_path` is project-relative and
 * forward-slashed on every platform.
 */
export function nodeSelector(node: Versioned): string {
  return isVersioned(node) ? `path:${node.original_file_path}` : node.name;
}
