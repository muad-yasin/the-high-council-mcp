// 0.8.4 T2.1 / D1 (plan A tests/ending-matrix, UNIT 3): the ending matrix (src/ending-matrix.js) is complete, agrees with the schema's two enums and with `panelEnding`, and gives the banner/Status columns the readers use.
// PURE: no run, no file but the schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENDING_MATRIX, ENDING_WORDS, WAITING_ROW, endingWordOf, disputeReasonOf, stopKindOf, statusAllowedOf, bannerReasonOf, rowOfReport } from '../src/ending-matrix.js';
import { panelEnding } from '../src/overseer-rounds.js';
import { STATUS_VALUES } from '../src/milestones.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const COLUMNS = ['reaches_build', 'panel_word', 'dispute_reason', 'dispute_reason_idle', 'agrees', 'acceptance', 'banner_reason_agreed', 'banner_reason_not_agreed', 'status_when_agreed', 'status_when_not_agreed'];
// every way a run ends that the code produces (src/chain.js), by the flags it sets; `round_cap` is the end with none
const CASES = [
  ['signed_off', { passed: true }], ['escalated_signoff', { escalatedEnd: { pass: 1 } }], ['early_finish', { earlyFinish: { pass: 1 } }],
  ['rule_no_handler', { finishedStop: { kind: 'overseer_cap', chosen: 'rule' } }], ['finish_chosen', { finishedStop: { kind: 'overseer_cap', chosen: 'finish' } }],
  ['layer_stop', { layerStop: { reason: 'x' } }], ['no_reviewer_heard', { noHeardReviewer: { round: 1 } }], ['not_quorate', { notQuorate: { round: 1 } }],
  ['stalled', { stalled: { rounds: 3, round: 3 } }], ['round_cap', {}],
];

test('M1 coverage: every row has every column, the waiting row is not an ending, and the words are the ones the plan names (a deleted row names itself)', () => {
  const need = ['signed_off', 'signed_off_at_top_not_agreed', 'escalated_signoff', 'early_finish', 'rule_no_handler', 'finish_chosen', 'layer_stop', 'no_reviewer_heard', 'not_quorate', 'stalled', 'round_cap'];
  const missing = need.filter(w => !Object.hasOwn(ENDING_MATRIX, w));
  assert.deepEqual(missing, [], `the matrix has no row for: ${missing.join(', ')}`);
  assert.deepEqual([...ENDING_WORDS].sort(), [...need].sort(), 'no row beyond these');
  for (const [word, row] of Object.entries(ENDING_MATRIX)) {
    for (const c of COLUMNS) assert.ok(Object.hasOwn(row, c) && row[c] !== undefined, `${word}.${c} is filled`);
    assert.equal(row.reaches_build, true, `${word} reaches a build session`);
    assert.ok(['never', 'by_ending'].includes(row.agrees), `${word}.agrees`);
    assert.ok(Object.isFrozen(row), `${word} is frozen`);
  }
  for (const c of COLUMNS) assert.ok(Object.hasOwn(WAITING_ROW, c), `the waiting row has ${c} (T2.1 (g): a run waiting at a stop has a row that reaches no build session and no word)`);
  assert.equal(WAITING_ROW.reaches_build, false);
  assert.equal(WAITING_ROW.panel_word, null);
});

test('M2 the two public enums: the schema\'s ending_word enum equals the matrix\'s words, and its dispute.reason enum equals the matrix\'s reasons (running and idle) exactly', () => {
  const sw = schema.properties.ending_word;
  assert.deepEqual([...sw.enum].sort(), [...ENDING_WORDS].sort());
  const disputeReasons = schema.properties.dispute.properties.reason.enum;
  const fromMatrix = new Set(Object.values(ENDING_MATRIX).flatMap(r => [r.dispute_reason, r.dispute_reason_idle]));
  assert.deepEqual([...fromMatrix].sort(), [...disputeReasons].sort(), 'a reason the matrix writes is in the enum and an enum value no row writes is a stale value');
  assert.match(sw.description, /final_read\.run_end/, 'the schema says how the word relates to `ending` and final_read.run_end');
  assert.match(sw.description, /\bending\b/);
  assert.equal(schema.properties.stop_kind.type, 'string');
});

