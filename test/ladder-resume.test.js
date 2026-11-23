// The permanent ladder at a RESUME (0.8.4, the ladder unit): (1) a run saved without a ladder, resumed on a chain whose file carries the ladder key, runs the ladder from the key and saves it, unless a pass it already made would be replayed
// under it (then it is refused, with the way on); (2) no typed --rounds is dropped silently at a resume: off the ladder the run says which number it keeps and why. Offline, $0: scripted mock judges and an external writer through the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const writer = { provider: 'external', model: 'claude-code-session' };
const seats = id => ({ criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [
  { provider: 'mock', model: `mock-critic-script-x-${id}1`, lab: 'l1', layer: 1 }, { provider: 'mock', model: `mock-critic-script-x-${id}2`, lab: 'l2', layer: 2 }, { provider: 'mock', model: `mock-critic-script-x-${id}3`, lab: 'l3', layer: 3 }] });
const base = { name: 'lad', signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 } };
const project = chain => {
  const dir = mkdtempSync(join(tmpdir(), 'lad-res-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const setChain = c => writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(c));
  setChain(chain);
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const saved = () => JSON.parse(readFileSync(join(runDir(), 'run.json'), 'utf8'));
  return { run, runDir, saved, setChain, answer: (n, t) => writeFileSync(join(runDir(), `${n}.md`), t), done: () => rmSync(dir, { recursive: true, force: true }) };
};
const OLD_KEYS = { maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 } };
const ADOPT = /This chain runs the ladder from its key \(layer-1 blocks of 3, 3 layer-2 visits\), and this run was saved without one/;

test('R-1 (the third case): a run started on a chain with the OLD keys and resumed after the chain file was changed to carry the ladder key runs the ladder from the key, says so once, and saves it to run.json; a second resume reads the saved ladder and says nothing; the same run with the chain file unchanged saves none (the swapped input)', () => {
  const moved = project({ ...base, ...OLD_KEYS, seats: seats('p') });
  const still = project({ ...base, ...OLD_KEYS, seats: seats('q') });
  try {
    for (const p of [moved, still]) { assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3); assert.equal(p.saved().ladder, undefined, 'a run started on the old keys saves no ladder'); p.answer('build', '# Plan v1\n\nAssumptions: tea.\n'); }
    moved.setChain({ ...base, ladder: { block: 3, visits: 3 }, seats: seats('p') });
    const r = moved.run(['--resume', moved.runDir()]);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, ADOPT);
    assert.deepEqual(moved.saved().ladder, { block: 3, visits: 3, credit: 0, exchange: 0 });
    const again = moved.run(['--resume', moved.runDir()]);
    assert.doesNotMatch(again.stdout, ADOPT, 'said once');
    assert.deepEqual(moved.saved().ladder, { block: 3, visits: 3, credit: 0, exchange: 0 });
    const plain = still.run(['--resume', still.runDir()]);
    assert.doesNotMatch(plain.stdout, ADOPT);
    assert.equal(still.saved().ladder, undefined);
  } finally { moved.done(); still.done(); }
});

test('R-2 (the equal-hash corner): a plain layered run (three layers, no overseer keys) that has made a pass, resumed after the ladder key was added and nothing else changed, adopts the ladder too (no refusal: a stage is replayed only when its prompt is the one asked now, the others are asked again); a --rounds typed with the resume is kept as the total of reads; --ladder-credit is accepted here, where plain passes exist', () => {
  const plain = { ...base, maxRounds: 6, seats: seats('r') };
  const p = project(plain);
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3);
    p.answer('build', '# Plan v1\n\nAssumptions: tea.\n');
    assert.equal(p.run(['--resume', p.runDir()]).status, 3, 'layer 1 objects in pass 1: the writer is asked to revise');
    p.setChain({ ...plain, ladder: { block: 3, visits: 3 } });
    const r = p.run(['--resume', p.runDir(), '--rounds', '3']);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, ADOPT);
    assert.deepEqual([p.saved().ladder, p.saved().ladderRounds], [{ block: 3, visits: 3, credit: 0, exchange: 0 }, 3], 'a typed --rounds at this resume is read as the ladder total, not as the chain\'s pass bound');
    const credited = project(plain);
    try {
      assert.equal(credited.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3);
      credited.answer('build', '# Plan v1\n\nAssumptions: tea.\n');
      assert.equal(credited.run(['--resume', credited.runDir()]).status, 3);
      credited.setChain({ ...plain, ladder: { block: 3, visits: 3 } });
      const way = credited.run(['--resume', credited.runDir(), '--ladder', '--ladder-credit', '1']);
      assert.notEqual(way.status, 2, way.stdout + way.stderr);
      assert.equal(credited.saved().ladder.credit, 1);
    } finally { credited.done(); }
  } finally { p.done(); }
});

test('R-1b (a pass was made; the chain changed, so every saved stage is stale): the old-key run that made pass 1 and paused at the revise, resumed after the chain file was changed to the ladder key, adopts the ladder (nothing of it is replayed)', () => {
  const p = project({ ...base, ...OLD_KEYS, seats: seats('u') });
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3);
    p.answer('build', '# Plan v1\n\nAssumptions: tea.\n');
    assert.equal(p.run(['--resume', p.runDir()]).status, 3, 'layer 1 objects in pass 1: the writer is asked to revise');
    p.setChain({ ...base, ladder: { block: 3, visits: 3 }, seats: seats('u') });
    const r = p.run(['--resume', p.runDir()]);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, ADOPT);
    assert.deepEqual(p.saved().ladder, { block: 3, visits: 3, credit: 0, exchange: 0 });
  } finally { p.done(); }
});

test('R-3: a --rounds typed at a resume is never dropped silently off the ladder: the run says which number it keeps and why; the same number as the run already has says nothing', () => {
  const mk = id => project({ ...base, ...OLD_KEYS, seats: seats(id) });
  const diff = mk('s'); const same = mk('t');
  try {
    for (const p of [diff, same]) { assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--rounds', '2']).status, 3); p.answer('build', '# Plan v1\n\nAssumptions: tea.\n'); }
    assert.equal(diff.saved().rounds, 2);
    const r = diff.run(['--resume', diff.runDir(), '--rounds', '5']);
    assert.match(r.stderr, /--rounds 5 was not used: this run started with 2 review rounds and keeps them\. Start a new run to use 5\./);
    assert.equal(diff.saved().rounds, 2);
    assert.doesNotMatch(same.run(['--resume', same.runDir(), '--rounds', '2']).stderr, /was not used/);
  } finally { diff.done(); same.done(); }
});
