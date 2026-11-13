// 0.8.4 D5a (plan A T4.3; Mini-C&C R357): the `stop_decision` gate the handling session answers (src/gate.js, src/stop-gate.js) and the CLI's entry site that reads it (src/cli.js, --continue / --finish). Offline, $0:
// the gate tests need no run; the CLI tests make a real round stop with the mock chain and drive the real verb.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { readGateAnswer, requestGate } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
// a guarded import: on a tree without the module (the red tree of the unit) each row fails by name, not one load failure for the file
const { answerStopQuote, deferStopQuote, pendingStopQuote, requestStopQuote, stopDecisionAnswerOf } = await import('../src/stop-gate.js').catch(() => ({}));
import { stoppedProject, untilRunIdle } from './helpers/round-stop-project.js';
import { gateCommand } from '../src/gate-cli.js';

const T0 = Date.parse('2026-11-04T12:00:00.000Z');
const now = () => T0 + 1000;
const STOP = 'overseer_cap:2:2';
const V = (person, unsettled, preference, reason = 'The record settles it.') => ({ person, unsettled_by_record: unsettled, preference, reason });
const PT_NO = { session: V('no', false, false), advisor: V('no', false, false, 'Agreed: a fact.') };
const PT_YES = { session: V('yes', true, true, 'It turns on what they want.'), advisor: V('yes', true, true, 'Agreed: their preference.') };
const ANSWER = { reason: 'The open objection is a fact the record settles.', choice: 'continue', advisor: 'consulted', advisorSaid: 'Agreed: one more round.', personTest: PT_NO };
const DEFER = { reason: 'Which objection to give up is theirs to say.', advisor: 'consulted', advisorSaid: 'Agreed: theirs to say.', personTest: PT_YES };
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function gateFixture({ requestedBy = 'session', stop = STOP } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'stop-gate-')); dirs.push(base);
  const d = join(base, 'run-1'); mkdirSync(d);
  writeFileSync(join(d, 'stop-quote-0001.md'), `Stop ${STOP}: the run stopped.\nChoices: continue | finish.`);
  const r = requestGate(d, { kind: 'stop_decision', textPath: 'stop-quote-0001.md', stop: { id: stop }, ...(requestedBy ? { requestedBy } : {}) }, { now });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { d, gate: r.gate };
}
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('SG-1 a stop_decision gate binds the stop it is about: { id } in the form kind:overseer_round:pass, nothing else; no other kind takes one', () => {
  const base = mkdtempSync(join(tmpdir(), 'stop-gate-')); dirs.push(base);
  const d = join(base, 'run-1'); mkdirSync(d); writeFileSync(join(d, 'q.md'), 'q');
  for (const stop of [undefined, null, {}, { id: 'nope' }, { id: 'overseer_cap:2' }, { id: STOP, extra: 1 }, STOP]) {
    const r = requestGate(d, { kind: 'stop_decision', textPath: 'q.md', stop, requestedBy: 'session' }, { now });
    assert.equal(r.ok, false, JSON.stringify(stop));
    assert.equal(r.code, 'bad_stop', JSON.stringify(stop));
  }
  const other = requestGate(d, { kind: 'advice', textPath: 'q.md', stop: { id: STOP } }, { now });
  assert.deepEqual([other.ok, other.code], [false, 'bad_stop']);
  assert.equal(requestGate(d, { kind: 'stop_decision', textPath: 'q.md', stop: { id: 'layer_bound:3:5' }, requestedBy: 'session' }, { now }).ok, true);
});

test('SG-2 the session answers only a gate IT asked for; a gate a person asked for is answered by the person', () => {
  const mine = gateFixture();
  assert.equal(answerStopQuote(mine.d, mine.gate.id, { shownSha256: mine.gate.sha256, ...ANSWER }, { now }).ok, true);
  const theirs = gateFixture({ requestedBy: null });
  const got = answerStopQuote(theirs.d, theirs.gate.id, { shownSha256: theirs.gate.sha256, ...ANSWER }, { now });
  assert.equal(got.ok, false);
  assert.equal(got.code, 'gate_not_session_requested');
  assert.equal(ledger(theirs.d).some(l => l.event === 'gate_answered'), false);
});

