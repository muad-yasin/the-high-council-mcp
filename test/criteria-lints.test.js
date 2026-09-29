// $0 lints over the acceptance criteria (src/criteria-lints.js, 0.8.0 roadmap item 2): word-level
// heuristics, logged and recorded before any paid round, never a stop. Offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintCriteria, isPresenceOnly } from '../src/criteria-lints.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = [
  'The plan names the data store and says why it was chosen over the alternatives it lists.',
  'Every API route in the plan appears in the route table with its method and its auth rule.',
  'No section contradicts another: a name, number or decision used in two places is the same in both.',
];

test('a good list has no findings', () => {
  assert.deepEqual(lintCriteria(GOOD), []);
});

test('nothing to lint is nothing: empty, not a list, blanks', () => {
  assert.deepEqual(lintCriteria([]), []);
  assert.deepEqual(lintCriteria(undefined), []);
  assert.deepEqual(lintCriteria(['', '  ']), []);
});

test('no-consistency: three or more criteria that never ask the plan to agree with itself', () => {
  const list = ['The plan names the data store.', 'Every route has a method and an auth rule.', 'The rollout has a step before launch that a person can check.'];
  const f = lintCriteria(list).filter(x => x.id === 'no-consistency');
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].criterion_ids, []);
  // Two criteria are too few to say anything; and any of the consistency words satisfies it.
  assert.equal(lintCriteria(list.slice(0, 2)).filter(x => x.id === 'no-consistency').length, 0);
  for (const c of ['The plan is internally consistent.', 'Names cross-reference the same section they define.', 'The plan agrees with the request on scope.', 'The same number is used for the cap everywhere.'])
    assert.equal(lintCriteria([...list.slice(0, 2), c]).filter(x => x.id === 'no-consistency').length, 0, c);
});

test('presence-heavy: at least 60% of three or more only ask that something be named, listed or mentioned', () => {
  assert.equal(isPresenceOnly('The plan names a data store.'), true);
  assert.equal(isPresenceOnly('The plan lists the API routes.'), true);
  assert.equal(isPresenceOnly('The plan lists at least three API routes.'), false, 'a number is a condition');
  assert.equal(isPresenceOnly('The plan names every data store it uses.'), false, '"every" is a condition');
  assert.equal(isPresenceOnly('Every route has an auth rule.'), false, 'not a presence sentence');
  const heavy = ['The plan names a data store.', 'The plan lists the API routes.', 'The plan mentions logging.', 'The plan is consistent with the request.'];
  const f = lintCriteria(heavy).filter(x => x.id === 'presence-heavy');
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].criterion_ids, ['C1', 'C2', 'C3']);
  assert.match(f[0].message, /3 of 4/);
  // 2 of 4 is under the share; and a list of two is too short to judge.
  assert.equal(lintCriteria([heavy[0], heavy[1], 'Every route has an auth rule.', heavy[3]]).filter(x => x.id === 'presence-heavy').length, 0);
  assert.equal(lintCriteria(heavy.slice(0, 2)).filter(x => x.id === 'presence-heavy').length, 0);
});

test('vague-word: one finding per criterion with a vague word and nothing to tell it by', () => {
  const list = [...GOOD, 'The design is scalable and robust.', 'p95 latency stays under 200 ms, so the service is fast.', 'The UI is intuitive.'];
  const f = lintCriteria(list).filter(x => x.id === 'vague-word');
  assert.deepEqual(f.map(x => x.criterion_ids[0]), ['C4', 'C6'], 'a number beside "fast" clears it');
  assert.match(f[0].message, /^C4 uses a vague word/);
});

test('objects with a criterion or text field lint like strings, and junk items are skipped', () => {
  const f = lintCriteria([{ criterion: 'The design is scalable.', kind: 'judgement' }, { text: GOOD[0] }, GOOD[2], null, 7, {}]);
  assert.deepEqual(f.filter(x => x.id === 'vague-word').map(x => x.criterion_ids[0]), ['C1']);
});

// ---- through a run and the command ----
const cli = join(root, 'src/cli.js');
const run = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd }, timeout: 90_000 });

test('a run logs the lints before its first paid round and records them; no verdict changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-critlint-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
    writeFileSync(join(dir, 'criteria.md'), '- The plan names a data store.\n- The plan lists the API routes.\n- The plan mentions logging.\n- The design is scalable.\n');
    const r = run(dir, ['--chain', 'mock', '--task', 'tasks/t.md', '--criteria', 'criteria.md']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /criteria lint \(presence-heavy\)/);
    assert.match(r.stdout, /criteria lint \(vague-word\)/);
    assert.match(r.stdout, /criteria lint \(no-consistency\)/);
    assert.ok(r.stdout.indexOf('criteria lint') < r.stdout.indexOf('Stage: '), 'before the first stage after the criteria');
    const report = JSON.parse(readFileSync(join(dir, 'runs', readdirSync(join(dir, 'runs'))[0], 'report.json'), 'utf8'));
    assert.deepEqual(report.criteria_lints.map(x => x.id).sort(), ['no-consistency', 'presence-heavy', 'vague-word']);
    assert.equal(report.passed, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('council lint-criteria: exit 0 clean, 1 with findings, 2 with nothing to read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-critlint-cmd-'));
  try {
    writeFileSync(join(dir, 'good.md'), GOOD.map(c => `- ${c}`).join('\n'));
    writeFileSync(join(dir, 'bad.md'), '- The plan names a data store.\n- The plan lists the API routes.\n- The plan mentions logging.\n');
    const clean = run(dir, ['lint-criteria', '--criteria', 'good.md']);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /3 criteria, no findings/);
    const bad = run(dir, ['lint-criteria', '--criteria', 'bad.md']);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /presence-heavy/);
    assert.equal(run(dir, ['lint-criteria']).status, 2);
    assert.equal(run(dir, ['lint-criteria', '--criteria', 'nope.md']).status, 2);
    assert.equal(run(dir, ['lint-criteria', '--criteria', 'good.md', '--run', 'runs/x']).status, 2, 'exactly one source');
    assert.equal(run(dir, ['lint-criteria', '--run', 'runs/none']).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
