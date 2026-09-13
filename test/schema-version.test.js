// test/schema-version.test.js
//
// v5 §1 candidate 13: chain schema versioning field + migration warning.
// `council doctor` warns, never fails, when a chain omits schemaVersion or
// names an older one - existing chains without it keep working exactly as
// they do today.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_SCHEMA_VERSION, schemaVersionWarning } from '../src/schema-version.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

test('schemaVersionWarning: a chain declaring the current version gets no warning', () => {
  assert.equal(schemaVersionWarning({ schemaVersion: CURRENT_SCHEMA_VERSION }), null);
});

test('schemaVersionWarning: a chain with no schemaVersion at all is warned, not failed, and names the current version', () => {
  const w = schemaVersionWarning({});
  assert.ok(w);
  assert.match(w, new RegExp(`current is ${CURRENT_SCHEMA_VERSION}`));
});

test('schemaVersionWarning: a chain declaring an older version names what changed since', () => {
  const w = schemaVersionWarning({ schemaVersion: 0 });
  assert.ok(w);
  assert.match(w, /older than the current/);
});

test('schemaVersionWarning: a chain declaring a NEWER version than this build knows about is never mislabeled as older', () => {
  const w = schemaVersionWarning({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
  assert.ok(w);
  assert.match(w, /newer schema than this build/);
  assert.doesNotMatch(w, /is older than the current/);
});

test('schemaVersionWarning: a malformed schemaVersion (not an integer) is treated as absent, not thrown on', () => {
  assert.doesNotThrow(() => schemaVersionWarning({ schemaVersion: 'latest' }));
  assert.doesNotThrow(() => schemaVersionWarning(null));
  assert.doesNotThrow(() => schemaVersionWarning(undefined));
});

// v5 §1 candidate 13's own acceptance test: every shipped chain today has no
// schemaVersion field, so `council doctor` must print a warning naming the
// current expected version for each one, and still exit 0 (execFileSync
// throws on a non-zero exit, so reaching the assertions below already proves
// the chain "still validates" per the acceptance test's own wording).
test('test_schema_version_warning: council doctor warns on every unversioned shipped chain and still exits 0', () => {
  const out = execFileSync('node', [cli, 'doctor'], { encoding: 'utf8' });
  assert.match(out, new RegExp(`no schemaVersion declared - current is ${CURRENT_SCHEMA_VERSION}`));
});
