// Unit 1 (D12 part 1; his 03 Nov 2026: "0.8.4 records what was billed beside THC's own count"). OpenRouter's reply carries `usage.cost` ("the total amount charged to your account") and an `id` that names the generation. Both are READ
// and stored beside THC's own count; neither counts for anything in this unit (the counting rule is part 2, F3(c)). A missing or unreadable value leaves the field OUT - never $0. Only OpenRouter; nothing but a plain number and a plain
// token is copied from the reply. UNVERIFIED against the activity export (PROVIDER_BILLED_COST.md): after the cache discount or not, USD or credits.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, failureFactsOf } from '../src/providers.js';
import { runSingleStage, setBudget, setCache, budgetState, setReservationSink, setChargeHook } from '../src/chain.js';
import { openReservations } from '../src/spend-reservations.js';
import { recordLostCharge } from '../src/superseded.js';
import { writeSideStage } from '../src/stage-cache.js';
import { reportJsonShape } from '../src/report-shape.js';
import { runChain } from '../src/chain.js';
import { priceOf } from '../src/cost.js';
import { startTyped } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const opts = { model: 'x/y', system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 };
const withFetch = async (handler, fn) => { const real = globalThis.fetch; const key = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test'; globalThis.fetch = handler; try { return await fn(); } finally { globalThis.fetch = real; if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key; } };
const body = extra => JSON.stringify({ model: 'x/y', choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, ...(extra.cost === undefined ? {} : { cost: extra.cost }) }, ...(extra.id === undefined ? {} : { id: extra.id }) });
const reply = async (extra, provider = 'openrouter') => withFetch(async () => new Response(body(extra), { status: 200 }), () => call(provider, { ...opts, ...(provider === 'ollama' ? { baseUrl: 'http://127.0.0.1:11434/v1' } : {}) }));

test('a plain cost and a plain generation id are kept beside the token figures', async () => {
  const r = await reply({ cost: 0.0123, id: 'gen-1730736000-AbC123xyz' });
  assert.equal(r.providerReportedCost, 0.0123);
  assert.equal(r.providerReportedUnverified, true, 'the field says what it is: provider-reported, unverified');
  assert.equal(r.generationId, 'gen-1730736000-AbC123xyz');
  assert.deepEqual(r.usage.input, 100, 'and the token figures are as they were');
  assert.equal((await reply({ cost: 0 })).providerReportedCost, 0, 'a reported 0 is a reported 0 (it is a figure)');
});

test('a missing or unreadable cost is LEFT OUT - never $0 - and so is an id that is not a plain token', async () => {
  const control = await reply({ cost: 0.5, id: 'gen-control' });
  assert.deepEqual([control.providerReportedCost, control.generationId], [0.5, 'gen-control'], 'control: a plain cost and id ARE recorded, so the left-outs below are decisions, not an absence of the feature');
  const none = await reply({});
  assert.ok(!('providerReportedCost' in none) && !('providerReportedUnverified' in none) && !('generationId' in none), 'nothing reported: nothing recorded (no marker either)');
  for (const bad of ['0.01', -0.5, null, true, {}, [], 'free']) assert.ok(!('providerReportedCost' in await reply({ cost: bad, id: 'gen-ok' })), `cost left out: ${JSON.stringify(bad)}`);
  for (const bad of ['gen with spaces', 'x'.repeat(101), '<b>gen</b>', 'gen\nline', '', 7, {}]) assert.ok(!('generationId' in await reply({ cost: 0.01, id: bad })), `id left out: ${JSON.stringify(bad)}`);
});

test('only OpenRouter: another OpenAI-compatible provider that happens to send a cost field records none', async () => {
  assert.equal((await reply({ cost: 0.0123, id: 'gen-1' })).providerReportedCost, 0.0123, 'control: the same reply from OpenRouter records it');
  const r = await reply({ cost: 0.0123, id: 'gen-1' }, 'ollama');
  assert.ok(!('providerReportedCost' in r) && !('generationId' in r));
});

test('an error reply (HTTP 200 carrying an error) that also carries the figure: it goes to the CHARGE record, and NOT to failureFactsOf (the stop record and run_status)', async () => {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'c'.repeat(40);
  const dir = mkdtempSync(join(tmpdir(), 'thc-billed-err-')); const charges = [];
  const s = await stub((n, req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'gen-e1', error: { code: 529, message: 'overloaded' }, usage: { prompt_tokens: 100, completion_tokens: 0, cost: 0.002 } })); });
  try {
    setCache(null); setBudget(50); setReservationSink(openReservations(dir)); setChargeHook(c => charges.push(c));
    const err = await runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'errreply', log: () => {} }).then(() => assert.fail('expected a throw'), e => e);
    const billed = charges.find(c => c.kind === 'billed');
    assert.deepEqual([billed.providerReportedCost, billed.providerReportedUnverified, billed.generationId], [0.002, true, 'gen-e1'], 'the charge record carries them (control)');
    const facts = failureFactsOf(err);
    assert.ok(!('providerReportedCost' in facts) && !('generationId' in facts) && !('providerReportedUnverified' in facts), 'and the failure facts (STOPPED-error.json, run_status) do not');
  } finally { setBudget(null); setReservationSink(null); setChargeHook(null); s.srv.close(); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
});

