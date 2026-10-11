import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnCode } from './execute.service.js';

test('interactive JavaScript runs with the Node executable used by the server', async () => {
  let output = '';
  const child = await spawnCode('console.log("runner-ok")', 'javascript', (chunk) => {
    output += chunk;
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('JavaScript runner did not exit within five seconds'));
    }, 5000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  assert.equal(exitCode, 0);
  assert.match(output, /runner-ok/);
});
