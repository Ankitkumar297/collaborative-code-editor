# collaborative-code-editor

Run `npm install`, then `npm run dev` to start both the Socket.IO backend on
port 5001 and the Vite frontend. Open the frontend URL printed by Vite.

For separate terminals, use `npm run server:dev` and `npm run client:dev`.
Leave `VITE_BACKEND_URL` empty in `client/.env` to use the local Vite proxy.
For a separately hosted production frontend, set `VITE_BACKEND_URL` to the
backend's HTTPS origin before building.

Room owners can lock new joins, transfer ownership, or remove a participant.
Use **Export ZIP** to download the current room files. In **Snapshots**, save a
named local snapshot, compare it with the current files, restore it to the room,
or delete it. Snapshots are stored in the browser that created them; restoring a
snapshot replaces the room files for every connected participant.

Use the editor's **Undo** and **Redo** controls (or Ctrl+Z / Ctrl+Y) for the
active file. Those edits sync to collaborators like normal typing. The editor
saves a local workspace draft while you work; after a reconnect it reloads the
room's latest state and safely reapplies local-only changes. If the same file
changed both locally and in the room while disconnected, the room version wins
and the local draft is kept as a snapshot for comparison or recovery.

The project explorer groups files by relative paths such as `src/main.js`.
Use **+ Folder** to create a folder with an initial empty file, then **+ File**
to add more files under the selected folder. File paths are shared with the
room and preserved in ZIP exports and snapshots.

The code runner stops programs after 30 seconds and caps terminal output at 1 MB
to keep the editor responsive. Set `CODE_EXECUTION_TIMEOUT_MS` on the backend to
change the run-time limit (milliseconds).
