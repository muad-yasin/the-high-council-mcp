// 0.8.4 DUALCAP unit 4a: the per-provider spend caps inside the engine (src/chain.js; the contract is src/caps.js "IN-PROCESS"). With the switch OFF nothing
// changes: one run total, `budget.cap`. With caps armed (setBudget(null), then setCapBudgets({ <id>: usd })), a seat's calls are gated and charged on the bucket of
// the account it bills through (billingAccountOf: a mock seat's mockBills), and every charge also lands in the run total. A seat with an account and no bucket is
// refused before anything is sent. Offline: mock seats with fixture prices, and one stubbed fetch for the thinking retry; nothing is paid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chain from '../src/chain.js';
import { costOf, projectAttempts, expectedCallUsd } from '../src/cost.js';

const { runChain, setBudget, setCache, budgetState, BudgetExceeded, setReservationSink, setPromptSpy, countEarlierSpend } = chain;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TWO_CAPS = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json'), 'utf8'));
// the account each stage of the two-cap chain bills through (the fixture's mockBills): criteria declares none
const ACCOUNT = { criteria: null, build: 'anthropic', 'revise-1': 'anthropic', 'critique-1': 'openrouter', 'critique-2': 'openrouter' };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const sum = xs => xs.reduce((n, x) => n + x, 0);

// A reservation sink that records what invoke() asks it to write (no file).
function sink() {
  const calls = [];
  let n = 0;
  return { calls, reserve(args) { calls.push(args); return `r${++n}`; }, settle() {} };
}
const arm = caps => { setBudget(null); chain.setCapBudgets(caps); };
const reset = () => { setCache(null); setBudget(null); setReservationSink(null); };

test('E1: the engine exports the bucket arming and the uncovered-seat refusal', () => {
  assert.equal(typeof chain.setCapBudgets, 'function');
  assert.equal(typeof chain.UncoveredSeat, 'function');
});

test('E2: setCapBudgets refuses what cannot be a cap (an unknown account, an amount that is not a number above 0, an empty map) and refuses to sit beside a run cap (no third total); nothing is armed', () => {
  assert.equal(typeof chain.setCapBudgets, 'function');
  try {
    for (const bad of [{ mock: 5 }, { 'open-router': 5 }, { anthropic: 0 }, { anthropic: -1 }, { anthropic: NaN }, { anthropic: '5' }, { anthropic: Infinity }, {}, null, [5]]) {
      setBudget(null);
      assert.throws(() => chain.setCapBudgets(bad), Error, JSON.stringify(bad));
      assert.equal('caps' in budgetState(), false, `nothing armed after ${JSON.stringify(bad)}`);
    }
    setBudget(5);
    assert.throws(() => chain.setCapBudgets({ anthropic: 5 }), /no third total|per-run spend cap|setBudget\(null\)/);
    assert.equal('caps' in budgetState(), false);
    assert.equal(budgetState().cap, 5, 'the run cap is left as it was');
  } finally { reset(); }
});

test('E3 SWITCH OFF: one run total exactly as before: budgetState() carries no caps, no stage carries capName, no reservation line names a cap', async () => {
  const s = sink();
  try {
    setCache(null); setBudget(1000); setReservationSink(s);
    const stages = [];
    await runChain({ request: 'Req.', config: TWO_CAPS, log: () => {}, onStage: x => stages.push(x) });
    assert.deepEqual(Object.keys(budgetState()), ['cap', 'spent', 'reserved', 'reservedExpected', 'assumed', 'remaining']);
    assert.ok(stages.length >= 4, 'fixture: the chain ran');
    assert.ok(stages.every(x => !('capName' in x)), 'no stage carries capName');
    assert.ok(s.calls.length >= 4 && s.calls.every(c => !('capName' in c)), 'no reservation names a cap');
    assert.ok(near(budgetState().spent, sum(stages.map(x => x.usd))));
  } finally { reset(); }
});

test('E4 CAPS ARMED: each call is charged to the cap of the account it bills through and to the run total; stages and reservations name that cap; a seat with no account counts in no cap', async () => {
  const s = sink();
  try {
    setCache(null); setReservationSink(s); arm({ anthropic: 1000, openrouter: 1000 });
    const stages = [];
    await runChain({ request: 'Req.', config: TWO_CAPS, log: () => {}, onStage: x => stages.push(x) });
    for (const x of stages) {
      assert.ok(x.label in ACCOUNT, `fixture: a known stage (${x.label})`);
      if (ACCOUNT[x.label]) assert.equal(x.capName, ACCOUNT[x.label], x.label); else assert.equal('capName' in x, false, x.label);
    }
    const st = budgetState();
    assert.equal(st.cap, null, 'no third total');
    assert.deepEqual(Object.keys(st.caps).sort(), ['anthropic', 'openrouter']);
    for (const id of ['anthropic', 'openrouter']) {
      const mine = stages.filter(x => ACCOUNT[x.label] === id);
      assert.ok(mine.length >= 1 && near(st.caps[id].spent, sum(mine.map(x => x.usd))), `${id}: its bucket holds exactly its stages`);
      assert.equal(st.caps[id].reserved, 0); assert.equal(st.caps[id].reservedExpected, 0);
      assert.ok(near(st.caps[id].remaining, 1000 - st.caps[id].spent));
    }
    assert.ok(near(st.spent, sum(stages.map(x => x.usd))), 'the run total holds every stage, the seat with no account included');
    assert.equal(st.reserved, 0);
    const byLabel = Object.fromEntries(s.calls.map(c => [c.label, c]));
    for (const [label, id] of Object.entries(ACCOUNT)) {
      if (!byLabel[label]) continue;
      if (id) assert.equal(byLabel[label].capName, id, label); else assert.equal('capName' in byLabel[label], false, label);
    }
  } finally { reset(); }
});

