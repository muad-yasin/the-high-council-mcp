// test/withdrawal-ledger.test.js
//
// v5 §1 candidate 3: withdrawal-chain termination check. A withdrawn
// proposal must resolve to a proposal that is still standing; a cycle or a
// dead end leaves a section with no surviving owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withdrawalLedger } from '../src/withdrawal-ledger.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

test('test_orphaned_section_detection: A withdraws for B, B withdraws for A - one orphaned section', () => {
  const proposals = [
    { id: 'A-1', lab: 'a', withdrawn: true, replaced_by: 'B-1' },
    { id: 'B-1', lab: 'b', withdrawn: true, replaced_by: 'A-1' },
    { id: 'C-1', lab: 'c', withdrawn: false },
  ];
  const r = withdrawalLedger(proposals);
  assert.deepEqual(r.orphanSections, ['A-1', 'B-1']);
  assert.equal(r.withdrawalCycles, 1);
});

test('a withdrawal chain that resolves to a surviving proposal is not orphaned', () => {
  const proposals = [
    { id: 'A-1', lab: 'a', withdrawn: true, replaced_by: 'B-1' },
    { id: 'B-1', lab: 'b', withdrawn: false },
  ];
  const r = withdrawalLedger(proposals);
  assert.deepEqual(r.orphanSections, []);
  assert.equal(r.withdrawalCycles, 0);
});

test('a withdrawal with no replaced_by is a dead end and is orphaned, but not a cycle', () => {
  const proposals = [
    { id: 'A-1', lab: 'a', withdrawn: true, replaced_by: null },
  ];
  const r = withdrawalLedger(proposals);
  assert.deepEqual(r.orphanSections, ['A-1']);
  assert.equal(r.withdrawalCycles, 0);
});

test('a three-node cycle is detected as one cycle covering all three ids', () => {
  const proposals = [
    { id: 'A-1', lab: 'a', withdrawn: true, replaced_by: 'B-1' },
    { id: 'B-1', lab: 'b', withdrawn: true, replaced_by: 'C-1' },
    { id: 'C-1', lab: 'c', withdrawn: true, replaced_by: 'A-1' },
  ];
  const r = withdrawalLedger(proposals);
  assert.deepEqual(r.orphanSections, ['A-1', 'B-1', 'C-1']);
  assert.equal(r.withdrawalCycles, 1);
});

test('runtime stays well under 50ms on a ledger the size of the largest observed run', () => {
  const proposals = [];
  for (let i = 0; i < 157; i++) {
    const withdrawn = i < 15;
    proposals.push({ id: `P-${i}`, lab: `lab${i % 6}`, withdrawn, replaced_by: withdrawn ? `P-${(i + 1) % 157}` : undefined });
  }
  const start = Date.now();
  withdrawalLedger(proposals);
  assert.ok(Date.now() - start < 50, 'withdrawalLedger must stay under 50ms on a 157-proposal ledger');
});

test('empty and undefined proposals never throw', () => {
  assert.deepEqual(withdrawalLedger([]), { orphanSections: [], withdrawalCycles: 0 });
  assert.deepEqual(withdrawalLedger(undefined), { orphanSections: [], withdrawalCycles: 0 });
});

test('council doctor --run: exits 1 and names the orphan for a fixture with a mutual withdrawal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-doctor-run-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify({
    proposals: [
      { id: 'A-1', lab: 'a', withdrawn: true, replaced_by: 'B-1' },
      { id: 'B-1', lab: 'b', withdrawn: true, replaced_by: 'A-1' },
    ],
  }));
  assert.throws(() => execFileSync('node', [cli, 'doctor', '--run', dir], { encoding: 'utf8' }));
  try {
    execFileSync('node', [cli, 'doctor', '--run', dir], { encoding: 'utf8' });
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr, /withdrawal cycle detected/);
    assert.match(err.stderr, /A-1/);
    assert.match(err.stderr, /B-1/);
  }
});

test('council doctor --run: exits 0 on a run with no orphaned withdrawals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-doctor-run-clean-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify({
    proposals: [{ id: 'A-1', lab: 'a', withdrawn: false }],
  }));
  const out = execFileSync('node', [cli, 'doctor', '--run', dir], { encoding: 'utf8' });
  assert.match(out, /No orphaned withdrawal chains/);
});

// Handoff.md, explicitly: run candidate 3 against the run folder that
// authored it. Inside relay/runs/2026-09-13T14-51-08-757Z/'s own debate,
// KIMI-4 and MISTRAL-2 mutually withdrew in each other's favour - a
// naturally-occurring instance of the exact orphaning bug this candidate
// exists to catch. Used here as a regression fixture, not only synthetic
// ones. Skipped (not failed) if that relay run folder isn't present on
// this machine - it lives outside this repo.
test('regression: the relay run that authored this candidate has a real mutual-withdrawal orphan (KIMI-4 / MISTRAL-2)', t => {
  const reportPath = resolve(here, '../../relay/runs/2026-09-13T14-51-08-757Z/report.json');
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { t.skip('relay run folder not present on this machine'); return; }

  const r = withdrawalLedger(report.proposals || []);
  assert.ok(r.orphanSections.includes('KIMI-4'), 'candidate 3 must catch the real KIMI-4/MISTRAL-2 mutual withdrawal - KIMI-4 missing from orphanSections');
  assert.ok(r.orphanSections.includes('MISTRAL-2'), 'candidate 3 must catch the real KIMI-4/MISTRAL-2 mutual withdrawal - MISTRAL-2 missing from orphanSections');
});
