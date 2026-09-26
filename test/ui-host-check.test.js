// The local run viewer (src/ui/server.js) answers Host 127.0.0.1:<port> and localhost:<port> only
// (2026-09-25; exact port since 0.7.8).
// Listening on 127.0.0.1 does not stop a web page on another site from reaching it through
// DNS rebinding; the Host header is what such a page cannot fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const server = resolve(here, '../src/ui/server.js');

function get(port, host) {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/runs', headers: { host } }, res => {
      res.resume();
      res.on('end', () => ok(res.statusCode));
    });
    req.on('error', fail);
    req.end();
  });
}

test('the run viewer refuses a non-loopback Host and serves loopback ones', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => {
      child.stdout.on('data', d => { if (String(d).includes('relay viewer')) ok(); });
      child.on('exit', code => fail(new Error(`viewer exited early (${code})`)));
    });
    assert.equal(await get(port, `evil.example:${port}`), 403, 'a rebound hostname is refused');
    assert.equal(await get(port, 'attacker.test'), 403);
    assert.equal(await get(port, `127.0.0.1.evil.example:${port}`), 403, 'a loopback-looking prefix is not loopback');
    assert.equal(await get(port, `127.0.0.1:${port + 1}`), 403, 'another port is not this server');
    assert.equal(await get(port, 'localhost'), 403, 'no port: not how a browser addresses this server');
    assert.equal(await get(port, `[::1]:${port}`), 403, 'the server listens on 127.0.0.1 only');
    assert.equal(await get(port, `127.0.0.1:${port}`), 200);
    assert.equal(await get(port, `localhost:${port}`), 200);
    assert.equal(await get(port, `LocalHost:${port}`), 200, 'host names are case-insensitive');
  } finally {
    child.kill();
  }
});
