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
  // Downstream consumers declared in a .yml (dashboards, notebooks, apps). Kept apart from `nodes`
  // by dbt, and optional here because older manifests do not have the section.
  exposures?: Record<string, DbtExposureNode>;
  macros?: Record<string, DbtMacroNode>;
  // `{% docs %}` blocks, keyed by unique_id. Present since the manifest schema versions dbt Forge
  // targets; optional here for the same reason macros are — a partial manifest may omit it.
  docs?: Record<string, DbtDocNode>;
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
  config?: {
    tags?: string[];
    /** 'table' | 'view' | 'incremental' | 'ephemeral' | adapter-specific ones. */
    materialized?: string;
    // Adapter-specific, and read as the free text it is: Snowflake dynamic tables carry either a
    // duration ('3 minutes') or the literal 'downstream', which means "inherit from whatever reads
    // me". dbt records the word, not the inherited value, so the word is what gets shown.
    target_lag?: string;
    // `docs` appears both here and at the top level of the node; which one carries node_color
    // depends on where it was declared, so both are read — see nodeDisplay.
    docs?: DbtDocsConfig;
  };
  docs?: DbtDocsConfig;
  depends_on?: {
    nodes: string[];
    macros?: string[];
  };
  columns?: Record<string, { name: string; description?: string }>;
}

export interface DbtDocsConfig {
  show?: boolean;
  /** Colour declared via `+docs: node_color:` or `config(docs={'node_color': ...})`. */
  node_color?: string | null;
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

/** A `{% docs name %} ... {% enddocs %}` block, declared in a .md file. */
export interface DbtDocNode {
  unique_id: string;
  resource_type: 'doc';
  name: string;
  package_name: string;
  path: string;
  original_file_path: string;
  /** The markdown between the tags — what dbt substitutes wherever `doc('name')` appears. */
  block_contents?: string;
}

/** A declared consumer of the project — always a leaf, since nothing can depend on it. */
export interface DbtExposureNode {
  unique_id: string;
  resource_type: 'exposure';
  name: string;
  package_name: string;
  path: string;
  original_file_path: string; // the .yml that declares it
  description?: string;
  /** 'dashboard' | 'notebook' | 'analysis' | 'ml' | 'application'. */
  type?: string;
  maturity?: string;
  url?: string;
  depends_on?: { nodes: string[] };
}

/** Anything the lineage graph can draw: `parent_map`/`child_map` carry all three kinds. */
export type LineageEntity = DbtNode | DbtSourceNode | DbtExposureNode;

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
