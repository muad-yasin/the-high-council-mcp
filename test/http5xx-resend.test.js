// Unit 0b (flag 4; C&C under his 18 Okt pick (c): "count every retry AND bound the retries"). A 5xx means the request reached the provider. The adapter used to send it again twice, free and unrecorded; invoke() now does:
// each re-send has the gate, a reservation at the worst case BEFORE it is sent, a settlement and a log line; the bound is the existing 2 per ask (the first ask and a thinking-retry ask count apart). With `reachedProvider: true` on the settled
// line, derived from the status, a settlement for a request that reached the provider is told from one never sent. A 429 and a failure before anything was sent stay free in the adapter.
// His pick of 04 Nov 2026 ("2: typical cost"; heading "COST COUNTING PICKS 1 AND 2 ..."): a bare 5xx attempt is no longer settled at $0. One function (chain.js httpErrorAttemptSettlement) decides the amount and returns the call's typical cost,
// the figure an empty error reply is charged (unit 3, src/cost.js typicalCallUsd); the attempt settles `billed_unreadable` with that amount and gets its own charge file, still marked `reachedProvider`. A seat that does not bill stays $0.
// The reservation on disk stays the worst case. The guard of S6-12 (a label that settled `billed_unreadable` twice is not asked again after a dropped connection) now counts these settlements: that is the consequence he was told.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as chainNs from '../src/chain.js';
import { openReservations, RESERVATIONS_FILE, settledCountOf } from '../src/spend-reservations.js';
import { recordLostCharge } from '../src/superseded.js';
import { setRetrySleep, isRetryable } from '../src/providers.js';
import { runSpentUsd } from '../src/spend.js';
import { costOf, promptCharsOf, promptTokensOfChars, projectAttempts, DEFAULT_ESTIMATE } from '../src/cost.js';

const { runSingleStage, setBudget, setCache, setReservationSink, setChargeHook, budgetState } = chainNs;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const dir = () => mkdtempSync(join(tmpdir(), 'thc-5xx-'));
const lines = d => readFileSync(join(d, RESERVATIONS_FILE), 'utf8').trimEnd().split('\n').map(l => JSON.parse(l));
const settledOf = d => lines(d).filter(l => l.event === 'settled');
const reservedFor = (d, label) => lines(d).filter(l => l.event === 'reserved' && l.label === label).length;
const PRICED = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500 };   // an Anthropic seat: a thinking cut-off is asked again at a bigger cap
const SEAT = { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 20000 };                                    // not an Anthropic seat: one attempt per ask, and a typical size well under the worst case
const PROMPT = { system: 's', user: 'u' };
// The typical charge at the row's prices, written out by hand: the call's prompt as input, `outTokens` written. A call with no expected size (these stages are run alone) is charged a critique-sized output, never more than the seat's cap.
const handUsd = (seat, outTokens) => costOf(seat.provider, seat.model, { input: promptTokensOfChars(promptCharsOf(PROMPT)), output: outTokens }).usd;
const TYP = handUsd(SEAT, Math.min(DEFAULT_ESTIMATE.critiqueTokens, SEAT.maxTokens));
const TYP_PRICED = handUsd(PRICED, Math.min(DEFAULT_ESTIMATE.critiqueTokens, PRICED.maxTokens));
const TYP_WHOLE = handUsd(SEAT, SEAT.maxTokens);   // the advice and deep-dive labels have their own expected size in the table: the seat's whole output cap, so their typical charge is the whole attempt (checked against typicalCallUsd with an import-only script)
const WORST = projectAttempts(SEAT, PROMPT).first;
const sleeps = [];
function arm() {
  const d = dir(); const charges = []; sleeps.length = 0;
  setCache(null); setBudget(50); setRetrySleep(async ms => { sleeps.push(ms); });
  setReservationSink(openReservations(d)); setChargeHook(c => { charges.push(c); recordLostCharge(d, c.label, c); });
  return { d, charges };
}
function disarm() { setBudget(null); setReservationSink(null); setChargeHook(null); setRetrySleep(null); chainNs.setHttp5xxSettlementForTest?.(null); }
function stub(handler) {
  const seen = []; const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { seen.push(1); handler(seen.length, req, res); }); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}
