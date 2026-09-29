// `council handoff --from-run` (src/handoff-from-run.js + the subcommand in src/cli.js, 0.8.0 roadmap
// item 3): a HANDOFF.md for a run that stopped before it wrote one. Offline: mock seats, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spendReport } from '../src/spend.js';
import { pickDraft, readCriteria, stopState, partialBanner, externalPromptText } from '../src/handoff-from-run.js';
import { parseLock, checkLock } from '../src/criteria-lock.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const CRITERIA = ['The plan names a data store.', 'The plan lists the API routes.', 'No section contradicts another.'];
const RUN = '2026-09-29T09-00-00-000Z';

function workspace({ chain = 'hand', files = {}, seats } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-handoff-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'runs', RUN), { recursive: true });
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  writeFileSync(join(dir, 'chains', `${chain}.json`), JSON.stringify({
    name: chain, description: 'test', maxRounds: 1,
    estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
    seats: seats || { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, handoff: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] },
  }));
  writeFileSync(join(dir, 'runs', RUN, 'run.json'), JSON.stringify({ chain, task: join(dir, 'tasks', 't.md'), cwd: dir, label: 't' }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'runs', RUN, name), text);
  return dir;
}
const run = (cwd, args) => spawnSync(process.execPath, [cli, 'handoff', ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd }, timeout: 90_000 });
const BUILD = '# Plan\n\n## Decisions\n\nWe use SQLite.\n\n## Routes\n\nGET /items\n';
const CRIT_FILE = JSON.stringify({ criteria: CRITERIA });

