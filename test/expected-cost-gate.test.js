// The pre-call spend gate decides on a call's EXPECTED cost, not its worst case (owner, 27 Okt 2026: "going by the expected-maximum is absolutely stupid. Stop this";
// "the rule was decided to be bad, and we wanted it to be changed to the expected-case not worst-case"). A live run had two seats asked at once with worst cases of
// $1.44 and $2.62 refused at ~$2.94 spent of a $7 limit; they billed $0.08 and $0.26.
//
// The figures below are worked out here by hand from the real prompts (read through setPromptSpy) and the dry run's expected output size for a panel review
// (the chain's estimate.critiqueTokens), not by calling the function under test, so a gate that decides on any other figure fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setBudget, setCache, budgetState, setPromptSpy, BudgetExceeded } from '../src/chain.js';
import { priceOf } from '../src/cost.js';

const DRAFT = 'MOCK DRAFT TO REVIEW ' + 'x'.repeat(4000);
const MAX_TOKENS = 8000, CRITIQUE_TOKENS = 300;
const seat = lab => ({ provider: 'mock', model: 'mock-priced', maxTokens: MAX_TOKENS, lab });
const configOf = labs => ({ name: 'expected-gate', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], estimate: { critiqueTokens: CRITIQUE_TOKENS }, seats: { critics: labs.map(seat) } });

// One uncapped run reads each panel prompt; the gate's two figures for that call follow from it: the whole prompt in (four characters a token), and as output the
// expected review size (expected) or the seat's whole maxTokens (worst; mock is not Anthropic, so one attempt), both at the fixture price.
async function figuresOf(labs) {
  const price = priceOf('mock', 'mock-priced');
  assert.deepEqual({ in: price.in, out: price.out }, { in: 1000, out: 1000 }, 'fixture: mock-priced costs $1000 per million tokens each way');
  const prompts = {};
  setCache(null); setBudget(null);
  setPromptSpy(p => { if (p.label.startsWith('panel-1-')) prompts[p.label] = (p.system || '').length + (p.user || '').length; });
  try { await runChain({ request: 'Req.', config: configOf(labs), draft: DRAFT, log: () => {} }); } finally { setPromptSpy(null); }
  return Object.fromEntries(labs.map(lab => {
    const chars = prompts[`panel-1-${lab}`];
    assert.ok(chars > 0, `fixture: the panel prompt of ${lab} was read`);
    const inTok = Math.ceil(chars / 4);
    return [lab, { expected: (inTok + CRITIQUE_TOKENS) * 1000 / 1e6, worst: (inTok + MAX_TOKENS) * 1000 / 1e6 }];
  }));
}

test('expected gate: calls whose worst case breaches the cap but whose expected cost fits are sent, and the calls in flight count at their expected cost', async () => {
  const f = await figuresOf(['a', 'b', 'c']);
  // Room for two expected reviews and half of a third: each call's worst case alone is above the cap, so a worst-case gate sends none of them.
  const cap = f.a.expected + f.b.expected + f.c.expected / 2;
  for (const lab of ['a', 'b', 'c']) assert.ok(f[lab].worst > cap, `fixture: ${lab}'s worst case ($${f[lab].worst}) is above the cap ($${cap})`);
  setCache(null); setBudget(cap);
  const labels = [];
  try {
    await assert.rejects(() => runChain({ request: 'Req.', config: configOf(['a', 'b', 'c']), draft: DRAFT, log: () => {}, onStage: s => labels.push(s.label) }), BudgetExceeded);
    assert.equal(labels.length, 2, `two of the three parallel reviews fit at their expected cost and are sent; the third is refused (sent: ${labels.join(', ') || 'none'})`);
    const s = budgetState();
    assert.equal(s.reserved, 0, 'every worst-case reservation is released');
    assert.ok(Math.abs(s.reservedExpected) < 1e-9, 'every expected reservation is released');
  } finally { setBudget(null); }
});

test('expected gate: a call whose expected cost breaches the cap is refused before it is sent, and one that fits it by a cent\'s fraction is sent', async () => {
  const { a } = await figuresOf(['a']);
  const below = a.expected - 0.0005, above = a.expected + 0.0005;
  assert.ok(a.worst > above, 'fixture: the worst case is above both caps');
  setCache(null); setBudget(below);
  const refused = [];
  try {
    await assert.rejects(() => runChain({ request: 'Req.', config: configOf(['a']), draft: DRAFT, log: () => {}, onStage: s => refused.push(s.label) }),
      err => err instanceof BudgetExceeded && err.label === 'panel-1-a');
    assert.deepEqual(refused, [], 'nothing was sent under a cap below the expected cost');
    assert.equal(budgetState().spent, 0);
  } finally { setBudget(null); }
  setCache(null); setBudget(above);
  const sent = [];
  try {
    await runChain({ request: 'Req.', config: configOf(['a']), draft: DRAFT, log: () => {}, onStage: s => sent.push(s.label) });
    assert.deepEqual(sent, ['panel-1-a'], 'the review is sent under a cap just above its expected cost');
  } finally { setBudget(null); }
});
