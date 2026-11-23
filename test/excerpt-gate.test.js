// 0.8.4 D10 (plan A T5.5), slice 2a: the `excerpt_approval` gate kind in src/gate.js. One gate per pause; the screen is its text; the excerpts of the pause are bound in its metadata hash; approving it is one answer per
// excerpt (approve, edit, refuse), never a bare yes; the person's channels only; one `excerpts_recorded` line uses it up (not cut by the gate's expiry). No screen text, rows or terminal route here (2b, 2c). Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// guarded: on a tree without these exports (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { requestGate, answerGate, answerGateAsRelay, readGateAnswer, recordUse, recordExcerptsRecorded, excerptApprovalWaiting, metaSha256, USE_EVENTS, EXCERPT_APPROVAL_KIND, EXCERPTS_RECORDED_EVENT } = await import('../src/gate.js');
import { EVENTS, LEDGER_FILE, readLedger, appendEvent } from '../src/gate-ledger.js';

const T0 = Date.parse('2026-11-04T10:00:00.000Z'); const at = ms => () => T0 + ms; const MIN = 60_000;
const dirs = [];
const runDir = () => { const base = mkdtempSync(join(tmpdir(), 'thc-excerpt-gate-')); dirs.push(base); mkdirSync(join(base, 'runs')); const d = join(base, 'runs', 'r1'); mkdirSync(d); return d; };
import { afterEach } from 'node:test';
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const EX = [{ id: 'E-1', lines: '3-5', text_sha256: 'a'.repeat(64), shown_lines: 3 }, { id: 'E-2', lines: null, text_sha256: 'b'.repeat(64), shown_lines: 10 }];
function open(over = {}, { dir = runDir(), screen = 'SCREEN\n', name = 'screen.md', now = at(0) } = {}) {
  writeFileSync(join(dir, name), screen);
  const g = requestGate(dir, { kind: EXCERPT_APPROVAL_KIND, textPath: name, excerpts: EX, ...over }, { now });
  assert.equal(g.ok, true, JSON.stringify(g));
  return { dir, g: g.gate };
}
const APPROVE_BOTH = [{ id: 'E-1', decision: 'approve' }, { id: 'E-2', decision: 'approve' }];
const person = (g, over = {}) => ({ channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: APPROVE_BOTH, ...over });
const ledgerLines = dir => readFileSync(join(dir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('a request binds the list of the pause in the gate\'s metadata hash: the gate carries it, and a gate file whose list was edited reads as a mismatch', () => {
  const { dir, g } = open();
  assert.equal(g.kind, 'excerpt_approval');
  assert.deepEqual(g.excerpts, EX);
  assert.equal(readGateAnswer(dir, g.id, { now: at(1) }).status, 'pending');
  const file = join(dir, 'gates', `${g.id}.json`);
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...rec, excerpts: [{ ...rec.excerpts[0], shown_lines: 99 }, rec.excerpts[1]] }, null, 2));
  const read = readGateAnswer(dir, g.id, { now: at(2) });
  assert.deepEqual([read.status, read.reason], ['invalid', 'gate_record_mismatch']);
});

test('request refusals: no list, an empty one, too many, a bad id, a duplicate or descending id, a bad hash, bad lines, an extra key, shown_lines out of range - and `excerpts` on any other kind', () => {
  const dir = runDir(); writeFileSync(join(dir, 'screen.md'), 'S\n');
  const ok = (over = {}) => ({ ...EX[0], ...over });
  const cases = [
    ['no list', undefined], ['an empty list', []], ['twenty-one entries', Array.from({ length: 21 }, (_, i) => ok({ id: `E-${i + 1}` }))],
    ['a bad id', [ok({ id: 'E1' })]], ['a duplicate id', [ok(), ok()]], ['descending ids', [ok({ id: 'E-2' }), ok({ id: 'E-1' })]],
    ['a bad hash', [ok({ text_sha256: 'xyz' })]], ['backwards lines', [ok({ lines: '5-3' })]], ['an extra key', [{ ...ok(), text: 'secret' }]],
    ['shown_lines 0', [ok({ shown_lines: 0 })]], ['shown_lines a string', [ok({ shown_lines: '3' })]],
  ];
  for (const [what, excerpts] of cases) {
    const r = requestGate(dir, { kind: EXCERPT_APPROVAL_KIND, textPath: 'screen.md', excerpts }, { now: at(0) });
    assert.deepEqual([r.ok, r.code], [false, 'bad_excerpts'], what);
  }
  const other = requestGate(dir, { kind: 'advice', textPath: 'screen.md', excerpts: EX }, { now: at(0) });
  assert.deepEqual([other.ok, other.code], [false, 'bad_excerpts'], 'another kind takes no list');
  assert.match(other.message, /only an excerpt_approval gate takes excerpts/);
});

