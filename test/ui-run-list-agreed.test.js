// 0.8.4 D1 (UNIT 3 FIX, C&C 09 Nov 2026 item 2): the run viewer's list gives each run's `passed` by the matrix's agreed reading (agreedOf), the same reading the banner and the tree use. A report that signed off at the top
// but did not agree (its final read objected, or its ending word is signed_off_at_top_not_agreed) is passed false in the list; a plain passed report stays true; a run with no report is null (nothing to read yet).
// The report files are written by hand here (the viewer reads report.json and nothing else for this field).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const server = resolve(here, '../src/ui/server.js');
const OBJECTS = { ran: true, run_end: 'agreed', final_sha: 'a'.repeat(12), seats: [{ read: true, meets: false }] };   // the final read ran and a top-layer seat objected
const CLEAR = { ran: true, run_end: 'agreed', final_sha: 'a'.repeat(12), seats: [{ read: true, meets: true }] };

function get(port, path) {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}` } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => ok({ status: res.statusCode, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

test('UI-1 the run list: a run that signed off at the top but did not agree is passed false, a plain passed run is true, a failed run is false, and a run with no report is null', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-ui-agreed-'));
  const runs = {
    '2026-01-01T00-00-01-000Z': { chain: 'c', task: 't', passed: true, final_read: OBJECTS },
    '2026-01-01T00-00-02-000Z': { chain: 'c', task: 't', passed: true, ending_word: 'signed_off_at_top_not_agreed' },
    '2026-01-01T00-00-03-000Z': { chain: 'c', task: 't', passed: true, final_read: CLEAR },
    '2026-01-01T00-00-04-000Z': { chain: 'c', task: 't', passed: true },
    '2026-01-01T00-00-05-000Z': { chain: 'c', task: 't', passed: false },
    '2026-01-01T00-00-06-000Z': null,
  };
  for (const [id, report] of Object.entries(runs)) {
    mkdirSync(join(work, 'runs', id), { recursive: true });
    if (report) writeFileSync(join(work, 'runs', id, 'report.json'), JSON.stringify(report));
    else writeFileSync(join(work, 'runs', id, 'run.log'), 'chain: c\n');
  }
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(port), COUNCIL_WORKDIR: work }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => {
      child.stdout.on('data', d => { if (String(d).includes('relay viewer')) ok(); });
      child.on('exit', code => fail(new Error(`viewer exited early (${code})`)));
    });
    const r = await get(port, '/api/runs');
    assert.equal(r.status, 200);
    const byId = new Map(JSON.parse(r.body).map(x => [x.id, x.passed]));
    assert.equal(byId.get('2026-01-01T00-00-01-000Z'), false, 'signed off, final read objected: not passed');
    assert.equal(byId.get('2026-01-01T00-00-02-000Z'), false, 'signed_off_at_top_not_agreed: not passed');
    assert.equal(byId.get('2026-01-01T00-00-03-000Z'), true, 'signed off, final read clear: passed');
    assert.equal(byId.get('2026-01-01T00-00-04-000Z'), true, 'a plain passed report is unchanged');
    assert.equal(byId.get('2026-01-01T00-00-05-000Z'), false);
    assert.equal(byId.get('2026-01-01T00-00-06-000Z'), null, 'no report: null, as before');
  } finally {
    child.kill();
    rmSync(work, { recursive: true, force: true });
  }
});