test('SG-3 the session\'s answer is one canonical record on the ledger line: choice, advisor, advisor_said, with the reason, on the session channel; an answer that is not that shape records nothing', () => {
  const g = gateFixture();
  const refused = [
    [{ ...ANSWER, reason: '' }, 'session_reason_required'], [{ ...ANSWER, reason: undefined }, 'session_reason_required'],
    [{ ...ANSWER, choice: 'reopen' }, 'bad_stop_answer'], [{ ...ANSWER, choice: undefined }, 'bad_stop_answer'], [{ ...ANSWER, advisor: 'yes' }, 'bad_stop_answer'],
    [{ ...ANSWER, advisorSaid: '' }, 'bad_stop_answer'], [{ ...ANSWER, advisor: 'none' }, 'bad_stop_answer'], [{ ...ANSWER, advisor: 'unavailable', advisorSaid: 'x' }, 'bad_stop_answer'],
    [{ ...ANSWER, personTest: undefined }, 'bad_stop_answer'], [{ ...ANSWER, personTest: { session: PT_NO.session } }, 'bad_stop_answer'], [{ ...ANSWER, personTest: PT_YES }, 'bad_stop_answer'],
  ];
  for (const [input, code] of refused) {
    const got = answerStopQuote(g.d, g.gate.id, { shownSha256: g.gate.sha256, ...input }, { now });
    assert.equal(got.ok, false, JSON.stringify(input));
    assert.equal(got.code, code, JSON.stringify(input));
  }
  assert.equal(ledger(g.d).some(l => l.event === 'gate_answered'), false, 'nothing was recorded by any refusal');
  const wrongHash = answerStopQuote(g.d, g.gate.id, { shownSha256: 'f'.repeat(64), ...ANSWER }, { now });
  assert.deepEqual([wrongHash.ok, wrongHash.code], [false, 'hash_mismatch']);
  assert.equal(answerStopQuote(g.d, g.gate.id, { shownSha256: g.gate.sha256, ...ANSWER, advisorSaid: ' Agreed: one more round. ' }, { now }).ok, true);
  const line = ledger(g.d).find(l => l.event === 'gate_answered');
  assert.deepEqual([line.channel, line.actor, line.decision, line.tty, line.reason], ['session', 'main-session', 'approved', false, ANSWER.reason]);
  assert.deepEqual(line.stop_answer, { choice: 'continue', advisor: 'consulted', advisor_said: 'Agreed: one more round.', person_test: PT_NO, over_disagreement: false });
  assert.equal(readGateAnswer(g.d, g.gate.id, { now }).status, 'approved');
});

test('SG-4 the CLI\'s reader finds the answered gate for THIS stop and THIS choice, and nothing else: another choice, another stop, a deferred (declined) gate, a pending one, an expired one, a gate a person asked for', () => {
  const g = gateFixture();
  assert.equal(stopDecisionAnswerOf(g.d, STOP, 'continue', { now }), null, 'pending: nothing yet');
  answerStopQuote(g.d, g.gate.id, { shownSha256: g.gate.sha256, ...ANSWER }, { now });
  const a = stopDecisionAnswerOf(g.d, STOP, 'continue', { now });
  assert.deepEqual({ ...a, at: typeof a.at }, { gate: g.gate.id, actor: 'handling_session', channel: 'session', at: 'string', reason: ANSWER.reason, advisor: 'consulted', advisor_said: 'Agreed: one more round.', person_test: PT_NO, over_disagreement: false });
  assert.equal(a.at, ledger(g.d).find(l => l.event === 'gate_answered').ts, 'the time is the ledger line\'s');
  assert.equal(stopDecisionAnswerOf(g.d, STOP, 'finish', { now }), null, 'another choice');
  assert.equal(stopDecisionAnswerOf(g.d, 'overseer_cap:3:3', 'continue', { now }), null, 'another stop');
  assert.equal(stopDecisionAnswerOf(g.d, STOP, 'continue', { now: () => T0 + 1000 + 9 * 60_000 })?.gate, g.gate.id, 'nine minutes after the answer: still the session\'s');
  assert.equal(stopDecisionAnswerOf(g.d, STOP, 'continue', { now: () => T0 + 1000 + 11 * 60_000 }), null, 'eleven minutes after the answer: a later choice, not the session\'s');
  const deferred = gateFixture();
  assert.equal(deferStopQuote(deferred.d, deferred.gate.id, { shownSha256: deferred.gate.sha256, ...DEFER }, { now }).ok, true);
  assert.equal(stopDecisionAnswerOf(deferred.d, STOP, 'continue', { now }), null, 'a deferral is the person\'s to answer');
  const dl = ledger(deferred.d).find(l => l.event === 'gate_answered');
  assert.deepEqual([dl.decision, dl.channel, dl.reason, Object.hasOwn(dl, 'stop_answer'), dl.stop_defer], ['declined', 'session', DEFER.reason, false, { advisor: 'consulted', advisor_said: 'Agreed: theirs to say.', person_test: PT_YES }]);
});

