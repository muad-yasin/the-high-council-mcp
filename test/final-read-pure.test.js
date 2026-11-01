// Unit D (B3 prep): the pure parts of the final read - which top-layer seats must read the plan as it ends (src/final-read.js). The calls and the stage are
// tested in test/final-read-stage.test.js.
import test from 'node:test';
import { finishedRunState } from '../src/run-status.js';
import assert from 'node:assert/strict';
import { finalReadSummaryLine, finalReadObjected, finalReadBlocksAgreement, layer3ReadShas, seatsToRead, topSeatsOf, finalReadLabel, renderFinalReadBlock, renderFinalReadBoard, finalReadLogLines, readEntry, unreadEntry, finalReadRecord } from '../src/final-read.js';

const SHAS = { 1: 'aaa', 2: 'bbb', 3: 'ccc' };
const row = (round, lab, verdict, extra = {}) => ({ round, lab, layer: 3, verdict, ...extra });

test('layer3ReadShas: a seat\'s latest readable verdict (signed off or objected) names the plan it read; the other seat, never asked, is null', () => {
  const shas = layer3ReadShas([row(1, 'opus', 'objected'), row(2, 'opus', 'signed_off')], SHAS, ['opus', 'terra']);
  assert.deepEqual([...shas], [['opus', 'bbb'], ['terra', null]]);
});

test('layer3ReadShas matrix: carried and exchange_cleared count as read; a stated pass, an unheard seat and a row on a round without a sha do not', () => {
  const shas = layer3ReadShas([
    row(1, 'carried', 'signed_off'), row(2, 'carried', 'signed_off', { carried: true, from_round: 1 }),
    row(2, 'cleared', 'signed_off', { exchange_cleared: true }),
    row(2, 'passer', 'passed'), row(2, 'silent', 'unheard'), row(9, 'nosha', 'objected'),
  ], SHAS, ['carried', 'cleared', 'passer', 'silent', 'nosha']);
  assert.deepEqual(Object.fromEntries(shas), { carried: 'bbb', cleared: 'bbb', passer: null, silent: null, nosha: null });
});

test('layer3ReadShas: a later unreadable or passed row does not erase an earlier read; a repeated seat is read by its seat key, not its lab', () => {
  const shas = layer3ReadShas([row(1, 'opus', 'objected'), row(2, 'opus', 'unheard'), row(3, 'opus', 'passed'), { round: 3, lab: 'gpt', seat: 'gpt-l3', layer: 3, verdict: 'signed_off' }], SHAS, ['opus', 'gpt-l3']);
  assert.deepEqual(Object.fromEntries(shas), { opus: 'aaa', 'gpt-l3': 'ccc' });
});

test('seatsToRead: exactly the seats whose last read is not this plan (never read always differs); one read, one not -> one call', () => {
  const shas = new Map([['opus', 'ccc'], ['terra', 'bbb'], ['new', null]]);
  assert.deepEqual(seatsToRead('ccc', shas), ['terra', 'new']);
  assert.deepEqual(seatsToRead('zzz', shas), ['opus', 'terra', 'new']);
  assert.deepEqual(seatsToRead('ccc', new Map([['opus', 'ccc']])), []);
});

test('topSeatsOf: the highest layer\'s critics, in panel order; none for an unlayered panel', () => {
  const c = [{ lab: 'a', layer: 1 }, { lab: 'b', layer: 3 }, { lab: 'c', layer: 2 }, { lab: 'd', layer: 3 }];
  assert.deepEqual(topSeatsOf(c).map(s => s.lab), ['b', 'd']);
  assert.deepEqual(topSeatsOf([{ lab: 'a' }]), []);
});

test('finalReadLabel: the stage label is final-read-<seat key> (a paused run replays by it: never rename)', () => {
  assert.equal(finalReadLabel('opus5.5'), 'final-read-opus5.5');
});

