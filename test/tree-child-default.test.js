// 0.8.4 H-CC-a commit 1 (Muad's pick of 05 Nov 2026: "the tree's child runs use the parent's chain by default"): `council tree start --child-chain` is OPTIONAL. Without it the sub-plans run on the root chain: tree.json records the root's name and
// sha256 at depth 1 and 2, the dry run projects the same figures as naming the root chain as the child, and the start line and the dry run say that the option was not given (WORDING CH-1..CH-4). With the option given nothing is different.
// All chains are mock ($0). The new export (NO_CHILD_CHAIN_WORDS) is read through a NAMESPACE import so the file loads on a tree without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import * as TP from '../src/tree-projection.js';
import { DEFAULT_HANDLERS, treeCommand } from '../src/tree-cli.js';
import { readTreeRecord } from '../src/tree-record.js';
import { installSplitRoot } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const io = () => { const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough(); let o = ''; let e = ''; stdout.on('data', d => { o += d; }); stderr.on('data', d => { e += d; }); return { stdin, stdout, stderr, out: () => o, err: () => e }; };
function work() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-cd-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  installSplitRoot(dir);
  writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  return dir;
}
const draftStarter = () => opts => api.run({ ...opts, draft: 'plan.md', rounds: 1 });
const start = async (dir, args, deps = { startRun: draftStarter() }) => { const d = io(); const code = await treeCommand(['start', ...args], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps }) } }); return { code, out: d.out(), err: d.err() }; };
const BASE = ['--task', 'tasks/x.md', '--chain', 'split-root', '--max-usd', '5'];
const MARKER = '--child-chain was not given, so the sub-plans run on the root chain.';

test('CD-1 no --child-chain: the tree starts, tree.json records the ROOT chain\'s name and sha256 at depth 0, 1 and 2, and the start line says the option was not given; the root chain carries a criteria seat, and a chain with a criteria seat is accepted as the child at start', async () => {
  const dir = work();
  assert.ok(JSON.parse(readFileSync(join(dir, 'chains', 'split-root.json'), 'utf8')).seats.criteria, 'the premise: the root chain carries a criteria seat');
  assert.equal(TP.NO_CHILD_CHAIN_WORDS, MARKER, 'the one phrase exists');
  const r = await start(dir, BASE);
  assert.equal(r.code, 0, r.err + r.out);
  const id = /Tree (\S+) started/.exec(r.out)?.[1]; assert.ok(id, r.out);
  assert.ok(r.out.includes(`Tree ${id} started: cap $5.00 for the whole tree, root plan on split-root, sub-plans on split-root. ${MARKER}`), r.out);
  const rec = readTreeRecord(join(dir, 'runs', id));
  assert.deepEqual(rec.tree.chains.map(c => [c.depth, c.name]), [[0, 'split-root'], [1, 'split-root'], [2, 'split-root']]);
  assert.equal(new Set(rec.tree.chains.map(c => c.sha256)).size, 1, 'the same file, the same sha256, at every depth');
});

test('CD-2 --child-chain given: the start line is byte for byte what it was (no marker), and the record names the child chain', async () => {
  const dir = work();
  const r = await start(dir, [...BASE, '--child-chain', 'priced-debate']);
  assert.equal(r.code, 0, r.err + r.out);
  const id = /Tree (\S+) started/.exec(r.out)?.[1];
  assert.ok(r.out.includes(`Tree ${id} started: cap $5.00 for the whole tree, root plan on split-root, sub-plans on priced-debate.`), r.out);
  assert.doesNotMatch(r.out, /was not given/);
  assert.deepEqual(readTreeRecord(join(dir, 'runs', id)).tree.chains.map(c => [c.depth, c.name]), [[0, 'split-root'], [1, 'priced-debate'], [2, 'priced-debate']]);
});

test('CD-3 --dry-run: the projection with the default is the projection with the root chain NAMED as the child, plus the one marker line; naming the option adds none; nothing is written either way', async () => {
  const dir = work();
  const before = JSON.stringify(readdirSync(dir, { recursive: true }).sort());
  const dflt = await start(dir, [...BASE, '--dry-run'], {}); assert.equal(dflt.code, 0, dflt.err + dflt.out);
  const named = await start(dir, [...BASE, '--dry-run', '--child-chain', 'split-root'], {}); assert.equal(named.code, 0, named.err + named.out);
  assert.ok(dflt.out.split('\n').includes(`  ${MARKER}`), dflt.out);
  assert.doesNotMatch(named.out, /was not given/);
  assert.equal(dflt.out.split('\n').filter(l => l !== `  ${MARKER}`).join('\n'), named.out, 'the same figures, line for line');
  assert.equal(JSON.stringify(readdirSync(dir, { recursive: true }).sort()), before, 'a dry run writes nothing');
});

test('CD-4 a missing --chain is still refused first (exit 2, the root chain is named), an unknown root chain is said ONCE and never as a child chain, and nothing is written', async () => {
  const dir = work(); const before = JSON.stringify(readdirSync(dir, { recursive: true }).sort());
  const a = await start(dir, ['--task', 'tasks/x.md', '--max-usd', '5'], {}); assert.equal(a.code, 2);
  assert.match(a.err, /needs --chain <name>: the chain the root plan runs on/); assert.doesNotMatch(a.err, /child-chain/);
  const b = await start(dir, ['--task', 'tasks/x.md', '--chain', 'no-such-chain', '--max-usd', '5'], {}); assert.equal(b.code, 1);
  assert.equal(b.err.match(/the chain no-such-chain is not in/g)?.length, 1, b.err); assert.match(b.err, /--chain: the chain no-such-chain is not in/); assert.doesNotMatch(b.err, /--child-chain:/);
  assert.equal(JSON.stringify(readdirSync(dir, { recursive: true }).sort()), before);
  assert.equal(existsSync(join(dir, 'runs')), false, 'no runs/ folder was made');
});

test('CD-5 the usage block shows the option as optional, and says what the default is', async () => {
  const d = io(); const code = await treeCommand(['start', 'x', 'y'], { work: work(), ...d });
  assert.equal(code, 2);
  assert.ok(d.err().includes('--chain <root chain> [--child-chain <name>] --max-usd <usd>'), d.err());
  assert.ok(d.err().includes('(without --child-chain the sub-plans run on the root chain)'), d.err());
});