test('a charge file carries the billed figure and the id when the attempt had them, and keeps its old key set when it had none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-billed-'));
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  const withFacts = read(recordLostCharge(dir, 'a', { provider: 'p', model: 'm', usd: 0.5, reason: 'r', kind: 'billed', providerReportedCost: 0.4, generationId: 'gen-1' }));
  assert.deepEqual([withFacts.providerReportedCost, withFacts.providerReportedUnverified, withFacts.generationId], [0.4, true, 'gen-1']);
  assert.deepEqual(Object.keys(read(recordLostCharge(dir, 'b', { provider: 'p', model: 'm', usd: 0.5, reason: 'r', kind: 'billed' }))).sort(), ['kind', 'model', 'provider', 'reason', 'usage', 'usd']);
  const bad = read(recordLostCharge(dir, 'c', { provider: 'p', model: 'm', usd: 0.5, reason: 'r', providerReportedCost: -1, generationId: 'a b' }));
  assert.ok(!('providerReportedCost' in bad) && !('generationId' in bad), 'an unreadable figure and a non-token id are left out');
});

// Through invoke(): the stage carries the facts, and the COUNT is unchanged (this unit records beside; the counting rule is part 2).
function stub(handler) {
  const seen = []; const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { seen.push(1); handler(seen.length, req, res); }); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}
const PRICED = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500 };
test('through invoke(): the stage carries providerReportedCost and generationId beside usd, usd is still THC\'s token-priced count, the cap counted that, and a reply without them adds no key', async () => {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'c'.repeat(40);
  const send = (extra) => (n, req, res) => { res.setHeader('content-type', 'application/json'); res.end(body(extra)); };
  const s = await stub(send({ cost: 0.4321, id: 'gen-777' }));
  try {
    setCache(null); setBudget(50);
    const st = await runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'billed', log: () => {} });
    assert.deepEqual([st.providerReportedCost, st.providerReportedUnverified, st.generationId], [0.4321, true, 'gen-777']);
    const row = priceOf('openrouter', 'anthropic/claude-opus-5');
    assert.ok(Math.abs(st.usd - (100 * row.in + 50 * row.out) / 1e6) < 1e-9, `usd is THC's own token-priced figure (100 in, 50 out at the row), hand-computed - not the reported 0.4321 (part 2's count switch turns THIS line red): ${st.usd}`);
    assert.equal(budgetState().spent, st.usd, 'and the cap counted exactly that: this unit changes no count');
  } finally { setBudget(null); s.srv.close(); }
  const s2 = await stub(send({}));
  try {
    setCache(null); setBudget(50);
    const st = await runSingleStage({ ...PRICED, baseUrl: s2.url }, { system: 's', user: 'u', label: 'plain', log: () => {} });
    assert.ok(!('providerReportedCost' in st) && !('generationId' in st));
  } finally { setBudget(null); s2.srv.close(); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
});

test('the discarded first attempt of a thinking retry keeps its OWN billed figure on its waste charge record (written when the retry then fails); the failed retry\'s own record has none (nothing readable came back)', async () => {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'c'.repeat(40);
  const dir = mkdtempSync(join(tmpdir(), 'thc-billed-waste-')); const charges = [];
  const s = await stub((n, req, res) => {
    if (n === 1) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'gen-first', choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 500 }, cost: 0.9 } })); }
    else { res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end('not json'); }   // the retry's body is dropped: a billed_unreadable charge, and the first attempt becomes a waste charge
  });
  try {
    setCache(null); setBudget(50); setReservationSink(openReservations(dir)); setChargeHook(c => charges.push(c));
    await runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'both', log: () => {} }).then(() => assert.fail('expected a throw'), e => e);
    const waste = charges.find(c => c.kind === 'waste'), billed = charges.find(c => c.kind === 'billed');
    assert.ok(waste && billed, 'both records exist: the discarded attempt (waste) and the failed retry (billed)');
    assert.deepEqual([waste.providerReportedCost, waste.providerReportedUnverified, waste.generationId], [0.9, true, 'gen-first'], 'the discarded attempt keeps its own');
    assert.ok(!('providerReportedCost' in billed) && !('generationId' in billed), 'and the failed retry, whose body was dropped, has none (counted only)');
  } finally { setBudget(null); setReservationSink(null); setChargeHook(null); s.srv.close(); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
});

