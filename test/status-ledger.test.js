// V6-1 (relay/runs/2026-09-15T15-13-25-950Z/deliverable.md) - offline acceptance test for
// STATUS-LEDGER.md, per the plan's own acceptance test wording: for each row, assert the cited
// file exists at HEAD, the status is one of the four allowed values, and no row reads "assumed"
// or "TBD". Read-only: never runs a chain, never touches network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const ledgerPath = join(repoRoot, 'STATUS-LEDGER.md');
const ALLOWED_STATUSES = ['Built', 'Partial', 'Not started', 'Cut'];

// A cited path in the Evidence column looks like `src/x.js`, `docs/y.md`,
// `coder-gate-agent-stub/src/z.js`, or a bare commit hash (`8318b18`) - only the file-shaped
// ones (contain a `/` or a recognised extension) are checked for existence; a commit hash alone
// is not independently re-verifiable offline without a clone-side git log and is out of this
// test's scope (the ledger's own header states it was checked by reading the real git log once).
function citedPaths(evidenceCell) {
  const codeSpans = [...evidenceCell.matchAll(/`([^`]+)`/g)].map(m => m[1]);
  return codeSpans.filter(p => p.includes('/') && !/^[0-9a-f]{7,10}$/i.test(p));
}

function resolveCitedPath(p) {
  if (p.startsWith('coder-gate-agent-stub/')) {
    return resolve(repoRoot, '..', p);
  }
  return resolve(repoRoot, p);
}

function parseRows(markdown) {
  const lines = markdown.split('\n');
  const tableStart = lines.findIndex(l => l.trim().startsWith('| v5 GUI feature'));
  assert.ok(tableStart >= 0, 'STATUS-LEDGER.md must contain the v5 GUI feature table');
  const rows = [];
  for (let i = tableStart + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) break;
    const cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => !(idx === 0 || idx === arr.length - 1) || c !== '');
    // split('|') on "| a | b | c |" yields ['', ' a ', ' b ', ' c ', ''] - drop the two empty ends.
    const trimmed = line.split('|').slice(1, -1).map(c => c.trim());
    rows.push({ feature: trimmed[0], status: trimmed[1], evidence: trimmed[2] });
  }
  return rows;
}

const ledgerText = readFileSync(ledgerPath, 'utf8');
const rows = parseRows(ledgerText);

test('1. STATUS-LEDGER.md exists and has at least the 7 v5 GUI feature rows', () => {
  assert.ok(existsSync(ledgerPath));
  assert.ok(rows.length >= 7, `expected >= 7 rows, got ${rows.length}`);
});

test('2. every row\'s status is one of Built / Partial / Not started / Cut', () => {
  for (const row of rows) {
    assert.ok(ALLOWED_STATUSES.includes(row.status), `row "${row.feature}" has status "${row.status}"`);
  }
});

test('3. no row reads "assumed" or "TBD" anywhere in its cells', () => {
  for (const row of rows) {
    const text = `${row.feature} ${row.status} ${row.evidence}`;
    assert.ok(!/\bassumed\b/i.test(text), `row "${row.feature}" contains "assumed"`);
    assert.ok(!/\bTBD\b/i.test(text), `row "${row.feature}" contains "TBD"`);
  }
});

test('4. every cited file path in a row\'s Evidence column exists on disk, in this repo or the named sibling repo', () => {
  for (const row of rows) {
    const paths = citedPaths(row.evidence);
    assert.ok(paths.length > 0, `row "${row.feature}" cites no checkable file path`);
    for (const p of paths) {
      assert.ok(existsSync(resolveCitedPath(p)), `row "${row.feature}" cites "${p}" (resolved: ${resolveCitedPath(p)}), which does not exist`);
    }
  }
});

test('5. the Project A overlap section names at least one already-built stub file that exists on disk', () => {
  assert.match(ledgerText, /coder-gate-agent-stub/);
  const stubPaths = [...ledgerText.matchAll(/`(coder-gate-agent-stub\/[^`]+)`/g)].map(m => m[1]);
  assert.ok(stubPaths.length > 0, 'no coder-gate-agent-stub path cited');
  for (const p of stubPaths) assert.ok(existsSync(resolveCitedPath(p)), `${p} does not exist`);
});
