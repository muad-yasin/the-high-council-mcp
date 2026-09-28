// Bug audit 2026-09-27 M3: a panel reply the provider cut off at the cap could still parse (an early
// complete verdict, then text the cap cut), and a parsed, cut-off `meets:true` was recorded as a
// sign-off. "Cut off" is now decided from the provider's stop reason whether or not the reply parsed:
// one bigger-cap retry, then a cut sign-off is an abstention and a cut objection is kept. Mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, providerCutOff, abstentionReasonCode } from '../src/chain.js';

const seat = (model, extra = {}) => ({ provider: 'mock', model, lab: model, ...extra });
const config = (critics, maxRounds = 2) => ({
  name: 'test-cut-signoff', maxRounds, signoff: 'unanimous', criteria: ['It names an owner.', 'It has a rollback step.'],
  seats: { builder: seat('mock-builder'), reviser: seat('mock-builder'), critics },
});
async function run(critics, maxRounds) {
  setCache(null); setBudget(null);
  const stages = [], lines = [];
  const result = await runChain({ request: 'A test request.', config: config(critics, maxRounds), log: l => lines.push(l), onStage: s => stages.push(s.label) });
  return { result, stages, lines };
}

test('a cut-off reply that parses as a sign-off is retried once, then counted as unheard - never as consent', async () => {
  const { result, stages, lines } = await run([seat('mock-critic-scripted'), seat('mock-critic-cut-signoff', { maxTokens: 1000 })], 1);
  assert.ok(stages.includes('panel-1-mock-critic-cut-signoff-retry'), `expected the bigger-cap retry, got ${stages.join(', ')}`);
  const cut = result.signoff.find(s => s.model === 'mock-critic-cut-signoff');
  assert.equal(cut.signedOff, null, 'a cut-off sign-off must not be recorded as signed off');
  assert.equal(cut.reason_code, 'REPLY_TRUNCATED');
  assert.equal(result.passed, false);
  assert.ok(lines.some(l => /reply signs off but was cut off at the cap \(stop: length\)/.test(l)));
});

test('a cut-off reply that parses as an objection is kept as an objection', async () => {
  const { result } = await run([seat('mock-critic-cut-objection', { maxTokens: 1000 })], 1);
  const cut = result.signoff.find(s => s.model === 'mock-critic-cut-objection');
  assert.equal(cut.signedOff, false, 'a cut objection already said no: it stays a vote');
  assert.ok(cut.objections.length >= 1);
  assert.equal(cut.reason_code, null);
});

test('a cut-off sign-off rescued by the bigger-cap retry counts as a sign-off', async () => {
  const { result, stages } = await run([seat('mock-critic-cut-signoff-then-fits', { maxTokens: 1000 })], 1);
  assert.ok(stages.includes('panel-1-mock-critic-cut-signoff-then-fits-retry'));
  const s = result.signoff.find(x => x.model === 'mock-critic-cut-signoff-then-fits');
  assert.equal(s.signedOff, true);
  assert.equal(result.passed, true);
});

test('stop reasons: only the provider saying length/max_tokens is "cut off"; a reply near its cap with stop:"stop" is complete', () => {
  for (const [usage, cut] of [
    [{ stop: 'length', output: 10 }, true], [{ stop: 'max_tokens', output: 10 }, true],
    [{ stop: 'stop', output: 990 }, false], [{ stop: 'error', output: 0 }, false],
    [{ stop: 'content_filter', output: 5 }, false], [{ output: 1000 }, false], [undefined, false],
  ]) assert.equal(providerCutOff(usage), cut, JSON.stringify(usage));
  assert.equal(abstentionReasonCode({ stop: 'stop', output: 990 }, 1000), 'REPLY_TRUNCATED', 'the 95% guess stays for UNPARSED replies only');
});

// Verify pass 2026-09-28 F2: the same rules in `signoff: 'first'` mode (18 shipped chains), where a
// cut-off or provider-ended `meets:true` used to pass the run.
async function runFirst(critic) {
  setCache(null); setBudget(null);
  const stages = [], lines = [];
  const result = await runChain({ request: 'A test request.', config: { ...config([critic], 1), signoff: 'first' }, log: l => lines.push(l), onStage: s => stages.push(s.label) });
  return { result, stages, lines };
}

test('first mode: a cut-off sign-off is retried once with a bigger cap, then is no pass', async () => {
  const { result, stages, lines } = await runFirst(seat('mock-critic-cut-signoff', { maxTokens: 1000 }));
  assert.ok(stages.includes('critique-1-retry'), `expected the bigger-cap retry, got ${stages.join(', ')}`);
  assert.equal(result.passed, false);
  const v = result.panelVerdicts.find(p => p.model === 'mock-critic-cut-signoff');
  assert.equal(v.verdict, 'unheard');
  assert.equal(v.reason_code, 'REPLY_TRUNCATED');
  assert.ok(lines.some(l => /signs off but was cut off at the cap/.test(l)));
});

test('first mode: a sign-off the provider ended with stop "error" is no pass', async () => {
  const { result } = await runFirst(seat('mock-critic-error-signoff'));
  assert.equal(result.passed, false);
  assert.equal(result.panelVerdicts[0].verdict, 'unheard');
});

test('first mode: a cut-off sign-off rescued by the bigger-cap retry passes', async () => {
  const { result, stages } = await runFirst(seat('mock-critic-cut-signoff-then-fits', { maxTokens: 1000 }));
  assert.ok(stages.includes('critique-1-retry'));
  assert.equal(result.passed, true);
  assert.equal(result.panelVerdicts.at(-1).verdict, 'signed_off');
});

test('first mode: a cut-off objection is kept as an objection', async () => {
  const { result } = await runFirst(seat('mock-critic-cut-objection', { maxTokens: 1000 }));
  assert.equal(result.passed, false);
  assert.equal(result.panelVerdicts[0].verdict, 'objected');
});
