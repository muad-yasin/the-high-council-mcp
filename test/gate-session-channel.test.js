// 0.8.3 M7 SESSION CHANNEL, the gate layer (C&C thcmcp-6d rulings 19 Okt 2026): the controlling session may answer a gate of a TREE decision kind with a written reason, and nothing else.
// PERSON_CHANNELS is unchanged; a send-path gate (advice and every other kind) stays a person's, or the session could approve its own paid send. The fence by FORM is the tree table (test/tree-keep.test.js, tree-answered-by.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestGate, answerGate, readGateAnswer, textSha256, PERSON_CHANNELS, SESSION_CHANNEL, SESSION_ELIGIBLE_KINDS } from '../src/gate.js';
import { readLedger } from '../src/gate-ledger.js';
import { requestTreeGate, treeApproval } from '../src/tree-gate.js';

const T0 = Date.parse('2026-10-19T12:00:00.000Z'); const at = ms => () => ms;
const runDir = () => { const base = mkdtempSync(join(tmpdir(), 'gate-session-')); mkdirSync(join(base, 'runs')); const d = join(base, 'runs', 'r1'); mkdirSync(d); return d; };
const session = (sha, extra = {}) => ({ channel: SESSION_CHANNEL, shownSha256: sha, decision: 'approved', actor: 'main-session', reason: 'the open question belongs to a later milestone', tty: false, ...extra });

test('the person channels are unchanged, and the session channel is listed apart for the two tree kinds only', () => {
  assert.deepEqual([...PERSON_CHANNELS], ['cli', 'elicitation']);
  // EDITED, disclosed (OLD: ['tree_decide'] alone; the frontier gate was closed until the Atomic conditions existed: they are now checked by src/tree-approve-session.js and the frontier_approved table row)
  assert.equal(SESSION_CHANNEL, 'session'); assert.deepEqual([...SESSION_ELIGIBLE_KINDS], ['tree_decide', 'tree_frontier']);
});

test('SEND PATH: a session answer on an advice gate is refused with its own code, even with a reason, and nothing is appended', () => {
  const d = runDir(); writeFileSync(join(d, 'advice-brief.md'), 'The brief.\n');
  const g = requestGate(d, { kind: 'advice', textPath: 'advice-brief.md' }, { now: at(T0) }); assert.equal(g.ok, true);
  const before = readLedger(d).lines.length;
  const r = answerGate(d, g.gate.id, session(g.gate.sha256), { now: at(T0 + 1) });
  assert.equal(r.code, 'channel_not_session_eligible', JSON.stringify(r));
  assert.equal(readLedger(d).lines.length, before, 'nothing was appended');
  assert.equal(readGateAnswer(d, g.gate.id, { now: at(T0 + 2) }).status, 'pending');
  assert.equal(answerGate(d, g.gate.id, { channel: 'mcp', shownSha256: g.gate.sha256, decision: 'approved', actor: 'x' }, { now: at(T0 + 1) }).code, 'channel_not_person', 'every other channel is still refused');
});

test('FRONTIER GATE: a session answer on a tree_frontier gate a PERSON asked for is refused (only a gate the session requested is its to answer), nothing appended', () => {
  const d = runDir();
  const g = requestTreeGate(d, { kind: 'tree_frontier', text: 'Approve the children?\n' }, { now: at(T0) }); assert.equal(g.ok, true, g.message);
  const before = readLedger(d).lines.length;
  assert.equal(answerGate(d, g.gate.id, session(g.gate.sha256), { now: at(T0 + 1) }).code, 'gate_not_session_requested');
  assert.equal(readLedger(d).lines.length, before);
});

test('REQUESTER MARK (6d: the ledger hole): the session may answer only a gate the SESSION requested; a gate a person asked for stays the person\'s, and the person may answer any gate', () => {
  const d = runDir();
  const byPerson = requestTreeGate(d, { kind: 'tree_decide', text: 'Abandon-like text a person asked for.\n' }, { now: at(T0) }); assert.equal(byPerson.ok, true);
  const before = readLedger(d).lines.length;
  assert.equal(answerGate(d, byPerson.gate.id, session(byPerson.gate.sha256), { now: at(T0 + 1) }).code, 'gate_not_session_requested', 'the session cannot answer the person\'s pending gate');
  assert.equal(readLedger(d).lines.length, before, 'nothing appended');
  const bySession = requestTreeGate(d, { kind: 'tree_decide', text: 'Accept R/M1@g1 as it is?\n', requestedBy: 'session' }, { now: at(T0) });
  assert.equal(readLedger(d).lines.find(l => l.event === 'gate_requested' && l.gate === bySession.gate.id).requested_by, 'session', 'the mark is on the hash-chained ledger line');
  assert.equal(answerGate(d, bySession.gate.id, { channel: 'cli', shownSha256: bySession.gate.sha256, decision: 'approved', actor: 'tester', tty: true }, { now: at(T0 + 1) }).ok, true, 'the person may answer a session-requested gate');
  assert.equal(answerGate(d, byPerson.gate.id, { channel: 'cli', shownSha256: byPerson.gate.sha256, decision: 'approved', actor: 'tester', tty: true }, { now: at(T0 + 1) }).ok, true);
});

test('TREE GATE: the session answers a tree_decide gate only with a written reason; the tree reads it as the session via mcp with that reason; a person\'s answer reads as before', () => {
  const d = runDir();
  const g = requestTreeGate(d, { kind: 'tree_decide', text: 'Accept R/M1@g1 as it is?\n', requestedBy: 'session' }, { now: at(T0) }); assert.equal(g.ok, true, g.message);
  assert.equal(answerGate(d, g.gate.id, session(g.gate.sha256, { reason: '  ' }), { now: at(T0 + 1) }).code, 'session_reason_required');
  const ok = answerGate(d, g.gate.id, session(g.gate.sha256), { now: at(T0 + 1) }); assert.equal(ok.ok, true, JSON.stringify(ok));
  const a = treeApproval(d, g.gate.id, { kind: 'tree_decide', now: at(T0 + 2) });
  assert.equal(a.approved, true, a.reason);
  assert.deepEqual(a.answeredBy, { actor: 'session', via: 'mcp', reason: 'the open question belongs to a later milestone' });
  // a person at a terminal: as before
  const d2 = runDir(); const g2 = requestTreeGate(d2, { kind: 'tree_decide', text: 'Accept R/M1@g1 as it is?\n' }, { now: at(T0) });
  assert.equal(answerGate(d2, g2.gate.id, { channel: 'cli', shownSha256: g2.gate.sha256, decision: 'approved', actor: 'tester', tty: true }, { now: at(T0 + 1) }).ok, true);
  assert.deepEqual(treeApproval(d2, g2.gate.id, { kind: 'tree_decide', now: at(T0 + 2) }).answeredBy, { actor: 'person', via: 'terminal' });
  void textSha256;
});