test('approving needs the answers: a bare approval is refused and recorded nowhere; declining stays allowed, needs none, and carries none', () => {
  const { dir, g } = open();
  const bare = answerGate(dir, g.id, person(g, { excerptAnswers: undefined }), { now: at(1) });
  assert.deepEqual([bare.ok, bare.code], [false, 'excerpt_answers_required']);
  assert.equal(readLedger(dir).lines.filter(l => l.event === 'gate_answered').length, 0);
  const declined = answerGate(dir, g.id, person(g, { decision: 'declined', excerptAnswers: undefined }), { now: at(2) });
  assert.equal(declined.ok, true, JSON.stringify(declined));
  const line = ledgerLines(dir).find(l => l.event === 'gate_answered');
  assert.deepEqual([line.decision, Object.hasOwn(line, 'excerpt_answers')], ['declined', false]);
  const { dir: d2, g: g2 } = open();
  const withAnswers = answerGate(d2, g2.id, person(g2, { decision: 'declined' }), { now: at(1) });
  assert.deepEqual([withAnswers.ok, withAnswers.code], [false, 'excerpt_answers_not_asked'], 'a decline takes no answers');
});

test('the answers are checked against the bound list: every refusal below writes nothing, and then a valid answer is recorded', () => {
  const { dir, g } = open();
  const E1 = { id: 'E-1', decision: 'approve' };
  const E2 = { id: 'E-2', decision: 'approve' };
  const cases = [
    ['not a list', 'yes'], ['a missing id', [E1]], ['a doubled id', [E1, E1, E2]], ['an id the gate does not bind', [E1, E2, { id: 'E-9', decision: 'approve' }]],
    ['an unknown decision', [E1, { id: 'E-2', decision: 'maybe' }]], ['an extra key', [E1, { ...E2, foo: 1 }]], ['an approval with a reason', [E1, { ...E2, reason: 'ok' }]],
    ['an edit that changes nothing', [{ id: 'E-1', decision: 'edit', lines: '1-3' }, E2]], ['an edit that names nothing', [{ id: 'E-1', decision: 'edit' }, E2]],
    ['lines outside what was shown', [{ id: 'E-1', decision: 'edit', lines: '2-4' }, E2]], ['backwards lines', [{ id: 'E-1', decision: 'edit', lines: '3-1' }, E2]],
    ['a hidden line outside the kept range', [E1, { id: 'E-2', decision: 'edit', lines: '2-5', hide: [1] }]], ['hidden lines not ascending', [E1, { id: 'E-2', decision: 'edit', hide: [3, 2] }]],
    ['every line hidden', [{ id: 'E-1', decision: 'edit', hide: [1, 2, 3] }, E2]], ['a refusal with a range', [E1, { id: 'E-2', decision: 'refuse', lines: '1-2' }]],
    ['a refusal reason that is not text', [E1, { id: 'E-2', decision: 'refuse', reason: 7 }]], ['an edit with a reason', [{ id: 'E-1', decision: 'edit', lines: '1-2', reason: 'x' }, E2]],
  ];
  const before = readLedger(dir).lines.length;
  for (const [what, excerptAnswers] of cases) {
    const r = answerGate(dir, g.id, person(g, { excerptAnswers }), { now: at(1) });
    assert.deepEqual([r.ok, r.code], [false, 'bad_excerpt_answers'], what);
  }
  assert.equal(readLedger(dir).lines.length, before, 'nothing was appended');
  assert.equal(answerGate(dir, g.id, person(g), { now: at(2) }).ok, true);
  const { dir: d2, g: g2 } = (() => { const d = runDir(); writeFileSync(join(d, 'a.md'), 'S\n'); const r = requestGate(d, { kind: 'advice', textPath: 'a.md' }, { now: at(0) }); return { dir: d, g: r.gate }; })();
  const notAsked = answerGate(d2, g2.id, { channel: 'cli', shownSha256: g2.sha256, decision: 'approved', actor: 'a', tty: true, excerptAnswers: APPROVE_BOTH }, { now: at(1) });
  assert.deepEqual([notAsked.ok, notAsked.code], [false, 'excerpt_answers_not_asked'], 'another kind takes no answers');
});

