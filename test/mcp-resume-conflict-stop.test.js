// BUG-D-014 (Register_D): resume_run on a run stopped because the conflict decider asked for the person (STOPPED-conflict.json, exit 25) answered resumed:true although nothing ran: the CLI says the run waits and exits 25
// before any run work (src/cli.js, the conflict branch before the replay). The "was it already stopped" test in src/mcp/server.js asked isRoundStop, which is true only for overseer_cap and layer_bound.
// Offline: a mock chain, $0. The run is first stopped at an overseer limit by the real CLI (as in test/mcp-run-end-state.test.js), then its stop files are swapped for the conflict stop the CLI writes (src/cli.js, ConflictAsked branch):
// STOPPED-conflict.json through writeStoppedMarker, and report-partial.json with stop { kind: 'conflict', pass, conflicts }.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { writeStoppedMarker } from '../src/stop-files.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const STATE = "stopped, waiting for the person's choice";
const REASON = 'test stand-in for the conflict stop sentence';

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
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'conflict-stop', version: '0' } } },
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
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-conflictstop-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify({
    name: 'ovc', description: 'test', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [judge('o', 'a', 'l1', 1), judge('o', 'b', 'l2', 2), judge('x', 'c', 'l3', 3)] },
  }));
  return dir;
}

test('CS-1 resume_run on a run stopped by the conflict decider (exit 25) with its stop readable: resumed:false (nothing ran), exitCode 25, the person-choice state, the marker\'s own sentence as the stop, and run_status still awaiting_choice', async () => {
  const dir = project();
  try {
    const first = spawnSync(process.execPath, [cli, '--chain', 'ovc', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(first.status, 23, first.stdout + first.stderr);
    const run = readdirSync(join(dir, 'runs')).sort()[0];
    const runDir = join(dir, 'runs', run);
    // swap the overseer stop for the conflict stop (the files src/cli.js writes at exit 25)
    for (const f of readdirSync(runDir)) if (/^STOPPED-.*\.json$/.test(f)) rmSync(join(runDir, f));
    writeStoppedMarker(runDir, { stoppedBy: 'conflict', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true, reason: REASON });
    const partial = JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8'));
    writeFileSync(join(runDir, 'report-partial.json'), JSON.stringify({ ...partial, stop: { kind: 'conflict', pass: 2, conflicts: [{ n: 1, ids: ['O-a', 'O-b'], labs: ['l1', 'l2'], layers: [1, 2], rounds: [1, 2], silent_round: 2, decider_prevail: 'O-b', decider_reason: 'The earlier fix stands.' }] } }, null, 2));
    const r = await call(dir, 'resume_run', { run });
    assert.equal(r.resumed, false, `a plain resume of a conflict stop ran nothing: ${JSON.stringify(r)}`);
    assert.equal(r.exitCode, 25, JSON.stringify(r));
    assert.equal(r.state, STATE);
    assert.ok(String(r.stop).includes(REASON), `the marker's own sentence (marked untrusted): ${JSON.stringify(r.stop)}`);
    assert.equal((await call(dir, 'run_status', { run })).status, 'awaiting_choice');
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