async function withKey(fn) {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'c'.repeat(40);
  try { await fn(); } finally { if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
}
const ok = res => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } })); };
const cutOff = res => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 500 } } })); };
const status = (res, code, headers = {}) => { res.statusCode = code; for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); res.end('x'); };
const run = (url, label) => runSingleStage({ ...PRICED, baseUrl: url }, { system: 's', user: 'u', label, log: () => {} });

// CHANGED ACCEPTED (his pick 04 Nov 2026, "2: typical cost"). OLD: the 5xx settled `failed` at $0, no charge record, the counted amount was the answer alone. NEW: it settles `billed_unreadable` at the call's typical cost (TYP), keeps the
// marker, has its own charge record, and the counted amount is the answer plus the 5xx. WHY: the request reached the provider and no bill is known; he picked a typical cost over $0.
test('a 5xx then an answer: the re-send is its own reservation (2 lines, written before each request), the 5xx is counted at a typical cost with the marker and its own charge, the answer counted once', () => withKey(async () => {
  const logs = []; const atSend = []; let dRef = null;
  const s = await stub((n, req, res) => { atSend.push(lines(dRef).filter(l => l.event === 'reserved').length); if (n === 1) status(res, 503); else ok(res); });
  const { d, charges } = arm(); dRef = d;
  try {
    const st = await runSingleStage({ ...SEAT, baseUrl: s.url }, { ...PROMPT, label: 'five', log: m => logs.push(m) });
    assert.deepEqual([s.seen.length, atSend], [2, [1, 2]], 'two requests; request k finds k reservations on disk');
    const settled = settledOf(d);
    assert.deepEqual(settled.map(l => [l.outcome, l.reachedProvider]), [['billed_unreadable', true], ['recorded', undefined]], 'the 5xx: billed_unreadable, still marked as having reached the provider; the answer: recorded, no marker');
    assert.ok(near(settled[0].usd, TYP) && near(settled[1].usd, st.usd), `the 5xx is settled at the typical cost ${TYP} (${settled[0].usd}), the answer at its own`);
    assert.ok(TYP > 0 && TYP < WORST, 'and the typical cost is a real figure below the worst case that was reserved');
    for (const l of lines(d).filter(x => x.event === 'reserved')) assert.ok(near(l.usd, WORST), 'the reservation on disk stays the worst case');
    const billed = charges.filter(c => c.kind === 'billed');
    assert.equal(billed.length, 1, 'one charge record, for the 5xx');
    assert.ok(near(billed[0].usd, TYP) && billed[0].reachedProvider === true && /HTTP 503/.test(billed[0].reason) && /typical cost for this call/.test(billed[0].reason), JSON.stringify(billed[0]));
    assert.ok(near(budgetState().spent, st.usd + TYP), `the counted amount is the answer plus the 5xx (${budgetState().spent})`);
    assert.equal(logs.filter(m => /sending it again \(re-send 1 of 2 for the first ask\)/.test(m)).length, 1);
    assert.equal(logs.filter(m => /after the request was sent - a typical cost for this call/.test(m)).length, 1, 'and the log says what was counted');
    assert.equal(logs.filter(m => /asking again/.test(m)).length, 0, 'and no transport-resume line follows a 5xx');
  } finally { disarm(); s.srv.close(); }
}));

