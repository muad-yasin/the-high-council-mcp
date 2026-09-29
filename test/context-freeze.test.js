// The --context documents are frozen for a run like its task is (0.8.0 roadmap item 10; src/scope-freeze.js).
// Before, a document edited during a pause went to every seat on resume without a word on the record,
// while an edited task was refused without an amendment. Offline: the mock-external chain pauses at its
// external builder, $0, no keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextHashOf, latestAmendmentTarget, latestContextAmendmentTarget, checkFrozenContext, taskHashOf } from '../src/scope-freeze.js';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const A = 'aaaaaaaaaaaa';
const B = 'bbbbbbbbbbbb';

test('checkFrozenContext: unchanged and pre-0.8 (no stored hash) runs pass', () => {
  assert.deepEqual(checkFrozenContext({ storedHash: A, currentHash: A, amendmentsText: null }), { ok: true, amended: false });
  assert.deepEqual(checkFrozenContext({ storedHash: undefined, currentHash: B, amendmentsText: null }), { ok: true, amended: false });
  assert.deepEqual(checkFrozenContext({ storedHash: null, currentHash: B, amendmentsText: null }), { ok: true, amended: false });
});

test('checkFrozenContext: a change with no covering entry is refused, and the message says how to record it', () => {
  const r = checkFrozenContext({ storedHash: A, currentHash: B, amendmentsText: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /context changed/);
  assert.match(r.message, new RegExp(`ctx-${A}`));
  assert.match(r.message, new RegExp(`ctx-${B}`));
  assert.match(r.message, /AMENDMENTS\.md/);
});

test('checkFrozenContext: only the LATEST context entry counts, and only ctx- tokens count', () => {
  const entry = `old ctx-${A} new ctx-${B} the mission doc was rewritten 2026-09-29\n`;
  assert.deepEqual(checkFrozenContext({ storedHash: A, currentHash: B, amendmentsText: entry }), { ok: true, amended: true });
  // A bare hash (a task entry) does not cover a context change.
  assert.equal(checkFrozenContext({ storedHash: A, currentHash: B, amendmentsText: `old ${A} new ${B} reason\n` }).ok, false);
  // Going back to an earlier target needs a new entry of its own.
  const later = entry + `old ctx-${B} new ctx-cccccccccccc later edit\n`;
  assert.equal(checkFrozenContext({ storedHash: A, currentHash: B, amendmentsText: later }).ok, false);
  // The full-length hash form names the same target as its first 12.
  assert.equal(checkFrozenContext({ storedHash: A, currentHash: B, amendmentsText: `old ctx-${A} new ctx-${B}${'0'.repeat(52)} reason\n` }).ok, true);
  assert.equal(latestContextAmendmentTarget(undefined), null);
});

test('task and context entries do not read each other', () => {
  const both = `old ${A} new ${B} task changed\nold ctx-${A} new ctx-cccccccccccc context changed\n`;
  assert.equal(latestAmendmentTarget(both), B, 'the task target ignores the context entry that comes after it');
  assert.equal(latestContextAmendmentTarget(both), 'cccccccccccc');
  assert.equal(latestAmendmentTarget(`old ctx-${A} new ctx-${B}`), null, 'a text with only context entries has no task target');
  assert.notEqual(contextHashOf('one'), contextHashOf('two'));
  assert.equal(contextHashOf('one'), taskHashOf('one'), 'the same hashing as the task');
});

// ---- through the CLI ----
function run(args, cwd) {
  try { return { code: 0, out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}

test('a resume after a context document was edited is refused until the change is recorded', () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-ctxfreeze-'));
  try {
    mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'context'));
    writeFileSync(join(work, 'tasks', 'x.md'), 'A test task.');
    writeFileSync(join(work, 'context', 'mission.md'), 'Mission: build a small reading list app.\n');
    const first = run(['--task', 'tasks/x.md', '--chain', 'mock-external', '--context', 'context', '--max-usd', '1'], work);
    assert.equal(first.code, 3, first.out);
    const id = readdirSync(join(work, 'runs'))[0];
    const runDir = join(work, 'runs', id);
    const meta = () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    assert.match(meta().contextHash, /^[0-9a-f]{12}$/, 'the bundle hash is recorded at the start');
    const original = meta().contextHash;

    // Nothing changed: the resume goes through (and pauses again at the same external stage).
    assert.equal(run(['--resume', join('runs', id)], work).code, 3);

    writeFileSync(join(work, 'context', 'mission.md'), 'Mission: build a small reading list app. Also: sell it to everyone.\n');
    const refused = run(['--resume', join('runs', id)], work);
    assert.equal(refused.code, 14, refused.out);
    assert.match(refused.out, /context changed/);
    assert.match(refused.out, new RegExp(`ctx-${original}`));
    const now = /now ctx-([0-9a-f]{12})/.exec(refused.out)[1];
    assert.notEqual(now, original);
    assert.equal(meta().contextHash, original, 'a refusal leaves the baseline alone');

    // The declared amendment lets it proceed, and the new hash becomes the baseline.
    appendFileSync(join(runDir, 'AMENDMENTS.md'), `old ctx-${original} new ctx-${now} the owner widened the mission, 2026-09-29\n`);
    const ok = run(['--resume', join('runs', id)], work);
    assert.equal(ok.code, 3, ok.out);
    assert.match(ok.out, /context change covered by a recorded amendment/);
    assert.equal(meta().contextHash, now);
    assert.equal(run(['--resume', join('runs', id)], work).code, 3, 'and the next resume needs nothing more');
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('a run from before this check (no contextHash in run.json) resumes, and gets today\'s as its baseline', () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-ctxfreeze-old-'));
  try {
    mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'context'));
    writeFileSync(join(work, 'tasks', 'x.md'), 'A test task.');
    writeFileSync(join(work, 'context', 'mission.md'), 'Mission: one.\n');
    assert.equal(run(['--task', 'tasks/x.md', '--chain', 'mock-external', '--context', 'context', '--max-usd', '1'], work).code, 3);
    const id = readdirSync(join(work, 'runs'))[0];
    const p = join(work, 'runs', id, 'run.json');
    const { contextHash: _drop, ...old } = JSON.parse(readFileSync(p, 'utf8'));
    writeFileSync(p, JSON.stringify(old));
    assert.equal(run(['--resume', join('runs', id)], work).code, 3);
    const baseline = JSON.parse(readFileSync(p, 'utf8')).contextHash;
    assert.match(baseline, /^[0-9a-f]{12}$/);
    writeFileSync(join(work, 'context', 'mission.md'), 'Mission: two.\n');
    assert.equal(run(['--resume', join('runs', id)], work).code, 14, 'from then on a change is caught');
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('a run with no --context is not affected', () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-ctxfreeze-none-'));
  try {
    mkdirSync(join(work, 'tasks'));
    writeFileSync(join(work, 'tasks', 'x.md'), 'A test task.');
    assert.equal(run(['--task', 'tasks/x.md', '--chain', 'mock-external', '--max-usd', '1'], work).code, 3);
    const id = readdirSync(join(work, 'runs'))[0];
    assert.equal(JSON.parse(readFileSync(join(work, 'runs', id, 'run.json'), 'utf8')).contextHash, null);
    assert.equal(run(['--resume', join('runs', id)], work).code, 3);
  } finally { rmSync(work, { recursive: true, force: true }); }
});
