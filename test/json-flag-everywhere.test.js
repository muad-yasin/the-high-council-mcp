// C&C ruling (14 Oct 2026, on the --json table of the D1 report): `--json` is accepted only with the MAIN command's --dry-run and by the `council replay --run <folder>` transcript; everywhere else it is refused (exit 2, one sentence, nothing
// run), because a flag that is silently ignored is the T1-1 class and a script that expected JSON got text. The five paid side commands with --dry-run keep their own sentence (SG-15, E 138). Every spawn is $0 (mock chains) in a fresh temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const SENTENCE = '--json: only the main command\'s dry run (`council --chain <name> --dry-run --json`) and `council replay --run <folder>` read it, so here it would be ignored. Nothing was run and nothing was spent.';
const sh = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd }, timeout: 90_000 });
function work() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-json-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'A mock task.');
  return dir;
}
const withWork = fn => { const d = work(); try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };

const REFUSED = [
  ['the main REAL run', ['--chain', 'mock', '--task', 'tasks/x.md', '--json']],
  ['--spend', ['--spend', '--json']],
  ['--cost-today', ['--cost-today', '--json']],
  ['--forecast-cost', ['--forecast-cost', '--chain', 'mock', '--json']],
  ['doctor', ['doctor', '--json']],
  ['lint-criteria', ['lint-criteria', '--criteria', 'tasks/x.md', '--json']],
  ['tree', ['tree', 'status', 'x', '--json']],
  ['handoff WITHOUT --dry-run', ['handoff', '--from-run', 'runs/none', '--json']],
  ['digest WITHOUT --dry-run', ['digest', '--run', 'runs/none', '--json']],
  ['--rematch WITHOUT --dry-run', ['--rematch', 'runs/none', '--json']],
  ['--replay WITHOUT --dry-run', ['--replay', 'runs/none', '--json']],
  ['--spend WITH --dry-run (a mode that never prints the JSON dry run)', ['--spend', '--dry-run', '--json']],
  ['--help WITH --dry-run (prints the usage and exits)', ['--help', '--dry-run', '--json']],
];
for (const [name, args] of REFUSED) {
  test(`JF-1 ${name} --json: refused (exit 2, one sentence), nothing run, no run folder`, () => withWork(dir => {
    const r = sh(dir, args);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(r.stderr.trim(), SENTENCE);
    assert.equal(r.stdout, '');
    assert.equal(existsSync(join(dir, 'runs')), false);
  }));
}

test('JF-2 controls (green before this change): the two readers still work - the main --dry-run --json prints one JSON document; `council replay --run <folder> --json` prints a JSON transcript', () => withWork(dir => {
  const dry = sh(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--dry-run', '--json']);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.equal(JSON.parse(dry.stdout).kind, 'dry-run');
  const real = sh(dir, ['--chain', 'mock', '--task', 'tasks/x.md']);
  assert.equal(real.status, 0, real.stdout + real.stderr);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const rep = sh(dir, ['replay', '--run', run, '--json']);
  assert.equal(rep.status, 0, rep.stdout + rep.stderr);
  assert.ok(Array.isArray(JSON.parse(rep.stdout)));
}));

test('JF-3 the five side commands with --dry-run keep their own sentence (E 138), not the general one (control)', () => withWork(dir => {
  const r = sh(dir, ['handoff', '--from-run', 'runs/none', '--dry-run', '--json']);
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim(), 'handoff: --json cannot be used with --dry-run here: the dry run prints text, so the option would be ignored. Nothing was run and nothing was spent.');
}));

test('JF-4 SCANNER: every `argv[0] === \'<word>\'` dispatch in src/cli.js is in SUBCOMMANDS, so a subcommand added later cannot read --json by being absent from the list', () => {
  const src = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const listed = new Set([...(/const SUBCOMMANDS = new Set\(\[([^\]]*)\]\)/.exec(src)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]));
  assert.ok(listed.size >= 15, `SUBCOMMANDS not found or too short: ${[...listed].join(',')}`);
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');   // comment lines name the pattern too
  const dispatched = [...new Set([...code.matchAll(/\bargv\[0\] === '([^']+)'/g)].map(m => m[1]))];
  assert.ok(dispatched.length >= 12, `found ${dispatched.length} dispatches`);
  const missing = dispatched.filter(w => !listed.has(w));
  assert.deepEqual(missing, [], `subcommands dispatched on argv[0] but not in SUBCOMMANDS: ${missing.join(', ')}`);
});
