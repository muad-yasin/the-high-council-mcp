// 0.8.4, the 5xx typical-cost fix-up, commit 2 (C&C's ruling R222: no localhost stub in a probe; the 5xx path is reached by a MOCK-ONLY model instead). `mock-http-<status>-<n|all>` (src/providers.js) fails its first <n> asks in the process
// (every ask for `all`) with the error the real adapter throws for a non-2xx answer. The proof that it is the SAME error: the real adapter and the mock build it through one function (httpStatusError), and this file compares the two errors
// field by field, once at the adapter's own throw and once as invoke() hands it on, then drives the mock through invoke() the way the stub-based tests drive the real adapter: a 503 then an answer (the re-send), 503, 503, answer, and then a
// dropped connection (COUNCIL_MOCK_NETFAIL, the mock's other failure shape: a transport failure with no status) in a later call of the same label. The mock models are priced fixtures (src/pricing.json, like mock-priced), because a 5xx is
// only counted for a seat that bills. Offline, $0. Each model name is used by one test only, because the mock counts asks per model string in this process.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as chainNs from '../src/chain.js';
import { openReservations, RESERVATIONS_FILE, settledCountOf } from '../src/spend-reservations.js';
import { recordLostCharge } from '../src/superseded.js';
import { call, setRetrySleep, isRetryable, isHttp5xx } from '../src/providers.js';
import { costOf, promptCharsOf, promptTokensOfChars, DEFAULT_ESTIMATE } from '../src/cost.js';

const { runSingleStage, setBudget, setCache, setReservationSink, setChargeHook } = chainNs;
const dir = () => mkdtempSync(join(tmpdir(), 'thc-mock-http-'));
const lines = d => readFileSync(join(d, RESERVATIONS_FILE), 'utf8').trimEnd().split('\n').map(l => JSON.parse(l));
const settledOf = d => lines(d).filter(l => l.event === 'settled');
const reservedFor = (d, label) => lines(d).filter(l => l.event === 'reserved' && l.label === label).length;
const mock = (model, maxTokens = 500) => ({ provider: 'mock', model, maxTokens });
const PROMPT = { system: 's', user: 'u' };
const handUsd = seat => costOf(seat.provider, seat.model, { input: promptTokensOfChars(promptCharsOf(PROMPT)), output: Math.min(DEFAULT_ESTIMATE.critiqueTokens, seat.maxTokens) }).usd;
function arm() {
  const d = dir(); const charges = [];
  setCache(null); setBudget(50); setRetrySleep(async () => {});
  setReservationSink(openReservations(d)); setChargeHook(c => { charges.push(c); recordLostCharge(d, c.label, c); });
  return { d, charges };
}
function disarm() { setBudget(null); setReservationSink(null); setChargeHook(null); setRetrySleep(null); delete process.env.COUNCIL_MOCK_NETFAIL; }
const chargeFiles = d => { const sd = join(d, 'superseded'); return existsSync(sd) ? readdirSync(sd).filter(f => /\.charge-\d+\.usage\.json$/.test(f)) : []; };

