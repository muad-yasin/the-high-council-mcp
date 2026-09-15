// v5 item 1: outcome classification - unit tests against src/outcome.js's pure function, per
// the plan's own acceptance test list (adapted to the extracted module rather than a full CLI
// run, which test/coder-gate-v4-preflight-verify.test.js-style integration already covers the
// wiring for elsewhere in this suite via reportJsonShape's real call site).
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOutcome } from '../src/outcome.js';

test('1. a clean signoff -> consensus', () => {
  assert.equal(computeOutcome({ passed: true, dropouts: [], signoff: [{ signedOff: true, passed: false }] }), 'consensus');
});

test('2. round cap reached, no dropouts, no abstention -> no_consensus', () => {
  assert.equal(computeOutcome({ passed: false, dropouts: [], signoff: [{ signedOff: false, passed: false }] }), 'no_consensus');
});

test('3. a non-empty dropouts[] -> degraded, even if passed is true', () => {
  assert.equal(computeOutcome({ passed: true, dropouts: [{ lab: 'kimi', stage: 'proposals', reason: 'x' }], signoff: [{ signedOff: true, passed: false }] }), 'degraded');
});

test('3b. an abstaining critic (signedOff: null, passed: false) with zero dropouts -> degraded - the exact gap this item exists to close', () => {
  assert.equal(computeOutcome({
    passed: false,
    dropouts: [],
    signoff: [{ signedOff: true, passed: false }, { signedOff: null, passed: false }],
  }), 'degraded');
});

test('4. dropouts AND an always-objecting critic -> still degraded (precedence)', () => {
  assert.equal(computeOutcome({
    passed: false,
    dropouts: [{ lab: 'kimi', stage: 'proposals', reason: 'x' }],
    signoff: [{ signedOff: false, passed: false }],
  }), 'degraded');
});

test('a `passed: true` abstention entry (the freedoms.pass stated-refusal case) does not itself count as an abstention for outcome purposes', () => {
  // signoff[].passed === true means a stated, recorded refusal to verdict (freedoms.pass) -
  // distinct from an unreadable-reply abstention. Only signedOff === null AND passed === false
  // is the unreadable-reply signal.
  assert.equal(computeOutcome({
    passed: true,
    dropouts: [],
    signoff: [{ signedOff: true, passed: false }, { signedOff: null, passed: true }],
  }), 'consensus');
});

test('missing/undefined dropouts or signoff never throws - treated as absent', () => {
  assert.equal(computeOutcome({ passed: true }), 'consensus');
  assert.equal(computeOutcome({ passed: false }), 'no_consensus');
  assert.equal(computeOutcome({}), 'no_consensus');
});
