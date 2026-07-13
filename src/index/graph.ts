import { DbtManifest, DbtNode } from './manifestTypes';

export interface DependencyGraph {
  getParents(uniqueId: string): string[];
  getChildren(uniqueId: string): string[];
  getTests(uniqueId: string): DbtNode[];
  getMacroCallers(macroUniqueId: string): string[];
}

// child_map/parent_map are present in manifest.json for schema versions dbt Forge targets,
// so we read them directly rather than re-deriving from depends_on (cheaper, and matches
// what dbt itself computed). There's no equivalent macro_child_map, so macro callers are
// derived from depends_on.macros across nodes and macros themselves (macros can call macros).
export function buildDependencyGraph(manifest: DbtManifest): DependencyGraph {
  const parentMap = manifest.parent_map ?? {};
  const childMap = manifest.child_map ?? {};

  const testsByTarget = new Map<string, DbtNode[]>();
  for (const node of Object.values(manifest.nodes)) {
    if (node.resource_type !== 'test') continue;
    for (const targetId of node.depends_on?.nodes ?? []) {
      const list = testsByTarget.get(targetId) ?? [];
      list.push(node);
      testsByTarget.set(targetId, list);
    }
  }

  const macroCallersByMacroId = new Map<string, string[]>();
  const macroCallers: Array<{ unique_id: string; depends_on?: { macros?: string[] } }> = [
    ...Object.values(manifest.nodes),
    ...Object.values(manifest.macros ?? {}),
  ];
  for (const entity of macroCallers) {
    for (const macroId of entity.depends_on?.macros ?? []) {
      const list = macroCallersByMacroId.get(macroId) ?? [];
      list.push(entity.unique_id);
      macroCallersByMacroId.set(macroId, list);
    }
  }

  return {
    getParents(uniqueId: string): string[] {
      return parentMap[uniqueId] ?? [];
    },
    getChildren(uniqueId: string): string[] {
      return childMap[uniqueId] ?? [];
    },
    getTests(uniqueId: string): DbtNode[] {
      return testsByTarget.get(uniqueId) ?? [];
    },
    getMacroCallers(macroUniqueId: string): string[] {
      return macroCallersByMacroId.get(macroUniqueId) ?? [];
    },
  };
}
