// The local run viewer (src/ui/) against hostile run folders (security scan 2026-09-26, THC #2, #7, #8).
//
// Server: a run id is the exact run-folder shape and its real path must be a direct child of runs/,
// so an encoded "/" or a symlinked run folder reads nothing outside it; a request line the URL
// parser rejects is a 400, not a crash. Client: every value interpolated into the page is escaped,
// numbers from report.json included, since report.json is a file anyone's model output can shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const server = resolve(here, '../src/ui/server.js');
const appJs = resolve(here, '../src/ui/app.js');

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
function raw(port, line) {
  return new Promise((ok, fail) => {
    const c = connect(port, '127.0.0.1', () => c.write(`${line}\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
    let out = '';
    c.on('data', d => { out += d; });
    c.on('end', () => ok(out.split('\r\n')[0]));
    c.on('error', fail);
  });
}

test('run viewer: a run id is a run folder under runs/, and a bad request line does not stop it', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-viewer-'));
  const good = '2026-01-01T00-00-00-000Z';
  const linked = '2026-01-02T00-00-00-000Z';
  mkdirSync(join(work, 'runs', good), { recursive: true });
  writeFileSync(join(work, 'runs', good, 'deliverable.md'), '# Plan\n\nok\n');
  mkdirSync(join(work, 'secret'));
  writeFileSync(join(work, 'secret', 'notes.md'), 'PRIVATE-CANARY\n');
  symlinkSync(join(work, 'secret'), join(work, 'runs', linked));
  mkdirSync(join(work, 'runs', 'not-a-run'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(port), COUNCIL_WORKDIR: work }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => {
      child.stdout.on('data', d => { if (String(d).includes('relay viewer')) ok(); });
      child.on('exit', code => fail(new Error(`viewer exited early (${code})`)));
    });
    const list = await get(port, '/api/runs');
    assert.equal(list.status, 200);
    assert.deepEqual(JSON.parse(list.body).map(r => r.id), [good], 'only real run folders are listed');
    assert.equal((await get(port, `/api/runs/${good}`)).status, 200);
    for (const path of ['/api/runs/..%2Fsecret', '/api/runs/..%2F..%2Fsecret', `/api/runs/${linked}`, '/api/runs/not-a-run', '/api/runs/%E0%A4%A']) {
      const r = await get(port, path);
      assert.equal(r.status, 404, path);
      assert.ok(!r.body.includes('PRIVATE-CANARY'), path);
    }
    assert.match(await raw(port, 'GET http://[x HTTP/1.1'), / 400 /);
    assert.equal((await get(port, '/api/runs')).status, 200, 'the viewer is still up');
  } finally {
    child.kill();
    rmSync(work, { recursive: true, force: true });
  }
});

test('run viewer page: markup in report.json usage, scoreboard and cost fields is escaped', async () => {
  const X = '<img src=x onerror=alert(1)>';
  const els = new Map();
  const el = () => ({ innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {} }, querySelectorAll: () => [] });
  const document = {
    querySelector: s => { if (!els.has(s)) els.set(s, el()); return els.get(s); },
    querySelectorAll: () => [],
  };
  const tree = { level: 0, children: [{ level: 1, title: 't', path: 't', words: X, ownWords: X, text: 'x', children: [], volume: { score: X, files: [], scripts: [], codeBlocks: X, tableRows: X, checklistItems: X, numbers: X } }] };
  const detail = {
    id: 'r', files: ['run.log'], texts: { 'run.log': 'log' },
    drafts: [{ label: 'build', name: 'build.md', words: X, tree }],
    comparison: [{ title: 't', level: X, per: { build: { words: X } } }],
    ledger: [{ id: 'P1', status: X, note: 'n' }],
    panels: { 1: [{ lab: 'a', file: 'panel-1-a.md', parsed: { failures: [], criteria: [] } }] },
    report: {
      chain: 'c', task: 't', passed: true, totals: { usd: X }, criteria: [],
      proposals: [{ id: 'P1', lab: 'a', model: 'm', title: 't', serves: 's', what: 'w', why: 'y', how: 'h', acceptance_test: 'a' }],
      scoreboard: { labs: [{ lab: 'a', model: 'm', proposed: X, accepted: X, cut: X, unaccounted: X, built: X }] },
      stages: [{ label: 'build', provider: 'p', model: 'm', usd: X, ms: X, usage: { input: X, output: X, thinking: X } }],
    },
  };
  const runs = [{ id: 'r', chain: 'c', task: 't', finished: true, passed: true, words: X, usd: X }];
  const fetch = async url => ({ json: async () => (url === '/api/runs' ? runs : detail) });
  const ctx = vm.createContext({ document, fetch, location: { hash: '' }, console });
  vm.runInContext(readFileSync(appJs, 'utf8'), ctx);
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  const html = [...els.values()].map(e => e.innerHTML).join('\n');
  assert.ok(html.includes('&lt;img'), 'the hostile values were rendered, escaped');
  assert.ok(!html.includes('<img'), `unescaped markup reached the page:\n${html.split('\n').filter(l => l.includes('<img')).join('\n')}`);
});
