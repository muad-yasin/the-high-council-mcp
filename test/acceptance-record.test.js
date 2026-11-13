// 0.8.4 T2.3 / D2 (plan A tests/acceptance-record, UNIT 3): the acceptance of a plan a run ended without agreement on. Pure rules (src/acceptance.js) and the gate layer (kind `acceptance`, src/gate.js): who may accept, the per-objection
// person test, what is recorded. The real command and the tool are in test/accept-flow.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openObjectionsOf, acceptanceBinding, acceptanceQuoteText, sessionMayAccept, acceptanceRefusal, acceptanceLine, withAcceptance, withoutAcceptance, stripAcceptanceLines, chooserWords, acceptanceReasonProblem } from '../src/acceptance.js';
import { clampStatus } from '../src/handoff-status.js';
import { statusAllowedOf } from '../src/ending-matrix.js';
import { requestGate, answerGate, acceptancesOf, answerAcceptanceAsSession, textSha256, ACCEPTANCE_KIND } from '../src/gate.js';

const OBJ = (id, extra = {}) => ({ id, lab: 'la', criterion: 'C1', problem: `problem of ${id}`, ...extra });
const REPORT = { ending_word: 'round_cap', passed: false, delivered_text: { sha256: 'a'.repeat(64), same_as_signed: true }, dispute: { open_objections: [OBJ('O-bbbbbbbb'), OBJ('O-aaaaaaaa'), OBJ('O-aaaaaaaa'), OBJ('O-cccccccc', { closed_by: 'final_read' }), { lab: 'la', problem: 'no id' }] } };

test('P1 the open objections: the dispute record\'s, minus those the final read closed, one per id, sorted; the last critique\'s failures when there is no dispute record', () => {
  assert.deepEqual(openObjectionsOf(REPORT).map(o => o.id), ['O-aaaaaaaa', 'O-bbbbbbbb']);
  assert.deepEqual(openObjectionsOf({ lastCritique: { failures: [OBJ('O-zzzzzzzz'), OBJ('O-yyyyyyyy')] } }).map(o => o.id), ['O-yyyyyyyy', 'O-zzzzzzzz']);
  assert.deepEqual(openObjectionsOf({}), []);
  assert.deepEqual(acceptanceBinding(REPORT), { plan_sha256: 'a'.repeat(64), objections: ['O-aaaaaaaa', 'O-bbbbbbbb'] });
});

test('P2 the question text lists the plan\'s hash and every open objection id, says what accepting does not do, and is the same bytes every time', () => {
  const objections = openObjectionsOf(REPORT);
  const a = acceptanceQuoteText({ runId: 'r1', report: REPORT, objections });
  assert.equal(a, acceptanceQuoteText({ runId: 'r1', report: REPORT, objections }));
  for (const needle of ['O-aaaaaaaa', 'O-bbbbbbbb', 'a'.repeat(64), 'round_cap', 'agree with any judge']) assert.ok(a.includes(needle), needle);
  assert.ok(!a.includes('O-cccccccc'), 'an objection the final read closed is not asked about');
  assert.notEqual(a, acceptanceQuoteText({ runId: 'r1', report: { ...REPORT, dispute: { open_objections: [OBJ('O-aaaaaaaa')] } }, objections: [OBJ('O-aaaaaaaa')] }), 'a different list is a different question (a different hash)');
});

test('P7 a late finding the run still carries is open at the end: the question names it (marked late), the record and the line mark it, a dropped one is not listed, and a run with none reads byte for byte as before', () => {
  const late = (id, extra = {}) => ({ id, lab: 'lc', problem: `late problem of ${id}`, rating: 6, flags: [], found: 'ending_exchange_last_round', round: 7, not_debated: true, sorted: null, ...extra });
  const report = { ...REPORT, late_findings: [late('L-0badf00d'), late('L-deadbeef', { dropped_after_check: true })] };
  const open = openObjectionsOf(report);
  assert.deepEqual(open.map(o => [o.id, o.late === true]), [['L-0badf00d', true], ['O-aaaaaaaa', false], ['O-bbbbbbbb', false]]);
  assert.deepEqual(acceptanceBinding(report).objections, ['L-0badf00d', 'O-aaaaaaaa', 'O-bbbbbbbb']);
  const text = acceptanceQuoteText({ runId: 'r1', report, objections: open });
  assert.match(text, /^- L-0badf00d \(lc, a late finding\): late problem of L-0badf00d$/m);
  assert.match(text, /^Open objections and late findings accepted as they stand \(a late finding was found where no round follows to debate it, so it was not debated\):$/m);
  assert.ok(!text.includes('L-deadbeef'), 'a late finding the build check dropped is not carried and not asked about');
  const plain = acceptanceQuoteText({ runId: 'r1', report: REPORT, objections: openObjectionsOf(REPORT) });
  assert.match(plain, /^Open objections accepted as they stand:$/m);
  assert.ok(!/late finding/.test(plain), 'no late finding, no late sentence');
  const entry = { channel: 'cli', at: '2026-11-09T10:00:00.000Z', reason: 'ok', objections: [{ id: 'O-aaaaaaaa' }, { id: 'L-0badf00d', late: true }] };
  assert.match(acceptanceLine(entry), /Open objections left standing, accepted as they stand: O-aaaaaaaa\. Late findings, not debated, accepted as they stand: L-0badf00d\. Written by the harness, not a model\.$/);
  assert.match(acceptanceLine({ ...entry, objections: [{ id: 'L-0badf00d', late: true }] }), /accepted as they stand: none\. Late findings, not debated, accepted as they stand: L-0badf00d\./);
  assert.match(acceptanceLine({ ...entry, objections: [{ id: 'O-aaaaaaaa' }] }), /accepted as they stand: O-aaaaaaaa\. Written by the harness, not a model\.$/, 'no late finding: the sentence as before');
});