test('M3 the word of each way a run ends, and panelEnding (which feeds the public answer.ending and stays untouched) equals the matrix\'s panel_word for each', () => {
  for (const [word, flags] of CASES) {
    assert.equal(endingWordOf({ passed: false, ...flags, ...(word === 'signed_off' ? { passed: true } : {}) }), word, `flags of ${word}`);
    assert.equal(panelEnding({ passed: false, ...flags, ...(word === 'signed_off' ? { passed: true } : {}) }), ENDING_MATRIX[word].panel_word, `panelEnding for ${word}`);
  }
  // S4 refines only a signed_off run whose ending says not agreed; no other flag takes its word from `ending`
  assert.equal(endingWordOf({ passed: true, ending: { kind: 'signed_off_at_top_not_agreed' } }), 'signed_off_at_top_not_agreed');
  assert.equal(endingWordOf({ passed: true, ending: { kind: 'agreed' } }), 'signed_off');
  assert.equal(endingWordOf({ passed: false, finishedStop: { chosen: 'finish' }, ending: { kind: 'signed_off_at_top_not_agreed' } }), 'finish_chosen');
  assert.equal(endingWordOf({}), 'round_cap');
});

test('M4 the dispute reason a word derives (legacy spelling), running and idle; an unknown word derives none', () => {
  assert.deepEqual([['signed_off', false], ['layer_stop', true], ['layer_stop', false], ['no_reviewer_heard', true], ['stalled', true], ['stalled', false], ['round_cap', true], ['round_cap', false]].map(([w, ran]) => disputeReasonOf(w, ran)),
    ['panel_signed_off', 'layer_not_signed_off', 'layer_not_signed_off', 'no_heard_reviewer', 'stalled', 'no_open_objections', 'round_cap', 'no_open_objections']);
  assert.equal(disputeReasonOf('nonsense', true), null);
});

test('M5 stopKindOf: the stop\'s kind, with /why when it has one; null without a stop', () => {
  assert.equal(stopKindOf({ kind: 'layer_bound', why: 'revisions' }), 'layer_bound/revisions');
  assert.equal(stopKindOf({ kind: 'stall_stop', why: 'top_layer', rounds: 7 }), 'stall_stop/top_layer');
  assert.equal(stopKindOf({ kind: 'overseer_cap' }), 'overseer_cap');
  assert.equal(stopKindOf({ kind: 'secret_pause', chosen: 'finish' }), 'secret_pause');
  assert.deepEqual([stopKindOf(null), stopKindOf({}), stopKindOf({ kind: '' })], [null, null, null]);
});

test('M6 Status values (T2.5, D29): all five when the run is agreed or accepted, never ready_for_build or partial after an ending without agreement; the values are milestones.js\'s own list', () => {
  assert.deepEqual([...statusAllowedOf('signed_off', { agreed: true })], [...STATUS_VALUES]);
  assert.deepEqual([...statusAllowedOf('round_cap', { agreed: false, accepted: true })], [...STATUS_VALUES]);
  for (const [word] of CASES) {
    const out = statusAllowedOf(word, { agreed: false });
    assert.ok(!out.includes('ready_for_build') && !out.includes('partial'), word);
    assert.ok(out.includes('needs_decision'), `${word} may still say needs_decision`);
  }
  // CHANGED ACCEPTED (0.8.4 D29, found before the box): was `assert.deepEqual([...statusAllowedOf('not a word', { agreed: false })], [...STATUS_VALUES], 'an unknown word clamps nothing')`. A run with no word (stopped, crashed, or a report from before the matrix) is exactly the run `council handoff --from-run` serves; it decides on the agreed and accepted readings alone.
  assert.deepEqual([...statusAllowedOf('not a word', { agreed: false })], [...statusAllowedOf('round_cap', { agreed: false })], 'an unknown word, not agreed: the not-agreed list');
  assert.deepEqual([...statusAllowedOf(undefined, { agreed: true })], [...STATUS_VALUES]);
});

test('M7 the banner\'s reason sentences are today\'s, and a row that can never be agreed ignores the caller\'s agreed reading', () => {
  assert.equal(bannerReasonOf('signed_off', true), 'signed off');
  assert.equal(bannerReasonOf('signed_off', false), 'finished with open objections');
  assert.equal(bannerReasonOf(null, true), 'signed off');
  assert.equal(bannerReasonOf(undefined, false), 'finished with open objections');
  for (const word of ENDING_WORDS.filter(w => ENDING_MATRIX[w].agrees === 'never')) assert.equal(bannerReasonOf(word, true), 'finished with open objections', word);
});

test('M8 rowOfReport reads the word of a report and of a result, and nothing for a report without one', () => {
  assert.equal(rowOfReport({ ending_word: 'stalled' }), ENDING_MATRIX.stalled);
  assert.equal(rowOfReport({ endingWord: 'round_cap' }), ENDING_MATRIX.round_cap);
  assert.equal(rowOfReport({ passed: true }), null);
  assert.equal(rowOfReport({ ending_word: 'toString' }), null);
  assert.equal(rowOfReport(null), null);
});
