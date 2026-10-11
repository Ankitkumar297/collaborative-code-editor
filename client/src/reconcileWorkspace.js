const sameFile = (left, right) => {
  if (!left || !right) return left === right;
  return left.id === right.id && left.name === right.name &&
    left.language === right.language && left.code === right.code;
};

const sameFiles = (left, right) => left.length === right.length &&
  left.every((file, index) => sameFile(file, right[index]));

// Keep server changes by default, replay local-only edits, and report same-file conflicts.
export const reconcileWorkspace = (baselineFiles, localFiles, serverFiles) => {
  if (!Array.isArray(baselineFiles) || !Array.isArray(localFiles) || !Array.isArray(serverFiles)) {
    return { files: serverFiles, hasLocalChanges: false, hasConflicts: false, changedFromServer: false };
  }

  const baseline = new Map(baselineFiles.map((file) => [file.id, file]));
  const local = new Map(localFiles.map((file) => [file.id, file]));
  const server = new Map(serverFiles.map((file) => [file.id, file]));
  const orderedIds = [...new Set([
    ...serverFiles.map((file) => file.id),
    ...localFiles.map((file) => file.id),
    ...baselineFiles.map((file) => file.id),
  ])];
  const merged = [];
  let hasLocalChanges = false;
  let hasConflicts = false;

  for (const id of orderedIds) {
    const baseFile = baseline.get(id) || null;
    const localFile = local.get(id) || null;
    const serverFile = server.get(id) || null;
    const localChanged = !sameFile(localFile, baseFile);
    const serverChanged = !sameFile(serverFile, baseFile);
    if (localChanged) hasLocalChanges = true;

    let selected;
    if (!localChanged) selected = serverFile;
    else if (!serverChanged || sameFile(localFile, serverFile)) selected = localFile;
    else {
      // A conflict keeps the room's current version; the caller saves the local draft separately.
      selected = serverFile;
      hasConflicts = true;
    }
    if (selected) merged.push(selected);
  }

  // A room always needs at least one file. If a concurrent delete would remove everything,
  // preserve the server's current workspace and let the conflict snapshot retain the draft.
  if (!merged.length) {
    return { files: serverFiles, hasLocalChanges, hasConflicts: true, changedFromServer: false };
  }
  return {
    files: merged,
    hasLocalChanges,
    hasConflicts,
    changedFromServer: !sameFiles(merged, serverFiles),
  };
};
