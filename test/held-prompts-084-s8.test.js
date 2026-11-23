// 0.8.4 S8, the sorting: the batch block of test/held-prompts/held-084-s8.js (the pairing convention of test/held-prompts.test.js: held-084-<x>.js is owned by held-prompts-084-<x>.test.js). The step's wording is its own held file (C&C's ruling,
// the S14 precedent): W7 (the plan's sentence) and the reply form (the builder's words). Recorded all together or not at all; every function has calls here; a recorded one renders exactly as drafted; no name is drafted in two batches.
// W7 is pinned WORD FOR WORD below as a literal; that the literal IS the plan's text (review-b3/B3-plan-final.md l.284, equal to FEATURE_SPECS) was compared by script when it was written.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/roles.js';
import * as H from './held-prompts/held.js';
import * as HN from './held-prompts/held-next.js';
import * as H083 from './held-prompts/held-083.js';
import * as HNOTES from './held-prompts/held-083-notes.js';
import * as HDEC from './held-prompts/held-083-decider.js';
import * as HEARLY from './held-prompts/held-083-early.js';
import * as HESC from './held-prompts/held-escalation.js';
import * as H084A from './held-prompts/held-084-a.js';
import * as H084B from './held-prompts/held-084-b.js';
import * as H084C from './held-prompts/held-084-c.js';
import * as HS14 from './held-prompts/held-084-s14.js';
import * as HS8 from './held-prompts/held-084-s8.js';

const CALLS_S8 = {
  layerThreeSortingRule: [[]], layerThreeSortingForm: [[]],
  layerThreeSortingItems: [[{ items: [{ id: 'O-aaaaaaaa', kind: 'objection', layer: 1, rating: 5, flags: ['not debated'], problem: 'No retry limit is stated.' }, { id: 'L-bbbbbbbb', kind: 'late finding', rating: null, flags: [], problem: 'No back-off.' }] }], [{ items: [{ id: 'O-cccccccc', kind: 'objection', layer: null, rating: null, flags: [], problem: 'x' }] }], [{ items: [] }], [{}]],
};
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: W7 read `... a Decisions entry chooses (W8); a fix of wording goes to the writer ...`. NEW: `... chooses; a fix of wording ...` (K5). WHY: layerThreeSortingRule as applied (recorded-084-s8.js, held-084-s8.js): the reviewed text drops the `(W8)` reference.
const W7 = 'State your verdict (at a closing read, state your position on the plan: it is not a verdict that ends an overseer round). Then sort each open objection and each late finding as must-do or may-leave for the build and give your reason for each sorting. A must-do cites the objection\'s id and a criterion or a decision of the plan; without them it is still a must-do and is flagged ungrounded. A late finding sorted must-do states in its reason that its defect holds and why. A failure marked unanchored (it has no quote) is not sorted must-do as an objection: if you hold that its defect must be done, say so, and it is recorded as a late finding. For each must-do, name the route that would repair it: the writer, or the proposers only if fixing the objection would change which option a Decisions entry chooses; a fix of wording goes to the writer. At a closing read, if you find a new material defect that no open objection names, add it as a must-do item of its own, with the passage and the criterion.';

test('the S8 batch of the 0.8.4 build (held-084-s8.js): recorded all together or not at all, a recorded one renders exactly as drafted, and no name is drafted in two batches', () => {
  const names = Object.keys(HS8).filter(n => typeof HS8[n] === 'function');
  assert.deepEqual(Object.keys(CALLS_S8).sort(), names.slice().sort(), 'every drafted S8 function has calls here: add one when you draft one');
  assert.deepEqual(names.filter(n => n in H083 || n in HNOTES || n in HDEC || n in HEARLY || n in HESC || n in H || n in HN || n in H084A || n in H084B || n in H084C || n in HS14), [], 'a name drafted in more than one batch');
  const recorded = names.filter(n => n in R);
  assert.ok(recorded.length === 0 || recorded.length === names.length, `a partial S8 re-record: ${recorded.join(', ')} are in src/roles.js, ${names.filter(n => !(n in R)).join(', ')} are not (the missing ones would be silently skipped)`);
  for (const name of recorded) for (const args of CALLS_S8[name]) assert.equal(R[name](...args), HS8[name](...args), `${name}: src/roles.js renders differently from test/held-prompts/held-084-s8.js`);
});

test('W7 (layerThreeSortingRule) is the plan\'s sentence word for word', () => {
  assert.equal(HS8.layerThreeSortingRule(), W7);
});
