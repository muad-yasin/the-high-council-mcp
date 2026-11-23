// Unit 3 (D43; his decision 2 of 28 Okt 2026, heading "TWO COST PICKS ...": an error reply that carries no usage figure is "charged at a typical cost for that call"). ONE figure for every call (src/cost.js
// typicalCallUsd): the expected cost of the call's BASE label (so a re-ask or the thinking retry is charged like the call it repeats), and for a call the dry run does not plan (a merge, a full revise, the conflict
// decider, the allocator, any label the table does not name) a typical size for what it writes: `draftTokens` for a merge or a full revise, `critiqueTokens` for the rest; never above the attempt's own worst case.
// The gate keeps its own figure. The functions are reached through the namespaces, so a missing export fails ONE test, not the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chainNs from '../src/chain.js';
import * as costNs from '../src/cost.js';
import { setRetrySleep } from '../src/providers.js';

const { runSingleStage, setBudget, setCache, budgetState, setChargeHook } = chainNs;
const { expectedCallUsd, expectedOutputTokensOf, projectAttempts, costOf, promptCharsOf, promptTokensOfChars, DEFAULT_ESTIMATE } = costNs;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const near = (a, b) => Math.abs(a - b) < 1e-9;
const SEAT = { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 20000 };       // not an Anthropic seat here: one attempt per ask
const PRICED = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500 };   // an Anthropic seat: a thinking cut-off is asked again
const P = { system: 'S', user: 'U'.repeat(400) };

function stub(handler) {
  const seen = []; const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { seen.push(1); handler(seen.length, req, res); }); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}
async function withKey(fn) {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'c'.repeat(40);
  try { await fn(); } finally { if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
}
const json = (res, body, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const errorBody = res => json(res, { error: { message: 'upstream failed', code: 502 } });
const cutOff = res => json(res, { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 500 } } });
// What the old tree charged for any of these: one attempt's worst case.
const worstOf = seat => projectAttempts(seat, P).first;
// The typical charge at the row's prices, written out by hand: the call's prompt as input, `outTokens` written.
const handUsd = (seat, outTokens) => costOf(seat.provider, seat.model, { input: promptTokensOfChars(promptCharsOf(P)), output: outTokens }).usd;

async function chargedFor(label, seat = SEAT, handler = (n, req, res) => errorBody(res)) {
  const charges = []; const logs = []; const s = await stub(handler);
  setChargeHook(c => charges.push(c));
  try {
    setCache(null); setBudget(1000);
    await assert.rejects(() => runSingleStage({ ...seat, baseUrl: s.url }, { ...P, label, log: m => logs.push(m) }));
    return { charges, logs, spent: budgetState().spent, requests: s.seen.length };
  } finally { setBudget(null); setChargeHook(null); s.srv.close(); }
}

test('baseLabelOf strips the attempt endings, and its regex is the one src/spans.js strips with (so the two cannot drift)', () => {
  const f = costNs.baseLabelOf;
  assert.equal(typeof f, 'function');
  for (const [label, base] of [['panel-1-opus-reask1-retry', 'panel-1-opus'], ['build-retry', 'build'], ['x-answered', 'x'], ['x-question', 'x'], ['x-reask12', 'x'], ['panel-2-a-reask2', 'panel-2-a'], ['criteria', 'criteria'], ['solo-merge', 'solo-merge']]) {
    assert.equal(f(label), base, label);
  }
  // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026). OLD: '(-(retry|answered|question|reask\\d+))+$'. NEW: with |solo. WHY: the solo ask's stage file (`panel-<n>-<seat>-solo`) is the same seat's reply, so both strippers name it.
  const literal = '(-(retry|answered|question|reask\\d+|solo))+$';
  assert.ok(readFileSync(join(root, 'src', 'spans.js'), 'utf8').includes(literal), 'spans.js strips with this regex');
  assert.ok(readFileSync(join(root, 'src', 'cost.js'), 'utf8').includes(literal), 'and so does cost.js');
});

