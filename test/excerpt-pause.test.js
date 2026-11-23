// 0.8.4 D10 (plan A T5.5), the pause unit (src/excerpt-pause.js): with the privacy switch on, the rows of a batch that carry text wait at ONE gate; the person's answers are applied at the resume after them. Offline, $0: the gate
// calls are injected, so this file proves the decisions (what is bound, asked again, applied) without a run; test/privacy-pause.test.js drives the real command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pauseAtApproval, recordApproved, completeUsedGates, boundOf, seatNameOf, stageNameOf } from '../src/excerpt-pause.js';
import { readExcerpts, appendExcerpts } from '../src/excerpt-record.js';

const AT = '2026-11-09T10:00:00.000Z';
const wait = (over = {}) => ({ request_kind: 'seat_request', requested_by: 'lab-a', objection_id: null, origin: 'panel-1-lab-a', why: 'To judge the claim.', source_kind: 'repository_file', path: 'src/a.js', lines: '3-5', text: 'three\nfour\nfive', file_sha256: null, edited: false, scans: { key_shape: 'clear', personal_data: 'not_scanned' }, pasted_by: 'main-session', advisor: null, advisor_said: null, answered_stage: 'revise-1', approval: null, ...over });
const declined = () => wait({ text: null, scans: null, pasted_by: null, approval: { status: 'refused', actor: 'main-session', channel: 'session', at: AT, reason: 'No.' } });
function fakeGate({ waiting = [], ask = ['g1'], max = 20, all = null } = {}) {
  const calls = { request: [], recorded: [] };
  let n = 0;
  return { calls, max, waiting: () => waiting, all: () => all ?? waiting, request: a => { calls.request.push(a); const id = ask[n++]; return id ? { ok: true, id } : { ok: false, code: 'gate_busy', message: 'busy' }; }, recorded: (id, count) => { calls.recorded.push([id, count]); return { ok: true }; } };
}
const answered = (answers, over = {}) => ({ id: 'g1', status: 'approved', excerpts: null, answer: { channel: 'cli', actor: 'alice', ts: AT, excerpt_answers: answers }, ...over });
const W = (...gs) => ({ waiting: gs });

test('nothing waits: every row is recorded as it is and no gate is asked or used', () => {
  const g = fakeGate();
  const r = pauseAtApproval({ batch: [declined()], firstId: 1, gate: g });
  assert.deepEqual([r.action, r.rows.length, r.gates], ['record', 1, []]);
  assert.deepEqual(g.calls.request, []);
});

test('rows that carry text are bound by their place in the batch (a refused row before them keeps its number) and ONE gate is asked with the screen of exactly these excerpts', () => {
  const g = fakeGate();
  const batch = [declined(), wait(), wait({ origin: 'debate-lab-b', requested_by: 'lab-b', path: 'src/b.js', lines: null, text: 'only' })];
  assert.deepEqual(boundOf(batch, 4).map(b => [b.id, b.lines, b.shown_lines]), [['E-5', '3-5', 3], ['E-6', null, 1]]);
  const r = pauseAtApproval({ batch, firstId: 4, gate: g });
  assert.deepEqual(r, { action: 'asked', gateIds: ['g1'] });
  assert.equal(g.calls.request.length, 1);
  const { screen, excerpts } = g.calls.request[0];
  assert.deepEqual(excerpts.map(e => e.id), ['E-5', 'E-6']);
  assert.ok(screen.includes('the judge lab-a asked to see lines 3-5 of src/a.js') && screen.includes('the proposer lab-b asked to see src/b.js'), screen);
  assert.ok(screen.includes('three') && screen.includes('only'));
});

test('a gate that still waits for the person is not asked again', () => {
  const batch = [wait()];
  const g = fakeGate(W({ id: 'g7', status: 'pending', excerpts: boundOf(batch, 1), answer: null }));
  assert.deepEqual(pauseAtApproval({ batch, firstId: 1, gate: g }), { action: 'asked', gateIds: ['g7'] });
  assert.deepEqual(g.calls.request, []);
});

