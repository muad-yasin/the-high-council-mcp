// relay/test/spend.test.js
//
// Cross-run spend accounting. The property that matters most is the one a
// ledger file would have put at risk: bookkeeping must never be able to break
// a run. This implementation derives every figure from the run folders and
// writes nothing, so there is no write path to fail - these tests pin that,
// and that a missing or broken runs/ still produces a usable answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spendReport, runIdToDate } from '../src/spend.js';

const ID = n => `2026-09-11T1${n}-00-00-000Z`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-spend-'));
  const runs = join(dir, 'runs');
  mkdirSync(runs);
  const add = (id, files) => {
    const d = join(runs, id);
    mkdirSync(d);
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(d, name), typeof body === 'string' ? body : JSON.stringify(body));
    }
  };
  return { dir, runs, add };
}

test('runIdToDate parses a run id, and rejects anything else', () => {
  assert.equal(runIdToDate('2026-09-11T10-06-06-899Z').toISOString(), '2026-09-11T10:06:06.899Z');
  assert.equal(runIdToDate('not-a-run'), null);
});

test('sums completed runs and reports each one', () => {
  const { runs, add } = fixture();
  add(ID(0), { 'report.json': { chain: 'verify', totals: { usd: 0.25 } } });
  add(ID(1), { 'report.json': { chain: 'plan-debate', totals: { usd: 1.5 } } });
  const r = spendReport(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(r.count, 2);
  assert.ok(Math.abs(r.totalUsd - 1.75) < 1e-9);
  assert.deepEqual(r.runs.map(x => x.chain).sort(), ['plan-debate', 'verify']);
  assert.ok(r.runs.every(x => x.state === 'complete'));
});

test('a run with no report is still counted from the stages it paid for', () => {
  // A run that is still going, or that the cap stopped, has no report.json -
  // but the money was spent and must appear in the total anyway.
  const { runs, add } = fixture();
  add(ID(2), {
    'run.json': { chain: 'plan-auto' },
    'criteria.usage.json': { usd: 0.4 },
    'build.usage.json': { usd: 0.6 },
    'STOPPED-budget.json': { capUsd: 1 },
  });
  const r = spendReport(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(r.count, 1);
  assert.ok(Math.abs(r.totalUsd - 1.0) < 1e-9);
  assert.equal(r.runs[0].state, 'stopped: spend cap');
  assert.equal(r.runs[0].chain, 'plan-auto');
  assert.equal(r.runs[0].complete, false);
});

test('a paused run is labelled as paused, not as finished', () => {
  const { runs, add } = fixture();
  add(ID(3), { 'run.json': { chain: 'mock-questions-wait' }, 'NEEDS-answers.md': '# answer me' });
  const r = spendReport(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(r.runs[0].state, 'paused');
});

test('the window excludes older runs', () => {
  const { runs, add } = fixture();
  add('2026-09-01T10-00-00-000Z', { 'report.json': { totals: { usd: 99 } } });
  add(ID(4), { 'report.json': { totals: { usd: 1 } } });
  const r = spendReport(runs, { days: 1, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(r.count, 1);
  assert.equal(r.totalUsd, 1);
});

test('non-run directories in runs/ are ignored rather than crashing', () => {
  const { runs, add } = fixture();
  mkdirSync(join(runs, 'scratch-notes'));
  add(ID(5), { 'report.json': { totals: { usd: 2 } } });
  const r = spendReport(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(r.count, 1);
  assert.equal(r.totalUsd, 2);
});

// --- the degradation contract ----------------------------------------------
// A ledger file would need each of these to be a handled write failure. Here
// they are simply reads that find nothing, which is why this approach was
// chosen over appending to a dotfile.

test('a missing runs/ directory is an answer, not an error', () => {
  const r = spendReport(join(tmpdir(), 'thc-does-not-exist-' + Date.now()));
  assert.equal(r.count, 0);
  assert.equal(r.totalUsd, 0);
});

test('an unreadable runs/ directory degrades instead of throwing', { skip: process.getuid?.() === 0 && 'root ignores permissions' }, () => {
  const { runs } = fixture();
  chmodSync(runs, 0o000);
  try {
    const r = spendReport(runs);
    assert.equal(r.count, 0);
    assert.equal(r.totalUsd, 0);
    assert.match(r.note || '', /could not be read/);
  } finally {
    chmodSync(runs, 0o755);
  }
});

test('a corrupt report.json does not poison the total', () => {
  const { runs, add } = fixture();
  add(ID(6), { 'report.json': '{ this is not json' });
  add(ID(7), { 'report.json': { totals: { usd: 3 } } });
  const r = spendReport(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(r.totalUsd, 3);
  assert.equal(r.count, 2, 'the corrupt run is still listed, just at zero');
});

test('the report carries cost and chain, never the task', () => {
  // What a run was about is not spend data.
  const { runs, add } = fixture();
  add(ID(8), { 'report.json': { chain: 'verify', task: 'tasks/acquire-competitor.md', totals: { usd: 1 } } });
  const r = spendReport(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(JSON.stringify(r).includes('acquire-competitor'), false,
    'the task path must not appear in a spend report');
  assert.equal(r.runs[0].chain, 'verify');
});

test('spend accounting writes nothing at all', () => {
  // The whole design rests on this: no ledger, so no write can fail and take
  // a run down with it.
  const { dir, runs, add } = fixture();
  add(ID(9), { 'report.json': { totals: { usd: 1 } } });
  const before = tree(dir);
  spendReport(runs, { days: 30 });
  assert.deepEqual(tree(dir), before, 'spendReport must not touch the disk');
  rmSync(dir, { recursive: true, force: true });
});

function tree(d) {
  return readdirSync(d).sort().map(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? { [n]: tree(p) } : n;
  });
}
