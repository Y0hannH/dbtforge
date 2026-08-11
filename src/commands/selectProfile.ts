import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { DbtForgeConfig } from '../config';
import {
  DbtProfileSummary,
  DbtTargetSummary,
  describeSearchedLocations,
  parseProfiles,
  parseProjectProfileName,
  resolveProfilesLocation,
} from '../profiles/profilesFile';
import { ProfileSelection, ProfileStore } from '../profiles/profileStore';

interface ProfileQuickPickItem extends vscode.QuickPickItem {
  profile?: DbtProfileSummary;
}

interface TargetQuickPickItem extends vscode.QuickPickItem {
  target?: DbtTargetSummary;
}

/**
 * Two-step picker over the profiles.yml dbt would use: profile first, then target when the chosen
 * profile has more than one output. Selecting a profile doesn't rewrite profiles.yml — it only
 * decides the `--profile`/`--target` flags dbt Forge passes from then on.
 */
export async function selectProfile(config: DbtForgeConfig, store: ProfileStore): Promise<boolean> {
  const location = await resolveProfilesLocation(config.projectDir, config.profilesDir);
  if (!location) {
    vscode.window.showErrorMessage(
      `dbt Forge: no profiles.yml found. Looked in: ${describeSearchedLocations(config.projectDir, config.profilesDir)}. ` +
        'Set "dbtForge.profilesDir" if it lives somewhere else.'
    );
    return false;
  }

  let profiles: DbtProfileSummary[];
  try {
    profiles = parseProfiles(await fs.readFile(location.filePath, 'utf8'));
  } catch (err) {
    vscode.window.showErrorMessage(`dbt Forge: could not read ${location.filePath} — ${describeError(err)}`);
    return false;
  }
  if (profiles.length === 0) {
    vscode.window.showWarningMessage(`dbt Forge: ${location.filePath} declares no profile.`);
    return false;
  }

  const current = store.get(config.projectDir);
  const defaultProfile = await readProjectProfileName(config.projectDir);

  const pickedProfile = await vscode.window.showQuickPick(
    buildProfileItems(profiles, current, defaultProfile),
    { placeHolder: `Select the dbt profile to run against (${location.filePath})` }
  );
  if (!pickedProfile) return false;

  // "Use profiles.yml default" clears the override entirely, target included: a target only
  // means something relative to a profile.
  if (!pickedProfile.profile) {
    await store.set(config.projectDir, {});
    return true;
  }

  const target = await pickTarget(pickedProfile.profile, current);
  if (target === undefined) return false;

  await store.set(config.projectDir, { profile: pickedProfile.profile.name, target: target || undefined });
  return true;
}

/**
 * Returns the chosen target name, '' for "the profile's own default", or undefined if cancelled.
 * Skipped when there's nothing to choose between.
 */
async function pickTarget(
  profile: DbtProfileSummary,
  current: ProfileSelection
): Promise<string | undefined> {
  if (profile.targets.length <= 1) return '';

  const items: TargetQuickPickItem[] = [
    {
      label: 'Profile default',
      description: profile.defaultTarget ? `target: ${profile.defaultTarget}` : undefined,
      detail: "Don't pass --target; let the profile's own `target:` decide",
    },
    ...profile.targets.map((target) => ({
      label: target.name,
      description: describeTarget(target),
      picked: current.profile === profile.name && current.target === target.name,
      target,
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Select a target in "${profile.name}"`,
  });
  if (!picked) return undefined;
  return picked.target?.name ?? '';
}

function buildProfileItems(
  profiles: DbtProfileSummary[],
  current: ProfileSelection,
  defaultProfile: string | undefined
): ProfileQuickPickItem[] {
  return [
    {
      label: 'Use profiles.yml default',
      description: defaultProfile ? `profile: ${defaultProfile} (from dbt_project.yml)` : undefined,
      detail: 'Run dbt without --profile/--target, exactly as a bare `dbt build` would',
    },
    ...profiles.map((profile) => ({
      label: profile.name,
      description: describeProfile(profile),
      detail: profile.targets.map((target) => target.name).join(', '),
      picked: current.profile === profile.name,
      profile,
    })),
  ];
}

function describeProfile(profile: DbtProfileSummary): string | undefined {
  const defaultTarget = profile.targets.find((target) => target.name === profile.defaultTarget);
  const description = defaultTarget && describeTarget(defaultTarget);
  return profile.defaultTarget
    ? `default target: ${profile.defaultTarget}${description ? ` — ${description}` : ''}`
    : undefined;
}

/** A one-line "which warehouse is this" summary — the Fabric workspace lives in `server`. */
function describeTarget(target: DbtTargetSummary): string | undefined {
  const parts = [target.server, target.database, target.schema].filter(Boolean);
  const location = parts.join(' / ');
  if (target.type && location) return `${target.type}: ${location}`;
  return target.type ?? location ?? undefined;
}

async function readProjectProfileName(projectDir: string): Promise<string | undefined> {
  try {
    return parseProjectProfileName(await fs.readFile(path.join(projectDir, 'dbt_project.yml'), 'utf8'));
  } catch {
    return undefined;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
