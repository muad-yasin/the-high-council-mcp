// Round semantics 2b-ii (gate note Round_2b_Gate_Note.md, C&C rulings 15 Oct 2026): the person's choice at a stop. `--resume <run folder> --continue` goes on (more rounds; the choice is recorded in run.json roundChoices and applied on the
// replay: it feeds advance() AND the pass-ceiling backstop), `--finish` ends the run here, NOT agreed (dispute + handoff run), and a resume WITHOUT a choice exits 23 again, spending nothing. Explicit MOCK configurations of this test
// (small numbers so a stop is reachable); not the shipped chain's numbers. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveLimits, stopIdOf, defaultAdd, roundLimitsOf, passCeiling } from '../src/overseer-rounds.js';
import Ajv2020 from 'ajv/dist/2020.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chainOf = (critics, over = {}) => ({
  name: 'ovc', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...over,
});
// A project whose chain stops at the overseer cap (the top layer always objects), and the helper to run the CLI in it.
const project = (id = 'c', over = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'ovc-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify(chainOf([judge('o', `${id}a`, 'l1', 1), judge('o', `${id}b`, 'l2', 2), judge('x', `${id}c`, 'l3', 3)], over)));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  return { dir, run, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const stopped = (over = {}) => { const p = project('c', over); const r = p.run(['--chain', 'ovc', '--task', 'tasks/t.md']); assert.equal(r.status, 23, r.stdout + r.stderr); p.runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]); return p; };

test('C1: a resume WITHOUT a choice exits 23 again with the stop sentence, spends nothing and changes nothing in the folder', () => {
  const p = stopped();
  try {
    const before = readdirSync(p.runDir).sort();
    const partialBefore = statSync(join(p.runDir, 'report-partial.json')).mtimeMs;
    const r = p.run(['--resume', p.runDir]);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /THE RUN STOPPED, NOT AGREED, and is waiting for your choice/);
    assert.deepEqual(readdirSync(p.runDir).sort(), before, 'no file added or removed');
    assert.equal(statSync(join(p.runDir, 'report-partial.json')).mtimeMs, partialBefore, 'the partial report was not rewritten: nothing ran, not even a replay');
    assert.equal(existsSync(join(p.runDir, 'report.json')), false);
  } finally { p.done(); }
});

test('C2: --continue goes on: the choice is recorded in run.json, it raises the overseer-round limit by one (advance() AND the backstop), and the run stops again at the NEXT limit, not the old one', () => {
  const p = stopped();
  try {
    const first = JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8')).stop;
    assert.deepEqual({ kind: first.kind, overseer_round: first.overseer_round }, { kind: 'overseer_cap', overseer_round: 2 });
    const r = p.run(['--resume', p.runDir, '--continue']);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    const choices = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8')).roundChoices;
    assert.deepEqual(choices.map(c => [c.stop, c.choice, c.add]), [[stopIdOf(first), 'continue', 1]]);
    const second = JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8')).stop;
    assert.deepEqual({ kind: second.kind, overseer_round: second.overseer_round }, { kind: 'overseer_cap', overseer_round: 3 });
    assert.notEqual(stopIdOf(second), stopIdOf(first));
  } finally { p.done(); }
});

test('C3: --finish ends the run here, NOT agreed: report.json exists with passed false and the stop (chosen: finish), the stopped markers and the partial report are gone', () => {
  const p = stopped();
  try {
    const r = p.run(['--resume', p.runDir, '--finish']);
    assert.notEqual(r.status, 23, r.stdout + r.stderr);
    const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
    assert.equal(report.passed, false);
    assert.deepEqual({ kind: report.stop.kind, chosen: report.stop.chosen }, { kind: 'overseer_cap', chosen: 'finish' });
    assert.equal(existsSync(join(p.runDir, 'STOPPED-overseer_cap.json')), false);
    assert.equal(existsSync(join(p.runDir, 'report-partial.json')), false);
    assert.equal(r.status === 0 || r.status === 22, true, `a finished not-agreed run exits 0 today and 22 once B's unit lands: ${r.status}`);
  } finally { p.done(); }
});

test('C4: usage: both flags together, a choice without --resume, and --continue on a folder that is not stopped at an overseer limit are refused with exit 2 before anything is spent', () => {
  const p = stopped();
  try {
    assert.equal(p.run(['--resume', p.runDir, '--continue', '--finish']).status, 2);
    const noResume = p.run(['--chain', 'ovc', '--task', 'tasks/t.md', '--continue']);
    assert.equal(noResume.status, 2); assert.doesNotMatch(noResume.stderr, /unknown/i); assert.match(noResume.stderr, /use them with --resume/);
  } finally { p.done(); }
  const q = project('e');
  try {
    mkdirSync(join(q.dir, 'runs', 'x'), { recursive: true });
    writeFileSync(join(q.dir, 'runs', 'x', 'run.json'), JSON.stringify({ chain: 'ovc', task: 'tasks/t.md', cwd: q.dir }));
    const r = q.run(['--resume', join(q.dir, 'runs', 'x'), '--continue']);
    assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stderr, /not stopped at an overseer limit/);
  } finally { q.done(); }
});

