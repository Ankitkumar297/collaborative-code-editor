export const normalizeProjectPath = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\\/g, '/');
  const parts = normalized.split('/');
  const invalidPart = (part) => part.length > 80 || /[<>:"|?*]/.test(part) ||
    Array.from(part).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    });
  if (!normalized || normalized.length > 240 || normalized.startsWith('/') ||
      /^[a-z]:/i.test(normalized) || parts.some((part) => !part || part === '.' || part === '..' ||
        invalidPart(part))) return null;
  return parts.join('/');
};

export const pathConflictsWithFiles = (candidate, files) => {
  const normalizedCandidate = candidate.toLowerCase();
  return files.some((file) => {
    const existing = file.name.toLowerCase();
    return existing === normalizedCandidate || existing.startsWith(`${normalizedCandidate}/`) ||
      normalizedCandidate.startsWith(`${existing}/`);
  });
};

export const buildFileTree = (files) => {
  const root = { folders: new Map(), files: [] };
  files.forEach((file) => {
    const parts = file.name.replace(/\\/g, '/').split('/');
    let current = root;
    let folderPath = '';
    parts.slice(0, -1).forEach((part) => {
      folderPath = folderPath ? `${folderPath}/${part}` : part;
      if (!current.folders.has(part)) {
        current.folders.set(part, { name: part, path: folderPath, folders: new Map(), files: [] });
      }
      current = current.folders.get(part);
    });
    current.files.push(file);
  });

  const sortNode = (node) => ({
    ...(node.name ? { name: node.name, path: node.path } : {}),
    folders: Array.from(node.folders.values())
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      .map(sortNode),
    files: [...node.files].sort((left, right) => {
      const leftName = left.name.split('/').pop();
      const rightName = right.name.split('/').pop();
      return leftName.localeCompare(rightName, undefined, { sensitivity: 'base' });
    }),
  });

  return sortNode(root);
};