test('SG-5 a quote of an unchanged stop reuses its pending gate; a changed text or another stop gets none; the gate file edited by hand (the stop it names) no longer reads', () => {
  const g = gateFixture();
  assert.equal(pendingStopQuote(g.d, STOP, g.gate.sha256, { now }).id, g.gate.id);
  assert.equal(pendingStopQuote(g.d, STOP, 'a'.repeat(64), { now }), null);
  assert.equal(pendingStopQuote(g.d, 'layer_bound:2:2', g.gate.sha256, { now }), null);
  writeFileSync(join(g.d, 'report-partial.json'), JSON.stringify({ stop: { kind: 'overseer_cap', overseer_round: 2, pass: 2 } }));   // CHANGED ACCEPTED (0.8.4 ladder unit): the question is asked only of a stop that was read (OLD bar: the fixture had no report file)
  assert.equal(requestStopQuote(g.d, { textPath: 'stop-quote-0001.md', stopId: STOP }, { now }).ok, true, 'a second request is a second gate: reuse is the caller\'s choice');
  const rec = JSON.parse(readFileSync(join(g.d, 'gates', `${g.gate.id}.json`), 'utf8'));
  writeFileSync(join(g.d, 'gates', `${g.gate.id}.json`), JSON.stringify({ ...rec, stop: { id: 'overseer_cap:9:9' } }));
  assert.equal(readGateAnswer(g.d, g.gate.id, { now }).status, 'invalid');
  assert.equal(readGateAnswer(g.d, g.gate.id, { now }).reason, 'gate_record_mismatch');
});

