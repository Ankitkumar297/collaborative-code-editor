import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import ACTIONS from '../Actions';
import Client from '../components/Client';
import Editor from '../components/Editor';
import Chat from '../components/Chat';
import { initSocket } from '../socket';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  getSnapshots,
  getWorkspace,
  removeSnapshot,
  saveRoom,
  saveSnapshot,
  saveWorkspace,
  shouldRestoreLocalWorkspace,
} from '../roomStorage';
import { createLineDiff } from '../lineDiff';
import { downloadRoomZip } from '../zipExport';
import { reconcileWorkspace } from '../reconcileWorkspace';
import { buildFileTree, normalizeProjectPath, pathConflictsWithFiles } from '../fileTree';
import { replaceAllOccurrences, replaceOccurrenceAt, searchFiles } from '../fileSearch';
import { detectLanguage } from '../languageDetection';

const languageFromName = (name) => {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'py') return 'python';
  if (extension === 'c') return 'c';
  if (['cc', 'cpp', 'cxx', 'hpp'].includes(extension)) return 'cpp';
  if (extension === 'java') return 'java';
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'cs') return 'csharp';
  if (extension === 'js' || extension === 'mjs' || extension === 'cjs') return 'javascript';
  return 'javascript';
};

const extensionForLanguage = (language) => ({
  javascript: 'js',
  python: 'py',
  c: 'c',
  cpp: 'cpp',
  java: 'java',
  typescript: 'ts',
  node: 'js',
  csharp: 'cs',
}[language] || 'js');

const nameForLanguage = (name, language, otherFiles) => {
  const extension = extensionForLanguage(language);
  const base = name.replace(/\.(?:m?js|py|c|cc|cpp|cxx|h|hpp|java|ts|tsx|cs)$/i, '') || 'untitled';
  let candidate = `${base}.${extension}`;
  let suffix = 2;
  while (pathConflictsWithFiles(candidate, otherFiles)) {
    candidate = `${base}-${suffix}.${extension}`;
    suffix += 1;
  }
  return candidate;
};

