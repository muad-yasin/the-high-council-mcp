// The per-provider caps switch at the start (0.8.4 DUALCAP unit 2; C&C's rulings of 1 Nov 2026: the switch is read at the start FIRST, and a set switch
// refuses the start until the caps are armed; the switch is the operator's, never a project .env's). Offline, $0: the CLI is spawned from a temp folder with
// a minimal environment (no key, no .env of the repo), on the shipped `mock` chain. Every command that may spend is refused BEFORE anything is written; a
// command that spends nothing still runs. The per-cap ceiling settings are spend settings in a project .env (repeated or malformed lines stop the start).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { applyEnvFile, envFileRefuses, MONEY_NAMES } from '../src/env-file.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const NOT_ARMED = /cannot yet hold a run to one spending cap per provider/;

function project() {
  const work = mkdtempSync(join(tmpdir(), 'thc-caps-switch-'));
  mkdirSync(join(work, 'tasks'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const run = (args, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: work, env: { PATH: process.env.PATH, HOME: work, ...extraEnv }, encoding: 'utf8', timeout: 60_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { work, run };
}

// [argv, what it prints with the switch on]: a command of a refused class (unit 3a: a tree, a paid side command) gets its OWN sentence,
// a known limit of this version. A main-path start no longer meets a refusal here: unit 4b2 arms it (test/caps-arming.test.js), and a chain with no cap in force
// keeps today's path (W6). A resume is pinned in test/caps-start-refusals.test.js C5 (unit 3b): it runs the main path's checks first, so it needs a real run folder.
const CLASS = /a known limit of this version/;
const SPENDING = [
  [['tree', 'resume', '2026-11-01T00-00-00-000Z', '--dry-run'], CLASS],   // `tree resume` takes no --dry-run: the token does not make it a dry run
  [['--rematch', 'runs/2026-11-01T00-00-00-000Z'], CLASS],
  [['--replay', 'runs/2026-11-01T00-00-00-000Z'], CLASS],
  // CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: a row for ['--advice-adopt', 'runs/<id>', '--allow-unfenced'] (the advice add-on's class). NEW: no row. WHY: the advice class left src/caps.js and --advice-adopt is an unknown option now (refused before the caps are read: test/caps-class-refusals.test.js C1 pins that with the switch on).
  [['handoff', '--from-run', 'runs/2026-11-01T00-00-00-000Z'], CLASS],
  [['digest', 'runs/2026-11-01T00-00-00-000Z'], CLASS],
  [['contract', 'draft', 'runs/2026-11-01T00-00-00-000Z'], CLASS],
  [['tree', 'start', '--task', 'tasks/x.md', '--chain', 'mock', '--max-usd', '1'], CLASS],
  [['tree', 'resume', '2026-11-01T00-00-00-000Z'], CLASS],
];

test('W1 SWITCH ON: every command of a refused class is refused before anything is written (exit 2, its own sentence names the setting and the caps, no runs/ folder); the commands that spend nothing still run', () => {
  const { work, run } = project();
  const ON = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
  for (const [args, sentence] of SPENDING) {
    const r = run(args, ON);
    assert.equal(r.code, 2, `${args.join(' ')}\n${r.out}`);
    assert.match(r.out, sentence, args.join(' '));
    assert.doesNotMatch(r.out, NOT_ARMED, `${args.join(' ')}: its own sentence comes before (instead of) the not-armed one`);
    assert.match(r.out, /COUNCIL_SPEND_CAPS is set \(anthropic, openrouter\)/, args.join(' '));
    assert.equal(existsSync(join(work, 'runs')), false, `${args.join(' ')} wrote a runs/ folder`);
  }
  const version = run(['--version'], ON);
  assert.equal(version.code, 0, version.out);
  assert.doesNotMatch(version.out, NOT_ARMED);
  const doctor = run(['doctor', '--chain', join(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json')], ON);
  assert.equal(doctor.code, 0, doctor.out);
  assert.doesNotMatch(doctor.out, NOT_ARMED);
  const treeStatus = run(['tree', 'status', 'no-such-tree'], ON);
  assert.doesNotMatch(treeStatus.out, NOT_ARMED, 'a tree read is not refused by the switch (it fails on its own: no such tree)');
});

test('W2 SWITCH UNREADABLE: a figure in COUNCIL_SPEND_CAPS refuses a command that may spend with the parser\'s sentence (never read as off), before anything is written, and a command that spends nothing still runs; a WHOLE host placeholder (a Desktop field left empty) is dropped as unset by the rule src/mcp/server.js applies to every setting but COUNCIL_MAX_USD_LIMIT, so it reads as OFF', () => {
  const { work, run } = project();
  const figure = run(['--task', 'tasks/x.md', '--chain', 'mock', '--max-usd', '1'], { COUNCIL_SPEND_CAPS: 'openrouter=5' });
  assert.equal(figure.code, 2, figure.out);
  assert.match(figure.out, /COUNCIL_SPEND_CAPS names which providers get their own spending cap, never an amount/);
  assert.match(figure.out, /Nothing was started\./);
  assert.equal(existsSync(join(work, 'runs')), false);
  const version = run(['--version'], { COUNCIL_SPEND_CAPS: 'openrouter=5' });
  assert.equal(version.code, 0, version.out);
  // OFF is not a way round the switch: OFF is today's one typed limit with its ceiling (a real `--task` start goes to the typed-limit screen exactly as before). The dry run here spends nothing and goes on.
  const placeholder = run(['--dry-run', '--task', 'tasks/x.md', '--chain', 'mock'], { COUNCIL_SPEND_CAPS: '${user_config.spend_caps}' });
  assert.equal(placeholder.code, 0, placeholder.out);
  assert.doesNotMatch(placeholder.out, /COUNCIL_SPEND_CAPS/);
});

test('W3 OPERATOR-ONLY: a project .env cannot turn the switch on (the notice names it and it is ignored), so the run goes on with one typed limit, as with the switch off', () => {
  const { work, run } = project();
  writeFileSync(join(work, '.env'), 'COUNCIL_SPEND_CAPS=openrouter,anthropic\n');
  const r = run(['--dry-run', '--task', 'tasks/x.md', '--chain', 'mock']);
  assert.match(r.out, /\.env: COUNCIL_SPEND_CAPS is not read from a project \.env file/);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.equal(envFileRefuses('COUNCIL_SPEND_CAPS'), true);
});

test('W6 SWITCH ON, a chain with no cap in force (the plain mock chain: no seat bills through a capped account) keeps today\'s path: a start with --max-usd runs under that run cap, exit 0; run.json carries maxUsd and no caps; the not-armed line is gone for a start', () => {
  const { work, run } = project();
  const ON = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
  for (const [i, task] of [['--task', 'tasks/x.md'], ['--task=tasks/x.md']].entries()) {
    const id = `2026-11-01T00-00-0${i}-000Z`;
    const r = run([...task, '--chain', 'mock', '--max-usd', '1', '--run-id', id], ON);
    assert.equal(r.code, 0, `${task.join(' ')}\n${r.out}`);
    assert.doesNotMatch(r.out, NOT_ARMED, task.join(' '));
    const meta = JSON.parse(readFileSync(join(work, 'runs', id, 'run.json'), 'utf8'));
    assert.equal(meta.maxUsd, 1, task.join(' '));
    assert.equal(Object.hasOwn(meta, 'caps'), false, task.join(' '));
  }
});

test('W5 SWITCH ON: a dry run is not refused (it prices and calls nothing; C&C, 1 Nov 2026: B3\'s re-pin is a dry run with the switch set): it prints its figures, exits 0 and writes no run folder', () => {
  const { work, run } = project();
  const r = run(['--task', 'tasks/x.md', '--chain', 'mock', '--dry-run'], { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.match(r.out, /TOTAL\s+\d+ in\s+\d+ out/);
  assert.equal(existsSync(join(work, 'runs')), false);
});

test('W4: each per-cap ceiling is a spend setting: a repeated or malformed line in a project .env is reported (the caller stops the start), a suffix that names no provider is not caught, and a ceiling may still FILL from a .env', () => {
  for (const n of ['COUNCIL_MAX_USD_LIMIT_OPENROUTER', 'COUNCIL_MAX_USD_LIMIT_ANTHROPIC']) {
    assert.ok(MONEY_NAMES.includes(n), n);
    assert.equal(envFileRefuses(n), false, `${n} may fill from a project .env, as COUNCIL_MAX_USD_LIMIT may`);
  }
  const repeated = [];
  applyEnvFile('COUNCIL_MAX_USD_LIMIT_OPENROUTER=5\nCOUNCIL_MAX_USD_LIMIT_OPENROUTER=50\n', {}, { onRepeatedMoney: n => repeated.push(n) });
  assert.deepEqual(repeated, ['COUNCIL_MAX_USD_LIMIT_OPENROUTER']);
  const malformed = [];
  applyEnvFile('COUNCIL_MAX_USD_LIMIT_ANTHROPIC: 40\nCOUNCIL_MAX_USD_LIMIT_NOTES: 5\n', {}, { onMalformedMoney: n => malformed.push(n) });
  assert.deepEqual(malformed, ['COUNCIL_MAX_USD_LIMIT_ANTHROPIC'], 'the long name is matched whole; a suffix that names no provider stays free');
});