// CHANGED ACCEPTED. OLD: three attempts settled `failed` at $0 with the marker. NEW: three `billed_unreadable` settlements at TYP, each with the marker (the last one too: the thrown 5xx), three charge records, spent = 3 * TYP. WHY: as above.
test('a 5xx that never stops: three requests (the first and 2 re-sends), three reservations, every one counted at a typical cost with the marker, then the 5xx is thrown (not a control-flow stop)', () => withKey(async () => {
  const s = await stub((n, req, res) => status(res, 503)); const { d, charges } = arm();
  try {
    await assert.rejects(() => runSingleStage({ ...SEAT, baseUrl: s.url }, { ...PROMPT, label: 'five', log: () => {} }), err => err.status === 503 && !err.controlFlow);
    assert.deepEqual([s.seen.length, reservedFor(d, 'five')], [3, 3], 'the first request and 2 re-sends, each reserved');
    const settled = settledOf(d);
    assert.deepEqual(settled.map(l => [l.outcome, l.reachedProvider]), [['billed_unreadable', true], ['billed_unreadable', true], ['billed_unreadable', true]], 'every attempt counted, the thrown one too, each with the marker');
    assert.ok(settled.every(l => near(l.usd, TYP)), 'each at the typical cost');
    assert.equal(charges.filter(c => c.kind === 'billed').length, 3, 'each its own charge record');
    assert.ok(near(budgetState().spent, 3 * TYP), `spent is three typical costs (${budgetState().spent})`);
    assert.ok(near(runSpentUsd(d), 3 * TYP), 'and so is a spend read of the run folder');
    assert.equal(isRetryable({ status: 503 }), true, 'isRetryable is unchanged: STOPPED-error.json transient still reads it');
  } finally { disarm(); s.srv.close(); }
}));

// CHANGED ACCEPTED. OLD: the three 5xx on the retry ask settled `failed`. NEW: `billed_unreadable` at the typical cost of the call (TYP_PRICED: a retry ask is charged like the call it repeats, below the retry's own worst case), plus the three waste charges they always were.
test('a thinking-retry ask has its own two re-sends: a 5xx on the retry ask restarts the attempt; the bound is 2 per ask, so six requests and three attempts end in the 5xx, each 5xx counted at a typical cost', () => withKey(async () => {
  const s = await stub((n, req, res) => (n % 2 === 1 ? cutOff(res) : status(res, 503))); const { d, charges } = arm(); const logs = [];
  try {
    await assert.rejects(() => runSingleStage({ ...PRICED, baseUrl: s.url }, { ...PROMPT, label: 'both', log: m => logs.push(m) }), err => err.status === 503);
    assert.deepEqual([s.seen.length, reservedFor(d, 'both')], [6, 3], 'each attempt: the first ask (cut off, thinking) then the retry ask (5xx); the third 5xx on the retry ask is thrown');
    assert.deepEqual(settledOf(d).map(l => [l.outcome, l.reachedProvider]), [['billed_unreadable', true], ['billed_unreadable', true], ['billed_unreadable', true]]);
    const billed = charges.filter(c => c.kind === 'billed');
    assert.equal(billed.length, 3);
    assert.ok(billed.every(c => near(c.usd, TYP_PRICED) && c.usd < projectAttempts(PRICED, PROMPT).retry), `each 5xx on the retry ask is charged the call's typical cost (${TYP_PRICED}), not the retry's worst case`);
    assert.equal(charges.filter(c => c.kind === 'waste').length, 3, 'the discarded cut-off attempts are the waste they always were');
    assert.ok(logs.some(m => /to the retry ask; starting the call again \(re-send 1 of 2 for the retry ask\): its first ask is sent again/.test(m)), 'the log says what happens: the call starts again');
  } finally { disarm(); s.srv.close(); }
}));

test('a 429 stays free inside the adapter (one reservation, no marker, Retry-After honoured); so does a 400 (sent once, no marker)', () => withKey(async () => {
  const s = await stub((n, req, res) => (n === 1 ? status(res, 429, { 'retry-after': '30' }) : ok(res))); const { d } = arm();
  try {
    await run(s.url, 'slow');
    assert.deepEqual([s.seen.length, reservedFor(d, 'slow'), sleeps], [2, 1, [30000]]);
    assert.deepEqual(settledOf(d).map(l => l.reachedProvider), [undefined]);
  } finally { disarm(); s.srv.close(); }
  const s2 = await stub((n, req, res) => status(res, 400)); const a2 = arm();
  try {
    await assert.rejects(() => run(s2.url, 'bad'));
    assert.deepEqual([s2.seen.length, reservedFor(a2.d, 'bad'), settledOf(a2.d).map(l => l.reachedProvider)], [1, 1, [undefined]]);
  } finally { disarm(); s2.srv.close(); }
}));

