export const searchFiles = (files, rawQuery, limit = 200) => {
  const query = String(rawQuery || '').trim();
  if (!query) return [];

  const normalizedQuery = query.toLocaleLowerCase();
  const results = [];
  files.forEach((file) => {
    const nameIndex = file.name.toLocaleLowerCase().indexOf(normalizedQuery);
    if (nameIndex >= 0 && results.length < limit) {
      results.push({
        fileId: file.id,
        fileName: file.name,
        type: 'name',
        line: 0,
        column: nameIndex,
        excerpt: file.name,
        matchIndex: 0,
      });
    }

    let matchIndex = 0;
    const lines = String(file.code || '').split('\n');
    for (let line = 0; line < lines.length && results.length < limit; line += 1) {
      const text = lines[line];
      const lowerText = text.toLocaleLowerCase();
      let column = 0;
      while (column <= lowerText.length - normalizedQuery.length && results.length < limit) {
        const foundAt = lowerText.indexOf(normalizedQuery, column);
        if (foundAt < 0) break;
        results.push({
          fileId: file.id,
          fileName: file.name,
          type: 'code',
          line,
          column: foundAt,
          excerpt: text.trim() || text,
          matchIndex,
        });
        matchIndex += 1;
        column = foundAt + Math.max(normalizedQuery.length, 1);
      }
    }
  });
  return results;
};

export const replaceAllOccurrences = (source, rawQuery, replacement) => {
  const text = String(source || '');
  const query = String(rawQuery || '');
  if (!query) return { text, count: 0 };

  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const pieces = [];
  let cursor = 0;
  let count = 0;
  while (cursor <= lowerText.length - lowerQuery.length) {
    const foundAt = lowerText.indexOf(lowerQuery, cursor);
    if (foundAt < 0) break;
    pieces.push(text.slice(cursor, foundAt), String(replacement ?? ''));
    cursor = foundAt + lowerQuery.length;
    count += 1;
  }
  if (!count) return { text, count };
  pieces.push(text.slice(cursor));
  return { text: pieces.join(''), count };
};

export const replaceOccurrenceAt = (source, rawQuery, replacement, line, column) => {
  const text = String(source || '');
  const query = String(rawQuery || '');
  const lines = text.split('\n');
  if (!query || line < 0 || line >= lines.length || column < 0) return null;
  const offset = lines.slice(0, line).reduce((total, current) => total + current.length + 1, 0) + column;
  if (text.slice(offset, offset + query.length).toLocaleLowerCase() !== query.toLocaleLowerCase()) return null;
  return `${text.slice(0, offset)}${String(replacement ?? '')}${text.slice(offset + query.length)}`;
};
