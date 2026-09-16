// relay/test/peer-claim.test.js
//
// v3 plan §1 (~/Projects/relay/runs/2026-09-13T12-46-02-088Z/deliverable.md), GLM-1 accepted
// (peer-session claim/staleness), MISTRAL-1 cut (same idea, invented nonexistent files).
// Offline, no API key - matches the tmp-run-folder fixture pattern already used by
// test/resume-brief.test.js and test/cache-integrity.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkClaimStaleness, writeClaim, readClaimFor } from '../src/peer-claim.js';
import { submitStageAnswer } from '../src/stage-submission.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));

function fixtureRunDir() {
  return mkdtempSync(join(tmpdir(), 'peer-claim-test-'));
}

// (a) a stale claim with no answer -> stalled_claim
test('checkClaimStaleness: a claim with no matching answer, older than the timeout, is stalled_claim', () => {
  const dir = fixtureRunDir();
  try {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    writeClaim(dir, 'build', 'cnc-harness-a7', { now: () => threeHoursAgo });
    const warning = checkClaimStaleness(dir, 'build', { timeoutMs: 2 * 60 * 60 * 1000 });
    assert.ok(warning, 'expected a stalled_claim warning');
    assert.equal(warning.type, 'stalled_claim');
    assert.equal(warning.claimed_by, 'cnc-harness-a7');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (b) a second, different claimant before any answer -> contested_claim
test('checkClaimStaleness: a second, different claimed_by written before any answer lands is contested_claim', () => {
  const dir = fixtureRunDir();
  try {
    writeClaim(dir, 'build', 'cnc-harness-a7');
    writeClaim(dir, 'build', 'thcmcp-cb');
    const warning = checkClaimStaleness(dir, 'build');
    assert.ok(warning, 'expected a contested_claim warning');
    assert.equal(warning.type, 'contested_claim');
    assert.equal(warning.claimed_by, 'cnc-harness-a7', 'the first claimant is kept as the record of first claim');
    assert.deepEqual(warning.contested_by, ['thcmcp-cb']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (c) a claim then the matching answer within the timeout -> no warning
test('checkClaimStaleness: a claim followed by its matching answer, within the timeout, warns of nothing', () => {
  const dir = fixtureRunDir();
  try {
    writeClaim(dir, 'build', 'cnc-harness-a7');
    writeFileSync(join(dir, 'build.md'), 'the answer');
    assert.equal(checkClaimStaleness(dir, 'build'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkClaimStaleness: no claim at all warns of nothing', () => {
  const dir = fixtureRunDir();
  try {
    assert.equal(checkClaimStaleness(dir, 'build'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (d) submit_stage-equivalent: claimed_by that doesn't match an existing claim -> claim_mismatch
test('submitStageAnswer: a claimed_by that differs from an existing claim is claim_mismatch', () => {
  const dir = fixtureRunDir();
  try {
    writeClaim(dir, 'build', 'cnc-harness-a7');
    const { warnings } = submitStageAnswer(dir, 'build', '# A real draft\n\nContent here.', { claimedBy: 'thcmcp-cb' });
    const mismatch = warnings.find(w => w.type === 'claim_mismatch');
    assert.ok(mismatch, 'expected a claim_mismatch warning');
    assert.equal(mismatch.claim_holder, 'cnc-harness-a7');
    assert.equal(mismatch.claimed_by, 'thcmcp-cb');
    // Warn-only: the answer is still written.
    assert.equal(readFileSync(join(dir, 'build.md'), 'utf8'), '# A real draft\n\nContent here.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (e) an answer missing a required section for its stage kind -> stage_validation_failed,
// naming the missing section (reusing test/partial-deliverable.test.js's own fixture for what
// an invalid "criteria"-kind answer looks like: JSON missing the "criteria" key).
test('submitStageAnswer: an answer missing a required section for its stage kind is stage_validation_failed, naming the missing section', () => {
  const dir = fixtureRunDir();
  try {
    const { warnings } = submitStageAnswer(dir, 'criteria', JSON.stringify({ notCriteria: [] }), { chainConfig: mockConfig });
    const failed = warnings.find(w => w.type === 'stage_validation_failed');
    assert.ok(failed, 'expected a stage_validation_failed warning');
    assert.deepEqual(failed.missing, ['criteria']);
    // Warn-only: the answer is still written.
    assert.ok(existsSync(join(dir, 'criteria.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('submitStageAnswer: a valid answer for its stage kind carries no stage_validation_failed warning', () => {
  const dir = fixtureRunDir();
  try {
    const { warnings } = submitStageAnswer(dir, 'build', '# A real draft\n\nContent here.', { chainConfig: mockConfig });
    assert.equal(warnings.find(w => w.type === 'stage_validation_failed'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (f) submit_stage called twice for the same stage -> duplicate_answer, both files survive
test('submitStageAnswer: a second submission for an already-answered stage is duplicate_answer, and both files survive on disk', () => {
  const dir = fixtureRunDir();
  try {
    const first = submitStageAnswer(dir, 'build', 'the first, careful answer');
    assert.equal(first.isDuplicate, false);
    const second = submitStageAnswer(dir, 'build', 'a second, later answer');
    assert.equal(second.isDuplicate, true);
    const dup = second.warnings.find(w => w.type === 'duplicate_answer');
    assert.ok(dup, 'expected a duplicate_answer warning');
    assert.deepEqual(dup.kept.sort(), ['build.late.md', 'build.md'].sort());
    assert.equal(readFileSync(join(dir, 'build.md'), 'utf8'), 'the first, careful answer', 'the original answer must never be silently overwritten');
    assert.equal(readFileSync(join(dir, 'build.late.md'), 'utf8'), 'a second, later answer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readClaimFor: reads back exactly what writeClaim wrote', () => {
  const dir = fixtureRunDir();
  try {
    writeClaim(dir, 'build', 'cnc-harness-a7');
    const claim = readClaimFor(dir, 'build');
    assert.equal(claim.claimed_by, 'cnc-harness-a7');
    assert.ok(claim.claimed_at);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Bug-audit fix, 2026-09-16: writeClaim's original two-branch logic silently discarded an
// active contested_by record whenever the ORIGINAL claimant re-claimed (e.g. a retry) before
// any answer existed - `existing.claimed_by === claimedBy` made the "different claimant"
// branch false, so it fell into the plain "write a fresh claim" else branch, losing the record
// that a second claimant had ever shown up.
test('writeClaim: the original claimant re-claiming does not silently discard an already-contested record (bug-audit finding)', () => {
  const dir = fixtureRunDir();
  try {
    writeClaim(dir, 'build', 'cnc-harness-a7');
    writeClaim(dir, 'build', 'thcmcp-cb'); // contests it
    const contested = readClaimFor(dir, 'build');
    assert.deepEqual(contested.contested_by, ['thcmcp-cb']);

    // The ORIGINAL claimant re-claims (e.g. retrying) before any answer exists.
    writeClaim(dir, 'build', 'cnc-harness-a7');

    const stillContested = readClaimFor(dir, 'build');
    assert.deepEqual(stillContested.contested_by, ['thcmcp-cb'], 'the contest record must survive the original claimant re-claiming');
    assert.equal(stillContested.claimed_by, 'cnc-harness-a7');

    const warning = checkClaimStaleness(dir, 'build');
    assert.ok(warning, 'expected the contested_claim warning to still fire after the re-claim');
    assert.equal(warning.type, 'contested_claim');
    assert.deepEqual(warning.contested_by, ['thcmcp-cb']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeClaim: the original claimant re-claiming with NO contest yet still writes a plain fresh claim (no regression)', () => {
  const dir = fixtureRunDir();
  try {
    writeClaim(dir, 'build', 'cnc-harness-a7');
    const second = writeClaim(dir, 'build', 'cnc-harness-a7');
    assert.equal(second.claimed_by, 'cnc-harness-a7');
    assert.equal(second.contested_by, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
