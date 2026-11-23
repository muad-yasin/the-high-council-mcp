// 0.8.4 S9 (the proposer return): the labels of the three return calls (return-alt-<seat>, return-post-<seat>, return-answer-<seat>) are registered where every label must be (system text, stage kind, run state), the USD maximum rows exist only behind the ONE gate
// (src/call-gates.js proposerReturnOn) and never in the expected figure. $0, offline; the S9 words are injected in-process (setHeldForTest).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setHeldForTest } from '../src/held-roles.js';
import { estimateChainRows } from '../src/cost.js';
import { systemTextsFor } from '../src/stage-system.js';
import { stageKindOf, buildStageContract, isStructuredStage, requiredSectionsFor } from '../src/stage-contract.js';
import { classifyStageCompletion } from '../src/run-state.js';
import { stageKindOfFile } from '../src/verdict-stats.js';
import { callGatesOf } from '../src/call-gates.js';
import * as HS9 from './held-prompts/held-084-s9.js';

afterEach(() => setHeldForTest(null));

const S9WORDS = Object.fromEntries(Object.entries(HS9).filter(([, v]) => typeof v === 'function'));
const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, layer, maxTokens: 3000 });
const cfgOf = (over = {}, props = 3) => ({
  name: 'ret', signoff: 'unanimous', decisions: { enabled: true }, maxOverseerRounds: 4, layerRevisions: { 1: 2, 2: 2 }, answer_back: { enabled: true },
  estimate: { promptTokens: 4000, draftTokens: 6000, critiqueTokens: 1200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'external', model: 'claude-code-session' }, reviser: { provider: 'external', model: 'claude-code-session' },
    proposers: Array.from({ length: props }, (_, i) => ({ provider: 'mock', model: 'mock-proposer', lab: `p${i}`, maxTokens: 2000 })),
    critics: [seat('a1', 1), seat('a2', 1), seat('b1', 2), seat('b2', 2), seat('c1', 3), seat('c2', 3)] },
  ...over,
});
const returnRows = rows => rows.filter(r => /^return-(alt|post|answer)-/.test(r.label));

test('the three labels resolve in the stage kind, the stage contract and the run state', () => {
  for (const [label, kind, key] of [['return-alt-1-p0', 'return-alt', 'alternative'], ['return-post-2-p1', 'return-post', 'post'], ['return-answer-3-p2', 'return-answer', 'answer'], ['return-alt-p0', 'return-alt', 'alternative']]) {
    assert.equal(stageKindOf(label), kind, label);
    assert.deepEqual(requiredSectionsFor(kind), [key]);
    assert.equal(isStructuredStage(kind), true);
    assert.equal(buildStageContract(cfgOf(), kind).stage_id, kind);
    assert.equal(classifyStageCompletion(label), 'posted', `${label}: a finished return call is something written, no verdict`);
    assert.equal(stageKindOfFile(`${label}.md`), kind, `${label}: one stage type per kind, not one per seat and round`);
  }
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: this row and 'no row while any one condition fails' also ran with the S9 words HELD (`setHeldForTest(null)`: no system text, no return row, `proposerReturn` false). NEW: those held halves are REMOVED (K7): the proposer-return words are recorded in every shipped run. Sibling: the injected halves in the same tests (the one system line; the rows and the gate with the words recorded), and the 'no Decisions rule / no proposer seat / one round' conditions, which stay (they are the chain's own settings). WHY: the S9 words recorded (src/prompts/recorded-084-s9.js).
test('systemTextsFor knows the return labels: the one system line (never a throw)', () => {
  const cfg = cfgOf(); const s = cfg.seats.proposers[0];
  setHeldForTest(S9WORDS);
  for (const l of ['return-alt-p0', 'return-post-p0', 'return-answer-p0']) assert.deepEqual(systemTextsFor(l, cfg, s), [HS9.proposerReturnSystem()], l);
});

test('the USD maximum rows: per proposer an alt, a post and an answer row, each C - 1 = 3 times (27 calls at P = 3); the expected figure and the other gates carry none', () => {
  setHeldForTest(S9WORDS);
  const cfg = cfgOf();
  const rows = returnRows(estimateChainRows(cfg, { maximum: true }));
  assert.deepEqual(rows.map(r => r.label).sort(), ['p0', 'p1', 'p2'].flatMap(k => ['alt', 'post', 'answer'].map(m => `return-${m}-${k}`)).sort());
  assert.ok(rows.every(r => r.times === 3), JSON.stringify(rows.map(r => [r.label, r.times])));
  assert.equal(rows.reduce((t, r) => t + (r.times ?? 1), 0), 27);
  assert.deepEqual(returnRows(estimateChainRows(cfg, {})), [], 'the expected figure carries no return row: it never moves');
  assert.equal(callGatesOf(cfg).proposerReturn, true);
  // a post and an answer call read the others' alternatives: their input is larger than the first call's by the others' caps
  const by = Object.fromEntries(rows.filter(r => r.label.endsWith('-p0')).map(r => [r.label, r]));
  assert.ok(by['return-post-p0'].input > 0 && by['return-answer-p0'].input > by['return-post-p0'].input, 'the answer call carries its own alternative as well');
});

test('no row while any one condition fails: no Decisions rule, no proposer seat; a lone proposer has an alt row only', () => {
  setHeldForTest(S9WORDS);
  assert.deepEqual(returnRows(estimateChainRows(cfgOf({ decisions: undefined }), { maximum: true })), [], 'no Decisions rule');
  assert.deepEqual(returnRows(estimateChainRows(cfgOf({}, 0), { maximum: true })), [], 'no proposer seat (S9a: the writer route; no fall back to the critics)');
  assert.deepEqual(returnRows(estimateChainRows({ ...cfgOf(), maxOverseerRounds: 1 }, { maximum: true })), [], 'one overseer round: no round but the last');
  assert.deepEqual(returnRows(estimateChainRows(cfgOf({}, 1), { maximum: true })).map(r => r.label), ['return-alt-p0'], 'one proposer has nothing to read and nobody to answer');
});

test('the gate is ONE predicate: decisionLevel needs the Decisions rule and the words; proposerReturn adds a proposer seat (alternatives.enabled counts as the Decisions rule)', () => {
  setHeldForTest(S9WORDS);
  assert.deepEqual([callGatesOf(cfgOf()).decisionLevel, callGatesOf(cfgOf()).proposerReturn], [true, true]);
  assert.deepEqual([callGatesOf(cfgOf({}, 0)).decisionLevel, callGatesOf(cfgOf({}, 0)).proposerReturn], [true, false]);
  assert.deepEqual([callGatesOf(cfgOf({ decisions: undefined })).decisionLevel, callGatesOf(cfgOf({ decisions: undefined })).proposerReturn], [false, false]);
  assert.equal(callGatesOf(cfgOf({ decisions: undefined, alternatives: { enabled: true } })).decisionLevel, true);
});
