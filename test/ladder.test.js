// The ladder (src/ladder.js; `--ladder`, `--ladder-credit`, `--ladder-exchange`; run.json `ladder`): Muad's order for a three-layer chain, as a run setting that is NOT part of the chain config. Offline, $0: mock chains whose judges are scripted by how many
// times they are asked (`mock-critic-script-<xo>-<id>`), run through the real CLI. Small chains of this test, not the shipped ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ladderOf, newLadderState, floorOf, afterObjection } from '../src/ladder.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const critics = (l1, l2, l3, id) => [
  { provider: 'mock', model: `mock-critic-script-${l1}-${id}1`, lab: 'l1', layer: 1 },
  { provider: 'mock', model: `mock-critic-script-${l2}-${id}2`, lab: 'l2', layer: 2 },
  { provider: 'mock', model: `mock-critic-script-${l3}-${id}3`, lab: 'l3', layer: 3 }];
const chainOf = (critic, over = {}, writer = { provider: 'mock', model: 'mock-builder', lab: 'author' }) => ({
  name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: critic }, ...over,
});
const project = (config) => {
  const dir = mkdtempSync(join(tmpdir(), 'lad-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, runDir, done: () => rmSync(dir, { recursive: true, force: true }) };
};
// The layers a pass actually asked, from the report's layers[] rows (a layer that was not asked has state not_asked).
const askedOf = report => { const by = {}; for (const r of report.layers) if (r.state !== 'not_asked') (by[r.round] ||= []).push(r.layer); return Object.keys(by).map(Number).sort((a, b) => a - b).map(n => by[n]); };
const reportOf = dir => JSON.parse(readFileSync(join(dir, existsSync(join(dir, 'report.json')) ? 'report.json' : 'report-partial.json'), 'utf8'));

test('L1: the pure scheduler: a block of 3 layer-1 revisions, then layer 2; after 3 layer-2 visits the next block ends at layer 3; layer 3 starts the layer-2 count again', () => {
  const lad = ladderOf({});
  assert.deepEqual(lad, { block: 3, visits: 3, credit: 0, exchange: 0 });
  let s = newLadderState(lad); const floors = [];
  for (let i = 0; i < 18; i++) {
    const f = floorOf(lad, s); floors.push(f);
    s = afterObjection(s, f === 1 ? 1 : f);   // every layer asked objects, so the layer reached is the floor
  }
  assert.deepEqual(floors, [1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 3, 1, 1]);
  assert.deepEqual(s, { used1: 2, l2: 0, l3: 1 });
  // a credited block: the first ladder pass is layer 2's first visit
  assert.equal(floorOf(ladderOf({ credit: 7 }), newLadderState(ladderOf({ credit: 7 }))), 2);
  // bad settings are refused (null), never defaulted into something else
  for (const bad of [null, 'x', { block: 0 }, { visits: 1.5 }, { credit: -1 }, { exchange: 8 }]) assert.equal(ladderOf(bad), null);
});

test('L2: the order on a real run: L1 x3, L2, L1 x3, L2, L1 x3, L2, L1 x3, L3; the third layer-3 visit without a sign-off is the overseer-round cap stop (exit 23), not an ending', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'a'), { dispute: { enabled: true, stall_rounds: 2 } }));   // the stall rule is ON: on the ladder it neither passes the plan up nor ends the loop
  try {
    const r = p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    const rep = reportOf(p.runDir());
    const lowest = askedOf(rep).map(a => a[0]);
    const cycle = [1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 3];
    assert.deepEqual(lowest, [...cycle, ...cycle, ...cycle]);
    assert.deepEqual(askedOf(rep).slice(0, 4), [[1], [1], [1], [2]], 'pass 4 asks layer 2 only: layer 1 is not asked again before the visit');
    assert.deepEqual({ kind: rep.stop.kind, rounds: rep.stop.rounds, cap: rep.stop.cap, pass: rep.stop.pass }, { kind: 'overseer_cap', rounds: 3, cap: 3, pass: 48 });
    assert.match(r.stdout + r.stderr, /all 3 overseer rounds were used and the top layer still objected/);
    assert.equal(JSON.parse(readFileSync(join(p.runDir(), 'run.json'), 'utf8')).ladder.credit, 0);
  } finally { p.done(); }
});

