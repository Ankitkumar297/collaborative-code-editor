import express from "express";
import http from "http";
import { Server } from "socket.io";
import ACTIONS from "./Actions.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
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

io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  // JOIN
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
  socket.on(ACTIONS.CODE_CHANGE,({roomId,code})=>{
    
    socket.to(roomId).emit(ACTIONS.CODE_CHANGE,{code});
  });
   socket.on(ACTIONS.SYNC_CODE,({socketId,code})=>{
    
    io.to(socketId).emit(ACTIONS.CODE_CHANGE,{code});
  });

  // LEAVE (manual button)
  socket.on(ACTIONS.LEAVE, ({ roomId, username }) => {
    socket.leave(roomId);

    socket.to(roomId).emit(ACTIONS.DISCONNECTED, {
      socketId: socket.id,
      username,
    });

    delete userSocketMap[socket.id];
  });

  // DISCONNECT (refresh / tab close)
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];

    rooms.forEach((roomId) => {
      socket.to(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });

    delete userSocketMap[socket.id];
  });
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});