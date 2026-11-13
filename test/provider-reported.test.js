// Unit 2 (D12 part 2; his 03 Nov 2026: "0.8.4 records what was billed beside THC's own count"). The provider-reported counter: ONE pure reader of a run folder (src/provider-reported.js) that the spend report and BOTH report.json folds call,
// derived at the moment it is asked, labelled unverified, and counted in no total. These tests pin its buckets (one per boundary), the thinking-retry split, that the three readers agree on one folder, the schema, the `--spend` line,
// the MCP object and the stage's `discardedAttempt`.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import * as chainNs from '../src/chain.js';
import { spendReport } from '../src/spend.js';
import { foldSupersededInto } from '../src/stage-cache.js';
import { priceOf } from '../src/cost.js';
import { recordCall } from '../src/superseded.js';
import { startTyped } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const prMod = await import('../src/provider-reported.js').catch(() => null);
const providerReportedOf = d => prMod?.providerReportedOf(d);
const fold = (result, d) => prMod?.foldProviderReportedInto(result, d);
const put = (dir, rel, obj) => { const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj)); };
const OR = (usd, extra = {}) => ({ provider: 'openrouter', model: 'anthropic/claude-opus-5', usage: { input: 1, output: 1 }, usd, ...extra });
const withFig = (cost, extra = {}) => ({ providerReportedCost: cost, providerReportedUnverified: true, ...extra });
const folder = () => mkdtempSync(join(tmpdir(), 'thc-pr-'));

test('the reader exists and answers null for a folder with no paid OpenRouter record (a mock run, an empty folder)', () => {
  assert.ok(prMod, 'src/provider-reported.js exists');
  const d = folder(); put(d, 'build.usage.json', { provider: 'mock', model: 'mock-priced', usd: 0.5 }); put(d, 'x.usage.json', OR(0));
  assert.equal(providerReportedOf(d), null, 'a mock stage and a $0 stage are not counted');
  assert.equal(providerReportedOf(folder()), null);
});

test('bucket: a stage that carries a figure is IN (cost, and THC\'s usd for it); a paid OpenRouter stage with none, and a file from before 0.8.4, are WITHOUT', () => {
  const d = folder();
  put(d, 'a.usage.json', OR(0.5, withFig(0.4, { generationId: 'gen-a' })));
  put(d, 'b.usage.json', OR(0.2));
  assert.deepEqual(providerReportedOf(d), { cost: 0.4, attempts: 1, thcUsd: 0.5, attemptsWithout: 1, unverified: true });
});

test('bucket: other providers are not looked at', () => {
  const d = folder(); put(d, 'a.usage.json', OR(0.5, withFig(0.4))); put(d, 'b.usage.json', { provider: 'anthropic', model: 'x', usd: 0.9, ...withFig(9) });
  assert.deepEqual(providerReportedOf(d), { cost: 0.4, attempts: 1, thcUsd: 0.5, attemptsWithout: 0, unverified: true });
});

test('bucket: a billed charge with NO figure (a failed attempt) is OUT of both numbers; one that carries a figure is IN', () => {
  const d = folder();
  put(d, 'superseded/x.charge-1.usage.json', OR(0.3, { kind: 'billed', reason: 'r' }));
  assert.equal(providerReportedOf(d), null, 'a failed attempt carries no figure by design: it is not "paid without a figure"');
  put(d, 'superseded/y.charge-1.usage.json', OR(0.3, withFig(0.25, { kind: 'billed' })));
  assert.deepEqual(providerReportedOf(d), { cost: 0.25, attempts: 1, thcUsd: 0.3, attemptsWithout: 0, unverified: true });
});

test('bucket: a waste charge (a discarded thinking attempt whose retry failed) is a normal reply: IN with a figure, WITHOUT without one', () => {
  const d = folder();
  put(d, 'superseded/w.charge-1.usage.json', OR(0.4, withFig(0.35, { kind: 'waste' })));
  put(d, 'superseded/w.charge-2.usage.json', OR(0.1, { kind: 'waste' }));
  assert.deepEqual(providerReportedOf(d), { cost: 0.35, attempts: 1, thcUsd: 0.4, attemptsWithout: 1, unverified: true });
});

