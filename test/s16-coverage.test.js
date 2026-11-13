// 0.8.4 S16 (Q9(e), D13, RU-ADD-A12): a top-layer seat that read exactly this plan is reused only if what it sorted covers the current text of every open objection and late finding.
// The RULE of T9c / T21b / NEW-A12-1 / NEW-A12-2 (src/final-read.js coverageGaps, pure) and ONE run (the T9a fixture plus a defect one seat names in its own sorting at its last verdict). The four spec rows themselves are RULE-ONLY here: no committed fixture drives an ending exchange or a layer-3 post with the sorting on, so 'each seat reads once more' and the 4-call bound are not shown by a run (on the report's open list).
// Offline, mock seats, $0. Pattern: test/helpers/s8-stop-rows.js (runT9a).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { coverageGaps, finalReadLogLines, finalReadSummaryLine, renderFinalReadBlock } from '../src/final-read.js';
import { SORTING } from './helpers/rating-demand.js';
import { scenario, CRITERION } from './helpers/layer-two-run.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const fp = i => `${i.kind}|${i.problem}`;
const item = (id, problem = 'No back-off is stated.', kind = 'objection') => ({ id, kind, problem });

test('coverage rule (pure; the rule of T9c, T21b, NEW-A12-1, NEW-A12-2): a seat is asked again for an item opened since its read (no id in what it was shown) or amended since (another text); a withdrawn item changes nothing; nothing open, nothing asked', () => {
  const shown = new Map([['lc', [item('O-1'), item('O-2')]], ['ld', [item('O-1'), item('O-2')]]]);
  const run = current => coverageGaps({ seats: ['lc', 'ld'], shownBySeat: shown, current, fpOf: fp });
  assert.deepEqual(run([item('O-1'), item('O-2')]), [], 'everything open was shown, under the same text: both reused');
  assert.deepEqual(run([item('O-1')]), [], 'O-2 was withdrawn since: it changes nothing');
  assert.deepEqual(run([]), [], 'nothing is open: nothing to cover');
  assert.deepEqual(run([item('O-1'), item('O-2'), item('L-3', 'No timeout.', 'late finding')]), ['lc', 'ld'], 'a defect opened since (in the ending exchange, in a layer-3 post): each seat reads once more and sorts it');
  assert.deepEqual(run([item('O-1', 'No back-off is stated, and no limit.'), item('O-2')]), ['lc', 'ld'], 'O-1 amended since their sorting: each seat reads once more');
  assert.deepEqual(coverageGaps({ seats: ['lc', 'ld'], shownBySeat: new Map([['lc', [item('O-1')]]]), current: [item('O-1')], fpOf: fp }), ['ld'], 'a seat that was shown no list at all is asked when something is open');
  assert.deepEqual(coverageGaps({ seats: ['lc'], shownBySeat: new Map([['lc', null]]), current: [], fpOf: fp }), [], 'and not when nothing is open');
});

// The T9a fixture (test/helpers/s8-stop-rows.js): la raises X in pass 1, lc objects with X, in pass 2 lc and ld sort X from the list they were shown, the person's finish cuts the run at revise-2, so both seats read exactly the plan as it ends.
const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', sorting });
const LC_FAILURE = { criterion: CRITERION, problem: 'No back-off is stated.', fix: 'State one.', quote: 'retries failed requests', severity: 5 };
const idLC = objectionId('lc', LC_FAILURE);
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: lc's failure carried no `relation`. NEW: lc's first raise (pass 1) says `new`, its repeat in pass 2 says `continues <id>` (`again` = true). WHY: relationRule recorded (src/chain.js relation gate); a `new` on a standing id would mint #2.
const lcObjects = (sorting, again = false) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ ...LC_FAILURE, relation: again ? `continues ${idLC}` : 'new' }], verdict_line: 'no', ...(sorting ? { sorting } : {}) });
const NEW_DEFECT = { sort: 'must_do', reason: 'No timeout is stated.', criterion: CRITERION, quote: 'retries failed requests' };   // an entry with no id: a defect lc names only in its sorting

const runWith = async lcWords => {
  setHeldForTest(SORTING);
  setOutboundScan({ finish: true });
  try {
    return await scenario({ answerBack: true, l1Severity: 5, critics: L3,
      overrides: { 'panel-1-la': MET, 'panel-1-lc': lcObjects(), 'panel-2-lc': lcObjects(lcWords, true), 'panel-2-ld': metWith([{ id: idLC, sort: 'may_leave', reason: 'Minor for the build.' }]), 'final-read-lc': MET, 'final-read-ld': MET },
      extra: {}, cutLabels: ['revise-2'] });
  } finally { setOutboundScan({}); }
};
const frLabelsOf = r => r.result.stages.map(s => s.label).filter(l => l.startsWith('final-read-'));

