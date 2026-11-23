// 3 Nov 2026 (the review of the money unit): MCP submit_stage must not answer a stage that waits for a REPAIR. Its seat already replied and was paid; submit_stage's write would replace that paid usage record with a $0
// external one. Driven through the real server on a REAL run paused for a repair (a mock panel where mock-near-json answers almost JSON), $0. The same test calls run_status on that run: the first MCP read of a run
// folder that holds originals/.
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
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'repair-submit', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const payload = m => { const t = m?.result?.content?.[0]?.text; try { return JSON.parse(t); } catch { return { raw: t ?? JSON.stringify(m) }; } };

// A real run paused for a repair -> { work, id, dir, stage }.
function runPausedForRepair() {
  const work = mkdtempSync(join(tmpdir(), 'thc-repair-submit-'));
  mkdirSync(join(work, 'tasks'), { recursive: true });
  mkdirSync(join(work, 'chains'), { recursive: true });
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small bake sale.\n');
  writeFileSync(join(work, 'chains', 'repair-submit.json'), JSON.stringify({ name: 'repair-submit', description: 'Test: a unanimous mock panel where one judge answers almost JSON.', maxRounds: 2, signoff: 'unanimous', seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-near-json', lab: 'nj' }, { provider: 'mock', model: 'mock-critic-a', lab: 'ok' }] } }));
  const p = spawnSync(process.execPath, [cli, '--chain', 'repair-submit', '--task', 'tasks/t.md'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8', timeout: 60_000 });
  assert.equal(p.status, 3, `fixture: the run paused for a repair: ${p.stdout}${p.stderr}`);
  const id = readdirSync(join(work, 'runs'))[0];
  const dir = join(work, 'runs', id);
  const stage = readdirSync(dir).find(f => /^NEEDS-.*\.md$/.test(f)).replace(/^NEEDS-|\.md$/g, '');
  assert.equal(existsSync(join(dir, `${stage}.repair.json`)), true, 'fixture: it is a repair pause, not an external seat');
  return { work, id, dir, stage };
}

test('M-5 submit_stage refuses a stage that waits for a repair: nothing is written, the paid usage record is byte for byte the same, the pause stays; run_status reads the run folder with originals/ in it', async () => {
  const w = runPausedForRepair();
  const usageBefore = readFileSync(join(w.dir, `${w.stage}.usage.json`), 'utf8');
  const original = readdirSync(join(w.dir, 'originals'));
  const [sub, status] = await mcp(w.work, [
    { name: 'submit_stage', arguments: { run: w.id, stage: w.stage, content: '{"meets": true, "criteria": [], "failures": [], "verdict_line": "All criteria met."}' } },
    { name: 'run_status', arguments: { run: w.id } },
  ]);
  const text = String(payload(sub).error ?? payload(sub).raw ?? '');
  assert.equal(text, `"${w.stage}" is waiting for a repair of the reply its seat already wrote (that reply was paid for), not for a new answer, so nothing was written. Answer it with repair_reply (external_prompt shows the request).`, `the tool answered: ${JSON.stringify(payload(sub)).slice(0, 300)}`);
  assert.equal(readFileSync(join(w.dir, `${w.stage}.usage.json`), 'utf8'), usageBefore, 'the paid usage record is untouched');
  assert.equal(existsSync(join(w.dir, `${w.stage}.md`)), false, 'no answer file');
  assert.equal(existsSync(join(w.dir, `${w.stage}.late.md`)), false, 'no late answer either');
  assert.equal(existsSync(join(w.dir, `${w.stage}.repair.json`)), true, 'the pause stays');
  assert.deepEqual(readdirSync(join(w.dir, 'originals')), original, 'originals/ unchanged');
  const st = payload(status);
  assert.notEqual(st.status, 'refused', `run_status reads a run folder that holds originals/ (${JSON.stringify(st).slice(0, 300)})`);
  assert.equal(st.error, undefined, `run_status gave no error (${JSON.stringify(st).slice(0, 300)})`);
  assert.ok(Array.isArray(st.files) && st.files.includes(`${w.stage}.repair.json`), `run_status read the folder and lists its files (${JSON.stringify(st.files)})`);
});
