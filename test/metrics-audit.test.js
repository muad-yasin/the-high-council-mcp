// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_Metrics_2026-09-23.md #1-#4, #6).
// These readers feed any efficacy number ever quoted, so each test pins a direction the audit found
// wrong: an unheard seat is never consent, canary posts are never a lab's review, a lost vote is
// never "usable", and report.json carries what the run recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictStats } from '../src/verdict-stats.js';
import { computeRoleDiagnostics, perSeatMetrics } from '../src/role-diagnostics.js';
import { consensusInducedRegressionOfRun } from '../src/metrics.js';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const NOW = Date.parse('2026-09-23T20:00:00Z');
function statsOf(report) {
  const runs = join(mkdtempSync(join(tmpdir(), 'thc-metrics-')), 'runs');
  mkdirSync(join(runs, '2026-09-23T10-00-00-000Z'), { recursive: true });
  writeFileSync(join(runs, '2026-09-23T10-00-00-000Z', 'report.json'), JSON.stringify({ chain: 'c', stages: [], dropouts: [], ...report }));
  return verdictStats(runs, { days: 30, now: NOW });
}

test('#1: a capped run where every heard seat signed off but one was unheard is NOT a sign-off', () => {
  const r = statsOf({ passed: false, outcome: 'degraded', signoff: [
    { provider: 'a', signedOff: true, objections: [] },
    { provider: 'b', signedOff: null, objections: null },
  ], stages: [{ label: 'panel-3-a' }, { label: 'panel-3-b' }] });
  assert.equal(r.chains[0].signoffRate, 0);
  assert.equal(r.chains[0].meanRoundsToSignoff, null);
});

test('#2: canary posts never become a lab, and never steal a real objection\'s novelty', () => {
  const posts = [
    { by: 'a', on: 'P-1', stance: 'object', text: 'Conflicts with "the stated cap".' },
    { by: 'canary', on: 'P-1', stance: 'object', text: 'x', canary: true },
  ];
  const r = statsOf({ passed: true, signoff: [], debate: { posts, replies: [{ id: 'P-1', action: 'amend', canary: true, capitulated: true }] } });
  assert.ok(!r.labs.some(l => l.lab === 'canary'), 'no fake canary lab row');
  const a = r.labs.find(l => l.lab === 'a');
  assert.equal(a.objections, 1);
  assert.equal(a.novelObjections, 1, 'the only real objector is still novel');
  assert.ok(!('canary' in computeRoleDiagnostics({ posts }).perSeat), 'role diagnostics ignore canary posts');
  const cir = consensusInducedRegressionOfRun({ debate: { posts, replies: [{ id: 'P-1', action: 'amend', canary: true }] }, proposals: [{ id: 'P-1' }] });
  assert.equal(cir.count, 0);
  assert.ok(!cir.excluded.some(e => e.proposalRef === 'P-1'), 'the canary reply is not even a candidate');
});

test('#3: a vote lost in round 1 - or a thrown call, which leaves no stage - lowers usableVerdictRate', () => {
  const r = statsOf({ passed: true, signoff: [{ provider: 'm', signedOff: true, objections: [] }], panelVerdicts: [
    { round: 1, lab: 'm', verdict: 'unheard', reason_code: 'REPLY_UNPARSEABLE' },
    { round: 1, lab: 'g', verdict: 'unheard', reason_code: 'SEAT_UNREACHABLE' },
    { round: 2, lab: 'm', verdict: 'signed_off' },
    { round: 2, lab: 'g', verdict: 'signed_off' },
  ], stages: [{ label: 'panel-2-m', lab: 'm' }, { label: 'panel-2-g', lab: 'g' }] });
  const m = r.labs.find(l => l.lab === 'm'); const g = r.labs.find(l => l.lab === 'g');
  assert.equal(m.usableVerdictRate, 0.5);
  assert.equal(g.usableVerdictRate, 0.5);
  assert.equal(g.droppedVerdicts, 1);
  assert.equal(m.legacyVerdicts, false);
});

test('#3 legacy reports: retry/reask/question stages are not extra opportunities, and the rate stays in 0..1', () => {
  const r = statsOf({ passed: false, signoff: [{ provider: 'x', signedOff: null, objections: null }],
    dropouts: [{ lab: 'x', stage: 'panel-1' }, { lab: 'x', stage: 'panel-2' }],
    stages: [{ label: 'panel-1-x', lab: 'x' }, { label: 'panel-1-x-retry', lab: 'x' }, { label: 'panel-1-x-reask1', lab: 'x' }, { label: 'panel-1-x-question', lab: 'x' }] });
  const x = r.labs.find(l => l.lab === 'x');
  assert.equal(x.verdictOpportunities, 1);
  assert.equal(x.usableVerdictRate, 0, 'clamped, never negative');
  assert.equal(x.legacyVerdicts, true);
});

test('#4: single and curly quotes count as quoted evidence; an apostrophe does not', () => {
  const m = perSeatMetrics([
    { by: 's', on: 'A', stance: 'object', text: "Conflicts with 'the stated cap of two rounds'." },
    { by: 'c', on: 'A', stance: 'object', text: 'Conflicts with “the stated cap of two rounds”.' },
    { by: 'n', on: 'A', stance: 'object', text: "It doesn't fit and won't work, honestly." },
  ]);
  assert.equal(m.s.substanceRatio, 1);
  assert.equal(m.c.substanceRatio, 1);
  assert.equal(m.n.substanceRatio, 0);
});

test('#3/#6: report.json carries panelVerdicts, regressions and the dispute record the run produced', () => {
  for (const [chain, key] of [['mock-unanimous', 'panelVerdicts'], ['mock-unanimous', 'regressions'], ['mock-dispute', 'dispute']]) {
    const dir = mkdtempSync(join(tmpdir(), 'thc-report-keys-'));
    mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'A plain task.\n');
    const r = spawnSync('node', [cli, '--chain', chain, '--task', 'tasks/t.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
    assert.equal(r.status, 0, `${chain}: ${r.stderr.slice(-300)}`);
    const report = JSON.parse(readFileSync(join(dir, 'runs', readdirSync(join(dir, 'runs'))[0], 'report.json'), 'utf8'));
    assert.ok(key in report, `${chain}: report.json has no "${key}"`);
    if (key === 'panelVerdicts') assert.ok(report.panelVerdicts.length > 0 && report.panelVerdicts.every(v => v.round && v.lab && v.verdict));
  }
});
