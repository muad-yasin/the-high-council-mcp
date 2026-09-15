// v5 item 2: run identity and per-run liveness - unit tests for the pure/near-pure pieces of
// src/run-status.js, no CLI process spawned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveRunStatus, isAlivePid, waitingStage } from '../src/run-status.js';

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
