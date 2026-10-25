// Round semantics 2a (gate page Review/Build_0.8.3/m6-closing/Round_Semantics_Gate_Page.md sections 9-10, C&C 15 Oct 2026): the keys maxOverseerRounds + layerRevisions, their lint, the derived limits every reader goes through
// (roundLimitsOf), the layer-aware estimate, the dry-run fields and the --rounds override. INERT: no shipped chain carries the keys yet; every row builds a TEST chain from plan-high-council with the keys added. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { projectTree } from '../src/tree-projection.js';
import { readChainFile } from './helpers/chain-file.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OR = await import('../src/overseer-rounds.js').catch(() => ({}));
const LY = await import('../src/layers.js').catch(() => ({}));
const COST = await import('../src/cost.js');
const DRY = await import('../src/dry-run.js');
const readChain = n => readChainFile(root, n);

// The test chain: plan-high-council with the overseer keys instead of a pass cap.
// The shipped chain carries the keys since 2b: every CHAIN-derived row reads its numbers FROM plan-high-council.json (Muad: the numbers live only there and will probably change; nothing here pins 7/5/3 or a dollar figure).
const shipped = readChain('plan-high-council');
const N = shipped.maxOverseerRounds; const B1 = shipped.layerRevisions[1]; const B2 = shipped.layerRevisions[2];
const CEIL = N * (B1 + B2 + 1) * (OR.REASKS_NO_REVISE + 1);
const overseerChain = (over = {}) => ({ ...structuredClone(shipped), ...over });
const kinds = c => LY.overseerKeyProblems(c, 'x.json');

test('K1: roundLimitsOf: a flat chain keeps maxRounds (default 2), a chain with the keys gets the DERIVED pass ceiling and its overseer rounds, malformed keys read as no overseer rounds', () => {
  assert.deepEqual(OR.roundLimitsOf({ maxRounds: 4 }), { passes: 4, overseer: null, layerRevisions: null });
  assert.deepEqual(OR.roundLimitsOf({}), { passes: 2, overseer: null, layerRevisions: null });
  assert.deepEqual(OR.roundLimitsOf(overseerChain()), { passes: CEIL, overseer: N, layerRevisions: { 1: B1, 2: B2 } });
  assert.deepEqual(OR.roundLimitsOf({ maxRounds: 3, maxOverseerRounds: 7, layerRevisions: { 1: 5 } }), { passes: 3, overseer: null, layerRevisions: null });
});

test('K2: --rounds N and a resume\'s saved value mean OVERSEER rounds on a chain that has them, maxRounds on any other; roundsSetting reads the same number back', () => {
  const o = overseerChain(); OR.setRounds(o, 4);
  assert.equal(o.maxOverseerRounds, 4); assert.equal('maxRounds' in o, false); assert.equal(OR.roundsSetting(o), 4);
  const f = { maxRounds: 3 }; OR.setRounds(f, 5);
  assert.equal(f.maxRounds, 5); assert.equal('maxOverseerRounds' in f, false); assert.equal(OR.roundsSetting(f), 5);
  assert.equal(OR.roundsSetting({}), undefined);
});

