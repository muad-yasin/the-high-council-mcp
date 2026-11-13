// 0.8.4 (the ladder unit; C&C 10 Nov, item 4 of the per-limit follow-up): the comment on caps.js recordedCapOf says that a billed stage record with no `capName` cannot be met under armed caps, because capsResumeVerdict refuses the resume
// that would meet it. This PROVES it on a real PAID run: written with the caps switch OFF (the stage record names no cap), then resumed with COUNCIL_SPEND_CAPS on. Each case is either REFUSED before any call, or CONTINUED UNDER THE RUN'S OWN
// SINGLE LIMIT (never silently in no limit). Offline, $0: a loopback OpenRouter stub (the first request is answered, every later one is refused with the probe's 404); the key is a placeholder literal.
// WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides. If a row fails, the comment's claim is false and the diff goes to C&C before any fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call as mockCall } from '../src/providers.js';
import { CAPS_SETTING } from '../src/caps.js';
import { startTyped } from './helpers/typed-cap.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const PROBE_BODY = { error: { message: 'No endpoints found that satisfy the max price for this request', code: 404 } };
const FLIP = /This run was started under one typed limit for the whole run, and COUNCIL_SPEND_CAPS is now set \(openrouter\), so it was not continued/;
const UNTOLD = /This run folder records no spending limit .* and it was not continued\./s;

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

/** A paid run written with the switch OFF: one finished PAID step on disk (its stage record has no capName), then the stop at the stub's refusal. -> { dir, rd, run, hits, close } */
async function paidRunWithCapsOff(id) {
  const s = await stub();
  const dir = mkdtempSync(join(tmpdir(), 'thc-pc-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'pc.json'), JSON.stringify({ ...base, name: 'pc', seats: { ...base.seats, proposers: [{ provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'orx', maxTokens: 500, baseUrl: s.url }, ...base.seats.proposers] } }));
  const run = (args, extraEnv = {}) => new Promise(done => {
    let out = '';
    const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), OPENROUTER_API_KEY: 'sk-or-v1-placeholder-not-a-key', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1', ...extraEnv } });
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.on('exit', code => done({ code, out }));
  });
  const rd = join(dir, 'runs', id);
  await startTyped(run, ['--chain', 'pc', '--task', 'tasks/t.md', '--run-id', id], rd, '25');   // a paid start waits for the limit the person types (a flag does not skip it); the typed figure is saved as run.json maxUsd; the switch is OFF
  const paid = readdirSync(rd).filter(f => f.endsWith('.usage.json')).map(f => JSON.parse(readFileSync(join(rd, f), 'utf8'))).filter(u => u.provider === 'openrouter' && Number.isFinite(u.usd) && u.usd > 0);
  assert.equal(paid.length, 1, `the premise: one finished paid step on disk (${readdirSync(rd).join(', ')})`);
  assert.equal(paid[0].capName, undefined, 'the premise: written with the switch off, the paid step names no cap');
  return { dir, rd, run, hits: s.hits, close: s.close };
}
const entriesOf = rd => readdirSync(rd).sort();

test('PC-1 (with maxUsd): a paid run written with the caps off, resumed with the caps on, is refused before any call (the flip sentence, exit 2) and nothing is written', async () => {
  const p = await paidRunWithCapsOff('2026-11-10T08-00-00-000Z');
  try {
    assert.ok(JSON.parse(readFileSync(join(p.rd, 'run.json'), 'utf8')).maxUsd > 0, 'the premise: the run holds its single limit');
    const before = entriesOf(p.rd); const hits = p.hits.length; const meta = readFileSync(join(p.rd, 'run.json'), 'utf8');
    const r = await p.run(['--resume', p.rd], { [CAPS_SETTING]: 'openrouter' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, FLIP);
    assert.equal(p.hits.length, hits, 'no request was made');
    assert.deepEqual(entriesOf(p.rd), before); assert.equal(readFileSync(join(p.rd, 'run.json'), 'utf8'), meta);
  } finally { await p.close(); rmSync(p.dir, { recursive: true, force: true }); }
});

test('PC-2 (without maxUsd): the same paid run whose run.json records no limit (the field taken out: an old record), resumed with the caps on, is refused before any call as a folder whose spending limit cannot be known; it is not a start still waiting for its limits', async () => {
  const p = await paidRunWithCapsOff('2026-11-10T08-00-01-000Z');
  try {
    const metaPath = join(p.rd, 'run.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')); delete meta.maxUsd; writeFileSync(metaPath, JSON.stringify(meta, null, 2));   // the one hand edit: an older run.json with no limit recorded
    const before = entriesOf(p.rd); const hits = p.hits.length;
    const r = await p.run(['--resume', p.rd], { [CAPS_SETTING]: 'openrouter' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, UNTOLD);
    assert.equal(p.hits.length, hits, 'no request was made');
    assert.deepEqual(entriesOf(p.rd), before);
  } finally { await p.close(); rmSync(p.dir, { recursive: true, force: true }); }
});

test('PC-3 (the other branch, counted in a limit): the switch names a cap this chain does not bill through (anthropic), so no cap is in force; the resume keeps today\'s path under the run\'s single limit (run.json maxUsd stays, nothing is refused); a record with no capName is then counted in that single limit, the only one in force', async () => {
  const p = await paidRunWithCapsOff('2026-11-10T08-00-02-000Z');
  try {
    const r = await p.run(['--resume', p.rd], { [CAPS_SETTING]: 'anthropic' });
    assert.notEqual(r.code, 2, `not refused as a mode flip: ${r.out}`);
    assert.doesNotMatch(r.out, FLIP); assert.doesNotMatch(r.out, UNTOLD);
    // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026; first box run). OLD (a prediction, never run): the switch names a cap the chain does not bill through, so no cap is in force and the resume goes on under the single limit (the CLI printed its chain line). NEW: the per-provider caps rule that landed first refuses a chain with a seat NO named cap covers, before anything starts; what this row pins is unchanged: not refused as a mode flip, nothing asked or counted, the single limit stays.
    assert.match(r.out, /COUNCIL_SPEND_CAPS is set \(anthropic\), and no cap covers this seat: openrouter\/qwen\/qwen3\.7-plus \(proposers\[0\]\), billed through openrouter\..*Nothing was started\./s, 'the caps verdict names the uncovered seat and starts nothing');
    const stopped = JSON.parse(readFileSync(join(p.rd, 'run.json'), 'utf8'));
    assert.ok(stopped.maxUsd > 0, 'still under its single limit');
  } finally { await p.close(); rmSync(p.dir, { recursive: true, force: true }); }
});
