// 0.8.3 M7 apply, C2b-2 (6d's owed row 1): an ADOPTED owner that SPLIT and holds an agreement between its children. Real record (test/helpers/adoption-fixture.js `agreement`): R/M1/A@g1 is adopted into the slot R/M1/B of R/M1@g2; its plan (block3) names the agreement A1 from K1 (R/M1/A/M1) to K2 (R/M1/A/M2), both finished.
// The ends of the agreement are PLACES: R/M1/B/M1 and R/M1/B/M2 (the children sit under the slot the owner fills), while the NEW plan's R/M1/A@g2 stays live beside it on the old path (it has no children here).
// Expected values, written before the first run: resolveCheckTarget('R/M1/A@g1:A1') -> from 'R/M1/B/M1', to 'R/M1/B/M2'; checkPlan is NOT refused with "is now generation" (tree-check.js:142, isSupersededGeneration is lineage-aware) nor with "is not registered in the tree" (the live map by PLACE);
// the stop view of a needs_decision stop on A@g1 shows the entry of the SLOT (B), so it PROVIDES the agreement X1 to R/M1/C (tree-stop-view.js :61); on the old path's entry (A) it would show no agreement at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { affectedFor } from '../src/tree-affected.js';
import { placeOf } from '../src/tree-transitions.js';
import { checkPlan, resolveCheckTarget } from '../src/tree-check.js';
import { needsDecisionStopText } from '../src/tree-stop-view.js';
import { adoptedTree } from './helpers/adoption-fixture.js';

const AGREEMENT = 'R/M1/A@g1:A1';
const read = t => { const record = readTreeRecord(t.rootDir); return { record, state: stateOf(record) }; };

test('C2b-2: the children of an adopted owner sit at the PLACES under its slot, and the agreement\'s ends are those places', () => {
  const { t } = adoptedTree({ agreement: true });
  const { record, state } = read(t);
  assert.equal(placeOf(state, state.nodes.get('R/M1/A/M1@g1')), 'R/M1/B/M1');
  assert.equal(placeOf(state, state.nodes.get('R/M1/A/M2@g1')), 'R/M1/B/M2');
  const res = resolveCheckTarget(record, state, t.runsDir, AGREEMENT);
  assert.equal(res.refusal, undefined, res.refusal);
  assert.deepEqual([res.target.from, res.target.to], ['R/M1/B/M1', 'R/M1/B/M2'], 'tree-check.js:68 - agreementEndsOf gets the owner\'s PLACE (known-bad: the owner\'s path gives R/M1/A/M1 and R/M1/A/M2)');
});

test('C2b-2: checking the adopted owner\'s agreement is not refused as "superseded" (the owner is live beside the new R/M1/A@g2) nor as "not registered" (the live map is by place)', () => {
  const { t } = adoptedTree({ agreement: true });
  const r = checkPlan({ rootDir: t.rootDir, work: t.work, arg: AGREEMENT, result: 'pass' });
  const why = r.refusal ?? '';
  assert.doesNotMatch(why, /is now generation/, 'tree-check.js:142 - isSupersededGeneration is lineage-aware (known-bad: the path\'s newest generation says the owner is old)');
  assert.doesNotMatch(why, /is not registered in the tree/, 'the live map is keyed by place (known-bad: keyed by path, the second node of R/M1/A overwrites the first and the slot\'s children are not there)');
});

test('C2b-2: the stop view of a stop on the adopted owner shows the entry of its SLOT, with the agreement the adopting plan names for it', () => {
  const { t } = adoptedTree({ agreement: true });
  const { record, state } = read(t);
  const { affected } = affectedFor({ record, state, runsDir: t.runsDir, node: 'R/M1/A', generation: 1 });       // the real closure, as the verb records it
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1/A', generation: 1, runId: '2026-10-08T11-11-00-000Z', source: 'status', affected });
  const text = needsDecisionStopText(t.rootDir, stop);
  assert.match(text, /Agreements it provides:\n  - X1 to R\/M1\/C: B feeds C\./, 'tree-stop-view.js :61 - the entry of the SLOT B (known-bad: the owner\'s own path gives the entry of A, which provides nothing)');
  assert.match(text, /R\/M1\/A\/M1 \(finished, now stale\): it sits below R\/M1\/B/, 'the closure is by place: the owner\'s children sit below the SLOT');
  assert.match(text, /Independent work that can still run: \(none\)/, 'tree-stop-view.js :73 - the real closure holds the consumer R/M1/C (it depends on the slot) and the closed new node R/M1/A@g2 is not unfinished work, so nothing is independent (a value, not isolated by a red run)');
});
