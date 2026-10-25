// Bug audit 2026-09-28 (area 4 MED-1): an aborted api.run() rejected with a bare AbortError before
// the child exited, so the caller could not tell which run to resume, and the run still read as
// running. The rejection now carries runId/runDir and comes after the process exits. A loopback
// Ollama-shaped stub that never answers; no keys, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, listRuns } from '../src/api.js';

test('an aborted run rejects after its process exits, naming the run folder', async () => {
  const srv = http.createServer(() => { /* never answers */ });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'thc-api-abort-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, '.env'), '');
    writeFileSync(join(dir, 'tasks', 't.md'), 'A test task.');
    const hang = { provider: 'ollama', model: 'llama3.3', baseUrl: `http://127.0.0.1:${srv.address().port}/v1` };
    writeFileSync(join(dir, 'chains', 'hang.json'), JSON.stringify({ name: 'hang', maxRounds: 1, seats: { criteria: hang, builder: hang, critics: [{ ...hang, lab: 'x' }] } }));
    const ac = new AbortController();
    // 13 Oct 2026 (Flaky addition, C&C): the abort used to fire at a fixed 2.5 s, and under the CPU cap the child had not made its run folder yet
    // (err.runDir null): a race against the machine, not the behaviour named above. FIX-UP 1b (C&C's batch suite, same day): the first rework waited for the
    // run FOLDER, but the child makes the folder (src/cli.js mkdirSync) well before it writes run.json, and the status reader judges whether a run is alive from
    // run.json's pid (src/run-status.js deriveRunStatus; with no run.json it falls back to a machine-wide pgrep for src/cli.js). An abort that lands in
    // between leaves nothing to judge by, and any other council process on the machine (a parallel test) reads as this run still 'running'. The abort now waits for
    // the file the status reader needs: run.json. The 20 s is a hang guard (no run.json ever appeared), not a timing the test depends on.
    const pending = run({ chain: 'hang', task: 'tasks/t.md', cwd: dir, signal: ac.signal });
    const folders = () => { try { return readdirSync(join(dir, 'runs')); } catch { return []; } };
    const started = () => folders().length === 1 && existsSync(join(dir, 'runs', folders()[0], 'run.json'));
    for (const t0 = Date.now(); !started() && Date.now() - t0 < 20_000;) await new Promise(r => setTimeout(r, 25));
    const made = folders(); const ready = started();
    ac.abort();
    let err;
    try { await pending; } catch (e) { err = e; }
    assert.ok(ready, 'one run folder with its run.json existed before the abort (the 20 s hang guard ran out otherwise)');
    assert.equal(err?.name, 'AbortError', String(err));
    assert.match(err.runId, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(err.runDir && existsSync(err.runDir), `runDir ${err.runDir}`);
    assert.equal(err?.runDir, join(dir, 'runs', made[0]), 'the rejection names the run folder');
    const mine = (await listRuns({ cwd: dir })).find(r => r.id === err.runId || r.runId === err.runId);
    assert.ok(!mine || mine.status !== 'running', `the run is not still running: ${JSON.stringify(mine)}`);
  } finally {
    srv.closeAllConnections?.(); srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