test('K3: lint: the test chain is clean; every misuse is refused with the key named; "maxRounds BESIDE maxOverseerRounds" is refused but a layered chain with only maxRounds is not (C&C wording)', () => {
  assert.deepEqual(kinds(overseerChain()), []);
  const msgs = c => kinds(c).map(p => p.message);
  assert.match(msgs((() => { const c = overseerChain(); delete c.layerRevisions; return c; })()).join('|'), /"maxOverseerRounds" is set without "layerRevisions"/);
  assert.match(msgs((() => { const c = overseerChain(); delete c.maxOverseerRounds; return c; })()).join('|'), /"layerRevisions" is set without "maxOverseerRounds"/);
  assert.match(msgs(overseerChain({ maxRounds: 9 })).join('|'), /"maxRounds" is set beside "maxOverseerRounds"/);
  assert.match(msgs(overseerChain({ maxOverseerRounds: 0 })).join('|'), /maxOverseerRounds must be a whole number/);
  assert.match(msgs(overseerChain({ layerRevisions: { 1: 5 } })).join('|'), /exactly the keys "1" and "2"/);
  assert.match(msgs(overseerChain({ layerRevisions: { 1: 5, 2: 0 } })).join('|'), /bounds must be whole numbers/);
  const two = overseerChain(); two.seats.critics = two.seats.critics.filter(s => s.layer !== 3);
  assert.match(msgs(two).join('|'), /not exactly three layers/);
  const flatNo = { maxOverseerRounds: 7, layerRevisions: { 1: 5, 2: 3 }, seats: { critics: [{ provider: 'mock', model: 'm', lab: 'a' }] } };
  assert.match(msgs(flatNo).join('|'), /not exactly three layers/);
});

test('K4 (PIN): every shipped chain WITHOUT the keys is untouched by the new rules, and none of their estimate rows carries a `times` field (the inert path)', () => {
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) {
    const c = readChain(f.replace(/\.json$/, ''));
    assert.deepEqual(kinds(c), [], f);
    if ('maxOverseerRounds' in c) continue; // the shipped layered chain: its own rows are K5-K8
    assert.equal(OR.roundLimitsOf(c).overseer, null, f);
    for (const maximum of [false, true]) assert.equal(COST.estimateChainRows(c, { maximum }).some(r => 'times' in r), false, `${f} (maximum: ${maximum})`);
  }
});

// The expected per-ask rows come from the existing flat estimate of the same panel (derived, never typed): one pass of every critic.
const perAsk = (chain, maximum) => {
  const flat = structuredClone(chain); delete flat.maxOverseerRounds; delete flat.layerRevisions; flat.maxRounds = 2;
  const rows = COST.estimateChainRows(flat, { maximum });
  const byLab = new Map(rows.filter(r => /^panel-1-/.test(r.label)).map(r => [r.label.replace(/^panel-1-/, ''), r.usd]));
  const revise = rows.find(r => r.label === 'revise-1').usd;
  const rest = rows.filter(r => !/^panel-\d+-|^revise-\d+$/.test(r.label)).reduce((n, r) => n + r.usd, 0);
  return { byLab, revise, rest };
};
const sum = rows => rows.reduce((n, r) => n + r.usd, 0);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('K5: the layer-aware estimate: EXPECTED = seven overseer rounds each ending after one climb; MAXIMUM = every allowed revision used in every round (layer 1 asked b1+b2+1 times, layer 2 b2+1, layer 3 once); both derived from the flat per-ask rows', () => {
  const c = overseerChain(); const n = N, b1 = B1, b2 = B2;
  const layerOfLab = new Map(c.seats.critics.map(s => [s.lab, s.layer]));
  for (const maximum of [false, true]) {
    const { byLab, revise, rest } = perAsk(c, maximum);
    const times = layer => (maximum ? n * ({ 1: b1 + b2 + 1, 2: b2 + 1 }[layer] ?? 1) : n);
    let panel = 0; for (const [lab, usd] of byLab) panel += usd * times(layerOfLab.get(lab));
    const revises = maximum ? n * (b1 + b2) + (n - 1) : n - 1;
    near(sum(COST.estimateChainRows(c, { maximum })), rest + panel + revise * revises, maximum ? 'maximum' : 'expected');
  }
  const rows = COST.estimateChainRows(c, { maximum: true });
  const l1 = rows.find(r => r.label.startsWith('panel-L1-'));
  assert.equal(l1.times, N * (B1 + B2 + 1), 'a layer-1 seat is one row standing for its calls, usd already multiplied');
  assert.ok(rows.filter(r => /^panel-/.test(r.label)).every(r => /^panel-L[123]-/.test(r.label)), 'no flat panel-<pass> row');
});

