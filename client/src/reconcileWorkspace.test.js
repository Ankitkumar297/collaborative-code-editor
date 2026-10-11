import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileWorkspace } from './reconcileWorkspace.js';

const file = (code, id = 'main') => ({ id, name: `${id}.js`, language: 'javascript', code });

test('replays local edits when the server file has not changed', () => {
  const result = reconcileWorkspace([file('base')], [file('local edit')], [file('base')]);
  assert.equal(result.files[0].code, 'local edit');
  assert.equal(result.changedFromServer, true);
  assert.equal(result.hasConflicts, false);
});

test('keeps newer server edits when the local draft has not changed', () => {
  const result = reconcileWorkspace([file('base')], [file('base')], [file('server edit')]);
  assert.equal(result.files[0].code, 'server edit');
  assert.equal(result.hasLocalChanges, false);
});

test('preserves independent edits and reports same-file conflicts', () => {
  const baseline = [file('base'), file('other base', 'other')];
  const local = [file('local edit'), file('local other', 'other')];
  const server = [file('server edit'), file('other base', 'other')];
  const result = reconcileWorkspace(baseline, local, server);
  assert.equal(result.files[0].code, 'server edit');
  assert.equal(result.files[1].code, 'local other');
  assert.equal(result.hasConflicts, true);
  assert.equal(result.changedFromServer, true);
});
