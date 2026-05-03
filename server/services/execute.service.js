import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.join(__dirname, '../temp');

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Spawns a process for interactive execution (real-time I/O)
 */
export const spawnCode = async (code, language, onData) => {
  const jobId = uuidv4();
  let filepath, executeCommand, args = [];

  if (language === 'javascript' || language === 'js') {
    filepath = path.join(tempDir, `${jobId}.js`);
    fs.writeFileSync(filepath, code);
    executeCommand = 'node';
    args = [filepath];
  } else if (language === 'python' || language === 'py') {
    filepath = path.join(tempDir, `${jobId}.py`);
    fs.writeFileSync(filepath, code);
    executeCommand = 'python';
    args = [filepath];
  } else if (language === 'c') {
    filepath = path.join(tempDir, `${jobId}.c`);
    const outpath = path.join(tempDir, `${jobId}.exe`);
    fs.writeFileSync(filepath, code);
    
    // Compile synchronously for simplicity in spawn mode
    await new Promise((resolve, reject) => {
      exec(`gcc "${filepath}" -o "${outpath}"`, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || stdout));
        else resolve();
      });
    });
    executeCommand = outpath;
  } else if (language === 'cpp' || language === 'c++') {
    filepath = path.join(tempDir, `${jobId}.cpp`);
    const outpath = path.join(tempDir, `${jobId}.exe`);
    fs.writeFileSync(filepath, code);
    
    await new Promise((resolve, reject) => {
      exec(`g++ "${filepath}" -o "${outpath}"`, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || stdout));
        else resolve();
      });
    });
    executeCommand = outpath;
  } else if (language === 'java') {
    filepath = path.join(tempDir, `Main_${jobId.replace(/-/g, '')}.java`);
    const className = path.basename(filepath, '.java');
    const javaCode = code.replace(/public\s+class\s+\w+/, `public class ${className}`);
    fs.writeFileSync(filepath, javaCode);
    
    await new Promise((resolve, reject) => {
      exec(`javac "${filepath}"`, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || stdout));
        else resolve();
      });
    });
    executeCommand = 'java';
    args = ['-cp', tempDir, className];
  } else {
    throw new Error(`Language ${language} not supported for interactive execution`);
  }

  const child = spawn(executeCommand, args);

  child.stdout.on('data', (data) => onData(data.toString()));
  child.stderr.on('data', (data) => onData(data.toString()));

  // Cleanup on exit
  child.on('close', () => {
    try {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      const outpath = filepath.replace(/\.(c|cpp|java)$/, '.exe').replace(/\.java$/, '.class');
      if (fs.existsSync(outpath)) fs.unlinkSync(outpath);
      if (language === 'java') {
        const classFile = path.join(tempDir, `${path.basename(filepath, '.java')}.class`);
        if (fs.existsSync(classFile)) fs.unlinkSync(classFile);
      }
    } catch {
      // Silent cleanup
    }
  });

  return child;
};

/**
 * Legacy non-interactive execution (standard request-response)
 */
export const executeCode = async (code, language) => {
  const jobId = uuidv4();
  let filepath, compileCommand, executeCommand;

  if (language === 'javascript' || language === 'js') {
    filepath = path.join(tempDir, `${jobId}.js`);
    fs.writeFileSync(filepath, code);
    executeCommand = `node "${filepath}"`;
  } else if (language === 'python' || language === 'py') {
    filepath = path.join(tempDir, `${jobId}.py`);
    fs.writeFileSync(filepath, code);
    executeCommand = `python "${filepath}"`;
  } else if (language === 'c') {
    filepath = path.join(tempDir, `${jobId}.c`);
    const outpath = path.join(tempDir, `${jobId}.exe`);
    fs.writeFileSync(filepath, code);
    compileCommand = `gcc "${filepath}" -o "${outpath}"`;
    executeCommand = `"${outpath}"`;
  } else if (language === 'cpp' || language === 'c++') {
    filepath = path.join(tempDir, `${jobId}.cpp`);
    const outpath = path.join(tempDir, `${jobId}.exe`);
    fs.writeFileSync(filepath, code);
    compileCommand = `g++ "${filepath}" -o "${outpath}"`;
    executeCommand = `"${outpath}"`;
  } else {
    throw new Error(`Language ${language} not supported`);
  }

  return new Promise((resolve, reject) => {
    const run = () => {
      exec(executeCommand, { timeout: 15000 }, (error, stdout, stderr) => {
        // Cleanup
        try {
          if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
          const outpath = filepath.replace(/\.(c|cpp)$/, '.exe');
          if (fs.existsSync(outpath)) fs.unlinkSync(outpath);
        } catch {
          // ignore
        }

        if (error) {
          if (error.killed) return reject({ message: 'Execution timed out (15s)' });
          return reject({ message: stderr || stdout || error.message });
        }
        resolve(stdout + stderr);
      });
    };

    if (compileCommand) {
      exec(compileCommand, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
          try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch { /* ignore */ }
          return reject({ message: `Compilation Error: ${stderr || stdout}` });
        }
        run();
      });
    } else {
      run();
    }
  });
};
