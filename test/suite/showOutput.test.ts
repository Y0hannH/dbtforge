import { strict as assert } from 'assert';
import { test } from 'node:test';
import { ShowOutputError, extractDbtError, parseShowOutput } from '../../src/dbt/showOutput';

test('parseShowOutput: named-node shape (dbt show --select)', () => {
  const stdout = JSON.stringify({
    stg_customers: [
      { customer_id: 1, first_name: 'Ada' },
      { customer_id: 2, first_name: 'Grace' },
    ],
  });

  const table = parseShowOutput(stdout);
  assert.deepEqual(table.columns, ['customer_id', 'first_name']);
  assert.deepEqual(table.rows, [
    [1, 'Ada'],
    [2, 'Grace'],
  ]);
});

test('parseShowOutput: inline shape is a bare array', () => {
  const table = parseShowOutput('[{"x": 1}, {"x": 2}]');
  assert.deepEqual(table.columns, ['x']);
  assert.deepEqual(table.rows, [[1], [2]]);
});

test('parseShowOutput: ignores logging printed around the payload', () => {
  const stdout = [
    '[WARNING]: Deprecated functionality',
    JSON.stringify({ my_model: [{ a: 1 }] }),
    'done.',
  ].join('\n');

  assert.deepEqual(parseShowOutput(stdout).rows, [[1]]);
});

test('parseShowOutput: braces inside string values do not truncate the payload', () => {
  const stdout = JSON.stringify({ m: [{ payload: '{"nested": "}"}', n: 1 }] });

  const table = parseShowOutput(stdout);
  assert.deepEqual(table.columns, ['payload', 'n']);
  assert.deepEqual(table.rows, [['{"nested": "}"}', 1]]);
});

test('parseShowOutput: nulls are preserved and missing keys become null', () => {
  const stdout = JSON.stringify({ m: [{ a: 1, b: null }, { a: 2 }] });

  const table = parseShowOutput(stdout);
  assert.deepEqual(table.columns, ['a', 'b']);
  assert.deepEqual(table.rows, [
    [1, null],
    [2, null],
  ]);
});

test('parseShowOutput: columns appearing only in later rows are still collected', () => {
  const table = parseShowOutput(JSON.stringify({ m: [{ a: 1 }, { a: 2, late: 'x' }] }));
  assert.deepEqual(table.columns, ['a', 'late']);
  assert.deepEqual(table.rows[0], [1, null]);
});

test('parseShowOutput: structs and arrays are rendered as JSON text', () => {
  const table = parseShowOutput(JSON.stringify({ m: [{ tags: ['a', 'b'], meta: { k: 1 } }] }));
  assert.deepEqual(table.rows, [['["a","b"]', '{"k":1}']]);
});

test('parseShowOutput: a zero-row result has no columns to show', () => {
  const table = parseShowOutput(JSON.stringify({ m: [] }));
  assert.deepEqual(table.columns, []);
  assert.deepEqual(table.rows, []);
});

test('parseShowOutput: output with no JSON at all is rejected', () => {
  assert.throws(() => parseShowOutput('Database Error in model m\n  syntax error'), ShowOutputError);
});

test('parseShowOutput: truncated JSON is rejected rather than half-read', () => {
  assert.throws(() => parseShowOutput('{"m": [{"a": 1}'), ShowOutputError);
});

test('extractDbtError: prefers stderr, where a broken venv reports itself', () => {
  const message = extractDbtError('some stdout', 'ModuleNotFoundError: No module named "dbt.adapters"');
  assert.ok(message.includes('ModuleNotFoundError'));
});

test('extractDbtError: falls back to the tail of stdout', () => {
  const message = extractDbtError('compiling...\n\nDatabase Error in model m\n  invalid column\n', '');
  assert.ok(message.includes('Database Error in model m'));
  assert.ok(message.includes('invalid column'));
});

test('extractDbtError: silence still yields something printable', () => {
  assert.ok(extractDbtError('', '  \n \n').length > 0);
});
