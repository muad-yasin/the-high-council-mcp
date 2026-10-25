// T1-1 positional rule (14 Oct 2026): the main path has no bare-word form, so a word that is neither an option nor the value of one was IGNORED, and a word meant as an option (`dry-run` with no hyphens, `ーdry-run` with a katakana prolonged-sound
// mark, `一dry-run` with the CJK numeral one) started a paid run with the option dropped (probe p24, scratch/c/probe-out). No list of look-alike glyphs closes that class; refusing every unconsumed word on the main path does.
// Every spawn runs in a fresh temp directory on the all-mock chain, so even a regression costs $0 and never touches the shared runs/ folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const VALUE = new Set(['chain', 'task', 'label', 'max-usd']);
const BOOL = new Set(['dry-run', 'json']);
function workDir() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-stray-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/x.md', ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, timeout: 60_000 });

test('PO-1 unit: a word that is not an option and not a value is stray; values, options and a first -v are not', async () => {
  const { findStrayPositional, strayPositionalLine } = await import('../src/unknown-flag.js');   // imported here, so this file loads (and its other tests run) at a commit that lacks the export
  const stray = a => findStrayPositional(a, VALUE, BOOL);
  assert.deepEqual(stray(['dry-run']), { token: 'dry-run' });
  assert.deepEqual(stray(['ーdry-run']), { token: 'ーdry-run' });
  assert.deepEqual(stray(['一dry-run']), { token: '一dry-run' });
  assert.deepEqual(stray(['--task', 'a.md', 'extra']), { token: 'extra' });
  assert.deepEqual(stray(['--json', 'a.md']), { token: 'a.md' }, 'a boolean option takes no value, so the word after it is stray');
  assert.deepEqual(stray(['--max-usd', '5', 'dry-run']), { token: 'dry-run' });
  assert.deepEqual(stray(['--label', 'hello', 'world']), { token: 'world' });
  assert.deepEqual(stray(['-']), { token: '-' });
  assert.equal(stray(['--task', 'a.md', '--chain', 'mock', '--dry-run']), null);
  assert.equal(stray(['--label', 'two words', '--json']), null);
  assert.equal(stray(['--max-usd', '-1']), null, 'a value is a value, whatever it starts with');
  assert.equal(stray(['-v']), null);
  assert.deepEqual(stray(['x', '-v']), { token: 'x' });
  assert.equal(stray([]), null);
  assert.equal(strayPositionalLine({ token: 'dry-run' }), 'dry-run: not a command, and not the value of any option, so it would be ignored. Options start with --. Nothing was run and nothing was spent.');
});

