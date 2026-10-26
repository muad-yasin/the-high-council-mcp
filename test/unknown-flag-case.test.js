// CR-6B-003 (25 Okt 2026): the look-alike check of the unknown-option guard compared the folded name case-sensitively, so `--label —Dry-run` (an em dash and a capital D, meaning a dry run) passed both refusals and was taken as the LABEL of a
// real run (the typed-limit screen still stood before any paid call, but this is the "dry-run flag ignored" incident class). The folded name is now compared in lower case. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUnknownFlag } from '../src/unknown-flag.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const valueFlags = new Set(['label', 'task', 'chain', 'max-usd']); const boolFlags = new Set(['dry-run', 'json']);

test('UC-1 (CR-6B-003): a value flag does not swallow a look-alike of a known option in any letter case', () => {
  for (const next of ['—dry-run', '—Dry-run', '—DRY-RUN', '–Dry-Run']) assert.notEqual(findUnknownFlag(['--label', next], valueFlags, boolFlags), null, `${next} is refused, not taken as the label`);
  assert.equal(findUnknownFlag(['--label', 'Dry run notes'], valueFlags, boolFlags), null, 'an ordinary label is still a label');
  assert.equal(findUnknownFlag(['--label', '-notes.md'], valueFlags, boolFlags), null, 'and so is a hyphen-led one that is no option name');
});

test('UC-2 (CR-6B-003, real verbs): `--label —Dry-run` on the real CLI is refused with exit 2, nothing started, no run folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-flag-case-')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const r = spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/x.md', '--label', '—Dry-run'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, timeout: 60_000 });
  assert.equal(r.status, 2, `${r.stderr}${r.stdout}`);
  assert.equal(existsSync(join(dir, 'runs')), false, 'a run folder was made');
});
