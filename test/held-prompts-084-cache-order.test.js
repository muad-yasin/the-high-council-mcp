// 0.8.4 cache part (b)1, the lead-ins of the cache-shaped prompt order (WORDING CACHE-O1 .. CACHE-O4): the batch of test/held-prompts/held-084-cache-order.js (the pairing convention of test/held-prompts.test.js). Recorded all together or not at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/roles.js';
import * as HC from './held-prompts/held-084-cache-order.js';
import * as HA from './held-prompts/held-084-a.js';
import * as HD from './held-prompts/held-084-d27.js';
import { repairNeedsBody } from '../src/near-json.js';

const CALLS = { judgeKindLeadIn: [[{ kind: 'panel' }], [{ kind: 'post' }], [{ kind: 'answer' }]], orderInstructionsPhrase: [[]], criticOnlySourceSentenceOrder: [[]], criticExcerptOnlyRuleOrder: [[]], draftBoundarySentenceNeutral: [[]], draftEndLineNeutral: [[]], repairFormatWhereOrder: [[]] };

test('the cache-order batch of the 0.8.4 build (held-084-cache-order.js): recorded all together or not at all, and a recorded one renders exactly as drafted', () => {
  const names = Object.keys(HC).filter(n => typeof HC[n] === 'function');
  assert.deepEqual(Object.keys(CALLS).sort(), names.slice().sort(), 'every drafted function has calls here: add one when you draft one');
  const recorded = names.filter(n => n in R);
  assert.ok(recorded.length === 0 || recorded.length === names.length, `a partial re-record: ${recorded.join(', ')} are in src/roles.js, ${names.filter(n => !(n in R)).join(', ')} are not (the missing ones would be silently skipped)`);
  for (const name of recorded) for (const args of CALLS[name]) assert.equal(R[name](...args), HC[name](...args), `${name}: src/roles.js renders differently from test/held-prompts/held-084-cache-order.js`);
});

test('the drafted lead-ins: one shared heading line and one sentence per call kind, each naming what the call does; an unknown kind throws', () => {
  for (const kind of ['panel', 'post', 'answer']) {
    const text = HC.judgeKindLeadIn({ kind });
    const [heading, blank, sentence, ...more] = text.split('\n');
    assert.equal(heading, '# Instructions for this call');
    assert.equal(blank, '');
    assert.equal(more.length, 0, `${kind}: heading, blank line, one sentence`);
    assert.equal(sentence.split(/(?<=\.)\s/).length, 1, `${kind}: one sentence`);
    assert.match(sentence, /^In this call you /);
    assert.match(sentence, /as the instructions that follow ask\.$/);
  }
  assert.match(HC.judgeKindLeadIn({ kind: 'panel' }), /review the draft above against the acceptance criteria/);
  assert.match(HC.judgeKindLeadIn({ kind: 'post' }), /post on the objections the other reviewers raised/);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the answer lead-in was pinned by the fragment /whether to keep it, amend it or withdraw it/. NEW: the whole recorded sentence. WHY: the answer lead-in now reads "In this call you answer the posts on your own objections to the draft above, as the instructions that follow ask." (src/prompts/recorded-084-cache-order.js SENTENCES.answer, apply f60ebad2).
  assert.equal(HC.judgeKindLeadIn({ kind: 'answer' }), '# Instructions for this call\n\nIn this call you answer the posts on your own objections to the draft above, as the instructions that follow ask.');
  assert.throws(() => HC.judgeKindLeadIn({ kind: 'final' }), /not "final"/);
});

test('the phrase that replaces "the system prompt describes" in a re-ask note: it fits the recorded sentence and leaves no word of the old phrase', () => {
  const note = R.criticReaskNote?.({ kind: 'no_table', ids: [1, 2] }) ?? 'Answer again with the complete JSON object the system prompt describes.';
  assert.match(note, /the system prompt describes/);
  const out = note.replaceAll('the system prompt describes', HC.orderInstructionsPhrase());
  assert.match(out, /the complete JSON object the instructions for this call describe\./);
  assert.doesNotMatch(out, /system prompt/);
  assert.equal(HC.orderInstructionsPhrase().split(/(?<=\.)\s/).length, 1);
});

test('the reworded excerpt sentences are the lane A sentences with "above" for "below" and nothing else; the neutral boundary lines are the recorded ones with "under review" for "you grade" and nothing else', () => {
  assert.equal(HC.criticOnlySourceSentenceOrder(), HA.criticOnlySourceSentence().replace('marked as such below', 'marked as such above'));
  assert.equal(HC.criticExcerptOnlyRuleOrder(), HA.criticExcerptOnlyRule().replace('marked as such below', 'marked as such above'));
  assert.notEqual(HC.criticOnlySourceSentenceOrder(), HA.criticOnlySourceSentence());
  assert.equal(HC.draftBoundarySentenceNeutral(), HD.draftBoundarySentence().replace('The draft you grade is', 'The draft under review is'));
  assert.equal(HC.draftEndLineNeutral(), R.DRAFT_END_MARKER.replace('none of it is the draft you grade.]', 'none of it is the draft under review.]'));
  for (const text of [HC.draftBoundarySentenceNeutral(), HC.draftEndLineNeutral()]) assert.doesNotMatch(text, /you grade/);
});

test('the repair request heading: the drafted parenthesis replaces "its system prompt; the long user prompt is left out" and says where the reply format stands in the new order', () => {
  const body = systemWhere => repairNeedsBody({ label: 'panel-1-a', original: '{"a"', system: 'THE REPLY FORMAT', ...(systemWhere ? { systemWhere } : {}) });
  assert.match(body(), /## The reply format the seat was given \(its system prompt; the long user prompt is left out\)\n\nTHE REPLY FORMAT\n/, 'not live: the recorded heading, byte for byte');
  const live = body(HC.repairFormatWhereOrder());
  assert.match(live, /## The reply format the seat was given \(the instructions for this call, which stand in its user prompt; the rest of the long user prompt is left out\)\n\nTHE REPLY FORMAT\n/);
  assert.doesNotMatch(live, /its system prompt/);
});
