const ROOMS_KEY = 'codecollab:saved-rooms:v1';
const WORKSPACE_PREFIX = 'codecollab:workspace:';
const SNAPSHOTS_PREFIX = 'codecollab:snapshots:';
const MAX_SAVED_ROOMS = 20;
const MAX_SNAPSHOTS_PER_ROOM = 20;

const readJson = (key, fallback) => {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const isValidFiles = (files) => Array.isArray(files) && files.length > 0 && files.every((file) =>
  file && typeof file.id === 'string' && typeof file.name === 'string' &&
  typeof file.language === 'string' && typeof file.code === 'string'
);

const writeJson = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const getSavedRooms = () => {
  const rooms = readJson(ROOMS_KEY, []);
  return Array.isArray(rooms)
    ? rooms.filter((room) => room && typeof room.roomId === 'string')
    : [];
};

export const saveRoom = (roomId, username) => {
  if (typeof roomId !== 'string' || !roomId.trim()) return false;
  const normalizedId = roomId.trim();
  const rooms = getSavedRooms().filter((room) => room.roomId !== normalizedId);
  rooms.unshift({
    roomId: normalizedId,
    username: typeof username === 'string' ? username.trim().slice(0, 32) : '',
    lastJoinedAt: new Date().toISOString(),
  });
  return writeJson(ROOMS_KEY, rooms.slice(0, MAX_SAVED_ROOMS));
};

export const removeSavedRoom = (roomId) =>
  writeJson(ROOMS_KEY, getSavedRooms().filter((room) => room.roomId !== roomId));

const storageKey = (prefix, roomId) => `${prefix}${encodeURIComponent(roomId)}`;

export const getWorkspace = (roomId) => {
  if (typeof roomId !== 'string' || !roomId) return null;
  const files = readJson(storageKey(WORKSPACE_PREFIX, roomId), null);
  return isValidFiles(files) ? files : null;
};

export const saveWorkspace = (roomId, files) => {
  if (typeof roomId !== 'string' || !roomId || !Array.isArray(files) || !files.length) return false;
  return writeJson(storageKey(WORKSPACE_PREFIX, roomId), files);
};

export const getSnapshots = (roomId) => {
  if (typeof roomId !== 'string' || !roomId) return [];
  const snapshots = readJson(storageKey(SNAPSHOTS_PREFIX, roomId), []);
  return Array.isArray(snapshots)
    ? snapshots.filter((snapshot) => snapshot && typeof snapshot.id === 'string' &&
      typeof snapshot.label === 'string' && typeof snapshot.createdAt === 'string' && isValidFiles(snapshot.files))
    : [];
};

export const shouldRestoreLocalWorkspace = (serverFiles, cachedFiles) =>
  serverFiles?.length === 1 && serverFiles[0].name === 'main.js' && serverFiles[0].code === '' &&
  isValidFiles(cachedFiles) && cachedFiles.some((file) => file.name !== 'main.js' || file.code.trim());

export const saveSnapshot = (roomId, files, label) => {
  if (typeof roomId !== 'string' || !roomId || !Array.isArray(files) || !files.length) return false;
  const snapshots = getSnapshots(roomId);
  snapshots.unshift({
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label: (label || 'Snapshot').trim().slice(0, 60) || 'Snapshot',
    createdAt: new Date().toISOString(),
    files: files.map((file) => ({ ...file })),
  });
  return writeJson(storageKey(SNAPSHOTS_PREFIX, roomId), snapshots.slice(0, MAX_SNAPSHOTS_PER_ROOM));
};

export const removeSnapshot = (roomId, snapshotId) =>
  writeJson(
    storageKey(SNAPSHOTS_PREFIX, roomId),
    getSnapshots(roomId).filter((snapshot) => snapshot.id !== snapshotId),
  );
