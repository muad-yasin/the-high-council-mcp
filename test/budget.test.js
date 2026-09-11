// relay/test/budget.test.js
//
// The per-run spend cap. This is a BYOK tool a stranger points their own API
// keys at, so the property that matters is not "the total is reported
// correctly" - costOf already did that - but "the run stops BEFORE the stage
// that would breach the ceiling is paid for". Every test below is written
// against that ordering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worstCaseOf, wouldBreach, estimateTokens } from '../src/cost.js';
import { runChain, setBudget, setCache, budgetState, BudgetExceeded } from '../src/chain.js';

const REQUEST = 'Write a one-page thing.';

// The mock provider calls nothing. mock/mock-priced is the only mock model
// with a price entry (a deliberately absurd $1000/Mtok), which is what makes
// an offline end-to-end cap test possible at all.
const pricedChain = (maxTokens = 8000) => ({
  name: 'budget-test',
  maxRounds: 2,
  stopOnPass: true,
  seats: {
    criteria: { provider: 'mock', model: 'mock-priced', maxTokens },
    builder: { provider: 'mock', model: 'mock-priced', maxTokens },
    reviser: { provider: 'mock', model: 'mock-priced', maxTokens },
    critics: [{ provider: 'mock', model: 'mock-priced', maxTokens }],
  },
});

test('estimateTokens: 4 chars per token, rounded up', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abc'), 1);
  assert.equal(estimateTokens('a'.repeat(4000)), 1000);
});

test('worstCaseOf: prices the whole maxTokens budget as output, not the actual output', () => {
  // opus-5 is 15/75 per Mtok. 8000 prompt chars = 2000 input tokens.
  const { usd, priced } = worstCaseOf('anthropic', 'claude-opus-5', { promptChars: 8000, maxTokens: 16000 });
  assert.equal(priced, true);
  assert.ok(Math.abs(usd - ((2000 / 1e6) * 15 + (16000 / 1e6) * 75)) < 1e-9);
});

test('worstCaseOf: an anthropic seat can be projected at two attempts (the thinking-disabled retry)', () => {
  const one = worstCaseOf('anthropic', 'claude-opus-5', { promptChars: 8000, maxTokens: 16000, retries: 1 }).usd;
  const two = worstCaseOf('anthropic', 'claude-opus-5', { promptChars: 8000, maxTokens: 16000, retries: 2 }).usd;
  assert.equal(two, one * 2);
});

test('worstCaseOf: an unpriced seat projects $0 - it cannot be accounted for, so it cannot be capped', () => {
  const { usd, priced } = worstCaseOf('mock', 'mock-builder', { promptChars: 100000, maxTokens: 100000 });
  assert.equal(priced, false);
  assert.equal(usd, 0);
});

test('wouldBreach: a null cap never breaches', () => {
  assert.equal(wouldBreach({ spent: 999, cap: null, projected: 999 }).breach, false);
  assert.equal(wouldBreach({ spent: 999, cap: undefined, projected: 999 }).breach, false);
});

test('wouldBreach: breaches on the projection, not on what is already spent', () => {
  // Under the ceiling right now, but this stage would cross it.
  assert.equal(wouldBreach({ spent: 1.0, cap: 2.0, projected: 1.5 }).breach, true);
  assert.equal(wouldBreach({ spent: 1.0, cap: 2.0, projected: 0.5 }).breach, false);
});

test('wouldBreach: landing exactly on the ceiling is allowed; a cent past it is not', () => {
  assert.equal(wouldBreach({ spent: 1.0, cap: 2.0, projected: 1.0 }).breach, false);
  assert.equal(wouldBreach({ spent: 1.0, cap: 2.0, projected: 1.01 }).breach, true);
});

test('wouldBreach: remaining never goes negative', () => {
  assert.equal(wouldBreach({ spent: 5, cap: 2, projected: 0 }).remaining, 0);
});

test('end to end: a cap of $0.01 stops the run at the very first stage, having spent nothing', async () => {
  setCache(null);
  setBudget(0.01);
  const logs = [];
  await assert.rejects(
    () => runChain({ request: REQUEST, config: pricedChain(), log: l => logs.push(l) }),
    err => {
      assert.ok(err instanceof BudgetExceeded, `expected BudgetExceeded, got ${err}`);
      assert.equal(err.label, 'criteria', 'should stop at the first paid stage');
      assert.equal(err.spent, 0, 'nothing may have been paid for yet');
      assert.equal(err.cap, 0.01);
      assert.ok(err.projected > 0.01, 'the projection is what tripped it');
      return true;
    },
  );
  assert.equal(budgetState().spent, 0, 'the breaching stage must never be charged');
});

