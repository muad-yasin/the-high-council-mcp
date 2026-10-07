// Criterion ids, the record of sign-offs that skipped criteria, and the two derived decision views
// (0.8.0, roadmap "Debate, criteria, milestones" items 4 and 9). All of it is record-keeping: the
// tests also pin that no verdict, prompt or stop moves. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { criterionIds, missingCriteriaRows } from '../src/criteria-ledger.js';
import { cutDespiteSupport, disagreementMap } from '../src/decision-records.js';
import { runChain } from '../src/chain.js';
import { reportJsonShape } from '../src/report-shape.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRITERIA = ['The plan names a data store.', 'The plan lists the API routes with their methods.', 'The plan says how a user signs in.'];
const row = (criterion, verdict = 'MET') => ({ criterion, verdict, evidence: 'quoted' });

test('criterionIds: positional C1..Cn, and nothing for a non-list', () => {
  assert.deepEqual(criterionIds(CRITERIA), ['C1', 'C2', 'C3']);
  assert.deepEqual(criterionIds([]), []);
  assert.deepEqual(criterionIds(undefined), []);
});

test('missingCriteriaRows: a full table records nothing; a short one names the skipped ids', () => {
  assert.equal(missingCriteriaRows({ meets: true, criteria: CRITERIA.map(c => row(c)) }, CRITERIA), null);
  const short = missingCriteriaRows({ meets: true, criteria: [row(CRITERIA[0]), row(CRITERIA[2])] }, CRITERIA);
  assert.deepEqual(short, { criterion_ids: ['C2'], table_rows: 2, criteria_total: 3 });
});

test('missingCriteriaRows: a reply with no table, or a run with no criteria, is not recorded', () => {
  assert.equal(missingCriteriaRows({ meets: true, criteria: [] }, CRITERIA), null, 'no table is a different failure');
  assert.equal(missingCriteriaRows({ meets: true }, CRITERIA), null);
  assert.equal(missingCriteriaRows({ meets: true, criteria: [row('x')] }, []), null);
  assert.equal(missingCriteriaRows(null, CRITERIA), null);
});

test('missingCriteriaRows: the match tolerates case, quoting, a trailing full stop, a trimmed or extended row, and an id', () => {
  const rows = [
    row('`the plan names a data store`'),                                            // case, backticks, no full stop
    row('The plan lists the API routes with their methods. (see section 4)'),        // extended
    row('C3'),                                                                       // the id itself
  ];
  assert.equal(missingCriteriaRows({ meets: true, criteria: rows }, CRITERIA), null);
  // A short row that merely appears inside a long criterion does not count (shorter side < 12 chars).
  const m = missingCriteriaRows({ meets: true, criteria: [row('plan'), row(CRITERIA[1]), row(CRITERIA[2])] }, CRITERIA);
  assert.deepEqual(m.criterion_ids, ['C1']);
  // Non-object rows are ignored, not a crash.
  assert.deepEqual(missingCriteriaRows({ meets: true, criteria: ['C1', null, 4, [], row(CRITERIA[0])] }, CRITERIA).criterion_ids, ['C2', 'C3']);
});

test('cutDespiteSupport: a cut proposal another lab supported is listed, with supporters and objectors', () => {
  const proposals = [
    { id: 'A-2', lab: 'a', title: 'Offline mode', status: 'cut', note: 'too big' },
    { id: 'A-10', lab: 'a', title: 'Dark mode', status: 'cut', note: '' },
    { id: 'B-1', lab: 'b', title: 'Search', status: 'accepted' },
    { id: 'B-2', lab: 'b', title: 'Export', status: 'cut', note: '' },
  ];
  const posts = [
    { on: 'A-2', by: 'b', stance: 'support' }, { on: 'A-2', by: 'c', stance: 'support' }, { on: 'A-2', by: 'c', stance: 'support' }, { on: 'A-2', by: 'd', stance: 'object' },
    { on: 'A-10', by: 'b', stance: 'support' },
    { on: 'B-1', by: 'a', stance: 'support' },       // accepted: not a cut
    { on: 'B-2', by: 'a', stance: 'object' },        // cut, but nobody supported it
    { on: 'B-2', by: 'b', stance: 'support' },       // the author's own post is not support
  ];
  const out = cutDespiteSupport(proposals, { posts });
  assert.deepEqual(out.map(e => e.id), ['A-2', 'A-10'], 'numeric-aware id order, only supported cuts');
  assert.deepEqual(out[0], { id: 'A-2', title: 'Offline mode', author_lab: 'a', supporters: ['b', 'c'], objectors: ['d'], note: 'too big' });
  assert.deepEqual(cutDespiteSupport(proposals, { posts: [] }), []);
  assert.equal(cutDespiteSupport(proposals, null), undefined, 'no debate: not applicable');
  assert.equal(cutDespiteSupport(undefined, { posts }), undefined);
});

