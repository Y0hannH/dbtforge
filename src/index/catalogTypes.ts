// Minimal subset of dbt's catalog.json schema (output of `dbt docs generate`).
// catalog.json only contains entries for nodes that have actually been built at least once —
// this is a known, accepted limitation surfaced to the user, not something to work around.

export interface DbtCatalog {
  nodes: Record<string, DbtCatalogNode>;
  sources: Record<string, DbtCatalogNode>;
}

export interface DbtCatalogNode {
  unique_id: string;
  metadata: {
    schema: string;
    name: string;
    type: string;
  };
  columns: Record<string, DbtCatalogColumn>;
}

export interface DbtCatalogColumn {
  name: string;
  type: string;
  index: number;
  comment?: string | null;
}
