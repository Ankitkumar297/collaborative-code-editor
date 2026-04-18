// src/socket.js
import { io } from "socket.io-client";

export const initSocket = async () => {
  const socket = io("http://localhost:5000", {
    transports: ["websocket"],
  });
  return socket;
};