test('an answered gate whose excerpts are these: approve, edit (narrower lines) and refuse are applied with the gate\'s own channel, actor and time; the gate is named for its use line', () => {
  const batch = [wait(), wait({ path: 'src/b.js', lines: '1-3', text: 'one\ntwo\nthree' }), wait({ path: 'src/c.js', lines: null, text: 'c' })];
  const bound = boundOf(batch, 1);
  const g = fakeGate(W(answered([{ id: 'E-1', decision: 'approve' }, { id: 'E-2', decision: 'edit', lines: '2-3' }, { id: 'E-3', decision: 'refuse', reason: 'Private.' }], { excerpts: bound })));
  const r = pauseAtApproval({ batch, firstId: 1, gate: g });
  assert.equal(r.action, 'record');
  assert.deepEqual(r.rows.map(x => [x.approval.status, x.approval.channel, x.approval.actor, x.approval.at, x.text, x.lines, x.edited]), [
    ['approved', 'cli', 'alice', AT, 'three\nfour\nfive', '3-5', false],
    ['edited', 'cli', 'alice', AT, 'two\nthree', '2-3', true],
    ['refused', 'cli', 'alice', AT, null, null, false],
  ]);
  assert.equal(r.rows[2].approval.reason, 'Private.');
  assert.deepEqual(r.gates, [{ id: 'g1', count: 3 }]);
  assert.deepEqual(g.calls.request, []);
});

test('the bound list is compared by its four fields, never by the order of keys a stored copy comes back in', () => {
  const batch = [wait()];
  const reordered = boundOf(batch, 1).map(b => ({ shown_lines: b.shown_lines, text_sha256: b.text_sha256, lines: b.lines, id: b.id }));
  const g = fakeGate(W(answered([{ id: 'E-1', decision: 'approve' }], { excerpts: reordered })));
  const r = pauseAtApproval({ batch, firstId: 1, gate: g });
  assert.equal(r.action, 'record');
  assert.deepEqual(g.calls.request, [], 'not asked again');
});

test('an answer list that lacks a bound excerpt is a refusal with its own sentence (exit 2), not a crash', () => {
  const batch = [wait()];
  const g = fakeGate(W(answered([], { excerpts: boundOf(batch, 1) })));
  assert.throws(() => pauseAtApproval({ batch, firstId: 1, gate: g }), err => err.excerptRefusal === true && /have none for excerpt E-1/.test(err.message));
});

test('declining the gate refuses every waiting excerpt (the rows with no text stay as they were)', () => {
  const batch = [declined(), wait()];
  const g = fakeGate(W({ id: 'g1', status: 'declined', excerpts: boundOf(batch, 1), answer: { channel: 'cli', actor: 'alice', ts: AT, reason: 'Not these.' } }));
  const r = pauseAtApproval({ batch, firstId: 1, gate: g });
  assert.deepEqual(r.rows.map(x => [x.approval.status, x.approval.reason]), [['refused', 'No.'], ['refused', 'Not these.']]);
  assert.deepEqual(r.gates, [{ id: 'g1', count: 1 }]);
});

test('an answered gate for OTHER excerpts (the text changed since it was shown) and an expired one are not applied: the person is asked again, for exactly these', () => {
  const batch = [wait()];
  const stale = boundOf([wait({ text: 'old text' })], 1);
  for (const latest of [answered([{ id: 'E-1', decision: 'approve' }], { excerpts: stale }), { id: 'g1', status: 'expired', excerpts: boundOf(batch, 1), answer: null }]) {
    const g = fakeGate({ ...W(latest), ask: ['g2'] });
    assert.deepEqual(pauseAtApproval({ batch, firstId: 1, gate: g }), { action: 'asked', gateIds: ['g2'] });
    assert.equal(g.calls.request.length, 1);
  }
});

test('a gate that cannot be asked stops the run (it must not go on without the approval it needs)', () => {
  assert.throws(() => pauseAtApproval({ batch: [wait()], firstId: 1, gate: fakeGate({ ask: [] }) }), /could not be asked \(gate_busy\)/);
});

