// 0.8.2 item 3 (ticket 25, owner "yes" 6 Oct 2026): `--criteria` is documented as the first-class path for spec-shaped tasks. The README sentence must match the code it describes. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCriteriaFile } from '../src/criteria-kinds.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

test('the README documents --criteria for a task that already contains its acceptance list, and what it says about the file format is true', () => {
  assert.match(readme, /\*\*If your task already contains its own acceptance list\.\*\*/);
  assert.match(readme, /--criteria criteria\.md/);
  assert.match(readme, /`council lint-criteria --criteria criteria\.md`/);
  // the format it states: one per line with a leading "- ", "* " or "1. " dropped, "#" lines skipped, JSON array or { criteria: [...] }
  assert.deepEqual(parseCriteriaFile('# Heading\n- one\n* two\n3. three\n\nplain'), ['one', 'two', 'three', 'plain']);
  assert.deepEqual(parseCriteriaFile('["a", "b"]'), ['a', 'b']);
  assert.deepEqual(parseCriteriaFile('{ "criteria": ["a"] }'), ['a']);
});
