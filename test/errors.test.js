// test/errors.test.js
//
// v5 §1 candidate 4: a stable error catalog for every hard-fail path this
// project actually has, each documented in TROUBLESHOOTING.md, with a
// distinct exit code for a degradable condition vs. a fatal one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_CATALOG, formatCouncilError, CouncilError } from '../src/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const repoRoot = resolve(here, '..');
const troubleshooting = readFileSync(join(repoRoot, 'TROUBLESHOOTING.md'), 'utf8');

test('every catalog code is documented in TROUBLESHOOTING.md', () => {
  for (const code of Object.keys(ERROR_CATALOG)) {
    assert.match(troubleshooting, new RegExp(code), `${code} is missing from TROUBLESHOOTING.md`);
  }
});

test('every catalog message follows the fixed tone shape and carries no jargon-as-apology', () => {
  for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
    const msg = formatCouncilError(code, new Proxy({}, { get: () => 'x' }));
    assert.match(msg, new RegExp(`^${code} \\[${entry.kind}\\] ${entry.title}`));
    assert.doesNotMatch(msg, /!/, `${code} must carry no exclamation marks`);
    assert.doesNotMatch(msg, /\b(sorry|oops|apologi[sz]e)\b/i, `${code} must carry no apology`);
    assert.match(msg, /\n\n/, `${code} must have a blank line before the fix`);
    assert.match(msg, /See: /, `${code} must point at a doc`);
  }
});

test('CouncilError carries the catalog code and kind', () => {
  const err = new CouncilError('COUNCIL-E001', { provider: 'anthropic', chain: 'verify', envVar: 'ANTHROPIC_API_KEY' });
  assert.equal(err.code, 'COUNCIL-E001');
  assert.equal(err.kind, 'degradable');
  assert.match(err.message, /COUNCIL-E001/);
});

test('formatCouncilError throws on an unknown code - a bug in the caller, not a user condition', () => {
  assert.throws(() => formatCouncilError('COUNCIL-E999', {}));
});

test('test_error_catalog_coverage: missing key exits degradable, with a COUNCIL-Exxx code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-errcat-key-'));
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'needs-key.json'), JSON.stringify({
    name: 'needs-key', description: 'x', maxRounds: 1,
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
  }));
  writeFileSync(join(dir, 'task.md'), 'A task.');
  assert.throws(() => execFileSync('node', [cli, '--chain', 'needs-key', '--task', 'task.md'],
    { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } }));
  try {
    execFileSync('node', [cli, '--chain', 'needs-key', '--task', 'task.md'],
      { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  } catch (err) {
    assert.equal(err.status, 5);
    assert.match(err.stderr, /COUNCIL-E\d{3}/);
    assert.match(err.stderr, /degradable/);
  }
});

test('test_error_catalog_coverage: an unpriced model is flagged in --dry-run with a COUNCIL-Exxx code, degradable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-errcat-price-'));
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'unpriced.json'), JSON.stringify({
    name: 'unpriced', description: 'x', maxRounds: 1,
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'no-such-model-in-pricing-json' }],
    },
  }));
  const out = execFileSync('node', [cli, '--chain', 'unpriced', '--dry-run'], { encoding: 'utf8', cwd: dir });
  assert.match(out, /COUNCIL-E\d{3}/);
  assert.match(out, /degradable/);
});

test('a mock chain\'s synthetic seats are never flagged as unpriced', () => {
  const out = execFileSync('node', [cli, '--chain', 'mock', '--dry-run'], { encoding: 'utf8', cwd: repoRoot });
  assert.doesNotMatch(out, /COUNCIL-E002/);
});

test('test_error_catalog_coverage: a malformed chain file exits fatal, with a COUNCIL-Exxx code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-errcat-badjson-'));
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'broken.json'), '{not valid json');
  assert.throws(() => execFileSync('node', [cli, '--chain', 'broken', '--dry-run'], { encoding: 'utf8', cwd: dir }));
  try {
    execFileSync('node', [cli, '--chain', 'broken', '--dry-run'], { encoding: 'utf8', cwd: dir });
  } catch (err) {
    assert.equal(err.status, 6);
    assert.match(err.stderr, /COUNCIL-E\d{3}/);
    assert.match(err.stderr, /fatal/);
  }
});

test('council doctor (no --run/--chain) lists every catalog code in its diagnostic block', () => {
  const out = execFileSync('node', [cli, 'doctor'], { encoding: 'utf8', cwd: repoRoot });
  for (const code of Object.keys(ERROR_CATALOG)) {
    assert.match(out, new RegExp(code), `doctor's diagnostic block is missing ${code}`);
  }
});
