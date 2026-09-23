// Bug audit 2026-09-23 (Review/BugAudit_CLI_2026-09-23.md #7): outcomes shared exit codes, so a
// caller could not tell a missing key from a preflight block, or a usage error from the artifact
// gate. Every named exit code in src/cli.js is distinct, and the README's table lists each one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const named = [...cli.matchAll(/^const (EXIT_[A-Z_]+) = (\d+);/gm)].map(m => [m[1], Number(m[2])]);

test('every named exit code is distinct', () => {
  assert.ok(named.length >= 10, `expected the EXIT_ constants, found ${named.length}`);
  const values = named.map(([, v]) => v);
  assert.equal(new Set(values).size, values.length, JSON.stringify(named));
});

test('the README exit-code table lists every code the CLI uses, and no other', () => {
  const table = readme.slice(readme.indexOf('### Exit codes'));
  const documented = new Set([...table.slice(0, table.indexOf('Codes 9-15')).matchAll(/^\| (\d+) \|/gm)].map(m => Number(m[1])));
  const literal = [...cli.matchAll(/process\.exit\((\d+)\)/g)].map(m => Number(m[1]));
  const used = new Set([...literal, ...named.map(([, v]) => v)]);
  assert.deepEqual([...used].sort((a, b) => a - b), [...documented].sort((a, b) => a - b));
});
