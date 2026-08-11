import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import {
  parseProfiles,
  parseProjectProfileName,
  resolveProfilesLocation,
} from '../../src/profiles/profilesFile';

const PROFILES_YML = `
config:
  send_anonymous_usage_stats: false

fabric_dev:
  target: dev
  outputs:
    dev:
      type: fabric
      server: dev-ws.datawarehouse.fabric.microsoft.com
      database: analytics_dev
      schema: dbo
    sandbox:
      type: fabric
      server: dev-ws.datawarehouse.fabric.microsoft.com
      database: analytics_sandbox
      schema: dbo

fabric_main:
  target: prod
  outputs:
    prod:
      type: fabric
      server: main-ws.datawarehouse.fabric.microsoft.com
      database: analytics
      schema: dbo
`;

test('parseProfiles: reads every profile with its default target and outputs', () => {
  const profiles = parseProfiles(PROFILES_YML);
  assert.deepEqual(
    profiles.map((p) => p.name),
    ['fabric_dev', 'fabric_main']
  );
  assert.equal(profiles[0].defaultTarget, 'dev');
  assert.deepEqual(
    profiles[0].targets.map((t) => t.name),
    ['dev', 'sandbox']
  );
  assert.deepEqual(profiles[1].targets[0], {
    name: 'prod',
    type: 'fabric',
    server: 'main-ws.datawarehouse.fabric.microsoft.com',
    database: 'analytics',
    schema: 'dbo',
  });
});

test('parseProfiles: the global config block is not a profile', () => {
  assert.equal(
    parseProfiles(PROFILES_YML).find((p) => p.name === 'config'),
    undefined
  );
});

test('parseProfiles: a profile without outputs is kept, with no targets', () => {
  const profiles = parseProfiles('empty_profile:\n  target: dev\n');
  assert.deepEqual(profiles, [{ name: 'empty_profile', defaultTarget: 'dev', targets: [] }]);
});

test('parseProfiles: an empty file yields no profile', () => {
  assert.deepEqual(parseProfiles(''), []);
});

test('parseProfiles: values dbt templates at runtime are kept as written', () => {
  // env_var()/Jinja is resolved by dbt, not here — it just has to survive the parse.
  const profiles = parseProfiles(
    "p:\n  outputs:\n    dev:\n      type: fabric\n      database: \"{{ env_var('DB') }}\"\n"
  );
  assert.equal(profiles[0].targets[0].database, "{{ env_var('DB') }}");
});

test('parseProjectProfileName: reads the profile: key of dbt_project.yml', () => {
  assert.equal(parseProjectProfileName("name: analytics\nprofile: fabric_dev\n"), 'fabric_dev');
  assert.equal(parseProjectProfileName('name: analytics\n'), undefined);
});

test('resolveProfilesLocation: the configured directory wins over the project directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbtforge-profiles-'));
  try {
    const projectDir = path.join(root, 'project');
    const customDir = path.join(root, 'custom');
    await fs.mkdir(projectDir);
    await fs.mkdir(customDir);
    await fs.writeFile(path.join(projectDir, 'profiles.yml'), 'p:\n');
    await fs.writeFile(path.join(customDir, 'profiles.yml'), 'p:\n');

    assert.deepEqual(await resolveProfilesLocation(projectDir, customDir), {
      filePath: path.join(customDir, 'profiles.yml'),
      dir: customDir,
      source: 'setting',
    });
    assert.equal((await resolveProfilesLocation(projectDir, ''))?.source, 'project');
    // A configured directory without a profiles.yml falls through instead of failing outright.
    assert.equal((await resolveProfilesLocation(projectDir, path.join(root, 'nope')))?.source, 'project');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolveProfilesLocation: a relative setting resolves against the project directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbtforge-profiles-'));
  try {
    const envDir = path.join(root, 'envs');
    await fs.mkdir(envDir);
    await fs.writeFile(path.join(envDir, 'profiles.yml'), 'p:\n');

    const location = await resolveProfilesLocation(root, 'envs');
    assert.equal(location?.filePath, path.join(envDir, 'profiles.yml'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
