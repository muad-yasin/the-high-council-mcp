// run_status long-poll (brief 26 prototype): wait_seconds holds the call until a stage finishes, the
// run changes state or the time is up; `since` is a cursor into stage-log.jsonl; a progressToken
// gets notifications/progress. Offline: mock seats with COUNCIL_MOCK_DELAY_MS, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');

// One server session; calls run in order, each after the previous answer, so a later call sees what an
// earlier one started. Notifications are collected next to the answers.
function session(cwd, calls, { delay = 0, timeoutMs = 60_000 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, COUNCIL_MOCK_DELAY_MS: String(delay) } });
    const answers = new Map(); const notes = [];
    let buf = ''; let next = 0;
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ${[...answers.keys()]}`)); }, timeoutMs);
    const send = m => child.stdin.write(JSON.stringify(m) + '\n');
    const sendNext = () => {
      if (next >= calls.length) { clearTimeout(timer); child.stdin.end(); child.kill(); return done({ answers, notes }); }
      const c = calls[next++]; const at = Date.now();
      answers.set(next + 1, { at });
      send({ jsonrpc: '2.0', id: next + 1, method: 'tools/call', params: c });
    };
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.method === 'notifications/progress') notes.push(m.params);
        else if (m.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); sendNext(); }
        else if (m.id !== undefined) { const a = answers.get(m.id); a.ms = Date.now() - a.at; a.body = JSON.parse(m.result.content[0].text); sendNext(); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wait-test', version: '0' } } });
  });
}
const bodies = r => [...r.answers.entries()].filter(([id]) => id > 1).map(([, a]) => a);

// Hold until the run is over, so no detached child is still writing when the folder is removed.
async function settle(dir, run) {
  for (let i = 0; i < 12; i++) {
    const s = await session(dir, [{ name: 'run_status', arguments: { run, wait_seconds: 5 } }], { delay: 400 });
    if (bodies(s)[0].body.progress.settled) return;
  }
  assert.fail('the run never settled');
}

function workdir() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-wait-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  return dir;
}

test('run_status without wait_seconds keeps its shape: no progress key', async () => {
  const dir = workdir();
  try {
    const r = await session(dir, [
      { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md' } },
    ]);
    const run = bodies(r)[0].body.run;
    const r2 = await session(dir, [{ name: 'run_status', arguments: { run } }]);
    assert.equal('progress' in bodies(r2)[0].body, false);
    await settle(dir, run);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run_status wait_seconds returns as soon as a stage finishes, with a cursor, and since gives only what is new', async () => {
  const dir = workdir();
  try {
    const r = await session(dir, [{ name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md' } }], { delay: 400 });
    const run = bodies(r)[0].body.run;
    const first = await session(dir, [{ name: 'run_status', arguments: { run, wait_seconds: 10, since: 0 } }], { delay: 400 });
    const a = bodies(first)[0];
    assert.ok(a.body.progress.events.length >= 1, 'a stage finished while it waited or before');
    assert.ok(a.ms < 9_000, `returned early, not after the full hold (${a.ms} ms)`);
    const cursor = a.body.progress.cursor;
    const second = await session(dir, [{ name: 'run_status', arguments: { run, wait_seconds: 10, since: cursor } }], { delay: 400 });
    const b = bodies(second)[0].body.progress;
    assert.ok(b.cursor >= cursor);
    for (const e of b.events) assert.ok(e.stage, 'each event names its stage');
    await settle(dir, run);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run_status wait_seconds on a finished run returns at once and says settled', async () => {
  const dir = workdir();
  try {
    const r = await session(dir, [{ name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md' } }]);
    const run = bodies(r)[0].body.run;
    await settle(dir, run);
    const s = await session(dir, [{ name: 'run_status', arguments: { run, wait_seconds: 30 } }]);
    const a = bodies(s)[0];
    assert.equal(a.body.progress.settled, true);
    assert.equal(a.body.progress.status, 'done');
    assert.equal(a.body.progress.timedOut, false);
    assert.ok(a.ms < 5_000, `did not hold a finished run (${a.ms} ms)`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run_status with a progressToken sends notifications/progress whose progress rises', async () => {
  const dir = workdir();
  try {
    const r = await session(dir, [{ name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md' } }], { delay: 400 });
    const run = bodies(r)[0].body.run;
    const s = await session(dir, [{ name: 'run_status', arguments: { run, wait_seconds: 10, since: 0 }, _meta: { progressToken: 'tok1' } }], { delay: 400 });
    assert.ok(s.notes.length >= 1, 'at least one progress notification');
    assert.equal(s.notes[0].progressToken, 'tok1');
    for (let i = 1; i < s.notes.length; i++) assert.ok(s.notes[i].progress > s.notes[i - 1].progress);
    await settle(dir, run);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('until=settled holds across finished calls, sends several rising progress notifications during the hold, and returns once', async () => {
  const dir = workdir();
  try {
    const r = await session(dir, [{ name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md' } }], { delay: 300 });
    const run = bodies(r)[0].body.run;
    const s = await session(dir, [{ name: 'run_status', arguments: { run, wait_seconds: 30, since: 0, until: 'settled' }, _meta: { progressToken: 'tok2' } }], { delay: 300 });
    const a = bodies(s)[0];
    assert.equal(a.body.progress.settled, true);
    assert.equal(a.body.progress.status, 'done');
    assert.ok(a.body.progress.events.length >= 4, 'every stage-log line since 0 came back in one answer');
    assert.equal(a.body.progress.cursor, a.body.progress.events.length);
    assert.ok(s.notes.length >= 2, `several notifications during one hold (got ${s.notes.length})`);
    for (let i = 1; i < s.notes.length; i++) assert.ok(s.notes[i].progress > s.notes[i - 1].progress, 'progress rises');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a bare since answers at once from the cursor, and a run paused at an external seat settles with status paused', async () => {
  const dir = workdir();
  try {
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'chains', 'ext-build.json'), JSON.stringify({
      name: 'ext-build', description: 'test', maxRounds: 1, signoff: 'unanimous',
      estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'external', model: 'claude-code-session', lab: 'ext' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'mb' }] },
    }));
    const r = await session(dir, [{ name: 'start_run', arguments: { chain: 'ext-build', task: 'tasks/t.md' } }]);
    const run = bodies(r)[0].body.run;
    const s = await session(dir, [
      { name: 'run_status', arguments: { run, since: 0 } },
      { name: 'run_status', arguments: { run, wait_seconds: 10, since: 0 } },
    ]);
    const [bare, held] = bodies(s);
    assert.ok(bare.ms < 3_000, 'a bare since does not hold');
    assert.equal(held.body.progress.status, 'paused');
    assert.equal(held.body.progress.settled, true);
    assert.deepEqual(held.body.waitingFor, ['build']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
