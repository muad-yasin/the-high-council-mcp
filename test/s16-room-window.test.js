// 0.8.4 S16 (H; Muad 09 Nov 2026, Q9(f) route 4): the room the final read gives a layer-3 seat, from the model's input window W by the production rule (a part's whole prompt at chars/4 plus the cap sent fits in HALF of W), through the seam
// setContextWindowsForTest (a mock seat has no window of its own). The same fixture as test/s16-room.test.js: five open objections of different ratings. Offline, mock seats, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setCache, setBudget, setPromptSpy, setOutboundScan, FINAL_READ_NO_ROOM_WHY } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { setContextWindowsForTest } from '../src/context-window.js';
import { promptTokensOfChars } from '../src/cost.js';
import { SORTING } from './helpers/rating-demand.js';
import { scenario, CRITERION } from './helpers/layer-two-run.js';
import { finalReadPartRule } from './held-prompts/held-084-s16.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); setContextWindowsForTest(null); });

const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const CR = [CRITERION, 'The plan names an owner for the worker.', 'The plan states a timeout.', 'The plan names a rollback step.', 'The plan defines what is logged.'];
const fail = (n, severity) => ({ criterion: CR[n], problem: `Problem number ${n}: ${'detail '.repeat(30)}`, fix: 'Fix it.', quote: 'retries failed requests', severity, relation: 'new' });   // K1: relationRule is recorded; each failure is la's first raise
const RAISE = JSON.stringify({ meets: false, criteria: CR.map(c => ({ criterion: c, verdict: 'FAILED', evidence: 'Missing.' })), failures: [fail(0, 9), fail(1, 8), fail(2, 6), fail(3, 5), fail(4, 4)], verdict_line: 'no' });
const SENT_CAP = 3000;   // the scenario's seats are sent at maxTokens 3000
const frLabelsOf = r => r.result.stages.map(s => s.label).filter(l => l.startsWith('final-read-'));

async function run(held, windowOf) {
  setHeldForTest(held);
  setContextWindowsForTest(windowOf);
  setOutboundScan({ finish: true });
  try { return await scenario({ answerBack: true, l1Severity: 9, critics: L3, overrides: { 'panel-1-la': RAISE, 'final-read-lc': MET, 'final-read-ld': MET, 'final-read-lc-part2': MET }, extra: { criteria: CR }, cutLabels: ['revise-1'] }); }
  finally { setOutboundScan({}); }
}
const BIG = 1e9;
// the window at which `chars` (the whole prompt) is one token short of fitting in half of it
const windowJustUnder = chars => 2 * (promptTokensOfChars(chars) + SENT_CAP - 100);

test('T21ce by the production rule: a seat whose window leaves no room even for an empty list is not called and is named as not having read, with the cause; the other seat reads as usual', async () => {
  const r = await run({ ...SORTING, finalReadPartRule }, seat => (seat.lab === 'lc' ? 2 * SENT_CAP : BIG));   // half of it is the cap alone: nothing is left for a prompt
  assert.ok(!frLabelsOf(r).includes('final-read-lc') && frLabelsOf(r).includes('final-read-ld'), frLabelsOf(r).join(', '));
  const lc = r.result.finalRead.seats.find(s => s.lab === 'lc');
  assert.deepEqual([lc.read, lc.why], [false, FINAL_READ_NO_ROOM_WHY]);
});

test('a window that holds the plan and some of the list but not all five rows: with the part sentence recorded the list is read in parts (the first a full read, the next sort-only under an additive label); a seat with a big window reads in one', async () => {
  const probe = await run({ ...SORTING, finalReadPartRule }, () => BIG);
  assert.deepEqual(frLabelsOf(probe).sort(), ['final-read-lc', 'final-read-ld'], 'premise: with room, one call per seat');
  const p = probe.prompts.get('final-read-lc');
  const full = p.system.length + p.user.length;
  const r = await run({ ...SORTING, finalReadPartRule }, seat => (seat.lab === 'lc' ? windowJustUnder(full) : BIG));
  assert.ok(frLabelsOf(r).includes('final-read-lc') && frLabelsOf(r).includes('final-read-lc-part2'), `lc in two parts: ${frLabelsOf(r).join(', ')}`);
  assert.ok(!frLabelsOf(r).some(l => l.startsWith('final-read-ld-part')), 'ld has room for the whole list');
  const W = windowJustUnder(full);
  for (const [label, pr] of r.prompts) if (label.startsWith('final-read-lc')) assert.ok(promptTokensOfChars(pr.system.length + pr.user.length) + SENT_CAP <= Math.floor(W / 2), `${label}: the whole prompt at chars/4 plus the cap fits in half the window`);
});

// REMOVED (0.8.4 apply, K7): 'HELD state (the part sentence is not recorded): the same tight window makes no parts' ran `run(SORTING, ...)` and expected only ['final-read-lc', 'final-read-ld']. Job 12: the actual labels also held 'final-read-lc-part2', '-part2-reask1', '-part3' (the room rule ran): `finalReadPartRule` is recorded (src/roles.js), so SORTING alone falls through to it. Sibling (same file): 'a window that holds the plan and some of the list but not all five rows' (the same tight window, with the part sentence recorded: lc in two parts, ld whole), whose probe also pins 'with room, one call per seat'.
