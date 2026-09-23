// relay/test/scope-freeze.test.js
//
// v3 §2 (frozen-scope enforcement, ~/Projects/relay/tasks/thcmcp-v3-draft-fixed.md). Real
// incident: an operator added a real requirement at the build stage, after task and criteria
// were already frozen; a critic correctly failed the draft for scope it couldn't tell came
// from the owner. Two rounds and a restart were burned before the run passed. Pure decision
// logic (src/scope-freeze.js) is tested directly here, independent of src/cli.js's own file
// I/O, matching this repo's convention of extracting pure/testable units (see
// src/cache-integrity.js, src/partial-deliverable.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { taskHashOf, checkFrozenScope } from '../src/scope-freeze.js';

test('test_scope_freeze: an unchanged task always passes, regardless of AMENDMENTS.md', () => {
  const hash = taskHashOf('Original fixture task, frozen at run start.');
  const result = checkFrozenScope({ storedHash: hash, currentHash: hash, amendmentsText: null });
  assert.deepEqual(result, { ok: true, amended: false });
});

test('test_scope_freeze: a run with no recorded hash (pre-v3) is trusted, not treated as stale', () => {
  const result = checkFrozenScope({ storedHash: undefined, currentHash: taskHashOf('anything'), amendmentsText: null });
  assert.deepEqual(result, { ok: true, amended: false });
});

test('test_scope_freeze: a changed task with no covering amendment is refused, naming the mismatch', () => {
  const original = taskHashOf('Original fixture task, frozen at run start.');
  const changed = taskHashOf('A DIFFERENT requirement, injected after the fact.');
  const result = checkFrozenScope({ storedHash: original, currentHash: changed, amendmentsText: null });
  assert.equal(result.ok, false);
  assert.match(result.message, /task hash mismatch/);
  assert.match(result.message, new RegExp(original));
  assert.match(result.message, new RegExp(changed));
});

test('test_scope_freeze: a changed task covered by AMENDMENTS.md is allowed, and reports amended: true', () => {
  const original = taskHashOf('Original fixture task, frozen at run start.');
  const changed = taskHashOf('A DIFFERENT requirement, injected after the fact.');
  const amendmentsText = `old -> ${changed} | added the mobile-web-app requirement, deliberately | 2026-09-13T13:00:00Z\n`;
  const result = checkFrozenScope({ storedHash: original, currentHash: changed, amendmentsText });
  assert.deepEqual(result, { ok: true, amended: true });
});

test('test_scope_freeze: an unrelated AMENDMENTS.md entry (wrong hash) still refuses', () => {
  const original = taskHashOf('Original fixture task, frozen at run start.');
  const changed = taskHashOf('A DIFFERENT requirement, injected after the fact.');
  const amendmentsText = `old -> deadbeef00000000 | an unrelated change | 2026-09-13T13:00:00Z\n`;
  const result = checkFrozenScope({ storedHash: original, currentHash: changed, amendmentsText });
  assert.equal(result.ok, false);
});

test('taskHashOf is deterministic and content-sensitive', () => {
  assert.equal(taskHashOf('same text'), taskHashOf('same text'));
  assert.notEqual(taskHashOf('same text'), taskHashOf('different text'));
});

// Pre-release audit 2026-09-23 (PreRelease_Audit_revise #2): coverage was a bare substring match, so
// reverting the task to a hash that appeared anywhere in AMENDMENTS.md's history passed silently.
test('test_scope_freeze: reverting to an earlier hash is not covered by an older amendment entry', () => {
  const a = taskHashOf('Version A of the task.');
  const b = taskHashOf('Version B of the task.');
  const history = `old hash: ${a}, new hash: ${b} | reason: added a requirement | 2026-09-23T10:00:00Z\n`;
  // The approved change A -> B is covered.
  assert.deepEqual(checkFrozenScope({ storedHash: a, currentHash: b, amendmentsText: history }), { ok: true, amended: true });
  // Later the file goes back to A with no new entry: refused, and the message says why.
  const revert = checkFrozenScope({ storedHash: b, currentHash: a, amendmentsText: history });
  assert.equal(revert.ok, false);
  assert.match(revert.message, /only as part of an earlier entry/);
  // A new entry for B -> A covers it.
  const withRevert = `${history}old hash: ${b}, new hash: ${a} | reason: reverted | 2026-09-23T11:00:00Z\n`;
  assert.deepEqual(checkFrozenScope({ storedHash: b, currentHash: a, amendmentsText: withRevert }), { ok: true, amended: true });
});
