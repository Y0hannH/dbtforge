import { DbtDocNode, DbtManifest } from './manifestTypes';

export interface DocRef {
  uniqueId: string;
  name: string;
  packageName: string;
  node: DbtDocNode;
}

export interface DocIndex {
  /** Resolves a `doc()` call; a two-argument call (`doc('package', 'block')`) must match exactly. */
  resolve(name: string, packageName?: string): DocRef | undefined;
  /** Every block, for completion — the root project's first, then the packages'. */
  all(): DocRef[];
}

/**
 * Index over `manifest.docs` for resolving `{{ doc('...') }}` calls to the block that defines them.
 *
 * Doc block names carry the same collision rule as macros rather than the one models follow: dbt
 * requires uniqueness within a package, not across the project, so an installed package can
 * define a block with the same name as one of yours. Collisions therefore resolve deterministically
 * — the root project wins, and between two packages the first in the manifest wins — instead of
 * depending on the manifest's iteration order. A namespaced call names its package and is resolved
 * exactly, with no fallback, since falling back would silently point at someone else's block.
 */
export function buildDocIndex(manifest: DbtManifest): DocIndex {
  const projectName = manifest.metadata.project_name;
  const byName = new Map<string, DocRef>();
  const byQualifiedName = new Map<string, DocRef>();
  const ordered: DocRef[] = [];

  for (const node of Object.values(manifest.docs ?? {})) {
    const ref: DocRef = {
      uniqueId: node.unique_id,
      name: node.name,
      packageName: node.package_name,
      node,
    };

    ordered.push(ref);
    byQualifiedName.set(qualify(node.package_name, node.name), ref);

    const existing = byName.get(node.name);
    if (!existing || (existing.packageName !== projectName && node.package_name === projectName)) {
      byName.set(node.name, ref);
    }
  }

  // The root project's blocks are the ones the user writes and reaches for, so they lead the
  // completion list; a package's blocks stay available but sort after them.
  ordered.sort((left, right) => {
    const leftIsProject = left.packageName === projectName ? 0 : 1;
    const rightIsProject = right.packageName === projectName ? 0 : 1;
    return leftIsProject - rightIsProject || left.name.localeCompare(right.name);
  });

  return {
    resolve(name: string, packageName?: string): DocRef | undefined {
      if (packageName) return byQualifiedName.get(qualify(packageName, name));
      return byName.get(name);
    },
    all(): DocRef[] {
      return ordered;
    },
  };
}

function qualify(packageName: string, name: string): string {
  return `${packageName}.${name}`;
}
