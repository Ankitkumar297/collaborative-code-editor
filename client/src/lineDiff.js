const MAX_DIFF_CELLS = 250_000;

const getLines = (text) => String(text ?? '').split('\n');

const simpleLineDiff = (before, after) => {
  const count = Math.max(before.length, after.length);
  return Array.from({ length: count }, (_, index) => {
    const left = index < before.length ? { number: index + 1, text: before[index] } : null;
    const right = index < after.length ? { number: index + 1, text: after[index] } : null;
    const type = !left ? 'added' : !right ? 'removed' : left.text === right.text ? 'same' : 'changed';
    return { type, left, right };
  });
};

export const createLineDiff = (beforeText, afterText) => {
  const before = getLines(beforeText);
  const after = getLines(afterText);
  if ((before.length + 1) * (after.length + 1) > MAX_DIFF_CELLS) {
    return { rows: simpleLineDiff(before, after), simplified: true };
  }

  const columns = after.length + 1;
  const table = new Uint32Array((before.length + 1) * columns);
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      const index = left * columns + right;
      table[index] = before[left] === after[right]
        ? table[(left + 1) * columns + right + 1] + 1
        : Math.max(table[(left + 1) * columns + right], table[index + 1]);
    }
  }

  const rows = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) {
      rows.push({
        type: 'same',
        left: { number: left + 1, text: before[left] },
        right: { number: right + 1, text: after[right] },
      });
      left += 1;
      right += 1;
    } else if (left < before.length &&
        (right >= after.length || table[(left + 1) * columns + right] >= table[left * columns + right + 1])) {
      rows.push({ type: 'removed', left: { number: left + 1, text: before[left] }, right: null });
      left += 1;
    } else {
      rows.push({ type: 'added', left: null, right: { number: right + 1, text: after[right] } });
      right += 1;
    }
  }
  return { rows, simplified: false };
};
