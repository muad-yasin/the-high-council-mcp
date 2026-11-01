// The specific refusals of whole command classes with the per-provider caps switch ON (0.8.4 DUALCAP unit 3a; C&C's rulings of 1 Nov 2026): a recursive-council
// tree (tree start, tree resume, a member's start), the paid side commands (post-run handoff, contract draft, digest, --rematch, --replay) and the advice add-on
// (--advice-adopt) cannot run with a cap per provider. Each prints ITS OWN sentence, before the not-armed refusal (Q1a), and nothing is written; a tree member exits 19
// (the code the tree sitting reads as "the tree refused"), every other class 2. A DRY RUN of such a command is not refused: it says a real run would be (Q1b), goes on
// and calls nothing. Offline, $0: the CLI from a temp folder, a minimal environment, the shipped mock chain. The new exports are read through a namespace import, so on
// the code before the change each pure test fails by assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as caps from '../src/caps.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ON = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
const NOT_ARMED = /cannot yet hold a run to one spending cap per provider/;
const NOTE = /a real run of this command would be refused/;
const RUN = '2026-11-01T00-00-00-000Z';

function project() {
  const work = mkdtempSync(join(tmpdir(), 'thc-caps-class-'));
  mkdirSync(join(work, 'tasks'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const run = (args, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: work, env: { PATH: process.env.PATH, HOME: work, ...extraEnv }, encoding: 'utf8', timeout: 120_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { work, run };
}

test('P1: the refused classes: tree start, tree resume and a member start are a tree; post-run handoff, contract draft, digest, --rematch and --replay are side commands, each named; --advice-adopt is the advice add-on; everything else is none of them', () => {
  assert.equal(typeof caps.capsRefusedClassOf, 'function');
  const of = argv => { const c = caps.capsRefusedClassOf(argv); return c && [c.kind, c.command, c.exit]; };
  assert.deepEqual(of(['tree', 'start', '--task', 't', '--chain', 'c']), ['tree', 'council tree start', 2]);
  assert.deepEqual(of(['tree', 'resume', 'x']), ['tree', 'council tree resume', 2]);
  assert.deepEqual(of(['--tree-node', 'n.json', '--task', 't', '--chain', 'c']), ['tree', 'a tree member', 19], 'a member exits 19: the tree sitting reads that as "the tree refused"');
  assert.deepEqual(of(['handoff', '--from-run', 'runs/x']), ['side', 'council handoff', 2]);
  assert.deepEqual(of(['contract', 'draft', 'runs/x']), ['side', 'council contract draft', 2]);
  assert.deepEqual(of(['digest', 'runs/x', '--provider', 'openrouter']), ['side', 'council digest', 2]);
  assert.deepEqual(of(['--rematch', 'runs/x']), ['side', 'council --rematch', 2]);
  assert.deepEqual(of(['--replay', 'runs/x']), ['side', 'council --replay', 2]);
  assert.deepEqual(of(['--advice-adopt', 'runs/x', '--allow-unfenced']), ['advice', 'the advice add-on', 2]);
  for (const argv of [['--task', 't', '--chain', 'c'], ['--resume', 'runs/x'], ['tree', 'status', 'x'], ['tree', 'decide', 'x'], ['contract', 'show', 'runs/x'], ['doctor'], [], ['--spend']]) assert.equal(caps.capsRefusedClassOf(argv), null, argv.join(' ') || '(none)');
});

test('P2: the class sentence names the setting, the caps and the command, says it is a known limit and how to run with one limit, and that nothing was started (sent, for advice); the dry-run note says a real run would be refused and that the dry run goes on (A-DRAFT)', () => {
  const caps2 = ['anthropic', 'openrouter'];
  const tree = caps.capsClassRefusalSentence(caps.capsRefusedClassOf(['tree', 'start']), caps2);
  assert.match(tree, /^COUNCIL_SPEND_CAPS is set \(anthropic, openrouter\)/);
  assert.match(tree, /recursive-council tree/);
  assert.match(tree, /a known limit of this version/);
  assert.match(tree, /Leave COUNCIL_SPEND_CAPS empty/);
  assert.match(tree, /Nothing was started\.$/);
  const side = caps.capsClassRefusalSentence(caps.capsRefusedClassOf(['--rematch', 'runs/x']), caps2);
  assert.match(side, /council --rematch/);
  assert.match(side, /Nothing was started\.$/);
  const advice = caps.capsClassRefusalSentence(caps.capsRefusedClassOf(['--advice-adopt', 'runs/x']), caps2);
  assert.match(advice, /the advice add-on/);
  assert.match(advice, /Nothing was sent\.$/);
  const note = caps.capsDryRunNote(caps.capsRefusedClassOf(['tree', 'start']), caps2);
  assert.match(note, /^With COUNCIL_SPEND_CAPS set \(anthropic, openrouter\), a real run of this command would be refused: /);
  assert.match(note, /This dry run goes on and calls nothing\.$/);
  assert.doesNotMatch(note, NOT_ARMED);
});

test('C1 SWITCH ON: a real run of each refused class prints its own sentence, not the not-armed one, exits 2 (19 for a tree member) and writes nothing', () => {
  const { work, run } = project();
  for (const [args, exit, what] of [
    [['tree', 'start', '--task', 'tasks/x.md', '--chain', 'mock', '--max-usd', '1'], 2, /council tree start|recursive-council tree/],
    [['tree', 'resume', RUN], 2, /recursive-council tree/],
    [['--tree-node', 'node.json', '--task', 'tasks/x.md', '--chain', 'mock', '--max-usd', '1'], 19, /recursive-council tree/],
    [['handoff', '--from-run', `runs/${RUN}`], 2, /council handoff/],
    [['contract', 'draft', `runs/${RUN}`], 2, /council contract draft/],
    [['digest', `runs/${RUN}`, '--provider', 'openrouter'], 2, /council digest/],
    [['--rematch', `runs/${RUN}`], 2, /council --rematch/],
    [['--replay', `runs/${RUN}`], 2, /council --replay/],
    [['--advice-adopt', `runs/${RUN}`, '--allow-unfenced'], 2, /the advice add-on/],
  ]) {
    const r = run(args, ON);
    assert.equal(r.code, exit, `${args.join(' ')}\n${r.out}`);
    assert.match(r.out, what, args.join(' '));
    assert.match(r.out, /a known limit of this version/, args.join(' '));
    assert.doesNotMatch(r.out, NOT_ARMED, `${args.join(' ')}: its own sentence, before (instead of) the not-armed one`);
    assert.equal(existsSync(join(work, 'runs')), false, `${args.join(' ')} wrote a runs/ folder`);
  }
  const tl = run(['tree', 'resume', RUN, '--dry-run'], ON);
  assert.equal(tl.code, 2, tl.out);
  assert.match(tl.out, /recursive-council tree/, 'tree resume takes no --dry-run, so the token does not make it a dry run: it is refused');
  // fix-up 2 (C&C, 1 Nov 2026): --advice-adopt takes no --dry-run either (the adopt path admits only --max-usd, --chain, --allow-unfenced), so beside it the token is no dry run:
  // the advice sentence, never the dry-run note
  const ad = run(['--advice-adopt', `runs/${RUN}`, '--dry-run'], ON);
  assert.equal(ad.code, 2, ad.out);
  assert.match(ad.out, /Leave COUNCIL_SPEND_CAPS empty to ask for advice with one approved price\. Nothing was sent\./);
  assert.doesNotMatch(ad.out, NOTE, 'not the dry-run note');
});

test('C2 SWITCH ON: a DRY RUN of a refused class is not refused: it prints the note and goes on; rematch and replay of a finished mock run price it and exit 0', () => {
  const { work, run } = project();
  const made = run(['--task', 'tasks/x.md', '--chain', 'mock', '--max-usd', '1', '--run-id', RUN]);   // switch OFF: a finished mock run to rematch and replay
  assert.ok(existsSync(join(work, 'runs', RUN, 'report.json')), `the mock run finished: ${made.out}`);
  for (const verb of ['--rematch', '--replay']) {
    const r = run([verb, `runs/${RUN}`, '--dry-run'], ON);
    assert.match(r.out, NOTE, `${verb}: ${r.out}`);
    assert.match(r.out, /This dry run goes on and calls nothing\./);
    assert.doesNotMatch(r.out, NOT_ARMED);
    assert.doesNotMatch(r.out, /Leave COUNCIL_SPEND_CAPS empty/, `${verb}: the note, not the refusal sentence`);
    assert.equal(r.code, 0, `${verb} --dry-run prices the finished run and exits 0: ${r.out}`);
  }
  const before = readdirSync(join(work, 'runs')).sort();
  for (const args of [['tree', 'start', '--task', 'tasks/x.md', '--chain', 'mock', '--max-usd', '1', '--dry-run'], ['handoff', '--from-run', `runs/${RUN}`, '--dry-run']]) {
    const r = run(args, ON);
    assert.match(r.out, NOTE, `${args.join(' ')}: ${r.out}`);
    assert.doesNotMatch(r.out, NOT_ARMED, args.join(' '));
  }
  assert.deepEqual(readdirSync(join(work, 'runs')).sort(), before, 'no dry run wrote a run folder');
});