test('the record, the block, the board and the log say "did NOT read" for an unread seat, loudly, and carry an objection verbatim', () => {
  const ok = readEntry({ lab: 'opus5.5', layer: 3, label: 'final-read-opus5.5', lastReadSha: 'aaa', reasked: false, critique: { meets: false, failures: [{ criterion: 'Scope', problem: 'It adds a billing system nobody asked for.' }] } });
  const bad = unreadEntry({ lab: 'terra', layer: 3, label: 'final-read-terra', lastReadSha: null, reasked: true, why: 'unreadable reply after one re-ask' });
  const rec = finalReadRecord({ ran: true, finalSha: 'ccc', seats: [ok, bad] });
  const log = finalReadLogLines(rec.seats).join('\n');
  assert.match(log, /terra: did NOT read the final plan: unreadable reply after one re-ask/);
  assert.match(log, /NOT EVERY LAYER-3 SEAT READ THE FINAL PLAN after its last change \(terra did not\)/);
  const block = renderFinalReadBlock(rec);
  assert.match(block, /### opus5\.5: objected/);
  assert.match(block, /- "Scope": It adds a billing system nobody asked for\./);
  assert.match(block, /### terra: DID NOT READ/);
  assert.match(block, /\*\*Not every layer-3 seat read the final plan \(terra did not\)\.\*\*/);
  const board = renderFinalReadBoard(rec);
  assert.match(board, /## Final read by layer 3/);
  assert.match(board, /\*\*DID NOT READ\*\* - terra \(layer 3\), asked twice/);
  assert.equal(renderFinalReadBlock(finalReadRecord({ ran: false, reason: 'agreed', finalSha: 'ccc' })), '');
  assert.equal(renderFinalReadBoard(undefined), '');
});

// These two predicates decide the exit code, the outcome and run_status of an AGREED run. Pinned here as C&C's ruling 5 is read (fail closed: an unread seat blocks agreement as an objection does; pending C&C's yes).
const seatOf = (read, meets) => (read ? { lab: 'x', layer: 3, label: 'final-read-x', read: true, meets, failures: [], reasked: false, last_read_sha: null } : { lab: 'y', layer: 3, label: 'final-read-y', read: false, why: 'no reply', reasked: true, last_read_sha: null });
const rec = (run_end, ...seats) => ({ ran: true, run_end, final_sha: 'abc', seats });

test('finalReadBlocksAgreement / finalReadObjected: only an AGREED run is blocked, by an objection OR by a seat that did not read; a not-agreed run, a record that did not run and every-seat-clear change nothing', () => {
  assert.equal(finalReadBlocksAgreement(undefined), false);
  assert.equal(finalReadBlocksAgreement({ ran: false, run_end: 'agreed', reason: 'every_top_seat_read_this_plan', final_sha: 'abc', seats: [] }), false);
  assert.equal(finalReadBlocksAgreement(rec('not_agreed', seatOf(true, false), seatOf(false))), false, 'already not agreed: nothing to change');
  assert.equal(finalReadBlocksAgreement(rec('agreed', seatOf(true, true))), false, 'agreed and every seat read and raised no objection');
  assert.equal(finalReadBlocksAgreement(rec('agreed', seatOf(true, true), seatOf(true, false))), true, 'one seat objected');
  assert.equal(finalReadBlocksAgreement(rec('agreed', seatOf(true, true), seatOf(false))), true, 'one seat did not read: an unknown is not a pass');
  assert.equal(finalReadObjected(rec('agreed', seatOf(true, true), seatOf(false))), false, 'unread is not an objection (outcome degraded, not no_consensus)');
  assert.equal(finalReadObjected(rec('agreed', seatOf(true, false))), true);
  assert.equal(finalReadObjected({ ran: false, seats: [] }), false);
});

test('run_status words (the MCP surface): an agreed report whose final read objected or was unread reads "done: not agreed"; a clean agreed report and a not-agreed report keep their old words', () => {
  const agreed = { passed: true, signoff: [{ lab: 'a', signedOff: true }] };
  assert.match(finishedRunState({ ...agreed, final_read: rec('agreed', seatOf(true, false)) }), /^done: not agreed \(layer 3 did not clear the final plan/);
  assert.match(finishedRunState({ ...agreed, final_read: rec('agreed', seatOf(false)) }), /^done: not agreed/);
  assert.doesNotMatch(finishedRunState({ ...agreed, final_read: rec('agreed', seatOf(true, true)) }), /not agreed/);
  assert.equal(finishedRunState({ passed: false, final_read: rec('not_agreed', seatOf(true, false)) }), 'done: open objections');
});

test('finalReadSummaryLine: one line per run for the terminal; empty when the stage did not run; "NOT agreed" only for an agreed run that is blocked', () => {
  assert.equal(finalReadSummaryLine(undefined), '');
  assert.equal(finalReadSummaryLine({ ran: false, run_end: 'agreed', seats: [] }), '');
  assert.equal(finalReadSummaryLine(rec('not_agreed', seatOf(true, true), seatOf(false))), 'final read: x no objection; y DID NOT READ');
  assert.equal(finalReadSummaryLine(rec('agreed', seatOf(true, true))), 'final read: x no objection');
  assert.match(finalReadSummaryLine(rec('agreed', seatOf(true, false))), /^final read: x objected \(0\) - the run is NOT agreed$/);
});
