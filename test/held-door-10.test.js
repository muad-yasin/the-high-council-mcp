// Wiring item (7): the handoff seat's milestone prompt (10a, 10c, 10e, 10f, 10i) and the criteria in it (P10b), through src/handoff-prompt.js for both the run and `council handoff --from-run`;
// the metrics reader (10g) and the status surface (10h). Held sentences (src/held-roles.js; drafted in test/held-prompts/held.js). $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { handoffPrompt } from '../src/handoff-prompt.js';
import { lintMilestones } from '../src/milestones.js';
import { criterionIds } from '../src/criteria-ledger.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { metricsReport } from '../src/metrics.js';
import * as H from './held-prompts/held.js';
import * as R from '../src/roles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
afterEach(() => { setHeldForTest(null); setPromptSpy(null); });
const ALL = { handoffSystem: H.handoffSystem, handoffUserMilestones: H.handoffUserMilestones };
const BEFORE = { skip: 'handoffSystem' in R && 'recorded in src/roles.js: this describes the state before the re-record' };

const go = async extra => {
  const base = chain('mock-debate');
  const config = { ...base, seats: { ...base.seats, handoff: { provider: 'mock', model: 'mock-handoff-reads-prompt' } }, ...extra };
  const seen = [];
  setPromptSpy(p => seen.push(p));
  const r = await runChain({ request: 'Write a short fixture deliverable.', config, runId: 'r-10', log: () => {} });
  return { r, seen, handoffPrompt: seen.find(p => p.label === 'handoff'), findings: () => lintMilestones({ text: r.handoff, criteriaIds: criterionIds(r.criteria) }).findings.map(f => f.kind) };
};

test('10a before the re-record: a chain with handoff_contract.milestones is sent the handoff prompts that have always been sent, byte for byte; the seat writes no milestones and the lint says so', BEFORE, async () => {
  const w = await go({ handoff_contract: { milestones: true } });
  assert.equal(w.handoffPrompt.system, R.HANDOFF_SYSTEM);
  assert.ok(!w.handoffPrompt.user.includes('# Acceptance criteria\n\nC1.'));
  assert.deepEqual(w.findings(), ['no_milestones']);
});

test('10a door: with the milestone prompt the seat is told the shape and shown the criteria as C1... lines, writes milestones that discharge exactly those, and the lint finds nothing', async () => {
  setHeldForTest(ALL);
  const w = await go({ handoff_contract: { milestones: true } });
  const n = w.r.criteria.length;
  assert.ok(w.handoffPrompt.system.includes('`## Milestones`') && w.handoffPrompt.system.includes('Under 1,500 words'));
  assert.ok(w.handoffPrompt.user.includes(`# Acceptance criteria\n\n${w.r.criteria.map((c, i) => `C${i + 1}. ${c}`).join('\n')}`));
  assert.deepEqual(w.findings(), [], w.r.handoff);
  assert.equal(lintMilestones({ text: w.r.handoff, criteriaIds: criterionIds(w.r.criteria) }).status, 'ready_for_build');
  assert.match(w.r.handoff, new RegExp(`- check: C1, C2${n > 2 ? ', C3' : ''} \\| `));
});

test('10a: without the flag the held prompt is not used, even when it exists (every shipped chain until the switch-on)', async () => {
  setHeldForTest(ALL);
  const w = await go({});
  assert.equal(w.handoffPrompt.system, R.HANDOFF_SYSTEM);
  assert.equal(w.handoffPrompt.user.includes('# Acceptance criteria\n\nC1.'), false);
});

test('10e: the Available-tools paragraph of HANDOFF_SYSTEM is in the milestone prompt verbatim, with the five phrases test/roles.test.js pins', () => {
  const sys = H.handoffSystem({ milestones: true });
  const tools = R.HANDOFF_SYSTEM.slice(R.HANDOFF_SYSTEM.indexOf('If the request contains an "Available tools"'));
  assert.ok(tools.length > 400 && sys.endsWith(tools));
  const flat = sys.toLowerCase().replace(/\s+/g, ' ');
  for (const phrase of ['Available tools', 'exact name as listed', 'never name a tool that is not in that section', 'never invent a command line', 'no such section']) assert.ok(flat.includes(phrase.toLowerCase()), phrase);
  assert.equal(H.handoffSystem({ milestones: false }), R.HANDOFF_SYSTEM);
  assert.equal(H.handoffSystem(), R.HANDOFF_SYSTEM);
});

test('10c: the carry sentence aims at a milestone\'s check line; the old one is not in the milestone prompt; with no checks there is none; the criteria never come before the plan', () => {
  const u = H.handoffUserMilestones({ request: 'Req', draft: 'The plan.', checks: '\n\n# How the checkable criteria are settled\n\n1. Check: x', criteria: ['A', 'B'] });
  assert.ok(u.includes("Carry every check above into a milestone's Exit as a `- check:` line, word for word"));
  assert.equal(u.includes('acceptance tests, word for word'), false);
  assert.ok(u.endsWith('\n\n# Acceptance criteria\n\nC1. A\nC2. B'));
  assert.ok(u.indexOf('The plan.') < u.indexOf('# Acceptance criteria'));
  const none = H.handoffUserMilestones({ request: 'Req', draft: 'D', criteria: [] });
  assert.equal(none, R.handoffUser({ request: 'Req', draft: 'D' }), 'no checks and no criteria: the same prompt as ever');
});

