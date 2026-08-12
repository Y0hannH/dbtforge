import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  findAllMacroCallLocations,
  findAllRefCalls,
  findAllRefCallLocations,
  findAllSourceCalls,
  findAllSourceCallLocations,
  findCallAtPosition,
  findMacroCallAtPosition,
  findMacroDefinitionAtPosition,
  findMacroDefinitionLine,
  isInsideJinjaExpression,
  isInsideJinjaTag,
  parseCompletionContext,
} from '../../src/sql/jinjaRefParser';

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
    packageName: undefined,
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
  assert.deepEqual(call, {
    kind: 'ref',
    name: 'f',
    packageName: undefined,
    argStart,
    argEnd: argStart + 1,
  });
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

test('findAllRefCalls: finds every ref() call on a line regardless of model name', () => {
  const line = "select * from {{ ref('a') }} join {{ ref('b') }}";
  const calls = findAllRefCalls(line);
  assert.deepEqual(
    calls.map((c) => c.name),
    ['a', 'b']
  );
});

test('findAllRefCalls: no calls returns empty array', () => {
  assert.deepEqual(findAllRefCalls('select 1'), []);
});

test('findAllSourceCalls: finds every source() call on a line regardless of names', () => {
  const line = "select * from {{ source('raw', 'a') }} join {{ source('raw', 'b') }}";
  const calls = findAllSourceCalls(line);
  assert.deepEqual(
    calls.map((c) => [c.sourceName, c.tableName]),
    [
      ['raw', 'a'],
      ['raw', 'b'],
    ]
  );
});

test('findAllSourceCalls: no calls returns empty array', () => {
  assert.deepEqual(findAllSourceCalls('select 1'), []);
});

test('findAllRefCallLocations: finds every ref() call to the given model on a line', () => {
  const line = "select * from {{ ref('a') }} join {{ ref('b') }} on {{ ref('a') }}.id = 1";
  const locations = findAllRefCallLocations(line, 'a');
  assert.equal(locations.length, 2);
  for (const loc of locations) {
    assert.equal(line.slice(loc.start, loc.end), 'a');
  }
});

test('findAllRefCallLocations: returns empty array when the model is not referenced', () => {
  const line = "select * from {{ ref('a') }}";
  assert.deepEqual(findAllRefCallLocations(line, 'b'), []);
});

test('findAllSourceCallLocations: finds every source() call to (sourceName, tableName), pointing at the table arg', () => {
  const line = "select * from {{ source('raw', 'customers') }} c";
  const locations = findAllSourceCallLocations(line, 'raw', 'customers');
  assert.equal(locations.length, 1);
  assert.equal(line.slice(locations[0].start, locations[0].end), 'customers');
});

test('findAllSourceCallLocations: does not match a different table under the same source', () => {
  const line = "select * from {{ source('raw', 'orders') }} c";
  assert.deepEqual(findAllSourceCallLocations(line, 'raw', 'customers'), []);
});

test('findAllMacroCallLocations: finds a bare macro call', () => {
  const line = '{{ generate_surrogate_key(["id"]) }}';
  const locations = findAllMacroCallLocations(line, 'generate_surrogate_key');
  assert.equal(locations.length, 1);
  assert.equal(line.slice(locations[0].start, locations[0].end), 'generate_surrogate_key');
});

test('findAllMacroCallLocations: finds a namespaced macro call, span excludes the package prefix', () => {
  const line = '{{ dbt_utils.generate_surrogate_key(["id"]) }}';
  const locations = findAllMacroCallLocations(line, 'generate_surrogate_key');
  assert.equal(locations.length, 1);
  const start = line.indexOf('generate_surrogate_key');
  assert.deepEqual(locations[0], { start, end: start + 'generate_surrogate_key'.length });
});

test('findMacroCallAtPosition: cursor on a bare macro call name', () => {
  const line = '{{ my_macro(1, 2) }}';
  const idx = line.indexOf('my_macro') + 2;
  assert.deepEqual(findMacroCallAtPosition(line, idx), {
    name: 'my_macro',
    packageName: undefined,
    start: line.indexOf('my_macro'),
    end: line.indexOf('my_macro') + 'my_macro'.length,
  });
});

test('findMacroCallAtPosition: identifier not followed by "(" is not a call', () => {
  const line = '{{ some_var }}';
  const idx = line.indexOf('some_var') + 2;
  assert.equal(findMacroCallAtPosition(line, idx), undefined);
});

test('findMacroDefinitionAtPosition: cursor on the macro name in a definition line', () => {
  const line = "{% macro generate_surrogate_key(field_list) %}";
  const idx = line.indexOf('generate_surrogate_key') + 2;
  assert.deepEqual(findMacroDefinitionAtPosition(line, idx), {
    name: 'generate_surrogate_key',
    start: line.indexOf('generate_surrogate_key'),
    end: line.indexOf('generate_surrogate_key') + 'generate_surrogate_key'.length,
  });
});

