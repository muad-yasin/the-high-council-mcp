// 0.8.4 S17 (ratings at the end of a run; FEATURE_SPECS l.1642 to l.1645, l.1687, l.1688; Q9(d), D33, N23, N25): WHOLE-RUN rows for what the final read does to an open objection of a lower seat, by its rating.
// Offline, mock seats, $0. The fixture is the one of test/s8-closure.test.js (C3-14 to C3-18), which runs green on the box: layer 1 is finished at its revision bound on a person's recorded finish, both layer-3 seats read once at the final read,
// and the dispute stage is on. Beside the objection under test (la's default failure, rated by `rate`) sits a rated-5 one that blocks layer 1 whatever happens, so the run always reaches the not-agreed end the closure belongs to.
// The ratings and the sorting words are tested with the held words injected (SORTING = the rating demand and the three S8 sorting words): as shipped they are held, so none of this is reachable in production yet.
// The closure only fires at a not-agreed end (src/chain.js, closedKeys: the dispute stage must have run), so these rows run there; the agreed-end side moves to S18 with T15a and T17f (C&C ruled, 09 Nov).
// Written without a run (no tests on the laptop). The reds are swapped-input variants (test/S17 swaps, one red tree at the unit end): the same block with ONE input changed and every assert line byte-identical.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { SORTING } from './helpers/rating-demand.js';
import { scenario, idOf, CRITERION } from './helpers/layer-two-run.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const FINISH = [{ choice: 'finish', stop: 'layer_bound:1:8', kind: 'layer_bound', why: 'revisions', layer: 1 }];
const STOPPED = async f => { try { return await f(); } catch (e) { if (e && e.stop) throw new Error(`premise: the run stopped at ${e.stop.kind}:${e.stop.overseer_round}:${e.stop.pass} (why ${e.stop.why}, layer ${e.stop.layer}): the recorded finish names a different stop id`); throw e; } };
const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: BLOCKER carried a rating but no `relation`. NEW: `relation: 'new'` (la's first raise, with the helper's own failure). WHY: relationRule recorded (src/chain.js relation gate).
const BLOCKER = { criterion: CRITERION, problem: 'No back-off is specified.', fix: 'Specify one.', quote: 'The worker', severity: 5, relation: 'new' };
const BLOCKER_ID = objectionId('la', BLOCKER);   // rated 5 by la: holds layer 1, and stays open whatever layer 3 says
const TESTED = idOf(1);   // la's default failure; its id does not depend on the rating
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', ...(sorting !== undefined ? { sorting } : {}) });
const sortingOf = (seat, word) => (word === null ? undefined : [{ id: TESTED, sort: word, reason: `${seat}: minor wording.` }, { id: BLOCKER_ID, sort: 'may_leave', reason: `${seat}: also minor.` }]);
// rate: the rating la gives the objection under test; lc, ld: what each layer-3 seat sorts it (null: no sorting in that seat's reply)
const closing = async ({ rate, lc, ld }) => {
  setHeldForTest(SORTING);
  const lines = [];
  const r = await STOPPED(() => scenario({ answerBack: true, l1Severity: rate, extraFailures: [BLOCKER], critics: L3, overrides: { 'final-read-lc': metWith(sortingOf('lc', lc)), 'final-read-ld': metWith(sortingOf('ld', ld)) }, extra: { maxRounds: 1, dispute: { enabled: true } }, runExtra: { roundChoices: FINISH, log: l => lines.push(String(l)) } }));
  return { ...r, lines };
};
const premise = r => {
  assert.equal(r.result.passed, false, 'premise: the run ends not agreed (on the recorded finish)');
  assert.ok(r.result.finalRead && r.result.finalRead.ran === true, 'premise: the final read ran');
  assert.equal(r.result.dispute?.ran, true, 'premise: the dispute stage ran');
  assert.deepEqual((r.result.dispute.open_objections || []).map(o => o.id).sort(), [TESTED, BLOCKER_ID].sort(), 'premise: the dispute list holds both objections');
};
const entryOf = (r, id) => r.result.dispute.open_objections.find(o => o.id === id);
const sortedRowOf = (r, id) => (r.result.finalRead.sorting || []).find(x => x.id === id);

