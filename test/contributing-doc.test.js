// test/contributing-doc.test.js
//
// v5 §1 candidate 12: CONTRIBUTING.md must exist and name all three smallest landable
// contribution types, so a solo maintainer isn't triaging unscoped PRs by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('test_contributing_doc_shape: CONTRIBUTING.md exists and names all three contribution types', () => {
  const path = join(root, 'CONTRIBUTING.md');
  assert.equal(existsSync(path), true, 'CONTRIBUTING.md must exist at repo root');
  const text = readFileSync(path, 'utf8').toLowerCase();
  assert.ok(text.includes('provider adapter'), 'must name a new provider adapter as a landable contribution');
  assert.ok(text.includes('chain config'), 'must name a new chain config as a landable contribution');
  assert.ok(text.includes('mock fixture'), 'must name a new mock fixture as a landable contribution');
});
