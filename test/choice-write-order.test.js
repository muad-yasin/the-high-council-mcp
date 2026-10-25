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
const EXIT_SCOPE_CHANGED = 14;
const EXIT_ARTIFACTS_BLOCKED = 9;   // src/cli.js (not exported): the artifact gate   // src/cli.js (not exported): the changed-task / changed-context refusal
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

test('CW-3 (real verbs): a --skip-seat that the CHANGED-TASK refusal stops leaves NO choice in run.json (the refusal comes after the resume branch\'s first run.json write), and the plain resume asks the seat again', async () => {
  const s = await stub();
  try {
    const dir = mkdtempSync(join(tmpdir(), 'thc-choice-order3-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
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
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app, and also a shopping list.\n');   // the task changed while the run was stopped
    const refused = await run(['--resume', rd, '--skip-seat']);
    assert.equal(refused.code, EXIT_SCOPE_CHANGED, refused.out);
    assert.equal(s.hits.length, hits, 'nothing was sent');
    assert.equal(JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8')).seatChoices, undefined, 'the refused command recorded no choice');
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
    const plain = await run(['--resume', rd]);
    assert.equal(plain.code, EXIT_PRICE_REFUSED, 'the plain resume asks the refused seat again (the choice was never made)');
    assert.ok(s.hits.length > hits, 'and the seat was asked again, not dropped');
  } finally { await s.close(); }
});

async function fixture(taskText, startExtra = []) {
  const s = await stub();
  const dir = mkdtempSync(join(tmpdir(), 'thc-choice-order-x-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), taskText);
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const seat = { provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'orx', maxTokens: 500, baseUrl: s.url };
  const chainFile = join(dir, 'chains', 'cw.json');
  writeFileSync(chainFile, JSON.stringify({ ...base, name: 'cw', seats: { ...base.seats, proposers: [seat, ...base.seats.proposers] } }));
  const run = args => new Promise(done => {
    let out = '';
    const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), OPENROUTER_API_KEY: 'sk-or-v1-placeholder-not-a-key', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' } });
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.on('exit', code => done({ code, out }));
  });
  const rd = join(dir, 'runs', RUN);
  const first = await startTyped(run, ['--chain', 'cw', '--task', 'tasks/t.md', '--run-id', RUN, ...startExtra], rd);
  assert.equal(first.code, EXIT_PRICE_REFUSED, first.out);
  return { s, dir, rd, run, chainFile, hits: s.hits.length };
}
const choicesOf = rd => JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8')).seatChoices;

test('CW-4 (real verbs): a --skip-seat that the ARTIFACT GATE refuses (exit 9, "Nothing was called") leaves NO choice in run.json, and the plain resume asks the seat again', async () => {
  const f = await fixture('Plan a change to src/app.js so it reads its port from the environment.\n', ['--allow-unfenced']);   // started with the whole-gate waiver, which the next command narrows
  try {
    const blocked = await f.run(['--resume', f.rd, '--skip-seat', '--allow-unfenced', 'other.js']);
    assert.equal(blocked.code, EXIT_ARTIFACTS_BLOCKED, blocked.out);
    assert.equal(f.s.hits.length, f.hits, 'nothing was sent');
    assert.equal(choicesOf(f.rd), undefined, 'the refused command recorded no choice');
    const plain = await f.run(['--resume', f.rd, '--allow-unfenced']);
    assert.equal(plain.code, EXIT_PRICE_REFUSED, 'the plain resume asks the refused seat again (the choice was never made)');
    assert.ok(f.s.hits.length > f.hits, 'and the seat was asked again, not dropped');
  } finally { await f.s.close(); }
});

test('CW-5 (real verbs): the typed-limit WAIT (exit 21: no call, the next step is a plain --resume after gate answer) is the one exception: a --skip-seat typed on it is on disk afterwards', async () => {
  const f = await fixture('Plan a small reading list app.\n');
  try {
    writeFileSync(f.chainFile, `${readFileSync(f.chainFile, 'utf8')}\n`);   // the chain file changed since the limit was typed, so the next resume asks a NEW question (exit 21)
    const waiting = await f.run(['--resume', f.rd, '--skip-seat']);
    assert.equal(waiting.code, 21, waiting.out);
    assert.equal(f.s.hits.length, f.hits, 'no call was started');
    assert.deepEqual((choicesOf(f.rd) ?? []).map(c => c.choice), ['skip'], 'the choice is on disk for the plain --resume that follows `gate answer`');
  } finally { await f.s.close(); }
});

const metaOf = rd => JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8'));
const withoutPid = m => { const { pid, ...rest } = m; return rest; };

test('CW-6 (real verbs): a resume REFUSED by the artifact gate (exit 9) changes nothing in run.json but the pid: the waiver, the limit and the other settings typed on it are not saved', async () => {
  const f = await fixture('Plan a change to src/app.js so it reads its port from the environment.\n', ['--allow-unfenced']);   // started with the whole-gate waiver
  try {
    const before = metaOf(f.rd);
    assert.equal(before.allowUnfenced, true, 'the start saved its whole-gate waiver');
    const blocked = await f.run(['--resume', f.rd, '--allow-unfenced', 'other.js', '--max-usd', '3', '--signoff', 'first']);   // a narrower list: refused
    assert.equal(blocked.code, EXIT_ARTIFACTS_BLOCKED, blocked.out);
    assert.deepEqual(withoutPid(metaOf(f.rd)), withoutPid(before), 'run.json is as it was (the saved waiver stands; nothing typed on the refused command was saved)');
  } finally { await f.s.close(); }
});

test('CW-7 (real verbs): a resume that passes every refusal saves what was typed on it (here --allow-unfenced), before the first call', async () => {
  const f = await fixture('Plan a small reading list app.\n');
  try {
    assert.equal(metaOf(f.rd).allowUnfenced, undefined);
    const again = await f.run(['--resume', f.rd, '--allow-unfenced']);
    assert.equal(again.code, EXIT_PRICE_REFUSED, again.out);
    assert.equal(metaOf(f.rd).allowUnfenced, true, 'saved for the next plain resume');
  } finally { await f.s.close(); }
});

test('CW-2 (source order): no choice is assigned into resumeMeta, and ONE flushChoices() follows the last refusal of the start (and the typed-limit wait)', () => {
  const src = readFileSync(cli, 'utf8');
  assert.deepEqual([...src.matchAll(/resumeMeta\.(roundChoices|seatChoices|conflictChoices) = (?!roundChoices;)/g)].map(m => m[1]), [], 'a new choice is held in pendingChoices, never assigned into resumeMeta (whose run.json writes come before the changed-task refusal)');
  assert.equal([...src.matchAll(/pendingChoices\.(roundChoices|seatChoices|conflictChoices) = /g)].length, 3, 'the three sites hold their choice in pendingChoices');
  const flushes = [...src.matchAll(/^flushChoices\(\);/gm)];
  assert.equal(flushes.length, 1, 'exactly one top-level flush');
  assert.ok(flushes[0].index > src.indexOf('setBudgetOrExit(maxUsdEff);'), 'it comes after the typed-limit gate and the cap is set');
  assert.ok(flushes[0].index > src.indexOf('process.exit(EXIT_ARTIFACTS_BLOCKED);'), 'and after the artifact gate: a refused command (exit 9) leaves no choice');
  assert.ok(flushes[0].index > src.indexOf('checkFrozenContext({'), 'and after the changed-task and changed-context refusals');
  assert.match(src, /beforePendingExit: flushChoices/, 'the typed-limit WAIT (exit 21, not a refusal) writes the choice for the plain resume that follows gate answer');
});
