// T7 (owner, via C&C 18 Okt 2026: "Remove it, so nobody can send a task that contains a key"): the JS API's run() and resume() no longer take `allowSecretShaped`. A caller written for 0.8.2 that still passes it is
// refused loudly (code ERR_OPTION_REMOVED) before any run folder exists, and a key-shaped task stops the run at the scan (exit 11). The CLI flag stays for a person at a terminal (test/outbound-scan.test.js). Offline, mock chain, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '../src/api.js';

const KEY = ['sk', '-ant-api03-', Array.from({ length: 40 }, (_, i) => 'aZ3kQ9xB'[i % 8]).join('')].join('');   // assembled at runtime, as test/outbound-scan.test.js does
function workdir(text = 'Plan a small todo app.\n') {
  const dir = mkdtempSync(join(tmpdir(), 'thc-api-secret-'));
  writeFileSync(join(dir, '.env'), '');
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), `# Task\n\n${text}`);
  return dir;
}

test('T7-1: run() with allowSecretShaped: true rejects with ERR_OPTION_REMOVED and its plain sentence, before any run folder exists, even for a key-shaped task', async () => {
  const dir = workdir(`Plan a small app.\n${KEY}\n`);
  await assert.rejects(api.run({ chain: 'mock', task: 'tasks/x.md', cwd: dir, allowSecretShaped: true }), e => e.code === 'ERR_OPTION_REMOVED' && /allowSecretShaped was removed in 0\.8\.3/.test(e.message) && /--allow-secret-shaped/.test(e.message));
  assert.equal(existsSync(join(dir, 'runs')), false, 'nothing ran, nothing was created');
});

test('T7-2: without the option a key-shaped task still stops the run at the scan (exit 11), and a clean task runs', async () => {
  const bad = workdir(`Plan a small app.\n${KEY}\n`);
  const r = await api.run({ chain: 'mock', task: 'tasks/x.md', cwd: bad });
  assert.equal(r.exitCode, 11, r.outputTail);
  const ok = workdir();
  assert.equal((await api.run({ chain: 'mock', task: 'tasks/x.md', cwd: ok })).exitCode, 0);
  // C&C ruling: `false` states the default (scan on), so it is accepted and drops no intent; the scan still stops the key.
  const falseKey = await api.run({ chain: 'mock', task: 'tasks/x.md', cwd: workdir(`Plan a small app.\n${KEY}\n`), allowSecretShaped: false });
  assert.equal(falseKey.exitCode, 11, falseKey.outputTail);
  assert.equal((await api.run({ chain: 'mock', task: 'tasks/x.md', cwd: workdir(), allowSecretShaped: false })).exitCode, 0);
});

test('T7-3: resume() with allowSecretShaped rejects with ERR_OPTION_REMOVED; without it a resume works as before', async () => {
  const dir = workdir();
  const first = await api.run({ chain: 'mock', task: 'tasks/x.md', cwd: dir });
  assert.equal(first.exitCode, 0, first.outputTail);
  await assert.rejects(api.resume({ runDir: first.runDir, cwd: dir, allowSecretShaped: true }), e => e.code === 'ERR_OPTION_REMOVED');
  const again = await api.resume({ runDir: first.runDir, cwd: dir });
  assert.equal(typeof again.exitCode, 'number');
});
