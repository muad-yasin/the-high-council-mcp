// relay/test/integrity.test.js
//
// v2 plan §10 Phase 2 item 4 (~/Projects/relay/runs/2026-09-11T12-19-34-184Z/deliverable.md).
// Real incident: a 61k-token NEEDS-<stage>.md was silently truncated when read back, and the
// driving session could not see its own prompt. These pin the fix: a footer marker on every
// generated prompt file, and a read-side check that raises a loud, recorded warning rather
// than silently proceeding when the marker is missing or doesn't match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withIntegrityFooter, verifyIntegrityFooter } from '../src/integrity.js';

test('test_prompt_file_footer_matches_content: a freshly written file verifies clean', () => {
  const body = '# External stage: build\n\nSome prompt content, several lines.\nMore lines here.';
  const written = withIntegrityFooter(body);
  const result = verifyIntegrityFooter(written);
  assert.deepEqual(result, { ok: true });
});

test('test_truncated_file_triggers_warning: content cut after the footer was written raises a loud warning, not a silent pass', () => {
  const body = 'A'.repeat(5000) + '\nlast line unlikely to survive truncation';
  const written = withIntegrityFooter(body);
  // Simulate a read that truncated the file partway through the body, footer included -
  // exactly the real incident's shape: the reader silently got less than was written.
  const truncated = written.slice(0, Math.floor(written.length / 2));
  const result = verifyIntegrityFooter(truncated);
  assert.equal(result.ok, false);
  assert.match(result.warning, /truncated|no integrity footer/);
});

test('a file with no footer at all (predates the fix) is flagged, not silently trusted', () => {
  const result = verifyIntegrityFooter('# some old prompt file with no footer\n\ncontent');
  assert.equal(result.ok, false);
  assert.match(result.warning, /no integrity footer/);
});

test('a footer present but not matching the body (hand-edited or corrupted) is flagged', () => {
  const written = withIntegrityFooter('original content');
  const tampered = written.replace('original content', 'original content, but someone appended more text after writing the footer');
  const result = verifyIntegrityFooter(tampered);
  assert.equal(result.ok, false);
  assert.match(result.warning, /does not match/);
});
