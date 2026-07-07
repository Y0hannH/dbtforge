import { strict as assert } from 'assert';
import { test } from 'node:test';
import { findCallAtPosition, isInsideJinjaTag, parseCompletionContext } from '../../src/sql/jinjaRefParser';

test('parseCompletionContext: ref single-quote prefix', () => {
  const ctx = parseCompletionContext("select * from {{ ref('dim_cus");
  assert.deepEqual(ctx, { kind: 'ref', partial: 'dim_cus' });
});

test('parseCompletionContext: ref double-quote empty prefix', () => {
  const ctx = parseCompletionContext('{{ ref("');
  assert.deepEqual(ctx, { kind: 'ref', partial: '' });
});

test('parseCompletionContext: source name arg', () => {
  const ctx = parseCompletionContext("{{ source('ra");
  assert.deepEqual(ctx, { kind: 'source-name', partial: 'ra' });
});

test('parseCompletionContext: source table arg', () => {
  const ctx = parseCompletionContext("{{ source('raw', 'cust");
  assert.deepEqual(ctx, { kind: 'source-table', sourceName: 'raw', partial: 'cust' });
});

test('parseCompletionContext: not inside a call returns undefined', () => {
  assert.equal(parseCompletionContext('select * from foo'), undefined);
});

test('parseCompletionContext: completed ref call (closing paren) is not a completion context', () => {
  assert.equal(parseCompletionContext("select * from {{ ref('dim_customers') }}"), undefined);
});

test('findCallAtPosition: cursor inside ref() argument', () => {
  const line = "select * from {{ ref('dim_customers') }} c";
  const idx = line.indexOf('dim_customers') + 3;
  const call = findCallAtPosition(line, idx);
  assert.deepEqual(call, {
    kind: 'ref',
    name: 'dim_customers',
    argStart: line.indexOf('dim_customers'),
    argEnd: line.indexOf('dim_customers') + 'dim_customers'.length,
  });
});

test('findCallAtPosition: cursor inside source() first argument', () => {
  const line = "select * from {{ source('raw', 'customers') }}";
  const idx = line.indexOf('raw') + 1;
  const call = findCallAtPosition(line, idx);
  assert.deepEqual(call, {
    kind: 'source',
    sourceName: 'raw',
    tableName: 'customers',
    argStart: line.indexOf('raw'),
    argEnd: line.indexOf('raw') + 'raw'.length,
  });
});

test('findCallAtPosition: cursor inside source() second argument', () => {
  const line = "select * from {{ source('raw', 'customers') }}";
  const idx = line.indexOf('customers') + 2;
  const call = findCallAtPosition(line, idx);
  assert.deepEqual(call, {
    kind: 'source',
    sourceName: 'raw',
    tableName: 'customers',
    argStart: line.indexOf('customers'),
    argEnd: line.indexOf('customers') + 'customers'.length,
  });
});

test('findCallAtPosition: cursor outside any call returns undefined', () => {
  const line = "select * from {{ ref('dim_customers') }} c";
  assert.equal(findCallAtPosition(line, 2), undefined);
});

test('findCallAtPosition: short model name that is a substring of "ref(" resolves to the real argument position', () => {
  const line = "select * from {{ ref('f') }} c";
  const argStart = line.indexOf("'f'") + 1;
  const call = findCallAtPosition(line, argStart);
  assert.deepEqual(call, { kind: 'ref', name: 'f', argStart, argEnd: argStart + 1 });
});

test('isInsideJinjaTag: plain SQL text is not inside a tag', () => {
  assert.equal(isInsideJinjaTag('select * from '), false);
});

test('isInsideJinjaTag: right after an unclosed {{ is inside a tag', () => {
  assert.equal(isInsideJinjaTag('select * from {{ ref'), true);
});

test('isInsideJinjaTag: after a closed }} is not inside a tag', () => {
  assert.equal(isInsideJinjaTag("select * from {{ ref('a') }} "), false);
});

test('findCallAtPosition: source name equal to "source" itself resolves correctly', () => {
  const line = "select * from {{ source('source', 'table') }} c";
  const argStart = line.indexOf("'source'") + 1;
  const call = findCallAtPosition(line, argStart);
  assert.deepEqual(call, {
    kind: 'source',
    sourceName: 'source',
    tableName: 'table',
    argStart,
    argEnd: argStart + 'source'.length,
  });
});
