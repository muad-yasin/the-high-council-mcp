// test/verdict-stats.test.js
//
// Cross-run verdict/quality accounting: how the debate mechanism itself is behaving, per chain
// and per lab. Same convention as spend.js - derived from runs/*/report.json and *.usage.json
// on disk, no ledger, nothing that survives a deleted run folder. These tests pin the
// aggregation logic and the same degradation contract spend.js already carries; this module
// had no tests upstream, so they're written fresh here against its actual behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verdictStats } from '../src/verdict-stats.js';

const ID = n => `2026-09-11T1${n}-00-00-000Z`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-verdict-'));
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

test('a unanimous sign-off counts as signed off, tallies rounds/objections/scoreboard', () => {
  const { runs, add } = fixture();
  add(ID(0), {
    'report.json': {
      chain: 'verify',
      passed: true,
      totals: { usd: 0.5 },
      signoff: [
        { provider: 'deepseek', signedOff: true, objections: [] },
        { provider: 'qwen', signedOff: true, objections: [] },
      ],
      stages: [
        { label: 'criteria', ms: 100 },
        { label: 'panel-1-deepseek', ms: 200 },
        { label: 'panel-2-deepseek', ms: 200 },
      ],
      scoreboard: {
        rows: [{ status: 'accepted' }, { status: 'cut', withdrawn: true }],
        labs: [{ lab: 'deepseek', proposed: 2, accepted: 1, withdrawn: 1, cut: 0 }],
      },
      dropouts: [],
    },
  });
  const r = verdictStats(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(r.chains.length, 1);
  const verify = r.chains[0];
  assert.equal(verify.chain, 'verify');
  assert.equal(verify.runs, 1);
  assert.equal(verify.signoffRate, 1);
  assert.equal(verify.meanRoundsToSignoff, 2);
  assert.equal(verify.withdrawals, 1);
  assert.equal(verify.accepted, 1);
  assert.equal(verify.meanCostUsd, 0.5);
  const deepseek = r.labs.find(l => l.lab === 'deepseek');
  assert.equal(deepseek.proposed, 2);
  assert.equal(deepseek.accepted, 1);
});

test('a null signedOff is an abstention: not a sign-off, not an objection, counted as unparseable', () => {
  const { runs, add } = fixture();
  add(ID(1), {
    'report.json': {
      chain: 'verify',
      passed: false,
      signoff: [
        { provider: 'deepseek', signedOff: true, objections: [] },
        { provider: 'qwen', signedOff: null, objections: null },
      ],
      stages: [],
      scoreboard: { rows: [], labs: [] },
      dropouts: [],
    },
  });
  const r = verdictStats(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  const verify = r.chains[0];
  assert.equal(verify.unparseable, 1);
  assert.equal(verify.objections, 0, 'a null-objections abstention must not be counted as a zero-objection pass');
  const qwenLab = r.labs.find(l => l.lab === 'qwen');
  assert.equal(qwenLab.unparseable, 1);
});

test('a dropped-out lab is counted per lab and per chain, even though it produced nothing', () => {
  const { runs, add } = fixture();
  add(ID(2), {
    'report.json': {
      chain: 'plan-debate',
      passed: false,
      signoff: [],
      stages: [],
      scoreboard: { rows: [], labs: [] },
      dropouts: [{ lab: 'glm', model: 'z-ai/glm-5.3-flash', stage: 'proposals', reason: 'no readable proposals after a retry' }],
    },
  });
  const r = verdictStats(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(r.chains[0].dropouts, 1);
  const glm = r.labs.find(l => l.lab === 'glm');
  assert.equal(glm.dropouts, 1);
});

test('a run with no report.json (paused or still going) is skipped for verdict scoring but not for prompt-size tracking', () => {
  const { runs, add } = fixture();
  add(ID(3), { 'run.json': { chain: 'verify' }, 'NEEDS-build.md': 'x'.repeat(5000) });
  const r = verdictStats(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(r.chains.length, 0, 'no report.json means no verdict yet');
  assert.equal(r.runsSeen, 1, 'the run is still seen for prompt-size purposes');
  assert.ok(r.largestPrompts.some(p => p.stageType === 'build'));
});

test('the window excludes older runs', () => {
  const { runs, add } = fixture();
  add('2026-09-01T10-00-00-000Z', { 'report.json': { chain: 'verify', passed: true, signoff: [], stages: [], scoreboard: { rows: [], labs: [] }, dropouts: [] } });
  add(ID(4), { 'report.json': { chain: 'verify', passed: true, signoff: [], stages: [], scoreboard: { rows: [], labs: [] }, dropouts: [] } });
  const r = verdictStats(runs, { days: 1, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(r.chains[0].runs, 1);
});

test('a missing runs/ directory is an answer, not an error', () => {
  const r = verdictStats(join(tmpdir(), 'thc-verdict-does-not-exist-' + Date.now()));
  assert.equal(r.runsSeen, 0);
  assert.deepEqual(r.chains, []);
});

test('an unreadable runs/ directory degrades instead of throwing', { skip: process.getuid?.() === 0 && 'root ignores permissions' }, () => {
  const { runs } = fixture();
  chmodSync(runs, 0o000);
  try {
    const r = verdictStats(runs);
    assert.equal(r.runsSeen, 0);
    assert.match(r.note || '', /could not be read/);
  } finally {
    chmodSync(runs, 0o755);
  }
});

test('the stats carry chain/lab names, counts and cost only - never task content', () => {
  const { runs, add } = fixture();
  add(ID(5), {
    'report.json': {
      chain: 'verify',
      task: 'tasks/acquire-competitor.md',
      passed: true,
      signoff: [],
      stages: [],
      scoreboard: { rows: [], labs: [] },
      dropouts: [],
    },
  });
  const r = verdictStats(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(JSON.stringify(r).includes('acquire-competitor'), false);
});

test('verdictStats writes nothing at all', () => {
  const { dir, runs, add } = fixture();
  add(ID(6), { 'report.json': { chain: 'verify', passed: true, signoff: [], stages: [], scoreboard: { rows: [], labs: [] }, dropouts: [] } });
  const before = tree(dir);
  verdictStats(runs, { days: 30 });
  assert.deepEqual(tree(dir), before, 'verdictStats must not touch the disk');
  rmSync(dir, { recursive: true, force: true });
});

function tree(d) {
  return readdirSync(d).sort().map(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? { [n]: tree(p) } : n;
  });
}