for (const [args, word] of [[['dry-run'], 'dry-run'], [['ーdry-run'], 'ーdry-run'], [['一dry-run'], '一dry-run'], [['--max-usd', '5', 'dry-run'], 'dry-run'], [['dry-run', '--max-usd', '5'], 'dry-run'], [['--label', 'hello', 'world'], 'world']]) {
  test(`PO-2 ${JSON.stringify(args)}: refused on the real CLI - exit 2, one line, nothing started, no run folder`, () => {
    const dir = workDir();
    try {
      const r = run(dir, args);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.equal(r.stderr.trim(), `${word}: not a command, and not the value of any option, so it would be ignored. Options start with --. Nothing was run and nothing was spent.`);
      assert.equal(r.stdout, '');
      assert.equal(existsSync(join(dir, 'runs')), false, 'nothing was started');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// ORDER (C&C FIX on 5837985, 14 Oct 2026): the stray-word refusal is the LAST refusal before money moves. It comes after every more specific refusal of its block and before the lock, the folder and the first call.
// The first version of this file refused the stray word FIRST and PO-4 pinned that ("before the folder is read", on a folder that does not exist); a box suite then showed the generic line speaking ahead of `--advice-meta`'s and
// `--advice-adopt`'s own refusals. PO-4 is changed here (disclosed in the report; it was never an accepted assertion): it now uses REAL folders, so it is a CONTROL (green at both commits) of the one thing that must not move:
// when no earlier refusal applies, the stray word is still refused, and nothing is written. PO-5 and PO-6 are the inverse pins (red at the parent).
const stray = w => `${w}: not a command, and not the value of any option, so it would be ignored. Options start with --. Nothing was run and nothing was spent.`;
const spawn = (dir, args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, timeout: 60_000 });
function realRun() {   // a finished mock run (the chain mock-budget is priced at fixture prices; $0 real)
  const dir = workDir();
  const r = spawn(dir, ['--chain', 'mock-budget', '--task', 'tasks/x.md', '--max-usd', 'none']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { dir, run: join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]) };
}
function reportOnlyRun() {   // what `digest` reads: a folder with a report.json
  const dir = workDir();
  mkdirSync(join(dir, 'run1'));
  writeFileSync(join(dir, 'run1', 'report.json'), JSON.stringify({ outcome: 'no_consensus', disagreement_groups: [{ on: 'p1', title: 'whether to build item 4', posts: [{ by: 'deepseek', stance: 'object', text: 'adds a script' }] }] }));
  return { dir, run: join(dir, 'run1') };
}
for (const [name, make, args] of [
  ['handoff', realRun, run => ['handoff', '--from-run', run, 'dry-run']],
  ['contract draft', realRun, run => ['contract', 'draft', '--from-run', run, 'dry-run']],
  ['digest', reportOnlyRun, run => ['digest', '--run', run, '--provider', 'mock', '--model', 'mock-priced', '--max-usd', '5', 'dry-run']],
  ['--rematch', realRun, run => ['--rematch', run, 'dry-run']],
  ['--replay', realRun, run => ['--replay', run, 'dry-run']],
]) {
  test(`PO-4 control, ${name}: on a REAL folder with no earlier refusal, the stray word is still refused (exit 2) and nothing is written`, () => {
    const { dir, run } = make();
    try {
      const before = readdirSync(run).sort();
      const siblings = existsSync(join(dir, 'runs')) ? readdirSync(join(dir, 'runs')).sort() : [];   // a refused --rematch / --replay must leave no .rematch-* / .replay-* folder
      const r = spawn(dir, args(run));
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.ok(r.stderr.trimEnd().endsWith(stray('dry-run')), r.stderr);   // ends with: a handoff may print its own notes about the draft it picked first
      assert.deepEqual(readdirSync(run).sort(), before, 'no HANDOFF, draft, digest, prompt file or lock was left in the folder');
      assert.deepEqual(existsSync(join(dir, 'runs')) ? readdirSync(join(dir, 'runs')).sort() : [], siblings, 'no side folder was made');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// PO-5: a block's OWN refusal is the one the person reads, not the generic stray-word line, whatever else is on the line. Every row is red at the parent commit (the stray word spoke first there).
for (const [name, args, expect] of [
  ['handoff on a folder that is not a run', ['handoff', '--from-run', 'runs/none', 'dry-run'], /is not a run folder/],
  ['contract draft on a folder that is not a run', ['contract', 'draft', '--from-run', 'runs/none', 'dry-run'], /is not a run folder/],
  ['digest on a folder that is not a run', ['digest', '--run', 'runs/none', '--provider', 'mock', '--model', 'mock-priced', '--max-usd', '5', 'dry-run'], /^digest: /],
  ['--rematch on a folder with no report', ['--rematch', 'runs/none', 'dry-run'], /^--rematch: no report\.json/],
  ['--replay on a folder that is not a completed run', ['--replay', 'runs/none', 'dry-run'], /^--replay: .*is not a completed run folder/],
  ['--max-usd with no value', ['--chain', 'mock', '--task', 'tasks/x.md', 'dry-run', '--max-usd'], /^--max-usd: needs a value/],
  ['--pii-gate with a mode that does not exist', ['--chain', 'mock', '--task', 'tasks/x.md', '--pii-gate', 'bogus', 'dry-run'], /^--pii-gate: expected "warn" or "hard-stop"/],
  ['--advice-meta, removed in 0.8.1', ['--chain', 'mock', '--task', 'tasks/x.md', '--advice-meta', 'm.json', 'dry-run'], /^--advice-meta was removed in 0\.8\.1/],
]) {
  test(`PO-5 ${name}: its own refusal is shown, not the stray-word line`, () => {
    const dir = workDir();
    try {
      const r = spawn(dir, args);
      assert.notEqual(r.status, 0, r.stdout + r.stderr);
      assert.doesNotMatch(r.stderr, /not a command, and not the value of any option/, r.stderr);
      assert.match(r.stderr.trim(), expect);
      assert.equal(existsSync(join(dir, 'runs')), false, 'nothing was started');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// PO-5, dry runs with a refusal of their own: a dry run takes no lock, so its policy gate and its unpriced-seat refusal are the last refusals before it prints. They come before the stray word.
function userChain(o, name, change) {   // a user chain in the working directory, mock-budget with one seat changed, and the run pointed at it
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-budget.json'), 'utf8'));
  change(cfg.seats); cfg.name = name;
  mkdirSync(join(o.dir, 'chains'), { recursive: true });
  writeFileSync(join(o.dir, 'chains', `${name}.json`), JSON.stringify(cfg));
  const meta = JSON.parse(readFileSync(join(o.run, 'run.json'), 'utf8')); meta.chain = name;
  writeFileSync(join(o.run, 'run.json'), JSON.stringify(meta));
}
test('PO-5 handoff --dry-run with a policy the chain does not meet: COUNCIL-E005 (exit 12), not the stray-word line', () => {
  const o = realRun();
  try {
    writeFileSync(join(o.dir, 'policy.json'), JSON.stringify({ required_chain_tags: ['approved'] }));
    const r = spawn(o.dir, ['handoff', '--from-run', o.run, '--dry-run', 'dry-run']);
    assert.equal(r.status, 12, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /not a command, and not the value of any option/, r.stderr);
    assert.match(r.stderr, /COUNCIL-E005/);
  } finally { rmSync(o.dir, { recursive: true, force: true }); }
});
test('PO-5 handoff --dry-run on a chain with an unpriced seat: the existing no-price refusal (exit 5), not the stray-word line', () => {
  const o = realRun();
  try {
    userChain(o, 'unpriced-x', seats => { seats.builder = { provider: 'openrouter', model: 'vendor/not-in-the-table', maxTokens: 8000, lab: 'vendor' }; });
    const r = spawn(o.dir, ['handoff', '--from-run', o.run, '--dry-run', 'dry-run']);
    assert.equal(r.status, 5, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /not a command, and not the value of any option/, r.stderr);
    assert.match(r.stderr, /"openrouter\/vendor\/not-in-the-table" has no listed price/);
  } finally { rmSync(o.dir, { recursive: true, force: true }); }
});
test('PO-5 digest --dry-run with an unpriced seat: the no-price refusal (exit 5), not the stray-word line', () => {
  const o = reportOnlyRun();
  try {
    const r = spawn(o.dir, ['digest', '--run', o.run, '--provider', 'openrouter', '--model', 'vendor/not-in-the-table', '--dry-run', 'dry-run']);
    assert.equal(r.status, 5, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /not a command, and not the value of any option/, r.stderr);
    assert.match(r.stderr, /"openrouter\/vendor\/not-in-the-table" has no listed price/);
  } finally { rmSync(o.dir, { recursive: true, force: true }); }
});

// PO-6: the removed flags are found in the SOURCE (every "--flag was removed in <version>" sentence in src/cli.js), so a flag removed later cannot be missed by a hand-kept list. Each, given a value and then a stray word, must show its
// own removal sentence. (The suite once caught `--advice-meta` only by the luck of an old assertion.) A floor on the count guards the scan itself: zero flags found would pass an empty loop.
const REMOVED = [...new Set([...readFileSync(join(root, 'src', 'cli.js'), 'utf8').matchAll(/['"`](--[a-z][a-z0-9-]*) was removed in \d+\.\d+\.\d+/g)].map(m => m[1]))];
test('PO-6 scan: the source names at least the one removed flag this file knows about', () => {
  assert.ok(REMOVED.includes('--advice-meta'), `found: ${REMOVED.join(', ') || 'none'}`);
});
for (const flag of REMOVED) {
  test(`PO-6 ${flag} (removed): a value and a stray word after it still get the removal sentence`, () => {
    const dir = workDir();
    try {
      const r = run(dir, [flag, 'm.json', 'stray']);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr.trim(), new RegExp(`^${flag} was removed in \\d+\\.\\d+\\.\\d+`));
      assert.doesNotMatch(r.stderr, /not a command, and not the value of any option/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('PO-3 controls (green at the old code too): the real options, values that look like words, a first -v and the subcommands still work', () => {
  const dir = workDir();
  try {
    for (const args of [['--dry-run'], ['--dry-run', '--json'], ['--label', 'hello', '--dry-run'], ['--max-usd', '5', '--dry-run'], ['--max-usd', 'none', '--dry-run']]) {
      const r = run(dir, args);
      assert.equal(r.status, 0, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    }
    const v = spawnSync(process.execPath, [cli, '-v'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
    assert.equal(v.status, 0);
    const doctor = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, timeout: 60_000 });
    assert.doesNotMatch(doctor.stderr, /not a command, and not the value of any option/, 'a subcommand is dispatched before the rule runs');
    const lint = spawnSync(process.execPath, [cli, 'lint-criteria', '--criteria', join(dir, 'tasks', 'x.md')], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, timeout: 60_000 });
    assert.doesNotMatch(lint.stderr, /not a command, and not the value of any option/);
    assert.equal(existsSync(join(dir, 'runs')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
