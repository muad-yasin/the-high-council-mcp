// ROADMAP 37 (0.8.3, M0 work item 2, owner 8 Oct 2026): the CLI refuses an option it does not know, on every command, before the command does anything.
// The case that was found: `--dry` is not a flag (only `--dry-run` is), so `council --dry --task x.md --chain y` ignored it and started a REAL paid run (VERIFIED A27, 8 Oct 2026).
// Every spawn below runs in a fresh temp directory on the all-mock chain, so even a regression costs $0 and never touches the shared runs/ folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closestFlag, findUnknownFlag, unknownFlagLine } from '../src/unknown-flag.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const cliSource = readFileSync(cli, 'utf8');

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-unknown-flag-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, timeout: 60_000 });

// The two lists, read out of src/cli.js itself (it runs on import, so the test reads the text): a failure to find them is a failure.
function listOf(name) {
  const m = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(cliSource);
  assert.ok(m, `${name} not found in src/cli.js`);
  return new Set([...m[1].matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1]));
}
const VALUE_FLAGS = listOf('VALUE_FLAGS');
const BOOLEAN_FLAGS = listOf('BOOLEAN_FLAGS');
const KNOWN = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS]);

test('--dry (the case that started a real paid run) exits 2, names --dry and suggests --dry-run, and creates no run folder', () => {
  const dir = workDir();
  try {
    const r = run(dir, ['--dry', '--task', join(dir, 'tasks', 'x.md'), '--chain', 'mock']);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /--dry\b/);
    assert.match(r.stderr, /--dry-run/);
    assert.equal(r.stderr.trim().split('\n').length, 1, 'one line');
    assert.equal(r.stdout, '');
    assert.equal(existsSync(join(dir, 'runs')), false, 'no run folder');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the real flag still works: --dry-run --json on the mock chain exits 0 with a JSON document', () => {
  const dir = workDir();
  try {
    const r = run(dir, ['--dry-run', '--json', '--chain', 'mock']);
    assert.equal(r.status, 0, r.stderr);
    JSON.parse(r.stdout);
    assert.equal(existsSync(join(dir, 'runs')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every command refuses an unknown option before it does anything (a bare one, after a subcommand, and between valid ones)', () => {
  const dir = workDir();
  try {
    for (const args of [['--bogus'], ['doctor', '--bogus'], ['lint-criteria', '--bogus', '--criteria', 'x.md'], ['--chain', 'mock', '--bogus', '--task', join(dir, 'tasks', 'x.md')], ['contract', 'show', '--bogus', 'runs/none']]) {
      const r = run(dir, args);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, /--bogus/, args.join(' '));
      assert.equal(existsSync(join(dir, 'runs')), false, args.join(' '));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a value that is not an option is never mistaken for one, and the documented no-op `init --yes` is accepted', () => {
  assert.equal(findUnknownFlag(['--task', 'tasks/x.md', '--chain', 'mock', '--dry-run'], VALUE_FLAGS, BOOLEAN_FLAGS), null);
  assert.equal(findUnknownFlag(['init', '--yes'], VALUE_FLAGS, BOOLEAN_FLAGS), null);
  // a value flag followed by another option takes no value (the rule of flag() in src/cli.js), so that option is checked too
  assert.equal(findUnknownFlag(['--task', '--bogus'], VALUE_FLAGS, BOOLEAN_FLAGS)?.name, 'bogus');
});

test('a single-dash option is refused too: -x, and -dry-run (which suggests --dry-run); -v as the first argument is still the version', () => {
  const dir = workDir();
  try {
    const task = join(dir, 'tasks', 'x.md');
    const x = run(dir, ['-x', '--chain', 'mock', '--task', task]);
    assert.equal(x.status, 2, x.stderr);
    assert.match(x.stderr, /^-x: not an option of this command/);
    const dry = run(dir, ['-dry-run', '--chain', 'mock', '--task', task]);
    assert.equal(dry.status, 2, dry.stderr);
    assert.match(dry.stderr, /^-dry-run: not an option of this command - did you mean --dry-run\?/);
    assert.equal(existsSync(join(dir, 'runs')), false, 'no run folder for either');
    const v = run(dir, ['-v']);
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /^\d+\.\d+\.\d+/);
    // -v anywhere but first is an unknown option like any other
    assert.equal(run(dir, ['--json', '-v']).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a value that starts with a dash belongs to its value flag and reaches that flag\'s own check, not this one', () => {
  assert.equal(findUnknownFlag(['--max-usd', '-1'], VALUE_FLAGS, BOOLEAN_FLAGS), null);
  assert.equal(findUnknownFlag(['--task', '-notes.md', '--dry-run'], VALUE_FLAGS, BOOLEAN_FLAGS), null);
  assert.equal(findUnknownFlag(['-1'], VALUE_FLAGS, BOOLEAN_FLAGS), null, 'a bare negative number is no option');
  assert.equal(findUnknownFlag(['-x'], VALUE_FLAGS, BOOLEAN_FLAGS)?.token, '-x');
  assert.equal(findUnknownFlag(['--chain', 'mock', '-dry-run'], VALUE_FLAGS, BOOLEAN_FLAGS)?.suggestion, 'dry-run');
});

test('`council init --yes` (the documented no-op, offline and $0) is not refused', () => {
  const dir = workDir();
  try {
    const r = spawnSync(process.execPath, [cli, 'init', '--yes'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /not an option/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the suggestion: a known flag that starts with what was typed wins over a nearer-by-edit-distance one', () => {
  assert.equal(closestFlag('dry', KNOWN), 'dry-run');          // edit distance alone picks `days` (2) over `dry-run` (4)
  assert.equal(closestFlag('chian', KNOWN), 'chain');          // a transposition
  assert.equal(closestFlag('maxusd', KNOWN), 'max-usd');
  assert.equal(closestFlag('Dry-Run', KNOWN), 'dry-run');
  assert.equal(closestFlag('zzzzzz', KNOWN), null);
  assert.match(unknownFlagLine({ token: '--zzzzzz', suggestion: null }), /^--zzzzzz: not an option of this command\. Nothing was run/);
});

// --- the list is complete: every option the CLI reads is on it --------------------------------------------------------------------------------------------------------------------
// Every file that is handed argv (or a slice of it) by src/cli.js: contractCommand, gateCommand, adviseRateCommand and stopCommand.
// 0.8.3 M5b: src/tree-cli.js (`council tree ...`) spells every option its verbs take with their dashes, so this scan sees them.
const OPTION_FILES = ['src/cli.js', 'src/contract-cli.js', 'src/gate-cli.js', 'src/advise-rate.js', 'src/advice-stop.js', 'src/tree-cli.js'];
// Every `--name` that appears on a non-comment line of a file that reads options, every flag('name') call, and the names of a `for (const name of [...])` loop (src/cli.js checks six value flags
// that way, then calls flag(name)). Known limit: any OTHER flag(variable) is invisible to this scan; the first test that passes that option sees it refused, which is how it would be found.
function optionsReadBy(files, readFile = f => readFileSync(join(root, f), 'utf8')) {
  const found = new Set();
  for (const f of files) {
    for (const line of readFile(f).split('\n')) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const m of line.matchAll(/(?<![A-Za-z0-9-])--([a-z][a-z0-9-]*)/g)) found.add(m[1]);
      for (const m of line.matchAll(/\bflag\(\s*['"`]([a-z][a-z0-9-]*)['"`]/g)) found.add(m[1]);
      const loop = /for \(const name of \[([^\]]*)\]\)/.exec(line);
      if (loop) for (const m of loop[1].matchAll(/['"`]([a-z][a-z0-9-]*)['"`]/g)) found.add(m[1]);
    }
  }
  return found;
}
const missingFrom = (read, known) => [...read].filter(n => !known.has(n)).sort();

test('every option src/cli.js, contract-cli.js and gate-cli.js read is on the known list', () => {
  assert.deepEqual(missingFrom(optionsReadBy(OPTION_FILES), KNOWN), []);
});

test('the scan can fail: with one flag removed from the list it names exactly that flag', () => {
  const without = new Set([...KNOWN].filter(n => n !== 'max-usd'));
  assert.deepEqual(missingFrom(optionsReadBy(OPTION_FILES), without), ['max-usd']);
  // and a flag read in a way no pattern knows is caught by the same scan once it is spelled as a literal in code
  const fake = optionsReadBy(['x.js'], () => "if (argv.includes('--new-switch')) go();\nconst v = flag('new-value');\nconst w = flag(\"double-quoted\", null);\nconst u = flag(`back-ticked`);\nfor (const name of ['chain', 'looped-one', \"looped-two\"]) { if (flag(name, null) === true) stop(); }\n// --only-a-comment\n");
  assert.deepEqual(missingFrom(fake, KNOWN), ['back-ticked', 'double-quoted', 'looped-one', 'looped-two', 'new-switch', 'new-value']);
});

test('documented but never read: `council init [--yes]` is on the list (it is named only in a comment in src/cli.js)', () => {
  assert.ok(BOOLEAN_FLAGS.has('yes'));
});

test('every option the README and docs show on a council command line is on the known list', () => {
  const files = ['README.md', 'AI-README.md', 'TROUBLESHOOTING.md', 'CONTRIBUTING.md', ...readdirSync(join(root, 'docs')).filter(f => f.endsWith('.md')).map(f => `docs/${f}`)];
  const shown = new Set();
  for (const f of files) {
    let fenced = false;
    for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
      if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
      if (!fenced) continue;
      const cmd = line.replace(/\s+#.*$/, '');
      if (!/^\s*(\$ )?(npx [^ ]+ )?(council|node src\/cli\.js|npm run (dry|run) --)(\s|$)/.test(cmd)) continue;
      for (const m of cmd.matchAll(/(?<![A-Za-z0-9-])--([a-z][a-z0-9-]*)/g)) shown.add(m[1]);
    }
  }
  assert.ok(shown.size >= 10, 'found the options the docs show');
  assert.deepEqual(missingFrom(shown, KNOWN), []);
});

test('every option a spawner of the CLI passes (api.js, the MCP server, the send path) is on the known list', () => {
  assert.deepEqual(missingFrom(optionsReadBy(['src/api.js', 'src/mcp/server.js', 'src/mcp/advice.js', 'src/send-path.js']), KNOWN), []);
});