test('P8 PIN: a run with NO late finding reads byte for byte as before the late-finding commit (the question, the line under the banner), and its entries carry no `late` key. Fails if any of those bytes change', () => {
  const objections = openObjectionsOf(REPORT);
  assert.ok(objections.every(o => !Object.hasOwn(o, 'late')), '`late` is absent, never false');
  const question = '# Accept this plan as it stands?\n\nRun r1. The run ended "round_cap" and the panel did not agree. Accepting approves building the plan as it stands. It does not agree with any judge, changes no objection and marks nothing agreed: the banner and the open objections below stay on the handoff.\n\nPlan sha256: ' + 'a'.repeat(64) + '\n\nOpen objections accepted as they stand:\n- O-aaaaaaaa (la): problem of O-aaaaaaaa\n- O-bbbbbbbb (la): problem of O-bbbbbbbb\n';   // the text of 4d062c66, copied
  assert.equal(acceptanceQuoteText({ runId: 'r1', report: REPORT, objections }), question);
  const line = '> **Accepted as it stands** by a choice typed at the terminal on 2026-11-09: ok. Open objections left standing, accepted as they stand: O-aaaaaaaa, O-bbbbbbbb. Written by the harness, not a model.';   // the line of 4d062c66, copied
  assert.equal(acceptanceLine({ channel: 'cli', at: '2026-11-09T10:00:00.000Z', reason: 'ok', objections: [{ id: 'O-aaaaaaaa' }, { id: 'O-bbbbbbbb' }] }), line);
  assert.equal(acceptanceQuoteText({ runId: 'r1', report: REPORT, objections: [] }).endsWith('Open objections accepted as they stand:\n(none are open)\n'), true);
});

test('P3 who may accept: the session only when no stop was the person\'s (a terminal answer, the hard stop), and the text is the text the panel last reviewed; an older choice entry with no channel is the person\'s (fail closed)', () => {
  const meta = (...channels) => ({ roundChoices: channels.map(channel => ({ stop: 's', choice: 'finish', ...(channel ? { channel } : {}) })) });
  assert.deepEqual(sessionMayAccept({ report: REPORT, meta: {} }), { ok: true });
  assert.deepEqual(sessionMayAccept({ report: REPORT, meta: meta('session', 'session') }), { ok: true });
  assert.equal(sessionMayAccept({ report: REPORT, meta: meta('session', 'cli') }).why, 'person_stop');
  assert.equal(sessionMayAccept({ report: REPORT, meta: meta(undefined) }).why, 'person_stop');
  assert.equal(sessionMayAccept({ report: { ...REPORT, stop: { kind: 'overseer_cap', rounds: 7 } }, meta: {} }).why, 'hard_stop');
  assert.equal(sessionMayAccept({ report: { ...REPORT, stop: { kind: 'overseer_cap', rounds: 2 } }, meta: {} }).ok, true);
  assert.equal(sessionMayAccept({ report: { ...REPORT, delivered_text: { sha256: 'a'.repeat(64), same_as_signed: false } }, meta: {} }).why, 'text_changed');
  assert.equal(sessionMayAccept({ report: { ...REPORT, delivered_text: undefined }, meta: {} }).why, 'text_changed', 'no record of the text: the person\'s');
  // the person\'s other stops: a scan hit, the spending limit (and a raise of it), a conflict or a silent seat decided at the terminal
  for (const kind of ['secret_pause', 'budget_stop']) assert.equal(sessionMayAccept({ report: { ...REPORT, stop: { kind, chosen: 'finish' } }, meta: {} }).why, 'person_stop', kind);
  assert.equal(sessionMayAccept({ report: { ...REPORT, raises: [{ gate: 'g1' }] }, meta: {} }).why, 'person_stop');
  assert.equal(sessionMayAccept({ report: REPORT, meta: { conflictChoices: [{ pass: 1, via: 'cli' }] } }).why, 'person_stop');
  assert.equal(sessionMayAccept({ report: REPORT, meta: { seatChoices: [{ seat: 'a', via: 'cli' }] } }).why, 'person_stop');
});

