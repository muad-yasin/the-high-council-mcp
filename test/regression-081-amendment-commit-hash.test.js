// 0.8.1 FX-5 (the 2026-10-02 audit of 0.8.0, finding 5): an AMENDMENTS.md entry whose reason cites a full commit
// hash (40 hex) was read as moving the task to that hash, because the parser took the last hash token in the file.
// An entry is one line: old hash, new hash, reason, timestamp. The target is the entry's second hash token; a line with
// one hash token keeps the 0.7.9 meaning (that token is the target).
import test from 'node:test';
import assert from 'node:assert/strict';
import { latestAmendmentTarget, checkFrozenScope } from '../src/scope-freeze.js';

const A = 'aaaaaaaaaaaa', B = 'bbbbbbbbbbbb';
const commit = '3f9a2b7c1d4e5f60718293a4b5c6d7e8f9012345'; // 40 hex, a git commit id

test('FX-5: a reason that cites a 40-character commit hash leaves the entry\'s second hash as the target', () => {
  assert.equal(latestAmendmentTarget(`- ${A} -> ${B}: reverted ${commit} because it broke the build, 2026-10-02T21:00Z\n`), B);
  assert.equal(latestAmendmentTarget(`old ${A} new ${B} after ${commit}\n`), B);
  assert.equal(checkFrozenScope({ storedHash: A, currentHash: B, amendmentsText: `old ${A} new ${B} after ${commit}\n` }).ok, true);
});

test('FX-5: the last entry (line) wins; an entry with one hash keeps the 0.7.9 meaning; 12-character and ctx- forms as before', () => {
  assert.equal(latestAmendmentTarget(`old ${A} new ${B} first\nold ${B} new cccccccccccc second, see ${commit}\n`), 'cccccccccccc');
  assert.equal(latestAmendmentTarget(`moved to ${B} on 2026-09-29\n`), B, 'one hash token: that is the target');
  assert.equal(latestAmendmentTarget(`old ${A} new ${B} task\nold ctx-${A} new ctx-cccccccccccc context\n`), B, 'a context entry is not a task entry');
  assert.equal(latestAmendmentTarget(`old ${A} new ${B} at 20260929101500`), B, 'a digit-only token is not a hash');
  assert.equal(latestAmendmentTarget('no hash here'), null);
});
