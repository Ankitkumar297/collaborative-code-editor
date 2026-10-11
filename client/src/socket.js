import { io } from 'socket.io-client';

export const initSocket = () => {
  const options = {
    forceNew: true,
    autoConnect: false,
    reconnectionAttempts: Infinity,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    transports: ['polling', 'websocket'],
  };

  const backendUrl = import.meta.env.VITE_BACKEND_URL ||
    (import.meta.env.PROD
      ? 'https://collaborative-code-editor-backend-s5vg.onrender.com'
      : '');
  return io(backendUrl, options);
};