// CHANGED ACCEPTED (C&C via Mini-C&C, R181, on his pick "2: typical cost"). OLD: "every label is counted, the excluded families included": advise-x, deep-dive-a-1 and digest each got a second request (2 requests, 2 reservations). NEW: the advice add-on
// still sends again, and hands its ceiling ledger what the failed attempt was counted at (`lostChargesUsd` on the stage, not in `usd`); the deep dive and the side commands that make one call send a 5xx ONCE, the single attempt still counted at the typical cost.
// WHY: each 5xx is a charge now, and the deep dive's cap and the side commands' policy limit are checked once, before the call, on one attempt's figure, so a re-send could pass them.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, box set fix): OLD: the first half also pinned the advice add-on (label advise-x) sending a 5xx again and the stage's lostChargesUsd. NEW: only the deep dive and the side commands. WHY: the advice add-on is removed.
test('the deep dive and the one-call side commands send a 5xx once, the one attempt still counted', () => withKey(async () => {
  for (const [label, want] of [['deep-dive-a-1', TYP_WHOLE], ['digest', TYP], ['handoff-from-run', TYP], ['contract-draft', TYP]]) {
    const s3 = await stub((n, req, res) => status(res, 503)); const { d: d3, charges: c3 } = arm();
    try {
      await assert.rejects(() => runSingleStage({ ...SEAT, baseUrl: s3.url }, { ...PROMPT, label, log: () => {} }), err => err.status === 503, label);
      assert.deepEqual([s3.seen.length, reservedFor(d3, label)], [1, 1], `${label}: sent once`);
      assert.deepEqual(settledOf(d3).map(l => [l.outcome, l.reachedProvider]), [['billed_unreadable', true]], `${label}: the one attempt is counted, with the marker`);
      assert.ok(near(budgetState().spent, want) && c3.filter(c => c.kind === 'billed').length === 1, `${label}: at the label's typical cost (${budgetState().spent})`);
    } finally { disarm(); s3.srv.close(); }
  }
}));

// The seam: the amount of a 5xx attempt is decided by ONE function. A spy returning $0.37 must show up on every 5xx path: the re-sent attempt, the final 5xx, the thinking-retry ask's 5xx, an excluded label.
// `settlementProblems` is the check; its known-bad input is a ledger in which a 5xx attempt settled at $0 outside the function.
const SPY_USD = 0.37;
function settlementProblems(settled) {
  const out = [];
  for (const l of settled.filter(x => x.reachedProvider === true)) {
    if (l.outcome !== 'billed_unreadable' || l.usd !== SPY_USD) out.push(`${l.id}: settled ${l.outcome} ${l.usd}, not through the function (${SPY_USD})`);
  }
  if (!settled.some(x => x.reachedProvider === true)) out.push('no 5xx settlement on the ledger');
  return out;
}
test('the settlement seam: the checker finds a 5xx attempt that settled outside the function (known-bad input), and finds none on the real ledger', () => {
  const good = [{ id: 'r1', event: 'settled', outcome: 'billed_unreadable', usd: SPY_USD, reachedProvider: true }];
  const bad = [{ id: 'r1', event: 'settled', outcome: 'billed_unreadable', usd: SPY_USD, reachedProvider: true }, { id: 'r2', event: 'settled', outcome: 'failed', usd: 0, reachedProvider: true }];
  assert.deepEqual(settlementProblems(good), []);
  assert.equal(settlementProblems(bad).length, 1, 'a 5xx attempt that settled $0 outside the function');
  assert.equal(settlementProblems([]).length, 1, 'a ledger with no 5xx settlement proves nothing');
});

