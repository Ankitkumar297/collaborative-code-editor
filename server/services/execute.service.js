import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.join(__dirname, '../temp');
const configuredRunTimeoutMs = Number.parseInt(process.env.CODE_EXECUTION_TIMEOUT_MS || '', 10);
const maxProgramRunMs = Number.isSafeInteger(configuredRunTimeoutMs) && configuredRunTimeoutMs > 0
  ? configuredRunTimeoutMs
  : 30000;
const maxProgramOutputBytes = 1024 * 1024;
const isWin = process.platform === 'win32';
const exeExt = isWin ? '.exe' : '.out';
const normalizeLanguage = (language) => ({
  js: 'javascript', py: 'python', 'c++': 'cpp', ts: 'typescript',
  'node.js': 'node', 'c#': 'csharp',
})[String(language || '').toLowerCase()] || String(language || '').toLowerCase();

const runCommand = (command, args, timeout = 30000) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) return reject(new Error(stderr || stdout || error.message));
    resolve({ stdout, stderr });
  });
});

const compileWithStatus = async (command, args, language, onData) => {
  onData(`Compiling ${language}...\r\n`);
  const startedAt = process.hrtime.bigint();
  await runCommand(command, args);
  const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
  onData(`Compiled ${language} in ${elapsedSeconds.toFixed(2)}s\r\n`);
};

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Spawns a process for interactive execution (real-time I/O)
 */