// The real error: the adapter's own throw, from a stub that answers 503 with a Retry-After. The mock: the same call, no network.
test('the mock 5xx is the real adapter\'s error: same constructor, same fields, read the same way by isRetryable / isHttp5xx and by invoke()', async () => {
  let hits = 0; const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { hits += 1; res.statusCode = 503; if (hits === 1) res.setHeader('retry-after', '2'); res.end('down'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'd'.repeat(40);
  try {
    const opts = { system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 50 };
    const ask = () => call('openrouter', { ...opts, model: 'anthropic/claude-opus-5', baseUrl: `http://127.0.0.1:${srv.address().port}` }).catch(e => e);
    const withHeader = await ask();   // the stub sends a Retry-After on its first answer only
    const real = await ask();
    const fake = await call('mock', { ...opts, model: 'mock-http-503-all' }).catch(e => e);
    assert.ok(real instanceof Error && fake instanceof Error, 'both throw (the adapter throws once per request: invoke() does the re-sending)');
    assert.deepEqual(Object.keys(fake).sort(), Object.keys(real).sort(), 'the same own fields: status, failureHost, retryAfterMs; no maybeBilled, no causeClass');
    for (const e of [real, fake]) {
      assert.equal(e.status, 503); assert.match(e.message, /^HTTP 503 /);
      assert.equal(typeof e.failureHost, 'string'); assert.ok(!('maybeBilled' in e) && !('causeClass' in e));
      assert.equal(isHttp5xx(e), true, 'invoke()\'s read (chain.js: isHttp5xx(err) && !err.errorBody)'); assert.ok(!e.errorBody); assert.equal(isRetryable(e), true, 'the adapter\'s read (providers.js isRetryable: err.status 429 or >= 500)');
    }
    assert.equal(withHeader.retryAfterMs, 2000, 'the adapter reads a Retry-After into retryAfterMs'); assert.equal(real.retryAfterMs, fake.retryAfterMs, 'with no Retry-After the field is the same value on both (built by the same function)');
    // and as the checker of the real path sees it: the final error invoke() throws after its re-sends
    const { d } = arm();
    try {
      const err = await runSingleStage(mock('mock-http-503-all'), { ...PROMPT, label: 'shape', log: () => {} }).catch(e => e);
      assert.equal(err.status, 503); assert.equal(isHttp5xx(err), true);
      assert.equal(reservedFor(d, 'shape'), 3, 'the first send and two re-sends, as for a real 5xx');
      assert.deepEqual(settledOf(d).map(l => [l.outcome, l.reachedProvider]), [['billed_unreadable', true], ['billed_unreadable', true], ['billed_unreadable', true]], 'each one counted, marked as having reached the provider');
    } finally { disarm(); }
    // a name that is not the pattern is an ordinary mock model: nothing fails
    for (const m of ['mock-http-503-x', 'mock-http-50-all', 'mock-http-abc']) assert.equal(typeof (await call('mock', { ...opts, model: m })).text, 'string', m);
  } finally { if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; srv.close(); }
});

test('mock-http-503-1: a 503, then an answer for the re-send, counted at a typical cost; a dropped connection after ONE counted 5xx is still asked again', async () => {
  const { d, charges } = arm(); const seat = mock('mock-http-503-1');
  try {
    const st = await runSingleStage(seat, { ...PROMPT, label: 'once', log: () => {} });
    assert.equal(typeof st.text, 'string'); assert.equal(reservedFor(d, 'once'), 2, 'two reservations: the first send and the re-send');
    const s = settledOf(d);
    assert.deepEqual(s.map(l => l.outcome), ['billed_unreadable', 'recorded']); assert.equal(s[0].reachedProvider, true); assert.equal(s[1].reachedProvider, undefined);
    assert.ok(Math.abs(s[0].usd - handUsd(seat)) < 1e-9 && s[0].usd > 0, `the 5xx is counted at the typical figure ${handUsd(seat)}, got ${s[0].usd}`);
    assert.equal(charges.length, 1); assert.equal(chargeFiles(d).length, 1, 'its own charge file');
    assert.equal(st.lostChargesUsd, s[0].usd, 'invoke() hands the advice ledger what the failed attempt was counted at');
    // control: one counted 5xx behind the label leaves the resume of a dropped connection alone (the mock's other shape)
    process.env.COUNCIL_MOCK_NETFAIL = '1:one-5xx';
    const again = await runSingleStage(seat, { ...PROMPT, label: 'once', log: () => {} });
    assert.equal(typeof again.text, 'string'); assert.equal(reservedFor(d, 'once'), 4, 'the second call: the drop, then the resumed ask');
  } finally { disarm(); }
});

test('S6-12 consequence on the mock path: 503, 503, answer, and then a dropped connection in a LATER call of that label is not asked again; a label without a 5xx behind it still resumes', async () => {
  const { d } = arm(); const seat = mock('mock-http-503-2');
  try {
    await runSingleStage(seat, { ...PROMPT, label: 'guarded', log: () => {} });
    assert.equal(settledCountOf(d, 'guarded', 'billed_unreadable'), 2, 'the first call left exactly two counted 5xx');
    assert.equal(reservedFor(d, 'guarded'), 3);
    process.env.COUNCIL_MOCK_NETFAIL = '1:two-5xx';
    const err = await runSingleStage(seat, { ...PROMPT, label: 'guarded', log: () => {} }).catch(e => e);
    assert.equal(err.maybeBilled, true, 'the dropped connection ends the call'); assert.equal(isHttp5xx(err), false, 'it is the other shape: a transport failure, no status');
    assert.equal(reservedFor(d, 'guarded'), 4, 'one more request only: it was not asked again');
    // control: the same drop on a label with nothing behind it is asked again
    process.env.COUNCIL_MOCK_NETFAIL = '1:clean';
    const ok = await runSingleStage(seat, { ...PROMPT, label: 'clean', log: () => {} });
    assert.equal(typeof ok.text, 'string'); assert.equal(reservedFor(d, 'clean'), 2, 'control: the drop, then the resumed ask');
  } finally { disarm(); }
});