test('every 5xx path settles through httpErrorAttemptSettlement: with a spy at $0.37 the re-sent attempt, the final 5xx, the thinking-retry ask\'s 5xx and an excluded label all settle there; the function returns the typical figure it is handed', () => withKey(async () => {
  assert.equal(typeof chainNs.httpErrorAttemptSettlement, 'function', 'the function is named and exported');
  assert.equal(typeof chainNs.setHttp5xxSettlementForTest, 'function', 'and replaceable by a test');
  // CHANGED ACCEPTED. OLD: the function returned { usd: 0, reason: '' } whatever it was handed (the plan of record, plan A l.728). NEW: it returns the typical figure it is handed, the attempt's worst case when there is none, and $0 for a seat that does not bill. WHY: his pick, 04 Nov 2026.
  const f = chainNs.httpErrorAttemptSettlement;
  const planned = f({ status: 503, expected: 0.2, typical: 0.2, attemptWorstCase: 1, onRetry: false });
  assert.equal(planned.usd, 0.2, 'the typical figure it is handed');
  assert.match(planned.reason, /^the provider answered HTTP 503 after the request was sent and no usage figure came back; counted toward the cap at a typical cost for this call \(its expected cost\)$/, 'a first ask of a planned call says so');
  for (const facts of [{ status: 502, expected: null, typical: 0.2, attemptWorstCase: 1, onRetry: false }, { status: 502, expected: 0.2, typical: 0.2, attemptWorstCase: 1, onRetry: true }]) {
    const r = f(facts); assert.equal(r.usd, 0.2); assert.ok(/typical cost for this call$/.test(r.reason) && !/expected cost/.test(r.reason), `${JSON.stringify(facts)}: ${r.reason}`);
  }
  assert.equal(f({ status: 503, typical: null, attemptWorstCase: 0.7 }).usd, 0.7, 'no typical figure can be made: the attempt\'s worst case, the count errs high (as the error-reply branch does)');
  assert.equal(f({ status: 503, typical: 0, attemptWorstCase: 0 }).usd, 0, 'a seat that does not bill: $0');
  for (const [label, handler, expectedSettlements] of [
    ['five', (n, req, res) => (n === 1 ? status(res, 503) : ok(res)), 1],
    ['final', (n, req, res) => status(res, 503), 3],
    ['both', (n, req, res) => (n % 2 === 1 ? cutOff(res) : status(res, 503)), 3],
    ['advise-x', (n, req, res) => (n === 1 ? status(res, 503) : ok(res)), 1],
  ]) {
    const received = [];
    const s = await stub(handler); const { d, charges } = arm();
    chainNs.setHttp5xxSettlementForTest?.(facts => { received.push(facts); return { usd: SPY_USD, reason: 'the spy' }; });
    try {
      const answer = await run(s.url, label).catch(() => null);
      assert.ok(received.length === expectedSettlements && received.every(f => f.status === 503 && f.label === label && 'seat' in f && 'expected' in f && typeof f.typical === 'number' && f.typical > 0 && f.typical <= f.attemptWorstCase && 'attemptWorstCase' in f && 'onRetry' in f), `${label}: the function received the call's facts { seat, label, status, expected, typical, attemptWorstCase, onRetry }`);
      if (label === 'both') assert.ok(received.every(f => f.onRetry === true), 'and knows the 5xx was on the retry ask');
      assert.ok(charges.filter(c => c.kind === 'billed').every(c => c.reachedProvider === true), `${label}: the charge records carry the marker too`);
      // The charge files EXIST (a non-empty list), the billed ones carry the marker, the cap's spent grew by the spy's figure once per 5xx settlement, and a spend read carries them.
      const files = readdirSync(join(d, 'superseded')).filter(f => /\.charge-\d+\.usage\.json$/.test(f)).map(f => JSON.parse(readFileSync(join(d, 'superseded', f), 'utf8')));
      const billedFiles = files.filter(f => f.kind === 'billed'), wasteUsd = files.filter(f => f.kind === 'waste').reduce((n, f) => n + f.usd, 0);
      assert.equal(billedFiles.length, expectedSettlements, `${label}: one billed charge file per 5xx settlement (a non-empty list)`);
      assert.ok(billedFiles.every(f => f.reachedProvider === true && f.usd === SPY_USD), `${label}: and each carries the marker and the spy's figure`);
      const others = wasteUsd + (answer?.usd ?? 0);   // what is not a 5xx settlement: discarded cut-off attempts and the answer, if one came
      assert.ok(near(budgetState().spent, expectedSettlements * SPY_USD + others), `${label}: the cap's spent grew by ${SPY_USD} per 5xx settlement (${budgetState().spent})`);
      // CHANGED ACCEPTED (0.8.4 unit 6, D11; Mini-C&C R394 Q4: a settled call with no usage file is counted). OLD: the spend read of the folder = the 5xx settlements + the waste. NEW: + the answer, when one came: runSingleStage writes no stage usage file, so the answer's `settled` line is a settled call with no file, which the one reader now counts (a real run writes the file and the reader counts it once). WHY: the answer was always paid for.
      assert.ok(near(runSpentUsd(d), expectedSettlements * SPY_USD + wasteUsd + (answer?.usd ?? 0)), `${label}: and a spend read of the run folder carries them (${runSpentUsd(d)})`);
      // the check can fail: the expected sum off by one settlement is refused
      assert.ok(!near(budgetState().spent, (expectedSettlements + 1) * SPY_USD + others) && !near(runSpentUsd(d), (expectedSettlements - 1) * SPY_USD + wasteUsd + (answer?.usd ?? 0)), `${label}: a sum off by one settlement is not accepted`);
      const five = settledOf(d).filter(l => l.reachedProvider === true);
      assert.equal(five.length, expectedSettlements, `${label}: the 5xx settlements`);
      assert.deepEqual(settlementProblems(settledOf(d)), [], `${label}: every 5xx settles through the function`);
      assert.equal(charges.filter(c => c.kind === 'billed').length, expectedSettlements, `${label}: and each is its own charge record`);
    } finally { disarm(); s.srv.close(); }
  }
}));

