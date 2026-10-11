import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFileTree, normalizeProjectPath, pathConflictsWithFiles } from './fileTree.js';

const file = (name) => ({ id: name, name, language: 'javascript', code: '' });

test('normalizes relative nested paths and rejects traversal or invalid names', () => {
  assert.equal(normalizeProjectPath('src\\utils\\index.js'), 'src/utils/index.js');
  assert.equal(normalizeProjectPath('../secret.js'), null);
  assert.equal(normalizeProjectPath('/root.js'), null);
  assert.equal(normalizeProjectPath('src/'), null);
});

test('rejects collisions between files and folders', () => {
  assert.equal(pathConflictsWithFiles('src/main.js', [file('src')]), true);
  assert.equal(pathConflictsWithFiles('src', [file('src/main.js')]), true);
  assert.equal(pathConflictsWithFiles('src/main.js', [file('src/app.js')]), false);
});

test('groups nested files in a stable tree', () => {
  const tree = buildFileTree([file('src/z.js'), file('README.md'), file('src/lib/a.js')]);
  assert.deepEqual(tree.folders[0].name, 'src');
  assert.deepEqual(tree.folders[0].folders[0].name, 'lib');
  assert.deepEqual(tree.files.map((entry) => entry.name), ['README.md']);
});
