import { test } from 'node:test';

import { strict as assert } from 'assert';
import * as path from 'path';

import { savedReferenceDir } from '../../src/state/stateFolderStore';

const ROOT = path.join(path.sep, 'storage', 'ws');

void test('a saved reference lives under the extension storage, never in the project', () => {
  const folder = savedReferenceDir(ROOT, path.join(path.sep, 'work', 'proj'));

  assert.ok(folder.startsWith(path.join(ROOT, 'reference')));
  assert.equal(folder.includes(path.join('work', 'proj')), false);
});

void test('the folder keeps the project name, so it can be recognised', () => {
  assert.match(
    path.basename(savedReferenceDir(ROOT, path.join(path.sep, 'work', 'my_project'))),
    /^my_project-[0-9a-f]{10}$/,
  );
});

void test('two projects with the same folder name get different folders', () => {
  const a = savedReferenceDir(ROOT, path.join(path.sep, 'clients', 'acme', 'dbt'));
  const b = savedReferenceDir(ROOT, path.join(path.sep, 'clients', 'globex', 'dbt'));

  assert.notEqual(a, b);
});

void test('the same project always gets the same folder', () => {
  const project = path.join(path.sep, 'work', 'proj');

  assert.equal(savedReferenceDir(ROOT, project), savedReferenceDir(ROOT, project));
});