// CHANGED ACCEPTED. OLD: "the S6-12 guard does not count a 5xx settled failed" (a marked `failed` $0 line never counted). NEW: a 5xx that is counted settles `billed_unreadable` and DOES count; a `failed` $0 line of a seat that does not bill still does not.
// WHY: his pick of 04 Nov 2026 ("2: typical cost"), whose stated consequence is that "a stage with two server errors no longer resumes on its own".
test('the S6-12 guard counts a 5xx settled billed_unreadable (the marker rides along) and still not a `failed` $0 one, and settle() writes the marker only when asked', () => {
  const d = dir(); const sink = openReservations(d);
  for (let i = 0; i < 3; i++) sink.settle(sink.reserve({ label: 'x', seat: 'p/m', usd: 1 }), { outcome: 'billed_unreadable', usd: 0.5, reachedProvider: true });
  for (let i = 0; i < 2; i++) sink.settle(sink.reserve({ label: 'y', seat: 'p/m', usd: 1 }), { outcome: 'failed', usd: 0, reachedProvider: true });
  sink.settle(sink.reserve({ label: 'y', seat: 'p/m', usd: 1 }), { outcome: 'failed', usd: 0 });
  assert.equal(settledCountOf(d, 'x', 'billed_unreadable'), 3, 'three counted 5xx: the guard sees three');
  assert.equal(settledCountOf(d, 'y', 'billed_unreadable'), 0, 'marked and plain `failed` lines: none counts');
  assert.deepEqual(settledOf(d).slice(3).map(l => l.reachedProvider), [true, true, undefined], 'the marker is written only when asked, so every other line is byte for byte as before');
});