test('E5 CAPS ARMED: a call the cap of its account cannot hold stops the run at THAT cap: BudgetExceeded names it, with that cap\'s limit and spend; the other cap keeps what it spent', async () => {
  const logs = [];
  try {
    setCache(null); arm({ anthropic: 1000, openrouter: 0.0001 });
    let err = null;
    try { await runChain({ request: 'Req.', config: TWO_CAPS, log: l => logs.push(l) }); } catch (e) { err = e; }
    assert.ok(err instanceof BudgetExceeded, String(err));
    assert.equal(err.capName, 'openrouter');
    assert.equal(err.label, 'critique-1');
    assert.equal(err.cap, 0.0001);
    assert.equal(err.spent, 0, 'that cap\'s spend, not the run total');
    assert.match(err.message, /openrouter spend cap/);
    const st = budgetState();
    assert.ok(st.caps.anthropic.spent > 0, 'the builder\'s spend stays in the anthropic cap');
    assert.equal(st.caps.openrouter.spent, 0);
    assert.ok(st.spent > st.caps.anthropic.spent, 'the run total also holds the criteria seat, which counts in no cap');
    assert.ok(logs.some(l => /critique-1: STOPPED .*the openrouter cap's ceiling is \$0\.0001/.test(l)), logs.join('\n'));
  } finally { reset(); }
});

test('E6 CAPS ARMED: a seat whose account has no cap armed is refused before anything is reserved or sent (UncoveredSeat), the backstop behind the start refusal', async () => {
  const s = sink();
  try {
    setCache(null); setReservationSink(s); arm({ openrouter: 1000 });
    const stages = [];
    let err = null;
    try { await runChain({ request: 'Req.', config: TWO_CAPS, log: () => {}, onStage: x => stages.push(x) }); } catch (e) { err = e; }
    assert.ok(chain.UncoveredSeat && err instanceof chain.UncoveredSeat, String(err));
    assert.equal(err.label, 'build');
    assert.equal(err.capName, 'anthropic');
    assert.equal(err.controlFlow, true);
    assert.deepEqual(stages.map(x => x.label), ['criteria'], 'nothing after the criteria seat ran');
    assert.ok(!s.calls.some(c => c.label === 'build'), 'no reservation was written for it');
    assert.equal(budgetState().reserved, 0);
  } finally { reset(); }
});

// The thinking retry (thinking-retry-gate.test.js's stub and figures): an Anthropic seat whose first attempt spent its cap on thinking.
const IN = 30; const OUT = 4000;
const SEAT = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: OUT, extra: { output_config: { effort: 'high' } } };
const RETRY_CONFIG = { name: 'retry-gate', maxRounds: 1, seats: { criteria: SEAT, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } };
const cutByThinking = () => ({ ok: true, json: async () => ({ content: [], stop_reason: 'max_tokens', usage: { input_tokens: IN, output_tokens: OUT, output_tokens_details: { thinking_tokens: OUT } } }) });

test('E7 CAPS ARMED: the thinking retry is gated on the cap of its account: a cap that admits the first attempt and cannot hold the retry stops the run there, the retry unsent, the wasted attempt counted in that cap and the run total', async () => {
  const had = process.env.ANTHROPIC_API_KEY; const original = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-key';
  try {
    let sent = null; let calls = 0;
    setPromptSpy(p => { sent ??= { system: p.system, user: p.user }; });
    globalThis.fetch = async () => { calls++; return cutByThinking(); };
    setCache(null); setBudget(null);
    await assert.rejects(() => runChain({ request: 'A request.', config: RETRY_CONFIG, log: () => {} }));
    setPromptSpy(null);
    const { retry } = projectAttempts(SEAT, sent);
    const expected = expectedCallUsd(SEAT, { ...sent, label: 'criteria' });   // 0.8.4 unit 4: a call with an expected size has its retry checked at that expected cost, not at the retry's worst case
    const wasted = costOf('anthropic', 'claude-sonnet-5', { input: IN, output: OUT, thinking: OUT }).usd;
    assert.ok(retry > 0 && wasted > 0 && expected > 0 && expected < retry / 2, 'fixture');
    calls = 0;
    const charges = [];
    chain.setChargeHook(c => charges.push(c));
    setCache(null); arm({ anthropic: wasted + expected / 2 });
    let err = null;
    try { await runChain({ request: 'A request.', config: RETRY_CONFIG, log: () => {} }); } catch (e) { err = e; }
    chain.setChargeHook(null);
    assert.equal(charges.length, 1, 'one charge: the wasted attempt');
    assert.equal(charges[0].kind, 'waste');
    assert.equal(charges[0].capName, 'anthropic', 'the waste charge names its cap (the CLI writes it to the charge file)');
    assert.ok(err instanceof BudgetExceeded, String(err));
    assert.equal(err.retryRefused, true);
    assert.ok(near(err.gate, wasted + expected) && err.gate < err.projected, `0.8.4 unit 4: the stop's figure is the wasted attempt + the retry's expected cost (${err.gate} vs ${wasted + expected})`);
    assert.equal(err.capName, 'anthropic');
    assert.ok(near(err.spent, wasted), `that cap's spend is the wasted attempt (${err.spent} vs ${wasted})`);
    assert.equal(calls, 1, 'the retry was not sent');
    const st = budgetState();
    assert.ok(near(st.caps.anthropic.spent, wasted) && near(st.spent, wasted), 'counted once, in the cap and in the run total');
    assert.equal(st.caps.anthropic.reserved, 0); assert.equal(st.reserved, 0);
  } finally {
    globalThis.fetch = original; setPromptSpy(null); chain.setChargeHook(null); reset();
    if (had === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = had;
  }
});

test('E8 CAPS ARMED, a replay: a stage read back from the record goes to the cap its record names; a record that names none goes to the cap of its seat\'s account', async () => {
  try {
    setCache(null); arm({ anthropic: 1000, openrouter: 1000 });
    const first = [];
    await runChain({ request: 'Req.', config: TWO_CAPS, log: () => {}, onStage: x => first.push(x) });
    const records = Object.fromEntries(first.map(x => [x.label, { ...x }]));
    for (const r of Object.values(records)) delete r.promptHash;   // an in-memory record with no prompt hash replays trusted (unverified), whatever the prompt
    assert.equal(first.length, 5, 'fixture: criteria, build, critique-1, revise-1, critique-2');
    records.criteria.capName = 'anthropic';   // a record that names a cap, on a seat that bills through none
    delete records.build.capName;             // a record written with no cap named (the switch off, or before the caps were armed)
    setCache({ get: label => records[label] ?? null });
    arm({ anthropic: 1000, openrouter: 1000 });
    const again = [];
    await runChain({ request: 'Req.', config: TWO_CAPS, log: () => {}, onStage: x => again.push(x) });
    assert.ok(again.every(x => x.cached), 'fixture: every stage was replayed');
    const st = budgetState();
    const usd = label => records[label].usd;
    assert.ok(near(st.caps.anthropic.spent, usd('criteria') + usd('build') + usd('revise-1')), 'the record\'s cap, then the seat\'s cap for the record with none');
    assert.ok(near(st.caps.openrouter.spent, usd('critique-1') + usd('critique-2')));
    assert.ok(near(st.spent, sum(first.map(x => x.usd))));
    assert.equal(again.find(x => x.label === 'criteria').capName, 'anthropic');
    assert.equal(again.find(x => x.label === 'build').capName, 'anthropic');
  } finally { reset(); }
});

test('E9 CAPS ARMED: spend from an earlier sitting is counted in the cap its figure names and in the run total; a figure for a cap not armed counts in the run total only', () => {
  try {
    arm({ openrouter: 10 });
    countEarlierSpend(1.25, 'openrouter');
    countEarlierSpend(0.5, 'anthropic');
    countEarlierSpend(0.25);
    const st = budgetState();
    assert.ok(near(st.caps.openrouter.spent, 1.25));
    assert.ok(near(st.spent, 2));
    assert.deepEqual(Object.keys(st.caps), ['openrouter']);
  } finally { reset(); }
});

test('E10 CAPS ARMED: a seat with no price is still refused before anything is sent (UnpricedSeat, naming its cap\'s limit): with no run cap the backstop must not go dark', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('nothing may be sent'); };
  try {
    setCache(null); arm({ openrouter: 1000 });
    const config = { name: 'unpriced', maxRounds: 1, seats: { criteria: { provider: 'openrouter', model: 'no-such/unpriced-model', maxTokens: 100 }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } };
    let err = null;
    try { await runChain({ request: 'Req.', config, log: () => {} }); } catch (e) { err = e; }
    assert.ok(err instanceof chain.UnpricedSeat, String(err));
    assert.equal(err.cap, 1000);
    assert.equal(calls, 0, 'nothing was sent');
    assert.equal(budgetState().reserved, 0);
  } finally { globalThis.fetch = original; reset(); }
});