test('bucket: a one-call record (handoff, contract draft, digest) and a stage set aside in superseded/ are normal replies', () => {
  const d = folder();
  put(d, 'superseded/digest.call-1.usage.json', OR(0.0625, withFig(0.03125)));
  put(d, 'superseded/build.1.usage.json', OR(0.5, withFig(0.25)));
  put(d, 'superseded/old.2.usage.json', OR(0.75));
  assert.deepEqual(providerReportedOf(d), { cost: 0.28125, attempts: 2, thcUsd: 0.5625, attemptsWithout: 1, unverified: true });
});

test('the thinking-retry split: the answer and the discarded attempt are compared attempt by attempt', () => {
  const both = folder(); put(both, 'a.usage.json', OR(1.0, { ...withFig(0.5), discardedAttempt: { usd: 0.5, ...withFig(0.25) } }));
  assert.deepEqual(providerReportedOf(both), { cost: 0.75, attempts: 2, thcUsd: 1.0, attemptsWithout: 0, unverified: true }, 'both attempts carry a figure: cost = both, THC = usd');
  const answerOnly = folder(); put(answerOnly, 'a.usage.json', OR(1.0, { ...withFig(0.5), discardedAttempt: { usd: 0.25 } }));
  assert.deepEqual(providerReportedOf(answerOnly), { cost: 0.5, attempts: 1, thcUsd: 0.75, attemptsWithout: 1, unverified: true }, 'the discarded attempt has none: the answer is compared with THC\'s count for the answer only (usd minus the discarded attempt)');
  const none = folder(); put(none, 'a.usage.json', OR(1.0, { discardedAttempt: { usd: 0.5 } }));
  assert.deepEqual(providerReportedOf(none), { cost: 0, attempts: 0, thcUsd: 0, attemptsWithout: 2, unverified: true });
});

test('malformed entries count as none: a string, a negative, a NaN-like figure; an unreadable file; a discardedAttempt that is not an object', () => {
  const d = folder();
  put(d, 'a.usage.json', OR(0.5, { providerReportedCost: '0.4' }));
  put(d, 'b.usage.json', OR(0.5, { providerReportedCost: -1 }));
  put(d, 'c.usage.json', OR(0.5, { ...withFig(0.2), discardedAttempt: 'x' }));
  writeFileSync(join(d, 'd.usage.json'), '{ not json');
  assert.deepEqual(providerReportedOf(d), { cost: 0.2, attempts: 1, thcUsd: 0.5, attemptsWithout: 2, unverified: true });
});

test('one reader for three places, EQUAL AT REPORT TIME: the spend row, the helper and the side-run fold give the SAME object for one folder (with a charge record and a one-call record in it); a reader that skips them does not; a record written later moves the spend row only', () => {
  const root2 = mkdtempSync(join(tmpdir(), 'thc-pr-runs-')); const runs = join(root2, 'runs'); const d = join(runs, '2026-11-04T03-00-00-000Z'); mkdirSync(d, { recursive: true });
  put(d, 'a.usage.json', OR(0.5, withFig(0.4)));
  put(d, 'superseded/y.charge-1.usage.json', OR(0.3, withFig(0.25, { kind: 'billed' })));
  put(d, 'superseded/z.call-1.usage.json', OR(0.1, withFig(0.09)));
  const direct = providerReportedOf(d);
  const row = spendReport(runs, { days: 3650, now: Date.parse('2026-11-05T00:00:00Z') }).runs[0].providerReported;
  const folded = fold({ totals: { usd: 1 } }, d).totals.providerReported;
  const sideRun = foldSupersededInto({ totals: { usd: 1 }, stages: [] }, d).totals.providerReported;   // the side run's REAL fold (--rematch, --replay), not the helper it wraps
  assert.deepEqual([row, folded, sideRun], [direct, direct, direct], 'the spend row, the helper and the side-run fold give the same object');
  assert.equal(direct.attempts, 3);
  // the known-bad input: a reader told to skip a charge record gives another answer, so the equality above can fail
  const skipCharges = dir => { let cost = 0, thc = 0, n = 0; for (const f of ['a.usage.json']) { const u = JSON.parse(readFileSync(join(dir, f), 'utf8')); cost += u.providerReportedCost; thc += u.usd; n++; } return { cost, attempts: n, thcUsd: thc }; };
  assert.notDeepEqual({ cost: direct.cost, attempts: direct.attempts, thcUsd: direct.thcUsd }, skipCharges(d), 'a reader that skips the charge and call records is not the reader');
  // and the counter is in no total
  assert.equal(fold({ totals: { usd: 1 } }, d).totals.usd, 1, 'totals.usd is untouched');
  // report.json is frozen when written: a one-call record written LATER moves the spend row, not the folded object
  put(d, 'superseded/late.call-1.usage.json', OR(0.0625, withFig(0.03125)));
  const rowLater = spendReport(runs, { days: 3650, now: Date.parse('2026-11-05T00:00:00Z') }).runs[0].providerReported;
  assert.equal(rowLater.attempts, direct.attempts + 1, 'the spend row counts the later record');
  assert.equal(folded.attempts, direct.attempts, 'the object folded into report.json earlier does not');
});