test('typicalOutputTokensOf: a call with an expected size is charged that size, a re-ask or retry like the call it repeats, and a call without one a typical size for what it writes, never above its cap', () => {
  const f = costNs.typicalOutputTokensOf; assert.equal(typeof f, 'function');
  const est = {};
  for (const l of ['criteria', 'criteria-reask1', 'criteria-retry']) assert.equal(f(l, SEAT, est), 400, `${l}: the table's criteria size`);
  for (const l of ['build', 'build-retry']) assert.equal(f(l, SEAT, est), DEFAULT_ESTIMATE.draftTokens, `${l}: the draft size`);
  assert.equal(f('panel-1-opus', SEAT, est), expectedOutputTokensOf('panel-1-opus', SEAT, est));
  assert.equal(f('panel-1-opus-reask1', SEAT, est), expectedOutputTokensOf('panel-1-opus', SEAT, est), 'a re-ask is charged like the review it repeats');
  for (const l of ['x-merge', 'x-merge-retry', 'revise-2-full']) assert.equal(f(l, SEAT, est), DEFAULT_ESTIMATE.draftTokens, `${l}: a merge or a full revise writes a whole draft`);
  for (const l of ['solo', 'conflict-1', 'allocator-1']) assert.equal(f(l, SEAT, est), DEFAULT_ESTIMATE.critiqueTokens, `${l}: the critique size`);
  assert.equal(f('solo', SEAT, { critiqueTokens: 900 }), 900, 'the chain\'s own estimate block is read');
  assert.equal(f('solo', { ...SEAT, maxTokens: 500 }, est), 500, 'never above the call\'s own cap');
  assert.equal(f('solo', SEAT, { critiqueTokens: 'x' }), DEFAULT_ESTIMATE.critiqueTokens, 'a malformed estimate falls back to the default');
  assert.equal(f(7, SEAT, est), null); assert.equal(f('solo', null, est), null);
  for (const l of ['solo', 'conflict-1', 'allocator-1', 'x-merge', 'panel-1-opus-reask1']) assert.equal(expectedOutputTokensOf(l, SEAT, est), null, `${l}: the gate's expected size is still none for it (the gate is unchanged)`);
});

test('typicalCallUsd: a planned call is charged exactly its expected cost; a call without one its prompt plus a typical output at the row\'s prices; the ceiling caps it', () => {
  const f = costNs.typicalCallUsd; assert.equal(typeof f, 'function');
  assert.equal(f(SEAT, { ...P, label: 'criteria' }), expectedCallUsd(SEAT, { ...P, label: 'criteria' }), 'the same figure the gate decides on');
  assert.equal(f(SEAT, { ...P, label: 'criteria-reask1' }), expectedCallUsd(SEAT, { ...P, label: 'criteria' }), 'a re-ask: the base label\'s figure');
  assert.ok(near(f(SEAT, { ...P, label: 'solo' }), handUsd(SEAT, 1200)), 'the decider, the allocator and unnamed labels: the prompt plus a critique-sized output');
  assert.ok(near(f(SEAT, { ...P, label: 'x-merge' }), handUsd(SEAT, 6000)), 'a merge: the prompt plus a draft-sized output');
  assert.ok(f(SEAT, { ...P, label: 'solo' }) > handUsd(SEAT, 0), 'and the output part is not zero');
  assert.equal(f(SEAT, { ...P, label: 'solo', ceilingUsd: 0.0000001 }), 0.0000001, 'never above the attempt\'s own worst case');
  assert.equal(expectedCallUsd(SEAT, { ...P, label: 'solo' }), null, 'the gate still has no expected size for it');
});

test('an empty error reply on a panel RE-ASK is charged the expected cost of the review it repeats, not the worst case', () => withKey(async () => {
  const { charges, spent } = await chargedFor('panel-1-opus-reask1');
  const expected = expectedCallUsd(SEAT, { ...P, label: 'panel-1-opus' });
  assert.ok(expected > 0 && expected < worstOf(SEAT), 'fixture: a real figure below the worst case');
  assert.ok(near(spent, expected), `charged ${spent}, the repeated review's expected cost is ${expected} (the worst case is ${worstOf(SEAT)})`);
  assert.equal(charges.length, 1); assert.equal(charges[0].kind, 'billed'); assert.ok(near(charges[0].usd, expected));
}));