test('end to end: a run stops partway, having paid for the stages before the breach and no more', async () => {
  setCache(null);
  // A cheap first seat and an expensive builder, so the stop lands in a known
  // place: criteria (maxTokens 100 -> ~$0.10 projected) is affordable under a
  // $5 ceiling, the builder (maxTokens 8000 -> ~$8 projected) is not.
  const config = pricedChain();
  config.seats.criteria.maxTokens = 100;
  setBudget(5);
  await assert.rejects(
    () => runChain({ request: REQUEST, config, log: () => {} }),
    err => {
      assert.ok(err instanceof BudgetExceeded);
      assert.notEqual(err.label, 'criteria', 'the cheap first stage was affordable and should have run');
      assert.ok(err.spent > 0, 'earlier stages were really paid for');
      assert.ok(err.spent <= 5, `spend must never exceed the ceiling, got ${err.spent}`);
      assert.ok(err.spent + err.projected > 5, 'it stopped because the NEXT stage would breach');
      return true;
    },
  );
});

test('end to end: a generous cap does not interfere - the same run completes', async () => {
  setCache(null);
  setBudget(1000);
  const result = await runChain({ request: REQUEST, config: pricedChain(), log: () => {} });
  assert.ok(result.deliverable, 'the run produced a deliverable');
  assert.ok(result.totals.usd > 0 && result.totals.usd < 1000);
});

test('end to end: no cap at all still runs (the opt-out path is not broken)', async () => {
  setCache(null);
  setBudget(null);
  const result = await runChain({ request: REQUEST, config: pricedChain(), log: () => {} });
  assert.ok(result.deliverable);
  assert.equal(budgetState().cap, null);
  assert.equal(budgetState().remaining, null);
});

test('resume: spend replayed from disk counts against the ceiling, so a resume cannot lap it', async () => {
  // A stage replayed from the run folder is free THIS sitting, but the money
  // was really spent. If replays did not count, resuming repeatedly would let
  // a run spend the whole ceiling again each time.
  setBudget(10);
  setCache({
    get: label => label === 'criteria'
      ? { text: JSON.stringify({ criteria: ['It exists.'] }), usage: { input: 10, output: 10 }, usd: 9.5, provider: 'mock', model: 'mock-priced' }
      : null,
  });
  await assert.rejects(
    () => runChain({ request: REQUEST, config: pricedChain(), log: () => {} }),
    err => {
      assert.ok(err instanceof BudgetExceeded);
      assert.equal(err.spent, 9.5, 'the replayed stage counted toward the ceiling');
      return true;
    },
  );
  setCache(null);
});

// --- roster integrity -------------------------------------------------------
// Not a budget concern, but it shares the fixture chain shape above. A lab
// that returns nothing readable used to vanish from the panel with only a
// quiet log line and nothing in report.json. For a tool that sells "you can
// read who objected to what", a silently shrunken roster is a correctness bug.

const proposalChain = () => ({
  name: 'dropout-test',
  maxRounds: 1,
  stopOnPass: true,
  proposals: { parts: 2, maxTokens: 500 },
  seats: {
    criteria: { provider: 'mock', model: 'mock-criteria' },
    skeleton: { provider: 'mock', model: 'mock-skeleton' },
    builder: { provider: 'mock', model: 'mock-builder' },
    reviser: { provider: 'mock', model: 'mock-builder' },
    proposers: [
      { provider: 'mock', model: 'mock-proposer-a', lab: 'lab-a' },
      { provider: 'mock', model: 'mock-proposer-empty', lab: 'lab-empty' },
    ],
    critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'lab-a' }],
  },
});

test('a lab that returns nothing readable is recorded as a dropout, not silently missing', async () => {
  setCache(null);
  setBudget(null);
  const logs = [];
  const result = await runChain({ request: REQUEST, config: proposalChain(), log: l => logs.push(String(l)) });

  assert.ok(Array.isArray(result.dropouts), 'runChain reports dropouts');
  assert.equal(result.dropouts.length, 1, 'exactly the one silent lab');
  assert.equal(result.dropouts[0].lab, 'lab-empty');
  assert.equal(result.dropouts[0].stage, 'proposals');

  // The operator must not have to count scoreboard rows to notice.
  assert.match(logs.join('\n'), /ROSTER SHRANK/, 'the shrunken roster is announced loudly');

  // The lab that did answer is still on the board.
  assert.ok(result.proposals.some(p => p.lab === 'lab-a'), 'the working lab still proposed');
  assert.ok(!result.proposals.some(p => p.lab === 'lab-empty'));
});

test('an unreadable proposal reply is retried once before the lab is written off', async () => {
  setCache(null);
  setBudget(null);
  const logs = [];
  await runChain({ request: REQUEST, config: proposalChain(), log: l => logs.push(String(l)) });
  const text = logs.join('\n');
  assert.match(text, /propose-lab-empty-retry/, 'the retry really was attempted');
  assert.match(text, /retried once/);
});

test('a healthy roster reports no dropouts at all', async () => {
  setCache(null);
  setBudget(null);
  const config = proposalChain();
  config.seats.proposers = [{ provider: 'mock', model: 'mock-proposer-a', lab: 'lab-a' }];
  const result = await runChain({ request: REQUEST, config, log: () => {} });
  assert.deepEqual(result.dropouts, []);
});
