import React, { useEffect, useRef } from 'react';
import Codemirror from 'codemirror';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/dracula.css';

// ── Language modes ───────────────────
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/python/python';
import 'codemirror/mode/clike/clike';

// ── VS Code features ─────────────────
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/addon/edit/closetag';
import 'codemirror/addon/edit/matchbrackets';
import 'codemirror/addon/selection/active-line';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/fold/foldcode';
import 'codemirror/addon/fold/brace-fold';
import 'codemirror/addon/fold/comment-fold';
import 'codemirror/addon/fold/indent-fold';
import 'codemirror/addon/fold/foldgutter.css';
import 'codemirror/addon/search/search';
import 'codemirror/addon/search/searchcursor';
import 'codemirror/addon/search/jump-to-line';
import 'codemirror/addon/dialog/dialog';
import 'codemirror/addon/dialog/dialog.css';
import 'codemirror/addon/comment/comment';
import 'codemirror/addon/scroll/scrollpastend';
import 'codemirror/addon/hint/show-hint';
import 'codemirror/addon/hint/show-hint.css';
import 'codemirror/addon/hint/javascript-hint';
import 'codemirror/addon/hint/anyword-hint';

import ACTIONS from '../Actions';

const Editor = ({ socket, roomId, onCodeChange, language }) => {
  const editorRef = useRef(null);
  const textareaRef = useRef(null);
  const socketRef = useRef(socket);

  // Keep socketRef in sync with the socket prop
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    if (!textareaRef.current) return;

    const getMode = (lang) => {
      switch (lang) {
        case 'python': return 'python';
        case 'c': return 'text/x-csrc';
        case 'cpp':
        case 'c++': return 'text/x-c++src';
        case 'java': return 'text/x-java';
        default: return 'javascript';
      }
    };

    editorRef.current = Codemirror.fromTextArea(textareaRef.current, {
      mode: getMode(language),
      theme: 'dracula',
      autoCloseBrackets: true,
      autoCloseTags: true,
      matchBrackets: true,
      lineNumbers: true,
      styleActiveLine: true,
      foldGutter: true,
      gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      extraKeys: {
        'Ctrl-Space': 'autocomplete',
        'Ctrl-/': 'toggleComment',
        'Cmd-/': 'toggleComment',
      },
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      smartIndent: true,
      lineWrapping: true,
      scrollPastEnd: true,
    });

    editorRef.current.on('change', (instance, changes) => {
      const { origin } = changes;
      const code = instance.getValue();
      onCodeChange(code);
      if (origin !== 'setValue') {
        // Use socketRef to ensure we have the latest socket instance
        socketRef.current?.emit(ACTIONS.CODE_CHANGE, {
          roomId,
          code,
        });
      }
    });

    return () => {
      editorRef.current?.toTextArea();
    };
  }, []);

  // Handle language change
  useEffect(() => {
    if (editorRef.current) {
      const getMode = (lang) => {
        switch (lang) {
          case 'python': return 'python';
          case 'c': return 'text/x-csrc';
          case 'cpp':
          case 'c++': return 'text/x-c++src';
          case 'java': return 'text/x-java';
          default: return 'javascript';
        }
      };
      editorRef.current.setOption('mode', getMode(language));
    }
  }, [language]);

  // Handle code synchronization
  useEffect(() => {
    if (socket) {
      socket.on(ACTIONS.CODE_CHANGE, ({ code }) => {
        if (code !== null && code !== editorRef.current.getValue()) {
          editorRef.current.setValue(code);
        }
      });
    }

    return () => {
      socket?.off(ACTIONS.CODE_CHANGE);
    };
  }, [socket]);

  return <textarea id="realtimeEditor" ref={textareaRef}></textarea>;
};

export default Editor;
