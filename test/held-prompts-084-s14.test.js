// 0.8.4 S14, the quote field: the batch block of test/held-prompts/held-084-s14.js (the pairing convention of test/held-prompts.test.js: held-084-<x>.js is owned by held-prompts-084-<x>.test.js). The step's wording is ONE held file (C&C's ruling R523), so it is
// one thing the owner approves or holds on its own at the release wording review. Recorded all together or not at all; every function has calls here; a recorded one renders exactly as drafted; no name is drafted in two batches. The plan's three sentences
// (W23, W24, W1's clause) are pinned word for word against the plan's text in test/anchor-wording.test.js; ownFailuresBlock is the one new text.
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

const CALLS_S14 = {
  criticQuoteFieldSentence: [[]],
  attachedQuoteLabel: [[]],
  layerReplyQuoteSentence: [[]],
  layerDebateOwnQuoteSentence: [[]],
  ownFailuresBlock: [[{ items: [{ id: 'O-aaaaaaaa', criterion: 'It states the assumptions it was written under.' }] }], [{ items: [{ id: 'O-aaaaaaaa', criterion: 'C1' }, { id: 'O-bbbbbbbb', criterion: 'C2' }] }], [{ items: [] }], [{}]],
};

test('the S14 batch of the 0.8.4 build (held-084-s14.js): recorded all together or not at all, a recorded one renders exactly as drafted, and no name is drafted in two batches', () => {
  const names = Object.keys(HS14).filter(n => typeof HS14[n] === 'function');
  assert.deepEqual(Object.keys(CALLS_S14).sort(), names.slice().sort(), 'every drafted S14 function has calls here: add one when you draft one');
  assert.deepEqual(names.filter(n => n in H083 || n in HNOTES || n in HDEC || n in HEARLY || n in HESC || n in H || n in HN || n in H084A || n in H084B || n in H084C), [], 'a name drafted in more than one batch');
  const recorded = names.filter(n => n in R);
  assert.ok(recorded.length === 0 || recorded.length === names.length, `a partial S14 re-record: ${recorded.join(', ')} are in src/roles.js, ${names.filter(n => !(n in R)).join(', ')} are not (the missing ones would be silently skipped)`);
  for (const name of recorded) for (const args of CALLS_S14[name]) assert.equal(R[name](...args), HS14[name](...args), `${name}: src/roles.js renders differently from test/held-prompts/held-084-s14.js`);
});

test('ownFailuresBlock: a heading, then one "- id: criterion" line per failure (never the "Objection O-..." or "Your objection O-..." line forms the exchange reads ids from)', () => {
  assert.equal(HS14.ownFailuresBlock({ items: [{ id: 'O-aaaaaaaa', criterion: 'C1' }, { id: 'O-bbbbbbbb', criterion: 'C2' }] }), 'Your own failures that quote nothing:\n- O-aaaaaaaa: C1\n- O-bbbbbbbb: C2');
  const text = HS14.ownFailuresBlock({ items: [{ id: 'O-aaaaaaaa', criterion: 'C1' }] });
  assert.doesNotMatch(text, /^Objection O-|^Your objection O-/m);
});