test('coverage (run): the same plan text read by both layer-3 seats, and a defect opened after the other seat\'s sorting (lc named it only in its own sorting at its last verdict): the OTHER seat reads once more and sorts it; the seat that named it is not asked about its own word', async () => {
  const base = await runWith([{ id: idLC, sort: 'must_do', reason: 'The back-off is still missing.', criterion: CRITERION }]);
  assert.equal(base.result.passed, false, 'premise: the run ends not agreed, on the finish');
  assert.deepEqual(frLabelsOf(base), [], 'premise (T9a): nothing opened since, so both seats are reused and no layer-3 call is made');
  assert.equal(base.result.finalRead.reason, 'every_top_seat_read_this_plan');
  const r = await runWith([{ id: idLC, sort: 'must_do', reason: 'The back-off is still missing.', criterion: CRITERION }, NEW_DEFECT]);
  assert.equal(r.result.passed, false, 'premise: the run ends not agreed, on the finish');
  assert.ok((r.result.lateFindings ?? []).some(l => l.found === 'last_verdict' && l.lab === 'lc'), 'premise: lc\'s own sorting named a defect no listed item names: a late finding of the run');
  assert.deepEqual(frLabelsOf(r), ['final-read-ld'], 'ld was never shown the new defect: it reads once more; lc is covered by its own word');
  assert.deepEqual(r.result.finalRead.seats.map(s => [s.lab, s.read]), [['ld', true]]);
  assert.deepEqual((r.result.finalRead.reused ?? []).map(x => x.lab), ['lc'], 'lc\'s last statement is reused');
});

test('coverage words (run): the block above the plan says the seat was asked after an objection or late finding was opened or amended; a run with only never-read seats keeps its old opening', async () => {
  const r = await runWith([{ id: idLC, sort: 'must_do', reason: 'The back-off is still missing.', criterion: CRITERION }, NEW_DEFECT]);
  assert.deepEqual(frLabelsOf(r), ['final-read-ld'], 'premise: ld was asked for coverage');
  assert.match(r.result.deliverable, /The run ended without agreement\. After the plan's last change, or after an objection or late finding was opened or amended since a seat's last sorting, layer 3 was asked to read it\./);
});

test('own objection (run): an objection lc raises itself in pass 2 is its own word; only the OTHER seat, which was not shown it, reads once more', async () => {
  const Y = { criterion: CRITERION, problem: 'No timeout is stated either.', fix: 'State one.', quote: 'retries failed requests', severity: 5 };
  setHeldForTest(SORTING);
  setOutboundScan({ finish: true });
  let r;
  try {
    r = await scenario({ answerBack: true, l1Severity: 5, critics: L3,
      overrides: { 'panel-1-la': MET, 'panel-1-lc': lcObjects(), 'panel-2-lc': JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ ...LC_FAILURE, relation: `continues ${idLC}` }, { ...Y, relation: 'new' }], verdict_line: 'no', sorting: [{ id: idLC, sort: 'must_do', reason: 'The back-off is still missing.', criterion: CRITERION }] }), 'panel-2-ld': metWith([{ id: idLC, sort: 'may_leave', reason: 'Minor for the build.' }]), 'final-read-lc': MET, 'final-read-ld': MET },
      extra: {}, cutLabels: ['revise-2'] });
  } finally { setOutboundScan({}); }
  assert.equal(r.result.passed, false, 'premise: not agreed, on the finish');
  assert.deepEqual(r.result.panelVerdicts.filter(v => v.layer === 3 && v.round === 2).map(v => [v.lab, v.verdict]).sort(), [['lc', 'objected'], ['ld', 'signed_off']], 'premise: both read in pass 2');
  assert.deepEqual(frLabelsOf(r), ['final-read-ld'], 'lc raised the new objection itself; ld was never shown it');
});

