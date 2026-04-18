import React, { useEffect, useRef } from "react";
import Codemirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/dracula.css";
import "codemirror/mode/javascript/javascript";
import ACTIONS from "../Actions";

const Editor = ({ socketRef, roomId, onCodeChange }) => {
  const editorRef = useRef(null);

  useEffect(() => {
    // ✅ create editor
    const textarea = document.getElementById("realTimeEditor");

    if (!textarea) {
      console.log("Textarea not found ❌");
      return;
    }

    editorRef.current = Codemirror.fromTextArea(textarea, {
      mode: "javascript",
      theme: "dracula",
      lineNumbers: true,
    });
    

    console.log("Editor initialized ✅");

    // ✅ attach change listener AFTER init
    editorRef.current.on("change", (instance, changes) => {
      //console.log("🔥 CHANGES DETECTED:", changes);

      const { origin } = changes;
      const code = instance.getValue();
      onCodeChange(code);

      if (origin !== "setValue") {
        socketRef.current?.emit(ACTIONS.CODE_CHANGE, {
          roomId,
          code,
        });
      }
    });

    // ✅ receive code
    

  }, []);
  useEffect(()=>{
    if (socketRef.current) {
      socketRef.current.on(ACTIONS.CODE_CHANGE, ({ code }) => {
        if (code !== null) {
          editorRef.current.setValue(code);
        }
      });

    }
    return ()=>{
      socketRef.current.off(ACTIONS.CODE_CHANGE);
    };

  },[socketRef.current])

  return <textarea id="realTimeEditor"></textarea>;
};

export default Editor;