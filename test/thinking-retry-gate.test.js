// 28 Okt 2026 (the expected-cost gate's leftovers): an Anthropic seat whose reply spent its whole cap on thinking is retried ONCE at a bigger cap, inside invoke(). That retry is a second paid call. Under the old worst-case gate it was
// pre-paid (the call's projection held both attempts); under the expected-cost gate the check before the first send priced one attempt, so the retry went out past the cap. It is now gated before it is sent, at its worst case, like every
// other call the dry run does not plan: a ceiling that admits the first attempt and cannot hold the retry stops the run with the retry unsent and the wasted first attempt still counted. Offline: stubbed fetch, the real trigger
// (an Anthropic seat, thinking > 0, stop max_tokens, a bigger cap available), no hand-set budget state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, runSingleStage, setBudget, setCache, budgetState, BudgetExceeded, setPromptSpy } from '../src/chain.js';
import { costOf, projectAttempts } from '../src/cost.js';

const stubFetch = handler => { const original = globalThis.fetch; globalThis.fetch = handler; return () => { globalThis.fetch = original; }; };
const withKey = async fn => {
  const had = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-key';
  try { return await fn(); } finally { if (had === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = had; }
};
const IN = 30; const OUT = 4000;
const cutByThinking = (inTokens = IN) => ({ ok: true, json: async () => ({ content: [], stop_reason: 'max_tokens', usage: { input_tokens: inTokens, output_tokens: OUT, output_tokens_details: { thinking_tokens: OUT } } }) });
const complete = text => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: IN, output_tokens: 20, output_tokens_details: { thinking_tokens: 5 } } }) });
const SEAT = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: OUT, extra: { output_config: { effort: 'high' } } };
const config = { name: 'retry-gate', maxRounds: 1, seats: { criteria: SEAT, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } };
const CRITERIA_REPLY = JSON.stringify({ criteria: ['A real criterion, produced on the retry.'] });

// the figures, from the harness's own functions: the first attempt as it was billed (30 in, 4000 out), and the retry's worst case on the stage's real prompt (read off the spy, never hard-coded)
async function figures() {
  let sent = null;
  setPromptSpy(p => { sent ??= { system: p.system, user: p.user }; });
  const restore = stubFetch(async () => cutByThinking());
  try { setCache(null); setBudget(null); await assert.rejects(() => runChain({ request: 'A request.', config, log: () => {} })); } finally { restore(); setPromptSpy(null); }
  const { first, retry } = projectAttempts(SEAT, sent);
  const wasted = costOf('anthropic', 'claude-sonnet-5', { input: IN, output: OUT, thinking: OUT }).usd;
  assert.ok(first > 0 && retry > first && wasted > 0, 'fixture: the retry is a bigger call than the first attempt');
  return { retry, wasted };
}

test('the thinking retry is gated: a ceiling that admits the first attempt and cannot hold the retry stops the run with the retry unsent and the wasted attempt counted once', async () => {
  await withKey(async () => {
    const { retry, wasted } = await figures();
    // above the first attempt's expected cost (400 output tokens, far under the 4000 it was billed), below the wasted first attempt + the retry's worst case
    const cap = wasted + retry / 2;
    let calls = 0;
    const logs = [];
    const restore = stubFetch(async () => { calls++; return cutByThinking(); });
    try {
      setCache(null); setBudget(cap);
      await assert.rejects(() => runChain({ request: 'A request.', config, log: l => logs.push(l) }), e => e instanceof BudgetExceeded && e.label === 'criteria' && Math.abs(e.spent - wasted) < 1e-9 && Math.abs(e.cap - cap) < 1e-9);
      assert.equal(calls, 1, 'the retry was not sent');
      assert.ok(Math.abs(budgetState().spent - wasted) < 1e-9, `the wasted first attempt is counted, once (${budgetState().spent} vs ${wasted})`);
      assert.equal(budgetState().reserved, 0);
      assert.ok(logs.some(l => /the retry at a bigger token cap .* STOPPED, the retry was not sent/.test(l)), logs.join('\n'));
    } finally { restore(); setBudget(null); }
  });
});

test('the thinking retry is sent when its worst case fits: a ceiling above the wasted first attempt + the retry', async () => {
  await withKey(async () => {
    const { retry, wasted } = await figures();
    let calls = 0;
    const restore = stubFetch(async () => { calls++; return calls === 1 ? cutByThinking() : complete(CRITERIA_REPLY); });
    try {
      setCache(null); setBudget(wasted + retry * 1.5);
      const r = await runChain({ request: 'A request.', config, log: () => {} });
      assert.equal(calls, 2, 'the first attempt was cut off, the retry was sent');
      assert.deepEqual(r.criteria, ['A real criterion, produced on the retry.']);
    } finally { restore(); setBudget(null); }
  });
});

// A call the dry run does not plan (here: any call outside runChain, which has no expected size) is gated at its WORST case, and that worst case already holds both attempts, so its retry was paid for up front and must not be
// refused: the retry gate takes the call's own held figure out of the in-flight sum, which leaves the wasted first attempt (at most the first attempt's worst case) where that figure stood. With the call's own figure left in, the
// same ceiling (exactly the two-attempt worst case) would count the first attempt twice and refuse a retry that fits.
test('an unplanned call\'s retry is not refused: its two-attempt worst case was held up front, so a ceiling of exactly that sends the retry', async () => {
  await withKey(async () => {
    // 120 characters = 30 input tokens at four characters a token: the prompt the projection prices is exactly the input the stub reports, so the wasted first attempt is exactly the first attempt's worst case
    const system = 'S'.repeat(60); const user = 'U'.repeat(60);
    const { first, retry } = projectAttempts(SEAT, { system, user });
    assert.ok(first > 0 && retry > first);
    let calls = 0;
    const restore = stubFetch(async () => { calls++; return calls === 1 ? cutByThinking(30) : complete('An answer.'); });
    try {
      setCache(null); setBudget(first + retry);
      const stage = await runSingleStage(SEAT, { system, user, label: 'solo', log: () => {} });
      assert.equal(calls, 2, 'the first attempt was cut off, the retry was sent');
      assert.equal(stage.text, 'An answer.');
      assert.ok(budgetState().spent <= first + retry, 'and the run stayed inside the ceiling');
    } finally { restore(); setBudget(null); }
  });
});
