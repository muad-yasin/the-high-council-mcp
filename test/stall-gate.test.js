// 0.8.4 SG-1 (C&C's ruling, 08 Nov 2026, option B): the S5 stall escalation is gated like the layer-1 go-up (U2-1b): it passes the plan up only where layer 2's review section can be built, i.e. the chain keeps the answer-back list (`ledgerOn`) AND the rating demand is recorded (`severityOn`).
// Where it is off, a stall that cannot be passed up is the S5 U-C STOP for the person (never an end), with the reason `climb_not_shown`; its sentence is the generic third branch of `whyOf` (S5's own A-DRAFT text, not held, the same in the dark state and after recording).
//   SG-A  answer_back OFF (demand on): the layer-1 stall does not go up: stall_stop, why climb_not_shown, a pass left, no escalation, no rule- call
//   SG-B  the rating demand NOT recorded (answer_back on): the same
//   SG-C  control: both on: the stall goes up as before (PIN)
//   SG-D  stallStopWhy, the order: the top layer first, then no pass left, then the gate (pure)
//   SG-E  the stop's sentence: the generic third branch, nothing unrecorded, --continue offered (PIN of the existing branch)
//   SG-F  the schema enum carries the value and still the four old ones; an unknown value is outside it
//   SG-G  shipped chains: every shipped layered plan-* chain keeps answer_back and dispute (so the gate changes none of them); mock-layered is the one that does not (named)
// Offline, $0: the scripted-cache fixture of test/stall-escalation.test.js (own labels). Own run ids; nothing depends on another test of the file.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { runChain, setPromptSpy, setCache, setBudget, RoundStopped } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import * as OR from '../src/overseer-rounds.js';
import * as HESC from './held-prompts/held-escalation.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const INJECT = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const X = { severity: 5, criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests' };
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const rules = list => JSON.stringify({ rulings: list });
// Layer 1 ('gate-raiser') objects with X in passes 1 and 2 (the stall at w = 2); layers 2 and 3 sign off whenever asked.
async function run({ held, answerBack, maxRounds = 6 }) {
  const served = [];
  setPromptSpy(() => {});
  setHeldForTest(held);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried no `relation`. NEW: pass 1 says `new`, pass 2 (the same seat, the same failure) says `continues <id>`. WHY: relationRule recorded (src/chain.js relation gate); a `new` on a standing id would mint #2 and the stall would never fire.
  const script = { 'panel-1-gate-raiser': objects({ ...X, relation: 'new' }), 'panel-2-gate-raiser': objects({ ...X, relation: `continues ${objectionId('gate-raiser', X)}` }), 'revise-1': `${DRAFT}\n\nRevision 1.` };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = label.startsWith('rule-') ? rules([]) : (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-stall-gate', criteria: [CRITERION], signoff: 'unanimous', ...(answerBack ? { answer_back: { enabled: true } } : {}), dispute: { enabled: true, stall_rounds: 2 }, maxRounds,
    seats: { builder, reviser: builder, critics: [seat('gate-raiser', 1), seat('gate-mid', 2), seat('gate-top', 3)] } };
  let result = null; let error = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-sg', log: () => {}, config }); } catch (e) { error = e; }
  return { result, error, served, report: result ? JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-sg', chain: 'fixture-stall-gate', task: 't.md', result, config }))) : null };
}

const assertStoppedWithoutClimb = ({ error, served }, label) => {
  assert.ok(error instanceof RoundStopped, `${label}: the run stops for the person: ${error}`);
  assert.equal(error.stop.kind, 'stall_stop', label);
  assert.equal(error.stop.why, 'climb_not_shown', label);
  assert.equal(error.stop.pass_left, true, `${label}: a pass was left`);
  assert.equal(error.stop.stalled.length, 1, label);
  assert.equal(served.some(l => l.startsWith('rule-')), false, `${label}: nothing was ruled on: no climb`);
  assert.equal(served.includes('panel-3-gate-mid'), false, `${label}: layer 2 was not asked in pass 3`);
};

test('SG-A: answer_back OFF (the rating demand on): the layer-1 stall is not passed up: stall_stop with the reason climb_not_shown, a pass left, no ruling call', async () => {
  assertStoppedWithoutClimb(await run({ held: { ...INJECT, ...DEMAND }, answerBack: false }), 'SG-A');
});

// REMOVED (0.8.4 apply, recorded state; K7): SG-B, 'the rating demand NOT recorded (answer_back on): the same stop'. A held-state row: after the recording no shipped run is without the rating demand. Sibling: SG-A (the same `climb_not_shown` stop, asserted by the same assertStoppedWithoutClimb on the recorded state with answer_back off).

test('SG-C (control, PIN): both on: the stall goes up as before: an escalation row with trigger stall and layer 2 is asked in pass 3', async () => {
  const { error, report, served } = await run({ held: { ...INJECT, ...DEMAND }, answerBack: true });
  assert.equal(error, null, `no stop: ${error}`);
  assert.equal(report.escalations?.[0]?.trigger, 'stall');
  assert.ok(served.includes('panel-3-gate-mid'), 'layer 2 reviewed the plan in pass 3');
});

test('SG-D: stallStopWhy, the order: the top layer first, then no pass left, then the gate', () => {
  assert.equal(typeof OR.stallStopWhy, 'function', 'the pure export exists');
  const w = OR.stallStopWhy;
  assert.equal(w({ topHeld: true, passLeft: true, gateOn: false }), 'top_layer');
  assert.equal(w({ topHeld: true, passLeft: false, gateOn: false }), 'top_layer');
  assert.equal(w({ topHeld: true, passLeft: true, gateOn: true }), 'top_layer');
  assert.equal(w({ topHeld: false, passLeft: false, gateOn: false }), 'last_pass', 'no pass left wins over the gate');
  assert.equal(w({ topHeld: false, passLeft: false, gateOn: true }), 'last_pass');
  assert.equal(w({ topHeld: false, passLeft: true, gateOn: false }), 'climb_not_shown');
  assert.equal(w({ topHeld: false, passLeft: true, gateOn: true }), 'last_pass', 'unreachable from chain.js (the stall then goes up); it keeps the pre-SG-1 reading');
});

test('SG-E (PIN of the existing generic branch): the stop sentence of a climb_not_shown stop is the generic third branch, offers --continue and --finish, and names no sentence that is not recorded; a stop without figures prints the figures-less line', () => {
  const stop = { kind: 'stall_stop', why: 'climb_not_shown', top_layer: 3, rounds: 1, stalled: [{ id: 'O-aaaaaaaa', lab: 'gate-raiser', layer: 1, passes: [1, 2] }], pass_left: true, pass: 2, overseer_round: 1 };
  const text = OR.stopSentence(stop, { runDir: 'R' });
  assert.match(text, /an objection stood unchanged through the last 2 verdicts of its judge and could not be passed up/);
  assert.doesNotMatch(text, /no pass is left|no layer is above/);
  assert.match(text, /--continue/);
  assert.match(text, /--finish/);
  assert.match(OR.stopSentence({ kind: 'stall_stop', why: 'climb_not_shown', pass_left: true, pass: 2 }, { runDir: 'R' }), /objections stood unchanged for several verdicts in a row and could not be passed up/);
});

test('SG-F: the report schema carries climb_not_shown beside the four old reasons, and an unknown reason is outside the enum', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const found = [];
  const walk = n => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (n.why && Array.isArray(n.why.enum) && n.why.enum.includes('top_layer')) found.push(n.why.enum); Object.values(n).forEach(walk); } };
  walk(schema);
  assert.ok(found.length >= 1, 'the stop block\'s why enum was found');
  for (const e of found) {
    for (const v of ['revisions', 'unheard', 'top_layer', 'last_pass', 'climb_not_shown']) assert.ok(e.includes(v), `${v} is in the enum`);
    assert.equal(e.includes('not_a_reason'), false, 'known-bad: an unknown reason is outside the enum');
  }
});

