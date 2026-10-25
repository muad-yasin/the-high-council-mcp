// D1 (T1-14 fix-up, 14 Oct 2026, A8 D1): a post-run paid call (`digest --provider`, `handoff --from-run`, `contract draft --from-run`) goes through invoke(), which settles its reservation as `recorded` when the reply is back; the usage record is written
// AFTER that by recordCall. If that write fails the call WAS paid and sat in NO total (a settled line adds nothing, no usage file exists). Now a failed write puts a FRESH unsettled reservation at the call's worst case on the run folder, so
// every total counts the call exactly once, says so on stderr and in WARNINGS.md, WRITES THE REPLY that was paid for anyway (C&C Q1, 14 Oct 2026: paid output is never lost) and exits 16 AFTER it (RF-1, RF-4); a seat priced at $0 has no worst case to
// charge and gets its own sentence (C&C Q2, RF-5, RF-6). A tree MEMBER's folder, where the line goes through the mirror into the tree's record, is test/record-call-failure-member.test.js (RF-7).
// The failure is made without a mock seam: `superseded` is a FILE, so recordCall's mkdirSync throws EEXIST after the call returned. Offline: the priced mock seat `mock-priced` ($36 worst case at the 36,000-token digest seat cap) and the $0 seat
// `mock-contract-draft`; every spawn in a fresh temp directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpentUsd } from '../src/spend.js';
import { unsettledReservations } from '../src/spend-reservations.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ENV = { PATH: process.env.PATH };
const sh = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: ENV, timeout: 90_000 });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, `${msg}: ${a} vs ${b}`);
const figure = out => Number(/up to \$([0-9.]+)\./.exec(out)[1]);
const WRITTEN = who => new RegExp(`^${who}: the reply above was written\\. This command exits 16 only because the cost of the call could not be recorded\\.$`, 'm');

function digestFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-recfail-'));
  mkdirSync(join(dir, 'run1'));
  writeFileSync(join(dir, 'run1', 'report.json'), JSON.stringify({ outcome: 'no_consensus', disagreement_groups: [{ on: 'p1', title: 'whether to build item 4', posts: [{ by: 'deepseek', stance: 'object', text: 'adds a script' }] }] }));
  return { dir, run: join(dir, 'run1') };
}
const DIGEST = ['digest', '--run', 'run1', '--provider', 'mock', '--model', 'mock-priced'];
const withDigest = fn => { const d = digestFolder(); try { return fn(d); } finally { rmSync(d.dir, { recursive: true, force: true }); } };
function original(handoffModel = null) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-recfail-h-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'A mock task.');
  let chain = 'mock-budget';
  if (handoffModel) {
    chain = 'mock-debate';   // a user chain whose handoff seat is a $0 mock model that writes a contract draft
    mkdirSync(join(dir, 'chains'));
    const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
    writeFileSync(join(dir, 'chains', 'zero.json'), JSON.stringify({ ...cfg, name: 'zero', seats: { ...cfg.seats, handoff: { provider: 'mock', model: handoffModel } } }));
  }
  assert.equal(sh(dir, ['--chain', chain, '--task', 'tasks/x.md', '--max-usd', 'none']).status, 0);
  return { dir, run: join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]) };
}
const withOriginal = (fn, model) => { const o = original(model); try { return fn(o); } finally { rmSync(o.dir, { recursive: true, force: true }); } };