test('K6: the dry run: maxRounds is null and maxOverseerRounds + passCeiling are reported for the test chain; a flat chain\'s report is unchanged (no new key); the floor is ONE climb with no revise', () => {
  const r = DRY.dryRunReport(overseerChain());
  assert.equal(r.maxRounds, null); assert.equal(r.maxOverseerRounds, N); assert.equal(r.passCeiling, CEIL);
  const flat = DRY.dryRunReport(readChain('plan-daily-7'));
  assert.equal('maxOverseerRounds' in flat, false); assert.equal('passCeiling' in flat, false);
  const one = overseerChain({ maxOverseerRounds: 1 });
  near(r.estimate.floorUsd, sum(COST.estimateChainRows(one)), 'floor = the 1-round estimate');
  assert.equal(COST.estimateChainRows(one).some(x => x.label === 'revise-all'), false, 'one overseer round has no revise');
});

test('K7: the schema accepts the keys and refuses a layerRevisions without layer 2', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
  assert.equal(validate(overseerChain()), true, JSON.stringify(validate.errors));
  assert.equal(validate(overseerChain({ layerRevisions: { 1: 5 } })), false);
});

test('K8: the CLI dry run of a chain with the keys says "Overseer rounds: N", names the plain-run shape in the Expected line and the bound-exhausted shape and its exclusions in the Maximum line, shows repeat counts, and counts repeats in "N of M stages"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ovk-'));
  try {
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'chains', 'ovk.json'), JSON.stringify({ ...overseerChain(), name: 'ovk' }));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'ovk', '--task', 'tasks/t.md', '--dry-run'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Overseer rounds: ${N} \\(a round ends when the top layer gives a verdict;.*at most ${CEIL} passes, a ceiling, not a plan\\)`));
    assert.match(r.stdout, new RegExp(`Expected: .*${N} overseer rounds each ending after ONE climb`));
    assert.match(r.stdout, new RegExp(`layer 1 up to ${B1}, layer 2 up to ${B2} per round.*in-pass re-asks \\(up to 2 per seat\\).*The limit you type is the only ceiling`));
    assert.match(r.stdout, new RegExp(`panel-L1-\\S+ x${N}\\b`));
    const total = COST.estimateChainRows(overseerChain()).reduce((n, x) => n + (x.times ?? 1), 0);
    const ext = COST.estimateChainRows(overseerChain()).filter(x => x.seat.startsWith('external/')).reduce((n, x) => n + (x.times ?? 1), 0);
    assert.ok(r.stdout.includes(`${ext} of ${total} stages are answered by external seats`), `${ext} of ${total}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('K10: the tree projection counts REPEATS: stages and externalStages sum `times` (the number of calls the rows stand for), not the number of rows', () => {
  const c = overseerChain(); const rows = COST.estimateChainRows(c);
  const p = projectTree({ root: { name: 'ovk', config: c }, child: { name: 'ovk', config: c } });
  assert.equal(p.root.stages, rows.reduce((n, r) => n + (r.times ?? 1), 0));
  assert.equal(p.root.externalStages, rows.filter(r => r.seat.startsWith('external/')).reduce((n, r) => n + (r.times ?? 1), 0));
  assert.ok(p.root.stages > rows.length, 'repeats were counted');
});

test('K11: the --json dry run carries the repeat counts (times, maximumTimes) on the layer rows and maxOverseerRounds / passCeiling on the report; a flat chain\'s rows have neither', () => {
  const r = DRY.dryRunReport(overseerChain());
  const l1 = r.rows.find(x => x.label.startsWith('panel-L1-'));
  assert.equal(l1.times, N); assert.equal(l1.maximumTimes, N * (B1 + B2 + 1));
  assert.ok(r.rows.filter(x => x.label.startsWith('panel-L')).every(x => x.times === N && x.maximumTimes >= N));
  const flat = DRY.dryRunReport(readChain('plan-daily-7'));
  assert.equal(flat.rows.some(x => 'times' in x || 'maximumTimes' in x), false);
});