test('L3: layer 2 signing off goes to layer 3 in the same pass, and layer 3 signing off ends the run: the ladder sign-off (passed false, escalated_signoff marked ladder, exit 22), because layer 1 never read that text', () => {
  const p = project(chainOf(critics('x', 'o', 'o', 'b')));
  try {
    const r = p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder', '--ladder-credit', '2']);
    assert.equal(r.status, 22, r.stdout + r.stderr);
    const rep = reportOf(p.runDir());
    assert.deepEqual(askedOf(rep), [[1], [1], [2, 3]], 'passes 1-2 are the credited block; pass 3 starts at layer 2 and climbs to layer 3');
    assert.equal(rep.passed, false);
    assert.deepEqual(rep.escalated_signoff, { pass: 3, layer: 3, overseer_round: 1, below: [1], ladder: true });
    assert.match(r.stdout, /ladder sign-off: the top layer signed off; layer 1 did not read that text, NOT agreement/);
    // the block above the delivered plan says what happened; the stall wording ("passed up") would be false here
    const top = readFileSync(join(p.runDir(), 'deliverable.md'), 'utf8').slice(0, 400);
    assert.match(top, /^## Ladder sign-off\n\nThe top layer \(layer 3\) signed off on this plan in round 3\. Layer 1 did not read this text/);
    assert.doesNotMatch(top, /passed up/);
  } finally { p.done(); }
});

test('L4: a full climb on the plain pass (layer 1 signs off, layers 2 and 3 on the same text) is an ordinary sign-off: passed true, exit 0, no ladder record', () => {
  const p = project(chainOf(critics('xo', 'o', 'o', 'c')));
  try {
    const r = p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const rep = reportOf(p.runDir());
    assert.equal(rep.passed, true);
    assert.equal(rep.escalated_signoff, undefined);
    assert.deepEqual(askedOf(rep), [[1], [1, 2, 3]]);
  } finally { p.done(); }
});

test('L5: layer 1 signing off inside a block sends the plan up at once and counts as the block; once layer 2 has had its 3 visits, that sign-off goes straight to layer 3, over layer 2', () => {
  const p = project(chainOf(critics('xxo', 'x', 'x', 'd')));
  try {
    const r = p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    const asked = askedOf(reportOf(p.runDir()));
    assert.deepEqual(asked.slice(0, 7), [[1], [1], [1, 2], [1, 2], [1, 2], [1, 3], [1, 2]]);
    assert.equal(asked.length, 14);
  } finally { p.done(); }
});

test('L6: layers 2 and 3 get an exchange only on the ladder and only with --ladder-exchange; layer 1 keeps the chain\'s own count', () => {
  const exch = id => chainOf([
    { provider: 'mock', model: `mock-critic-script-o-${id}1`, lab: 'l1', layer: 1 },
    { provider: 'mock', model: `mock-exch-contest-keep-${id}2`, lab: 'l2a', layer: 2 },
    { provider: 'mock', model: `mock-exch-contest-keep-${id}3`, lab: 'l2b', layer: 2 },
    { provider: 'mock', model: `mock-critic-script-o-${id}4`, lab: 'l3', layer: 3 }], { layer_debate: { enabled: true, rounds: 1 } });
  const without = project(exch('e'));
  const withIt = project(exch('f'));
  try {
    assert.equal(without.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 0);
    assert.deepEqual(reportOf(without.runDir()).layer_debates ?? [], [], 'no ladder, no exchange at layer 2');
    const r = withIt.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder', '--ladder-exchange', '1']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(reportOf(withIt.runDir()).layer_debates.map(d => d.layer), [2]);
    assert.ok(readdirSync(withIt.runDir()).some(f => f.startsWith('ldebate-1-l2a')));
  } finally { without.done(); withIt.done(); }
});

test('L7: the $0 replay: a run paused on the plain rules resumes with --ladder --ladder-credit N: no stale stage, no new call for the credited passes, and the next pass asks layer 2 only', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'g'), {}, { provider: 'external', model: 'claude-code-session' }));
  const answer = (name, text) => writeFileSync(join(p.runDir(), `${name}.md`), text);
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3);
    answer('build', '# Plan v1\n\n1. Boil.\n2. Steep.\n3. Pour.\n\nAssumptions: black tea.\n');
    assert.equal(p.run(['--resume', p.runDir()]).status, 3);
    assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-1.md')));
    answer('revise-1', '# Plan v2\n\n1. Boil.\n2. Steep.\n3. Pour.\n\nAssumptions: black tea.\n');
    assert.equal(p.run(['--resume', p.runDir()]).status, 3);
    answer('revise-2', '# Plan v3\n\n1. Boil.\n2. Steep.\n3. Pour.\n\nAssumptions: black tea, boiled water.\n');
    const r = p.run(['--resume', p.runDir(), '--ladder', '--ladder-credit', '2']);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /STALENESS/);
    assert.equal(existsSync(join(p.runDir(), 'WARNINGS.md')), false);
    const files = readdirSync(p.runDir());
    assert.deepEqual(files.filter(f => /^panel-\d+-l\d\.md$/.test(f)).sort(), ['panel-1-l1.md', 'panel-2-l1.md', 'panel-3-l2.md']);
    assert.equal(files.includes('superseded'), false, 'nothing was set aside and nothing was paid again');
    assert.match(r.stdout, /panel-1-l1: mock\/mock-critic-script-x-g1 - from disk/);
    assert.match(r.stdout, /panel-2-l1: mock\/mock-critic-script-x-g1 - from disk/);
    assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-3.md')));
    const saved = JSON.parse(readFileSync(join(p.runDir(), 'run.json'), 'utf8')).ladder;
    assert.deepEqual(saved, { block: 3, visits: 3, credit: 2, exchange: 0 });
    // a later plain resume keeps the ladder (it is read from run.json), and a different one is refused
    const again = p.run(['--resume', p.runDir(), '--ladder', '--ladder-credit', '5']);
    assert.equal(again.status, 2, again.stdout + again.stderr);
    assert.match(again.stderr, /already runs under a ladder/);
  } finally { p.done(); }
});