test('findMacroDefinitionAtPosition: not a definition line returns undefined', () => {
  assert.equal(findMacroDefinitionAtPosition('{{ generate_surrogate_key(x) }}', 5), undefined);
});

test('findCallAtPosition: cross-package ref("package", "model") resolves to the model name', () => {
  const line = "select * from {{ ref('other_project', 'dim_customers') }} c";
  const idx = line.indexOf('dim_customers') + 3;
  assert.deepEqual(findCallAtPosition(line, idx), {
    kind: 'ref',
    name: 'dim_customers',
    packageName: 'other_project',
    argStart: line.indexOf('dim_customers'),
    argEnd: line.indexOf('dim_customers') + 'dim_customers'.length,
  });
});

test('findCallAtPosition: ref() with a version kwarg still resolves', () => {
  const line = "select * from {{ ref('dim_customers', version=2) }} c";
  const idx = line.indexOf('dim_customers') + 3;
  const call = findCallAtPosition(line, idx);
  assert.equal(call?.kind, 'ref');
  assert.equal(call?.kind === 'ref' ? call.name : undefined, 'dim_customers');
});

test('findAllRefCallLocations: finds cross-package and versioned call shapes', () => {
  const line = "{{ ref('pkg', 'a') }} {{ ref('a', version=2) }} {{ ref('a') }}";
  assert.equal(findAllRefCallLocations(line, 'a').length, 3);
  for (const loc of findAllRefCallLocations(line, 'a')) {
    assert.equal(line.slice(loc.start, loc.end), 'a');
  }
});

test('findAllRefCallLocations: an identifier merely ending in "ref" is not a ref() call', () => {
  assert.deepEqual(findAllRefCallLocations("{{ my_ref('a') }}", 'a'), []);
});

test('findAllRefCallLocations: an explicit package that differs is not a call site', () => {
  const line = "{{ ref('other_pkg', 'a') }}";
  assert.deepEqual(findAllRefCallLocations(line, 'a', 'my_project'), []);
  assert.equal(findAllRefCallLocations(line, 'a', 'other_pkg').length, 1);
});

test('findAllMacroCallLocations: a SQL function of the same name outside a Jinja tag is not a call site', () => {
  // dbt-core ships macros named after SQL functions, so this is the common false positive.
  assert.deepEqual(findAllMacroCallLocations("select replace(name, 'a', 'b') from t", 'replace'), []);
  assert.equal(findAllMacroCallLocations("select {{ replace(x, 'a', 'b') }} from t", 'replace').length, 1);
});

test('findAllMacroCallLocations: a namespaced call from another package is not a call site', () => {
  const line = '{{ spark_utils.star(from=ref("a")) }}';
  assert.deepEqual(findAllMacroCallLocations(line, 'star', 'dbt_utils'), []);
  assert.equal(findAllMacroCallLocations(line, 'star', 'spark_utils').length, 1);
});

test('findAllMacroCallLocations: macro calls inside a {% %} statement tag count', () => {
  const line = '{% set key = generate_surrogate_key(["id"]) %}';
  assert.equal(findAllMacroCallLocations(line, 'generate_surrogate_key').length, 1);
});

test('findMacroCallAtPosition: a SQL function call outside a Jinja tag is not a macro call', () => {
  const line = "select replace(name, 'a', 'b') from t";
  assert.equal(findMacroCallAtPosition(line, line.indexOf('replace') + 2), undefined);
});

test('findMacroCallAtPosition: namespaced call reports the package', () => {
  const line = '{{ dbt_utils.star(from=ref("a")) }}';
  assert.deepEqual(findMacroCallAtPosition(line, line.indexOf('star') + 1), {
    name: 'star',
    packageName: 'dbt_utils',
    start: line.indexOf('star'),
    end: line.indexOf('star') + 'star'.length,
  });
});

test('isInsideJinjaExpression: statement tags count, closed tags do not', () => {
  assert.equal(isInsideJinjaExpression('{% set x = '), true);
  assert.equal(isInsideJinjaExpression('{% set x = 1 %} select '), false);
  assert.equal(isInsideJinjaExpression('select '), false);
});

test('findMacroDefinitionLine: finds the right macro in a multi-macro file', () => {
  const lines = [
    '{% macro first(a) %}',
    '  select 1',
    '{% endmacro %}',
    '',
    '{%- macro second(b) -%}',
    '  select 2',
    '{% endmacro %}',
  ];
  assert.equal(findMacroDefinitionLine(lines, 'first'), 0);
  assert.equal(findMacroDefinitionLine(lines, 'second'), 4);
  assert.equal(findMacroDefinitionLine(lines, 'missing'), undefined);
});
