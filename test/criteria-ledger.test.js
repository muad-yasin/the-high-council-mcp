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