test('pickDraft: deliverable, else final, else the highest revise, else build; empty files do not count', () => {
  const dir = workspace({ files: { 'build.md': 'b', 'revise-1.md': 'r1', 'revise-10.md': 'r10', 'revise-2.md': 'r2' } });
  try {
    const rd = join(dir, 'runs', RUN);
    assert.deepEqual(pickDraft(rd), { name: 'revise-10.md', text: 'r10' }, 'numeric, not lexical');
    writeFileSync(join(rd, 'final.md'), 'f'); assert.equal(pickDraft(rd).name, 'final.md');
    writeFileSync(join(rd, 'deliverable.md'), 'd'); assert.equal(pickDraft(rd).name, 'deliverable.md');
    writeFileSync(join(rd, 'deliverable.md'), '  \n'); assert.equal(pickDraft(rd).name, 'final.md', 'an empty file is skipped');
    assert.equal(pickDraft(join(dir, 'runs', 'nope')), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readCriteria: report.json, else report-partial.json, else the criteria stage reply, else none', () => {
  const dir = workspace({ files: { 'criteria.md': CRIT_FILE } });
  try {
    const rd = join(dir, 'runs', RUN);
    assert.deepEqual(readCriteria(rd), CRITERIA, 'from criteria.md');
    writeFileSync(join(rd, 'report-partial.json'), JSON.stringify({ criteria: ['only this'] }));
    assert.deepEqual(readCriteria(rd), ['only this']);
    writeFileSync(join(rd, 'report.json'), JSON.stringify({ criteria: ['final one', { criterion: 'an object' }] }));
    assert.deepEqual(readCriteria(rd), ['final one', 'an object']);
    assert.deepEqual(readCriteria(join(dir, 'runs', 'nope')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stopState and partialBanner: a signed-off run has no banner; every other ending says where it stopped', () => {
  const dir = workspace();
  const rd = join(dir, 'runs', RUN);
  try {
    assert.equal(stopState(rd).reason, 'ended without a report (crashed or killed)');
    writeFileSync(join(rd, 'NEEDS-build.md'), 'x'); assert.match(stopState(rd).reason, /paused at an external seat/);
    writeFileSync(join(rd, 'STOPPED-error.md'), 'x'); assert.match(stopState(rd).reason, /stopped at an error/);
    writeFileSync(join(rd, 'STOPPED-truncated.md'), 'x'); assert.match(stopState(rd).reason, /cut off/);
    writeFileSync(join(rd, 'STOPPED-budget.json'), JSON.stringify({ stoppedAt: 'critique-1' }));
    const s = stopState(rd);
    assert.deepEqual([s.finished, s.signedOff, s.reason], [false, false, 'stopped at the spend cap before stage "critique-1"']);
    const banner = partialBanner({ state: s, draftName: 'build.md', runId: RUN });
    assert.match(banner, /Not a signed-off plan/);
    assert.match(banner, /did not sign off/);
    assert.match(banner, /build\.md/);
    writeFileSync(join(rd, 'report.json'), JSON.stringify({ passed: true }));
    assert.equal(partialBanner({ state: stopState(rd), draftName: 'deliverable.md', runId: RUN }), '');
    writeFileSync(join(rd, 'report.json'), JSON.stringify({ passed: false }));
    assert.match(partialBanner({ state: stopState(rd), draftName: 'deliverable.md', runId: RUN }), /open objections/);
    assert.match(externalPromptText({ system: 'SYS', user: 'USR', runDir: rd, target: 'HANDOFF.md' }), /SYS[\s\S]*USR/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a run stopped at the cap gets a HANDOFF.md with the banner, the model text and the criteria lock; a second call never overwrites it', () => {
  const dir = workspace({ files: { 'build.md': BUILD, 'criteria.md': CRIT_FILE, 'STOPPED-budget.json': JSON.stringify({ stoppedAt: 'critique-1' }) } });
  try {
    const rd = join(dir, 'runs', RUN);
    const r = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = readFileSync(join(rd, 'HANDOFF.md'), 'utf8');
    assert.match(text, /^> \*\*Not a signed-off plan\.\*\*/);
    assert.match(text, /stopped at the spend cap before stage "critique-1"/);
    assert.ok(text.includes('# Plan') || text.length > 200, 'the model text follows the banner');
    const lock = parseLock(text);
    assert.equal(lock.found, true);
    assert.deepEqual(lock.criteria.map(c => c.text), CRITERIA);
    assert.equal(lock.run, RUN);
    assert.equal(checkLock(text, { expected: CRITERIA }).ok, true);
    // A second call leaves the first file alone.
    writeFileSync(join(rd, 'HANDOFF.md'), 'HAND-WRITTEN');
    const again = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.equal(readFileSync(join(rd, 'HANDOFF.md'), 'utf8'), 'HAND-WRITTEN', 'HANDOFF.md is never overwritten');
    assert.ok(existsSync(join(rd, 'HANDOFF-from-run.md')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a run whose panel signed off gets no banner', () => {
  const dir = workspace({ files: { 'deliverable.md': BUILD, 'report.json': JSON.stringify({ passed: true, criteria: CRITERIA }) } });
  try {
    const r = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = readFileSync(join(dir, 'runs', RUN, 'HANDOFF.md'), 'utf8');
    assert.doesNotMatch(text, /Not a signed-off plan/);
    assert.equal(parseLock(text).found, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an external handoff seat gets a prompt file, not a call, and nothing is written as the handoff', () => {
  const ext = { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, handoff: { provider: 'external', model: 'claude-code-session' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] };
  const dir = workspace({ seats: ext, files: { 'build.md': BUILD } });
  try {
    const r = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const rd = join(dir, 'runs', RUN);
    assert.ok(existsSync(join(rd, 'handoff-from-run.prompt.md')));
    assert.match(readFileSync(join(rd, 'handoff-from-run.prompt.md'), 'utf8'), /We use SQLite/);
    assert.equal(existsSync(join(rd, 'HANDOFF.md')), false);
    assert.equal(existsSync(join(rd, 'NEEDS-handoff-from-run.md')), false, 'no NEEDS file: a resume of this run must not pick it up');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nothing to hand off, a folder that is not a run, and missing arguments are refused with exit 2', () => {
  const dir = workspace();
  try {
    const r = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /holds no draft/);
    assert.equal(run(dir, []).status, 2);
    assert.equal(run(dir, ['--from-run', 'runs/none']).status, 2);
    assert.equal(run(dir, ['--from-run', join('runs', RUN), '--chain', '../evil']).status, 2, 'a chain is a name, never a path');
    assert.equal(run(dir, ['--from-run', join('runs', RUN), '--max-usd', '0']).status, 2, '0 is refused');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the spend cap holds: a call that could breach it is not made, and nothing is written', () => {
  const dir = workspace({ chain: 'mock-budget', files: { 'build.md': BUILD } });
  try {
    // The chain of that name in the workspace is a mock one; swap in the package's priced fixture seats.
    writeFileSync(join(dir, 'chains', 'mock-budget.json'), readFileSync(join(root, 'chains', 'mock-budget.json'), 'utf8'));
    const r = run(dir, ['--from-run', join('runs', RUN), '--max-usd', '0.000001']);
    assert.equal(r.status, 4, r.stdout + r.stderr);
    assert.match(r.stderr, /spend cap/);
    assert.equal(existsSync(join(dir, 'runs', RUN, 'HANDOFF.md')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a key-shaped string in the draft is refused before the call, and never printed', () => {
  const key = `ghp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`.slice(0, 40);
  const dir = workspace({ files: { 'build.md': `${BUILD}\nOur token is ${key}\n` } });
  try {
    const r = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(r.status, 11, r.stdout + r.stderr);
    assert.ok(!(r.stdout + r.stderr).includes(key), 'the value is never printed');
    assert.equal(existsSync(join(dir, 'runs', RUN, 'HANDOFF.md')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the spend is on record: a usage file, counted by spendReport and by the next cap check', () => {
  const dir = workspace({ chain: 'mock-budget', files: { 'build.md': BUILD, 'criteria.md': CRIT_FILE } });
  try {
    writeFileSync(join(dir, 'chains', 'mock-budget.json'), readFileSync(join(root, 'chains', 'mock-budget.json'), 'utf8'));
    const rd = join(dir, 'runs', RUN);
    const r = run(dir, ['--from-run', join('runs', RUN), '--max-usd', '100']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const usage = JSON.parse(readFileSync(join(rd, 'handoff-from-run.usage.json'), 'utf8'));
    assert.ok(usage.usd > 0, 'the priced mock seat cost something');
    assert.ok(existsSync(join(rd, 'handoff-from-run.md')));
    const report = spendReport(join(dir, 'runs'), { days: 3650 });
    assert.ok(report.totalUsd >= usage.usd, JSON.stringify(report).slice(0, 300));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the run\'s own cap applies, with what it already spent counted: a run stopped at $1 does not get a fresh $7', () => {
  const dir = workspace({ chain: 'mock-budget', files: { 'build.md': BUILD, 'criteria.md': CRIT_FILE, 'criteria.usage.json': JSON.stringify({ provider: 'mock', model: 'mock-priced', usd: 0.9999, usage: { input: 1, output: 1 } }) } });
  try {
    writeFileSync(join(dir, 'chains', 'mock-budget.json'), readFileSync(join(root, 'chains', 'mock-budget.json'), 'utf8'));
    const meta = JSON.parse(readFileSync(join(dir, 'runs', RUN, 'run.json'), 'utf8'));
    writeFileSync(join(dir, 'runs', RUN, 'run.json'), JSON.stringify({ ...meta, maxUsd: 1 }));
    const r = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(r.status, 4, r.stdout + r.stderr);
    assert.match(r.stdout, /cap \$1/);
    assert.equal(existsSync(join(dir, 'runs', RUN, 'HANDOFF.md')), false);
    // --max-usd is a total for the run: raising it above what it has spent plus the call lets it through.
    const ok = run(dir, ['--from-run', join('runs', RUN), '--max-usd', '10']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a password in a URL in the task is refused up front (the generic shapes run on inputs), and --allow-secret-shaped is the override', () => {
  const dir = workspace({ files: { 'build.md': BUILD } });
  try {
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small app. The database is postgres://admin:hunter2secret@db.example.com/app\n');
    const r = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(r.status, 11, r.stdout + r.stderr);
    assert.ok(!(r.stdout + r.stderr).includes('hunter2secret'), 'the value is never printed');
    assert.equal(existsSync(join(dir, 'runs', RUN, 'HANDOFF.md')), false);
    const ok = run(dir, ['--from-run', join('runs', RUN), '--allow-secret-shaped']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the policy gate applies: a policy the chain does not meet stops the handoff before any call', () => {
  const dir = workspace({ files: { 'build.md': BUILD } });
  try {
    writeFileSync(join(dir, 'policy.json'), JSON.stringify({ required_chain_tags: ['approved'] }));
    const r = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(r.status, 12, r.stdout + r.stderr); // the policy refusal, as for a run
    assert.equal(existsSync(join(dir, 'runs', RUN, 'HANDOFF.md')), false);
    assert.equal(existsSync(join(dir, 'runs', RUN, 'handoff-from-run.usage.json')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
