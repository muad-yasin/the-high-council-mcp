// Locked criteria (src/criteria-lock.js, 0.8.0 roadmap item 1): a fingerprint the harness writes over
// the acceptance criteria, a block at the end of HANDOFF.md, and a $0 `council check-lock`. Also the
// amendment-hash fix in src/scope-freeze.js. Offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criteriaHash, lockBlock, parseLock, checkLock, LOCK_HEADING } from '../src/criteria-lock.js';
import { latestAmendmentTarget, checkFrozenScope, taskHashOf } from '../src/scope-freeze.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRITERIA = ['The plan names a data store.', 'The plan lists the API routes.', 'The plan says how a user signs in.'];
const HANDOFF = `# Handoff\n\nBuild the thing.\n${lockBlock(CRITERIA, { runId: '2026-09-29T10-00-00-000Z' })}`;

test('criteriaHash: 64 hex, stable, order and text count, whitespace does not', () => {
  const h = criteriaHash(CRITERIA);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(criteriaHash([...CRITERIA]), h);
  assert.notEqual(criteriaHash([CRITERIA[1], CRITERIA[0], CRITERIA[2]]), h, 'order');
  assert.notEqual(criteriaHash(CRITERIA.slice(0, 2)), h, 'a removed criterion');
  assert.notEqual(criteriaHash([CRITERIA[0] + '!', CRITERIA[1], CRITERIA[2]]), h, 'an edited criterion');
  assert.equal(criteriaHash(['The plan   names a data\nstore.', CRITERIA[1], CRITERIA[2]]), h, 'runs of whitespace are one space');
});

test('lockBlock: nothing to lock is an empty string; a block round-trips through parseLock', () => {
  assert.equal(lockBlock([]), '');
  assert.equal(lockBlock(undefined), '');
  const lock = parseLock(HANDOFF);
  assert.equal(lock.found, true);
  assert.equal(lock.count, 3);
  assert.equal(lock.run, '2026-09-29T10-00-00-000Z');
  assert.deepEqual(lock.criteria.map(c => c.text), CRITERIA);
  assert.equal(lock.sha256, criteriaHash(CRITERIA));
  assert.equal(parseLock('no block here').found, false);
});

test('checkLock: an untouched block holds, with or without the run\'s own list', () => {
  assert.deepEqual(checkLock(HANDOFF).problems, []);
  assert.equal(checkLock(HANDOFF).ok, true);
  assert.equal(checkLock(HANDOFF, { expected: CRITERIA }).ok, true);
});

test('checkLock: an edited, removed, added, reordered or renumbered criterion is caught', () => {
  const bad = (edit, why) => {
    const r = checkLock(edit(HANDOFF));
    assert.equal(r.ok, false, why);
    assert.ok(r.problems.length >= 1, why);
    return r;
  };
  bad(t => t.replace('names a data store', 'names any store'), 'edited');
  bad(t => t.replace(/^C2\. .*\n/m, ''), 'removed');
  bad(t => t.replace('C3. The plan says', 'C3. The plan always says'), 'edited last');
  bad(t => t.replace(/(C3\. .*\n)/, '$1C4. Bonus criterion.\n'), 'added');
  bad(t => t.replace('C1. The plan names a data store.\nC2. The plan lists the API routes.', 'C1. The plan lists the API routes.\nC2. The plan names a data store.'), 'reordered');
  bad(t => t.replace('C2. ', 'C7. '), 'renumbered');
  bad(t => t.replace(LOCK_HEADING, '## Something else'), 'heading gone');
  assert.match(checkLock(HANDOFF.replace('count=3', 'count=4')).problems.join('\n'), /says 4 criteria but lists 3/);
});

test('checkLock: a block that is internally consistent but not the run\'s criteria is caught with the run list', () => {
  const swapped = `# Handoff\n${lockBlock(['Something else entirely.'])}`;
  assert.equal(checkLock(swapped).ok, true, 'a self-consistent file passes alone (it is not a signature)');
  const r = checkLock(swapped, { expected: CRITERIA });
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /differ from the ones in this file/);
});

