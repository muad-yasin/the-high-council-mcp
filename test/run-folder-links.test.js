// A symbolic link in runs/ is never a run (found 11 Oct 2026 by A's fixture work; present since the spend report's first commit 57f4ebe, 2026-09-11). Every reader that walks runs/ asks ONE predicate, `runFolderKind` in
// src/run-files.js (lstat, never following a link; the check trustedRunDir already makes): spendReport, costToday, metricsReport, verdictStats and forecastCost. A link is counted apart (`symbolicLinksNotCounted`), neither read as a second
// run nor swallowed in silence. The harness itself never makes a link, so a link means a clone, a copy or a person's own doing. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFolderKind } from '../src/run-files.js';
import { spendReport, costToday } from '../src/spend.js';
import { metricsReport } from '../src/metrics.js';
import { verdictStats } from '../src/verdict-stats.js';
import { forecastCost } from '../src/cost-forecast.js';
import { readLedger } from '../src/advice-guards.js';
import { dailyUsage } from '../src/http-server.js';
import { track } from './helpers/temp-trees.js';

const REAL = '2026-10-11T10-00-00-000Z', LINK = '2026-10-11T11-00-00-000Z', DANGLING = '2026-10-11T12-00-00-000Z';
const NOW = Date.parse('2026-10-11T13:00:00Z');
const report = { chain: 'mock', task: 't.md', passed: true, outcome: 'ok', totals: { usd: 0.04 }, stages: [{ label: 'build', provider: 'mock', model: 'm', usd: 0.04 }], signoff: [], proposals: [], dropouts: [], debate: null };

function runsWithLinks() {
  const base = track(mkdtempSync(join(tmpdir(), 'thc-links-')));
  const runs = join(base, 'runs'); mkdirSync(runs);
  mkdirSync(join(runs, REAL)); writeFileSync(join(runs, REAL, 'report.json'), JSON.stringify(report));
  symlinkSync(join(runs, REAL), join(runs, LINK));                       // a link to a real run: its report would be read a second time
  symlinkSync(join(runs, 'no-such-folder'), join(runs, DANGLING));       // a dangling link
  return runs;
}

test('runFolderKind: a real folder is a folder, a link (even a dangling one) is a link, a file is other, nothing is missing; it never follows a link', () => {
  const runs = runsWithLinks();
  assert.equal(runFolderKind(join(runs, REAL)), 'folder');
  assert.equal(runFolderKind(join(runs, LINK)), 'link');
  assert.equal(runFolderKind(join(runs, DANGLING)), 'link');
  writeFileSync(join(runs, 'afile'), 'x'); assert.equal(runFolderKind(join(runs, 'afile')), 'other');
  assert.equal(runFolderKind(join(runs, 'nothing')), 'missing');
});

test('spendReport and costToday count a symbolic link to a run ZERO times and report it apart (`symbolicLinksNotCounted`); the total is the real run once', () => {
  const runs = runsWithLinks();
  const r = spendReport(runs, { days: 5, now: NOW });
  assert.deepEqual(r.runs.map(x => x.id), [REAL]); assert.equal(r.count, 1); assert.equal(r.totalUsd, 0.04); assert.equal(r.symbolicLinksNotCounted, 2);
  const t = costToday(runs, { date: new Date('2026-10-11T12:00:00') });
  assert.equal(t.count, 1); assert.equal(t.totalUsd, 0.04); assert.equal(t.symbolicLinksNotCounted, 2);
  assert.equal(spendReport(join(runs, '..', 'nothing-here'), { days: 5, now: NOW }).symbolicLinksNotCounted, 0, 'no runs folder: links 0, still a usable answer');
});

test('the three telemetry readers use the same predicate: metrics, verdict stats and the cost forecast see the real run once and report the links', () => {
  const runs = runsWithLinks();
  const m = metricsReport(runs, { days: 5, now: NOW }); assert.equal(m.runsSeen, 1, 'metricsReport'); assert.equal(m.symbolicLinksNotCounted, 2);
  const v = verdictStats(runs, { days: 5, now: NOW }); assert.equal(v.runsSeen, 1, 'verdictStats'); assert.equal(v.symbolicLinksNotCounted, 2);
  const f = forecastCost('mock', runs, { days: 5, now: NOW }); assert.equal(f.runsUsed, 1, 'forecastCost'); assert.equal(f.symbolicLinksNotCounted, 2);
});

test('the kind is asked BEFORE the date and the window: a dangling link with a side-run name, and a link older than the window, are counted apart too (a count shown for what the window hides would be silent)', () => {
  const runs = runsWithLinks();
  symlinkSync(join(runs, 'no-such-folder'), join(runs, `${REAL}.replay-2026-10-11`));       // a side-run name: its date comes from the folder's files, which a dangling link has not
  symlinkSync(join(runs, REAL), join(runs, '2020-01-01T00-00-00-000Z'));                    // far outside any window
  const r = spendReport(runs, { days: 1, now: NOW });
  assert.equal(r.symbolicLinksNotCounted, 4); assert.equal(r.count, 1); assert.equal(r.totalUsd, 0.04);
});

test('the other two walkers of runs/ use the same predicate: the advice ledger (a money guard: a linked run folder must not count another run\'s advise-log twice) and the clone-only daily cap', () => {
  const runs = runsWithLinks();
  const log = { ts: Date.parse('2026-10-11T10:00:00Z'), quoted: { ceiling_usd: 1 }, spent_usd: 0.5 };
  writeFileSync(join(runs, REAL, 'advise-log.json'), JSON.stringify(log));
  const ledger = readLedger(runs, { now: NOW });
  assert.equal(ledger.filter(e => e.run).length, 1, 'the advise-log of the real run counts ONCE, not once through the link'); assert.equal(ledger.symbolicLinksNotCounted, 2);
  const usage = dailyUsage(runs, NOW);
  assert.equal(usage.usd, 0.04); assert.equal(usage.count, 1); assert.equal(usage.symbolicLinksNotCounted, 2);
});
