// S5-03 (owner's pick, 28 Okt 2026): a provider's reply that is an error body (HTTP 200, `error`, no `choices`) is charged at the usage figure the body carries; with none, at a typical cost for that call (the gate's expected cost,
// expectedCallUsd); a call the dry run does not plan (no expected size) keeps the worst case. Before, every such reply was charged one attempt's WORST case. Offline: stubbed fetch, the real invoke().
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, runSingleStage, setBudget, setCache, budgetState, setChargeHook, setPromptSpy } from '../src/chain.js';
import { costOf, expectedCallUsd, projectAttempts } from '../src/cost.js';

const stubFetch = handler => { const original = globalThis.fetch; globalThis.fetch = handler; return () => { globalThis.fetch = original; }; };
const reply200 = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const withKey = async fn => { const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key'; try { return await fn(); } finally { if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; } };
// an OpenRouter seat for a model that is not an Anthropic seat (one attempt, no thinking retry): the criteria stage, a planned call with an expected size
const SEAT = { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 4000 };
const config = { name: 'error-body', maxRounds: 1, seats: { criteria: SEAT, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } };

async function chargedFor(body) {
  const charges = []; let sent = null;
  setChargeHook(c => charges.push(c)); setPromptSpy(p => { sent ??= { system: p.system, user: p.user }; });
  const restore = stubFetch(async () => reply200(body));
  try { setCache(null); setBudget(1000); await assert.rejects(() => runChain({ request: 'A request.', config, log: () => {} })); return { charges, sent, spent: budgetState().spent }; }
  finally { restore(); setBudget(null); setChargeHook(null); setPromptSpy(null); }
}

test('an error body with no usage figure is charged at the call\'s expected cost, not its worst case', async () => {
  await withKey(async () => {
    const { charges, sent, spent } = await chargedFor({ error: { message: 'upstream failed', code: 502 } });
    const expected = expectedCallUsd(SEAT, { ...sent, label: 'criteria' });
    const worst = projectAttempts(SEAT, sent).first;
    assert.ok(expected > 0 && expected < worst, 'fixture: the expected cost is a real figure below the worst case');
    assert.ok(Math.abs(spent - expected) < 1e-9, `charged ${spent}, the expected cost is ${expected} (the worst case is ${worst})`);
    assert.equal(charges.length, 1); assert.equal(charges[0].kind, 'billed'); assert.ok(Math.abs(charges[0].usd - expected) < 1e-9);
    assert.match(charges[0].reason, /error reply/, 'the record says what the charge is');
  });
});

test('an error body WITH a usage figure is charged at that figure', async () => {
  await withKey(async () => {
    const { charges, spent } = await chargedFor({ error: { message: 'upstream failed' }, usage: { prompt_tokens: 120, completion_tokens: 40 } });
    const figure = costOf('openrouter', 'anthropic/claude-opus-5', { input: 120, output: 40 }).usd;
    assert.ok(figure > 0);
    assert.ok(Math.abs(spent - figure) < 1e-9, `charged ${spent}, the body's own usage costs ${figure}`);
    assert.equal(charges.length, 1); assert.ok(Math.abs(charges[0].usd - figure) < 1e-9);
  });
});

test('an error body whose usage is zero is charged nothing and writes no charge (a reply that billed nothing)', async () => {
  await withKey(async () => {
    const { charges, spent } = await chargedFor({ error: { message: 'refused' }, usage: { prompt_tokens: 0, completion_tokens: 0 } });
    assert.equal(spent, 0); assert.equal(charges.length, 0);
  });
});

test('a call the dry run does not plan (no expected size) keeps the worst case for an error body', async () => {
  await withKey(async () => {
    const restore = stubFetch(async () => reply200({ error: { message: 'upstream failed' } }));
    try {
      setCache(null); setBudget(1000);
      const { first } = projectAttempts(SEAT, { system: 'S', user: 'U' });
      await assert.rejects(() => runSingleStage(SEAT, { system: 'S', user: 'U', label: 'solo', log: () => {} }));
      assert.ok(Math.abs(budgetState().spent - first) < 1e-9, `charged ${budgetState().spent}, one attempt's worst case is ${first}`);
    } finally { restore(); setBudget(null); }
  });
});
