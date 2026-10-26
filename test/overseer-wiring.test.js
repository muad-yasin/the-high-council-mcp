// Round semantics 2b-i (gate note Round_2b_Gate_Note.md, C&C ruling 15 Oct 2026; Muad: a round ends only when the overseer layer gives a verdict): the run loop is wired to the overseer-round bookkeeping (src/overseer-rounds.js), and a layered
// run that reaches the overseer-round cap or a layer's revision bound STOPS, resumable, NOT agreed: RoundStopped, thrown before the post-loop stages; the CLI writes STOPPED-<cause>.json + report-partial.json (no report.json) and exits 23.
// The chains below are explicit MOCK configurations of THIS test (small numbers so a bound is reachable); they are not the shipped chain's numbers. Offline, $0. The judges are the scripted mocks
// `mock-critic-script-<pattern>-<id>` (x = object, o = sign off; one character per ask of that model string in this process, the last repeating): every test gives its models its own id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, RoundStopped, setCache, setBudget } from '../src/chain.js';
import { roundLimitsOf, stopSentence } from '../src/overseer-rounds.js';
import { readStoppedMarker } from '../src/stop-files.js';
import { deriveRunStatus } from '../src/run-status.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chainOf = (critics, over = {}) => ({
  name: 'ov-test', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...over,
});
const go = async config => {
  setCache(null); setBudget(null);
  const stages = [];
  try { const result = await runChain({ request: 'A mock task.', log: () => {}, onStage: s => stages.push(s.label), runId: 'r-ov', config }); return { result, stages }; }
  catch (err) { return { err, stages }; }
};

test('W1: layer 1 objects past its bound: the run STOPS at the first objection beyond the allowed revisions (RoundStopped, layer_bound / revisions), nothing after the loop ran, the rows carry the overseer round', async () => {
  const c = chainOf([judge('x', 'w1a', 'l1', 1), judge('o', 'w1b', 'l2', 2), judge('o', 'w1c', 'l3', 3)]);
  const { err, stages } = await go(c);
  assert.ok(err instanceof RoundStopped, String(err?.stack || err));
  assert.deepEqual({ kind: err.stop.kind, why: err.stop.why, layer: err.stop.layer, used: err.stop.used, bound: err.stop.bound, pass: err.stop.pass, overseer_round: err.stop.overseer_round },
    { kind: 'layer_bound', why: 'revisions', layer: 1, used: 2, bound: 2, pass: 3, overseer_round: 1 });
  assert.equal('overseerRound' in err.stop, false, 'one spelling in the record: overseer_round');
  assert.ok(stages.includes('panel-3-l1'), 'the third objection was heard (stage labels are the PASS labels, unchanged)');
  assert.equal(stages.some(l => /^(revise-3|dispute|handoff|final-edit)/.test(l)), false, 'no revise, dispute or handoff after the stop');
  assert.ok(err.partial.layers.every(r => r.overseer_round === 1));
  assert.equal(err.partial.passed, false);
});

test('W2: the overseer objects in every round: the last allowed overseer verdict is the CAP STOP instead of a revise; the rows count overseer rounds, the passes keep their numbers', async () => {
  const c = chainOf([judge('o', 'w2a', 'l1', 1), judge('o', 'w2b', 'l2', 2), judge('x', 'w2c', 'l3', 3)], { maxOverseerRounds: 2 });
  const { err, stages } = await go(c);
  assert.ok(err instanceof RoundStopped, String(err?.stack || err));
  assert.deepEqual({ kind: err.stop.kind, rounds: err.stop.rounds, cap: err.stop.cap, pass: err.stop.pass }, { kind: 'overseer_cap', rounds: 2, cap: 2, pass: 2 });
  assert.deepEqual([...new Set(err.partial.layers.map(r => `${r.round}:${r.overseer_round}`))].sort(), ['1:1', '2:2']);
  assert.ok(stages.includes('revise-1') && !stages.includes('revise-2'), 'the first objection revises; the one that ends the last allowed overseer round stops instead');
  assert.equal(err.partial.overseer_rounds, 2);
});