export const spawnCode = async (code, language, onData) => {
  language = normalizeLanguage(language);
  const jobId = uuidv4();
  let filepath, executeCommand, args = [];

  if (language === 'javascript' || language === 'js') {
    filepath = path.join(tempDir, `${jobId}.js`);
    fs.writeFileSync(filepath, code);
    // Use the exact Node binary running this service. Render and other hosts
    // may not expose the same executable name through the child-process PATH.
    executeCommand = process.execPath;
    args = [filepath];
  } else if (language === 'python' || language === 'py') {
    filepath = path.join(tempDir, `${jobId}.py`);
    fs.writeFileSync(filepath, code);
    executeCommand = isWin ? 'python' : 'python3';
    // Python block-buffers stdout when it is connected to a pipe. Unbuffered
    // mode keeps print() output visible while an interactive loop is running.
    args = ['-u', filepath];
  } else if (language === 'c') {
    filepath = path.join(tempDir, `${jobId}.c`);
    const outpath = path.join(tempDir, `${jobId}${exeExt}`);
    fs.writeFileSync(filepath, code);
    
    await compileWithStatus('gcc', ['-O2', filepath, '-o', outpath], 'C', onData);
    executeCommand = outpath;
  } else if (language === 'cpp' || language === 'c++') {
    filepath = path.join(tempDir, `${jobId}.cpp`);
    const outpath = path.join(tempDir, `${jobId}${exeExt}`);
    fs.writeFileSync(filepath, code);
    
    await compileWithStatus('g++', ['-O2', filepath, '-o', outpath], 'C++', onData);
    executeCommand = outpath;
  } else if (language === 'java') {
    filepath = path.join(tempDir, `Main_${jobId.replace(/-/g, '')}.java`);
    const className = path.basename(filepath, '.java');
    const javaCode = code.replace(/public\s+class\s+\w+/, `public class ${className}`);
    fs.writeFileSync(filepath, javaCode);
    
    await compileWithStatus('javac', [filepath], 'Java', onData);
    executeCommand = 'java';
    args = ['-cp', tempDir, className];
  } else if (language === 'typescript') {
    filepath = path.join(tempDir, `${jobId}.ts`);
    fs.writeFileSync(filepath, code);
    executeCommand = process.execPath;
    args = ['--experimental-transform-types', filepath];
  } else if (language === 'node') {
    // Node.js examples commonly use require(); .cjs keeps them working even
    // though the application itself is configured as ESM.
    filepath = path.join(tempDir, `${jobId}.cjs`);
    fs.writeFileSync(filepath, code);
    executeCommand = process.execPath;
    args = [filepath];
  } else if (language === 'csharp') {
    throw new Error('C# execution requires the .NET SDK (dotnet) installed on the server.');
  } else {
    throw new Error(`Language ${language} not supported for interactive execution`);
  }

  // Keep all three streams piped so interactive stdin is writable and output is
  // consistently captured across Windows and Linux hosts.
  const child = spawn(executeCommand, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let outputBytes = 0;
  let outputBuffer = '';
  let outputFlushTimer = null;
  let stopReason = '';
  const flushOutput = () => {
    if (outputFlushTimer) clearTimeout(outputFlushTimer);
    outputFlushTimer = null;
    if (!outputBuffer) return;
    const pendingOutput = outputBuffer;
    outputBuffer = '';
    onData(pendingOutput);
  };

  const executionTimer = setTimeout(() => {
    stopReason = `Execution timed out after ${maxProgramRunMs / 1000} seconds. Check for an infinite loop.`;
    flushOutput();
    onData(`\r\n${stopReason}\r\n`);
    child.kill('SIGKILL');
  }, maxProgramRunMs);
  executionTimer.unref();

  const forwardOutput = (data) => {
    if (stopReason) return;
    outputBytes += Buffer.byteLength(data);
    if (outputBytes > maxProgramOutputBytes) {
      stopReason = 'Output exceeded 1 MB. Stopping the program to keep the editor responsive.';
      flushOutput();
      onData(`\r\n${stopReason}\r\n`);
      child.kill('SIGKILL');
      return;
    }
    outputBuffer += data;
    if (!outputFlushTimer) outputFlushTimer = setTimeout(flushOutput, 25);
  };

  child.stdout.on('data', (data) => forwardOutput(data.toString()));
  child.stderr.on('data', (data) => forwardOutput(data.toString()));

  // Cleanup on exit
  child.on('close', () => {
    clearTimeout(executionTimer);
    flushOutput();
    try {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      const outputPath = filepath.replace(/\.(c|cpp)$/, exeExt);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
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
  language = normalizeLanguage(language);
  const jobId = uuidv4();
  let filepath, compileArgs, compileCommand, executeCommand, executeArgs = [];

  if (language === 'javascript' || language === 'js') {
    filepath = path.join(tempDir, `${jobId}.js`);
    fs.writeFileSync(filepath, code);
    executeCommand = process.execPath;
    executeArgs = [filepath];
  } else if (language === 'python' || language === 'py') {
    filepath = path.join(tempDir, `${jobId}.py`);
    fs.writeFileSync(filepath, code);
    executeCommand = isWin ? 'python' : 'python3';
    executeArgs = ['-u', filepath];
  } else if (language === 'c') {
    filepath = path.join(tempDir, `${jobId}.c`);
    const outpath = path.join(tempDir, `${jobId}.exe`);
    fs.writeFileSync(filepath, code);
    compileCommand = 'gcc';
    compileArgs = ['-O2', filepath, '-o', outpath];
    executeCommand = outpath;
  } else if (language === 'cpp' || language === 'c++') {
    filepath = path.join(tempDir, `${jobId}.cpp`);
    const outpath = path.join(tempDir, `${jobId}.exe`);
    fs.writeFileSync(filepath, code);
    compileCommand = 'g++';
    compileArgs = ['-O2', filepath, '-o', outpath];
    executeCommand = outpath;
  } else if (language === 'java') {
    filepath = path.join(tempDir, `Main_${jobId.replace(/-/g, '')}.java`);
    const className = path.basename(filepath, '.java');
    fs.writeFileSync(filepath, code.replace(/public\s+class\s+\w+/, `public class ${className}`));
    compileCommand = 'javac';
    compileArgs = [filepath];
    executeCommand = 'java';
    executeArgs = ['-cp', tempDir, className];
  } else if (language === 'typescript') {
    filepath = path.join(tempDir, `${jobId}.ts`);
    fs.writeFileSync(filepath, code);
    executeCommand = process.execPath;
    executeArgs = ['--experimental-transform-types', filepath];
  } else if (language === 'node') {
    filepath = path.join(tempDir, `${jobId}.cjs`);
    fs.writeFileSync(filepath, code);
    executeCommand = process.execPath;
    executeArgs = [filepath];
  } else if (language === 'csharp') {
    throw new Error('C# execution requires the .NET SDK (dotnet) installed on the server.');
  } else {
    throw new Error(`Language ${language} not supported`);
  }

  return new Promise((resolve, reject) => {
    const run = () => {
      execFile(executeCommand, executeArgs, { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        // Cleanup
        try {
          if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
          const outpath = filepath.replace(/\.(c|cpp)$/, exeExt);
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
      execFile(compileCommand, compileArgs, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
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