test('an empty error reply on the conflict decider (no expected size) is charged its prompt plus a critique-sized output, not the worst case; the gate still prices it at the worst case', () => withKey(async () => {
  const { charges, spent, logs } = await chargedFor('conflict-1');
  const typical = handUsd(SEAT, 1200);
  assert.ok(typical > handUsd(SEAT, 0) && typical < worstOf(SEAT), 'fixture: more than the prompt alone, less than the worst case');
  assert.ok(near(spent, typical), `charged ${spent}, a typical cost is ${typical} (the worst case is ${worstOf(SEAT)})`);
  assert.ok(near(charges[0].usd, typical));
  assert.match(charges[0].reason, /error reply/); assert.match(charges[0].reason, /typical cost/); assert.doesNotMatch(charges[0].reason, /worst case/, 'the record no longer says worst case');
  const chargeLines = logs.filter(m => /an error reply and no usage figure/.test(m));
  assert.equal(chargeLines.length, 1); assert.match(chargeLines[0], /a typical cost for this call/); assert.doesNotMatch(chargeLines[0], /worst case/, 'nor does the run log\'s charge line');
  // the gate is unchanged: outside a run every call is gated at its worst case, so a limit between the two figures refuses it before anything is sent
  const s2 = await stub((n, req, res) => errorBody(res));
  try {
    setCache(null); setBudget((typical + worstOf(SEAT)) / 2);
    await assert.rejects(() => runSingleStage({ ...SEAT, baseUrl: s2.url }, { ...P, label: 'conflict-1', log: () => {} }), err => err instanceof chainNs.BudgetExceeded);
    assert.equal(s2.seen.length, 0, 'refused by the gate at the worst case: nothing was sent');
  } finally { setBudget(null); s2.srv.close(); }
}));

test('an empty error reply on a merge is charged the prompt plus a draft-sized output', () => withKey(async () => {
  const { spent } = await chargedFor('x-merge');
  assert.ok(near(spent, handUsd(SEAT, 6000)) && spent < worstOf(SEAT), `charged ${spent}`);
}));

test('an empty error reply on the thinking RETRY\'s ask is charged a typical cost (the retry is not special), and the discarded first attempt keeps its own waste charge', () => withKey(async () => {
  const seat = PRICED; const charges = [];
  const s = await stub((n, req, res) => (n === 1 ? cutOff(res) : errorBody(res)));
  setChargeHook(c => charges.push(c));
  try {
    setCache(null); setBudget(1000);
    await assert.rejects(() => runSingleStage({ ...seat, baseUrl: s.url }, { ...P, label: 'think', log: () => {} }));
    const { first, retry } = projectAttempts(seat, P);
    const billed = charges.filter(c => c.kind === 'billed'); const waste = charges.filter(c => c.kind === 'waste');
    assert.equal(s.seen.length, 2, 'the cut-off, then the retry');
    assert.equal(billed.length, 1); assert.equal(waste.length, 1);
    const typical = handUsd(seat, 500);   // the prompt plus a critique-sized output (1200), cut to this seat's 500-token cap
    assert.ok(typical > 0 && typical < retry, 'fixture: a real figure below the retry\'s worst case');
    assert.ok(near(billed[0].usd, typical), `the retry's error reply: ${billed[0].usd}, a typical cost is ${typical}, the retry's worst case is ${retry}`);
    assert.ok(near(budgetState().spent, typical + waste[0].usd), 'and the cap counts that plus the discarded first attempt');
  } finally { setBudget(null); setChargeHook(null); s.srv.close(); }
}));

test('a reply that carries a usage figure is still charged at that figure; zero usage is still no charge (D43 changes only the empty reply)', () => withKey(async () => {
  const s = await stub((n, req, res) => json(res, { error: { message: 'x' }, usage: { prompt_tokens: 120, completion_tokens: 40 } }));
  const charges = []; setChargeHook(c => charges.push(c));
  try {
    setCache(null); setBudget(1000);
    await assert.rejects(() => runSingleStage({ ...SEAT, baseUrl: s.url }, { ...P, label: 'solo', log: () => {} }));
    assert.ok(near(charges[0].usd, costOf(SEAT.provider, SEAT.model, { input: 120, output: 40 }).usd));
  } finally { setBudget(null); setChargeHook(null); s.srv.close(); }
}));