test('10a: the run and `council handoff --from-run` both build the handoff prompts through src/handoff-prompt.js, and nothing else in src/ names HANDOFF_SYSTEM or handoffUser', () => {
  for (const f of ['src/chain.js', 'src/cli.js']) {
    const text = readFileSync(join(root, f), 'utf8');
    assert.match(text, /handoffPrompt\(/, f);
    assert.equal(/R\.HANDOFF_SYSTEM|R\.handoffUser|HandoffRoles\./.test(text), false, `${f} builds the prompt itself`);
  }
  const hp = handoffPrompt({ config: { handoff_contract: { milestones: true } }, request: 'r', draft: 'd', criteria: ['A'] });
  assert.equal(hp.system, R.handoffSystem({ milestones: true }), 'the recorded milestone prompt, only through the module');
  assert.equal(handoffPrompt({ config: {}, request: 'r', draft: 'd', criteria: ['A'] }).system, R.HANDOFF_SYSTEM, 'no flag: the prompt that has always been sent');
  assert.match(readFileSync(join(root, 'src/cli.js'), 'utf8'), /handoffPrompt\(\{[^}]*criteria: hCriteria/, '`council handoff --from-run` hands the run\'s criteria to the milestone prompt');
});

// ---- 10g: the tool-call-usage figure reads the milestone format ----
test('10g: a handoff in the milestone format counts its `- check:` lines as acceptance items (it used to read zero); the old heading is read as before', () => {
  const runs = mkdtempSync(join(tmpdir(), 'thc-10g-'));
  const mk = (id, handoff) => { mkdirSync(join(runs, id)); writeFileSync(join(runs, id, 'HANDOFF.md'), handoff); };
  const tools = '## Available tools\n\n- `lint-plan`\n- `run-tests`\n\n';
  mk('2026-10-07T10-00-00-000Z', `Status: ready_for_build\n\n${tools}## Milestones\n### M0 - a\nExit:\n- check: C1 | lint-plan on PLAN.md => 0 findings\n- check: C1 | by hand => it works\n`);
  mk('2026-10-07T10-00-01-000Z', `${tools}## Acceptance test per item\n- item 1: run-tests => pass\n- item 2: by hand\n`);
  const m = metricsReport(runs, { days: 36500, now: Date.parse('2026-10-08T00:00:00Z') });
  assert.equal(m.counts.acceptanceItems, 4, JSON.stringify(m.counts));
  assert.equal(m.counts.acceptanceItemsNamingTool, 2);
});

// ---- 10h: a Status that is not ready_for_build is a finding, so it reaches WARNINGS.md and the "Before you build" block ----
test('10h: the lint reports a Status that is not ready_for_build (blocked, needs_*, partial) and nothing for ready_for_build', () => {
  const text = status => `Status: ${status}\n\n## Milestones\n### M0 - a\nEntry: x.\nWork: 1. y.\nExit:\n- check: C1 | z => ok\n\n## Final checklist\n- [ ] done\n`;
  const kinds = s => lintMilestones({ text: text(s), criteriaIds: ['C1'] }).findings.map(f => f.kind);
  assert.deepEqual(kinds('ready_for_build'), []);
  for (const s of ['blocked', 'needs_evidence', 'needs_decision', 'partial']) assert.deepEqual(kinds(s), ['status_not_ready'], s);
  assert.match(lintMilestones({ text: text('blocked'), criteriaIds: ['C1'] }).findings[0].message, /cannot be built as written/);
  assert.match(lintMilestones({ text: text('partial'), criteriaIds: ['C1'] }).findings[0].message, /only part of the plan can start/);
});

test('10h through the CLI: a handoff that says Status: blocked puts the finding in report.json, WARNINGS.md and the Before-you-build block; passed is untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-10h-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const cfg = chain('mock-debate');
  writeFileSync(join(dir, 'chains', 'ms.json'), JSON.stringify({ ...cfg, name: 'ms', seats: { ...cfg.seats, handoff: { provider: 'mock', model: 'mock-handoff-blocked' } }, handoff_contract: { milestones: true } }));
  const r = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'ms', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const report = JSON.parse(readFileSync(join(run, 'report.json'), 'utf8'));
  assert.equal(report.handoff_milestones.status, 'blocked');
  assert.deepEqual(report.handoff_milestones.findings.map(f => f.kind), ['status_not_ready']);
  assert.match(readFileSync(join(run, 'WARNINGS.md'), 'utf8'), /handoff_milestones: status_not_ready/);
  assert.match(readFileSync(join(run, 'HANDOFF.md'), 'utf8'), /Gaps the harness found in this handoff's milestones[\s\S]*status_not_ready: the handoff's Status is "blocked"/);
});