test('the report schema documents totals.providerReported and refuses a malformed one', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const totalsSchema = { ...schema.$defs.totals, $defs: schema.$defs };
  const validateTotals = ajv.compile({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...totalsSchema });
  const good = { input: 1, output: 1, total: 2, usd: 0.5, unpriced: [], providerReported: { cost: 0.4, attempts: 1, thcUsd: 0.5, attemptsWithout: 0, unverified: true } };
  assert.ok(schema.$defs.totals.properties.providerReported, 'documented');
  assert.ok(validateTotals(good), JSON.stringify(validateTotals.errors));
  for (const bad of [{ ...good.providerReported, cost: '0.4' }, { ...good.providerReported, unverified: false }, { ...good.providerReported, attempts: -1 }, { cost: 1 }, { ...good.providerReported, extra: 1 }]) {
    assert.ok(!validateTotals({ ...good, providerReported: bad }), `refused: ${JSON.stringify(bad)}`);
  }
});

// The stage's discardedAttempt, through invoke(): present with the right split when a thinking retry answered, absent when no retry ran.
function stub(handler) {
  const seen = []; const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { seen.push(1); handler(seen.length, req, res); }); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}
const PRICED = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500 };
const answer = (cost, id) => JSON.stringify({ id, choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, cost } });
test('discardedAttempt: absent when no retry ran; present with the split when the thinking retry answered (usd = the answer + the discarded attempt)', async () => {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'c'.repeat(40);
  const row = priceOf('openrouter', 'anthropic/claude-opus-5'); const tok = (i, o) => (i * row.in + o * row.out) / 1e6;
  const send = (n, req, res) => { res.setHeader('content-type', 'application/json'); if (n === 1) res.end(JSON.stringify({ id: 'gen-first', choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 500 }, cost: 0.9 } })); else res.end(answer(0.1, 'gen-second')); };
  const s = await stub(send); const s0 = await stub((n, req, res) => { res.setHeader('content-type', 'application/json'); res.end(answer(0.1, 'gen-plain')); });
  try {
    chainNs.setCache(null); chainNs.setBudget(50);
    const plain = await chainNs.runSingleStage({ ...PRICED, baseUrl: s0.url }, { system: 's', user: 'u', label: 'plain', log: () => {} });
    assert.ok(!('discardedAttempt' in plain), 'no retry ran: no discardedAttempt');
    const st = await chainNs.runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'both', log: () => {} });
    assert.ok(st.discardedAttempt, 'a retry answered: the split is kept');
    assert.ok(Math.abs(st.discardedAttempt.usd - tok(100, 500)) < 1e-9, 'the discarded attempt\'s usd is its own token cost');
    assert.ok(Math.abs(st.usd - st.discardedAttempt.usd - tok(100, 50)) < 1e-9, 'and usd minus it is the answer\'s token cost');
    assert.deepEqual([st.discardedAttempt.providerReportedCost, st.discardedAttempt.generationId, st.providerReportedCost, st.generationId], [0.9, 'gen-first', 0.1, 'gen-second'], 'each attempt keeps its own figure and id');
  } finally { chainNs.setBudget(null); s.srv.close(); s0.srv.close(); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
});

