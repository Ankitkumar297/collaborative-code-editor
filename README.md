# collaborative-code-editor

Run `npm install`, then `npm run dev` to start both the Socket.IO backend on
port 5001 and the Vite frontend. Open the frontend URL printed by Vite.

For separate terminals, use `npm run server:dev` and `npm run client:dev`.
Leave `VITE_BACKEND_URL` empty in `client/.env` to use the local Vite proxy.
For a separately hosted production frontend, set `VITE_BACKEND_URL` to the
backend's HTTPS origin before building.

The code runner stops programs after 30 seconds and caps terminal output at 1 MB
to keep the editor responsive. Set `CODE_EXECUTION_TIMEOUT_MS` on the backend to
change the run-time limit (milliseconds).