const EditorPage = () => {
  const location = useLocation();
  const { roomId } = useParams();
  const reactNavigator = useNavigate();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [snapshotState, setSnapshotState] = useState(() => ({ roomId, snapshots: getSnapshots(roomId) }));
  const [snapshotPanelOpen, setSnapshotPanelOpen] = useState(false);
  const [fileExplorerOpen, setFileExplorerOpen] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [fileReplaceText, setFileReplaceText] = useState('');
  const [searchRequest, setSearchRequest] = useState(null);
  const searchRequestSeqRef = useRef(0);
  const languageDetectionTimersRef = useRef(new Map());
  const [snapshotNameDialogOpen, setSnapshotNameDialogOpen] = useState(false);
  const [snapshotNameDraft, setSnapshotNameDraft] = useState('');
  const [comparingSnapshot, setComparingSnapshot] = useState(null);
  const socketRef = useRef(null);
  const hasConnectedRef = useRef(false);
  const joinedRoomRef = useRef({ roomId, joined: false });
  const lastSyncedFilesRef = useRef(null);
  const [clients, setClients] = useState([]);
  const [files, setFiles] = useState([]);
  const filesRef = useRef([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [folderNameDialogOpen, setFolderNameDialogOpen] = useState(false);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [activeFileId, setActiveFileId] = useState('');
  const [ownerSocketId, setOwnerSocketId] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [roomLocked, setRoomLocked] = useState(false);
  const [username, setUsername] = useState(() => location.state?.username?.trim() || '');
  const [inviteUsername, setInviteUsername] = useState('');
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const terminalInputActiveRef = useRef(false);
  const terminalInputBufferRef = useRef('');
  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileId) || files[0] || null,
    [files, activeFileId],
  );
  const snapshots = snapshotState.roomId === roomId ? snapshotState.snapshots : getSnapshots(roomId);
  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const fileSearchResults = useMemo(() => searchFiles(files, fileSearchQuery), [files, fileSearchQuery]);
  const activeFileMatches = useMemo(() => searchFiles(
    activeFile ? [activeFile] : [],
    fileSearchQuery,
  ).filter((result) => result.type === 'code').length, [activeFile, fileSearchQuery]);
  const projectReplaceCount = useMemo(() => files.reduce(
    (total, file) => total + replaceAllOccurrences(file.code, fileSearchQuery.trim(), fileReplaceText).count,
    0,
  ), [files, fileSearchQuery, fileReplaceText]);
  const comparisonFiles = useMemo(() => {
    if (!comparingSnapshot) return [];
    const beforeFiles = comparingSnapshot.files || [];
    const fileIds = new Set([...beforeFiles, ...files].map((file) => file.id));
    return Array.from(fileIds).map((id) => ({
      before: beforeFiles.find((file) => file.id === id) || null,
      after: files.find((file) => file.id === id) || null,
    }));
  }, [comparingSnapshot, files]);
  const isOwner = Boolean(socket?.id && socket.id === ownerSocketId);
  const canEdit = Boolean(
    hasJoinedRoom && socket?.id && (isOwner || permissions[socket.id] === 'editor'),
  );

  useEffect(() => () => {
    languageDetectionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    languageDetectionTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (canEdit) return;
    languageDetectionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    languageDetectionTimersRef.current.clear();
  }, [canEdit]);

  useEffect(() => {
    const handleSearchShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFileSearchOpen(true);
      }
      if (event.key === 'Escape') setFileSearchOpen(false);
    };
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, []);

  const openSearchResult = (result) => {
    setActiveFileId(result.fileId);
    setSelectedFolder(result.fileName.split('/').slice(0, -1).join('/'));
    searchRequestSeqRef.current += 1;
    setSearchRequest({ ...result, query: fileSearchQuery.trim(), nonce: searchRequestSeqRef.current });
    setFileSearchOpen(false);
  };

  const replaceSearchResult = (result) => {
    if (!canEdit) {
      toast.error('Ask the room owner for edit access to replace code.');
      return;
    }
    const currentFiles = filesRef.current;
    const file = currentFiles.find((entry) => entry.id === result.fileId);
    if (!file) return;
    const code = replaceOccurrenceAt(
      file.code,
      fileSearchQuery.trim(),
      fileReplaceText,
      result.line,
      result.column,
    );
    if (code === null) {
      toast.error('That match changed. Search again and retry.');
      return;
    }
    publishFiles(currentFiles.map((entry) => entry.id === file.id ? { ...entry, code } : entry));
    toast.success(`Replaced one match in ${file.name}`);
  };

  const replaceAllInProject = () => {
    if (!canEdit) {
      toast.error('Ask the room owner for edit access to replace code.');
      return;
    }
    const currentFiles = filesRef.current;
    const replacements = currentFiles.map((file) => ({
      file,
      ...replaceAllOccurrences(file.code, fileSearchQuery.trim(), fileReplaceText),
    }));
    const count = replacements.reduce((total, result) => total + result.count, 0);
    if (!count) return;
    const affectedFiles = replacements.filter((result) => result.count > 0).length;
    if (!window.confirm(`Replace ${count} occurrence${count === 1 ? '' : 's'} in ${affectedFiles} file${affectedFiles === 1 ? '' : 's'} across this room?`)) return;
    publishFiles(replacements.map(({ file, text, count: replaced }) => replaced ? { ...file, code: text } : file));
    toast.success(`Replaced ${count} occurrence${count === 1 ? '' : 's'} across ${affectedFiles} file${affectedFiles === 1 ? '' : 's'}`);
  };

  const replaceAllInActiveFile = () => {
    if (!activeFile || !canEdit) {
      toast.error('Ask the room owner for edit access to replace code.');
      return;
    }
    const { text, count } = replaceAllOccurrences(activeFile.code, fileSearchQuery.trim(), fileReplaceText);
    if (!count) return;
    if (!window.confirm(`Replace ${count} occurrence${count === 1 ? '' : 's'} in ${activeFile.name}?`)) return;
    publishFiles(filesRef.current.map((file) => file.id === activeFile.id ? { ...file, code: text } : file));
    toast.success(`Replaced ${count} occurrence${count === 1 ? '' : 's'} in ${activeFile.name}`);
  };

  useEffect(() => {
    if (xtermRef.current || !terminalRef.current) return undefined;
    const term = new Terminal({
      cursorBlink: true,
      theme: { background: '#1e1e1e' },
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    term.write('\x1b[32mWelcome to CodeCollab Terminal\x1b[0m\r\n');
    xtermRef.current = term;
    term.onData((data) => {
      if (!terminalInputActiveRef.current) return;

      // Child processes use piped stdin, so they cannot echo keystrokes as a
      // real terminal would. Echo locally and send complete lines on Enter.
      const normalizedData = data.replace(/\r\n/g, '\r');
      for (const character of normalizedData) {
        if (character === '\r' || character === '\n') {
          term.write('\r\n');
          socketRef.current?.emit(ACTIONS.TERMINAL_INPUT, `${terminalInputBufferRef.current}\r`);
          terminalInputBufferRef.current = '';
        } else if (character === '\x7f' || character === '\b') {
          const characters = Array.from(terminalInputBufferRef.current);
          if (characters.length) {
            characters.pop();
            terminalInputBufferRef.current = characters.join('');
            term.write('\b \b');
          }
        } else if (character === '\t' || character >= ' ') {
          terminalInputBufferRef.current += character;
          term.write(character);
        }
      }
    });
    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      terminalInputActiveRef.current = false;
      terminalInputBufferRef.current = '';
      term.dispose();
      if (xtermRef.current === term) xtermRef.current = null;
    };
  }, []);

  useEffect(() => {
    const joiningUsername = username.trim();
    if (!joiningUsername) return undefined;

    const currentSocket = initSocket();
    socketRef.current = currentSocket;
    setSocket(currentSocket);

    const applyRoom = (room, nextClients) => {
      if (!room) return;
      if (Array.isArray(room.files) && room.files.length) {
        filesRef.current = room.files;
        setFiles(room.files);
        setActiveFileId((currentId) =>
          room.files.some((file) => file.id === currentId)
            ? currentId
            : room.files[0].id,
        );
      }
      if (room.ownerSocketId) setOwnerSocketId(room.ownerSocketId);
      if (room.permissions) setPermissions(room.permissions);
      setRoomLocked(Boolean(room.locked));
      if (nextClients) setClients(nextClients);
    };

    const handleJoined = ({ clients: nextClients, username: joinedUsername, socketId, room }) => {
      const joinedByThisSocket = socketId === currentSocket.id;
      const previousSyncedFiles = lastSyncedFilesRef.current;
      if (Array.isArray(room?.files) && room.files.length) {
        lastSyncedFilesRef.current = room.files.map((file) => ({ ...file }));
      }
      if (joinedByThisSocket) {
        const rejoining = joinedRoomRef.current.roomId === roomId && joinedRoomRef.current.joined;
        let hadSyncConflict = false;
        let didSyncDraft = false;
        saveRoom(roomId, joiningUsername);
        setIsReconnecting(false);
        const cachedFiles = getWorkspace(roomId);
        if (shouldRestoreLocalWorkspace(room?.files, cachedFiles)) {
          const recoveredRoom = { ...room, files: cachedFiles };
          applyRoom(recoveredRoom, nextClients);
          currentSocket.emit(ACTIONS.FILES_UPDATE, { roomId, files: cachedFiles });
          toast.success('Your saved room draft was restored.');
        } else if (rejoining && cachedFiles && Array.isArray(room?.files)) {
          const reconciliation = reconcileWorkspace(previousSyncedFiles, cachedFiles, room.files);
          if (reconciliation.hasConflicts) {
            hadSyncConflict = true;
            if (saveSnapshot(roomId, cachedFiles, 'Recovered draft (sync conflict)')) {
              setSnapshotState({ roomId, snapshots: getSnapshots(roomId) });
              toast.error('A local draft conflicted with newer room edits. It was saved in Snapshots.');
            } else {
              toast.error('A local draft conflicted with newer room edits and could not be saved. Check browser storage.');
            }
          }
          if (reconciliation.changedFromServer) {
            didSyncDraft = reconciliation.hasLocalChanges;
            applyRoom({ ...room, files: reconciliation.files }, nextClients);
            saveWorkspace(roomId, reconciliation.files);
            currentSocket.emit(ACTIONS.FILES_UPDATE, { roomId, files: reconciliation.files });
            if (!reconciliation.hasConflicts) {
              toast.success('Your offline draft was synced with the room.');
            }
          } else {
            applyRoom(room, nextClients);
          }
        } else {
          applyRoom(room, nextClients);
        }
        joinedRoomRef.current = { roomId, joined: true };
        setHasJoinedRoom(true);
        if (rejoining && !hadSyncConflict && !didSyncDraft && !shouldRestoreLocalWorkspace(room?.files, cachedFiles)) {
          toast.success('Reconnected. Room files are up to date.');
        }
      } else {
        applyRoom(room, nextClients);
      }
      if (!joinedByThisSocket) {
        toast.success(`${joinedUsername} joined the room.`);
      }
    };
    const handleDisconnected = ({ username: leftUsername, clients: nextClients, room }) => {
      toast(`${leftUsername} left the room.`);
      if (Array.isArray(room?.files)) lastSyncedFilesRef.current = room.files.map((file) => ({ ...file }));
      applyRoom(room, nextClients);
    };
    const handleFilesUpdated = ({ files: nextFiles }) => {
      if (!Array.isArray(nextFiles) || !nextFiles.length) return;
      lastSyncedFilesRef.current = nextFiles.map((file) => ({ ...file }));
      filesRef.current = nextFiles;
      setFiles(nextFiles);
      setActiveFileId((currentId) =>
        nextFiles.some((file) => file.id === currentId) ? currentId : nextFiles[0].id,
      );
    };
    const handlePermissionsUpdated = ({ clients: nextClients, permissions: nextPermissions }) => {
      setClients(nextClients || []);
      setPermissions(nextPermissions || {});
    };
    const handleRoomState = ({ room, clients: nextClients }) => {
      if (Array.isArray(room?.files)) lastSyncedFilesRef.current = room.files.map((file) => ({ ...file }));
      applyRoom(room, nextClients);
    };
    const handleRoomJoinRejected = (message) => {
      toast.error(message || 'This room is not accepting new participants.');
      currentSocket.disconnect();
      reactNavigator('/');
    };
    const handleRoomRemoved = (message) => {
      toast.error(message || 'The room owner removed you from this room.');
      currentSocket.disconnect();
      reactNavigator('/');
    };
    const handleCodeChange = ({ fileId, code }) => {
      if (typeof code !== 'string') return;
      const syncedFiles = lastSyncedFilesRef.current || filesRef.current;
      lastSyncedFilesRef.current = syncedFiles.map((file) =>
        file.id === fileId ? { ...file, code } : file,
      );
      const nextFiles = filesRef.current.map((file) =>
        file.id === fileId ? { ...file, code } : file,
      );
      filesRef.current = nextFiles;
      setFiles(nextFiles);
    };
    const handleCodeChangeAck = ({ fileId, code }) => {
      if (typeof code !== 'string') return;
      const syncedFiles = lastSyncedFilesRef.current || filesRef.current;
      lastSyncedFilesRef.current = syncedFiles.map((file) =>
        file.id === fileId ? { ...file, code } : file,
      );
    };
    const handleCodeOutput = (data) => {
      xtermRef.current?.write(data);
      if (/\b(?:Process exited|Process stopped|Execution timed out|Output exceeded|Execution Error|Process error):?/i.test(data)) {
        terminalInputActiveRef.current = false;
        terminalInputBufferRef.current = '';
      }
    };
    const handlePermissionDenied = (message) => toast.error(message);
    const handleConnectError = (error) => {
      console.error('Socket connection error:', error);
      toast.error('Socket connection failed, retrying...');
    };

    const handleConnect = () => {
      setIsConnected(true);
      setHasJoinedRoom(false);
      setIsReconnecting(hasConnectedRef.current);
      hasConnectedRef.current = true;
      currentSocket.emit(ACTIONS.JOIN, { roomId, username: joiningUsername });
    };
    const handleDisconnect = () => {
      setIsConnected(false);
      setHasJoinedRoom(false);
      setIsReconnecting(hasConnectedRef.current);
      terminalInputActiveRef.current = false;
      terminalInputBufferRef.current = '';
    };
    currentSocket.on('connect', handleConnect);
    currentSocket.on('disconnect', handleDisconnect);
    currentSocket.on('connect_error', handleConnectError);
    currentSocket.on(ACTIONS.JOINED, handleJoined);
    currentSocket.on(ACTIONS.DISCONNECTED, handleDisconnected);
    currentSocket.on(ACTIONS.FILES_UPDATED, handleFilesUpdated);
    currentSocket.on(ACTIONS.PERMISSIONS_UPDATED, handlePermissionsUpdated);
    currentSocket.on(ACTIONS.ROOM_STATE, handleRoomState);
    currentSocket.on(ACTIONS.ROOM_JOIN_REJECTED, handleRoomJoinRejected);
    currentSocket.on(ACTIONS.ROOM_REMOVED, handleRoomRemoved);
    currentSocket.on(ACTIONS.CODE_CHANGE, handleCodeChange);
    currentSocket.on(ACTIONS.CODE_CHANGE_ACK, handleCodeChangeAck);
    currentSocket.on(ACTIONS.CODE_OUTPUT, handleCodeOutput);
    currentSocket.on(ACTIONS.PERMISSION_DENIED, handlePermissionDenied);
    currentSocket.connect();

    return () => {
      currentSocket.removeAllListeners();
      currentSocket.disconnect();
      if (socketRef.current === currentSocket) socketRef.current = null;
    };
  }, [roomId, username, reactNavigator]);

  useEffect(() => {
    if (hasJoinedRoom && files.length) saveWorkspace(roomId, files);
  }, [files, hasJoinedRoom, roomId]);

  const publishFiles = (nextFiles) => {
    filesRef.current = nextFiles;
    setFiles(nextFiles);
    saveWorkspace(roomId, nextFiles);
    if (socketRef.current?.connected && hasJoinedRoom) {
      socketRef.current.emit(ACTIONS.FILES_UPDATE, { roomId, files: nextFiles });
    } else {
      toast.error('Room disconnected. Your draft is saved locally and will sync after reconnecting.');
    }
  };

  const recordLocalCodeChange = (fileId, code) => {
    const nextFiles = filesRef.current.map((file) =>
      file.id === fileId ? { ...file, code } : file,
    );
    filesRef.current = nextFiles;
    setFiles(nextFiles);
    saveWorkspace(roomId, nextFiles);

    const existingTimer = languageDetectionTimersRef.current.get(fileId);
    if (existingTimer) window.clearTimeout(existingTimer);
    if (!canEdit) return;

    const timer = window.setTimeout(() => {
      languageDetectionTimersRef.current.delete(fileId);
      const latestFiles = filesRef.current;
      const currentFile = latestFiles.find((file) => file.id === fileId);
      if (!currentFile) return;
      const detectedLanguage = detectLanguage(currentFile.code, currentFile.language);
      if (!detectedLanguage) return;

      const name = nameForLanguage(
        currentFile.name,
        detectedLanguage,
        latestFiles.filter((file) => file.id !== fileId),
      );
      const updatedFiles = latestFiles.map((file) => file.id === fileId
        ? { ...file, name, language: detectedLanguage }
        : file);
      publishFiles(updatedFiles);
      toast.success(`Detected ${detectedLanguage}; file is now ${name}`);
    }, 900);
    languageDetectionTimersRef.current.set(fileId, timer);
  };

  const expandFolderPath = (folderPath) => {
    if (!folderPath) return;
    setCollapsedFolders((current) => {
      const next = { ...current };
      let currentPath = '';
      folderPath.split('/').forEach((part) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        next[currentPath] = false;
      });
      return next;
    });
  };

  const openSnapshotNameDialog = () => {
    setSnapshotNameDraft(`Snapshot ${snapshots.length + 1}`);
    setSnapshotNameDialogOpen(true);
  };

  const createCodeSnapshot = (event) => {
    event.preventDefault();
    if (!files.length) return;
    const label = snapshotNameDraft.trim();
    if (!label) {
      toast.error('Enter a name for this snapshot.');
      return;
    }
    if (!saveSnapshot(roomId, files, label)) {
      toast.error('Could not save snapshot. Browser storage may be full.');
      return;
    }
    setSnapshotState({ roomId, snapshots: getSnapshots(roomId) });
    setSnapshotNameDialogOpen(false);
    toast.success('Snapshot saved in this browser.');
  };

  const restoreCodeSnapshot = (snapshot) => {
    if (!canEdit) {
      toast.error('Ask the room owner for edit access to restore a snapshot.');
      return;
    }
    if (!window.confirm(`Restore "${snapshot.label}"? This replaces the current room files for everyone.`)) return;
    publishFiles(snapshot.files);
    setSnapshotPanelOpen(false);
    toast.success('Snapshot restored for everyone in the room.');
  };

  const forgetCodeSnapshot = (snapshotId) => {
    if (!removeSnapshot(roomId, snapshotId)) {
      toast.error('Could not remove this snapshot.');
      return;
    }
    setSnapshotState({ roomId, snapshots: getSnapshots(roomId) });
  };

  const exportRoom = () => {
    try {
      downloadRoomZip(files, roomId);
      toast.success('Room files downloaded as a ZIP.');
    } catch (error) {
      toast.error(error.message || 'Could not export the room files.');
    }
  };

  const transferOwnership = (client) => {
    if (!isOwner || !window.confirm(`Transfer room ownership to ${client.username}? You will remain an editor.`)) return;
    socketRef.current?.emit(ACTIONS.ROOM_OWNER_TRANSFER, { targetSocketId: client.socketId });
  };

  const removeClient = (client) => {
    if (!isOwner || !window.confirm(`Remove ${client.username} from this room?`)) return;
    socketRef.current?.emit(ACTIONS.ROOM_REMOVE_CLIENT, { targetSocketId: client.socketId });
  };

  const toggleRoomLock = () => {
    if (!isOwner) return;
    socketRef.current?.emit(ACTIONS.ROOM_LOCK_CHANGE, { locked: !roomLocked });
  };

  const addFile = () => {
    if (!canEdit || files.length >= 20) return;
    const language = activeFile?.language || 'javascript';
    const extension = extensionForLanguage(language);
    let index = 1;
    const prefix = selectedFolder ? `${selectedFolder}/` : '';
    while (files.some((file) => file.name.toLowerCase() === `${prefix}untitled-${index}.${extension}`.toLowerCase())) index += 1;
    const file = {
      id: globalThis.crypto.randomUUID(),
      name: `${prefix}untitled-${index}.${extension}`,
      language,
      code: '',
    };
    publishFiles([...files, file]);
    setActiveFileId(file.id);
    expandFolderPath(selectedFolder);
  };

  const createFolder = () => {
    if (!canEdit || files.length >= 20) return;
    setFolderNameDraft('');
    setFolderNameDialogOpen(true);
  };

  const submitNewFolder = (event) => {
    event.preventDefault();
    if (!canEdit || files.length >= 20) return;
    const enteredName = folderNameDraft.trim();
    const folderPath = normalizeProjectPath((selectedFolder ? selectedFolder + '/' : '') + enteredName);
    if (!folderPath) {
      toast.error('Use a valid relative folder name without . or .. path parts.');
      return;
    }
    if (files.some((file) => file.name.toLowerCase().startsWith(folderPath.toLowerCase() + '/'))) {
      setSelectedFolder(folderPath);
      expandFolderPath(folderPath);
      toast('That folder already exists. Add a file to it.');
      setFolderNameDialogOpen(false);
      return;
    }
    if (pathConflictsWithFiles(folderPath, files)) {
      toast.error('A file already uses that folder path.');
      return;
    }
    const language = activeFile?.language || 'javascript';
    const extension = extensionForLanguage(language);
    let index = 1;
    let fileName = folderPath + '/untitled-' + index + '.' + extension;
    while (pathConflictsWithFiles(fileName, files)) {
      index += 1;
      fileName = folderPath + '/untitled-' + index + '.' + extension;
    }
    const file = {
      id: globalThis.crypto.randomUUID(),
      name: fileName,
      language,
      code: '',
    };
    publishFiles([...files, file]);
    setActiveFileId(file.id);
    setSelectedFolder(folderPath);
    expandFolderPath(folderPath);
    setFolderNameDialogOpen(false);
  };

  const updateActiveFileLanguage = (language) => {
    if (!activeFile || !canEdit) return;
    const timer = languageDetectionTimersRef.current.get(activeFile.id);
    if (timer) window.clearTimeout(timer);
    languageDetectionTimersRef.current.delete(activeFile.id);
    const name = nameForLanguage(activeFile.name, language, files.filter((file) => file.id !== activeFile.id));
    publishFiles(files.map((file) => file.id === activeFile.id ? { ...file, name, language } : file));
  };

  const removeFile = (file) => {
    if (!canEdit || files.length <= 1) return;
    if (file.code.trim() && !window.confirm(`Delete "${file.name}" and its code from this room?`)) return;
    const nextFiles = files.filter((item) => item.id !== file.id);
    publishFiles(nextFiles);
    if (activeFileId === file.id) setActiveFileId(nextFiles[0].id);
  };

  const renameFile = (file) => {
    if (!canEdit) return;
    const enteredName = window.prompt('Rename file', file.name)?.trim();
    const nameWithExtension = enteredName && !enteredName.split('/').pop().includes('.')
      ? `${enteredName}.${extensionForLanguage(file.language)}`
      : enteredName;
    const name = normalizeProjectPath(nameWithExtension);
    const otherFiles = files.filter((item) => item.id !== file.id);
    if (!name || pathConflictsWithFiles(name, otherFiles)) {
      if (nameWithExtension) toast.error('Choose a valid path that does not conflict with another file or folder.');
      return;
    }
    publishFiles(files.map((item) =>
      item.id === file.id ? { ...item, name, language: languageFromName(name) } : item,
    ));
    setSelectedFolder(name.split('/').slice(0, -1).join('/'));
  };

  const updatePermission = (targetSocketId, permission) => {
    socketRef.current?.emit(ACTIONS.PERMISSION_CHANGE, {
      roomId,
      targetSocketId,
      permission,
    });
  };

  async function copyRoomId() {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success('Room ID has been copied to your clipboard');
    } catch (error) {
      toast.error('Could not copy the Room ID');
      console.error(error);
    }
  }

  const runCode = () => {
    if (!activeFile || !canEdit) return;
    if (!socketRef.current?.connected) {
      toast.error('Socket is disconnected. Reconnect to the room before running code.');
      return;
    }
    xtermRef.current?.clear();
    xtermRef.current?.write('\x1b[32mRunning code...\x1b[0m\r\n');
    terminalInputBufferRef.current = '';
    terminalInputActiveRef.current = true;
    socketRef.current?.emit(ACTIONS.CODE_RUN, {
      code: activeFile.code,
      language: activeFile.language,
    });
  };

  const renderFileTreeNodes = (node, depth = 0) => (
    <>
      {node.folders.map((folder) => {
        const collapsed = Boolean(collapsedFolders[folder.path]);
        return (
          <div className="fileTreeBranch" key={folder.path}>
            <button
              type="button"
              role="treeitem"
              className={`fileTreeFolder ${selectedFolder === folder.path ? 'selected' : ''}`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              aria-expanded={!collapsed}
              title={folder.path}
              onClick={() => {
                setSelectedFolder(folder.path);
                setCollapsedFolders((current) => ({ ...current, [folder.path]: !current[folder.path] }));
              }}
            >
              <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
              <span className="fileTreeFolderIcon" aria-hidden="true">▰</span>
              <span className="fileTreeLabel">{folder.name}</span>
            </button>
            {!collapsed && renderFileTreeNodes(folder, depth + 1)}
          </div>
        );
      })}
      {node.files.map((file) => {
        const baseName = file.name.split('/').pop();
        return (
          <button
            type="button"
            role="treeitem"
            aria-selected={file.id === activeFile?.id}
            className={`fileTreeFile ${file.id === activeFile?.id ? 'selected' : ''}`}
            style={{ paddingLeft: `${22 + depth * 14}px` }}
            key={file.id}
            title={file.name}
            onClick={() => {
              setActiveFileId(file.id);
              setSelectedFolder(file.name.split('/').slice(0, -1).join('/'));
            }}
          >
            <span className="fileTreeFileIcon" aria-hidden="true">{baseName.split('.').pop()?.toUpperCase() || 'FILE'}</span>
            <span className="fileTreeLabel">{baseName}</span>
          </button>
        );
      })}
    </>
  );

  if (!username.trim()) {
    return (
      <div className="mainWrap">
        <form
          className="formWrap"
          onSubmit={(event) => {
            event.preventDefault();
            const name = inviteUsername.trim();
            if (name) setUsername(name);
          }}
        >
          <h2 className="mainLabel">Join this CodeCollab room</h2>
          <p className="roomInviteHelp">Enter your name to join room {roomId}.</p>
          <div className="inputGroup">
            <input
              type="text"
              className="inputBox"
              placeholder="YOUR NAME"
              aria-label="Your name"
              autoComplete="name"
              maxLength={32}
              required
              value={inviteUsername}
              onChange={(event) => setInviteUsername(event.target.value)}
            />
            <button className="btn joinBtn" type="submit">Join room</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="editorPageWrap">
      <aside className="aside">
        <div className="asideInner">
          <div className="logo"><h2 style={{ color: '#4aee88' }}>CodeCollab</h2></div>
          <h3>{hasJoinedRoom ? 'Connected' : isReconnecting ? 'Reconnecting…' : isConnected ? 'Joining room…' : 'Connecting…'}</h3>
          <div className="clientsList">
            {clients.map((client) => (
              <Client
                key={client.socketId}
                client={client}
                canManage={isOwner && client.socketId !== socket?.id}
                onPermissionChange={updatePermission}
                onTransferOwnership={transferOwnership}
                onRemoveClient={removeClient}
              />
            ))}
          </div>
          <div className="roomPermissionNote">
            {!hasJoinedRoom
              ? 'Waiting for room access…'
              : isOwner
              ? 'You own this room. Set each collaborator to editor or viewer.'
              : `Room owner: ${clients.find((client) => client.socketId === ownerSocketId)?.username || 'reconnecting...'}`}
          </div>
          {roomLocked && <div className="roomLockedBadge">Locked to new participants</div>}
        </div>
        <div className="asideBtns">
          {isOwner && (
            <button className="btn roomLockBtn" onClick={toggleRoomLock}>
              {roomLocked ? 'Unlock room' : 'Lock room'}
            </button>
          )}
          <button className="btn copyBtn" onClick={copyRoomId}>Copy ROOM ID</button>
          <button className="btn leaveBtn" onClick={() => reactNavigator('/')}>Leave</button>
        </div>
      </aside>

      <main className="editorContainer">
        <div className="editorHeader">
          <label className="languageControl">
            <span>Language</span>
            <select
              className="languageSelect"
              value={activeFile?.language || 'javascript'}
              disabled={!canEdit || !activeFile}
              onChange={(event) => updateActiveFileLanguage(event.target.value)}
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="c">C</option>
              <option value="cpp">C++</option>
              <option value="java">Java</option>
              <option value="typescript">TypeScript</option>
              <option value="node">Node.js</option>
              <option value="csharp">C#</option>
            </select>
          </label>
          <div className="editorHeaderActions">
            <button type="button" className="btn fileSearchToggleBtn" onClick={() => setFileSearchOpen(true)} title="Search files and code (Ctrl+Shift+F)">
              Search
            </button>
            <button
              type="button"
              className={`btn explorerToggleBtn ${fileExplorerOpen ? 'active' : ''}`}
              aria-expanded={fileExplorerOpen}
              aria-controls="projectFileExplorer"
              onClick={() => setFileExplorerOpen((open) => !open)}
            >
              Files
            </button>
            {!hasJoinedRoom && <span className="readOnlyBadge">{isReconnecting ? 'Reconnecting…' : 'Joining room…'}</span>}
            {hasJoinedRoom && !canEdit && <span className="readOnlyBadge">View only</span>}
            {canEdit && activeFile && (
              <button className="btn renameFileBtn" onClick={() => renameFile(activeFile)}>Rename file</button>
            )}
            <div className="snapshotTools">
              <button
                type="button"
                className="btn snapshotsBtn"
                aria-expanded={snapshotPanelOpen}
                aria-controls="roomSnapshots"
                onClick={() => setSnapshotPanelOpen((open) => !open)}
              >
                Snapshots ({snapshots.length})
              </button>
            </div>
            <button className="btn exportZipBtn" onClick={exportRoom} disabled={!hasJoinedRoom || !files.length}>
              Export ZIP
            </button>
            <button
              className="btn runBtn"
              onClick={runCode}
              disabled={!canEdit || !isConnected || !activeFile}
              title={!isConnected
                ? 'Waiting for the room connection'
                : !hasJoinedRoom ? 'Waiting for room access' : !canEdit ? 'Ask the room owner for edit access' : 'Run the active file'}
            >
              {!isConnected ? 'Connecting…' : !hasJoinedRoom ? (isReconnecting ? 'Reconnecting…' : 'Joining…') : !canEdit ? 'View only' : 'Run Code'}
            </button>
          </div>
        </div>
        <div className="fileTabsBar" role="tablist" aria-label="Room files">
          {files.map((file) => (
            <div className={`fileTab ${file.id === activeFile?.id ? 'active' : ''}`} key={file.id}>
              <button
                type="button"
                role="tab"
                aria-selected={file.id === activeFile?.id}
                className="fileTabButton"
                onClick={() => {
                  setActiveFileId(file.id);
                  setSelectedFolder(file.name.split('/').slice(0, -1).join('/'));
                }}
                onDoubleClick={() => renameFile(file)}
                title={canEdit ? `Select ${file.name}; double click to rename` : file.name}
              >
                {file.name.split('/').pop()}
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="fileTabClose"
                  aria-label={`Close ${file.name}`}
                  title={files.length <= 1 ? 'A room must keep at least one file' : `Close ${file.name}`}
                  disabled={files.length <= 1}
                  onClick={() => removeFile(file)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="editorMain">
          {fileExplorerOpen && <aside className="fileExplorer" id="projectFileExplorer" aria-label="Project files">
            <div className="fileExplorerHeader">
              <strong>EXPLORER</strong>
              <span>{files.length}/20</span>
            </div>
            <div className="fileExplorerActions">
              <button type="button" onClick={addFile} disabled={!canEdit || files.length >= 20} title="Create a file in the selected folder">+ File</button>
              <button type="button" onClick={createFolder} disabled={!canEdit || files.length >= 20} title="Create a folder and its first file">+ Folder</button>
            </div>
            <button
              type="button"
              className={`fileTreeRoot ${selectedFolder === '' ? 'selected' : ''}`}
              onClick={() => setSelectedFolder('')}
              title="Create new files in the project root"
            >
              <span aria-hidden="true">▾</span> Project
            </button>
            <div className="fileTree" role="tree" aria-label="Project file tree">
              {renderFileTreeNodes(fileTree)}
            </div>
          </aside>}
          <div className="codeEditor">
            <Editor
              socket={socket}
              roomId={roomId}
              activeFile={activeFile}
              canEdit={canEdit}
              onCodeChange={recordLocalCodeChange}
              searchRequest={searchRequest}
            />
          </div>
          <div className="terminalContainer">
            <div className="terminal-header">INTERACTIVE TERMINAL</div>
            <div ref={terminalRef} className="terminalOutput" />
          </div>
        </div>
      </main>

      <Chat socket={socket} roomId={roomId} username={username} />
      {fileSearchOpen && (
        <div className="comparisonBackdrop snapshotBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setFileSearchOpen(false);
        }}>
          <section className="fileSearchDialog" role="dialog" aria-modal="true" aria-labelledby="fileSearchTitle">
            <header className="snapshotDialogHeader">
              <div>
                <h2 id="fileSearchTitle">Search project files</h2>
                <p>Find file names and code across this room.</p>
              </div>
              <button type="button" className="comparisonClose" onClick={() => setFileSearchOpen(false)} aria-label="Close search">×</button>
            </header>
            <input
              className="fileSearchInput"
              autoFocus
              type="search"
              placeholder="Search file names or code…"
              aria-label="Search file names or code"
              value={fileSearchQuery}
              onChange={(event) => setFileSearchQuery(event.target.value)}
            />
            <div className="fileReplaceControls">
              <input
                className="fileSearchInput fileReplaceInput"
                type="text"
                placeholder="Replace with…"
                aria-label="Replace with"
                value={fileReplaceText}
                onChange={(event) => setFileReplaceText(event.target.value)}
              />
              <div className="fileReplaceActions">
                <button type="button" disabled={!canEdit || !activeFileMatches} onClick={replaceAllInActiveFile}>
                  Replace all in current file ({activeFileMatches})
                </button>
                <button type="button" className="replaceProjectBtn" disabled={!canEdit || !projectReplaceCount} onClick={replaceAllInProject}>
                  Replace all in project ({projectReplaceCount})
                </button>
              </div>
              {!canEdit && <p className="fileReplaceHint">Viewers can search, but need edit access to replace code.</p>}
            </div>
            <div className="fileSearchResults" aria-live="polite">
              {!fileSearchQuery.trim() ? <p className="snapshotEmpty">Type to search every file in this room.</p> : fileSearchResults.length === 0 ? (
                <p className="snapshotEmpty">No matches found.</p>
              ) : (
                <>
                  <p className="fileSearchCount">{fileSearchResults.length === 200 ? 'First 200 matches' : `${fileSearchResults.length} match${fileSearchResults.length === 1 ? '' : 'es'}`}</p>
                  {fileSearchResults.map((result, index) => (
                    <div className="fileSearchResultRow" key={`${result.fileId}-${result.type}-${result.line}-${result.column}-${index}`}>
                      <button type="button" className="fileSearchResult" onClick={() => openSearchResult(result)}>
                        <span className="fileSearchResultMeta">{result.fileName}{result.type === 'code' ? `:${result.line + 1}` : ' · file name'}</span>
                        {result.type === 'code' && <code>{result.excerpt}</code>}
                      </button>
                      {result.type === 'code' && (
                        <button type="button" className="replaceMatchBtn" disabled={!canEdit} onClick={() => replaceSearchResult(result)}>
                          Replace
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="fileSearchFooter">Esc to close · Ctrl+Shift+F to open</div>
          </section>
        </div>
      )}
      {folderNameDialogOpen && (
        <div className="comparisonBackdrop snapshotBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setFolderNameDialogOpen(false);
        }}>
          <form className="snapshotNameDialog" onSubmit={submitNewFolder} aria-labelledby="folderNameTitle">
            <h2 id="folderNameTitle">Create folder</h2>
            <label htmlFor="folderNameInput">Folder name{selectedFolder ? ` inside ${selectedFolder}` : ''}</label>
            <input
              id="folderNameInput"
              autoFocus
              maxLength={180}
              placeholder="e.g. src/components"
              value={folderNameDraft}
              onChange={(event) => setFolderNameDraft(event.target.value)}
            />
            <div className="snapshotNameActions">
              <button type="button" onClick={() => setFolderNameDialogOpen(false)}>Cancel</button>
              <button type="submit">Create folder</button>
            </div>
          </form>
        </div>
      )}
      {snapshotPanelOpen && (
        <div className="comparisonBackdrop snapshotBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSnapshotPanelOpen(false);
        }}>
          <section className="snapshotDialog" id="roomSnapshots" role="dialog" aria-modal="true" aria-labelledby="snapshotDialogTitle">
            <header className="snapshotDialogHeader">
              <div>
                <h2 id="snapshotDialogTitle">Room snapshots</h2>
                <p>Save and manage versions of this room's files.</p>
              </div>
              <button type="button" className="comparisonClose" onClick={() => setSnapshotPanelOpen(false)} aria-label="Close snapshots">×</button>
            </header>
            <div className="snapshotDialogActions">
              <span>{snapshots.length} saved</span>
              <button type="button" className="snapshotSaveBtn" onClick={openSnapshotNameDialog}>Save current files</button>
            </div>
            <div className="snapshotList">
              {snapshots.length === 0 ? (
                <p className="snapshotEmpty">Snapshots are saved in this browser.</p>
              ) : snapshots.map((snapshot) => (
                <div className="snapshotItem" key={snapshot.id}>
                  <div className="snapshotInfo">
                    <strong title={snapshot.label}>{snapshot.label}</strong>
                    <small>{new Date(snapshot.createdAt).toLocaleString()}</small>
                    <small>{snapshot.files.length} file{snapshot.files.length === 1 ? '' : 's'}</small>
                  </div>
                  <button
                    type="button"
                    className="snapshotCompareBtn"
                    onClick={() => setComparingSnapshot(snapshot)}
                    title={`Compare ${snapshot.label} with the current room files`}
                  >
                    Compare
                  </button>
                  <button
                    type="button"
                    className="snapshotRestoreBtn"
                    onClick={() => restoreCodeSnapshot(snapshot)}
                    disabled={!canEdit}
                    title={canEdit ? 'Replace shared room files with this snapshot' : 'Viewers cannot restore snapshots'}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="snapshotDeleteBtn"
                    onClick={() => forgetCodeSnapshot(snapshot.id)}
                    aria-label={`Delete snapshot ${snapshot.label}`}
                    title="Delete this local snapshot"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {snapshotNameDialogOpen && (
        <div className="comparisonBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSnapshotNameDialogOpen(false);
        }}>
          <form className="snapshotNameDialog" onSubmit={createCodeSnapshot} aria-labelledby="snapshotNameTitle">
            <h2 id="snapshotNameTitle">Save current files</h2>
            <label htmlFor="snapshotNameInput">Snapshot name</label>
            <input
              id="snapshotNameInput"
              autoFocus
              maxLength={60}
              value={snapshotNameDraft}
              onChange={(event) => setSnapshotNameDraft(event.target.value)}
            />
            <div className="snapshotNameActions">
              <button type="button" onClick={() => setSnapshotNameDialogOpen(false)}>Cancel</button>
              <button type="submit">Save snapshot</button>
            </div>
          </form>
        </div>
      )}
      {comparingSnapshot && (
        <div className="comparisonBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setComparingSnapshot(null);
        }}>
          <section className="comparisonDialog" role="dialog" aria-modal="true" aria-labelledby="comparisonTitle">
            <header className="comparisonHeader">
              <div>
                <h2 id="comparisonTitle">Compare snapshot with current files</h2>
                <p>{comparingSnapshot.label}</p>
              </div>
              <button type="button" className="comparisonClose" onClick={() => setComparingSnapshot(null)} aria-label="Close comparison">×</button>
            </header>
            <div className="comparisonContent">
              {comparisonFiles.map(({ before, after }, fileIndex) => {
                const diff = createLineDiff(before?.code || '', after?.code || '');
                const changed = diff.rows.some((row) => row.type !== 'same') || !before || !after ||
                  before.name !== after.name || before.language !== after.language;
                return (
                  <details className="comparisonFile" key={before?.id || after?.id} open={fileIndex === 0}>
                    <summary>
                      {before?.name || 'File did not exist'} <span>→</span> {after?.name || 'File was deleted'}
                      {!changed && <em>No changes</em>}
                    </summary>
                    {diff.simplified && <p className="comparisonHint">This large file uses approximate line matching to keep comparison responsive.</p>}
                    <div className="diffColumnHeadings"><span>Snapshot</span><span>Current</span></div>
                    <div className="diffRows">
                      {diff.rows.map((row, index) => (
                        <div className={`diffRow diff-${row.type}`} key={`${index}-${row.left?.number || 'x'}-${row.right?.number || 'x'}`}>
                          <span className="diffCell"><span className="diffLineNumber">{row.left?.number ?? ''}</span><code>{row.left?.text ?? ''}</code></span>
                          <span className="diffCell"><span className="diffLineNumber">{row.right?.number ?? ''}</span><code>{row.right?.text ?? ''}</code></span>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default EditorPage;
