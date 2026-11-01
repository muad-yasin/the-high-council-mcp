// Which commands may spend (0.8.4 DUALCAP unit 2, src/caps.js commandMaySpend): the per-provider caps switch is checked once at the start of src/cli.js, and a
// command that may spend is refused while the switch is unreadable or on but not yet armed. FAIL CLOSED: only what is listed as spending nothing runs.
// Every subcommand of src/cli.js (its SUBCOMMANDS, read from the source: cli.js exports nothing) and every verb of `council tree` is classified, so a new one
// cannot slip through as "spends nothing" by default. The new exports are read through a namespace import, so on the code before the change each test fails
// on an assertion, not on a missing export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as caps from '../src/caps.js';
import { DEFAULT_HANDLERS } from '../src/tree-cli.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliSource = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
// The MCP server's flag, as DATA: a string handed to the pure classifier below. This file spawns no process at all (test/no-paid-chain-spawn.test.js reads the flag
// written as an argument-list element as a server start, which it is not here; no `zero-spend-ok` marker, since there is no process to mark).
const MCP_FLAG = '--mcp';
const subcommands = () => {
  const m = cliSource.match(/const SUBCOMMANDS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'src/cli.js still declares SUBCOMMANDS as one Set literal');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
};

test('K1: the classification exists: commandMaySpend and its lists', () => {
  assert.equal(typeof caps.commandMaySpend, 'function');
  assert.ok(Array.isArray(caps.NON_SPENDING_SUBCOMMANDS) && Object.isFrozen(caps.NON_SPENDING_SUBCOMMANDS));
  assert.ok(Array.isArray(caps.SPENDING_SUBCOMMANDS) && Object.isFrozen(caps.SPENDING_SUBCOMMANDS));
  assert.ok(caps.NON_SPENDING_VERBS && Object.isFrozen(caps.NON_SPENDING_VERBS));
});

test('K2: every subcommand of src/cli.js is classified exactly once (a new one forces a decision), and every verb of `council tree` is too', () => {
  const listed = [...caps.NON_SPENDING_SUBCOMMANDS, ...caps.SPENDING_SUBCOMMANDS, ...Object.keys(caps.NON_SPENDING_VERBS)];
  assert.equal(new Set(listed).size, listed.length, 'no subcommand is listed twice');
  assert.deepEqual([...listed].sort(), [...subcommands()].sort());
  const treeVerbs = Object.keys(DEFAULT_HANDLERS);
  assert.deepEqual(treeVerbs.filter(v => caps.NON_SPENDING_VERBS.tree.includes(v) === caps.commandMaySpend(['tree', v])), [], 'a tree verb is spending exactly when it is not listed');
  assert.deepEqual(treeVerbs.filter(v => caps.commandMaySpend(['tree', v])).sort(), ['resume', 'start'], 'only start and resume spend');
});

test('K3: the commands that may spend: every start, resume, rematch, replay, adopted advice call, post-run handoff or contract draft, digest, tree start and tree resume; a run marker wins over a report mode on the same line; only the exact `--dry-run` token is a dry run, and only where the command takes it', () => {
  for (const argv of [
    ['--task', 'tasks/x.md', '--chain', 'mock'],
    ['--task=tasks/x.md', '--chain', 'mock'],
    ['--dry', '--task', 'tasks/x.md', '--chain', 'mock'],
    ['--dry-run=yes', '--task', 'tasks/x.md', '--chain', 'mock'],
    ['tree', 'resume', 'x', '--dry-run'],
    ['--advice-adopt', 'runs/x', '--dry-run'],   // a run marker that takes no --dry-run (the adopt path admits only --max-usd, --chain, --allow-unfenced): never a dry run
    ['--resume', 'runs/x'],
    ['--rematch', 'runs/x'],
    ['--replay', 'runs/x'],
    ['--advice-adopt', 'runs/x', '--allow-unfenced'],
    ['--rematch', 'runs/x', '--spend'],
    ['--resume', 'runs/x', '--help'],
    ['--chain', 'mock'],
    ['handoff', '--from-run', 'runs/x'],
    ['digest', 'runs/x'],
    ['contract', 'draft', 'runs/x'],
    ['contract', 'something-new'],
    ['tree', 'start', '--task', 'tasks/x.md'],
    ['tree', 'resume', 'x'],
    ['tree', 'something-new', 'x'],
    ['an-unknown-word'],
  ]) assert.equal(caps.commandMaySpend(argv), true, argv.join(' '));
});

test('K4: the commands that spend nothing still run with the switch on: the usage print, version, reports, the MCP server (each run it starts checks the switch itself), doctor, gate answers, relays, rulings, tree reads and decisions, contract reads', () => {
  for (const argv of [
    [],
    ['--help'],
    ['-h'],
    ['--version'],
    ['-v'],
    ['--spend'],
    ['--cost-today'],
    ['--stats'],
    ['--metrics'],
    ['--forecast-cost', '--chain', 'mock'],
    [MCP_FLAG],
    ['doctor'],
    ['doctor', '--chain', 'chains/mock.json'],
    ['gate', 'answer', 'runs/x', 'g1'],
    ['relay-answer', 'runs/x', 'g1', '--total', '5'],
    ['ruling-add', 'runs/x', '--ruling', 'r'],
    ['ruling-withdraw', 'runs/x', 'g1'],
    ['stop', 'runs/x'],
    ['tree', 'status', 'x'],
    ['tree', 'check', 'x'],
    ['tree', 'stop', 'x'],
    ['tree', 'approve', 'x'],
    ['tree', 'decide', 'x', '--top-up', 'n', '--amount', '1'],
    ['contract', 'show', 'runs/x'],
    ['contract', 'lock', 'runs/x'],
    ['demo'],
    ['init'],
    ['replay', '--run', 'runs/x'],
  ]) assert.equal(caps.commandMaySpend(argv), false, argv.join(' ') || '(no arguments)');
});

test('K6: a DRY RUN spends nothing, so the switch never refuses it (C&C, 1 Nov 2026: B3\'s re-pin is a dry run with the switch set): the main dry run of a start or a resume, the dry runs of a rematch, a replay, handoff, digest, contract draft and tree start (an adopted advice call takes no --dry-run: K3)', () => {
  for (const argv of [
    ['--dry-run', '--task', 'tasks/x.md', '--chain', 'mock'],
    ['--task', 'tasks/x.md', '--chain', 'debate-084-b3', '--dry-run'],
    ['--resume', 'runs/x', '--dry-run'],
    ['--rematch', 'runs/x', '--dry-run'],
    ['--replay', 'runs/x', '--dry-run'],
    ['handoff', '--from-run', 'runs/x', '--dry-run'],
    ['digest', 'runs/x', '--provider', 'openrouter', '--dry-run'],
    ['contract', 'draft', 'runs/x', '--dry-run'],
    ['tree', 'start', '--task', 'tasks/x.md', '--chain', 'mock', '--dry-run'],
  ]) assert.equal(caps.commandMaySpend(argv), false, argv.join(' '));
});

test('K5: the refusal while the switch is on but not yet armed names the setting and the caps, says nothing was started, and says how to run with one limit (A-DRAFT, removed by the arming unit)', () => {
  assert.equal(typeof caps.capsNotArmedSentence, 'function');
  const s = caps.capsNotArmedSentence(['anthropic', 'openrouter']);
  assert.match(s, /COUNCIL_SPEND_CAPS/);
  assert.match(s, /anthropic, openrouter/);
  assert.match(s, /Nothing was started\./);
  assert.match(s, /leave COUNCIL_SPEND_CAPS empty/i);
});