test('W3: a seat of layer 2 stays unheard: after the allowed consecutive silent passes the run stops (layer_bound / unheard), where it used to loop until the pass cap', async () => {
  const c = chainOf([judge('o', 'w3a', 'l1', 1), judge('o', 'w3b', 'l2', 2), { provider: 'mock', model: 'mock-unreadable', lab: 'l2b', layer: 2 }, judge('o', 'w3c', 'l3', 3)], { maxOverseerRounds: 5 });
  const { err } = await go(c);
  assert.ok(err instanceof RoundStopped, String(err?.stack || err));
  assert.deepEqual({ kind: err.stop.kind, why: err.stop.why, layer: err.stop.layer, passes: err.stop.passes, reasks: err.stop.reasks }, { kind: 'layer_bound', why: 'unheard', layer: 2, passes: 3, reasks: 2 });
});

test('W4: everyone signs off: the run passes, one overseer round is counted, there is no stop, and the stage labels are the unchanged pass labels', async () => {
  const c = chainOf([judge('o', 'w4a', 'l1', 1), judge('o', 'w4b', 'l2', 2), judge('o', 'w4c', 'l3', 3)]);
  const { result, err, stages } = await go(c);
  assert.equal(err, undefined, String(err?.stack || err));
  assert.equal(result.passed, true);
  assert.equal(result.overseer_rounds, 1);
  assert.deepEqual(stages.filter(l => /^panel-/.test(l)), ['panel-1-l1', 'panel-1-l2', 'panel-1-l3']);
  assert.ok(result.layers.every(r => r.overseer_round === 1));
});

test('W5: the backstop is never reached: the stop of every case above happens at or before the derived pass ceiling', async () => {
  for (const [critics, over] of [
    [[judge('x', 'w5a', 'l1', 1), judge('o', 'w5b', 'l2', 2), judge('o', 'w5c', 'l3', 3)], {}],
    [[judge('o', 'w5d', 'l1', 1), judge('o', 'w5e', 'l2', 2), judge('x', 'w5f', 'l3', 3)], { maxOverseerRounds: 2 }],
  ]) {
    const c = chainOf(critics, over); const { err } = await go(c);
    assert.ok(err instanceof RoundStopped);
    assert.ok(err.stop.pass <= roundLimitsOf(c).passes, `${err.stop.pass} <= ${roundLimitsOf(c).passes}`);
  }
});

test('W6 (PIN): a layered chain WITHOUT the keys keeps its flat behaviour: no overseer fields in the rows or the result, and the round cap still ends it', async () => {
  const c = chainOf([judge('o', 'w6a', 'l1', 1), judge('o', 'w6b', 'l2', 2), judge('x', 'w6c', 'l3', 3)], { maxRounds: 2 });
  delete c.maxOverseerRounds; delete c.layerRevisions;
  const { result, err } = await go(c);
  assert.equal(err, undefined, String(err?.stack || err));
  assert.equal(result.passed, false);
  assert.equal('overseer_rounds' in result, false);
  assert.equal(result.layers.some(r => 'overseer_round' in r), false);
});