// The consequence, through invoke(): two calls of ONE label in one run folder. The guard reads the earlier settlements once, before the FIRST attempt of a call and never counts the call's own, so it holds across calls of a stage
// (in practice after a resume), not inside one call. His pick's consequence, as C&C's option text put it: "a stage with two server errors no longer resumes on its own".
test('S6-12 consequence: with two counted 5xx behind a stage, a dropped connection in a LATER call of that label is not asked again; with one it still is; inside one call it still is', () => withKey(async () => {
  const { d } = arm();
  const s1 = await stub((n, req, res) => (n <= 2 ? status(res, 503) : ok(res))); const s2 = await stub((n, req, res) => { if (n === 1) req.socket.destroy(); else ok(res); });
  try {
    await runSingleStage({ ...SEAT, baseUrl: s1.url }, { ...PROMPT, label: 'guarded', log: () => {} });
    assert.equal(settledCountOf(d, 'guarded', 'billed_unreadable'), 2, 'the first call left exactly two counted 5xx on the label');
    await assert.rejects(() => runSingleStage({ ...SEAT, baseUrl: s2.url }, { ...PROMPT, label: 'guarded', log: () => {} }), err => err.maybeBilled === true, 'the dropped connection ends the call');
    assert.equal(s2.seen.length, 1, 'and it was not asked again: the label has two counted settlements behind it');
    // control: ONE counted 5xx on a label leaves the resume alone
    const s3 = await stub((n, req, res) => (n === 1 ? status(res, 503) : ok(res))); const s4 = await stub((n, req, res) => { if (n === 1) req.socket.destroy(); else ok(res); });
    try {
      await runSingleStage({ ...SEAT, baseUrl: s3.url }, { ...PROMPT, label: 'once', log: () => {} });
      assert.equal(settledCountOf(d, 'once', 'billed_unreadable'), 1);
      const st = await runSingleStage({ ...SEAT, baseUrl: s4.url }, { ...PROMPT, label: 'once', log: () => {} });
      assert.equal(st.text, 'ok'); assert.equal(s4.seen.length, 2, 'control: with one counted 5xx behind it the dropped connection is asked again');
    } finally { s3.srv.close(); s4.srv.close(); }
    // control: inside ONE call, two 5xx and then a dropped connection: the guard has not read them yet, so the connection is asked again
    const s5 = await stub((n, req, res) => { if (n <= 2) status(res, 503); else if (n === 3) req.socket.destroy(); else ok(res); });
    try {
      const st = await runSingleStage({ ...SEAT, baseUrl: s5.url }, { ...PROMPT, label: 'samecall', log: () => {} });
      assert.equal(st.text, 'ok'); assert.equal(s5.seen.length, 4, 'control: inside one call the guard has only the earlier calls to read, so the drop is asked again');
    } finally { s5.srv.close(); }
  } finally { disarm(); s1.srv.close(); s2.srv.close(); }
}));

// The new money path the pick opens: before it a 5xx never grew `spent`, so a re-send passed whenever the first send did. Now the first 5xx is counted, and the gate looks at it before the re-send. A cap with room for the first send and half a typical cost more refuses the re-send.
test('a re-send the cap refuses: with room for the first send and half a typical cost, the first 5xx is counted and the re-send stops the call (BudgetExceeded), one request sent', () => withKey(async () => {
  const s = await stub((n, req, res) => status(res, 503)); const { d } = arm();
  setBudget(WORST + TYP / 2);
  try {
    await assert.rejects(() => runSingleStage({ ...SEAT, baseUrl: s.url }, { ...PROMPT, label: 'capped', log: () => {} }), err => err instanceof chainNs.BudgetExceeded && err.label === 'capped');
    assert.equal(s.seen.length, 1, 'the re-send was not sent');
    assert.equal(reservedFor(d, 'capped'), 1, 'and not reserved');
    assert.ok(near(budgetState().spent, TYP), `the first 5xx is what the run has counted (${budgetState().spent})`);
  } finally { disarm(); s.srv.close(); }
}));

// A seat that does not bill has no price, so its typical cost is $0: nothing is reserved, nothing is counted, no charge record, no settlement for the guard to count. Its 5xx are still sent again (the bound is the same).
test('a 5xx from a seat that does not bill stays $0: three requests, no reservation, no charge, nothing counted', () => withKey(async () => {
  const s = await stub((n, req, res) => status(res, 503)); const { d, charges } = arm(); const logs = [];
  try {
    await assert.rejects(() => runSingleStage({ provider: 'ollama', model: 'local-x', maxTokens: 500, baseUrl: s.url }, { ...PROMPT, label: 'free', log: m => logs.push(m) }), err => err.status === 503);
    assert.equal(s.seen.length, 3, 'sent again twice, as for any seat');
    assert.deepEqual([charges.length, budgetState().spent, settledCountOf(d, 'free', 'billed_unreadable')], [0, 0, 0]);
    assert.ok(!existsSync(join(d, RESERVATIONS_FILE)) || reservedFor(d, 'free') === 0, 'no reservation: a call projected at $0 writes none');
  } finally { disarm(); s.srv.close(); }
}));