test('recordApproved appends the rows first and then names the gate; a failing use line is an error, never silent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pause-'));
  try {
    const rows = [wait({ approval: { status: 'approved', actor: 'alice', channel: 'cli', at: AT, reason: null } })];
    const calls = [];
    const written = recordApproved({ runDir: dir, rows, gates: [{ id: 'g1', count: 1 }], gateApi: { recorded: (id, n) => { calls.push([id, n, readExcerpts(dir).entries.length]); return { ok: true }; } } });
    assert.equal(written.length, 1);
    assert.deepEqual(calls, [['g1', 1, 1]], 'the line was already in the file when the use was recorded');
    assert.throws(() => recordApproved({ runDir: dir, rows: [], gates: [{ id: 'g1', count: 1 }], gateApi: { recorded: () => ({ ok: false, code: 'gate_used', message: 'used' }) } }), /could not be marked used \(gate_used\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the names on the screen: a seat by the role its reply tells (a proposer and a judge of one key are two different people), a stage by what the person knows', () => {
  assert.equal(seatNameOf('debate-lab-a', 'lab-a'), 'the proposer lab-a');
  assert.equal(seatNameOf('panel-2-lab-a', 'lab-a'), 'the judge lab-a');
  assert.deepEqual(['build', 'revise-3', 'revise-2-full', 'answers'].map(stageNameOf), ['the build', 'the revision of round 3', 'the revision of round 2', 'the step it was writing']);
});

test('MORE TEXTS THAN ONE GATE HOLDS: the pause gets several gates, each with its own screen and list; nothing is applied until EVERY one is answered, and one resume then applies all of them', () => {
  const batch = [wait(), wait({ path: 'src/b.js', text: 'b' }), wait({ path: 'src/c.js', text: 'c' })];
  const bound = boundOf(batch, 1);
  const g0 = fakeGate({ max: 2, ask: ['g1', 'g2'] });
  assert.deepEqual(pauseAtApproval({ batch, firstId: 1, gate: g0 }), { action: 'asked', gateIds: ['g1', 'g2'] });
  assert.deepEqual(g0.calls.request.map(c => c.excerpts.map(e => e.id)), [['E-1', 'E-2'], ['E-3']]);
  assert.ok(g0.calls.request[0].screen.includes('src/b.js') && !g0.calls.request[0].screen.includes('src/c.js'), 'each screen shows its own excerpts only');
  // the first answered, the second still waits: refused with both named by the pending one, nothing applied
  const one = answered([{ id: 'E-1', decision: 'approve' }, { id: 'E-2', decision: 'approve' }], { id: 'g1', excerpts: bound.slice(0, 2) });
  const two = { id: 'g2', status: 'pending', excerpts: bound.slice(2), answer: null };
  const g1 = fakeGate({ max: 2, ...W(one, two) });
  assert.deepEqual(pauseAtApproval({ batch, firstId: 1, gate: g1 }), { action: 'asked', gateIds: ['g2'] });
  assert.deepEqual(g1.calls.request, []);
  // both answered: one call applies all, and both gates are named for their use lines
  const two2 = answered([{ id: 'E-3', decision: 'refuse', reason: 'No.' }], { id: 'g2', excerpts: bound.slice(2) });
  const r = pauseAtApproval({ batch, firstId: 1, gate: fakeGate({ max: 2, ...W(one, two2) }) });
  assert.deepEqual([r.action, r.rows.map(x => x.approval.status), r.gates], ['record', ['approved', 'approved', 'refused'], [{ id: 'g1', count: 2 }, { id: 'g2', count: 1 }]]);
  // one of them expired: only that one is asked again
  const expired = { id: 'g2', status: 'expired', excerpts: bound.slice(2), answer: null };
  const g3 = fakeGate({ max: 2, ...W(one, expired), ask: ['g3'] });
  assert.deepEqual(pauseAtApproval({ batch, firstId: 1, gate: g3 }), { action: 'asked', gateIds: ['g3'] });
  assert.deepEqual(g3.calls.request.map(c => c.excerpts.map(e => e.id)), [['E-3']]);
});

// CRASH BETWEEN the rows and the use line (C&C 09 Nov 2026, ruling (b)): the rows of an answered gate are on disk and the gate has no use line. completeUsedGates writes the line, never a row.
const crashed = (answers, over = {}) => {
  const batch = [wait(), wait({ path: 'src/b.js', lines: '1-3', text: 'one\ntwo\nthree' }), wait({ path: 'src/c.js', lines: null, text: 'c' })];
  const gate = answered(answers, { excerpts: boundOf(batch, 1), ...over });
  const dir = mkdtempSync(join(tmpdir(), 'thc-crash-'));
  const step = pauseAtApproval({ batch, firstId: 1, gate: fakeGate(W(gate)) });
  appendExcerpts(dir, step.rows);   // the append that happened before the process died
  return { dir, gate, entries: readExcerpts(dir).entries };
};
const THREE = [{ id: 'E-1', decision: 'approve' }, { id: 'E-2', decision: 'edit', lines: '2-3' }, { id: 'E-3', decision: 'refuse', reason: 'Private.' }];

test('CRASH BETWEEN: an answered gate whose rows (approved, edited, refused) are all on disk gets its use line, with count = its bound count, and no row is written', () => {
  const { dir, gate, entries } = crashed(THREE);
  try {
    const g = fakeGate(W(gate));
    assert.deepEqual(completeUsedGates({ entries, gate: g }), [{ id: 'g1', count: 3 }]);
    assert.deepEqual(g.calls.recorded, [['g1', 3]]);
    assert.equal(readExcerpts(dir).entries.length, 3, 'completing the line adds no row');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CRASH BETWEEN: a DECLINED gate whose refused rows are on disk is completed the same way', () => {
  const { dir, gate, entries } = crashed([], { status: 'declined', answer: { channel: 'cli', actor: 'alice', ts: AT, reason: 'No.' } });
  try {
    const g = fakeGate(W(gate));
    assert.deepEqual(completeUsedGates({ entries, gate: g }), [{ id: 'g1', count: 3 }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CRASH BETWEEN, several gates: a crash after g1 was marked and before g2 leaves g2 answered and unused with its rows present; only g2 is completed (g1 is not waiting any more)', () => {
  const batch = [wait(), wait({ path: 'src/b.js', text: 'b' }), wait({ path: 'src/c.js', text: 'c' })];
  const bound = boundOf(batch, 1);
  const g1 = answered([{ id: 'E-1', decision: 'approve' }, { id: 'E-2', decision: 'approve' }], { id: 'g1', excerpts: bound.slice(0, 2) });
  const g2 = answered([{ id: 'E-3', decision: 'approve' }], { id: 'g2', excerpts: bound.slice(2) });
  const dir = mkdtempSync(join(tmpdir(), 'thc-crash-'));
  try {
    const step = pauseAtApproval({ batch, firstId: 1, gate: fakeGate({ ...W(g1, g2), max: 2 }) });
    assert.equal(step.action, 'record');
    appendExcerpts(dir, step.rows);
    const g = fakeGate(W(g2));
    assert.deepEqual(completeUsedGates({ entries: readExcerpts(dir).entries, gate: g }), [{ id: 'g2', count: 1 }]);
    assert.deepEqual(g.calls.recorded, [['g2', 1]]);
    const both = fakeGate(W(g1, g2));
    assert.deepEqual(completeUsedGates({ entries: readExcerpts(dir).entries, gate: both }), [{ id: 'g1', count: 2 }, { id: 'g2', count: 1 }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CRASH BETWEEN: none of the gate\'s rows on disk is not this case (the pause applies the answer), and a gate already marked used is not waiting, so a second resume writes nothing', () => {
  const batch = [wait()];
  const gate = answered([{ id: 'E-1', decision: 'approve' }], { excerpts: boundOf(batch, 1) });
  const g = fakeGate(W(gate));
  assert.deepEqual(completeUsedGates({ entries: [], gate: g }), []);
  assert.deepEqual(g.calls.recorded, []);
  const used = fakeGate(W());
  assert.deepEqual(completeUsedGates({ entries: [], gate: used }), []);
  assert.deepEqual(used.calls.recorded, []);
  const pending = fakeGate(W({ id: 'g3', status: 'pending', excerpts: boundOf(batch, 1), answer: null }));
  assert.deepEqual(completeUsedGates({ entries: [], gate: pending }), []);
});

test('CRASH BETWEEN, a damaged record is a refusal that names the gate, never completed and never skipped: only some rows present; a field that differs; a row of another status than the answer made', () => {
  const { dir, gate, entries } = crashed(THREE);
  try {
    const some = fakeGate(W(gate));
    assert.throws(() => completeUsedGates({ entries: entries.slice(0, 1), gate: some }), err => err.excerptRefusal === true && /gate g1 was answered, but excerpts\.jsonl holds only some of its excerpts, or holds them with other contents \(E-2, E-3\)\. Nothing was run and nothing was spent\./.test(err.message));
    assert.deepEqual(some.calls.recorded, []);
    const text = entries.map((e, k) => (k === 0 ? { ...e, text: 'other', text_sha256: 'f'.repeat(64) } : e));
    assert.throws(() => completeUsedGates({ entries: text, gate: fakeGate(W(gate)) }), /gate g1 .*\(E-1\)/);
    const lines = entries.map((e, k) => (k === 0 ? { ...e, lines: '4-5' } : e));
    assert.throws(() => completeUsedGates({ entries: lines, gate: fakeGate(W(gate)) }), /gate g1 .*\(E-1\)/);
    const other = entries.map((e, k) => (k === 2 ? { ...e, approval: { ...e.approval, status: 'approved' } } : e));
    assert.throws(() => completeUsedGates({ entries: other, gate: fakeGate(W(gate)) }), /gate g1 .*\(E-3\)/);
    const who = entries.map((e, k) => (k === 1 ? { ...e, approval: { ...e.approval, actor: 'mallory' } } : e));
    assert.throws(() => completeUsedGates({ entries: who, gate: fakeGate(W(gate)) }), /gate g1 .*\(E-2\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CRASH BETWEEN: a use line the gate refuses is an error naming the gate, never silent', () => {
  const { dir, gate, entries } = crashed(THREE);
  try {
    const g = { ...fakeGate(W(gate)), recorded: () => ({ ok: false, code: 'gate_used', message: 'used' }) };
    assert.throws(() => completeUsedGates({ entries, gate: g }), /gate g1 were applied but could not be marked used \(gate_used\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CRASH BETWEEN, a gate asked AGAIN: g1 was answered and left unused when the file changed and g2 was asked for the same ids and answered; the rows are g2\'s, so g1 is left as it is (no refusal, no line for g1) and g2 is judged', () => {
  const batch = [wait()];
  const bound = boundOf(batch, 1);
  const g1 = answered([{ id: 'E-1', decision: 'approve' }], { id: 'g1', excerpts: bound, answer: { channel: 'cli', actor: 'alice', ts: '2026-11-09T09:00:00.000Z', excerpt_answers: [{ id: 'E-1', decision: 'approve' }] } });
  const g2 = answered([{ id: 'E-1', decision: 'approve' }], { id: 'g2', excerpts: bound });
  const dir = mkdtempSync(join(tmpdir(), 'thc-crash-'));
  try {
    appendExcerpts(dir, pauseAtApproval({ batch, firstId: 1, gate: fakeGate(W(g2)) }).rows);
    const g = fakeGate({ ...W(g1, g2), all: [g1, g2] });
    assert.deepEqual(completeUsedGates({ entries: readExcerpts(dir).entries, gate: g }), [{ id: 'g2', count: 1 }]);
    assert.deepEqual(g.calls.recorded, [['g2', 1]]);
    const later = fakeGate({ ...W(g1), all: [g1, g2] });
    assert.deepEqual(completeUsedGates({ entries: readExcerpts(dir).entries, gate: later }), [], 'g2 is already used (not waiting): g1 stays as it is and the resume is not refused');
    assert.deepEqual(later.calls.recorded, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CRASH BETWEEN, an edited row\'s lines are checked as the edit moved them (a row whose lines are not those is a damaged record)', () => {
  const { dir, gate, entries } = crashed(THREE);
  try {
    const moved = entries.map((e, k) => (k === 1 ? { ...e, lines: '1-3' } : e));
    assert.throws(() => completeUsedGates({ entries: moved, gate: fakeGate(W(gate)) }), /gate g1 .*\(E-2\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