// The real CLI, to the END of a run: the stub answers the criteria seat with a stored-shape criteria object, so the mock-debate chain finishes and writes report.json. Then (1) report.json's totals.providerReported (the main-run fold,
// cli.js H2-p) deep-equals the spend row for that folder, (2) `--spend` prints the labelled line carrying exactly that counter, (3) the run's usd is THC's own count and the counter is in no total.
test('the real CLI to the end of a run: report.json\'s totals.providerReported equals the spend row\'s, and --spend prints the labelled line for exactly that counter', async () => {
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'gen-cli-9', choices: [{ message: { content: '{"criteria": ["It exists."]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0042 } })); }); });
  await new Promise(done => srv.listen(0, '127.0.0.1', done));
  const work = mkdtempSync(join(tmpdir(), 'thc-pr-cli-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } }));
  const RUN = '2026-11-04T07-30-00-000Z'; const runDir = join(work, 'runs', RUN);
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = args => new Promise(done => { const c = spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { o += d; }); c.on('exit', code => done({ code, out: o })); });
  let spend;
  try { await startTyped(run, ['--chain', 'c', '--task', 'tasks/x.md', '--run-id', RUN], runDir); spend = await run(['--spend', '--days', '30']); } finally { srv.close(); }
  assert.ok(existsSync(join(runDir, 'report.json')), 'the run finished and wrote report.json (the main-run fold has something to run on)');
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  const counter = providerReportedOf(runDir);
  assert.ok(counter && counter.attempts >= 1, 'the folder holds the paid criteria stage with its figure');
  assert.deepEqual(report.totals.providerReported, counter, 'report.json totals.providerReported (the main-run fold) is the reader\'s answer for the folder');
  const row = spendReport(join(work, 'runs'), { days: 3650, now: Date.parse('2026-11-05T00:00:00Z') }).runs.find(r => r.id === RUN);
  assert.deepEqual(row.providerReported, counter, 'and so is the spend row');
  assert.ok(Math.abs(report.totals.usd - row.usd) < 1e-9, 'and the run\'s usd is the same in both: the counter is in no total');
  const line = `provider-reported cost (unverified; the provider reports it in credits): ${Number(counter.cost.toFixed(6))} for ${counter.attempts} attempt(s); THC counted $`;
  assert.ok(spend.out.includes(line), `--spend prints the labelled line for exactly that counter: ${spend.out}`);
  assert.match(spend.out, /Not in the total\./);
});

test('a one-call record keeps the split of a thinking retry that answered, so the counter compares it attempt by attempt; a malformed split is left out', () => {
  const d = folder();
  const rec = read => JSON.parse(readFileSync(recordCall(d, 'digest', read), 'utf8'));
  const withSplit = rec({ provider: 'openrouter', model: 'm', usage: { input: 1, output: 1 }, usd: 1, ms: 5, promptHash: 'h', providerReportedCost: 0.5, discardedAttempt: { usd: 0.5, providerReportedCost: 0.25, providerReportedUnverified: true } });
  assert.deepEqual(withSplit.discardedAttempt, { usd: 0.5, providerReportedCost: 0.25, providerReportedUnverified: true });
  assert.ok(!('discardedAttempt' in rec({ provider: 'openrouter', model: 'm', usd: 1, discardedAttempt: { usd: -1 } })), 'a malformed split is left out');
  // the counter over this folder: the first record (cost 0.5 + discarded 0.25, thc 1) and the second (a paid reply with no figure: without)
  assert.deepEqual(providerReportedOf(d), { cost: 0.75, attempts: 2, thcUsd: 1, attemptsWithout: 1, unverified: true });
});
