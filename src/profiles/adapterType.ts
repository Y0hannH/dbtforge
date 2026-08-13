import * as fs from 'fs/promises';
import * as path from 'path';
import { ProfileSelection } from './profileStore';
import { parseProfiles, parseProjectProfileName, resolveProfilesLocation } from './profilesFile';

/**
 * The adapter backing the environment dbt commands currently run against (`fabric`, `sqlserver`,
 * `postgres`, …), resolved the way dbt resolves it: the forced profile/target when one is selected,
 * otherwise dbt_project.yml's `profile:` and the profile's own `target:`.
 *
 * Undefined whenever the answer isn't certain — no profiles.yml, an ambiguous profile, a target
 * without a `type`. Callers use this to opt *into* adapter-specific behaviour, so being unsure has
 * to mean "treat it as an ordinary adapter", never "guess Microsoft".
 */
export async function resolveAdapterType(
  projectDir: string,
  configuredProfilesDir: string,
  selection: ProfileSelection
): Promise<string | undefined> {
  const location = await resolveProfilesLocation(projectDir, configuredProfilesDir);
  if (!location) return undefined;

  const profiles = await readProfiles(location.filePath);
  if (!profiles) return undefined;

  const profileName = selection.profile ?? (await readProjectProfileName(projectDir));
  const profile =
    profiles.find((candidate) => candidate.name === profileName) ??
    (profiles.length === 1 ? profiles[0] : undefined);
  if (!profile) return undefined;

  const targetName = selection.target ?? profile.defaultTarget;
  const target =
    profile.targets.find((candidate) => candidate.name === targetName) ??
    (profile.targets.length === 1 ? profile.targets[0] : undefined);

  return target?.type;
}

async function readProfiles(filePath: string): Promise<ReturnType<typeof parseProfiles> | undefined> {
  try {
    return parseProfiles(await fs.readFile(filePath, 'utf8'));
  } catch {
    return undefined; // unreadable or malformed: not a reason to fail a preview
  }
}

async function readProjectProfileName(projectDir: string): Promise<string | undefined> {
  try {
    return parseProjectProfileName(await fs.readFile(path.join(projectDir, 'dbt_project.yml'), 'utf8'));
  } catch {
    return undefined;
  }
}
