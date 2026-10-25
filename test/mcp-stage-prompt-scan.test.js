// MCP `prepare_stage_prompt` (13 Oct 2026, Haiku batch 3 job 6 finding N1, C&C's queue): it wrote stage_prompt.md with the task text RE-READ AT CALL TIME and no key scan, and the bundle's whole point is to be handed to a fresh
// subagent. A key pasted into the task file after the run paused therefore went into the bundle. The bundle now goes through the FULL input scan (secretShapesIn, every shape; the send-time scan reads only the distinctive formats) BEFORE the file is written; over MCP the override is never
// honoured (the tool has no allow flag, and a saved allowSecretShaped in run.json is run-folder data). Driven through the real server on a REAL paused run (mock-external chain), $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const KEY = `sk-or-v1-${'a1b2c3d4'.repeat(8)}`;

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
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stage-prompt-scan', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const payload = m => { const t = m?.result?.content?.[0]?.text; try { return JSON.parse(t); } catch { return { raw: t ?? JSON.stringify(m) }; } };

// A real run paused at its external build stage; `task` is the text the task file holds AFTER the pause (the bundle re-reads it at call time).
function pausedRun(taskAfter) {
  const work = mkdtempSync(join(tmpdir(), 'thc-stageprompt-')); mkdirSync(join(work, 'tasks'), { recursive: true });
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  const p = spawnSync(process.execPath, [cli, '--chain', 'mock-external', '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8' });
  assert.equal(p.status, 3, `fixture: the run paused at its external stage: ${p.stdout}${p.stderr}`);
  const id = readdirSync(join(work, 'runs'))[0];
  writeFileSync(join(work, 'tasks', 't.md'), taskAfter);
  return { work, id, dir: join(work, 'runs', id) };
}

test('prepare_stage_prompt refuses a task text that now holds a key-shaped string: stage_prompt.md is not written, the answer names the format and the line, never the value', async () => {
  const w = pausedRun(`# A plan\n\nPlan a small note-taking app.\n\nMy OpenRouter key is ${KEY}, use it.\n`);
  const [r] = await mcp(w.work, [{ name: 'prepare_stage_prompt', arguments: { run: w.id } }]);
  const a = payload(r);
  assert.equal(existsSync(join(w.dir, 'stage_prompt.md')), false, `no bundle was written (the old tool wrote one holding the key): ${JSON.stringify(a).slice(0, 300)}`);
  const text = String(a.error ?? a.raw ?? '');
  assert.equal(text, 'stage_prompt.md was not written: the task file holds 1 key-shaped string (OpenRouter (sk-or-v1-...); line 5), and the bundle goes to a fresh subagent. Take them out of the task file, then call prepare_stage_prompt again.', `the old tool answered: ${JSON.stringify(a).slice(0, 300)}`);
  assert.ok(!JSON.stringify(a).includes(KEY), 'the value is never echoed');
});

const BEARER = 'Authorization: Bearer abcdefghij0123456789xyz';       // a GENERIC shape: the send-time scan (distinctiveOnly) does not read it, the input scan does

test('a GENERIC shape (a Bearer header) in the task file is refused too, naming the TASK FILE and its own line number (the full input scan, not the send-time one); the value is never echoed; a reserved-host URL password is not a finding', async () => {
  const w = pausedRun(`# A plan\n\nPlan a small note-taking app.\n\n${BEARER}\n`);
  const [r] = await mcp(w.work, [{ name: 'prepare_stage_prompt', arguments: { run: w.id } }]);
  const a = payload(r); const text = String(a.error ?? a.raw ?? '');
  assert.equal(existsSync(join(w.dir, 'stage_prompt.md')), false, `no bundle: ${text.slice(0, 300)}`);
  assert.equal(text, 'stage_prompt.md was not written: the task file holds 1 key-shaped string (Bearer token; line 5), and the bundle goes to a fresh subagent. Take them out of the task file, then call prepare_stage_prompt again.', `the old tool answered: ${JSON.stringify(a).slice(0, 300)}`);
  assert.ok(!JSON.stringify(a).includes('abcdefghij0123456789'), 'the value is never echoed');
  const ok = pausedRun('# A plan\n\nThe database is postgres://app:pw@localhost:5432/notes for the demo.\n');
  const [r2] = await mcp(ok.work, [{ name: 'prepare_stage_prompt', arguments: { run: ok.id } }]);
  assert.ok(payload(r2).written && existsSync(join(ok.dir, 'stage_prompt.md')), `a password on a reserved placeholder host is no finding: ${JSON.stringify(payload(r2)).slice(0, 300)}`);
});

test('a saved allowSecretShaped in run.json does not waive the scan over MCP (the tool has no allow flag)', async () => {
  const w = pausedRun(`# A plan\n\nkey ${KEY}\n`);
  const meta = JSON.parse(readFileSync(join(w.dir, 'run.json'), 'utf8')); meta.allowSecretShaped = true;
  writeFileSync(join(w.dir, 'run.json'), JSON.stringify(meta));
  const [r] = await mcp(w.work, [{ name: 'prepare_stage_prompt', arguments: { run: w.id } }]);
  assert.equal(existsSync(join(w.dir, 'stage_prompt.md')), false, JSON.stringify(payload(r)).slice(0, 300));
});

test('CONTROL: a clean task text still gets its bundle', async () => {
  const w = pausedRun('# A plan\n\nPlan a small note-taking app, version two.\n');
  const [r] = await mcp(w.work, [{ name: 'prepare_stage_prompt', arguments: { run: w.id } }]);
  const a = payload(r);
  assert.ok(a.written && existsSync(join(w.dir, 'stage_prompt.md')), JSON.stringify(a).slice(0, 300));
  assert.ok(readFileSync(join(w.dir, 'stage_prompt.md'), 'utf8').includes('version two'), 'and it carries the task as re-read');
});
