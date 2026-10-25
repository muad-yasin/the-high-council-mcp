// MCP `submit_stage` (14 Oct 2026, Haiku batch 4 A10 F2; Muad 12 Oct 06:19: "the check should go everywhere"). An answer typed for a paused external stage goes into the prompts of the seats that come after it. invoke()'s send-time scan reads only the DISTINCTIVE key formats (it runs
// on prompts that carry model output), so a GENERIC shape (a Bearer header, a URL password, `NAME=secret`) passed. The answer now gets the FULL input scan (the one a task gets) before anything is written or claimed: refused, naming the stage, the formats and the lines, never the value.
// Driven through the real server on a REAL paused run (mock-external chain), $0. This is the MCP route; the CLI route (answers.md) is C's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const BEARER = 'Authorization: Bearer abcdefghij0123456789xyz';       // a generic shape: not read by the send-time scan
const ENVLINE = 'DB_PASSWORD=hunter2hunter2xx';                      // another generic shape (env-style assignment)
const KEY = `sk-or-v1-${'a1b2c3d4'.repeat(8)}`;                       // a distinctive one

function mcp(cwd, calls) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    const byId = new Map(); let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}`)); }, 60_000);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ } }
      if (calls.every((_, i) => byId.has(i + 2))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(calls.map((_, i) => byId.get(i + 2))); }
    });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'submit-stage-scan', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const payload = m => { const t = m?.result?.content?.[0]?.text; try { return JSON.parse(t); } catch { return { raw: t ?? JSON.stringify(m) }; } };

// A real run paused at its external build stage -> { work, id, dir, stage }.
function pausedRun() {
  const work = mkdtempSync(join(tmpdir(), 'thc-submitscan-')); mkdirSync(join(work, 'tasks'), { recursive: true });
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  const p = spawnSync(process.execPath, [cli, '--chain', 'mock-external', '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8' });
  assert.equal(p.status, 3, `fixture: the run paused at its external stage: ${p.stdout}${p.stderr}`);
  const id = readdirSync(join(work, 'runs'))[0]; const dir = join(work, 'runs', id);
  const stage = readdirSync(dir).find(f => /^NEEDS-.*\.md$/.test(f)).replace(/^NEEDS-|\.md$/g, '');
  return { work, id, dir, stage };
}

test('submit_stage refuses an answer holding a GENERIC credential shape (a Bearer header on line 5): nothing is written, the answer names the stage, the format and the line, never the value', async () => {
  const w = pausedRun();
  const [r] = await mcp(w.work, [{ name: 'submit_stage', arguments: { run: w.id, stage: w.stage, content: `# Plan\n\nA small note-taking app.\n\n${BEARER}\n` } }]);
  const a = payload(r); const text = String(a.error ?? a.raw ?? '');
  assert.equal(text, `the answer for "${w.stage}" was not written: it holds 1 key-shaped string (Bearer token; line 5). Take them out of the answer, then submit it again.`, `the old tool answered: ${JSON.stringify(a).slice(0, 300)}`);
  assert.equal(existsSync(join(w.dir, `${w.stage}.md`)), false, 'no stage file'); assert.equal(existsSync(join(w.dir, `${w.stage}.usage.json`)), false, 'no usage file');
  assert.ok(!JSON.stringify(a).includes('abcdefghij0123456789'), 'the value is never echoed');
});

test('several shapes at once are all counted and their formats and lines named; a distinctive key is refused as before; the answer to a LATE (duplicate) submission is scanned too and no .late.md appears', async () => {
  const w = pausedRun();
  const [r] = await mcp(w.work, [{ name: 'submit_stage', arguments: { run: w.id, stage: w.stage, content: `${ENVLINE}\nfine\n${KEY}\n` } }]);
  const text = String(payload(r).error ?? '');
  assert.match(text, new RegExp(`^the answer for "${w.stage}" was not written: it holds 2 key-shaped strings \\(.*; lines 1, 3\\)\\. Take them out of the answer, then submit it again\\.$`), `the old tool answered: ${JSON.stringify(payload(r)).slice(0, 300)}`);
  assert.ok(!text.includes('hunter2hunter2xx') && !text.includes('sk-or-v1-a1b2'));
  // a clean answer is accepted (control), then a dirty duplicate is refused without a .late.md
  const [ok] = await mcp(w.work, [{ name: 'submit_stage', arguments: { run: w.id, stage: w.stage, content: '# Plan\n\nA small note-taking app.\n' } }]);
  assert.ok(payload(ok).written, JSON.stringify(payload(ok)).slice(0, 300));
  const [late] = await mcp(w.work, [{ name: 'submit_stage', arguments: { run: w.id, stage: w.stage, content: `second try\n${BEARER}\n` } }]);
  assert.match(String(payload(late).error ?? ''), /was not written: it holds 1 key-shaped string \(Bearer token; line 2\)/);
  assert.equal(existsSync(join(w.dir, `${w.stage}.late.md`)), false);
});

test('CONTROL: a clean answer is written, a password on a reserved placeholder host (localhost) is no finding, and prose that merely mentions the word "token" is not refused', async () => {
  const w = pausedRun();
  const content = '# Plan\n\nA small note-taking app. The demo database is postgres://app:pw@localhost:5432/notes.\nSessions use a token that expires after an hour.\n';
  const [r] = await mcp(w.work, [{ name: 'submit_stage', arguments: { run: w.id, stage: w.stage, content } }]);
  const a = payload(r); assert.ok(a.written, JSON.stringify(a).slice(0, 300));
  assert.equal(existsSync(join(w.dir, `${w.stage}.md`)), true);
});
