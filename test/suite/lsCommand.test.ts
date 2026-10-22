import { test } from 'node:test';

import { strict as assert } from 'assert';

import {
  buildLsArgs,
  parseLsOutput,
  SelectorSyntaxError,
  splitSelector,
} from '../../src/dbt/lsCommand';

const NO_OPTIONS = { exclude: '', profileArgs: [], profilesDir: '' };

void test('buildLsArgs: selects and asks for JSON, global flags before the subcommand', () => {
  const args = buildLsArgs({ select: '3+orders+1', ...NO_OPTIONS });

  assert.deepEqual(args, [
    '--quiet',
    '--no-use-colors',
    'ls',
    '--output',
    'json',
    '--select',
    '3+orders+1',
  ]);
  assert.ok(args.indexOf('--quiet') < args.indexOf('ls'));
});

void test('buildLsArgs: a union is several arguments, an intersection stays one', () => {
  const args = buildLsArgs({
    select: 'tag:nightly  orders,config.materialized:table',
    ...NO_OPTIONS,
  });

  assert.deepEqual(args.slice(args.indexOf('--select') + 1), [
    'tag:nightly',
    'orders,config.materialized:table',
  ]);
});

void test('buildLsArgs: --exclude is only passed when there is something to exclude', () => {
  assert.equal(buildLsArgs({ select: 'a', ...NO_OPTIONS }).includes('--exclude'), false);

  const args = buildLsArgs({ select: 'a', ...NO_OPTIONS, exclude: 'tag:old b' });
  assert.deepEqual(args.slice(args.indexOf('--exclude') + 1), ['tag:old', 'b']);
});

void test('buildLsArgs: carries the selected profile and the profiles directory', () => {
  const args = buildLsArgs({
    select: 'a',
    exclude: '',
    profileArgs: ['--profile', 'p', '--target', 'dev'],
    profilesDir: 'C:/profiles',
  });

  assert.deepEqual(args.slice(-6), [
    '--profile',
    'p',
    '--target',
    'dev',
    '--profiles-dir',
    'C:/profiles',
  ]);
});

void test('buildLsArgs: an empty selection is refused rather than listing the whole project', () => {
  assert.throws(() => buildLsArgs({ select: '   ', ...NO_OPTIONS }), SelectorSyntaxError);
});

void test('splitSelector: a term that dbt would read as one of its own options is refused', () => {
  assert.throws(() => splitSelector('orders --target prod'), SelectorSyntaxError);
  assert.throws(() => splitSelector('-x'), SelectorSyntaxError);
  assert.throws(
    () => buildLsArgs({ select: 'a', ...NO_OPTIONS, exclude: '--vars' }),
    SelectorSyntaxError,
  );
});

void test('splitSelector: a "-" inside a term is an ordinary character', () => {
  assert.deepEqual(splitSelector('my-model'), ['my-model']);
});

void test('parseLsOutput: reads the unique_id of each JSON line, once, in order', () => {
  const stdout = [
    '{"name": "orders", "unique_id": "model.pkg.orders", "resource_type": "model"}',
    '{"name": "customers", "unique_id": "model.pkg.customers"}',
    '{"name": "orders", "unique_id": "model.pkg.orders"}',
  ].join('\n');

  assert.deepEqual(parseLsOutput(stdout), ['model.pkg.orders', 'model.pkg.customers']);
});

void test('parseLsOutput: ignores whatever on stdout is not a node', () => {
  const stdout = [
    'Running with dbt=1.8.0',
    '{"unique_id": "model.pkg.a"}',
    '{"broken": ',
    '{"no_id": true}',
    '{"unique_id": 7}',
    '',
    '   {"unique_id": "model.pkg.b"}   ',
  ].join('\r\n');

  assert.deepEqual(parseLsOutput(stdout), ['model.pkg.a', 'model.pkg.b']);
});

void test('parseLsOutput: no output is no nodes', () => {
  assert.deepEqual(parseLsOutput(''), []);
});
