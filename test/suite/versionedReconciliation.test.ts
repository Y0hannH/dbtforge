import { test } from 'node:test';

import { strict as assert } from 'assert';

import { reconcileColumns } from '../../src/yaml/columnReconciliation';
import { parseSchemaEntities } from '../../src/yaml/schemaColumns';

const SCHEMA = `models:
  - name: dim_customers
    columns:
      - name: customer_id
      - name: legacy_flag
    versions:
      - v: 1
        columns:
          - name: name
          - name: nickname
      - v: 2
        columns:
          - include: all
            exclude: [name]
          - name: full_name
`;

// What each version's table really has.
const REAL: Record<string, string[]> = {
  '1': ['customer_id', 'name'],
  '2': ['customer_id', 'full_name', 'country_code'],
};

const off = { flagUndocumented: false };
const on = { flagUndocumented: true };

function catalog(real: Record<string, string[] | undefined> = REAL) {
  return (_entity: unknown, version?: string) => (version ? real[version] : undefined);
}

void test('parseSchemaEntities reads versions, their columns, and skips include/exclude', () => {
  const [entity] = parseSchemaEntities(SCHEMA);

  assert.deepEqual(
    entity.columns.map((c) => c.name),
    ['customer_id', 'legacy_flag'],
  );
  assert.deepEqual(
    entity.versions?.map((v) => ({ version: v.version, columns: v.columns.map((c) => c.name) })),
    [
      { version: '1', columns: ['name', 'nickname'] },
      { version: '2', columns: ['full_name'] },
    ],
  );
});

void test('a version written as a string is read as text, not dropped', () => {
  const [entity] = parseSchemaEntities(`models:
  - name: m
    versions:
      - v: "2024-01"
      - v: 3
`);

  assert.deepEqual(
    entity.versions?.map((v) => v.version),
    ['2024-01', '3'],
  );
});

void test('a model with no versions has no versions key', () => {
  const [entity] = parseSchemaEntities('models:\n  - name: m\n    columns:\n      - name: a\n');

  assert.equal('versions' in entity, false);
});

void test('a column under a version is checked against that version’s own table', () => {
  const findings = reconcileColumns(parseSchemaEntities(SCHEMA), catalog(), off);
  const messages = findings.map((f) => f.message);

  // `nickname` is under v1, and v1's table has no such column.
  assert.ok(messages.some((m) => /"dim_customers v1" has no column "nickname"/.test(m)));
  // `name` exists in v1 (where it is listed) and not in v2 — which doesn't list it.
  assert.equal(
    messages.some((m) => /"name"/.test(m)),
    false,
  );
  // `full_name` exists in v2, where it is listed.
  assert.equal(
    messages.some((m) => /full_name/.test(m)),
    false,
  );
});

void test('a top-level column is only wrong when no version has it', () => {
  const findings = reconcileColumns(parseSchemaEntities(SCHEMA), catalog(), off);
  const messages = findings.map((f) => f.message);

  // `legacy_flag` is in neither table.
  assert.ok(messages.some((m) => /no column "legacy_flag" in any of its versions/.test(m)));
  // `customer_id` is in both; `name` is not top-level.
  assert.equal(
    messages.some((m) => /customer_id/.test(m)),
    false,
  );
});

void test('a top-level column one version lacks is not an error, that is what exclude is for', () => {
  const text = `models:
  - name: m
    columns:
      - name: only_in_v1
    versions:
      - v: 1
      - v: 2
`;
  const findings = reconcileColumns(
    parseSchemaEntities(text),
    catalog({ '1': ['only_in_v1'], '2': ['other'] }),
    off,
  );

  assert.deepEqual(findings, []);
});

void test('a top-level column is not judged while any version’s table is unknown', () => {
  // v2 was never built: it might be the one that has `legacy_flag`.
  const findings = reconcileColumns(
    parseSchemaEntities(SCHEMA),
    catalog({ '1': REAL['1'], '2': undefined }),
    off,
  );

  assert.equal(
    findings.some((f) => /legacy_flag/.test(f.message)),
    false,
  );
});

void test('undocumented columns are named per version, counting the shared top-level ones', () => {
  const findings = reconcileColumns(parseSchemaEntities(SCHEMA), catalog(), on);
  const undocumented = findings.filter((f) => f.kind === 'undocumented-columns');

  // v1: customer_id is shared, name is its own → nothing missing. v2: country_code is missing.
  assert.equal(undocumented.length, 1);
  assert.match(undocumented[0].message, /"dim_customers v2"/);
  assert.match(undocumented[0].message, /country_code/);
});

void test('a column documented twice under one version is caught under that version', () => {
  const text = `models:
  - name: m
    versions:
      - v: 1
        columns:
          - name: a
          - name: a
`;
  const findings = reconcileColumns(parseSchemaEntities(text), catalog({ '1': ['a'] }), off);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'duplicate-column');
  assert.match(findings[0].message, /"m v1"/);
});
