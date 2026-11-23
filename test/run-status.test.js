// v5 item 2: run identity and per-run liveness - unit tests for the pure/near-pure pieces of
// src/run-status.js, no CLI process spawned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveRunStatus, isAlivePid, waitingStage } from '../src/run-status.js';
import { readStoppedMarker } from '../src/stop-files.js';

function freshDir() { return mkdtempSync(join(tmpdir(), 'thc-run-status-')); }

test('isAlivePid: true for this process, false for a pid unlikely to exist', () => {
  assert.equal(isAlivePid(process.pid), true);
  assert.equal(isAlivePid(999999), false);
  assert.equal(isAlivePid(null), false);
  assert.equal(isAlivePid(undefined), false);
});

test('waitingStage: null with no NEEDS-*.md, the unanswered label once one exists, null once answered', () => {
  const dir = freshDir();
  try {
    assert.equal(waitingStage(dir), null);
    writeFileSync(join(dir, 'NEEDS-propose-external-proposer.md'), 'prompt');
    assert.equal(waitingStage(dir), 'propose-external-proposer');
    writeFileSync(join(dir, 'propose-external-proposer.md'), 'answer');
    assert.equal(waitingStage(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveRunStatus: done when report.json exists, regardless of anything else', () => {
  const dir = freshDir();
  try {
    writeFileSync(join(dir, 'report.json'), '{}');
    writeFileSync(join(dir, 'NEEDS-x.md'), 'x'); // would otherwise read as paused
    assert.equal(deriveRunStatus(dir, { pid: 999999 }), 'done');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveRunStatus: budget_stopped when STOPPED-budget.json exists and no report', () => {
  const dir = freshDir();
  try {
    writeFileSync(join(dir, 'STOPPED-budget.json'), '{}');
    assert.equal(deriveRunStatus(dir, { pid: 999999 }), 'budget_stopped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveRunStatus: paused when an unanswered NEEDS-*.md exists', () => {
  const dir = freshDir();
  try {
    writeFileSync(join(dir, 'NEEDS-build.md'), 'prompt');
    assert.equal(deriveRunStatus(dir, { pid: 999999 }), 'paused');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveRunStatus: running when the recorded pid is alive', () => {
  const dir = freshDir();
  try {
    assert.equal(deriveRunStatus(dir, { pid: process.pid }), 'running');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveRunStatus: stopped when the recorded pid is dead and nothing else applies', () => {
  const dir = freshDir();
  try {
    assert.equal(deriveRunStatus(dir, { pid: 999999 }), 'stopped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveRunStatus: a pre-v5 run.json with no pid still resolves through the grep fallback (never throws)', () => {
  const dir = freshDir();
  try {
    const status = deriveRunStatus(dir, { chain: 'x', task: 'y' }); // no pid field at all
    assert.ok(['running', 'stopped'].includes(status));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveRunStatus: also works with runMeta === null (no run.json at all)', () => {
  const dir = freshDir();
  try {
    const status = deriveRunStatus(dir, null);
    assert.ok(['running', 'stopped'].includes(status));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Bug audit 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #5): MCP run_status called a run
// whose security gate blocked "done: every lab signed off".
test('finishedRunState: a blocked or unjudged security gate is never reported as every lab signed off', async () => {
  const { finishedRunState } = await import('../src/run-status.js');
  assert.match(finishedRunState({ passed: true, security_review: { gate: 'blocked' } }), /security gate blocked - not a pass/);
  assert.match(finishedRunState({ passed: true, security_review: { gate: 'not_judged' } }), /security gate not_judged - not a pass/);
  // T2-4 (14 Oct 2026, C&C ruling, dated old bar -> new bar): a bare `{ passed: true }` has no signoff field, so the mode cannot be read from the record. It used to read 'done: every lab signed off'
  // (a claim the record could not show); it now reads the neutral 'done: passed'. A record whose signoff is an array (a unanimous run) keeps the old sentence.
  assert.equal(finishedRunState({ passed: true, signoff: [], security_review: { gate: 'pass' } }), 'done: every lab signed off');
  assert.equal(finishedRunState({ passed: true, security_review: { gate: 'pass' } }), 'done: passed');
  assert.equal(finishedRunState({ passed: true }), 'done: passed');
  assert.equal(finishedRunState({ passed: false }), 'done: open objections');
  // 0.8.2 item 5 first commit (C&C ruling on item 4, 6 Oct 2026): ADDITIVE, so an old matcher on "every lab signed off" still matches.
  const changed = { passed: true, signoff: [], delivered_text: { same_as_signed: false, changed_by: ['final_edit', 'challenge'] } };
  assert.match(finishedRunState(changed), /^done: every lab signed off/);
  assert.equal(finishedRunState(changed), 'done: every lab signed off, on the signed draft; the delivered text differs (changed by the final edit and the post-signoff challenge)');
  assert.equal(finishedRunState({ passed: true, signoff: [], delivered_text: { same_as_signed: true, changed_by: [] } }), 'done: every lab signed off');
  assert.equal(finishedRunState({ passed: false, delivered_text: { same_as_signed: false, changed_by: ['dispute'] } }), 'done: open objections', 'an unsigned run keeps its sentence');
  assert.equal(finishedRunState({ passed: true, signoff: [], delivered_text: { same_as_signed: false } }), 'done: every lab signed off, on the signed draft; the delivered text differs', 'a damaged record does not throw');
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: "an advice run stopped at exit 18 reads <cause>_stopped from its STOPPED-<cause>.json" (user, client_cancel, wall_clock -> user_stopped, client_cancel_stopped, wall_clock_stopped, even with a live pid and a torn marker). NEW: an old STOPPED-user / -client_cancel / -wall_clock file is no longer a stop marker: readStoppedMarker finds none and deriveRunStatus never returns a `<cause>_stopped` word (a dead folder reads 'stopped'). WHY: STOP_CAUSES lost those three causes with the add-on; the words stay in types/index.d.ts only as legacy.
test('deriveRunStatus (0.8.4): the three advice stop files of an old folder (STOPPED-user, -client_cancel, -wall_clock) are not stop markers any more; no <cause>_stopped word is returned', () => {
  for (const cause of ['user', 'client_cancel', 'wall_clock']) {
    const dir = freshDir();
    try {
      writeFileSync(join(dir, `STOPPED-${cause}.json`), JSON.stringify({ schema: 'stopped/1', stoppedBy: cause }));
      assert.equal(readStoppedMarker(dir), null, `${cause}: not a marker`);
      assert.equal(deriveRunStatus(dir, null), 'stopped', `${cause}: a folder with no live process and no known marker`);
      writeFileSync(join(dir, `STOPPED-${cause}.json`), 'torn');
      assert.equal(deriveRunStatus(dir, null), 'stopped', `${cause}: a torn file changes nothing`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