test('RF-1 digest: the usage record cannot be written -> the call is charged at its worst case ONCE, said on stderr and in WARNINGS.md, the paid digest is still written, exit 16', () => withDigest(({ dir, run }) => {
  const price = figure(sh(dir, [...DIGEST, '--dry-run']).stdout);            // the worst case invoke() projects for this call (a dry run writes nothing)
  writeFileSync(join(run, 'superseded'), 'in the way');                       // recordCall's mkdirSync(superseded) now throws EEXIST
  const r = sh(dir, [...DIGEST, '--max-usd', 'none']);
  assert.equal(r.status, 16, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(`^digest: the call was made, but its cost could not be recorded \\(EEXIST\\)\\. This run's total now counts it at its worst case, \\$${price.toFixed(2)}, because the real figure is not on disk; the provider's own bill has the real one\\.\\n`));
  assert.match(r.stderr, WRITTEN('digest'));
  assert.match(readFileSync(join(run, 'WARNINGS.md'), 'utf8'), /^- digest: the call was made, but its cost could not be recorded \(EEXIST\)\./m);
  const un = unsettledReservations(run);
  assert.equal(un.length, 1, 'one unsettled line');
  near(un[0].usd, price, 'at the worst case of the call');
  near(runSpentUsd(run), price, 'every total counts the call once: the settled line adds nothing, the fresh line adds the worst case');
  assert.ok(existsSync(join(run, 'digest.md')), 'the digest that was paid for is written');
  assert.match(r.stdout, /^Wrote .*digest\.md$/m);
  const lines = readFileSync(join(run, 'spend-reservations.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => l.event), ['reserved', 'settled', 'reserved'], 'invoke() reserved and settled once; the fresh unsettled line is the third');
}));

test('RF-2 digest, the consequence: a second digest is held to a total that includes the unrecorded one, so a cap below it refuses', () => withDigest(({ dir, run }) => {
  const price = figure(sh(dir, [...DIGEST, '--dry-run']).stdout);
  writeFileSync(join(run, 'superseded'), 'in the way');
  assert.equal(sh(dir, [...DIGEST, '--max-usd', 'none']).status, 16);
  const again = sh(dir, [...DIGEST, '--max-usd', String(Math.ceil(price + 1))]);
  assert.equal(again.status, 4, again.stdout + again.stderr);
  assert.match(again.stderr, new RegExp(`this run's total so far is \\$${price.toFixed(2)}`));
}));

test('RF-3 digest control (green before this change): a call that records normally leaves no unsettled line, exits 0, and the total is what it cost', () => withDigest(({ dir, run }) => {
  const r = sh(dir, [...DIGEST, '--max-usd', 'none']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(unsettledReservations(run).length, 0);
  assert.ok(existsSync(join(run, 'digest.md')));
  assert.doesNotMatch(r.stderr, /the reply above was written/);
  assert.ok(runSpentUsd(run) < 1, 'the real cost of a mock digest, not its worst case');
}));

test('RF-4 handoff --from-run: the same, on the run\'s own folder: the earlier spend stays, the unrecorded call is added once at its worst case, the handoff that was paid for is written, exit 16', () => withOriginal(o => {
  const price = figure(sh(o.dir, ['handoff', '--from-run', o.run, '--dry-run']).stdout);
  const earlier = runSpentUsd(o.run);
  const filesBefore = readdirSync(o.run).sort();
  writeFileSync(join(o.run, 'superseded'), 'in the way');
  const r = sh(o.dir, ['handoff', '--from-run', o.run]);
  assert.equal(r.status, 16, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(`^handoff: the call was made, but its cost could not be recorded \\(EEXIST\\)\\. This run's total now counts it at its worst case, \\$${price.toFixed(2)}, because the real figure is not on disk; the provider's own bill has the real one\\.\\n`));
  assert.match(r.stderr, WRITTEN('handoff'));
  assert.match(readFileSync(join(o.run, 'WARNINGS.md'), 'utf8'), /- handoff: the call was made, but its cost could not be recorded/);
  near(runSpentUsd(o.run), earlier + price, 'earlier spend + one worst case');
  const written = readdirSync(o.run).filter(f => /^HANDOFF.*\.md$/.test(f) && !filesBefore.includes(f));
  assert.equal(written.length, 1, `the handoff that was paid for is written: ${written}`);
  assert.match(r.stdout, /handoff: wrote .*HANDOFF/);
}));

test('RF-5 contract draft with a $0 seat (Q2): the record fails -> its own sentence ("priced at $0.00"), NO unsettled line, the draft that was paid for is written, exit 16', () => withOriginal(o => {
  const before = runSpentUsd(o.run);
  writeFileSync(join(o.run, 'superseded'), 'in the way');
  const r = sh(o.dir, ['contract', 'draft', '--from-run', o.run, '--chain', 'zero']);
  assert.equal(r.status, 16, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(`^contract draft: the call was made, but its cost could not be recorded \\(EEXIST\\)\\. Its seat is priced at \\$0\\.00, so this run's total is unchanged\\.\\n`));
  assert.doesNotMatch(r.stderr, /worst case/);
  assert.match(r.stderr, WRITTEN('contract draft'));
  assert.equal(unsettledReservations(o.run).length, 0, 'a $0 line adds nothing, so none is written');
  near(runSpentUsd(o.run), before, 'the total is unchanged');
  assert.ok(existsSync(join(o.run, 'contract', 'draft.json')), 'the contract draft that was paid for is written');
  assert.match(readFileSync(join(o.run, 'WARNINGS.md'), 'utf8'), /- contract draft: the call was made, but its cost could not be recorded/);
}, 'mock-contract-draft'));

test('RF-6 control (green before this change): a $0 contract draft that records normally exits 0 and prints neither sentence', () => withOriginal(o => {
  const r = sh(o.dir, ['contract', 'draft', '--from-run', o.run, '--chain', 'zero']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /could not be recorded|the reply above was written/);
  assert.ok(existsSync(join(o.run, 'contract', 'draft.json')));
}, 'mock-contract-draft'));
