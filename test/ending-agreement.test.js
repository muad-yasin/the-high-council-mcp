// 0.8.4 D1 (UNIT 3, C&C's condition: "one word for every run; where the others exist they agree"): the ending word, S4's `ending` and `final_read.run_end` answer ONE question the same way, agreed or not agreed.
// The matrix's agreed reading (`agreedOf`) is `isAgreed` for a row that can be agreed and false for a row that never can; the cross-product below pins both, and that `never` is really never for the reports the chain can write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENDING_MATRIX, ENDING_WORDS, agreedOf } from '../src/ending-matrix.js';
import { isAgreed, endsNotAgreed } from '../src/ending.js';
import { finalReadBlocksAgreement } from '../src/final-read.js';

const ENDINGS = { none: undefined, agreed: { kind: 'agreed', basis: ['layer_3_sign_off'], handler_check: 'good_to_build', signed_sha: 'a'.repeat(12) }, not_agreed: { kind: 'signed_off_at_top_not_agreed', basis: ['layer_3_sign_off', 'handler_not_yet'], handler_check: 'not_yet', signed_sha: 'a'.repeat(12) } };
const READS = { none: undefined, clear: { ran: true, run_end: 'agreed', seats: [{ read: true, meets: true }] }, blocks: { ran: true, run_end: 'agreed', seats: [{ read: true, meets: false }] }, not_run: { ran: false, reason: 'every_top_seat_read_this_plan', run_end: 'not_agreed' } };
const report = (word, passed, ending, read) => ({ ending_word: word, passed, ...(ending ? { ending } : {}), ...(read ? { final_read: read } : {}) });

test('A1 the agreed reading: a row that can be agreed is isAgreed (an ending first, then the final read, then passed); a row that never can is not, whatever the report holds', () => {
  for (const word of ENDING_WORDS) for (const passed of [true, false]) for (const [en, ending] of Object.entries(ENDINGS)) for (const [rn, read] of Object.entries(READS)) {
    const r = report(word, passed, ending, read);
    const want = ENDING_MATRIX[word].agrees === 'never' ? false : isAgreed(r);
    assert.equal(agreedOf(r), want, `${word} passed=${passed} ending=${en} read=${rn}`);
    assert.equal(agreedOf(r), !endsNotAgreed(r) && want, `${word} ${passed} ${en} ${rn}: the negative reading agrees where the report decides`);
  }
});

test('A2 a report without a word (written before the matrix) reads exactly as isAgreed reads it, and a missing report is not agreed', () => {
  for (const passed of [true, false, undefined]) for (const [en, ending] of Object.entries(ENDINGS)) for (const [rn, read] of Object.entries(READS)) {
    const r = { passed, ...(ending ? { ending } : {}), ...(read ? { final_read: read } : {}) };
    assert.equal(agreedOf(r), isAgreed(r), `${passed} ${en} ${rn}`);
  }
  assert.equal(agreedOf(null), false);
  assert.equal(agreedOf(undefined), false);
});

test('A3 "never" is never for what the chain writes: a report a run can produce for a never row (passed false; an ending, when there is one, not agreed) is not agreed under isAgreed either, so the matrix and the older reading cannot disagree', () => {
  const neverWords = ENDING_WORDS.filter(w => ENDING_MATRIX[w].agrees === 'never' && w !== 'signed_off_at_top_not_agreed');
  for (const word of neverWords) for (const ending of [undefined, ENDINGS.not_agreed]) for (const read of Object.values(READS)) {
    const r = report(word, false, ending, read);
    assert.equal(isAgreed(r), false, `${word} ${ending?.kind} ${read?.ran}`);
    assert.equal(agreedOf(r), isAgreed(r));
  }
  // signed_off_at_top_not_agreed is the one never row with passed true: the ending (never absent for it) says not agreed
  for (const read of Object.values(READS)) assert.equal(isAgreed(report('signed_off_at_top_not_agreed', true, ENDINGS.not_agreed, read)), false);
});

test('A4 the rows that CAN be agreed are agreed exactly when S4 says so (or, with no ending, when passed holds and no final read blocks it): signed_off, escalated_signoff and finish_chosen', () => {
  const can = ENDING_WORDS.filter(w => ENDING_MATRIX[w].agrees === 'by_ending');
  assert.deepEqual([...can].sort(), ['escalated_signoff', 'finish_chosen', 'signed_off']);
  for (const word of can) {
    assert.equal(agreedOf(report(word, true, undefined, READS.clear)), true, `${word}: passed, final read clear`);
    assert.equal(agreedOf(report(word, true, undefined, READS.blocks)), false, `${word}: passed, final read blocks`);
    assert.equal(agreedOf(report(word, false, ENDINGS.agreed, READS.clear)), true, `${word}: S4 agreed (an escalated sign-off the handler passed, passed false)`);
    assert.equal(agreedOf(report(word, true, ENDINGS.not_agreed, READS.clear)), false, `${word}: S4 not agreed`);
    assert.equal(finalReadBlocksAgreement(READS.blocks), true);
  }
});

test('A5 the real relation to final_read.run_end (the reading BEFORE the final read): where the final read ran, the agreed reading is run_end agreed and no objecting read; a never row\'s run_end is not_agreed', () => {
  const runEnd = (read, v) => ({ ...read, run_end: v });
  // the reports a run can write: [word, passed, ending, run_end before the read]
  const REAL = [['signed_off', true, undefined, 'agreed'], ['signed_off', true, ENDINGS.agreed, 'agreed'], ['signed_off_at_top_not_agreed', true, ENDINGS.not_agreed, 'agreed'],
    ['escalated_signoff', false, ENDINGS.agreed, 'agreed'], ['escalated_signoff', false, undefined, 'not_agreed'], ['finish_chosen', false, undefined, 'not_agreed'],
    ...ENDING_WORDS.filter(w => ['early_finish', 'rule_no_handler', 'layer_stop', 'no_reviewer_heard', 'not_quorate', 'stalled', 'round_cap'].includes(w)).map(w => [w, false, undefined, 'not_agreed'])];
  for (const [word, passed, ending, end] of REAL) for (const seats of [[{ read: true, meets: true }], [{ read: true, meets: false }]]) {
    const read = { ran: true, run_end: end, seats };
    const r = report(word, passed, ending, read);
    const byRunEnd = end === 'agreed' && !finalReadBlocksAgreement(read);
    // a signed_off_at_top_not_agreed run is the one place the older record (run_end) and S4's ending differ on purpose: the handler said not_yet / the text changed, after the panel passed
    const want = word === 'signed_off_at_top_not_agreed' ? false : (ending && ending.kind !== 'agreed' ? false : byRunEnd);
    assert.equal(agreedOf(r), want, `${word} passed=${passed} ending=${ending?.kind} run_end=${end} seats=${JSON.stringify(seats)}`);
    if (ENDING_MATRIX[word].agrees === 'never' && word !== 'signed_off_at_top_not_agreed') assert.equal(end, 'not_agreed', `${word}: run_end of a never row`);
  }
});

