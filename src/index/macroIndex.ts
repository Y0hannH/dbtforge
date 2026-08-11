import { DbtMacroNode, DbtManifest } from './manifestTypes';

export interface MacroRef {
  uniqueId: string;
  name: string;
  packageName: string;
  node: DbtMacroNode;
}

export interface MacroIndex {
  /** Resolves a macro call; a namespaced call (`dbt_utils.star(...)`) must match that package. */
  resolve(name: string, packageName?: string): MacroRef | undefined;
  /** Every macro with this name, across packages — for disambiguating by defining file. */
  findAllByName(name: string): MacroRef[];
}

/**
 * Index over manifest.macros for resolving macro calls to their definition.
 *
 * Unlike model names, macro names are *not* unique across packages: dbt_utils and spark_utils
 * both define `star`, a project macro can shadow a package one, and dbt-core defines macros
 * named after SQL functions. Iteration order of manifest.macros is therefore not a safe
 * tie-break for a bare call, so collisions resolve deterministically: the root project wins over
 * any package, and between two packages the first one in the manifest wins. A namespaced call
 * names its package explicitly and is resolved exactly, with no fallback to the by-name entry —
 * falling back would silently jump to a same-named macro from a different package.
 */
export function buildMacroIndex(manifest: DbtManifest): MacroIndex {
  const projectName = manifest.metadata.project_name;
  const byName = new Map<string, MacroRef>();
  const byQualifiedName = new Map<string, MacroRef>();
  const allByName = new Map<string, MacroRef[]>();

  for (const node of Object.values(manifest.macros ?? {})) {
    const ref: MacroRef = {
      uniqueId: node.unique_id,
      name: node.name,
      packageName: node.package_name,
      node,
    };
    byQualifiedName.set(qualifiedName(node.package_name, node.name), ref);
    allByName.set(node.name, [...(allByName.get(node.name) ?? []), ref]);

    const existing = byName.get(node.name);
    const existingWins =
      existing && (existing.packageName === projectName || node.package_name !== projectName);
    if (!existingWins) byName.set(node.name, ref);
  }

  return {
    resolve(name: string, packageName?: string): MacroRef | undefined {
      return packageName ? byQualifiedName.get(qualifiedName(packageName, name)) : byName.get(name);
    },
    findAllByName(name: string): MacroRef[] {
      return allByName.get(name) ?? [];
    },
  };
}

function qualifiedName(packageName: string, name: string): string {
  return `${packageName}.${name}`;
}
