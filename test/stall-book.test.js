// 0.8.4 S5 (Q13, RU-S5-03/05, R9; T7a-T7d, T7f, T12l, T20l): the PER-OBJECTION stall count, as a pure file (src/stall-book.js): no run, no model, no clock.
//   SB1  T7a/T7c core: the same id and quote for w verdicts reach the window at w and not at w - 1; the problem text is not an input (the entry has no field for it)
//   SB2  T7b: an unrelated objection added in pass 2 does not restart the first one's count (the whole-signature rule did)
//   SB3  T7d: a changed writer response restarts the count at 1
//   SB4  T7f: a different normalised quoted passage under the SAME id restarts the count at 1 (then counts on)
//   SB5  T12l: an adopted copy (another seat, another id) starts at 1 whatever the original had
//   SB6  R9: a seat that was not heard in a pass (a lower layer objected, so it was not asked) neither counts nor ends its objection: layer 2 reaches the window across a pass it sat out
//   SB7  R9: a seat that WAS heard and no longer raises the id ends it; a later raise starts at 1; a non-adjacent pair of verdicts is not a run
//   SB8  R9: standing objections of a seat that was not heard (a carried verdict) are ignored by the book itself
//   SB9  RU-S5-05 / Q13: a new overseer round restarts the counts BELOW the top layer and keeps the top layer's
//   SB10 T20l: a sent-up id is not reached again in the same overseer round; it is reached again after a new overseer round when its count was kept
//   SB11 reset() (the person's send-up keeps its fresh window) and the constructor guard
//   SB12 Q-i: the escalation lasts one pass for a stall only (one switch for T4c)
//   SB14 U-C: restart(items) forgets the counts of the objections that stalled (a continue at a top-layer stall) and nothing else
//   SB13 R9, every verdict shape: which verdicts count as heard (a stated pass is heard; abstained, unreachable and carried are not)
// RED BASE 6805be01: src/stall-book.js does not exist there, so this whole file is ONE load error (ERR_MODULE_NOT_FOUND), as test/stale-guard.test.js is for T14.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStallBook, escalationLastsOnePass, heardSeats } from '../src/stall-book.js';

const S = (id, lab, layer, quoteKey = 'retries failed requests', extra = {}) => ({ id, lab, layer, quoteKey, present: true, response: 'unchanged', ...extra });

test('SB1 the same id and quote for w verdicts reach the window at w, not at w - 1; the problem text is not an input', () => {
  const b = createStallBook({ window: 3, topLayer: 3 });
  b.note(1, ['a'], [S('O-1', 'a', 1)]); b.note(2, ['a'], [S('O-1', 'a', 1)]);
  assert.deepEqual(b.reached(), [], 'two verdicts: not yet (w - 1)');
  b.note(3, ['a'], [S('O-1', 'a', 1)]);
  assert.deepEqual(b.reached().map(r => [r.id, r.count, r.passes]), [['O-1', 3, [1, 2, 3]]]);
  assert.ok(!Object.keys(b.snapshot()[0]).some(k => /problem|text|reason/i.test(k)), 'the entry holds no problem text and no writer reason');
});

test('SB2 T7b: an unrelated objection added in pass 2 does not restart the first one\'s count', () => {
  const b = createStallBook({ window: 2, topLayer: 3 });
  b.note(1, ['a'], [S('O-X', 'a', 1)]);
  b.note(2, ['a'], [S('O-X', 'a', 1), S('O-Y', 'a', 1, 'the worker')]);
  assert.deepEqual(b.reached().map(r => r.id), ['O-X'], 'X reached 2; the new Y is at 1');
});

test('SB3 T7d: a writer response that changed the passage restarts the count at 1', () => {
  const b = createStallBook({ window: 2, topLayer: 3 });
  b.note(1, ['a'], [S('O-1', 'a', 1)]);
  b.note(2, ['a'], [S('O-1', 'a', 1, 'retries failed requests', { response: 'changed', present: false })]);
  assert.deepEqual(b.reached(), []);
  assert.equal(b.snapshot()[0].count, 1);
  b.note(3, ['a'], [S('O-1', 'a', 1, 'retries failed requests', { present: false })]);
  assert.deepEqual(b.reached().map(r => r.count), [2], 'counting on from the restart');
});

