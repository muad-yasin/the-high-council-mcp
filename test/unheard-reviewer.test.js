// test/unheard-reviewer.test.js
//
// The pilot (relay/pilot, 2026-09-17) lost ~4% of its panel votes: 14 critic replies were cut off
// at the 8000-token cap (several with `"meets": false` already written) and 2 were complete but
// malformed JSON. Each became an abstention, and THCMCP's unanimity check ignored abstentions - so
// when every reviewer that WAS heard signed off, the run said "every lab that answered signed off"
// and passed. These tests pin the fix: a reviewer who was not heard is an unknown, not consent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, classifyUnreadable, abstentionReasonCode, parseJson } from '../src/chain.js';

const seat = (model, extra = {}) => ({ provider: 'mock', model, lab: model, ...extra });

const config = (critics, maxRounds = 4) => ({
  name: 'test-unheard-reviewer', maxRounds, stopOnPass: true, signoff: 'unanimous',
  seats: { criteria: seat('mock-criteria'), builder: seat('mock-builder'), reviser: seat('mock-builder'), critics },
});

const run = (critics, maxRounds) => runChain({ request: 'A test request.', config: config(critics, maxRounds), log: () => {} });

test('a reviewer who stays unheard blocks unanimity even when every heard reviewer signs off', async () => {
  // The scripted critic fails the first draft and signs off the revision; the cut-off critic is
  // never heard. Under the old rule round 2 passed with "every lab that answered signed off".
  const result = await run([seat('mock-critic-scripted'), seat('mock-critic-cut', { maxTokens: 1000 })], 3);
  assert.equal(result.passed, false, 'a panel with an unheard reviewer must not be reported as passed');
  const cut = result.signoff.find(s => s.model === 'mock-critic-cut');
  assert.equal(cut.signedOff, null);
  assert.equal(cut.reason_code, 'REPLY_TRUNCATED');
});

test('a clean-but-incomplete round re-asks the panel instead of revising nothing (after the unheard seat itself was re-asked)', async () => {
  const lines = [];
  await runChain({ request: 'A test request.', config: config([seat('mock-critic-scripted'), seat('mock-critic-cut', { maxTokens: 1000 })], 4), log: m => lines.push(m) });
  assert.ok(lines.some(l => /did not return a readable verdict/.test(l)), 'expected the retry-the-panel log line');
  assert.ok(lines.some(l => /NOT agreement/.test(l)), 'expected the round-cap message to say this is not agreement');
});

test('a cut-off reply is retried once with a bigger cap, and the retried verdict counts', async () => {
  const stages = [];
  const result = await runChain({
    request: 'A test request.', config: config([seat('mock-critic-cut-then-fits', { maxTokens: 1000 })], 3),
    log: () => {}, onStage: s => stages.push(s.label),
  });
  assert.ok(stages.some(l => /^panel-1-.*-retry$/.test(l)), `expected a retry stage, got ${stages.join(', ')}`);
  const entry = result.signoff.find(s => s.model === 'mock-critic-cut-then-fits');
  assert.notEqual(entry.signedOff, null, 'the retried, readable verdict must be counted, not abstained');
  assert.equal(entry.reason_code, null);
});

test('a stated pass is not an unheard reviewer', async () => {
  // freedoms.pass: a recorded refusal to verdict is a stated position, unlike a lost reply.
  const cfg = { ...config([seat('mock-critic-scripted'), seat('mock-critic-passer')], 3), freedoms: { pass: true } };
  const result = await runChain({ request: 'A test request.', config: cfg, log: () => {} });
  assert.equal(result.passed, true);
});

test('classification still names a cut-off reply as truncated, at any cap', () => {
  assert.equal(abstentionReasonCode({ output: 36000, stop: 'length' }, 36000), 'REPLY_TRUNCATED');
  assert.match(classifyUnreadable({ output: 36000, stop: 'length' }, 36000), /token cap/);
});

test('a real cut-off shape stays unparseable - the fix must not guess at half a verdict', () => {
  assert.equal(parseJson('{"meets": false, "criteria": [], "failures": [{"criterion": "It states the assum'), null);
});

test('only the unheard seat is re-asked - the seats that already answered are not called again', async () => {
  // mock-critic-passer states a pass on round 1, so the heard side of the panel is clean and the
  // cut-off seat alone decides the round - the case the re-ask loop exists for.
  const stages = [];
  const cfg = { ...config([seat('mock-critic-passer'), seat('mock-critic-cut', { maxTokens: 1000 })], 1), freedoms: { pass: true } };
  await runChain({ request: 'A test request.', config: cfg, log: () => {}, onStage: s => stages.push(s.label) });
  const reasks = stages.filter(l => /-reask\d/.test(l));
  assert.ok(reasks.length >= 1, `expected the unheard seat to be re-asked, got stages: ${stages.join(', ')}`);
  assert.ok(reasks.every(l => /mock-critic-cut/.test(l)), `re-asks must only target the unheard seat, got ${reasks.join(', ')}`);
  assert.equal(stages.filter(l => /mock-critic-passer/.test(l)).length, 1, 'the seat that already answered must be called exactly once');
});
