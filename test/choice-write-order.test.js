// CR-1E-006 (25 Okt 2026): `--skip-seat`, `--continue`/`--finish` and `--prevail` wrote the person's choice into run.json BEFORE the stray-word refusal, the other refusals and the run lock, so a command that was then REFUSED ("2: not a command ...
// Nothing was run and nothing was spent.") still left the choice on disk, and the next plain --resume applied it (the seat dropped, the run finished NOT agreed). The file's own rule (src/cli.js, the T1-1 comment) is that the stray-word refusal
// is the last refusal before the first write. The choice now stays in memory and run.json is written by the resume branch after the lock. Offline, $0: a loopback stub answers; the key is a placeholder literal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call as mockCall } from '../src/providers.js';
import { EXIT_PRICE_REFUSED } from '../src/exit-codes.js';
import { startTyped } from './helpers/typed-cap.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-10-18T07-00-00-000Z';
const PROBE_BODY = { error: { message: 'No endpoints found that satisfy the max price for this request', code: 404 } };

// a loopback OpenRouter stub: the first request is served as the mock proposer would (the seat gets through its proposal), every later one is refused with the probe's 404
async function stub() {
  const hits = [];
  const srv = createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', async () => {
    hits.push(req.url);
    res.setHeader('content-type', 'application/json');
    if (hits.length > 1) { res.writeHead(404); return res.end(JSON.stringify(PROBE_BODY)); }
    const body = JSON.parse(raw); const system = body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n'); const user = body.messages.filter(m => m.role === 'user').at(-1)?.content ?? '';
    const r = await mockCall('mock', { model: 'mock-proposer-a', system, messages: [{ role: 'user', content: user }], maxTokens: body.max_tokens ?? body.max_completion_tokens });
    res.writeHead(200); res.end(JSON.stringify({ id: 'stub-1', model: body.model, provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: 'stop' }], usage: { prompt_tokens: r.usage.input, completion_tokens: r.usage.output } }));
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { hits, url: `http://127.0.0.1:${srv.address().port}/v1`, close: () => new Promise(r => srv.close(r)) };
}

test('CW-1 (real verbs): a --skip-seat that the stray-word refusal stops leaves NO choice in run.json, and the next plain --resume asks the refused seat again instead of dropping it', async () => {
  const s = await stub();
  try {
    const dir = mkdtempSync(join(tmpdir(), 'thc-choice-order-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
    const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
    const seat = { provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'orx', maxTokens: 500, baseUrl: s.url };
    writeFileSync(join(dir, 'chains', 'cw.json'), JSON.stringify({ ...base, name: 'cw', seats: { ...base.seats, proposers: [seat, ...base.seats.proposers] } }));
    const run = args => new Promise(done => {
      let out = '';
      const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), OPENROUTER_API_KEY: 'sk-or-v1-placeholder-not-a-key', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' } });
      child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
      child.on('exit', code => done({ code, out }));
    });
    const rd = join(dir, 'runs', RUN);
    const first = await startTyped(run, ['--chain', 'cw', '--task', 'tasks/t.md', '--run-id', RUN], rd);
    assert.equal(first.code, EXIT_PRICE_REFUSED, first.out);
    const hits = s.hits.length;
    const stray = await run(['--resume', rd, '--skip-seat', '2']);   // the person typed a stray word after the flag
    assert.equal(stray.code, 2, stray.out); assert.match(stray.out, /Nothing was run and nothing was spent/);
    assert.equal(s.hits.length, hits, 'nothing was sent');
    assert.equal(JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8')).seatChoices, undefined, 'the refused command recorded no choice');
    const plain = await run(['--resume', rd]);
    assert.equal(plain.code, EXIT_PRICE_REFUSED, 'the plain resume asks the refused seat again (the choice was never made)');
    assert.ok(s.hits.length > hits, 'and the seat was asked again, not dropped');
  } finally { await s.close(); }
});

test('CW-2 (source order): no write of roundChoices, seatChoices or conflictChoices into run.json precedes the stray-word refusal in src/cli.js', () => {
  const src = readFileSync(cli, 'utf8');
  const stray = src.indexOf('refuseStray();   // T1-1: the last refusal of the main path');
  assert.ok(stray > 0, 'the main path\'s last refusal is found');
  const writes = [...src.matchAll(/JSON\.stringify\(\{ \.\.\.onDisk, (roundChoices|seatChoices|conflictChoices) \}/g)].filter(m => m.index < stray);
  assert.deepEqual(writes.map(m => m[1]), [], 'a choice is held in memory until the resume branch writes run.json');
});
