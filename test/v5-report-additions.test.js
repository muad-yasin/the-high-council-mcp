// test/v5-report-additions.test.js
//
// MLLM Coder v5 (relay/runs/2026-09-15T03-43-44-216Z/deliverable.md):
//   item 4 - report.json `disagreement_groups`, grouped by proposal id (src/disagreement-groups.js)
//   item 5 - capability labels on policy checks, and report.json's `policy` block
// Both are additive report.json fields, present only when the run did the thing they describe.
// Offline: the mock provider only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveDisagreementGroups } from '../src/disagreement-groups.js';
import { evaluatePolicy, POLICY_CAPABILITIES } from '../src/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cli = join(root, 'src', 'cli.js');

function runChain(chainName, { policy } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-v5-report-'));
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', `${chainName}.json`), readFileSync(join(root, 'chains', `${chainName}.json`)));
  writeFileSync(join(dir, 'task.md'), 'A short plan.\n');
  if (policy) writeFileSync(join(dir, 'policy.json'), JSON.stringify(policy));
  execFileSync('node', [cli, '--chain', chainName, '--task', 'task.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const read = f => JSON.parse(readFileSync(join(runDir, f), 'utf8'));
  const out = { report: read('report.json'), runJson: read('run.json') };
  rmSync(dir, { recursive: true, force: true });
  return out;
}

// --- item 4: disagreement_groups ---

const proposals = [
  { id: 'A-1', lab: 'a', title: 'First' },
  { id: 'A-2', lab: 'a', title: 'Second', amended: true },
  { id: 'A-10', lab: 'a', title: 'Tenth', withdrawn: true },
  { id: 'B-1', lab: 'b', title: 'Only supported' },
];

test('deriveDisagreementGroups: one group per objected/merged proposal, numeric id order, outcome from the proposal flags', () => {
  const debate = { posts: [
    { by: 'b', on: 'A-10', stance: 'merge', text: 'fold into A-2', merge_with: 'A-2' },
    { by: 'b', on: 'A-2', stance: 'object', text: 'no such file' },
    { by: 'c', on: 'A-2', stance: 'object', text: 'wrong path' },
    { by: 'a', on: 'B-1', stance: 'support', text: 'good' },
    { by: 'b', on: 'A-1', stance: 'object', text: 'vague' },
  ], replies: [] };
  const groups = deriveDisagreementGroups(debate, proposals);
  assert.deepEqual(groups.map(g => g.on), ['A-1', 'A-2', 'A-10'], 'numeric-aware id order, support-only B-1 absent');
  assert.deepEqual(groups.map(g => g.outcome), ['kept', 'amended', 'withdrawn']);
  assert.equal(groups[1].posts.length, 2);
  assert.equal(groups[1].title, 'Second');
  assert.equal(groups[1].author_lab, 'a');
  assert.deepEqual(groups[2].posts[0], { by: 'b', stance: 'merge', text: 'fold into A-2', merge_with: 'A-2' });
  assert.equal('merge_with' in groups[1].posts[0], false, 'merge_with only where the post had one');
});

test('deriveDisagreementGroups: a post whose target is not in proposals is kept as unknown, never dropped', () => {
  const groups = deriveDisagreementGroups({ posts: [{ by: 'b', on: 'GHOST-1', stance: 'object', text: 'x' }] }, proposals);
  assert.deepEqual(groups, [{ on: 'GHOST-1', title: null, author_lab: null, outcome: 'unknown', posts: [{ by: 'b', stance: 'object', text: 'x' }] }]);
});

test('deriveDisagreementGroups: no debate -> undefined; a debate where nobody disagreed -> []', () => {
  assert.equal(deriveDisagreementGroups(null, proposals), undefined);
  assert.deepEqual(deriveDisagreementGroups({ posts: [{ by: 'a', on: 'B-1', stance: 'support', text: 'ok' }] }, proposals), []);
});

test('a real mock-debate run writes disagreement_groups built from its own debate, and leaves debate.posts unchanged', () => {
  const { report } = runChain('mock-debate');
  assert.ok(Array.isArray(report.disagreement_groups));
  assert.equal(report.disagreement_groups.length, new Set(report.debate.posts.filter(p => p.stance === 'object' || p.stance === 'merge').map(p => p.on)).size);
  for (const g of report.disagreement_groups) {
    const p = report.proposals.find(x => x.id === g.on);
    assert.ok(p, `group ${g.on} names a real proposal`);
    assert.equal(g.author_lab, p.lab);
    assert.ok(g.posts.every(post => post.by !== p.lab), 'labs never post on their own proposals');
  }
  assert.ok(report.debate.posts.every(p => ['by', 'on', 'stance', 'text'].every(k => k in p)), 'debate.posts shape untouched');
});

test('a run with no debate stage has no disagreement_groups key', () => {
  const { report } = runChain('mock');
  assert.equal(report.debate ?? null, null);
  assert.equal('disagreement_groups' in report, false);
});

// --- item 5: capability labels and the policy block ---

const ctx = { config: { name: 'x', tags: [] }, allSeats: [{ provider: 'deepseek', model: 'deepseek-v3' }], worstCaseUsd: 5, monthToDateUsd: 0 };

test('evaluatePolicy lists only the checks the policy configures, named by capability, ok derived from reasons', () => {
  const { ok, checks } = evaluatePolicy({ allowed_providers: ['anthropic'], max_usd_per_run: 10 }, ctx);
  assert.equal(ok, false);
  assert.deepEqual(checks, [
    { capability: 'provider-choice', field: 'allowed_providers', ok: false },
    { capability: 'run-spend-limit', field: 'max_usd_per_run', ok: true },
  ]);
  assert.deepEqual(evaluatePolicy({}, ctx).checks, []);
  assert.deepEqual(evaluatePolicy({ required_chain_tags: [], refuse_unpriced_seats: false }, ctx).checks, [], 'present-but-inert fields are not configured checks');
});

test('every check evaluatePolicy can report is named in POLICY_CAPABILITIES (source scan)', () => {
  const src = readFileSync(join(root, 'src', 'policy.js'), 'utf8');
  const fields = new Set([...src.matchAll(/(?:reasons\.push\(|return \[)\s*[`'"]([a-z_]+):/g)].map(m => m[1]));
  assert.ok(fields.size >= 7, `expected at least the 7 policy checks, found ${[...fields].join(', ')}`);
  for (const f of fields) assert.ok(POLICY_CAPABILITIES[f], `policy check "${f}" has no capability name in POLICY_CAPABILITIES`);
  assert.equal(new Set(Object.values(POLICY_CAPABILITIES)).size, Object.keys(POLICY_CAPABILITIES).length, 'capability names are unique');
});

test('every capability entry is actually reachable: setting that field yields exactly one check for it', () => {
  const sample = {
    allowed_providers: ['mock'], allowed_regions: ['eu'], max_usd_per_run: 1, max_usd_per_month: 1,
    required_chain_tags: ['t'], refuse_unpriced_seats: true, required_signoff_paths: ['src/**'],
  };
  assert.deepEqual(Object.keys(sample).sort(), Object.keys(POLICY_CAPABILITIES).sort(), 'this test names every field');
  for (const [field, value] of Object.entries(sample)) {
    const { checks } = evaluatePolicy({ [field]: value }, ctx);
    assert.deepEqual(checks.map(c => c.field), [field], field);
    assert.equal(checks[0].capability, POLICY_CAPABILITIES[field]);
  }
});

test('a run under a passing policy records policy.checks in report.json and run.json', () => {
  const policy = { allowed_providers: ['mock'], max_usd_per_run: 1000 };
  const want = [
    { capability: 'provider-choice', field: 'allowed_providers', ok: true },
    { capability: 'run-spend-limit', field: 'max_usd_per_run', ok: true },
  ];
  const { report, runJson } = runChain('mock', { policy });
  assert.deepEqual(report.policy, { checks: want });
  assert.deepEqual(runJson.policyChecks, want);
});

test('with no policy.json there is no policy key in report.json and no policyChecks in run.json', () => {
  const { report, runJson } = runChain('mock');
  assert.equal('policy' in report, false);
  assert.equal('policyChecks' in runJson, false);
});

test('a resumed run still reports the checks its first round enforced, even after policy.json is deleted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-v5-resume-'));
  try {
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'chains', 'mock-external.json'), readFileSync(join(root, 'chains', 'mock-external.json')));
    writeFileSync(join(dir, 'task.md'), 'A short plan.\n');
    writeFileSync(join(dir, 'policy.json'), JSON.stringify({ allowed_providers: ['mock'] }));
    const env = { PATH: process.env.PATH };
    let args = ['--chain', 'mock-external', '--task', 'task.md'];
    for (let i = 0; i < 8; i++) {
      try { execFileSync('node', [cli, ...args], { cwd: dir, encoding: 'utf8', env, stdio: 'pipe' }); break; }
      catch (err) { if (err.status !== 3) throw err; }
      const runId = readdirSync(join(dir, 'runs'))[0];
      const runDir = join(dir, 'runs', runId);
      rmSync(join(dir, 'policy.json'), { force: true });
      for (const f of readdirSync(runDir).filter(n => /^NEEDS-.+\.md$/.test(n))) {
        const label = f.slice('NEEDS-'.length, -'.md'.length);
        if (!existsSync(join(runDir, `${label}.md`))) writeFileSync(join(runDir, `${label}.md`), label === 'criteria' ? '{ "criteria": ["It answers the request."] }' : 'A complete answer for this stage.');
      }
      args = ['--resume', join('runs', runId)];
    }
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    assert.ok(existsSync(join(runDir, 'report.json')), 'the run finished');
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.deepEqual(report.policy, { checks: [{ capability: 'provider-choice', field: 'allowed_providers', ok: true }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