test('checkLock: no block is reported as not found, and never throws on junk', () => {
  assert.deepEqual(checkLock('# Handoff\n'), { ok: false, found: false, problems: ['no criteria-lock block in this file'] });
  for (const junk of [null, undefined, 42, '', '<!-- the-high-council:criteria-lock sha256=zz count=1 -->']) assert.equal(checkLock(junk).ok, false);
});

// ---- scope-freeze: a full-length hash in AMENDMENTS.md ----
test('latestAmendmentTarget: a full 64-hex hash names the same target as its first 12', () => {
  const next = taskHashOf('the new task text');
  const full = next + '0'.repeat(52); // 12 real hex characters, then padding hex: a stand-in for `sha256sum` output starting with them
  assert.equal(latestAmendmentTarget(`old 111111111111 new ${full} because the scope grew`), next);
  assert.equal(latestAmendmentTarget(`old 111111111111 new ${next} 2026-09-29`), next, 'the 12-hex form still works');
  assert.equal(latestAmendmentTarget('no hash here'), null);
  assert.equal(latestAmendmentTarget(undefined), null);
});

test('latestAmendmentTarget: a long all-digit token (a compact timestamp) is not a hash', () => {
  const next = 'abcdef012345';
  assert.equal(latestAmendmentTarget(`old 111111111111 new ${next} at 20260929101500`), next);
  assert.equal(latestAmendmentTarget(`old 111111111111 new ${next} run 2026092910150012345`), next);
});

test('checkFrozenScope: an amendment written with the full hash covers the change', () => {
  const stored = taskHashOf('original');
  const now = taskHashOf('changed');
  const amendments = `${stored} -> ${now}${'0'.repeat(52)}: scope grew, 2026-09-29\n`;
  assert.deepEqual(checkFrozenScope({ storedHash: stored, currentHash: now, amendmentsText: amendments }), { ok: true, amended: true });
});

// ---- through a real mock run and the CLI ----
function run(cwd, args) {
  return spawnSync(process.execPath, [join(root, 'src/cli.js'), ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd }, timeout: 90_000 });
}

test('a run with a handoff ends HANDOFF.md with the lock, report.json carries the same fingerprint, and check-lock agrees', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-lock-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
    const r = run(dir, ['--chain', 'mock-debate', '--task', 'tasks/t.md']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    const handoff = readFileSync(join(runDir, 'HANDOFF.md'), 'utf8');
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.match(handoff, /## Locked criteria/);
    assert.equal(report.criteria_sha256, criteriaHash(report.criteria));
    assert.equal(parseLock(handoff).sha256, report.criteria_sha256);
    assert.deepEqual(parseLock(handoff).criteria.map(c => c.text), report.criteria.map(c => c.replace(/\s+/g, ' ').trim()));

    const ok = run(dir, ['check-lock', join(runDir, 'HANDOFF.md'), '--run', runDir]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /criteria lock holds/);
    assert.equal(run(dir, ['verify-handoff', join(runDir, 'HANDOFF.md')]).status, 0, 'the alias');

    // A careless edit of one criterion in the project's own copy.
    const copy = join(dir, 'HANDOFF-copy.md');
    writeFileSync(copy, handoff.replace(/^C1\. .*$/m, 'C1. Anything at all.'));
    const bad = run(dir, ['check-lock', copy, '--run', runDir]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /no longer match the fingerprint/);

    writeFileSync(join(dir, 'plain.md'), '# no block\n');
    assert.equal(run(dir, ['check-lock', join(dir, 'plain.md')]).status, 2, 'nothing to check');
    assert.equal(run(dir, ['check-lock', join(dir, 'missing.md')]).status, 2);
    assert.equal(run(dir, ['check-lock']).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