// CHANGED ACCEPTED (his pick of 04 Nov 2026, "2: typical cost"). OLD title: "... and a bare 5xx still settles at $0" (the plan of record). NEW: the spy returns $0 here on purpose, so what the test pins is the figure the seam is HANDED; what the real function returns is pinned in http5xx-resend.test.js. WHY: the old title claimed a behaviour that is no longer the product's.
test('the 5xx seam receives the same typical figure (one function): a label with an expected size gets that size, the conflict decider a critique-sized one (the spy here settles at $0, so nothing is counted)', () => withKey(async () => {
  assert.equal(typeof chainNs.setHttp5xxSettlementForTest, 'function');
  for (const [label, want] of [['criteria', expectedCallUsd(SEAT, { ...P, label: 'criteria' })], ['conflict-1', handUsd(SEAT, 1200)]]) {
    const received = []; const s = await stub((n, req, res) => { res.statusCode = 503; res.end('x'); });
    chainNs.setHttp5xxSettlementForTest(f => { received.push(f); return { usd: 0, reason: '' }; });
    try {
      setCache(null); setBudget(1000); setRetrySleep(async () => {});
      await assert.rejects(() => runSingleStage({ ...SEAT, baseUrl: s.url }, { ...P, label, log: () => {} }));
      assert.ok(received.length >= 1, `${label}: the seam was reached`);
      for (const f of received) {
        assert.equal(typeof f.typical, 'number', `${label}: the seam is handed the typical figure`);
        assert.ok(near(f.typical, want), `${label}: it is ${f.typical}, the typical charge of this call is ${want}`);
        assert.ok(f.typical <= f.attemptWorstCase, `${label}: and not above the attempt's worst case`);
      }
      assert.equal(budgetState().spent, 0, `${label}: the spy settled at $0, so nothing was counted`);
    } finally { chainNs.setHttp5xxSettlementForTest(null); setRetrySleep(null); setBudget(null); s.srv.close(); }
  }
}));

// Unit 0's dropped-connection charge, widened by the same function (Mini-C&C, 04 Nov 2026: plan A reads "a typical cost" and "the expected cost" as ONE figure). A reset after the request went out is asked again and its failed
// attempt carries no usage figure: for a call the dry run does not plan it used to be charged one attempt's worst case.
test('a dropped connection that is asked again is charged a typical cost, not the worst case: a label with an expected size gets that size, the conflict decider a critique-sized one', () => withKey(async () => {
  for (const [label, want] of [['conflict-1', handUsd(SEAT, 1200)], ['criteria', costNs.expectedCallUsd(SEAT, { ...P, label: 'criteria' })]]) {
    const charges = []; const s = await stub((n, req, res) => { if (n === 1) req.socket.destroy(); else json(res, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }); });
    setChargeHook(c => charges.push(c));
    try {
      setCache(null); setBudget(1000); setRetrySleep(async () => {});
      const st = await runSingleStage({ ...SEAT, baseUrl: s.url }, { ...P, label, log: () => {} });
      assert.equal(s.seen.length, 2, `${label}: a reset after the request went out is asked again (the control)`);
      const billed = charges.filter(c => c.kind === 'billed');
      assert.equal(billed.length, 1, `${label}: the failed attempt is one charge record`);
      assert.ok(want > 0 && want < worstOf(SEAT), `${label}: fixture: a real figure below the worst case`);
      assert.ok(near(billed[0].usd, want), `${label}: charged ${billed[0].usd}, a typical cost is ${want} (the worst case is ${worstOf(SEAT)})`);
      assert.ok(near(budgetState().spent, want + st.usd), `${label}: and the cap counts that attempt plus the answer, each once`);
    } finally { setRetrySleep(null); setBudget(null); setChargeHook(null); s.srv.close(); }
  }
}));
