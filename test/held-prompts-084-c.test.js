// The 0.8.4 personas, lane C: the batch block of test/held-prompts/held-084-c.js, MOVED here from test/held-prompts.test.js (the held-prompts split, 4 Nov 2026), byte for byte. The pairing convention: a lane's
// held file test/held-prompts/held-084-<x>.js is owned by test/held-prompts-084-<x>.test.js; test/held-prompts.test.js keeps the seven 0.8.3 files' blocks and checks the pairing and the duplicates for every held file.
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
import * as H084C from './held-prompts/held-084-c.js';

// Lane C of the 0.8.4 build (test/held-prompts/held-084-c.js): the drafted seat-title sentence, recorded all together or not at all at the one re-record after the release wording review, rendering exactly as drafted
// for every job. src/stage-system.js seatPersonaText asks for it through held('seatTitleBlock'). stageInstructionsBlock (D8, the dispatch bundle's instruction part) rides in the same batch: src/stage-instructions.js asks for it through held('stageInstructionsBlock').
const CALLS_084C = {
  seatTitleBlock: [{ name: 'Noah', job: 'judge' }, { name: 'Noah', job: 'propose' }, { name: 'Noah', job: 'debate' }, { name: 'Noah', job: 'reply' }].map(a => [a]),
  seatVoiceBlock: [{ name: 'Noah', job: 'judge' }, { name: 'Noah', job: 'propose' }, { name: 'Noah', job: 'debate' }, { name: 'Noah', job: 'reply' }, { name: 'Nobody-In-The-Table', job: 'judge' }, { name: 'nOaH', job: 'reply' }].map(a => [a]),
  stageInstructionsBlock: [[{ system: 'You write the plan.' }], [{ system: 'Line one.\nLine two.' }]],
};

test('the lane C batch of the 0.8.4 build (held-084-c.js): recorded all together or not at all, a recorded one renders exactly as drafted, no name is drafted in two batches, and the file name is not a src/prompts file', () => {
  const names = Object.keys(H084C).filter(n => typeof H084C[n] === 'function');   // the drafted functions (SEAT_VOICE_LINES is the table the voice function reads)
  assert.deepEqual(Object.keys(CALLS_084C).sort(), names.slice().sort(), 'every drafted lane C function has calls here: add one when you draft one');
  assert.deepEqual(names.filter(n => n in H083 || n in HNOTES || n in HDEC || n in HEARLY || n in HESC || n in H || n in HN), [], 'a name drafted in more than one batch');
  const recorded = names.filter(n => n in R);
  assert.ok(recorded.length === 0 || recorded.length === names.length, `a partial lane C re-record: ${recorded.join(', ')} are in src/roles.js, ${names.filter(n => !(n in R)).join(', ')} are not (the missing ones would be silently skipped)`);
  for (const name of recorded) for (const args of CALLS_084C[name]) assert.equal(R[name](...args), H084C[name](...args), `${name}: src/roles.js renders differently from test/held-prompts/held-084-c.js`);
  assert.throws(() => H084C.seatTitleBlock({ name: 'Noah', job: 'nobody' }), /not "nobody"|"nobody"/, 'an unknown job is an error');
  assert.throws(() => H084C.seatVoiceBlock({ name: 'Noah', job: 'nobody' }), /"nobody"/, 'an unknown job is an error for the voice too');
});