test('T21s, T21bc: an open objection rated 2.0 that both layer-3 seats sort may-leave at the final read is closed on the record by it (the entry is kept, marked, with the sorting and each seat\'s reasons) and shown as closed below 4 in the deliverable', async () => {
  const RATE = 2;
  const SORTS = ['may_leave', 'may_leave'];   // lc, ld on the objection
  const r = await closing({ rate: RATE, lc: SORTS[0], ld: SORTS[1] });
  premise(r);
  const e = entryOf(r, TESTED);
  assert.equal(e?.closed_by, 'final_read', 'T21s: closed on the record by the final read');
  assert.equal(e?.severity, RATE, 'its rating is unchanged');
  assert.equal(r.result.dispute.open_objections.length, 2, 'T21bc: kept on the record, nothing is dropped');
  const row = sortedRowOf(r, TESTED);
  assert.deepEqual([row?.sort, (row?.reasons || []).map(x => x.reason).sort()], ['may_leave', ['lc: minor wording.', 'ld: minor wording.']], 'the sorting and both seats\' reasons are on the record');
  assert.match(r.result.deliverable, new RegExp(`- ${TESTED} \\(raised by la[^\\n]*Final status: closed below 4 at layer 3's closing read \\(every layer-3 seat sorted it may-leave\\)\\.`), 'shown as closed below 4 in the deliverable\'s sign-off block (the HANDOFF "Closed below 4" section needs config.handoff and is not driven here)');
  assert.ok(r.lines.some(l => l === `  final read: layer 3 closed 1 objection(s) rated below 4 (every layer-3 seat sorted them may-leave): ${TESTED}.`), `the closure line: ${r.lines.filter(l => /final read:/.test(l)).join(' | ')}`);
});

test('T21t: an open objection rated 5.0 that both layer-3 seats sort may-leave stays open on the record, sorted may-leave, with its rating unchanged: the sorting does not close it', async () => {
  const RATE = 5;
  const SORTS = ['may_leave', 'may_leave'];   // lc, ld on the objection
  const r = await closing({ rate: RATE, lc: SORTS[0], ld: SORTS[1] });
  premise(r);
  const e = entryOf(r, TESTED);
  assert.ok(e && !('closed_by' in e), 'T21t: open on the record, not closed by the sorting');
  assert.equal(e.severity, RATE, 'its rating is unchanged');
  assert.equal(sortedRowOf(r, TESTED)?.sort, 'may_leave', 'sorted may-leave, on the record');
  assert.deepEqual((r.result.severityRun?.open || []).map(x => x.id).sort(), [TESTED, BLOCKER_ID].sort(), 'open at the end in the severity record');
  assert.match(r.result.deliverable, /2 objection\(s\) were still open when this run stopped/, 'both are in the unresolved block');
});

test('T21v (the recorded and sorted half): an open objection of a lower seat rated 3.0 is recorded with its rating and sorted at the final read by both layer-3 seats', async () => {
  const RATE = 3;
  const SORTS = ['may_leave', 'may_leave'];   // lc, ld on the objection
  const r = await closing({ rate: RATE, lc: SORTS[0], ld: SORTS[1] });
  premise(r);
  const e = entryOf(r, TESTED);
  assert.equal(e?.severity, RATE, 'recorded, with its rating');
  assert.equal((sortedRowOf(r, TESTED)?.seats || []).length, 2, 'sorted at the final read by both layer-3 seats');
  const labels = r.result.stages.map(s => s.label);
  assert.ok(labels.includes('final-read-lc') && labels.includes('final-read-ld'), 'premise: both layer-3 seats were called at the final read');
});
