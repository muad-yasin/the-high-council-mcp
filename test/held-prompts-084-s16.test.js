// 0.8.4 S16, the part sentence of the final read (W42): the batch block of test/held-prompts/held-084-s16.js (the pairing convention of test/held-prompts.test.js). Recorded all together or not at all; every function has calls here; a recorded one renders exactly as drafted; no name is drafted in two batches.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/roles.js';
import * as HS16 from './held-prompts/held-084-s16.js';
import * as H084A from './held-prompts/held-084-a.js';
import * as H084B from './held-prompts/held-084-b.js';
import * as H084C from './held-prompts/held-084-c.js';
import * as HS8 from './held-prompts/held-084-s8.js';
import * as HS9 from './held-prompts/held-084-s9.js';
import * as HS14 from './held-prompts/held-084-s14.js';
import * as H from './held-prompts/held.js';
import * as HN from './held-prompts/held-next.js';
import * as H083 from './held-prompts/held-083.js';
import * as HNOTES from './held-prompts/held-083-notes.js';
import * as HDEC from './held-prompts/held-083-decider.js';
import * as HEARLY from './held-prompts/held-083-early.js';
import * as HESC from './held-prompts/held-escalation.js';
import * as HLO from './held-prompts/held-084-ledger-out.js';

const CALLS_S16 = { finalReadPartRule: [[{ n: 2, k: 1 }], [{ n: 3, k: 2 }]], finalReadRule: [[{ read: false }], [{ read: true }], [{}]], finalReadSortingForm: [[]], lateFindingRatingSentence: [[]],
  finalReadSortingItems: [[{ items: [{ id: 'O-aaaaaaaa', kind: 'objection', layer: 1, rating: 5, flags: [], problem: 'P.', isNew: true }, { id: 'L-bbbbbbbb', kind: 'late finding', rating: null, flags: ['named_in_sorting'], problem: 'Q.', prior: { sort: 'must_do', reason: 'Because.' } }] }], [{ items: [] }], [{}]] };

test('the S16 batch of the 0.8.4 build (held-084-s16.js): recorded all together or not at all, a recorded one renders exactly as drafted, and no name is drafted in two batches', () => {
  const names = Object.keys(HS16).filter(n => typeof HS16[n] === 'function');
  assert.deepEqual(Object.keys(CALLS_S16).sort(), names.slice().sort(), 'every drafted S16 function has calls here: add one when you draft one');
  assert.deepEqual(names.filter(n => n in H084A || n in H084B || n in H084C || n in HS8 || n in HS9 || n in HS14 || n in H || n in HN || n in H083 || n in HNOTES || n in HDEC || n in HEARLY || n in HESC || n in HLO), [], 'a name drafted in more than one batch');
  const recorded = names.filter(n => n in R);
  assert.ok(recorded.length === 0 || recorded.length === names.length, `a partial S16 re-record: ${recorded.join(', ')} are in src/roles.js, ${names.filter(n => !(n in R)).join(', ')} are not (the missing ones would be silently skipped)`);
  for (const name of recorded) for (const args of CALLS_S16[name]) assert.equal(R[name](...args), HS16[name](...args), `${name}: src/roles.js renders differently from test/held-prompts/held-084-s16.js`);
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'in 2 parts, in the order of their ratings, and this is part 1.' NEW: 'in 2 parts, from the highest rating down (unrated ones first), and this is part 1.' WHY: finalReadPartRule (src/prompts/recorded-084-s16.js), the resolved text of the row (RESOLVED_LIST).
test('finalReadPartRule is the plan\'s W42 word for word, with the part counts put in', () => {
  assert.equal(HS16.finalReadPartRule({ n: 2, k: 1 }), 'The open objections of this plan are read in 2 parts, from the highest rating down (unrated ones first), and this is part 1. Sort each objection shown in this part into must-do or may-leave, with your reason; the other parts are read in their own calls. In part 1 you also give your verdict and any late finding as in an ordinary final read; in every later part you sign nothing, raise nothing and record no late finding.');
});

test('finalReadRule is the plan\'s W31: the clause that is true for the seat, then the plan\'s words (a quoted passage and a rating for an objection, no exchange follows, the sorting, the late finding with a rating, the concern)', () => {
  const unread = HS16.finalReadRule({ read: false }); const read = HS16.finalReadRule({ read: true });
  assert.match(unread, /^This is the final text of the run\. You have not read exactly this text before\. Below are the open objections and the late findings, /);
  assert.match(read, /^This is the final text of the run\. You read exactly this text before, and the objections and late findings marked new below were opened after your last sorting; read the plan again, and sort every open objection and late finding\. Below are /);
  for (const t of [unread, read]) {
    // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'an objection rated 4 or above holds your sign-off, one rated below 4 is recorded and does not.' NEW: 'An objection rated 4 or above holds your sign-off; one rated below 4 is recorded and does not.' WHY: finalReadRule (src/prompts/recorded-084-s16.js), the resolved text of the row (RESOLVED_LIST).
    assert.match(t, /An objection rated 4 or above holds your sign-off; one rated below 4 is recorded and does not\. No exchange follows this read, so an objection must carry its quote\./);
    assert.match(t, /If you find a defect for which you cannot quote a passage, write it as a late finding with its criterion, what is absent and where, and a rating from 1 to 10;/);
    assert.match(t, /write it in the field concern, without a rating;/);
    assert.doesNotMatch(t, /\[If you|The tool prints/);
  }
});

test('finalReadSortingItems: S8\'s line with "marked new" and "you sorted it before", the earlier reason beneath; an empty list prints nothing', () => {
  const out = HS16.finalReadSortingItems({ items: [{ id: 'O-aaaaaaaa', kind: 'objection', layer: 1, rating: 5, flags: [], problem: 'P.', isNew: true }, { id: 'L-bbbbbbbb', kind: 'late finding', rating: null, flags: [], problem: 'Q.', prior: { sort: 'may_leave', reason: 'Minor.' } }] });
  assert.equal(out, 'The open objections and late findings to sort, with the id your sorting must use for each:\n- O-aaaaaaaa (raised in layer 1; rated 5.0; marked new): <critic-claim>P.</critic-claim>\n- L-bbbbbbbb (late finding; not rated, read as 4 or above; you sorted it before: may-leave): <critic-claim>Q.</critic-claim>\n  Your earlier reason: <critic-claim>Minor.</critic-claim>');
  assert.equal(HS16.finalReadSortingItems({ items: [] }), '');
});