test('P4 an acceptance is refused for a run that has not ended, one that ended agreed, and one already accepted; otherwise it may be asked', () => {
  assert.equal(acceptanceRefusal(null).code, 'not_ended');
  assert.equal(acceptanceRefusal({ ...REPORT, ending_word: 'signed_off', passed: true }).code, 'agreed');
  assert.equal(acceptanceRefusal({ ...REPORT, acceptance: { gate: 'g1' } }).code, 'already_accepted');
  assert.equal(acceptanceRefusal(REPORT), null);
  assert.equal(acceptanceRefusal({ ...REPORT, ending_word: 'signed_off', passed: true, final_read: { ran: true, run_end: 'agreed', seats: [{ read: true, meets: false }] } }), null, 'a signed-off run whose final read objected is not agreed, so it can be accepted');
});

test('P5 the line under the banner and its splice: it goes at the end of the banner block, gives the seat\'s Status back, and withoutAcceptance restores the clamped file exactly', () => {
  const seat = 'Status: ready_for_build\n\n## What this is\nA plan.\n';
  const clamped = clampStatus(seat, statusAllowedOf('round_cap', { agreed: false })).text;
  const banner = '> **Not a signed-off plan.** Written by the harness, not a model, from the latest draft of run r1 (`deliverable.md`).\n> The run finished with open objections. The panel did not sign off on the plan below.\n\n\n';
  const file = banner + clamped;
  const entry = { gate: 'g1', actor: 'maya', channel: 'cli', at: '2026-11-09T10:00:00.000Z', reason: 'The risk is mine to carry.', objections: [{ id: 'O-aaaaaaaa' }], status_restored: 'ready_for_build' };
  const accepted = withAcceptance(file, entry);
  assert.equal(accepted, banner.replace('\n\n\n', `\n${acceptanceLine(entry)}\n\n\n`) + seat);
  assert.match(acceptanceLine(entry), /^> \*\*Accepted as it stands\*\* by a choice typed at the terminal on 2026-11-09: The risk is mine to carry\. Open objections left standing, accepted as they stand: O-aaaaaaaa\. Written by the harness, not a model\.$/);
  assert.equal(withAcceptance(accepted, entry), accepted, 'applying twice changes nothing');
  assert.equal(withoutAcceptance(accepted, entry), file, 'the inverse gives back the file as the run wrote it (clamped Status and its note included)');
  // no clamp to lift: the line only
  const plain = banner + 'Status: needs_decision\n\n## What this is\n';
  const e2 = { ...entry }; delete e2.status_restored;
  assert.equal(withoutAcceptance(withAcceptance(plain, e2), e2), plain);
  assert.equal(withoutAcceptance('no line here', entry), 'no line here');
  assert.deepEqual([chooserWords({ channel: 'session' }), chooserWords({ channel: 'cli' })], ['the handling session', 'a choice typed at the terminal']);
  assert.equal(stripAcceptanceLines(accepted).includes('Accepted as it stands'), false);
});

test('P6 the reason: one line of plain text, at most 600 characters', () => {
  assert.deepEqual([acceptanceReasonProblem('A sentence.'), acceptanceReasonProblem(''), acceptanceReasonProblem('  '), acceptanceReasonProblem(undefined), acceptanceReasonProblem('two\nlines'), acceptanceReasonProblem('a'.repeat(601)), acceptanceReasonProblem('a'.repeat(600))], [null, 'empty', 'empty', 'empty', 'control', 'long', null]);
});

// ---- the gate layer
const V = (person, unsettled, preference, reason = 'The record settles it.') => ({ person, unsettled_by_record: unsettled, preference, reason });
const NO = { session: V('no', false, false), advisor: V('no', false, false, 'Agreed: a fact.') };
const YES = { session: V('yes', true, true, 'It turns on what they want.'), advisor: V('yes', true, true, 'Agreed: their preference.') };
const ONE_YES = { session: V('yes', true, true, 'It turns on what they want.'), advisor: V('no', false, false, 'A fact the record settles.') };
const T0 = Date.parse('2026-11-09T12:00:00.000Z'); const now = () => T0;
const run = () => { const base = mkdtempSync(join(tmpdir(), 'accept-gate-')); const d = join(base, 'r1'); mkdirSync(d); writeFileSync(join(d, 'accept-quote-0001.md'), '# Accept?\n'); return d; };
const answer = (objections, over = {}) => ({ advisor: 'consulted', advisor_said: 'Agreed: accept it.', objections, ...over });
const ask = (d, requestedBy) => { const g = requestGate(d, { kind: ACCEPTANCE_KIND, textPath: 'accept-quote-0001.md', ...(requestedBy ? { requestedBy } : {}) }, { now }); assert.equal(g.ok, true, JSON.stringify(g)); return g.gate; };
const sha = '#'; void sha;

