// A stage whose `<label>.usage.json` was written and whose `<label>.md` was not (the process ended between the two writes: cost first, text last) is a payment that happened. 13 Oct 2026, T2-1 standing question:
// on a resume the cache getter returned null for such a stage and the re-run's new usage file OVERWROTE the orphan, so the run's total counted ONE payment for two calls (measured on a real priced mock run: 0.506 before the
// resume and 0.506 after; it should be 1.012 once the stage ran twice), and the cap enforced against a figure that was too low. Now the orphan is moved into superseded/ BEFORE the stage re-runs, and if that move fails
// the stage is not run again at all. Offline: the priced mock chain `mock-budget`, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpentUsd } from '../src/spend.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ENV = { PATH: process.env.PATH };
const sh = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: ENV, timeout: 90_000 });
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// a finished priced run, then the state of a process that died between a stage's two writes: its text and the run's report are gone, its usage record stays
function orphaned() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-orphan-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'A mock task.');
  const first = sh(dir, ['--chain', 'mock-budget', '--task', 'tasks/x.md', '--max-usd', 'none']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const aside = join(dir, 'aside'); mkdirSync(aside);
  renameSync(join(run, 'build.md'), join(aside, 'build.md')); renameSync(join(run, 'report.json'), join(aside, 'report.json'));
  return { dir, run, buildUsd: readJson(join(run, 'build.usage.json')).usd };
}
const withOrphan = fn => { const o = orphaned(); try { return fn(o); } finally { rmSync(o.dir, { recursive: true, force: true }); } };

test('OR-1 a resumed stage keeps its first payment: the orphan moves into superseded/ and the total counts BOTH calls', () => withOrphan(o => {
  assert.ok(o.buildUsd > 0, 'fixture: the build stage was priced');
  const before = runSpentUsd(o.run);
  const r = sh(o.dir, ['--resume', o.run, '--max-usd', 'none']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(o.run, 'superseded', 'build.1.usage.json')), 'the first payment is kept in superseded/');
  assert.match(readFileSync(join(o.run, 'WARNINGS.md'), 'utf8'), /cache_orphan: stage "build" had a cost record and no text/);
  near(runSpentUsd(o.run), before + o.buildUsd, 'the total gained the second call and kept the first');
}));

// a CONTROL, no red of its own (it holds at the old code too): the settled reservation line of the orphan call adds nothing, the usage records are the figure, before and after
test('OR-2 control, no double count: the orphan call is counted ONCE before the resume (its settled reservation line adds nothing), and once more per call after it', () => withOrphan(o => {
  const lines = readFileSync(join(o.run, 'spend-reservations.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(lines.some(l => l.event === 'reserved' && l.label === 'build') && lines.some(l => l.event === 'settled'), 'fixture: the orphan call has a reserved and a settled line');
  const stages = readdirSync(o.run).filter(f => f.endsWith('.usage.json')).reduce((n, f) => n + readJson(join(o.run, f)).usd, 0);
  near(runSpentUsd(o.run), stages, 'before the resume the folder costs exactly its usage records (the settled pair adds nothing)');
  assert.equal(sh(o.dir, ['--resume', o.run, '--max-usd', 'none']).status, 0);
  const sup = join(o.run, 'superseded');
  const after = (existsSync(sup) ? readdirSync(sup) : []).filter(f => f.endsWith('.usage.json')).reduce((n, f) => n + readJson(join(sup, f)).usd, 0)
    + readdirSync(o.run).filter(f => f.endsWith('.usage.json')).reduce((n, f) => n + readJson(join(o.run, f)).usd, 0);
  near(runSpentUsd(o.run), after, 'after the resume the folder costs the usage records plus superseded/: each call once');
}));

test('OR-3 if the orphan cannot be set aside the stage is NOT run again (a refusal naming the file), and the total does not drop', () => withOrphan(o => {
  writeFileSync(join(o.run, 'superseded'), 'a file where the folder has to go');                // mkdir superseded/ fails
  const before = runSpentUsd(o.run);
  const reservations = readFileSync(join(o.run, 'spend-reservations.jsonl'), 'utf8').trim().split('\n').length;
  const r = sh(o.dir, ['--resume', o.run, '--max-usd', 'none']);
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /build\.usage\.json holds a payment whose text never landed, and it could not be set aside/);
  assert.ok(existsSync(join(o.run, 'build.usage.json')), 'the orphan is still in place');
  assert.equal(existsSync(join(o.run, 'build.md')), false, 'the stage did not run again');
  assert.equal(readFileSync(join(o.run, 'spend-reservations.jsonl'), 'utf8').trim().split('\n').length, reservations, 'no call was reserved or sent');
  near(runSpentUsd(o.run), before, 'the total is what it was');
  assert.ok(existsSync(join(o.run, 'STOPPED-error.md')), 'the run ends as a failed run (STOPPED-error.md), so run_status says so and a person is told to fix the folder');
}));

test('OR-4 the resumed SITTING counts the orphan payment toward its own cap: a resume that stops at a tiny cap before the stage re-runs reports the orphan in what it had spent', () => withOrphan(o => {
  const criteria = readJson(join(o.run, 'criteria.usage.json')).usd;
  const r = sh(o.dir, ['--resume', o.run, '--max-usd', '0.01']);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const stop = readJson(join(o.run, 'STOPPED-budget.json'));
  assert.equal(stop.stoppedAt, 'build');
  near(stop.spentUsd, criteria + o.buildUsd, 'spent at the stop = the cached criteria stage + the orphan payment (red before the fix: the criteria stage alone)');
}));

// ONE copy of the stage cache (T2-1 commit 2): the main run and both side runs build it with makeStageCache; the warning words the cache writes live in src/stage-cache.js and nowhere else in src/
test('OR-5 one copy: the cache\'s WARNINGS words (cache_orphan, cache_stale, cache_unverified, cache_unreadable) are written only by src/stage-cache.js', () => {
  const hits = {};
  for (const f of readdirSync(join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js'))) {
    const text = readFileSync(join(root, 'src', f), 'utf8');
    const n = ['cache_orphan', 'cache_stale', 'cache_unverified', 'cache_unreadable'].filter(w => text.includes(`- ${w}:`)).length;
    if (n) hits[f] = n;
  }
  assert.deepEqual(hits, { 'stage-cache.js': 4 });
});
