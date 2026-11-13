// 0.8.4 unit 1 (C&C 09 Nov 2026, last FIX item): an excerpt gate the person has ANSWERED and no resume has applied yet is a state of the run, like an approved limit gate (awaitingUserCap): with the privacy switch on a resume applies the
// answers, and run_status says so (status awaiting_excerpt_approval, resumable, reason excerpt_answers_to_apply, needs resume, the gate), instead of "stopped / process_gone / needs nothing". A pending gate (and, with the switch off,
// an answered one) still stops a resume and keeps its earlier answer. Namespace import: the new export is absent at the parent, and the rows fail by themselves there. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as RS from '../src/run-status.js';
import { requestGate, answerGate, readGateAnswer, recordExcerptSwitchOn, recordExcerptsRecorded } from '../src/gate.js';

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const EX = [{ id: 'E-1', lines: null, text_sha256: 'a'.repeat(64), shown_lines: 2 }];
function gateIn({ on = true, decision = null, ago = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-answered-')); dirs.push(dir);
  writeFileSync(join(dir, 'excerpt-screen.md'), 'Excerpt 1 of 1\n1  one\n2  two\n');
  if (on) assert.equal(recordExcerptSwitchOn(dir, { source: 'flag' }).ok, true);
  const t0 = Date.now() - ago * 60_000;   // `ago` minutes in the past it was asked (a gate lives ten minutes)
  assert.equal(requestGate(dir, { kind: 'excerpt_approval', textPath: 'excerpt-screen.md', excerpts: EX }, { now: () => t0 }).ok, true);
  if (decision) {
    const g = readGateAnswer(dir, 'g1').gate;
    const done = answerGate(dir, 'g1', decision === 'approved'
      ? { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: [{ id: 'E-1', decision: 'approve' }] }
      : { channel: 'cli', shownSha256: g.sha256, decision: 'declined', actor: 'alice', tty: true });
    assert.equal(done.ok, true, JSON.stringify(done));
  }
  return dir;
}

test('ANSWERED, switch on: run_status reads awaiting_excerpt_approval, resumable, the resume applies the answers (approved and declined alike)', () => {
  for (const decision of ['approved', 'declined']) {
    const dir = gateIn({ decision });
    assert.equal(RS.deriveRunStatus(dir, null), 'awaiting_excerpt_approval', decision);
    const r = RS.runResumability(dir, null);
    assert.deepEqual([r.resumable, r.reason, r.needs, r.gate], [true, 'excerpt_answers_to_apply', 'resume', 'g1'], decision);
    assert.equal(r.exitCode, undefined, 'a resume is not refused, so there is no exit 26 to name');
  }
});

test('EXPIRED, switch on: the next resume asks again, so run_status reads awaiting_excerpt_approval, resumable, reason excerpt_gate_expired, needs resume', () => {
  const dir = gateIn({ ago: 60 });
  assert.equal(RS.deriveRunStatus(dir, null), 'awaiting_excerpt_approval');
  const r = RS.runResumability(dir, null);
  assert.deepEqual([r.resumable, r.reason, r.needs, r.gate], [true, 'excerpt_gate_expired', 'resume', 'g1']);
});

test('PENDING (switch on) and ANSWERED or EXPIRED with the switch OFF still stop a resume: not resumable, needs excerpt_approval, exit 26', () => {
  for (const dir of [gateIn({ decision: null }), gateIn({ on: false, decision: 'approved' }), gateIn({ on: false, ago: 60 })]) {
    assert.equal(RS.deriveRunStatus(dir, null), 'awaiting_excerpt_approval');
    const r = RS.runResumability(dir, null);
    assert.deepEqual([r.resumable, r.reason, r.needs, r.gate, r.exitCode], [false, 'awaiting_excerpt_approval', 'excerpt_approval', 'g1', 26]);
  }
});

test('APPLIED: once the use line is written the run no longer reads awaiting_excerpt_approval', () => {
  const dir = gateIn({ decision: 'approved' });
  assert.equal(recordExcerptsRecorded(dir, 'g1', { runId: 'r1', count: 1 }).ok, true);
  assert.notEqual(RS.deriveRunStatus(dir, null), 'awaiting_excerpt_approval');
});

test('the words (text pin on src/mcp/server.js): the state sentence says the answers are in and the next resume applies them (expired: asks again)', () => {
  const server = readFileSync(new URL('../src/mcp/server.js', import.meta.url), 'utf8');
  assert.match(server, /the approval expired unanswered and the next resume asks again/);
  assert.match(server, /the person's answers are in \(\$\{awaitingExcerptResume\(dir\)\?\.status === 'declined' \? 'declined' : 'approved'\}\) and the next resume applies them`\} \(nothing was run and nothing was spent\)/);
});

// A gate asked AGAIN (an expired one, or an answered one whose file changed) is superseded by the newer gate for the same ids: an expired gate never gets a use line, so it stays in the ledger's waiting list for the rest of the run
// and must not be read as the state once the newer gate is used (C&C 09 Nov 2026; the advisor's check of the expired case).
function askAgain(dir, { decision = 'approved', used = true } = {}) {
  assert.equal(requestGate(dir, { kind: 'excerpt_approval', textPath: 'excerpt-screen.md', excerpts: EX }).ok, true);
  if (decision) {
    const g = readGateAnswer(dir, 'g2').gate;
    assert.equal(answerGate(dir, 'g2', { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: [{ id: 'E-1', decision: 'approve' }] }).ok, true);
  }
  if (used) assert.equal(recordExcerptsRecorded(dir, 'g2', { runId: 'r1', count: 1 }).ok, true);
}

test('RE-ASKED, g1 answered and left unused, g2 for the same ids answered and used: the run is not awaiting_excerpt_approval (g1 is superseded)', () => {
  const dir = gateIn({ decision: 'approved' });
  askAgain(dir);
  assert.notEqual(RS.deriveRunStatus(dir, null), 'awaiting_excerpt_approval');
});

test('RE-ASKED, g1 expired, g2 for the same ids answered and used: the run is not awaiting_excerpt_approval (an expired gate never gets a use line and must not stay the state)', () => {
  const dir = gateIn({ ago: 60 });
  askAgain(dir);
  assert.notEqual(RS.deriveRunStatus(dir, null), 'awaiting_excerpt_approval');
});

test('RE-ASKED, g1 expired, g2 asked and waiting for the person: the state is g2 (a gate that waits stops a resume), not resumable, exit 26', () => {
  const dir = gateIn({ ago: 60 });
  askAgain(dir, { decision: null, used: false });
  const r = RS.runResumability(dir, null);
  assert.deepEqual([r.status, r.resumable, r.needs, r.gate, r.exitCode], ['awaiting_excerpt_approval', false, 'excerpt_approval', 'g2', 26]);
});

