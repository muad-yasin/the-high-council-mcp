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
import { verdictStats, independenceStatsCsv } from '../src/verdict-stats.js';

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

// Independence skew: a planted low-independence seat (echoes shared
// objections, signs off while another still objects) vs. a planted
// high-independence seat (raises its own objections, signs off only once
// nobody else objects). Per MISTRAL-3's carried objection, the ratios here
// are a planted fixture matrix, not one day's specific figures - 29%/3%
// are not asserted anywhere in this test.
test('test_independence_stats: novel-objection rate, solo-signoff rate, and the low-independence flag', () => {
  const { runs, add } = fixture();

  // 10 shared targets (planted + independent both object -> not novel for
  // either), plus 1 target planted objects to alone (novel for planted)
  // and 4 targets independent objects to alone (novel for independent).
  const sharedPosts = [];
  for (let i = 1; i <= 10; i++) {
    sharedPosts.push({ by: 'planted', on: `T${i}`, stance: 'object', text: 'shared objection' });
    sharedPosts.push({ by: 'independent', on: `T${i}`, stance: 'object', text: 'shared objection' });
  }
  const soloPosts = [
    { by: 'planted', on: 'T-solo-planted', stance: 'object', text: 'lone objection' },
    { by: 'independent', on: 'T-solo-ind-1', stance: 'object', text: 'lone objection' },
    { by: 'independent', on: 'T-solo-ind-2', stance: 'object', text: 'lone objection' },
    { by: 'independent', on: 'T-solo-ind-3', stance: 'object', text: 'lone objection' },
    { by: 'independent', on: 'T-solo-ind-4', stance: 'object', text: 'lone objection' },
  ];

  add(ID(7), {
    'report.json': {
      chain: 'verify',
      passed: true,
      signoff: [
        { provider: 'planted', signedOff: true, objections: [] },
        { provider: 'independent', signedOff: false, objections: ['still objecting'] },
      ],
      stages: [], scoreboard: { rows: [], labs: [] }, dropouts: [],
      debate: { posts: [...sharedPosts, ...soloPosts] },
    },
  });
  add(ID(8), {
    'report.json': {
      chain: 'verify',
      passed: true,
      signoff: [
        { provider: 'planted', signedOff: true, objections: [] },
        { provider: 'independent', signedOff: false, objections: ['still objecting'] },
      ],
      stages: [], scoreboard: { rows: [], labs: [] }, dropouts: [],
    },
  });
  add(ID(9), {
    'report.json': {
      chain: 'verify',
      passed: true,
      signoff: [
        { provider: 'independent', signedOff: true, objections: [] },
      ],
      stages: [], scoreboard: { rows: [], labs: [] }, dropouts: [],
    },
  });

  const r = verdictStats(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  const planted = r.labs.find(l => l.lab === 'planted');
  const independent = r.labs.find(l => l.lab === 'independent');

  assert.equal(planted.objections, 11);
  assert.equal(planted.novelObjections, 1);
  assert.ok(Math.abs(planted.novelObjectionRate - 1 / 11) < 1e-9);
  assert.equal(planted.signoffs, 2);
  assert.equal(planted.soloSignoffs, 2);
  assert.equal(planted.soloSignoffRate, 1);
  assert.equal(planted.lowIndependence, true, 'planted seat: low novel-objection rate + high solo-signoff rate must flag');

  assert.equal(independent.objections, 14);
  assert.equal(independent.novelObjections, 4);
  assert.ok(Math.abs(independent.novelObjectionRate - 4 / 14) < 1e-9);
  assert.equal(independent.signoffs, 1);
  assert.equal(independent.soloSignoffs, 0);
  assert.equal(independent.soloSignoffRate, 0);
  assert.equal(independent.lowIndependence, false, 'the planted flag must not fire for the independent seat');

  const csv = independenceStatsCsv(r.labs);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'lab,objections,novelObjections,novelObjectionRate,signoffs,soloSignoffs,soloSignoffRate,lowIndependence');
  const plantedLine = lines.find(l => l.startsWith('planted,'));
  const independentLine = lines.find(l => l.startsWith('independent,'));
  assert.ok(plantedLine.endsWith(',true'));
  assert.ok(independentLine.endsWith(',false'));
});

test('a lab with no signoffs or objections gets null rates, not zero, and is never flagged', () => {
  const { runs, add } = fixture();
  add('2026-09-11T20-00-00-000Z', {
    'report.json': {
      chain: 'verify', passed: true,
      signoff: [{ provider: 'quiet', signedOff: null, objections: null }],
      stages: [], scoreboard: { rows: [], labs: [] }, dropouts: [],
    },
  });
  const r = verdictStats(runs, { days: 30, now: Date.parse('2026-09-11T20:00:00Z') });
  const quiet = r.labs.find(l => l.lab === 'quiet');
  assert.equal(quiet.novelObjectionRate, null);
  assert.equal(quiet.soloSignoffRate, null);
  assert.equal(quiet.lowIndependence, false);
});

function tree(d) {
  return readdirSync(d).sort().map(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? { [n]: tree(p) } : n;
  });
}