test('SB4 T7f: a different normalised quoted passage under the same id restarts the count at 1, then counts on', () => {
  const b = createStallBook({ window: 2, topLayer: 3 });
  b.note(1, ['a'], [S('O-1', 'a', 1, 'passage one')]);
  b.note(2, ['a'], [S('O-1', 'a', 1, 'passage two')]);
  assert.deepEqual(b.reached(), [], 'the amendment carries another passage: restarted');
  b.note(3, ['a'], [S('O-1', 'a', 1, 'passage two')]);
  assert.deepEqual(b.reached().map(r => [r.id, r.count]), [['O-1', 2]]);
});

test('SB5 T12l: the adopted copy (another seat, another id) starts at 1 whatever the original had', () => {
  const b = createStallBook({ window: 3, topLayer: 3 });
  for (let p = 1; p <= 3; p++) b.note(p, ['a'], [S('O-a', 'a', 1)]);
  b.note(4, ['a', 'b'], [S('O-b', 'b', 2)]);   // layer 2 adopts it under its own id
  assert.deepEqual(b.snapshot().filter(e => e.lab === 'b').map(e => e.count), [1]);
});

test('SB6 R9: a seat that was not heard in a pass neither counts nor ends its objection (layer 2 sits out the pass in between)', () => {
  const b = createStallBook({ window: 2, topLayer: 3 });
  b.note(1, ['l1', 'l2'], [S('O-y', 'l2', 2, 'the worker')]);         // layer 1 signed off, layer 2 objected
  b.note(2, ['l1'], [S('O-z', 'l1', 1, 'section two')]);              // layer 1 objected: layer 2 was NOT asked
  assert.equal(b.snapshot().find(e => e.lab === 'l2').count, 1, 'untouched by the pass it sat out');
  b.note(3, ['l1', 'l2'], [S('O-y', 'l2', 2, 'the worker')]);
  assert.deepEqual(b.reached().map(r => [r.id, r.count, r.passes]), [['O-y', 2, [1, 3]]], 'two VERDICTS of layer 2, passes 1 and 3');
});

test('SB7 R9: a seat that was heard and no longer raises the id ends it; a later raise starts at 1; a gap in its own verdicts is not a run', () => {
  const b = createStallBook({ window: 2, topLayer: 3 });
  b.note(1, ['a'], [S('O-1', 'a', 1)]);
  b.note(2, ['a'], []);                       // heard, raises nothing: withdrawn
  assert.deepEqual(b.snapshot(), []);
  b.note(3, ['a'], [S('O-1', 'a', 1)]);
  assert.deepEqual(b.reached(), [], 'starts at 1 again');
  const c = createStallBook({ window: 2, topLayer: 3 });
  c.note(1, ['a'], [S('O-1', 'a', 1)]);
  c.note(2, ['a'], [S('O-2', 'a', 1, 'other')]);   // heard, raised another id: O-1 ended
  c.note(3, ['a'], [S('O-1', 'a', 1)]);
  assert.deepEqual(c.reached(), []);
});

test('SB8 R9: objections listed for a seat that was not heard with a new verdict (a carried verdict of a no-revise re-ask) are ignored', () => {
  const b = createStallBook({ window: 2, topLayer: 3 });
  b.note(1, ['a'], [S('O-1', 'a', 1)]);
  b.note(2, [], [S('O-1', 'a', 1)]);          // a carried copy: nobody was heard
  assert.equal(b.snapshot()[0].count, 1, 'a carried copy adds nothing');
  b.note(3, ['a'], [S('O-1', 'a', 1)]);
  assert.equal(b.snapshot()[0].count, 2);
});

test('SB9 RU-S5-05 / Q13: a new overseer round restarts the counts below the top layer and keeps the top layer\'s', () => {
  const b = createStallBook({ window: 3, topLayer: 3 });
  for (let p = 1; p <= 2; p++) b.note(p, ['l1', 'l2', 'l3'], [S('O-1', 'l1', 1), S('O-2', 'l2', 2), S('O-3', 'l3', 3)]);
  b.newOverseerRound();
  assert.deepEqual(b.snapshot().map(e => [e.id, e.count]), [['O-3', 2]], 'only the top layer\'s count survives');
  b.note(3, ['l3'], [S('O-3', 'l3', 3)]);
  assert.deepEqual(b.reached().map(r => [r.id, r.count]), [['O-3', 3]], 'the top layer reaches w across the round change (NEW-A8-1)');
});