test('SG-G (PIN): every shipped layered plan-* chain keeps answer_back and dispute, so the gate changes none of them; mock-layered (the $0 demo chain) keeps no answer-back list and so loses the stall escalation (named; a release-list item)', () => {
  const dir = new URL('../chains/', import.meta.url);
  const layered = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))])
    .filter(([, c]) => c.signoff === 'unanimous' && (c.seats?.critics || []).length && c.seats.critics.every(k => Number.isInteger(k.layer)));
  const plans = layered.filter(([f]) => f.startsWith('plan-'));
  assert.ok(plans.length >= 7, `the shipped plan chains were found (${plans.length})`);   // CHANGED ACCEPTED TEST (0.8.4 seats unit): OLD bar 8. NEW bar: 7 (seven planning chains left after the three retirements and the China mini). WHY: the count moves with the thing it counts
  for (const [f, c] of plans) { assert.equal(c.answer_back?.enabled, true, `${f}: answer_back on`); assert.equal(c.dispute?.enabled, true, `${f}: dispute on`); }
  const mock = layered.find(([f]) => f === 'mock-layered.json')?.[1];
  assert.ok(mock, 'mock-layered exists'); assert.notEqual(mock.answer_back?.enabled, true, 'mock-layered keeps no answer-back list');
});
