// Minimal subset of dbt's manifest.json schema — only the fields dbt Forge actually reads.
// Deliberately not exhaustive: dbt's manifest schema is large and versioned; we only model
// what the features in scope need.

export interface DbtManifest {
  metadata: {
    dbt_schema_version: string;
    project_name: string;
  };
  nodes: Record<string, DbtNode>;
  sources: Record<string, DbtSourceNode>;
  macros?: Record<string, DbtMacroNode>;
  child_map?: Record<string, string[]>;
  parent_map?: Record<string, string[]>;
}

export interface DbtNode {
  unique_id: string;
  resource_type: 'model' | 'test' | 'seed' | 'snapshot' | 'analysis' | string;
  name: string;
  package_name: string;
  path: string; // relative to the package's models dir
  original_file_path: string; // relative to project root
  description?: string;
  // dbt resolves tags from dbt_project.yml, the schema .yml, and in-model config() into the
  // top-level `tags`, but older/partial manifests only carry them under `config.tags` —
  // both are read and unioned rather than trusting one.
  tags?: string[];
  config?: { tags?: string[] };
  depends_on?: {
    nodes: string[];
    macros?: string[];
  };
  columns?: Record<string, { name: string; description?: string }>;
}

export interface DbtMacroNode {
  unique_id: string;
  resource_type: 'macro';
  name: string;
  package_name: string;
  path: string;
  original_file_path: string;
  description?: string;
  arguments?: Array<{ name: string; type?: string; description?: string }>;
  depends_on?: {
    macros?: string[];
  };
}

export interface DbtSourceNode {
  unique_id: string;
  resource_type: 'source';
  name: string; // table name
  source_name: string; // source (schema) name, i.e. first arg to source()
  package_name: string;
  original_file_path: string;
  description?: string;
  tags?: string[];
  config?: { tags?: string[] };
  columns?: Record<string, { name: string; description?: string }>;
}
