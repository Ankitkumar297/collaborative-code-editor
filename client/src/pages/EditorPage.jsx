import React, { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import ACTIONS from '../Actions';
import Client from '../components/Client';
import Editor from '../components/Editor';
import { initSocket } from '../socket';
import {
  useLocation,
  useNavigate,
  Navigate,
  useParams,
} from 'react-router-dom';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const EditorPage = () => {
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);
  const codeRef = useRef(null);
  const hasJoined = useRef(false);
  const location = useLocation();
  const { roomId } = useParams();
  const reactNavigator = useNavigate();
  const [clients, setClients] = useState([]);
  const [language, setLanguage] = useState('javascript');
  const languageRef = useRef('javascript');

  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);

  // Initialize Terminal only once
  useEffect(() => {
    if (xtermRef.current) return; // Prevent double init

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#1e1e1e',
      },
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    term.write('\x1b[32mWelcome to CodeCollab Terminal\x1b[0m\r\n');

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      // Send input to the server
      socketRef.current?.emit(ACTIONS.TERMINAL_INPUT, data);
      
      // Local Echo: display what the user typed so they can see it
      if (data === '\r') {
        term.write('\r\n');
      } else if (data === '\u007f') {
        // Handle Backspace (optional but helpful)
        term.write('\b \b');
      } else {
        term.write(data);
      }
    });

    // Handle resize
    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      // We don't dispose here to keep it alive during minor re-renders
      // but if the component truly unmounts, we should.
      // However, for SPA stability, we can manage this carefully.
    };
  }, []);

  // Socket Logic
  useEffect(() => {
    if (hasJoined.current) return;
    hasJoined.current = true;

    const init = async () => {
      const s = await initSocket();
      setSocket(s);
      socketRef.current = s;
      
      socketRef.current.on('connect_error', (err) => {
        console.log('socket error', err);
        toast.error('Socket connection failed, retrying...');
      });

      socketRef.current.emit(ACTIONS.JOIN, {
        roomId,
        username: location.state?.username,
      });

      socketRef.current.on(ACTIONS.JOINED, ({ clients, username, socketId }) => {
        if (username !== location.state?.username) {
          toast.success(`${username} joined the room.`);
          socketRef.current.emit(ACTIONS.SYNC_CODE, {
            code: codeRef.current,
            socketId,
            language: languageRef.current,
          });
        }
        setClients(clients);
      });

      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
        toast.success(`${username} left the room.`);
        setClients((prev) => prev.filter((client) => client.socketId !== socketId));
      });

      socketRef.current.on(ACTIONS.CODE_OUTPUT, (data) => {
        xtermRef.current?.write(data);
      });
    };

    init();

    return () => {
      socketRef.current?.disconnect();
      socketRef.current?.off(ACTIONS.JOINED);
      socketRef.current?.off(ACTIONS.DISCONNECTED);
      socketRef.current?.off(ACTIONS.CODE_OUTPUT);
    };
  }, [roomId]); // Only depend on roomId

  async function copyRoomId() {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success('Room ID has been copied to your clipboard');
    } catch (err) {
      toast.error('Could not copy the Room ID');
      console.error(err);
    }
  }

  function leaveRoom() {
    reactNavigator('/');
  }

  const runCode = () => {
    xtermRef.current?.clear();
    xtermRef.current?.write('\x1b[32mRunning code...\x1b[0m\r\n');
    socketRef.current?.emit(ACTIONS.CODE_RUN, {
      code: codeRef.current,
      language: languageRef.current,
    });
  };

  if (!location.state) {
    return <Navigate to="/" />;
  }

  return (
    <div className="editorPageWrap">
      <div className="aside">
        <div className="asideInner">
          <div className="logo">
            <h2 style={{ color: '#4aee88' }}>CodeCollab</h2>
          </div>
          <h3>Connected</h3>
          <div className="clientsList">
            {clients.map((client) => (
              <Client key={client.socketId} username={client.username} />
            ))}
          </div>
        </div>
        <div className="asideBtns">
          <button className="btn copyBtn" onClick={copyRoomId}>
            Copy ROOM ID
          </button>
          <button className="btn leaveBtn" onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </div>
      <div className="editorContainer">
        <div className="editorHeader">
          <select
            className="languageSelect"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              languageRef.current = e.target.value;
              socketRef.current.emit(ACTIONS.LANGUAGE_CHANGE, {
                roomId,
                language: e.target.value,
              });
            }}
          >
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="c">C</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
          </select>
          <button className="btn runBtn" onClick={runCode}>
            Run Code
          </button>
        </div>
        <div className="editorMain">
          <div className="codeEditor">
            <Editor
              socket={socket}
              roomId={roomId}
              language={language}
              onCodeChange={(code) => {
                codeRef.current = code;
              }}
            />
          </div>
          <div className="terminalContainer">
            <div className="terminal-header">INTERACTIVE TERMINAL</div>
            <div
              ref={terminalRef}
              style={{ height: 'calc(100% - 20px)' }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditorPage;
