import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';

export interface DbtTargetSummary {
  name: string;
  type?: string;
  /** Fabric/Synapse put the workspace behind `server`; other adapters leave it empty. */
  server?: string;
  database?: string;
  schema?: string;
}

export interface DbtProfileSummary {
  name: string;
  /** The profile's own `target:` key — used when no target is selected explicitly. */
  defaultTarget?: string;
  targets: DbtTargetSummary[];
}

export type ProfilesSource = 'setting' | 'env' | 'project' | 'home';

export interface ProfilesLocation {
  filePath: string;
  dir: string;
  source: ProfilesSource;
}

// `config:` is dbt's global block (send_anonymous_usage_stats & co), not a profile.
const NON_PROFILE_KEYS = new Set(['config']);

/**
 * Profiles declared in a profiles.yml, with just enough of each target to tell them apart in a
 * picker. Throws if the YAML is malformed; unexpected-but-parseable shapes are skipped rather
 * than rejected, since profiles.yml routinely holds keys this doesn't model.
 */
export function parseProfiles(yamlText: string): DbtProfileSummary[] {
  const doc = parseYaml(yamlText);
  if (!isRecord(doc)) return [];

  const profiles: DbtProfileSummary[] = [];
  for (const [name, value] of Object.entries(doc)) {
    if (NON_PROFILE_KEYS.has(name) || !isRecord(value)) continue;

    const outputs = isRecord(value.outputs) ? value.outputs : {};
    profiles.push({
      name,
      defaultTarget: typeof value.target === 'string' ? value.target : undefined,
      targets: Object.entries(outputs)
        .filter(([, output]) => isRecord(output))
        .map(([targetName, output]) => ({
          name: targetName,
          type: asString((output as Record<string, unknown>).type),
          server: asString((output as Record<string, unknown>).server),
          database: asString((output as Record<string, unknown>).database),
          schema: asString((output as Record<string, unknown>).schema),
        })),
    });
  }
  return profiles;
}

/** The `profile:` key of a dbt_project.yml — the profile dbt uses when none is forced. */
export function parseProjectProfileName(yamlText: string): string | undefined {
  const doc = parseYaml(yamlText);
  return isRecord(doc) ? asString(doc.profile) : undefined;
}

/**
 * Finds the profiles.yml dbt would use, in dbt's own precedence order: an explicit setting, then
 * DBT_PROFILES_DIR, then the project directory (dbt reads its working directory before falling
 * back), then ~/.dbt. Returns undefined when none of them holds a profiles.yml.
 */
export async function resolveProfilesLocation(
  projectDir: string,
  configuredDir: string
): Promise<ProfilesLocation | undefined> {
  const candidates: Array<{ dir: string; source: ProfilesSource }> = [];
  if (configuredDir) {
    candidates.push({
      dir: path.isAbsolute(configuredDir) ? configuredDir : path.join(projectDir, configuredDir),
      source: 'setting',
    });
  }
  if (process.env.DBT_PROFILES_DIR) {
    candidates.push({ dir: process.env.DBT_PROFILES_DIR, source: 'env' });
  }
  candidates.push({ dir: projectDir, source: 'project' });
  candidates.push({ dir: path.join(os.homedir(), '.dbt'), source: 'home' });

  for (const candidate of candidates) {
    const filePath = path.join(candidate.dir, 'profiles.yml');
    if (await exists(filePath)) return { filePath, dir: candidate.dir, source: candidate.source };
  }
  return undefined;
}

/** Every directory searched by resolveProfilesLocation, for error messages. */
export function describeSearchedLocations(projectDir: string, configuredDir: string): string {
  const dirs = [configuredDir, process.env.DBT_PROFILES_DIR, projectDir, path.join(os.homedir(), '.dbt')];
  return dirs.filter((dir): dir is string => Boolean(dir)).join(', ');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
