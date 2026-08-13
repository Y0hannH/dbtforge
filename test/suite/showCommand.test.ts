import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  DEFAULT_ROW_LIMIT,
  NO_ROW_LIMIT,
  buildShowArgs,
  checkCommandLineLength,
  normalizeRowLimit,
} from '../../src/dbt/showCommand';

const NO_OPTIONS = { rowLimit: DEFAULT_ROW_LIMIT, profileArgs: [], profilesDir: '' };

test('buildShowArgs: selects a node and asks for JSON', () => {
  const args = buildShowArgs({ kind: 'node', name: 'stg_customers' }, NO_OPTIONS);

  assert.deepEqual(args, [
    '--quiet',
    '--no-use-colors',
    'show',
    '--output',
    'json',
    '--limit',
    '100',
    '--select',
    'stg_customers',
  ]);
});

test('buildShowArgs: global flags precede the subcommand', () => {
  const args = buildShowArgs({ kind: 'node', name: 'm' }, NO_OPTIONS);
  assert.ok(args.indexOf('--quiet') < args.indexOf('show'));
  assert.ok(args.indexOf('--no-use-colors') < args.indexOf('show'));
});

test('buildShowArgs: inline SQL is passed as one argument, never as --select', () => {
  const sql = "with a as (select 1 as x from {{ ref('t') }}) select * from a";
  const args = buildShowArgs({ kind: 'inline', sql }, NO_OPTIONS);

  assert.ok(!args.includes('--select'));
  assert.equal(args[args.indexOf('--inline') + 1], sql);
});

test('buildShowArgs: carries the selected environment and profiles dir', () => {
  const args = buildShowArgs(
    { kind: 'node', name: 'm' },
    { rowLimit: 10, profileArgs: ['--target', 'dev'], profilesDir: 'C:/dbt profiles' }
  );

  assert.deepEqual(args.slice(-4), ['--target', 'dev', '--profiles-dir', 'C:/dbt profiles']);
});

test('buildShowArgs: an unset profiles dir is omitted rather than passed empty', () => {
  const args = buildShowArgs({ kind: 'node', name: 'm' }, NO_OPTIONS);
  assert.ok(!args.includes('--profiles-dir'));
});

test('normalizeRowLimit: keeps positive integers and dbt\'s -1 sentinel', () => {
  assert.equal(normalizeRowLimit(50), 50);
  assert.equal(normalizeRowLimit(NO_ROW_LIMIT), NO_ROW_LIMIT);
});

test('normalizeRowLimit: nonsense falls back to the default', () => {
  assert.equal(normalizeRowLimit(0), DEFAULT_ROW_LIMIT);
  assert.equal(normalizeRowLimit(-5), DEFAULT_ROW_LIMIT);
  assert.equal(normalizeRowLimit(12.5), DEFAULT_ROW_LIMIT);
  assert.equal(normalizeRowLimit(NaN), DEFAULT_ROW_LIMIT);
});

test('checkCommandLineLength: ordinary queries pass on every platform', () => {
  const args = buildShowArgs({ kind: 'inline', sql: 'select * from a' }, NO_OPTIONS);
  assert.equal(checkCommandLineLength('dbt.exe', args, 'win32'), undefined);
  assert.equal(checkCommandLineLength('dbt', args, 'linux'), undefined);
});

test('checkCommandLineLength: an oversized inline query is rejected on Windows only', () => {
  const args = buildShowArgs({ kind: 'inline', sql: 'x'.repeat(40_000) }, NO_OPTIONS);

  const reason = checkCommandLineLength('dbt.exe', args, 'win32');
  assert.ok(reason?.includes('too long'));
  assert.equal(checkCommandLineLength('dbt', args, 'linux'), undefined);
});
