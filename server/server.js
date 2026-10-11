import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import ACTIONS from './Actions.js';
import cors from 'cors';
import { fileURLToPath } from 'url';
import executeRoutes from './routes/execute.routes.js';
import { spawnCode } from './services/execute.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', executeRoutes);

// Static files for production
app.use(express.static(path.join(__dirname, '../client/dist')));

// Catch-all to serve index.html for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

const userSocketMap = {};
const roomStates = new Map();

function createRoomState() {
  return {
    ownerSocketId: null,
    files: [{ id: 'main', name: 'main.js', language: 'javascript', code: '' }],
    permissions: new Map(),
    cursors: new Map(),
  };
}

function getRoomSnapshot(roomId) {
  const room = roomStates.get(roomId);
  if (!room) return null;
  return {
    files: room.files,
    ownerSocketId: room.ownerSocketId,
    permissions: Object.fromEntries(room.permissions),
    cursors: Array.from(room.cursors, ([socketId, cursor]) => ({ socketId, ...cursor })),
  };
}

function getAllConnectedClients(roomId) {
  const room = roomStates.get(roomId);
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => {
      return {
        socketId,
        username: userSocketMap[socketId],
        permission: socketId === room?.ownerSocketId
          ? 'owner'
          : room?.permissions.get(socketId) || 'editor',
      };
    }
  );
}

function canEditRoom(socket, roomId) {
  const room = roomStates.get(roomId);
  return room && socket.data.roomId === roomId &&
    (room.ownerSocketId === socket.id || room.permissions.get(socket.id) === 'editor');
}

function sendPermissionDenied(socket) {
  socket.emit(ACTIONS.PERMISSION_DENIED, 'This room is read-only for you. Ask the room owner for edit access.');
}

function normalizeFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 20) return null;
  const normalized = [];
  const names = new Set();
  for (const file of files) {
    if (!file || typeof file.id !== 'string' || typeof file.name !== 'string' ||
        typeof file.language !== 'string' || typeof file.code !== 'string') return null;
    const name = file.name.trim().slice(0, 80);
    const key = name.toLowerCase();
    if (!name || names.has(key)) return null;
    names.add(key);
    normalized.push({
      id: file.id.slice(0, 80),
      name,
      language: file.language.slice(0, 30),
      code: file.code,
    });
  }
  return normalized;
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on(ACTIONS.JOIN, async (payload = {}) => {
    const { roomId, username } = payload;
    if (typeof roomId !== 'string' || !roomId.trim() || typeof username !== 'string' || !username.trim()) return;
    const trimmedRoomId = roomId.trim();
    const safeUsername = username.trim().slice(0, 32);
    let room = roomStates.get(trimmedRoomId);
    if (!room) {
      room = createRoomState();
      roomStates.set(trimmedRoomId, room);
    }
    if (!room.ownerSocketId) room.ownerSocketId = socket.id;
    room.permissions.set(socket.id, 'editor');
    socket.data.roomId = trimmedRoomId;
    userSocketMap[socket.id] = safeUsername;
    await socket.join(trimmedRoomId);
    const clients = getAllConnectedClients(trimmedRoomId);
    io.to(trimmedRoomId).emit(ACTIONS.JOINED, {
      clients,
      username: safeUsername,
      socketId: socket.id,
      room: getRoomSnapshot(trimmedRoomId),
    });
  });

  socket.on(ACTIONS.CODE_CHANGE, (payload = {}) => {
    const { roomId, fileId, code } = payload;
    if (typeof roomId !== 'string' || typeof code !== 'string') return;
    const trimmedRoomId = roomId.trim();
    if (!canEditRoom(socket, trimmedRoomId)) return sendPermissionDenied(socket);
    const room = roomStates.get(trimmedRoomId);
    const file = room.files.find((item) => item.id === fileId);
    if (!file) return;
    file.code = code;
    socket.to(trimmedRoomId).emit(ACTIONS.CODE_CHANGE, {
      fileId,
      code,
      socketId: socket.id,
      username: userSocketMap[socket.id],
    });
  });

  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code, language }) => {
    console.log(`[SYNC] Sending code to socket ${socketId}`);
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code, language });
  });

  socket.on(ACTIONS.LANGUAGE_CHANGE, ({ roomId, language }) => {
    if (typeof roomId !== 'string' || !canEditRoom(socket, roomId.trim())) return sendPermissionDenied(socket);
    socket.to(roomId.trim()).emit(ACTIONS.LANGUAGE_CHANGE, { language });
  });

  socket.on(ACTIONS.FILES_UPDATE, (payload = {}) => {
    const { roomId, files } = payload;
    if (typeof roomId !== 'string') return;
    const trimmedRoomId = roomId.trim();
    if (!canEditRoom(socket, trimmedRoomId)) return sendPermissionDenied(socket);
    const normalizedFiles = normalizeFiles(files);
    if (!normalizedFiles) return;
    const room = roomStates.get(trimmedRoomId);
    room.files = normalizedFiles;
    io.to(trimmedRoomId).emit(ACTIONS.FILES_UPDATED, {
      files: room.files,
      updatedBy: socket.id,
    });
  });

  socket.on(ACTIONS.CURSOR_CHANGE, (payload = {}) => {
    const { roomId, fileId, anchor, head } = payload;
    if (typeof roomId !== 'string') return;
    const trimmedRoomId = roomId.trim();
    if (socket.data.roomId !== trimmedRoomId) return;
    const room = roomStates.get(trimmedRoomId);
    if (!room?.files.some((file) => file.id === fileId)) return;
    if (anchor === null || head === null) {
      room.cursors.delete(socket.id);
      socket.to(trimmedRoomId).emit(ACTIONS.CURSOR_CHANGE, { socketId: socket.id, fileId: null });
      return;
    }
    const validPosition = (position) => position && Number.isInteger(position.line) &&
      Number.isInteger(position.ch) && position.line >= 0 && position.ch >= 0;
    if (!validPosition(anchor) || !validPosition(head)) return;
    const cursor = {
      fileId,
      anchor: { line: anchor.line, ch: anchor.ch },
      head: { line: head.line, ch: head.ch },
      color: ['#ff79c6', '#8be9fd', '#f1fa8c', '#bd93f9', '#ffb86c'][
        Array.from(socket.id).reduce((value, character) => value + character.charCodeAt(0), 0) % 5
      ],
      username: userSocketMap[socket.id],
    };
    room.cursors.set(socket.id, cursor);
    socket.to(trimmedRoomId).emit(ACTIONS.CURSOR_CHANGE, { socketId: socket.id, ...cursor });
  });

  socket.on(ACTIONS.PERMISSION_CHANGE, (payload = {}) => {
    const { roomId, targetSocketId, permission } = payload;
    if (typeof roomId !== 'string') return;
    const trimmedRoomId = roomId.trim();
    const room = roomStates.get(trimmedRoomId);
    if (!room || room.ownerSocketId !== socket.id || socket.data.roomId !== trimmedRoomId) return;
    const target = io.sockets.sockets.get(targetSocketId);
    if (!target || target.data.roomId !== trimmedRoomId || targetSocketId === room.ownerSocketId ||
        !['editor', 'viewer'].includes(permission)) return;
    room.permissions.set(targetSocketId, permission);
    io.to(trimmedRoomId).emit(ACTIONS.PERMISSIONS_UPDATED, {
      clients: getAllConnectedClients(trimmedRoomId),
      permissions: Object.fromEntries(room.permissions),
    });
  });

  socket.on(ACTIONS.SEND_MESSAGE, ({ roomId, message, username }) => {
    if (!roomId || !message) return;
    const trimmedRoomId = roomId.trim();
    const response = {
      message: message.trim(),
      username: username || 'Anonymous',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    console.log(`[CHAT] Broadcasting to room ${trimmedRoomId}:`, response);
    // Send to everyone else in the room
    socket.broadcast.to(trimmedRoomId).emit(ACTIONS.RECEIVE_MESSAGE, response);
    // Send back to the sender
    socket.emit(ACTIONS.RECEIVE_MESSAGE, response);
  });

  // Interactive Terminal Support
  let childProcess = null;
  let activeRunId = 0;
  let isCompiling = false;
  let pendingTerminalInput = '';

  socket.on(ACTIONS.CODE_RUN, async ({ code, language }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !canEditRoom(socket, roomId)) return sendPermissionDenied(socket);
    if (typeof code !== 'string' || typeof language !== 'string') return;
    const runId = ++activeRunId;
    isCompiling = true;
    pendingTerminalInput = '';
    // Kill existing process if any
    if (childProcess) {
      const previousProcess = childProcess;
      childProcess = null;
      try {
        const treeKill = (await import('tree-kill')).default || (await import('tree-kill'));
        treeKill(previousProcess.pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }

    try {
      const runningProcess = await spawnCode(code, language, (data) => {
        socket.emit(ACTIONS.CODE_OUTPUT, data);
      });

      if (runId !== activeRunId || !socket.connected) {
        runningProcess.kill('SIGKILL');
        return;
      }
      childProcess = runningProcess;
      isCompiling = false;
      runningProcess.stdin.on('error', (err) => {
        if (runId === activeRunId && err.code !== 'EPIPE') {
          socket.emit(ACTIONS.CODE_OUTPUT, `\r\nInput error: ${err.message}\r\n`);
        }
      });
      if (pendingTerminalInput && runningProcess.stdin.writable) {
        runningProcess.stdin.write(pendingTerminalInput);
      }
      pendingTerminalInput = '';
      const runStartedAt = Date.now();
      runningProcess.on('exit', (code, signal) => {
        if (runId !== activeRunId || childProcess !== runningProcess) return;
        const runTimeSeconds = ((Date.now() - runStartedAt) / 1000).toFixed(2);
        const status = signal
          ? `Process stopped (${signal}) after ${runTimeSeconds}s`
          : `Process exited with code ${code} after ${runTimeSeconds}s`;
        socket.emit(ACTIONS.CODE_OUTPUT, `\r\n${status}\r\n`);
        childProcess = null;
      });

      runningProcess.on('error', (err) => {
        if (runId !== activeRunId) return;
        socket.emit(ACTIONS.CODE_OUTPUT, `\r\nProcess error: ${err.message}\r\n`);
        if (childProcess === runningProcess) childProcess = null;
      });
    } catch (err) {
      if (runId === activeRunId) {
        isCompiling = false;
        pendingTerminalInput = '';
        socket.emit(ACTIONS.CODE_OUTPUT, `\r\nExecution Error: ${err.message}\r\n`);
      }
    }
  });

  socket.on(ACTIONS.TERMINAL_INPUT, (input) => {
    const roomId = socket.data.roomId;
    if (!roomId || !canEditRoom(socket, roomId) || typeof input !== 'string') return;
    // xterm sends carriage return for Enter. Piped stdin needs a newline.
    const formattedInput = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (childProcess?.stdin.writable) childProcess.stdin.write(formattedInput);
    else if (isCompiling) pendingTerminalInput = (pendingTerminalInput + formattedInput).slice(-64 * 1024);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      const room = roomStates.get(roomId);
      if (room) {
        room.permissions.delete(socket.id);
        room.cursors.delete(socket.id);
        if (room.ownerSocketId === socket.id) {
          const remaining = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
          room.ownerSocketId = remaining[0] || null;
          if (room.ownerSocketId) room.permissions.set(room.ownerSocketId, 'editor');
        }
        if (!io.sockets.adapter.rooms.get(roomId)?.size) {
          roomStates.delete(roomId);
        } else {
          io.to(roomId).emit(ACTIONS.DISCONNECTED, {
            socketId: socket.id,
            username: userSocketMap[socket.id],
            clients: getAllConnectedClients(roomId),
            room: getRoomSnapshot(roomId),
          });
        }
      }
    }
    delete userSocketMap[socket.id];
    delete socket.data.roomId;
    activeRunId += 1;
    isCompiling = false;
    pendingTerminalInput = '';

    if (childProcess) {
      try {
        import('tree-kill').then((tk) => {
          const kill = tk.default || tk;
          kill(childProcess.pid, 'SIGKILL');
        });
      } catch {
        // ignore
      }
    }
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
