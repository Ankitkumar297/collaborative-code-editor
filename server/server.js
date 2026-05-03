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

function getAllConnectedClients(roomId) {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => {
      return {
        socketId,
        username: userSocketMap[socketId],
      };
    }
  );
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);
    const clients = getAllConnectedClients(roomId);
    clients.forEach(({ socketId }) => {
      io.to(socketId).emit(ACTIONS.JOINED, {
        clients,
        username,
        socketId: socket.id,
      });
    });
  });

  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code, language }) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code, language });
  });

  socket.on(ACTIONS.LANGUAGE_CHANGE, ({ roomId, language }) => {
    socket.in(roomId).emit(ACTIONS.LANGUAGE_CHANGE, { language });
  });

  // Interactive Terminal Support
  let childProcess = null;

  socket.on(ACTIONS.CODE_RUN, async ({ code, language }) => {
    // Kill existing process if any
    if (childProcess) {
      try {
        const treeKill = (await import('tree-kill')).default || (await import('tree-kill'));
        treeKill(childProcess.pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }

    try {
      childProcess = await spawnCode(code, language, (data) => {
        socket.emit(ACTIONS.CODE_OUTPUT, data);
      });

      childProcess.on('exit', (code) => {
        socket.emit(ACTIONS.CODE_OUTPUT, `\r\nProcess exited with code ${code}\r\n`);
        childProcess = null;
      });

      childProcess.on('error', (err) => {
        socket.emit(ACTIONS.CODE_OUTPUT, `\r\nProcess error: ${err.message}\r\n`);
        childProcess = null;
      });
    } catch (err) {
      socket.emit(ACTIONS.CODE_OUTPUT, `\r\nExecution Error: ${err.message}\r\n`);
    }
  });

  socket.on(ACTIONS.TERMINAL_INPUT, (input) => {
    if (childProcess && childProcess.stdin.writable) {
      // Convert carriage returns to newlines for the program
      const formattedInput = input.replace(/\r/g, '\n');
      childProcess.stdin.write(formattedInput);
    }
  });

  socket.on('disconnecting', () => {
    const rooms = [...socket.rooms];
    rooms.forEach((roomId) => {
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });
    delete userSocketMap[socket.id];
    socket.leave();

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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