// ---- the real verb: `council --resume <run> --continue` on a real round stop
const stopIdOf = p => { const s = JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8')).stop; return `${s.kind}:${s.overseer_round}:${s.pass}`; };
function sessionAnswer(p, choice, extra = {}) {
  const stop = stopIdOf(p);
  writeFileSync(join(p.runDir, 'stop-quote-0001.md'), `Stop ${stop}: a test quote.`);
  const asked = requestStopQuote(p.runDir, { textPath: 'stop-quote-0001.md', stopId: stop });
  assert.equal(asked.ok, true, JSON.stringify(asked));
  const done = answerStopQuote(p.runDir, asked.gate.id, { shownSha256: asked.gate.sha256, ...ANSWER, choice, ...extra });
  assert.equal(done.ok, true, JSON.stringify(done));
  return { stop, gate: asked.gate.id };
}

test('SG-6 (real verb) a choice typed at the terminal is recorded as a CLI choice: actor unknown, channel cli, the time, besides what the entry always held', async () => {
  const p = stoppedProject('g6');
  try {
    const r = p.run(['--resume', p.runDir, '--continue']);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    await untilRunIdle(p.runDir);
    const e = p.runJson().roundChoices[0];
    assert.deepEqual([e.stop, e.choice, e.kind, e.add, e.actor, e.channel], ['overseer_cap:2:2', 'continue', 'overseer_cap', 1, 'unknown', 'cli']);
    assert.match(e.at, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    assert.equal(Object.hasOwn(e, 'reason'), false);
    assert.equal(Object.hasOwn(e, 'gate'), false);
  } finally { p.done(); }
});

test('SG-7 (real verb; CHANGED 10 Nov: OLD bar: the resume found the answered gate by stop and choice, with no gate on the command line; NEW: the command line names it, --stop-gate <id>, as the MCP tool passes it) with the session\'s answered gate for this stop and this choice, the entry takes who chose, when and why from the hash-chained ledger, with the gate\'s id', async () => {
  const p = stoppedProject('g7');
  try {
    const { stop, gate } = sessionAnswer(p, 'continue');
    const r = p.run(['--resume', p.runDir, '--continue', '--stop-gate', gate]);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    await untilRunIdle(p.runDir);
    const e = p.runJson().roundChoices[0];
    const line = readFileSync(join(p.runDir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(l => l.event === 'gate_answered');
    assert.deepEqual({ ...e, at: undefined }, { stop, choice: 'continue', kind: 'overseer_cap', overseer_round: 2, add: 1, actor: 'handling_session', channel: 'session', at: undefined, reason: ANSWER.reason, advisor: 'consulted', advisor_said: ANSWER.advisorSaid, person_test: PT_NO, over_disagreement: false, gate });
    assert.equal(e.at, line.ts, 'the time of the ledger line, not of the CLI');
  } finally { p.done(); }
});

test('SG-8 (real verb; CHANGED 10 Nov) the session\'s answer is for the choice it gave: the terminal typing the OTHER choice is a CLI choice and the gate is not claimed for it (OLD: found by stop and choice); naming that gate with the other choice is refused, nothing recorded', async () => {
  const p = stoppedProject('g8');
  try {
    const { gate } = sessionAnswer(p, 'finish');
    const named = p.run(['--resume', p.runDir, '--continue', '--stop-gate', gate]);
    assert.equal(named.status, 2, named.stdout + named.stderr);
    assert.match(named.stderr, /no answered stop_decision gate of this run by that name matches this stop/);
    assert.equal(p.runJson().roundChoices, undefined, 'nothing recorded');
    const r = p.run(['--resume', p.runDir, '--continue']);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    await untilRunIdle(p.runDir);
    const e = p.runJson().roundChoices[0];
    assert.deepEqual([e.choice, e.actor, e.channel, Object.hasOwn(e, 'gate')], ['continue', 'unknown', 'cli', false]);
  } finally { p.done(); }
});

test('SG-9 an answer given just before the gate\'s expiry is still the session\'s when the resume reads it a moment after the expiry (the ledger says the session chose; the entry must not say a person typed it)', () => {
  const base = mkdtempSync(join(tmpdir(), 'stop-gate-')); dirs.push(base);
  const d = join(base, 'run-1'); mkdirSync(d); writeFileSync(join(d, 'q.md'), `Stop ${STOP}: x`);
  const r = requestGate(d, { kind: 'stop_decision', textPath: 'q.md', stop: { id: STOP }, requestedBy: 'session', expiresAt: T0 + 60_000 }, { now: () => T0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(answerStopQuote(d, r.gate.id, { shownSha256: r.gate.sha256, ...ANSWER }, { now: () => T0 + 59_000 }).ok, true);
  assert.equal(stopDecisionAnswerOf(d, STOP, 'continue', { now: () => T0 + 62_000 })?.gate, r.gate.id, 'three seconds after the expiry, four after the answer');
  const late = answerStopQuote(d, r.gate.id, { shownSha256: r.gate.sha256, ...ANSWER }, { now: () => T0 + 90_000 });
  assert.equal(late.ok, false, 'a gate that has been answered is not answered again');
});

test('SG-10 (real verb) a person looking at the session\'s question sees lines of its own kind (no price or seats) and cannot approve it there: the stop is answered with the resume choice; nothing is written, and declining stays possible', async () => {
  const g = gateFixture();
  const io = (typed, tty = true) => {
    const stdin = new PassThrough(); stdin.isTTY = tty; stdin.setRawMode = () => {}; const stdout = new PassThrough(); stdout.isTTY = tty; const stderr = new PassThrough();
    let shown = ''; let errs = ''; stdout.on('data', x => { shown += x; }); stderr.on('data', x => { errs += x; }); for (const t of typed) stdin.write(`${t}\n`);
    return { stdin, stdout, stderr, shown: () => shown, errs: () => errs };
  };
  const work = join(g.d, '..');
  const show = io([]);
  assert.equal(await gateCommand(['show', basename(g.d), g.gate.id], { work, ...show, now }), 0, show.errs());
  assert.match(show.shown(), /gate g1 \(stop_decision\): stop-quote-0001\.md/);
  assert.match(show.shown(), /this is the handling session's question about a stop of the run; the stop itself is answered with council --resume and the continue or finish choice/);
  assert.doesNotMatch(show.shown(), /price:|seats:|sensitivity/);
  const approve = io(['y']);
  assert.equal(await gateCommand(['answer', basename(g.d), g.gate.id], { work, ...approve, now }), 1);
  assert.match(approve.errs(), /this is the handling session's question about a stop\. Answer the stop itself with council --resume runs\/run-1 and the continue or finish choice\. Nothing was written\./);
  assert.equal(ledger(g.d).some(l => l.event === 'gate_answered'), false);
  const decline = io(['y']);
  assert.equal(await gateCommand(['answer', basename(g.d), g.gate.id, '--decline'], { work, ...decline, now }), 0, decline.errs());
  assert.equal(ledger(g.d).find(l => l.event === 'gate_answered').decision, 'declined');
});

test('SG-11 26b (R494): a stop_decision gate takes the id of a STALL stop (stall_stop, overseer round 0 on a chain with no overseer rounds), and still refuses any other kind, a missing number or a non-number', () => {
  const base = mkdtempSync(join(tmpdir(), 'stop-gate-')); dirs.push(base);
  const d = join(base, 'run-1'); mkdirSync(d); writeFileSync(join(d, 'q.md'), 'q');
  const ask = id => requestGate(d, { kind: 'stop_decision', textPath: 'q.md', stop: { id }, requestedBy: 'session' }, { now });
  for (const ok of ['stall_stop:0:3', 'stall_stop:2:5']) assert.equal(ask(ok).ok, true, ok);
  for (const bad of ['stall_stop:x:3', 'stall_stop:1', 'conflict:1:1', 'budget:1:1', 'stall_stop:1:2:3']) assert.equal(ask(bad).code, 'bad_stop', bad);
});