test('the recorded answer: the ledger line carries the canonical answers, actor, channel and time; a reason is cleaned like a declared name and NOT capped; the gate reads them back; an edited view file is a mismatch', () => {
  const { dir, g } = open();
  const reason = `x​y   ${'long '.repeat(500)}`.trim();
  const answers = [{ id: 'E-1', decision: 'edit', lines: '2-3', hide: [3] }, { id: 'E-2', decision: 'refuse', reason }];
  const r = answerGate(dir, g.id, person(g, { excerptAnswers: answers }), { now: at(1) });
  assert.equal(r.ok, true, JSON.stringify(r));
  const cleaned = reason.replace('​', ' ').replace(/ +/g, ' ');
  assert.ok(cleaned.length > 2000, 'a reason of 2000+ characters is kept whole');
  const line = ledgerLines(dir).find(l => l.event === 'gate_answered');
  assert.deepEqual(line.excerpt_answers, [{ id: 'E-1', decision: 'edit', lines: '2-3', hide: [3] }, { id: 'E-2', decision: 'refuse', reason: cleaned }]);
  assert.deepEqual([line.channel, line.actor, line.decision, line.ts], ['cli', 'alice', 'approved', new Date(T0 + 1).toISOString()]);
  const read = readGateAnswer(dir, g.id, { now: at(2) });
  assert.deepEqual([read.status, read.answer.excerpt_answers], ['approved', line.excerpt_answers]);
  // an approval of a refusal with no reason records the absence as null
  const { dir: d3, g: g3 } = open();
  assert.equal(answerGate(d3, g3.id, person(g3, { excerptAnswers: [{ id: 'E-1', decision: 'refuse' }, { id: 'E-2', decision: 'refuse', reason: '   ' }] }), { now: at(1) }).ok, true);
  assert.deepEqual(ledgerLines(d3).find(l => l.event === 'gate_answered').excerpt_answers.map(a => a.reason), [null, null]);
  // the view file edited to disagree with the ledger
  const file = join(dir, 'gates', `${g.id}.json`);
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  rec.answer.excerpt_answers = APPROVE_BOTH;
  writeFileSync(file, JSON.stringify(rec, null, 2));
  assert.equal(readGateAnswer(dir, g.id, { now: at(3) }).reason, 'gate_record_mismatch');
});

test('channels: the person\'s (cli and elicitation) answer it; the session cannot, a relay cannot, and a gate the session itself requested is still not the session\'s to answer', () => {
  const { dir, g } = open();
  const session = answerGate(dir, g.id, { channel: 'session', shownSha256: g.sha256, decision: 'approved', actor: 'main-session', reason: 'looks fine', excerptAnswers: APPROVE_BOTH }, { now: at(1) });
  assert.deepEqual([session.ok, session.code], [false, 'channel_not_session_eligible']);
  const relay = answerGateAsRelay(dir, g.id, { shownSha256: g.sha256, reason: 'relayed', personWords: 'yes, approve them' }, { now: at(1) });
  assert.deepEqual([relay.ok, relay.code], [false, 'channel_not_session_eligible']);
  assert.equal(answerGate(dir, g.id, person(g, { channel: 'mcp' }), { now: at(1) }).code, 'channel_not_person');
  const { dir: d2, g: g2 } = open({ requestedBy: 'session' });
  assert.equal(answerGate(d2, g2.id, { channel: 'session', shownSha256: g2.sha256, decision: 'approved', actor: 'main-session', reason: 'x', excerptAnswers: APPROVE_BOTH }, { now: at(1) }).code, 'channel_not_session_eligible');
  assert.equal(answerGate(dir, g.id, person(g), { now: at(2) }).ok, true, 'the terminal');
  assert.equal(readLedger(dir).lines.filter(l => l.event === 'gate_answered').length, 1, 'only the terminal answer was recorded');
  const { dir: d3, g: g3 } = open();
  assert.equal(answerGate(d3, g3.id, person(g3, { channel: 'elicitation', actor: 'claude-code' }), { now: at(2) }).ok, true, 'the client\'s dialog is a person channel too (its route is the pause unit\'s)');
});