test('G1 the session approves an acceptance only with its answer: none is refused, a list that is not per objection is refused, both-yes on an objection is refused (nothing recorded), one yes is recorded as over_disagreement', () => {
  const d = run(); const g = ask(d, 'session');
  const s = acceptance => answerAcceptanceAsSession(d, g.id, { shownSha256: g.sha256, reason: 'Nothing here changes the plan.', acceptanceAnswer: acceptance }, { now });
  assert.equal(s(undefined).code, 'acceptance_answer_required');
  assert.equal(s(answer([{ id: 'O-aaaaaaaa' }])).code, 'bad_acceptance_answer');
  assert.equal(s(answer([{ id: 'O-aaaaaaaa', person_test: NO }, { id: 'O-aaaaaaaa', person_test: NO }])).code, 'bad_acceptance_answer');
  assert.equal(s(answer([{ id: 'x', person_test: NO }])).code, 'bad_acceptance_answer');
  const both = s(answer([{ id: 'O-aaaaaaaa', person_test: NO }, { id: 'O-bbbbbbbb', person_test: YES }]));
  assert.deepEqual([both.ok, both.code], [false, 'bad_acceptance_answer']);
  assert.match(both.message, /O-bbbbbbbb: the session and its advisor both say this objection is the person's/);
  assert.deepEqual(acceptancesOf(d, { now }).accepted, [], 'nothing was recorded by any refusal');
  const ok = s(answer([{ id: 'O-aaaaaaaa', person_test: NO }, { id: 'O-bbbbbbbb', person_test: ONE_YES }]));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const found = acceptancesOf(d, { now });
  assert.equal(found.accepted.length, 1);
  assert.deepEqual([found.accepted[0].channel, found.accepted[0].requested_by, found.accepted[0].reason], ['session', 'session', 'Nothing here changes the plan.']);
  assert.deepEqual(found.accepted[0].acceptance_answer.over_disagreement, ['O-bbbbbbbb']);
  assert.deepEqual(found.accepted[0].acceptance_answer.objections.map(o => o.id), ['O-aaaaaaaa', 'O-bbbbbbbb']);
});

test('G2 a person approves at the terminal channel with a written reason and no answer; the session cannot approve a gate a person asked for, nor decline one; an answer given with a person\'s approval is refused', () => {
  const d = run(); const g = ask(d);
  const viaSession = answerAcceptanceAsSession(d, g.id, { shownSha256: g.sha256, reason: 'r', acceptanceAnswer: answer([{ id: 'O-aaaaaaaa', person_test: NO }]) }, { now });
  assert.equal(viaSession.code, 'gate_not_session_requested', 'the session answers only a gate it asked for itself');
  const withAnswer = answerGate(d, g.id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'maya', reason: 'I accept it.', tty: true, acceptanceAnswer: answer([]) }, { now });
  assert.equal(withAnswer.code, 'acceptance_answer_not_asked');
  const done = answerGate(d, g.id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'maya', reason: 'I accept it.', tty: true }, { now });
  assert.equal(done.ok, true, JSON.stringify(done));
  const [a] = acceptancesOf(d, { now }).accepted;
  assert.deepEqual([a.channel, a.actor, a.reason, a.requested_by, a.acceptance_answer], ['cli', 'maya', 'I accept it.', 'person', undefined]);
});

test('G3 an approval does not lapse, a pending gate is listed apart, and a gate whose text changed on disk is listed as unreadable, never dropped', () => {
  const d = run(); const g = ask(d);
  assert.deepEqual(acceptancesOf(d, { now }).pending.map(p => [p.gate, p.requested_by]), [['g1', 'person']]);
  assert.equal(answerGate(d, g.id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'maya', reason: 'ok', tty: true }, { now }).ok, true);
  const later = () => T0 + 30 * 24 * 3600 * 1000;
  assert.equal(acceptancesOf(d, { now: later }).accepted.length, 1, 'a month later it still counts');
  writeFileSync(join(d, 'accept-quote-0001.md'), '# Accept? (edited)\n');
  const found = acceptancesOf(d, { now });
  assert.deepEqual([found.accepted.length, found.unreadable.map(u => u.reason)], [0, ['hash_mismatch']]);
  assert.equal(textSha256(Buffer.from('# Accept?\n')), g.sha256);
});
