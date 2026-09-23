import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function startApi(port) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/index.js', import.meta.url))], {
    env: {
      ...process.env, PORT: String(port), AI_MODE: 'template', OPENAI_API_KEY: '',
      DB_PATH: join(mkdtempSync(join(tmpdir(), 'ai-sana-startup-')), 'test.sqlite'),
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, closed };
}

test('occupied API port reports an error and never announces a successful start', { timeout: 15000 }, async (t) => {
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, resolve));
  const port = occupied.address().port;
  const { child, closed } = startApi(port);
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    await new Promise((resolve) => occupied.close(resolve));
  });
  const result = await closed;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /EADDRINUSE/);
  assert.ok(result.stderr.includes(String(port)));
  assert.doesNotMatch(result.stdout, /API listening/);
  assert.equal(occupied.listening, true);
});

test('successful startup remains running and serves health on the reported port', { timeout: 15000 }, async (t) => {
  const { child, closed } = startApi(0);
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  });
  const ready = new Promise((resolve) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/API listening on http:\/\/localhost:(\d+)/);
      if (match) resolve(Number(match[1]));
    });
  });
  const port = await Promise.race([ready, closed.then((result) => {
    throw new Error(`API exited before readiness: ${result.code} ${result.stderr}`);
  })]);
  assert.ok(port > 0);
  const response = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', db: 'ok' });
  assert.equal(child.exitCode, null);
});