test('disagreementMap: one row per round with each lab\'s verdict, carried ones marked', () => {
  const pv = [
    { round: 2, lab: 'a', verdict: 'signed_off' }, { round: 1, lab: 'a', verdict: 'objected' }, { round: 1, lab: 'b', verdict: 'unheard' },
    { round: 2, lab: 'b', verdict: 'signed_off', carried: true }, { round: 1, lab: 'c', verdict: 'passed' },
  ];
  assert.deepEqual(disagreementMap(pv), [
    { round: 1, labs: { a: 'objected', b: 'unheard', c: 'passed' }, signed_off: 0, objected: 1, unheard: 1, passed: 1 },
    { round: 2, labs: { a: 'signed_off', b: 'signed_off (carried)' }, signed_off: 2, objected: 0, unheard: 0, passed: 0 },
  ]);
  assert.equal(disagreementMap([]), undefined);
  assert.equal(disagreementMap(undefined), undefined);
});

// ---- through a whole mock run ----
function mockRun(chain) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-ledger-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', chain, '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  const runs = join(dir, 'runs');
  const report = JSON.parse(readFileSync(join(runs, readdirSync(runs)[0], 'report.json'), 'utf8'));
  return { dir, r, report };
}

test('a real mock run writes the new fields, and the report still validates against the schema', () => {
  const { dir, r, report } = mockRun('mock-debate');
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(report.criteria_ids, report.criteria.map((_, i) => `C${i + 1}`));
    assert.ok(Array.isArray(report.missing_criteria));
    assert.ok(Array.isArray(report.disagreement_map) && report.disagreement_map.length >= 1);
    assert.deepEqual(report.disagreement_map.map(x => x.round), [...new Set(report.panelVerdicts.map(v => v.round))].sort((a, b) => a - b));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(root, 'schemas/report-v1.json'), 'utf8')));
    assert.equal(validate(report), true, JSON.stringify(validate.errors));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A sign-off with a short table is recorded in both panel modes, and nothing else about the run changes.