test('no replay: an answer made against another screen\'s hash is refused, so are answers for another gate\'s excerpts, and so is an answer that names a gate that does not exist', () => {
  const { dir, g } = open();
  const other = open({ excerpts: [{ id: 'E-3', lines: null, text_sha256: 'c'.repeat(64), shown_lines: 4 }] }, { dir, name: 'screen2.md', screen: 'ANOTHER SCREEN\n', now: at(0) }).g;
  assert.notEqual(other.sha256, g.sha256);
  assert.equal(answerGate(dir, g.id, person(g, { shownSha256: other.sha256 }), { now: at(1) }).code, 'hash_mismatch');
  assert.equal(answerGate(dir, 'g9', person(g), { now: at(1) }).code, 'gate_not_found', 'an answer naming a gate that does not exist is refused');
  const r = answerGate(dir, other.id, person(other), { now: at(1) });   // gate A's answers (E-1, E-2) on gate B (binds E-3)
  assert.deepEqual([r.ok, r.code], [false, 'bad_excerpt_answers']);
  assert.equal(answerGate(dir, other.id, person(other, { excerptAnswers: [{ id: 'E-3', decision: 'refuse' }] }), { now: at(2) }).ok, true);
});

test('the use: ONE excerpts_recorded line (gate, hash, run, count); a second is refused; a declined gate may be used; an unanswered gate, another kind and a wrong count may not; recordUse cannot write it', () => {
  const { dir, g } = open();
  assert.equal(recordExcerptsRecorded(dir, g.id, { runId: 'r1', count: 2 }, { now: at(1) }).code, 'gate_not_answered');
  answerGate(dir, g.id, person(g), { now: at(2) });
  assert.equal(recordExcerptsRecorded(dir, g.id, { runId: 'r1', count: 1 }, { now: at(3) }).code, 'bad_count', 'the recording covers each bound excerpt');
  assert.equal(recordExcerptsRecorded(dir, g.id, { runId: 'bad id', count: 2 }, { now: at(3) }).code, 'bad_run_id');
  assert.equal(recordUse(dir, g.id, 'excerpts_recorded', { run_id: 'r1', count: 2 }, { now: at(3) }).code, 'bad_event', 'the generic writer cannot write it');
  const used = recordExcerptsRecorded(dir, g.id, { runId: 'r1', count: 2 }, { now: at(3) });
  assert.equal(used.ok, true, JSON.stringify(used));
  const line = ledgerLines(dir).find(l => l.event === 'excerpts_recorded');
  assert.deepEqual([line.gate, line.sha256, line.run_id, line.count], [g.id, g.sha256, 'r1', 2]);
  assert.equal(recordExcerptsRecorded(dir, g.id, { runId: 'r1', count: 2 }, { now: at(4) }).code, 'gate_used');
  assert.equal(readGateAnswer(dir, g.id, { now: at(5) }).used, true);
  const { dir: d2, g: g2 } = open();
  answerGate(d2, g2.id, person(g2, { decision: 'declined', excerptAnswers: undefined }), { now: at(1) });
  assert.equal(recordExcerptsRecorded(d2, g2.id, { runId: 'r1', count: 2 }, { now: at(2) }).ok, true, 'a declined gate (refuse-all) is recorded all the same');
  const d3 = runDir(); writeFileSync(join(d3, 'a.md'), 'S\n');
  const adv = requestGate(d3, { kind: 'advice', textPath: 'a.md' }, { now: at(0) }).gate;
  answerGate(d3, adv.id, { channel: 'cli', shownSha256: adv.sha256, decision: 'approved', actor: 'a', tty: true }, { now: at(1) });
  assert.equal(recordExcerptsRecorded(d3, adv.id, { runId: 'r1', count: 1 }, { now: at(2) }).code, 'not_excerpt_approval');
});