// Bug audit 2026-10-24 C-005: with the dispute stage on, `--finish` at a limit used to be recorded as if a round cap had been reached (stop reason "round cap reached", dissent block "(round cap reached)", dispute.reason round_cap). A person chose to finish: dispute.reason is finish_chosen and both texts say so.
test('C3b: --finish with the dispute stage on records the dissent as the person\'s finish, not as a round cap (dispute.reason finish_chosen, the dissent block and the stop line say so)', () => {
  const p = stopped({ dispute: { enabled: true, stall_rounds: 99 } });
  try {
    const r = p.run(['--resume', p.runDir, '--finish']);
    assert.notEqual(r.status, 23, r.stdout + r.stderr);
    const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
    assert.equal(report.dispute?.ran, true, 'the dispute stage ran over the open objections');
    assert.equal(report.dispute.reason, 'finish_chosen');
    const ajv = new Ajv2020({ strict: false, allErrors: true }); ajv.addFormat('date-time', true);
    assert.ok(ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')))(report), 'report.json validates against report-v1 with the new reason value (a closed enum: the schema had to widen)');
    const deliverable = readFileSync(join(p.runDir, 'deliverable.md'), 'utf8');
    assert.match(deliverable, /the person chose to finish at this stop: the overseer-round limit was reached; the panel did not agree/);
    assert.doesNotMatch(deliverable, /round cap reached/);
    assert.match(r.stdout + r.stderr, /Stage: dispute \(finished at the person's choice \(the overseer-round limit was reached\), \d+ open objection\(s\)\)/);
  } finally { p.done(); }
});

test('C8: a tree MEMBER cannot be answered directly: --continue / --finish on a member run is refused (exit 2) with the tree text (give the node up with tree decide --close), and writes no choice into its run.json', () => {
  const p = stopped();
  try {
    const rj = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8'));
    writeFileSync(join(p.runDir, 'run.json'), JSON.stringify({ ...rj, tree: { treeId: 'tree1', node: 'R/M1', generation: 1 } }));
    for (const flag of ['--continue', '--finish']) {
      const r = p.run(['--resume', p.runDir, flag]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /tree decide tree1 --close R\/M1/); assert.equal(/--resume/.test(r.stderr.replace(/--resume (\S+ )?--(continue|finish)/g, '')), false);
    }
    assert.equal('roundChoices' in JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8')), false, 'no choice was written');
  } finally { p.done(); }
});

test('C5: --help names --continue and --finish and the exit 23 case', () => {
  const p = project('f');
  try { const r = p.run(['--help']); assert.match(r.stdout, /--resume <run folder> --continue \| --finish/); assert.match(r.stdout, /exit 23/); } finally { p.done(); }
});

// ---- the pure part
const cfg = chainOf([judge('o', 'pa', 'l1', 1), judge('o', 'pb', 'l2', 2), judge('x', 'pc', 'l3', 3)], { maxOverseerRounds: 4, layerRevisions: { 1: 3, 2: 2 } });
const choice = (over) => ({ stop: 's', choice: 'continue', kind: 'overseer_cap', overseer_round: 4, add: 1, ...over });

test('C6: effectiveLimits: no choices = the chain\'s own limits; a continue raises the overseer cap globally, a layer or silent-pass extension only inside the overseer round it was made in; a finish adds nothing; the backstop uses the LOOSE sum', () => {
  const base = roundLimitsOf(cfg);
  const none = effectiveLimits(cfg, []);
  assert.deepEqual([none.passes, none.overseer, none.layerRevisions], [base.passes, base.overseer, base.layerRevisions]);
  assert.deepEqual(none.advanceConfigAt(1), { maxOverseerRounds: 4, layerRevisions: { 1: 3, 2: 2 }, reasks: 2 });
  const e = effectiveLimits(cfg, [choice({ add: 2 }), choice({ stop: 't', kind: 'layer_bound', why: 'revisions', layer: 1, overseer_round: 2, add: 3 }), choice({ stop: 'u', kind: 'layer_bound', why: 'unheard', layer: 2, overseer_round: 3, add: 2 }), choice({ stop: 'v', choice: 'finish', add: 0 })]);
  assert.equal(e.overseer, 6);
  assert.deepEqual(e.advanceConfigAt(1), { maxOverseerRounds: 6, layerRevisions: { 1: 3, 2: 2 }, reasks: 2 });
  assert.deepEqual(e.advanceConfigAt(2), { maxOverseerRounds: 6, layerRevisions: { 1: 6, 2: 2 }, reasks: 2 }, 'the extension belongs to overseer round 2');
  assert.deepEqual(e.advanceConfigAt(3), { maxOverseerRounds: 6, layerRevisions: { 1: 3, 2: 2 }, reasks: 4 });
  assert.equal(e.passes, passCeiling({ maxOverseerRounds: 6, layerRevisions: { 1: 6, 2: 2 }, reasks: 4 }), 'the backstop covers every extension at once, so the replay can never hit the old ceiling first');
  assert.ok(e.passes > base.passes);
});

test('C7: stopIdOf and defaultAdd: a stop is named by kind, overseer round and pass; the default continue is one more overseer round, the layer\'s own bound again, or the allowed silent passes again', () => {
  assert.equal(stopIdOf({ kind: 'layer_bound', overseer_round: 2, pass: 7 }), 'layer_bound:2:7');
  assert.equal(defaultAdd({ kind: 'overseer_cap' }, cfg), 1);
  assert.equal(defaultAdd({ kind: 'layer_bound', why: 'revisions', layer: 1 }, cfg), 3);
  assert.equal(defaultAdd({ kind: 'layer_bound', why: 'revisions', layer: 2 }, cfg), 2);
  assert.equal(defaultAdd({ kind: 'layer_bound', why: 'unheard', layer: 1 }, cfg), 2);
  assert.deepEqual(effectiveLimits({ maxRounds: 3 }, [choice()]).passes, 3, 'a chain without overseer rounds ignores choices');
});