for (const signoff of ['unanimous', 'first']) {
  test(`a short-table sign-off is recorded in ${signoff} mode and does not change the verdict`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-ledger-short-'));
    try {
      mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
      writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
      const mk = model => ({
        name: 'short', description: 'test', maxRounds: 2, signoff,
        estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
        seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' },
          critics: [{ provider: 'mock', model, lab: 'la' }, { provider: 'mock', model: 'mock-critic-a', lab: 'lb' }] },
      });
      const go = model => {
        writeFileSync(join(dir, 'chains', 'short.json'), JSON.stringify(mk(model)));
        rmSync(join(dir, 'runs'), { recursive: true, force: true });
        const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'short', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
        const runs = join(dir, 'runs');
        return { r, report: JSON.parse(readFileSync(join(runs, readdirSync(runs)[0], 'report.json'), 'utf8')) };
      };
      const short = go('mock-critic-short-table');
      assert.equal(short.r.status, 0, short.r.stdout + short.r.stderr);
      const last = `C${short.report.criteria.length}`;
      assert.ok(short.report.missing_criteria.length >= 1, JSON.stringify(short.report.missing_criteria));
      for (const m of short.report.missing_criteria) {
        assert.equal(m.lab, 'la');
        assert.deepEqual(m.criterion_ids, [last]);
        assert.equal(m.criteria_total, short.report.criteria.length);
        assert.equal(m.table_rows, short.report.criteria.length - 1);
      }
      // The record moves no verdict: same outcome as a critic that wrote the whole table.
      const full = go('mock-critic-cut-signoff-then-fits');
      assert.equal(full.report.passed, short.report.passed);
      assert.deepEqual(full.report.missing_criteria, []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('cut_despite_support fires on a real run\'s data: the ledger status is read from scoreboard.rows, and a support post names the supporter', async () => {
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  const result = await runChain({ request: 'Write a short fixture deliverable.', config: cfg, log: () => {} });
  const cut = result.scoreboard.rows.find(r => r.status === 'cut');
  assert.ok(cut, 'the mock debate cuts one proposal');
  assert.equal(Object.hasOwn(result.proposals[0], 'status'), false, 'proposals[] carries no status: that is why the ledger rows are the source');
  const before = reportJsonShape({ runId: 'r', chain: 'mock-debate', task: 't', result });
  assert.deepEqual(before.cut_despite_support, [], 'the mock lab objected but nobody supported the cut proposal');
  const supporter = result.scoreboard.rows.find(r => r.lab !== cut.lab).lab;
  assert.ok(result.debate.posts.every(p => result.scoreboard.rows.some(r => r.lab === p.by)), 'debate posts name the same lab identity as the proposals');
  result.debate.posts.push({ on: cut.id, by: supporter, stance: 'support' });
  const after = reportJsonShape({ runId: 'r', chain: 'mock-debate', task: 't', result });
  assert.equal(after.cut_despite_support.length, 1);
  assert.equal(after.cut_despite_support[0].id, cut.id);
  assert.deepEqual(after.cut_despite_support[0].supporters, [supporter]);
  assert.equal(after.cut_despite_support[0].author_lab, cut.lab);
});

// ---- 0.8.2 item 3 (owner decision 1, 5 Oct 2026): a sign-off without a full table does not count (signoff_table.required) ----
import { signoffTableGap, describeTableGap, outsideCriteriaRows } from '../src/criteria-ledger.js';

test('signoffTableGap: a full table with evidence is null; no table, a missing row and a row without evidence are named, in that order', () => {
  const full = { meets: true, criteria: CRITERIA.map(c => row(c)) };
  assert.equal(signoffTableGap(full, CRITERIA), null);
  assert.deepEqual(signoffTableGap({ meets: true }, CRITERIA), { kind: 'no_table', criterion_ids: ['C1', 'C2', 'C3'], table_rows: 0, criteria_total: 3 });
  assert.deepEqual(signoffTableGap({ meets: true, criteria: [row(CRITERIA[0]), row(CRITERIA[2])] }, CRITERIA), { kind: 'missing_rows', criterion_ids: ['C2'], table_rows: 2, criteria_total: 3 });
  const bare = { meets: true, criteria: CRITERIA.map((c, i) => ({ criterion: c, verdict: 'MET', evidence: i === 1 ? '  ' : 'quoted' })) };
  assert.deepEqual(signoffTableGap(bare, CRITERIA), { kind: 'no_evidence', criterion_ids: ['C2'], table_rows: 3, criteria_total: 3 });
  assert.equal(signoffTableGap({ meets: true }, []), null, 'a run with no criteria has nothing to check');
  assert.equal(describeTableGap({ kind: 'no_table', criterion_ids: [] }), 'no per-criterion table');
  assert.equal(describeTableGap({ kind: 'missing_rows', criterion_ids: ['C2', 'C5'] }), 'no row for C2, C5');
});

test('outsideCriteriaRows: rows that name none of the criteria are listed; matching rows and ids are not', () => {
  const rows = [row(CRITERIA[0]), row('C2'), row('An invented twelfth criterion about colour')];
  assert.deepEqual(outsideCriteriaRows({ meets: true, criteria: rows }, CRITERIA), ['An invented twelfth criterion about colour']);
  assert.deepEqual(outsideCriteriaRows({ meets: true, criteria: [row(CRITERIA[0])] }, CRITERIA), []);
  assert.deepEqual(outsideCriteriaRows({ meets: true, criteria: rows }, []), []);
});

function tableRun(model, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-ledger-required-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const cfg = {
    name: 'req', description: 'test', maxRounds: 2, signoff: 'unanimous',
    estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' },
      critics: [{ provider: 'mock', model, lab: 'la' }, { provider: 'mock', model: 'mock-critic-cut-signoff-then-fits', lab: 'lb' }] }, // lb writes a full table with evidence (mock-critic-a signs off with no table at all)
    ...extra,
  };
  writeFileSync(join(dir, 'chains', 'req.json'), JSON.stringify(cfg));
  const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'req', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  const runs = join(dir, 'runs'); const id = readdirSync(runs)[0];
  return { dir, r, run: join(runs, id), report: JSON.parse(readFileSync(join(runs, id, 'report.json'), 'utf8')) };
}

test('signoff_table.required: a short table is an abstention, never consent; the seat is re-asked ALONE, the heard seat is carried, the round cap ends it', () => {
  const off = tableRun('mock-critic-short-table');
  const on = tableRun('mock-critic-short-table', { signoff_table: { required: true } });
  try {
    assert.equal(off.report.passed, true, 'off: the old behaviour, a short table still signs off (decided: recorded only)');
    assert.equal(on.report.passed, false, 'on: the short table is not a sign-off');
    assert.ok(on.report.signoff_table_gaps.length >= 1, JSON.stringify(on.report.signoff_table_gaps));
    for (const g of on.report.signoff_table_gaps) { assert.equal(g.lab, 'la'); assert.equal(g.kind, 'missing_rows'); assert.deepEqual(g.criterion_ids, [`C${on.report.criteria.length}`]); }
    const unheard = on.report.panelVerdicts.filter(v => v.lab === 'la');
    assert.ok(unheard.every(v => v.verdict === 'unheard' && v.reason_code === 'INCOMPLETE_TABLE' && v.table_gap.kind === 'missing_rows'), JSON.stringify(unheard));
    // bounded: owner decision 1 says "one re-ask, then abstention": la is re-asked ONCE per round for a refused table (an unreadable reply keeps its two, below), lb exactly once in the whole run (its clean verdict is carried into round 2)
    const files = readdirSync(on.run);
    assert.ok(files.includes('panel-1-la-reask1.md') && !files.includes('panel-1-la-reask2.md'), files.filter(f => f.startsWith('panel-')).join(' '));
    assert.ok(files.includes('panel-1-lb.md') && !files.includes('panel-1-lb-reask1.md') && !files.includes('panel-2-lb.md'), 'the heard seat is never re-asked and is carried');
    assert.equal(off.report.signoff_table_gaps, undefined, 'off: no new key');
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(root, 'schemas/report-v1.json'), 'utf8')));
    assert.equal(validate(on.report), true, JSON.stringify(validate.errors));
  } finally { rmSync(off.dir, { recursive: true, force: true }); rmSync(on.dir, { recursive: true, force: true }); }
});

