import * as path from 'path';
import { DbtMacroNode, DbtNode, DbtSourceNode } from './manifestTypes';

// dbt's default `packages-install-path`. Installed packages are vendored here, and their
// manifest entries carry an original_file_path relative to the *package* root, not the project.
const PACKAGES_DIR = 'dbt_packages';

export type ManifestEntity = DbtNode | DbtSourceNode | DbtMacroNode;

/**
 * Absolute on-disk path for a manifest entity.
 *
 * Entities from the root project resolve directly under the project dir; entities from an
 * installed package resolve under dbt_packages/<package>/. Macros make this matter in practice:
 * manifest.macros is dominated by package and dbt-core macros, and resolving those against the
 * project root produces a path that doesn't exist.
 *
 * The path is not guaranteed to exist: dbt-core's own global project (package "dbt" and the
 * adapter packages) is installed with the Python distribution rather than vendored under
 * dbt_packages/. Callers that navigate to the file must check first — see fileExists().
 */
export function resolveEntityPath(
  projectDir: string,
  projectName: string,
  entity: ManifestEntity
): string {
  if (entity.package_name === projectName) {
    return path.join(projectDir, entity.original_file_path);
  }
  return path.join(projectDir, PACKAGES_DIR, entity.package_name, entity.original_file_path);
}

// A node's file only identifies it when nothing else can be declared in that same file. `.sql`
// (models, snapshots, analyses, singular tests) and `.csv` (seeds) hold exactly one node each;
// a `.yml` can declare many (schema tests, and YAML snapshots since dbt 1.9), so mapping one
// back to "the" node it defines would pick an arbitrary one.
const ONE_NODE_PER_FILE_EXTENSIONS = ['.sql', '.csv'];

/** Whether `path` is a file that backs exactly one manifest node — see the note above. */
export function isOneNodePerFilePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return ONE_NODE_PER_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
