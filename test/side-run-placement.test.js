// CR-RC-003: --rematch and --replay write their folder BESIDE the original run. --spend, --cost-today and the spending limits read only <work>/runs, so a side folder written anywhere else is spend they cannot see.
// The original has to sit directly in this project's runs/ folder; otherwise the command refuses before anything is written (the dry run too). Real verbs on an all-mock run, offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const sh = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd } });
const listing = dir => readdirSync(dir).sort();
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-side-placement-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'smoke.md'), 'A smoke-test task for the side-run placement.\n');
  const first = sh(dir, ['--chain', 'mock-unanimous', '--task', 'tasks/smoke.md']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  return { dir, id: listing(join(dir, 'runs'))[0] };
}
const SIDE = [
  ['--rematch', 'a rematch', id => ['--rematch', id, '--rematch-seed', '3'], /\.rematch-/],
  ['--replay', 'a replay', id => ['--replay', id, '--replay-date', '2026-10-14'], /\.replay-/],
];

for (const [name, what, argsOf, sideName] of SIDE) {
  test(`${name}: a run folder that is not in a runs/ folder is refused (exit 2) with the way out, in the dry run too; nothing is written beside it`, () => {
    const { dir, id } = project();
    const loose = join(dir, 'loose'); mkdirSync(loose);
    cpSync(join(dir, 'runs', id), join(loose, id), { recursive: true });
    for (const extra of [[], ['--dry-run']]) {
      const r = sh(dir, [...argsOf(join('loose', id)), ...extra]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.ok(r.stderr.includes(`${name}: ${join(loose, id)} is not in a project's runs/ folder, so the spend of ${what} written beside it would not show in --spend, --cost-today or any project's spending limits. `), r.stderr);
      assert.ok(r.stderr.includes(`Move the folder into the runs/ folder of the project it belongs to, then run council ${name} runs/${id} from that project. Nothing was run and nothing was spent.`), r.stderr);
      assert.deepEqual(listing(loose), [id], `${name}${extra.join(' ')}: nothing was written beside the original`);
    }
    assert.deepEqual(listing(join(dir, 'runs')), [id]);
  });

  test(`${name}: a run in ANOTHER project's runs/ folder, typed from this project, is refused; the message names that project and the command to run there`, () => {
    const mine = project(); const theirs = project();
    const r = sh(mine.dir, argsOf(join(theirs.dir, 'runs', theirs.id)));
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(`${name}: ${join(theirs.dir, 'runs', theirs.id)} is in ${join(theirs.dir, 'runs')}, not in ${join(mine.dir, 'runs')}, so the spend of ${what} written beside it would not show in --spend, --cost-today or this project's spending limits. `), r.stderr);
    assert.ok(r.stderr.includes(`Run it from the project that holds that folder (${theirs.dir}), as: council ${name} runs/${theirs.id}. Nothing was run and nothing was spent.`), r.stderr);
    assert.deepEqual(listing(join(theirs.dir, 'runs')), [theirs.id], 'nothing was written in the other project');
    // and from that project, the same command runs
    const ok = sh(theirs.dir, argsOf(join('runs', theirs.id)));
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(listing(join(theirs.dir, 'runs')).some(n => sideName.test(n)), 'the side folder is in the project that owns the run');
  });
}

test('a run folder that is a symlink INSIDE runs/ still counts as in runs/ (its side folder lands next to the link); an absolute path to a runs/ reached through a symlink is accepted too', () => {
  const { dir, id } = project();
  const elsewhere = join(dir, 'elsewhere'); mkdirSync(elsewhere);
  cpSync(join(dir, 'runs', id), join(elsewhere, '2026-10-01T00-00-00-000Z'), { recursive: true });
  symlinkSync(join(elsewhere, '2026-10-01T00-00-00-000Z'), join(dir, 'runs', '2026-10-01T00-00-00-000Z'));
  const viaLink = sh(dir, ['--rematch', join('runs', '2026-10-01T00-00-00-000Z'), '--rematch-seed', '4', '--dry-run']);
  assert.equal(viaLink.status, 0, viaLink.stdout + viaLink.stderr);
  const alias = join(dir, 'runs-alias'); symlinkSync(join(dir, 'runs'), alias);
  const viaAlias = sh(dir, ['--rematch', join(alias, id), '--rematch-seed', '5', '--dry-run']);
  assert.equal(viaAlias.status, 0, viaAlias.stdout + viaAlias.stderr);
});