test('signoff_table.required: a table with a row for every criterion but no evidence is refused too; a table that is full passes', () => {
  const bare = tableRun('mock-critic-bare-met', { signoff_table: { required: true } });
  const full = tableRun('mock-critic-cut-signoff-then-fits', { signoff_table: { required: true } });
  try {
    assert.equal(bare.report.passed, false);
    assert.ok(bare.report.signoff_table_gaps.every(g => g.kind === 'no_evidence'), JSON.stringify(bare.report.signoff_table_gaps));
    assert.equal(full.report.passed, true, 'a full table with evidence signs off as before');
    assert.equal(full.report.signoff_table_gaps, undefined);
  } finally { rmSync(bare.dir, { recursive: true, force: true }); rmSync(full.dir, { recursive: true, force: true }); }
});

test('the one-re-ask cap is per reason: a seat whose reply is unreadable (cut off at the cap) still gets its two re-asks, a seat refused for its table gets one', () => {
  const cut = tableRun('mock-critic-cut', { signoff_table: { required: true } });
  try {
    const files = readdirSync(cut.run);
    assert.ok(files.includes('panel-1-la-reask1.md') && files.includes('panel-1-la-reask2.md'), files.filter(f => f.startsWith('panel-')).join(' '));
    assert.ok(cut.report.panelVerdicts.filter(v => v.lab === 'la').every(v => v.reason_code !== 'INCOMPLETE_TABLE'), 'an unreadable reply is not a table refusal');
  } finally { rmSync(cut.dir, { recursive: true, force: true }); }
});
