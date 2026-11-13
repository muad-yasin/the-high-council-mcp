// PR #2 fix unit, item 5, the red shape of the brief on the REAL gate (C&C's unit-end review, finding F2): test/exchange-gate-expected.test.js checks the cost functions; this file drives runChain under a per-run cap with a layer-exchange call that the cap fits at the call's EXPECTED cost and does not fit at its worst case.
// Before the unit the gate priced an ldebate-/lreply- call at its worst case (the whole maxTokens as output) and the run stopped at its limit before a call the dry run counted at a fraction of that; now it is checked at the dry run's figure for the seat. Offline, $0: the two layer-1 judges are mock-priced (fixture prices),
// every other call is scripted, and the first call of the exchange (`ldebate-1-lb`, a cache miss here) goes through invoke() and the gate to the mock provider. The caps are dollars of the fixture's prices: $3 is a cap that the call's expected cost fits and its worst case does not (measured with a probe on both sources: with the worst-case gate the run stops there at every cap up to about $4, with the expected-cost gate from $2.50 on it goes on); $1 fits neither.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as chain from '../src/chain.js';
import { scenario, FINAL_READ_OK, CRITERION, bareFailureOf, idOf } from './helpers/layer-two-run.js';
import { objectionId } from '../src/objection-ids.js';

afterEach(() => { chain.setCache(null); chain.setBudget(null); chain.setPromptSpy(null); });

const X = { ...bareFailureOf(5), problem: 'No back-off is specified.', quote: 'The worker', relation: 'new' };
const lbRaise = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'x' }], failures: [X], verdict_line: 'no' });
const postLa = JSON.stringify({ posts: [{ on: objectionId('lb', X), stance: 'support', text: 'It holds.' }], new_objections: [] });
const postLb = JSON.stringify({ posts: [{ on: idOf(5), stance: 'support', text: 'It holds.' }], new_objections: [] });
const run = async cap => {
  chain.setBudget(cap);
  return scenario({ critics: [['la', 1, 'mock-priced'], ['lb', 1, 'mock-priced'], ['lx', 2], ['lc', 3]], extra: { dispute: { enabled: true, stall_rounds: 2 } }, cutLabels: ['ldebate-1-lb'], overrides: { 'panel-1-lb': lbRaise, 'ldebate-1-la': postLa, 'ldebate-1-lb': postLb, ...FINAL_READ_OK } })
    .then(out => ({ out }), error => ({ error }));
};

test('a layer-exchange call whose expected cost fits the cap and whose worst case does not is SENT: the run goes on into the exchange instead of stopping at its limit before the call', async () => {
  const { out, error } = await run(3);
  assert.equal(error, undefined, `the run stopped before the exchange call: ${error?.constructor?.name}: ${String(error?.message).slice(0, 160)}`);
  assert.ok(out.result.stages.some(s => s.label === 'ldebate-1-lb'), 'the call was made (the label is among the run\'s stages)');
});

test('the gate still stops an exchange call whose expected cost does not fit either (the control): the same run under a much lower cap stops at its limit before that call', async () => {
  const { error } = await run(1);
  assert.equal(error?.constructor?.name, 'BudgetExceeded', `got ${error?.constructor?.name ?? 'no stop'}`);
  assert.equal(error.label, 'ldebate-1-lb', 'it stops before the exchange call, which is the call the cap does not fit');
});