test('SB10 T20l: a sent-up id is not reached again in the same overseer round; it is reached again after a new overseer round when its count was kept', () => {
  const b = createStallBook({ window: 2, topLayer: 3 });
  b.note(1, ['l3'], [S('O-3', 'l3', 3)]); b.note(2, ['l3'], [S('O-3', 'l3', 3)]);
  const first = b.reached();
  assert.deepEqual(first.map(r => r.id), ['O-3']);
  b.markSentUp(first);
  b.note(3, ['l3'], [S('O-3', 'l3', 3)]);
  assert.deepEqual(b.reached(), [], 'sent up already in this overseer round');
  assert.deepEqual(b.heldBack(), ['O-3']);
  b.newOverseerRound();
  assert.deepEqual(b.reached().map(r => r.id), ['O-3']);
});

test('SB11 reset() forgets every count (the person\'s send-up keeps its fresh window); the constructor refuses a window below 1', () => {
  const b = createStallBook({ window: 2, topLayer: 3 });
  b.note(1, ['a'], [S('O-1', 'a', 1)]); b.note(2, ['a'], [S('O-1', 'a', 1)]);
  b.markSentUp(b.reached()); b.reset();
  assert.deepEqual(b.snapshot(), []); assert.deepEqual(b.reached(), []);
  assert.throws(() => createStallBook({ window: 0 }), RangeError);
});

test('SB12 Q-i: the escalation lasts one pass for a stall only, so T4c can turn it on for the send-up with one switch', () => {
  assert.equal(escalationLastsOnePass('stall'), true);
  assert.equal(escalationLastsOnePass('send_up'), false);
});

test('SB13 R9, every verdict shape: a critique, a STATED PASS (critique null, passed true, with or without its own held objections) and a decidedOnly verdict are heard; an abstained, an unreachable and a carried verdict are not', () => {
  const seat = k => ({ key: k });
  const verdicts = [
    { seat: seat('objects'), critique: { meets: false, failures: [{}] } },
    { seat: seat('signs'), critique: { meets: true, failures: [] } },
    { seat: seat('passes-with-own'), critique: null, passed: true, openOwn: [{ id: 'O-1' }] },
    { seat: seat('passes-plain'), critique: null, passed: true },
    { seat: seat('decided-only'), critique: { meets: false, failures: [] }, decidedOnly: true },
    { seat: seat('abstained'), critique: null, abstained: true, reasonCode: 'UNANSWERED_OBJECTIONS' },
    { seat: seat('unreachable'), critique: null, abstained: true, reasonCode: 'SEAT_UNREACHABLE' },
    { seat: seat('carried'), critique: { meets: false, failures: [{}] }, carried: true },
    { seat: seat('carried-pass'), critique: null, passed: true, carried: true },
  ];
  const keyOf = v => v.seat.key;
  assert.deepEqual(heardSeats(verdicts, keyOf), ['objects', 'signs', 'passes-with-own', 'passes-plain', 'decided-only']);
  // a stated pass that holds an objection of its own keeps counting it: its seat is heard in the pass
  const b = createStallBook({ window: 2, topLayer: 3 });
  b.note(1, heardSeats([verdicts[2]], keyOf), [S('O-1', 'passes-with-own', 1)]);
  b.note(2, heardSeats([verdicts[2]], keyOf), [S('O-1', 'passes-with-own', 1)]);
  assert.deepEqual(b.reached().map(r => [r.id, r.count]), [['O-1', 2]]);
});

test('SB14 U-C: restart(items) forgets the counts of the objections that stalled and nothing else; they count afresh from 1', () => {
  const b = createStallBook({ window: 2, topLayer: 3 });
  b.note(1, ['l3'], [S('O-3', 'l3', 3), S('O-4', 'l3', 3, 'the worker')]); b.note(2, ['l3'], [S('O-3', 'l3', 3), S('O-4', 'l3', 3, 'the worker')]);
  const stalled = b.reached().filter(r => r.id === 'O-3');
  assert.deepEqual(stalled.map(r => r.id), ['O-3']);
  b.restart(stalled);
  assert.deepEqual(b.snapshot().map(e => [e.id, e.count]), [['O-4', 2]], 'only O-3 was forgotten');
  b.note(3, ['l3'], [S('O-3', 'l3', 3), S('O-4', 'l3', 3, 'the worker')]);
  assert.deepEqual(b.snapshot().map(e => [e.id, e.count]).sort(), [['O-3', 1], ['O-4', 3]].sort(), 'O-3 counts afresh from 1');
});
