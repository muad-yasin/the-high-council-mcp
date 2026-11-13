// 0.8.4 unit 6 (D11; plan A T6.2, MIMOV26PRO-3): every counted record names its BASIS (src/counted-bases.js): what the amount stands for. One test per situation, driven through invoke() the way test/typical-charge.test.js and test/mock-http-error.test.js drive it:
// a normal reply (token_priced), an error reply that carries a usage figure (provider_usage), one that carries none (typical_error), a 5xx answer (typical_error, one record per attempt), a dropped connection that is asked again (expected_retry),
// a reply whose usage cannot be read (worst_case). The stage's usage file, the charge file of a failed attempt and the `settled` line of the reservation each carry it, and every attempt of a retry writes its OWN record. Offline, $0 (a loopback
// stub on 127.0.0.1 with a dummy key, or the mock provider).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as chainNs from '../src/chain.js';
import { openReservations, RESERVATIONS_FILE } from '../src/spend-reservations.js';
import { recordLostCharge } from '../src/superseded.js';
import { setRetrySleep } from '../src/providers.js';

const { runSingleStage, setBudget, setCache, setReservationSink, setChargeHook } = chainNs;
const SEAT = { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 20000 };
const MOCK = { provider: 'mock', model: 'mock-priced', maxTokens: 500 };
const P = { system: 'S', user: 'U'.repeat(400) };
const json = (res, body, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const ok = res => json(res, { model: 'anthropic/claude-opus-5', choices: [{ message: { content: 'fine' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
const dir = () => mkdtempSync(join(tmpdir(), 'thc-charge-basis-'));
const lines = d => readFileSync(join(d, RESERVATIONS_FILE), 'utf8').trimEnd().split('\n').map(l => JSON.parse(l));
const chargeFiles = d => { const sd = join(d, 'superseded'); return existsSync(sd) ? readdirSync(sd).filter(f => /\.charge-\d+\.usage\.json$/.test(f)).sort().map(f => JSON.parse(readFileSync(join(sd, f), 'utf8'))) : []; };

function stub(handler) {
  const seen = []; const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { seen.push(1); handler(seen.length, req, res); }); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}
async function arm(fn) {
  const d = dir(); const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'b'.repeat(40);
  setCache(null); setBudget(1000); setRetrySleep(async () => {});
  setReservationSink(openReservations(d)); setChargeHook(c => { recordLostCharge(d, c.label, c); });
  try { return await fn(d); } finally { setBudget(null); setReservationSink(null); setChargeHook(null); setRetrySleep(null); delete process.env.COUNCIL_MOCK_NETFAIL; if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
}

test('the list of bases is the plan\'s five plus worst_case, provider_cost is not one, and the estimated ones are the four the plan marks', async () => {
  const { BASES, ESTIMATED_BASES } = await import('../src/counted-bases.js');
  assert.deepEqual([...BASES], ['token_priced', 'provider_usage', 'typical_error', 'expected_retry', 'reserved_unsettled', 'worst_case']);
  assert.deepEqual([...ESTIMATED_BASES], ['typical_error', 'expected_retry', 'reserved_unsettled', 'worst_case']);
});

test('a normal reply: the stage and the settled line say token_priced; no charge file', async () => {
  const s = await stub((n, req, res) => ok(res));
  try {
    await arm(async d => {
      const st = await runSingleStage({ ...SEAT, baseUrl: s.url }, { ...P, label: 'normal', log: () => {} });
      assert.equal(st.basis, 'token_priced'); assert.ok(st.usd > 0);
      const l = lines(d).filter(x => x.event === 'settled'); assert.equal(l.length, 1);
      assert.deepEqual([l[0].outcome, l[0].basis], ['recorded', 'token_priced']);
      assert.deepEqual(chargeFiles(d), []);
    });
  } finally { s.srv.close(); }
});

test('an error reply that carries a usage figure is charged at it: provider_usage on the charge file and the settled line', async () => {
  const s = await stub((n, req, res) => json(res, { error: { message: 'upstream failed', code: 502 }, usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  try {
    await arm(async d => {
      await assert.rejects(() => runSingleStage({ ...SEAT, baseUrl: s.url }, { ...P, label: 'err-usage', log: () => {} }));
      const c = chargeFiles(d); assert.equal(c.length, 1); assert.equal(c[0].basis, 'provider_usage');
      assert.deepEqual(lines(d).filter(x => x.event === 'settled').map(x => x.basis), ['provider_usage']);
    });
  } finally { s.srv.close(); }
});

test('an error reply that carries none is charged a typical cost: typical_error', async () => {
  const s = await stub((n, req, res) => json(res, { error: { message: 'upstream failed', code: 502 } }));
  try {
    await arm(async d => {
      await assert.rejects(() => runSingleStage({ ...SEAT, baseUrl: s.url }, { ...P, label: 'err-none', log: () => {} }));
      const c = chargeFiles(d); assert.equal(c.length, 1); assert.equal(c[0].basis, 'typical_error');
      assert.deepEqual(lines(d).filter(x => x.event === 'settled').map(x => x.basis), ['typical_error']);
    });
  } finally { s.srv.close(); }
});

test('a 5xx answer: every counted attempt is its own record and each says typical_error', async () => {
  await arm(async d => {
    await assert.rejects(() => runSingleStage({ provider: 'mock', model: 'mock-http-503-all', maxTokens: 500 }, { ...P, label: 'five', log: () => {} }));
    const c = chargeFiles(d); assert.equal(c.length, 3, 'the first send and two re-sends, three records');
    assert.deepEqual(c.map(x => x.basis), ['typical_error', 'typical_error', 'typical_error']);
    assert.deepEqual(lines(d).filter(x => x.event === 'settled').map(x => x.basis), ['typical_error', 'typical_error', 'typical_error']);
  });
});

test('a dropped connection that is asked again is counted at the call\'s expected cost: expected_retry, one record per attempt, then the answer is token_priced', async () => {
  await arm(async d => {
    process.env.COUNCIL_MOCK_NETFAIL = '2:basis';
    const st = await runSingleStage(MOCK, { ...P, label: 'dropped', log: () => {} });
    const c = chargeFiles(d); assert.equal(c.length, 2, 'two dropped attempts, two records');
    assert.deepEqual(c.map(x => x.basis), ['expected_retry', 'expected_retry']);
    assert.equal(st.basis, 'token_priced');
  });
});

test('a reply whose usage cannot be read is charged at one attempt\'s worst case: the stage says worst_case', async () => {
  const s = await stub((n, req, res) => json(res, { model: 'anthropic/claude-opus-5', choices: [{ message: { content: 'fine' }, finish_reason: 'stop' }], usage: { prompt_tokens: 'many', completion_tokens: -5 } }));
  try {
    await arm(async d => {
      const st = await runSingleStage({ ...SEAT, baseUrl: s.url }, { ...P, label: 'unreadable', log: () => {} });
      assert.equal(st.basis, 'worst_case');
      assert.deepEqual(lines(d).filter(x => x.event === 'settled').map(x => x.basis), ['worst_case']);
    });
  } finally { s.srv.close(); }
});
