// CR-1F-001 (25 Okt 2026; Sol's R2): the cost RECORDED after a call used the table row, while the projection before it used max(row, the seat's own provider.max_price) per field. A seat with its own pin above the row
// (the route the exit-24 screen offers) was therefore recorded below what OpenRouter may bill: budget.spent, the usage file, report totals and --spend all read the recorded figure, so a run could pass the typed limit.
// Offline, $0: a stubbed fetch answers; no network, no real key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSingleStage, setBudget, setCache, setReservationSink, budgetState, BudgetExceeded } from '../src/chain.js';
import { costOf, worstCaseOf } from '../src/cost.js';
import { ownPinOf } from '../src/price-pin.js';

// qwen/qwen3.7-plus: shipped row 0.4 in / 1.6 out per million (src/pricing.json)
const seatWith = pin => ({ provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'qwen-pin', maxTokens: 1000, extra: { provider: { max_price: pin } } });
const usage = { input: 1_000_000, output: 1_000_000 };

test('OP-1: costOf prices each field at the higher of the table row and the seat\'s own pin; a pin below the row, a missing pin and a half pin never lower it', () => {
  assert.equal(costOf('openrouter', 'qwen/qwen3.7-plus', usage).usd, 0.4 + 1.6, 'no pin: the row');
  assert.equal(costOf('openrouter', 'qwen/qwen3.7-plus', usage, { prompt: 3, completion: 15 }).usd, 3 + 15, 'a pin above the row on both fields');
  assert.equal(costOf('openrouter', 'qwen/qwen3.7-plus', usage, { prompt: 0.1, completion: 0.2 }).usd, 0.4 + 1.6, 'a pin below the row never lowers it');
  assert.equal(costOf('openrouter', 'qwen/qwen3.7-plus', usage, { completion: 9 }).usd, 0.4 + 9, 'a field the seat leaves out stays at the row');
  assert.equal(costOf('openrouter', 'qwen/not-in-the-table', usage, { prompt: 9, completion: 9 }).priced, false, 'no row: still unpriced');
  const seat = seatWith({ prompt: 3, completion: 15 });
  assert.equal(costOf(seat.provider, seat.model, usage, ownPinOf(seat)).usd, worstCaseOf(seat.provider, seat.model, { promptChars: 4_000_000, maxTokens: 1_000_000, pin: ownPinOf(seat) }).usd, 'the recorded figure for a full call equals the projection for it');
});

// the fetch stub: every request is answered with 1000 output tokens (the host bills what the pin allows)
async function withHost(model, fn) {
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test';
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], model, provider: 'StubHost', usage: { prompt_tokens: 0, completion_tokens: 1000 } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  setCache(null); setReservationSink(null);
  try { return await fn(() => requests); } finally { globalThis.fetch = original; setBudget(null); if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
}

test('OP-2 (Sol R2, rebuilt): two calls of a seat whose own pin is $9 per million under a $0.011 limit: the first is recorded at $0.009, so the second is refused before it is sent', async () => {
  const seat = seatWith({ prompt: 9, completion: 9 });
  await withHost(seat.model, async requests => {
    setBudget(0.011);
    const first = await runSingleStage(seat, { system: '', user: '', label: 'higher-pin-1' });
    assert.ok(Math.abs(first.usd - 0.009) < 1e-9, `recorded at the pin, not the row (got ${first.usd})`);
    assert.ok(Math.abs(budgetState().spent - 0.009) < 1e-9, 'the cap counts the recorded figure');
    await assert.rejects(runSingleStage(seat, { system: '', user: '', label: 'higher-pin-2' }), e => e instanceof BudgetExceeded);
    assert.equal(requests(), 1, 'the second call was never sent');
  });
});

test('OP-3: a seat without its own pin is recorded at the row as before, and a call answered by a model the table does not know is charged at the seat\'s price WITH its pin', async () => {
  const plain = { provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'qwen-plain', maxTokens: 1000 };
  await withHost(plain.model, async () => {
    setBudget(1);
    const r = await runSingleStage(plain, { system: '', user: '', label: 'no-pin' });
    assert.ok(Math.abs(r.usd - 0.0016) < 1e-9, `row price (got ${r.usd})`);
  });
  const pinned = seatWith({ prompt: 9, completion: 9 });
  await withHost('someone/unlisted-model', async () => {
    setBudget(1);
    const r = await runSingleStage(pinned, { system: '', user: '', label: 'answered-by-another' });
    assert.ok(Math.abs(r.usd - 0.009) < 1e-9, `the seat's price at its pin (got ${r.usd})`);
  });
});
