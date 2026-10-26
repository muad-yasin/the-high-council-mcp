// Exit 22 / 23 over MCP (0.8.3, gate note Exit22_Gate_Note.md addendum 1, C&C conditions): src/mcp/server.js reads a run child's exit code in two functions (start_run's spawnRun and the resume that
// submit_stage and resume_run share). Before this change 23 (a layered run stopped at an overseer limit, waiting for the person's choice) and 22 / 7 / 8 (finished, not agreed or security-gated)
// fell into "never started" (started:false / resumed:false), a false record for a run that ran, may have spent money and stopped. Offline: mock chains, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { childEndOf } from '../src/mcp/run-end.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const serverSrc = readFileSync(join(root, 'src', 'mcp', 'server.js'), 'utf8');
const STATE = "stopped, waiting for the person's choice";

function mcpSession(cwd, calls, { timeoutMs = 90_000 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    const want = new Set([1, ...calls.map((_, i) => i + 2)]);
    const byId = new Map();
    let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}`)); }, timeoutMs);
    child.stdout.on('data', d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ }
      }
      if ([...want].every(id => byId.has(id))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(byId); }
    });
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'end-state', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ];
    child.stdin.write(requests.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const body = m => JSON.parse(m.result.content[0].text);
const call = async (dir, name, args) => body((await mcpSession(dir, [{ name, arguments: args }])).get(2));

const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-endstate-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  // the top layer always objects: the run stops at the overseer-round cap (exit 23)
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify({
    name: 'ovc', description: 'test', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [judge('o', 'a', 'l1', 1), judge('o', 'b', 'l2', 2), judge('x', 'c', 'l3', 3)] },
  }));
  return dir;
}
const runIdOf = dir => readdirSync(join(dir, 'runs')).sort()[0];

test('MS-1 childEndOf: 0, 7, 8 and 22 are a FINISHED run (7/8 security-gated, 22 not agreed), 23 is a STOP waiting for the person, 3 is paused at an external seat, no exit event yet is still running, and a child killed by a signal (code null) FAILED, never "running"', () => {
  const ended = code => ({ code, signal: null });
  for (const code of [0, 7, 8, 22]) assert.equal(childEndOf(ended(code)), 'finished', `exit ${code}`);
  assert.equal(childEndOf(ended(23)), 'stopped');
  assert.equal(childEndOf(ended(3)), 'paused');
  assert.equal(childEndOf(null), 'running');
  assert.equal(childEndOf({ code: null, signal: 'SIGKILL' }), 'failed', 'a signal death is a run that died');
  for (const code of [1, 2, 4, 5, 10, 11, 15, 16, 17, 18, 19, 20]) assert.equal(childEndOf(ended(code)), 'failed', `exit ${code}`);
});

test('MS-2 resume_run on a run that is already stopped for the person: resumed:false (nothing resumed), state "stopped, waiting for the person\'s choice", the stop sentence names --continue and --finish, and run_status agrees (awaiting_choice)', async () => {
  const dir = project();
  try {
    const first = spawnSync(process.execPath, [cli, '--chain', 'ovc', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(first.status, 23, first.stdout + first.stderr);
    const run = runIdOf(dir);
    const r = await call(dir, 'resume_run', { run });
    assert.equal(r.resumed, false, JSON.stringify(r));
    assert.equal(r.state, STATE);
    assert.match(r.stop, /--continue/); assert.match(r.stop, /--finish/);
    assert.equal(r.exitCode, 23);
    assert.ok(Array.isArray(r.untrusted_fields) && r.untrusted_fields.includes('stop'), `the stop sentence comes from a project-writable file, so it is named untrusted: ${JSON.stringify(r).slice(0, 400)}`);
    assert.equal((await call(dir, 'run_status', { run })).status, 'awaiting_choice');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MS-4 resume_run on a run stopped for the person whose report-partial.json cannot be read: the CLI rebuilds the stop from the stages on disk at no cost and exits 23 again; the tool answers resumed:true (something ran), run_status ends at awaiting_choice, and the partial report is readable afterwards', async () => {
  // CHANGED ACCEPTED PIN (review fix F7, 18 Okt 2026, C&C ruling b). OLD: resumed:false, 'the CLI exits 23 at once, nothing ran'. NEW: resumed:true; the CLI replays the stages already on disk (zero dollars), re-stops at the same place and rewrites report-partial.json. WHY: a damaged partial report cannot be matched to a typed choice, so a choice-less resume is the way to rebuild it (the ruling: a person is never asked to edit run-folder files by hand). state and exitCode are unchanged.
  const dir = project();
  let childPid = null;
  try {
    const first = spawnSync(process.execPath, [cli, '--chain', 'ovc', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(first.status, 23, first.stdout + first.stderr);
    const run = runIdOf(dir);
    writeFileSync(join(dir, 'runs', run, 'report-partial.json'), '{ not json');
    const r = await call(dir, 'resume_run', { run });
    childPid = r.pid;
    assert.equal(r.resumed, true, JSON.stringify(r));
    // The heal replays the stages on disk, which can take longer than the tool's short wait for the child: the answer then says the run is still running. Either way the run ends stopped and waiting for the choice, which run_status shows once the child is done (polled, bounded).
    assert.ok([STATE, 'running'].includes(r.state), JSON.stringify(r));
    if (r.state === STATE) assert.equal(r.exitCode, 23);
    let status = null;
    for (let k = 0; k < 150 && status !== 'awaiting_choice'; k++) { status = (await call(dir, 'run_status', { run })).status; if (status !== 'awaiting_choice') await new Promise(r2 => setTimeout(r2, 200)); }
    assert.equal(status, 'awaiting_choice', 'the run ended stopped, waiting for the person\'s choice');
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(dir, 'runs', run, 'report-partial.json'), 'utf8')).stop.kind, 'the partial report was rebuilt');
  } finally {
    // the resumed run is a detached child that outlives the tool call (it now REPLAYS to rebuild the partial report): wait for it before the folder goes (a removal under a live writer failed with ENOTEMPTY on the box)
    for (let k = 0; childPid && k < 150; k++) { try { process.kill(childPid, 0); } catch { break; } await new Promise(r2 => setTimeout(r2, 100)); }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });   // ENOTEMPTY is retried: something still finishing a write into the folder is the race this guards
  }
});

test('MS-3 SOURCE pin: server.js takes the exit-code decision from childEndOf at BOTH sites and the stopped code from src/exit-codes.js; no bare code is compared in server.js', () => {
  assert.equal((serverSrc.match(/childEndOf\(/g) ?? []).length, 2, 'spawnRun and resume both call childEndOf');
  assert.match(serverSrc, /import \{[^}]*\bchildEndOf\b[^}]*\} from '\.\/run-end\.js';/);
  assert.equal(/\.code\s*(===|!==|==|!=)\s*(22|23|7|8)\b/.test(serverSrc), false, 'no bare finished or stopped code compared in server.js');
  assert.equal((serverSrc.match(/\.code === 0 \? 'finished'/g) ?? []).length, 0, 'the finished state is no longer decided by a bare 0 at the two sites');
  const runEnd = readFileSync(join(root, 'src', 'mcp', 'run-end.js'), 'utf8');
  assert.match(runEnd, /from '\.\.\/exit-codes\.js'/);
});