test('W7: the CLI: a stop is exit 23 with STOPPED-overseer_cap.json and report-partial.json (stop, overseer rounds) and NO report.json / deliverable.md; run status reads awaiting_choice; the sentence says NOT AGREED and names both commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ovw-'));
  try {
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'chains', 'ovw.json'), JSON.stringify(chainOf([judge('o', 'w7a', 'l1', 1), judge('o', 'w7b', 'l2', 2), judge('x', 'w7c', 'l3', 3)], { name: 'ovw', maxOverseerRounds: 2 })));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'ovw', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(r.status, 23, r.stdout + r.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    assert.equal(existsSync(join(runDir, 'report.json')), false);
    assert.equal(existsSync(join(runDir, 'deliverable.md')), false);
    const partial = JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8'));
    assert.equal(partial.stop.kind, 'overseer_cap'); assert.equal(partial.overseer_rounds, 2);
    assert.ok(partial.layers.every(x => Number.isInteger(x.overseer_round)));
    const marker = readStoppedMarker(runDir);
    assert.equal(marker.stoppedBy, 'overseer_cap'); assert.equal(marker.data.resumeAfterStop, true);
    assert.equal(deriveRunStatus(runDir, {}), 'awaiting_choice');
    assert.equal(JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8')).phase, 'awaiting_choice', 'state.json at rest names the stop, not "running"');
    const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
    assert.equal(validate(partial), true, JSON.stringify(validate.errors?.slice(0, 3)));
    const text = r.stdout + r.stderr;
    assert.match(text, /THE RUN STOPPED, NOT AGREED, and is waiting for your choice/);
    assert.match(text, /--resume .* --continue/); assert.match(text, /--resume .* --finish/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('W8: the stop sentence (pure): it says NOT AGREED, why, the spend, the draft file, both commands; one variant per kind', () => {
  const cap = stopSentence({ kind: 'overseer_cap', rounds: 7, cap: 7, pass: 20, overseer_round: 7 }, { spentUsd: 12.5, draftFile: 'revise-19.md', runDir: 'runs/x' });
  assert.match(cap, /NOT AGREED/); assert.match(cap, /all 7 overseer rounds were used/); assert.match(cap, /\$12\.50/); assert.match(cap, /revise-19\.md in runs\/x/); assert.match(cap, /--continue/); assert.match(cap, /--finish/);
  const member = stopSentence({ kind: 'overseer_cap', rounds: 7, cap: 7, pass: 20, overseer_round: 7 }, { spentUsd: 1, draftFile: 'revise-3.md', runDir: 'runs/x', memberTail: 'MEMBER TEXT' });
  assert.match(member, /NOT AGREED/); assert.match(member, /MEMBER TEXT/); assert.equal(/--resume|--continue|--finish/.test(member), false, 'a tree member never gets a direct --resume line');
  assert.match(stopSentence({ kind: 'layer_bound', why: 'revisions', layer: 1, used: 5, bound: 5, pass: 9, overseer_round: 2 }), /layer 1 needed more than its 5 allowed revisions in overseer round 2/);
  assert.match(stopSentence({ kind: 'layer_bound', why: 'unheard', layer: 2, passes: 3, reasks: 2, pass: 9, overseer_round: 2 }), /a seat in layer 2 stayed silent for 3 passes in a row/);
});

test('W10: tree recovery: a member folder with STOPPED-overseer_cap.json or STOPPED-layer_bound.json and no report.json ENDED as round_stopped (awaiting its choice): not an interrupted run and NOT a budget stop (which STOPPED-budget.json alone is)', async () => {
  const { runEndOf } = await import('../src/tree-member.js');
  for (const [marker, kind] of [['STOPPED-overseer_cap.json', 'round_stopped'], ['STOPPED-layer_bound.json', 'round_stopped'], ['STOPPED-budget.json', 'stopped']]) {
    const dir = mkdtempSync(join(tmpdir(), 'ovw-end-'));
    try { writeFileSync(join(dir, marker), '{}'); assert.deepEqual(runEndOf(dir), { kind }, marker); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const empty = mkdtempSync(join(tmpdir(), 'ovw-end-'));
  try { assert.equal(runEndOf(empty), null, 'no marker, no report: still an interrupted run'); } finally { rmSync(empty, { recursive: true, force: true }); }
});

test('W9: exit 23 at TREE level: a member that stopped at its overseer limit is "awaiting_choice" (exit 20, stopped for a person; never "crashed"), and the sitting names both commands', async () => {
  const { exitCodeOf, sittingLines, EXIT_STOPPED_FOR_PERSON, STATUS_OF_EXIT } = await import('../src/tree-resume.js');
  assert.equal(STATUS_OF_EXIT[23], 'awaiting_choice');
  assert.deepEqual([3, 4, 19].map(c => STATUS_OF_EXIT[c]), ['waiting', 'budget_stop', 'tree_refused'], 'the existing codes keep their meaning');
  assert.equal(exitCodeOf({ status: 'awaiting_choice' }), EXIT_STOPPED_FOR_PERSON);
  assert.notEqual(exitCodeOf({ status: 'awaiting_choice' }), exitCodeOf({ status: 'crashed' }));
  const text = sittingLines({ status: 'awaiting_choice', started: [], node: 'n1', runId: 'r1' }, 'root1').join('\n');
  assert.match(text, /NOT agreed/); assert.match(text, /tree decide root1 --close n1/);
  assert.equal(/--resume/.test(text), false, 'a member is resumed only by its tree: the sitting line never names a direct --resume');
});
