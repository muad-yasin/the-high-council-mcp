// 0.8.4 S17 (Q9(d), D33, N25, RT; FEATURE_SPECS l.1644 T21ak, l.1651 NEW-A4-1; C&C ruled 09 Nov, Q3): an objection that was EVER rated 7 or above and that a re-tag put below 4 is not closed by the final read, although every layer-3 seat sorts it may-leave: it stays OPEN on the record (the dispute list and severity.open_at_end), rated below 4.
// The fixture is the one of test/s17-closing-rows.test.js (the closure fixture of test/s8-closure.test.js, C3-21 is its 7+ twin) with the re-tags the PERSON'S handler gives (runChain's `retags`, applied at the top of a pass): the closure reads the re-tag rows from either source (layer 3 or the handler), so this is the wiring from the ledger to the closure.
// A re-tag by layer 3 itself needs a top-layer read before the final read, which this not-agreed end does not have, this is T21ak's SECOND row (the wiring to the closure with the handler's re-tag, C&C 09 Nov). T21ak's own row, with the layer-3 re-tag in the same run as the closure, is test/s17-layer3-retag.test.js (no green twin for its pass shape); the predicate with a layer-3 re-tag is also in test/s17-end-record.test.js, test 1. Offline, $0, held words injected. Written without a run; reds are swapped-input variants (S17_SWAPS.json).
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
const BLOCKER_ID = objectionId('la', BLOCKER);
const TESTED = idOf(1);
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', ...(sorting !== undefined ? { sorting } : {}) });
const bothMayLeave = () => [{ id: TESTED, sort: 'may_leave', reason: 'Minor wording.' }, { id: BLOCKER_ID, sort: 'may_leave', reason: 'Also minor.' }];
// rate: the rating la gives the objection under test; retags: what the handler re-tags it to, in order ([pass, value])
const closing = async ({ rate, retags }) => {
  setHeldForTest(SORTING);
  return await STOPPED(() => scenario({ answerBack: true, l1Severity: rate, extraFailures: [BLOCKER], critics: L3, overrides: { 'final-read-lc': metWith(bothMayLeave()), 'final-read-ld': metWith(bothMayLeave()) }, extra: { maxRounds: 1, dispute: { enabled: true } },
    runExtra: { roundChoices: FINISH, retags: retags.map(([pass, severity]) => ({ pass, id: TESTED, severity, reason: `to ${severity}` })), log: () => {} } }));
};
const premise = r => {
  assert.equal(r.result.passed, false, 'premise: the run ends not agreed (on the recorded finish)');
  assert.ok(r.result.finalRead && r.result.finalRead.ran === true, 'premise: the final read ran');
  assert.equal(r.result.dispute?.ran, true, 'premise: the dispute stage ran');
  assert.deepEqual((r.result.dispute.open_objections || []).map(o => o.id).sort(), [TESTED, BLOCKER_ID].sort(), 'premise: the dispute list holds both objections');
  const lc = r.result.finalRead.seats.find(e => e.lab === 'lc');
  assert.deepEqual((lc?.sorting || []).map(x => [x.id, x.sort]).sort(), [[BLOCKER_ID, 'may_leave'], [TESTED, 'may_leave']].sort(), 'premise: both ids reached the sort list and lc\'s rows were read');
};
const entryOf = (r, id) => r.result.dispute.open_objections.find(o => o.id === id);
const retagsOf = r => (r.result.severityRun?.retags || []).filter(x => x.id === TESTED).map(x => [x.pass, x.from, x.to, x.by]);

test('T21ak (SECOND row, the handler path; the row itself is test/s17-layer3-retag.test.js): an objection raised at 8.0 and re-tagged to 3.0, then sorted may-leave by both layer-3 seats at the final read, stays open on the record rated 3.0, shown as re-tagged and not closed: the final read does not close it', async () => {
  const RATE = 8;
  const r = await closing({ rate: RATE, retags: [[2, 3]] });
  premise(r);
  const e = entryOf(r, TESTED);
  assert.ok(e && !('closed_by' in e), 'T21ak: open on the record, not closed by the final read');
  assert.equal(e.severity, 3, 'rated 3.0 now');
  assert.deepEqual(retagsOf(r), [[2, RATE, 3, 'handler']], 'shown as re-tagged: old, new, who, pass');
  assert.deepEqual([(r.result.severityRun.open || []).some(o => o.id === TESTED), (r.result.severityRun.swept || []).some(o => o.id === TESTED)], [true, false], 'open_at_end, not swept (Q3)');
});

test('NEW-A4-1 (run): an objection raised at 5.0, re-tagged to 8.0 and then to 3.0, and sorted may-leave at the final read, stays open on the record: it was once rated 7 or above', async () => {
  const MIDDLE = 8;
  const r = await closing({ rate: 5, retags: [[2, MIDDLE], [3, 3]] });
  premise(r);
  const e = entryOf(r, TESTED);
  assert.ok(e && !('closed_by' in e), 'NEW-A4-1: open on the record, not closed by the sorting');
  assert.equal(e.severity, 3, 'rated 3.0 now');
  assert.deepEqual(retagsOf(r), [[2, 5, MIDDLE, 'handler'], [3, MIDDLE, 3, 'handler']], 'both re-tags are on the record, in order');
  assert.deepEqual([(r.result.severityRun.open || []).some(o => o.id === TESTED), (r.result.severityRun.swept || []).some(o => o.id === TESTED)], [true, false], 'open_at_end, not swept (Q3)');
});
