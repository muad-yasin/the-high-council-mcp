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
