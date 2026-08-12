import { DbtManifest, DbtNode, DbtSourceNode } from './manifestTypes';

export interface TagRef {
  tag: string;
  /** unique_ids of every resource carrying the tag, in manifest order. */
  uniqueIds: string[];
  /** Count of `model` resources only — what "build this tag" actually materializes. */
  modelCount: number;
}

/**
 * Collects every tag declared across models, tests, seeds, snapshots and sources, matching
 * what dbt's own `--select tag:x` resolves to.
 *
 * dbt merges tags from dbt_project.yml, the schema .yml and in-model config() into a node's
 * top-level `tags`, but they also appear under `config.tags` and not every manifest version
 * populates both identically — so the two are unioned rather than trusting either alone.
 */
export function collectTags(manifest: DbtManifest): TagRef[] {
  const uniqueIdsByTag = new Map<string, string[]>();
  const modelIds = new Set<string>();

  const record = (node: DbtNode | DbtSourceNode): void => {
    for (const tag of new Set([...(node.tags ?? []), ...(node.config?.tags ?? [])])) {
      if (!tag) continue;
      const list = uniqueIdsByTag.get(tag) ?? [];
      list.push(node.unique_id);
      uniqueIdsByTag.set(tag, list);
    }
  };

  for (const node of Object.values(manifest.nodes)) {
    if (node.resource_type === 'model') modelIds.add(node.unique_id);
    record(node);
  }
  for (const source of Object.values(manifest.sources)) {
    record(source);
  }

  return [...uniqueIdsByTag.entries()]
    .map(([tag, uniqueIds]) => ({
      tag,
      uniqueIds,
      modelCount: uniqueIds.filter((id) => modelIds.has(id)).length,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