test('the real CLI: a paid stage\'s <label>.usage.json carries providerReportedCost and generationId beside usd', async () => {
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(body({ cost: 0.0042, id: 'gen-cli-1' })); }); });
  await new Promise(done => srv.listen(0, '127.0.0.1', done));
  const work = mkdtempSync(join(tmpdir(), 'thc-billed-cli-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } }));
  const RUN = '2026-11-04T07-00-00-000Z'; const runDir = join(work, 'runs', RUN);
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = args => new Promise(done => spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: 'ignore' }).on('exit', code => done({ code })));
  try { await startTyped(run, ['--chain', 'c', '--task', 'tasks/x.md', '--run-id', RUN], runDir); } finally { srv.close(); }
  const usageFiles = existsSync(runDir) ? readdirSync(runDir).filter(f => f.endsWith('.usage.json') && JSON.parse(readFileSync(join(runDir, f), 'utf8')).provider === 'openrouter') : [];
  assert.ok(usageFiles.length >= 1, `a paid stage wrote its usage file (${usageFiles.length})`);
  const u = JSON.parse(readFileSync(join(runDir, usageFiles[0]), 'utf8'));
  assert.deepEqual([u.providerReportedCost, u.providerReportedUnverified, u.generationId], [0.0042, true, 'gen-cli-1']);
  assert.ok(Number.isFinite(u.usd) && u.usd !== 0.0042, 'beside THC\'s own usd');
});

test('the one rule lives in one leaf module: billedFieldsOf and billedFactsOf (the module imports nothing)', async () => {
  const m = await import('../src/billed-facts.js').catch(() => null);
  assert.ok(m, 'src/billed-facts.js exists');
  assert.deepEqual(m.billedFieldsOf({ providerReportedCost: 0.5, generationId: 'gen-1', other: 'x' }), { providerReportedCost: 0.5, providerReportedUnverified: true, generationId: 'gen-1' }, 'only these fields, only when plain, and the figure travels with its unverified marker');
  assert.deepEqual(m.billedFieldsOf({ providerReportedCost: '0.5', generationId: 'a b' }), {}, 'an unreadable pair leaves both out');
  assert.deepEqual(m.billedFieldsOf(null), {});
  assert.deepEqual(m.billedFactsOf('openrouter', { usage: { cost: 0.01 }, id: 'gen-2' }), { providerReportedCost: 0.01, providerReportedUnverified: true, generationId: 'gen-2' });
  assert.deepEqual(m.billedFactsOf('openai', { usage: { cost: 0.01 }, id: 'gen-2' }), {}, 'any other provider: nothing');
  assert.deepEqual(m.billedFactsOf('openrouter', null), {}, 'a body that is not an object: nothing');
  assert.equal(readFileSync(join(root, 'src', 'billed-facts.js'), 'utf8').split('\n').filter(l => /^\s*import\s/.test(l)).length, 0, 'and it imports nothing');
});

test('a stage replayed from disk keeps its billed figure and id; a hit with an unreadable pair gets neither', async () => {
  const hit = extra => ({ text: 'cached text', usd: 0.01, usage: { input: 1, output: 1 }, provider: 'openrouter', model: 'anthropic/claude-opus-5', ...extra });
  const replay = async extra => { setCache({ get: () => hit(extra), warn() {}, invalidate() {} }); try { return await runSingleStage({ ...PRICED }, { system: 's', user: 'u', label: 'replayed', log: () => {} }); } finally { setCache(null); } };
  const kept = await replay({ providerReportedCost: 0.3, generationId: 'gen-r1' });
  assert.deepEqual([kept.cached, kept.providerReportedCost, kept.generationId], [true, 0.3, 'gen-r1']);
  const bad = await replay({ providerReportedCost: -1, generationId: 'a b' });
  assert.ok(bad.cached && !('providerReportedCost' in bad) && !('generationId' in bad));
});

test('a side run\'s usage file (--rematch, --replay) carries them too, and a stage without them adds no key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-billed-side-'));
  const stage = extra => ({ label: 'x', provider: 'openrouter', model: 'm', usage: { input: 1, output: 1 }, usd: 0.01, ms: 5, promptHash: 'h', text: 't', ...extra });
  writeSideStage(dir, stage({ providerReportedCost: 0.2, generationId: 'gen-side' }), { fingerprint: 'f' });
  const u = JSON.parse(readFileSync(join(dir, 'x.usage.json'), 'utf8'));
  assert.deepEqual([u.providerReportedCost, u.generationId], [0.2, 'gen-side']);
  writeSideStage(dir, stage({ label: 'y' }), { fingerprint: 'f' });
  const v = JSON.parse(readFileSync(join(dir, 'y.usage.json'), 'utf8'));
  assert.ok(!('providerReportedCost' in v) && !('generationId' in v));
});

test('report.json does not carry them in unit 1 (like `endpoint`, they stay in the usage files; the counter that publishes them, with its schema, is unit 2): the stages[] rows are as they were', async () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  const result = await runChain({ config, request: 'Plan a small offline tool.', log: () => {} });
  result.stages[0] = { ...result.stages[0], providerReportedCost: 0.5, providerReportedUnverified: true, generationId: 'gen-rep' };
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: '2026-11-04T00-00-00-000Z', chain: config.name, task: 't', taskText: 'Plan a small offline tool.', result, config, maxUsd: 7 })));
  assert.ok(report.stages.length > 0 && report.stages.every(r => !('providerReportedCost' in r) && !('providerReportedUnverified' in r) && !('generationId' in r)), 'stripped');
  assert.equal(report.stages[0].usd, result.stages[0].usd, 'and the row is otherwise the stage');
});
