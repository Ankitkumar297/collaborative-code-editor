import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceAllOccurrences, replaceOccurrenceAt, searchFiles } from './fileSearch.js';

const files = [
  { id: 'a', name: 'src/main.js', code: 'const total = 41;\nconsole.log(total);' },
  { id: 'b', name: 'total-guide.md', code: 'A TOTAL example\n' },
];

test('searches file names and code without case sensitivity', () => {
  const results = searchFiles(files, 'total');
  assert.deepEqual(results.map(({ fileId, type, line }) => [fileId, type, line]), [
    ['a', 'code', 0],
    ['a', 'code', 1],
    ['b', 'name', 0],
    ['b', 'code', 0],
  ]);
});

test('returns no results for blank queries and respects the result limit', () => {
  assert.deepEqual(searchFiles(files, '   '), []);
  assert.equal(searchFiles(files, 'total', 2).length, 2);
});

test('replaces literal case-insensitive matches and reports the count', () => {
  assert.deepEqual(replaceAllOccurrences('Cat cat caterpillar', 'cat', 'dog'), {
    text: 'dog dog dogerpillar',
    count: 3,
  });
  assert.deepEqual(replaceAllOccurrences('a.b a.b', 'a.b', '$&'), {
    text: '$& $&',
    count: 2,
  });
});

test('replaces only a selected occurrence when its current text still matches', () => {
  assert.equal(replaceOccurrenceAt('first cat\nsecond cat', 'cat', 'dog', 1, 7), 'first cat\nsecond dog');
  assert.equal(replaceOccurrenceAt('first cat', 'dog', 'fox', 0, 6), null);
});
