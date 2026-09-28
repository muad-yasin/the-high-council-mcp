// Bug audit 2026-09-28 (area 4 MED-1): an aborted api.run() rejected with a bare AbortError before
// the child exited, so the caller could not tell which run to resume, and the run still read as
// running. The rejection now carries runId/runDir and comes after the process exits. A loopback
// Ollama-shaped stub that never answers; no keys, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
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
    setTimeout(() => ac.abort(), 2500);
    let err;
    try { await run({ chain: 'hang', task: 'tasks/t.md', cwd: dir, signal: ac.signal }); } catch (e) { err = e; }
    assert.equal(err?.name, 'AbortError', String(err));
    assert.match(err.runId, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(err.runDir && existsSync(err.runDir), `runDir ${err.runDir}`);
    const mine = (await listRuns({ cwd: dir })).find(r => r.id === err.runId || r.runId === err.runId);
    assert.ok(!mine || mine.status !== 'running', `the run is not still running: ${JSON.stringify(mine)}`);
  } finally {
    srv.closeAllConnections?.(); srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