test('the use is not cut by the gate\'s ten minutes: answered at minute 5, recorded at minute 90 (an unanswered gate would have expired at minute 10)', () => {
  const { dir, g } = open();
  assert.equal(answerGate(dir, g.id, person(g), { now: at(5 * MIN) }).ok, true);
  assert.equal(readGateAnswer(dir, g.id, { now: at(90 * MIN) }).usable, false, 'the generic "usable" window is over');
  const used = recordExcerptsRecorded(dir, g.id, { runId: 'r1', count: 2 }, { now: at(90 * MIN) });
  assert.equal(used.ok, true, JSON.stringify(used));
});

test('excerptApprovalWaiting: pending, expired-unanswered, answered and declined gates all wait until their excerpts_recorded line; a used one does not; none gives []; a ledger that does not verify is a refusal', () => {
  const dir = runDir();
  assert.deepEqual(excerptApprovalWaiting(dir), { ok: true, waiting: [] });
  const a = open({}, { dir, name: 'a.md', now: at(0) }).g;
  assert.deepEqual(excerptApprovalWaiting(dir, { now: at(MIN) }).waiting, [{ gate: a.id, status: 'pending' }]);
  assert.deepEqual(excerptApprovalWaiting(dir, { now: at(30 * MIN) }).waiting, [{ gate: a.id, status: 'expired' }], 'an expired gate still holds the run');
  const b = open({}, { dir, name: 'b.md', screen: 'B\n', now: at(31 * MIN) }).g;
  answerGate(dir, b.id, person(b), { now: at(32 * MIN) });
  assert.deepEqual(excerptApprovalWaiting(dir, { now: at(33 * MIN) }).waiting.map(w => [w.gate, w.status]), [[a.id, 'expired'], [b.id, 'approved']]);
  recordExcerptsRecorded(dir, b.id, { runId: 'r1', count: 2 }, { now: at(34 * MIN) });
  assert.deepEqual(excerptApprovalWaiting(dir, { now: at(35 * MIN) }).waiting.map(w => w.gate), [a.id], 'a used gate no longer waits');
  const c = open({}, { dir, name: 'c.md', screen: 'C\n', now: at(36 * MIN) }).g;
  answerGate(dir, c.id, person(c, { decision: 'declined', excerptAnswers: undefined }), { now: at(37 * MIN) });
  assert.deepEqual(excerptApprovalWaiting(dir, { now: at(38 * MIN) }).waiting.map(w => [w.gate, w.status]), [[a.id, 'expired'], [c.id, 'declined']]);
  appendFileSync(join(dir, LEDGER_FILE), '{"schema":"gate-ledger/1","seq":99}\n');
  const broken = excerptApprovalWaiting(dir);
  assert.deepEqual([broken.ok, broken.code], [false, 'gate_ledger_corrupt']);
});

test('the ledger knows the event: it is in the closed list and in the use list, it is not a public event, and the metadata hash of every other gate is unchanged (an absent list adds nothing)', () => {
  assert.ok(EVENTS.includes('excerpts_recorded'));
  assert.ok(USE_EVENTS.includes('excerpts_recorded'));
  assert.equal(EXCERPTS_RECORDED_EVENT, 'excerpts_recorded');
  assert.throws(() => appendEvent(runDir(), 'excerpts_recorded', { gate: 'g1' }), /not an event this function writes/);
  const meta = { price: null, seats: [], sensitivity: null, masks: {} };
  assert.equal(metaSha256(meta), createHash('sha256').update('{"masks":{},"price":null,"seats":[],"sensitivity":null}').digest('hex'));
});

test('a gate of another kind is unchanged by all of this: an advice gate is requested, answered and used as before, and the run\'s waiting list stays empty', () => {
  const dir = runDir(); writeFileSync(join(dir, 'a.md'), 'S\n');
  const g = requestGate(dir, { kind: 'advice', textPath: 'a.md' }, { now: at(0) }).gate;
  assert.equal(answerGate(dir, g.id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'a', tty: true }, { now: at(1) }).ok, true);
  assert.equal(recordUse(dir, g.id, 'sent', { run: 'r1' }, { now: at(2) }).ok, true);
  assert.equal(readGateAnswer(dir, g.id, { now: at(3) }).used, true);
  assert.deepEqual(excerptApprovalWaiting(dir), { ok: true, waiting: [] });
});