test('L8: usage: --ladder-credit and --ladder-exchange need --ladder and a whole number; a chain without overseer rounds refuses the ladder before anything is asked', () => {
  const p = project(chainOf(critics('o', 'o', 'o', 'h')));
  const plain = project({ ...chainOf(critics('o', 'o', 'o', 'i')), maxOverseerRounds: undefined, layerRevisions: undefined, maxRounds: 4 });
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder-credit', '2']).status, 2);
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder', '--ladder-credit', 'x']).status, 2);
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder', '--ladder-exchange', '9']).status, 2);
    const r = plain.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--ladder: this chain does not have exactly three layers with overseer rounds \(maxOverseerRounds and layerRevisions\), which the ladder needs\. Nothing was run and nothing was spent\./);
    assert.equal(existsSync(join(plain.dir, 'runs')) && readdirSync(join(plain.dir, 'runs')).some(d => existsSync(join(plain.dir, 'runs', d, 'criteria.md'))), false, 'refused before any stage ran');
  } finally { p.done(); plain.done(); }
});

test('L9: a stall escalation still in force when the ladder begins is refused, not mixed: the credited passes ran under the plain rules, and a ladder pass never rules on passed-up objections', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'j'), { dispute: { enabled: true, stall_rounds: 2 } }));
  try {
    const r = p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder', '--ladder-credit', '2']);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /the ladder cannot start at pass 3: in round 2 the plan was passed up a layer because objections stood unchanged, and that is still in force; the ladder never passes the plan up\. No model was called and nothing was spent after pass 2\./);
    assert.equal(readdirSync(p.runDir()).some(f => /^(panel|rule)-3-/.test(f)), false, 'nothing was asked in pass 3');
  } finally { p.done(); }
});
