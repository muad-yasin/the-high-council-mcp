// The member verb, commit 2, real CLI rows (gate note Member_Verb_Gate_Note.md + delta addendum): the roundChoices entry the TREE writes has no `add` (it holds no chain config); cli.js fills it from the chain file, the one place that has
// it. A bare `--resume` on a run whose run.json already holds the entry goes on with no flag (what the tree sitting relies on). Explicit MOCK configuration as test/overseer-choice.test.js; offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chainOf = (critics, over = {}) => ({
  name: 'ovc', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...over,
});
// A project whose chain stops at the overseer cap (the top layer always objects), and the helper to run the CLI in it.
const project = (id = 'c') => {
  const dir = mkdtempSync(join(tmpdir(), 'ovc-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify(chainOf([judge('o', `${id}a`, 'l1', 1), judge('o', `${id}b`, 'l2', 2), judge('x', `${id}c`, 'l3', 3)])));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  return { dir, run, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const stopped = () => { const p = project(); const r = p.run(['--chain', 'ovc', '--task', 'tasks/t.md']); assert.equal(r.status, 23, r.stdout + r.stderr); p.runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]); return p; };

const entryOf = runDir => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).roundChoices ?? [];
const withEntry = (p, choice) => {
  const rj = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8'));
  const stop = JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8')).stop;
  const e = { stop: `${stop.kind}:${stop.overseer_round}:${stop.pass}`, choice, kind: stop.kind, overseer_round: stop.overseer_round };   // no add, as the tree writes it
  writeFileSync(join(p.runDir, 'run.json'), JSON.stringify({ ...rj, roundChoices: [e] }));
};

test('CL-1 a continue entry WITHOUT add (as a tree sitting writes it): a bare --resume goes on, cli.js fills add from the chain (defaultAdd: one more overseer round), and the run stops again at the NEXT limit', () => {
  const p = stopped();
  try {
    withEntry(p, 'continue');
    const r = p.run(['--resume', p.runDir]);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    const list = entryOf(p.runDir);
    assert.equal(list.length, 1); assert.equal(list[0].choice, 'continue'); assert.equal(list[0].add, 1, 'add was filled from defaultAdd');
    assert.match(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8'), /"overseer_round": ?3/, 'the next stop is the next round, not the old one');
  } finally { p.done(); }
});

test('CL-2 a finish entry with no flag ends the run NOT agreed exactly as --finish does: report.json passed false, stop.chosen finish, markers gone', () => {
  const p = stopped();
  try {
    withEntry(p, 'finish');
    const r = p.run(['--resume', p.runDir]);
    assert.notEqual(r.status, 23, r.stdout + r.stderr);
    const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
    assert.equal(report.passed, false); assert.equal(report.stop.chosen, 'finish');
    assert.equal(existsSync(join(p.runDir, 'STOPPED-overseer_cap.json')), false);
  } finally { p.done(); }
});

test('CL-3 a tree MEMBER with an entry in run.json but NO choice on the tree record: a bare --resume does not go on (exit 23, the stop sentence, nothing spent, run.json unchanged); the entry alone never starts a paid resume', () => {
  const p = stopped();
  try {
    const rj = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8'));
    writeFileSync(join(p.runDir, 'run.json'), JSON.stringify({ ...rj, tree: { treeId: 'tree1', node: 'R/M1', generation: 1 } }));
    withEntry(p, 'continue');
    const before = readFileSync(join(p.runDir, 'run.json'), 'utf8'); const files = readdirSync(p.runDir).sort().join();
    const r = p.run(['--resume', p.runDir]);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    assert.equal(readFileSync(join(p.runDir, 'run.json'), 'utf8'), before, 'run.json unchanged');
    assert.equal(readdirSync(p.runDir).sort().join(), files, 'no stage file was written');
  } finally { p.done(); }
});
