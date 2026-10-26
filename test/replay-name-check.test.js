// CR-RC-007 (found with CR-RC-003): --replay of a folder that is itself a rematch (`<id>.rematch-5`), or of `<id>-init`, wrote `<name>.replay-<date>`, a folder name the spend and status readers do not recognise (the
// same hole as --rematch's CR-RM-003, which the accepted RM-3 test covers), so that replay's spend was invisible to --spend, --cost-today and the limits. Real verbs on an all-mock run, offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spendReport } from '../src/spend.js';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const DATE = '2026-10-25';
const sh = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd } });
const names = dir => readdirSync(join(dir, 'runs')).sort();
const seen = dir => spendReport(join(dir, 'runs'), { days: 3650 }).count;
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-replay-name-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'smoke.md'), 'A smoke-test task for the replay name check.\n');
  const first = sh(dir, ['--chain', 'mock-unanimous', '--task', 'tasks/smoke.md']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  return { dir, id: names(dir)[0] };
}

test('RN-1: a replay of a rematch folder, or of `<id>-init`, is refused (exit 2, the way out, dry run too) and makes no folder; the original is still replayed, and --spend counts that replay', () => {
  const { dir, id } = project();
  assert.equal(sh(dir, ['--rematch', join('runs', id), '--rematch-seed', '3']).status, 0);
  cpSync(join(dir, 'runs', id), join(dir, 'runs', `${id}-init`), { recursive: true });
  const before = names(dir); const countBefore = seen(dir);
  for (const folder of [`${id}.rematch-3`, `${id}-init`]) {
    for (const extra of [[], ['--dry-run']]) {
      const r = sh(dir, ['--replay', join('runs', folder), '--replay-date', DATE, ...extra]);
      // on a build without the check the replay runs: say what --spend then sees of the folder it made
      const made = names(dir).filter(n => !before.includes(n));
      const hole = made.length ? `; it made ${made.join(', ')} and --spend counted ${seen(dir)} run(s) where it counted ${countBefore} before` : '';
      assert.equal(r.status, 2, `${folder}${extra.join(' ')}: ${r.stdout}${r.stderr}${hole}`);
      assert.ok(r.stderr.includes(`--replay: ${folder} cannot be replayed: only a finished run whose folder is named by its start time (like 2026-10-25T18-37-06-737Z) can, because the spend of a replay of anything else would not show in --spend or the spending limits. Replay the original run instead. Nothing was run and nothing was spent.`), r.stderr);
      assert.deepEqual(names(dir), before, 'no folder was made');
    }
  }
  const ok = sh(dir, ['--replay', join('runs', id), '--replay-date', DATE]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(existsSync(join(dir, 'runs', `${id}.replay-${DATE}`)), true);
  assert.equal(seen(dir), countBefore + 1, 'the reader counts the replay of the original (so "not counted" above would be a real gap)');
});