test('coverage words (run): a coverage seat whose re-read fails is a seat that had read the plan: DID NOT READ AGAIN in the heading and the summary, its own sentence in the block; the old "did not read" wording stays for a seat that never read', async () => {
  setHeldForTest(SORTING);
  setOutboundScan({ finish: true });
  let r;
  try {
    r = await scenario({ answerBack: true, l1Severity: 5, critics: L3,
      overrides: { 'panel-1-la': MET, 'panel-1-lc': lcObjects(), 'panel-2-lc': lcObjects([{ id: idLC, sort: 'must_do', reason: 'The back-off is still missing.', criterion: CRITERION }, NEW_DEFECT], true), 'panel-2-ld': metWith([{ id: idLC, sort: 'may_leave', reason: 'Minor for the build.' }]), 'final-read-ld': 'not json at all', 'final-read-ld-reask1': 'still not json' },
      extra: {}, cutLabels: ['revise-2'] });
  } finally { setOutboundScan({}); }
  const text = r.result.deliverable;
  assert.deepEqual(frLabelsOf(r).sort(), ['final-read-ld', 'final-read-ld-reask1'], 'premise: ld was asked and re-asked once');
  assert.match(text, /### ld: DID NOT READ AGAIN\n\nThis seat had read the final plan but did not read it again after an objection or late finding was opened or amended: /);
  assert.match(text, /\*\*ld had read the final plan but did not read it again after an objection or late finding was opened or amended\.\*\*/);
  assert.doesNotMatch(text, /Not every layer-3 seat read the final plan/, 'the footer for seats that never read is not used');
  assert.match(finalReadSummaryLine(r.result.finalRead), /ld DID NOT READ AGAIN/);
});

test('coverage words (pure): the log names a coverage seat that did not read again; a seat that never read keeps the old lines', () => {
  const entry = (lab, sha, extra = {}) => ({ lab, layer: 3, label: `final-read-${lab}`, last_read_sha: sha, reasked: true, read: false, why: 'malformed JSON', ...extra });
  const cov = finalReadLogLines([entry('ld', 'abc')], 'not_agreed', 'abc');
  assert.deepEqual(cov, ['  ld: had read the final plan; did NOT read it again after an objection or late finding was opened or amended: malformed JSON.', '  LAYER-3 SEAT(S) (ld) DID NOT READ AGAIN after an objection or late finding was opened or amended. The run ended without agreement.']);
  const never = finalReadLogLines([entry('lc', null)], 'not_agreed', 'abc');
  assert.deepEqual(never, ['  lc: did NOT read the final plan: malformed JSON.', '  NOT EVERY LAYER-3 SEAT READ THE FINAL PLAN after its last change (lc did not). The run ended without agreement.']);
  assert.deepEqual(finalReadLogLines([entry('lc', null)], 'not_agreed'), never, 'without the sha argument the lines are the old ones');
  assert.match(renderFinalReadBlock({ ran: true, run_end: 'not_agreed', final_sha: 'abc', seats: [entry('lc', null)] }), /^## Layer 3 on the final plan\n\nThe run ended without agreement\. After the plan's last change, layer 3 was asked/, 'no coverage seat: the old opening, byte for byte');
});

// T21c (WHOLE-RUN row of the S16 fix round; the row's "read the rewrite" is asserted through final_sha, because a seat's last_read_sha is the sha it read BEFORE this call): a not-agreed ending with an open objection, where the dispute rewrite changes the text.
test('T21c (run): a not-agreed ending with an open objection, where the dispute rewrite changes the text: both layer-3 seats read the rewrite before the run ends (2 calls, no re-ask) and the run stays not agreed', async () => {
  const REWRITE = 'The worker retries failed requests up to five times, with a pause between tries.';
  const r = await scenario({ answerBack: true, critics: L3, nonMockSlot: true,
    extra: { maxOverseerRounds: 1, dispute: { enabled: true, stall_rounds: 2 } },
    overrides: { 'panel-1-la': MET, 'panel-1-lc': lcObjects(), dispute: REWRITE, 'final-read-lc': MET, 'final-read-ld': MET } });
  assert.deepEqual(frLabelsOf(r).sort(), ['final-read-lc', 'final-read-ld'], 'both layer-3 seats read the rewrite: two calls, no re-ask');
  assert.equal(r.result.passed, false, 'the run stays not agreed');
  assert.equal(r.result.dispute?.ran, true, 'premise: the dispute stage ran (the same reason is set when it did not)');
  assert.ok(r.result.stages.some(s => s.label === 'dispute'), 'premise: the dispute call was made');
  assert.deepEqual(r.result.panelVerdicts.filter(v => v.layer === 3 && v.round === 1).map(v => [v.lab, v.verdict]).sort(), [['lc', 'objected'], ['ld', 'signed_off']], 'premise: both read the old text in the climb');
  assert.equal(r.result.finalRead?.ran, true);
  const seats = ['lc', 'ld'].map(lab => r.result.finalRead?.seats?.find(x => x.lab === lab));
  assert.deepEqual(seats.map(x => [x?.read, x?.reasked]), [[true, false], [true, false]], 'both read the rewrite, no re-ask');
  assert.equal(seats[0]?.last_read_sha, seats[1]?.last_read_sha, 'both had read the same (climb) text before');
  assert.notEqual(seats[0]?.last_read_sha, r.result.finalRead?.final_sha, 'and the plan the final read ran on is another text: the rewrite');
});
