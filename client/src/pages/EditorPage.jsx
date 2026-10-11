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
  while (otherFiles.some((file) => file.name.toLowerCase() === candidate.toLowerCase())) {
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
  const socketRef = useRef(null);
  const hasConnectedRef = useRef(false);
  const [clients, setClients] = useState([]);
  const [files, setFiles] = useState([]);
  const filesRef = useRef([]);
  const [activeFileId, setActiveFileId] = useState('');
  const [ownerSocketId, setOwnerSocketId] = useState(null);
  const [permissions, setPermissions] = useState({});
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
  const isOwner = Boolean(socket?.id && socket.id === ownerSocketId);
  const canEdit = Boolean(
    hasJoinedRoom && socket?.id && (isOwner || permissions[socket.id] === 'editor'),
  );

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
      if (nextClients) setClients(nextClients);
    };

    const handleJoined = ({ clients: nextClients, username: joinedUsername, socketId, room }) => {
      const joinedByThisSocket = socketId === currentSocket.id;
      if (joinedByThisSocket) {
        saveRoom(roomId, joiningUsername);
        setIsReconnecting(false);
        const cachedFiles = getWorkspace(roomId);
        if (shouldRestoreLocalWorkspace(room?.files, cachedFiles)) {
          const recoveredRoom = { ...room, files: cachedFiles };
          applyRoom(recoveredRoom, nextClients);
          currentSocket.emit(ACTIONS.FILES_UPDATE, { roomId, files: cachedFiles });
          toast.success('Your saved room draft was restored.');
        } else {
          applyRoom(room, nextClients);
        }
        setHasJoinedRoom(true);
      } else {
        applyRoom(room, nextClients);
      }
      if (!joinedByThisSocket) {
        toast.success(`${joinedUsername} joined the room.`);
      }
    };
    const handleDisconnected = ({ username: leftUsername, clients: nextClients, room }) => {
      toast(`${leftUsername} left the room.`);
      applyRoom(room, nextClients);
    };
    const handleFilesUpdated = ({ files: nextFiles }) => {
      if (!Array.isArray(nextFiles) || !nextFiles.length) return;
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
    const handleCodeChange = ({ fileId, code }) => {
      if (typeof code !== 'string') return;
      const nextFiles = filesRef.current.map((file) =>
        file.id === fileId ? { ...file, code } : file,
      );
      filesRef.current = nextFiles;
      setFiles(nextFiles);
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
    currentSocket.on(ACTIONS.CODE_CHANGE, handleCodeChange);
    currentSocket.on(ACTIONS.CODE_OUTPUT, handleCodeOutput);
    currentSocket.on(ACTIONS.PERMISSION_DENIED, handlePermissionDenied);
    currentSocket.connect();

    return () => {
      currentSocket.removeAllListeners();
      currentSocket.disconnect();
      if (socketRef.current === currentSocket) socketRef.current = null;
    };
  }, [roomId, username]);

  useEffect(() => {
    if (hasJoinedRoom && files.length) saveWorkspace(roomId, files);
  }, [files, hasJoinedRoom, roomId]);

  const publishFiles = (nextFiles) => {
    filesRef.current = nextFiles;
    setFiles(nextFiles);
    socketRef.current?.emit(ACTIONS.FILES_UPDATE, { roomId, files: nextFiles });
  };

  const createCodeSnapshot = () => {
    if (!files.length) return;
    const label = window.prompt('Name this snapshot', `Snapshot ${snapshots.length + 1}`);
    if (label === null) return;
    if (!saveSnapshot(roomId, files, label)) {
      toast.error('Could not save snapshot. Browser storage may be full.');
      return;
    }
    setSnapshotState({ roomId, snapshots: getSnapshots(roomId) });
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

  const addFile = () => {
    if (!canEdit || files.length >= 20) return;
    const language = activeFile?.language || 'javascript';
    const extension = extensionForLanguage(language);
    let index = 1;
    while (files.some((file) => file.name.toLowerCase() === `untitled-${index}.${extension}`)) index += 1;
    const file = {
      id: globalThis.crypto.randomUUID(),
      name: `untitled-${index}.${extension}`,
      language,
      code: '',
    };
    publishFiles([...files, file]);
    setActiveFileId(file.id);
  };

  const updateActiveFileLanguage = (language) => {
    if (!activeFile || !canEdit) return;
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
    const name = enteredName && !enteredName.includes('.')
      ? `${enteredName}.${extensionForLanguage(file.language)}`
      : enteredName;
    if (!name || files.some((item) => item.id !== file.id && item.name.toLowerCase() === name.toLowerCase())) {
      if (name) toast.error('A file with that name already exists.');
      return;
    }
    publishFiles(files.map((item) =>
      item.id === file.id ? { ...item, name, language: languageFromName(name) } : item,
    ));
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
        </div>
        <div className="asideBtns">
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
            {!hasJoinedRoom && <span className="readOnlyBadge">Joining room…</span>}
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
              {snapshotPanelOpen && (
                <div className="snapshotPopover" id="roomSnapshots">
                  <div className="snapshotPopoverHeader">
                    <strong>Room snapshots</strong>
                    <button type="button" className="snapshotSaveBtn" onClick={createCodeSnapshot}>Save current files</button>
                  </div>
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
              )}
            </div>
            <button
              className="btn runBtn"
              onClick={runCode}
              disabled={!canEdit || !isConnected || !activeFile}
              title={!isConnected
                ? 'Waiting for the room connection'
                : !hasJoinedRoom ? 'Waiting for room access' : !canEdit ? 'Ask the room owner for edit access' : 'Run the active file'}
            >
              {!isConnected ? 'Connecting…' : !hasJoinedRoom ? 'Joining…' : !canEdit ? 'View only' : 'Run Code'}
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
                onClick={() => setActiveFileId(file.id)}
                onDoubleClick={() => renameFile(file)}
                title={canEdit ? 'Select file; double click to rename' : file.name}
              >
                {file.name}
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
          {canEdit && (
            <button
              type="button"
              className="newFileButton"
              onClick={addFile}
              disabled={files.length >= 20}
              title={files.length >= 20 ? 'Room file limit reached' : 'Create a file'}
            >
              + New file
            </button>
          )}
        </div>

        <div className="editorMain">
          <div className="codeEditor">
            <Editor
              socket={socket}
              roomId={roomId}
              activeFile={activeFile}
              canEdit={canEdit}
              onCodeChange={(fileId, code) => {
                const nextFiles = filesRef.current.map((file) =>
                  file.id === fileId ? { ...file, code } : file,
                );
                filesRef.current = nextFiles;
                setFiles(nextFiles);
              }}
            />
          </div>
          <div className="terminalContainer">
            <div className="terminal-header">INTERACTIVE TERMINAL</div>
            <div ref={terminalRef} className="terminalOutput" />
          </div>
        </div>
      </main>

      <Chat socket={socket} roomId={roomId} username={username} />
    </div>
  );
};

export default EditorPage;
