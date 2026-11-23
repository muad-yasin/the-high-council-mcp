// SAME-LAYER SEAT KEY (0.8.4 seats and retirements unit; C&C ruling 10 Nov 2026 02:49: "the same-layer seat key is built in this unit: same provider+model only, one lab, never a shared label/record/persona key/objection id/replay;
// existing keys byte for byte; different models under one lab stay refused"). plan-claude-council seats Haiku twice on layer 1 and Sonnet twice on layer 2. The first seat of a model on the lowest layer keeps the bare lab, the first seat on
// any other layer is `<lab>-l<layer>` (as before), a second, third ... seat of the SAME layer is `<lab>-l<layer>-<n>`; the dry run's row labels get `-<n>` after the lab for such a seat only. Offline, mock seats, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, duplicateLabSlots, panelLabCount, labOf } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';
import { layerProblems } from '../src/layers.js';
import { repeatedModelKeys, repeatedLabsOf, registerSeatKeys, seatKeyOf } from '../src/seat-key.js';
import * as SK from '../src/seat-key.js';   // sameLayerOrdinals is new: read through the namespace, so a tree without it fails SL-6 alone and not the whole file
import { estimateChainRows } from '../src/cost.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const judge = (pattern, id, lab, layer, extra = {}) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, ...(layer === undefined ? {} : { layer }), ...extra });
const chainOf = (critics, extra = {}) => ({
  name: 'same-layer-test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
const go = async config => { const lines = []; const r = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-sl', config }); return { r, log: lines.join('\n') }; };
const kinds = c => lintChain(c, 'sl.json').map(f => f.kind);
const keysOf = critics => { registerSeatKeys({ seats: { critics } }); return critics.map(seatKeyOf); };

test('SL-1 THE KEYS: the first seat of the lowest layer keeps the bare lab, the first seat of another layer is <lab>-l<layer> (as before), a second seat of one layer is <lab>-l<layer>-<n>; existing one-per-layer chains get the keys they always got', () => {
  const a1 = judge('o', 'sl1', 'alpha', 1), a2 = judge('o', 'sl1', 'alpha', 1), a3 = judge('o', 'sl1', 'alpha', 1);
  assert.deepEqual(keysOf([a1, a2]), ['alpha', 'alpha-l1-2']);
  assert.deepEqual(keysOf([a1, a2, a3]), ['alpha', 'alpha-l1-2', 'alpha-l1-3']);
  const s1 = judge('o', 'sl1b', 'sonnet', 1), s2 = judge('o', 'sl1b', 'sonnet', 2), s3 = judge('o', 'sl1b', 'sonnet', 2);
  assert.deepEqual(keysOf([s1, s2, s3]), ['sonnet', 'sonnet-l2', 'sonnet-l2-2'], 'one on layer 1, two on layer 2');
  assert.deepEqual(keysOf([judge('o', 'sl1c', 'beta', 1), judge('o', 'sl1c', 'beta', 2)]), ['beta', 'beta-l2'], 'the old one-per-layer repeat: byte for byte');
  assert.deepEqual(keysOf([judge('o', 'sl1d', 'gamma', 1), judge('o', 'sl1e', 'delta', 1)]), ['gamma', 'delta'], 'no repeated model: the key IS the lab');
  const order = [judge('o', 'sl1f', 'eps', 2), judge('o', 'sl1f', 'eps', 1)];
  assert.deepEqual(keysOf(order), ['eps-l2', 'eps'], 'the lowest layer is bare whatever the file order');
});

test('SL-2 THE LINT AND THE RUN-TIME CHECK ALLOW THE SAME MODEL TWICE ON ONE LAYER: one lab for every count, no duplicate-lab, no invalid-layer, no duplicateLabSlots', () => {
  const c = chainOf([judge('o', 'sl2', 'alpha', 1), judge('o', 'sl2', 'alpha', 1), judge('o', 'sl2b', 'beta', 2)]);
  assert.deepEqual(duplicateLabSlots(c), []);
  assert.deepEqual(kinds(c).filter(k => k === 'duplicate-lab' || k === 'invalid-layer'), []);
  assert.deepEqual(layerProblems(c, 'sl.json'), []);
  assert.equal(panelLabCount(c), 2, 'alpha twice and beta: two labs');
  assert.equal(labOf(c.seats.critics[0]), labOf(c.seats.critics[1]));
});

test('SL-3 STAYS REFUSED: two DIFFERENT models under one lab (same layer or not), a repeat in a panel that is not layered, a key that equals another lab, and a seat without a whole-number layer', () => {
  const differentSameLayer = chainOf([judge('o', 'sl3a', 'alpha', 1), judge('o', 'sl3b', 'alpha', 1)]);
  assert.ok(kinds(differentSameLayer).includes('duplicate-lab') && kinds(differentSameLayer).includes('invalid-layer'), kinds(differentSameLayer).join());
  const different = chainOf([judge('o', 'sl3c', 'alpha', 1), judge('o', 'sl3d', 'alpha', 2)]);
  assert.ok(kinds(different).includes('duplicate-lab'), kinds(different).join());
  const flat = chainOf([judge('o', 'sl3e', 'alpha'), judge('o', 'sl3e', 'alpha')]);
  assert.ok(kinds(flat).includes('duplicate-lab'), kinds(flat).join());
  const clash = chainOf([judge('o', 'sl3f', 'alpha', 1), judge('o', 'sl3f', 'alpha', 1), judge('o', 'sl3g', 'alpha-l1-2', 2)]);
  assert.ok(kinds(clash).includes('duplicate-lab') || kinds(clash).includes('invalid-layer') || duplicateLabSlots(clash).length > 0 || repeatedModelKeys(clash.seats.critics.slice(0, 2), ['alpha-l1-2']) === null, 'a key equal to another lab is refused');
  assert.equal(repeatedModelKeys(clash.seats.critics.slice(0, 2), ['alpha-l1-2']), null);
  assert.equal(repeatedModelKeys([judge('o', 'sl3h', 'alpha', 1), judge('o', 'sl3h', 'alpha', 1.5)]), null, 'a layer that is not a whole number');
});

test('SL-4 THE RUN KEEPS TWO SEATS OF ONE MODEL ON ONE LAYER APART: two stage labels, two verdicts, two seat records, one signs off and one objects (red before: the chain was refused)', async () => {
  const c = chainOf([judge('ox', 'sl4', 'alpha', 1), judge('ox', 'sl4', 'alpha', 1), judge('o', 'sl4b', 'beta', 2)]);
  const { r } = await go(c);
  const labels = r.stages.map(s => s.label).filter(l => /^panel-1-/.test(l)).sort();
  assert.deepEqual(labels, ['panel-1-alpha', 'panel-1-alpha-l1-2', 'panel-1-beta'].filter(l => labels.includes(l)), labels.join());
  assert.ok(labels.includes('panel-1-alpha') && labels.includes('panel-1-alpha-l1-2'), `both seats have their own stage label: ${labels.join()}`);
  const byKey = new Map(r.panelVerdicts.filter(v => v.lab === 'alpha').map(v => [v.seat ?? 'alpha', v.verdict]));
  assert.deepEqual([...byKey.keys()].sort(), ['alpha', 'alpha-l1-2'], 'two verdict records, the second carries its seat key');
  assert.deepEqual([...byKey.values()].sort(), ['objected', 'signed_off'], 'one seat signed off and the other objected: the verdicts did not merge');
  assert.equal(new Set(r.signoff.filter(s => s.lab === 'alpha').map(s => s.seat_index)).size, 2, 'each seat has its own index');
});

test('SL-5 A RESUME REPLAYS EACH SEAT ITS OWN REPLY: the saved panel stages replay under their own labels with the same verdicts, and no call is made again', async () => {
  const c = chainOf([judge('ox', 'sl5', 'alpha', 1), judge('ox', 'sl5', 'alpha', 1), judge('o', 'sl5b', 'beta', 2)]);
  const shape = r => r.stages.filter(s => /^panel-1-/.test(s.label)).map(s => [s.label, s.lab, s.seat ?? null, s.text]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const { r } = await go(c);
  const first = shape(r);
  assert.equal(first.length, 2, "the two alpha seats are the layer-1 stages (beta sits on layer 2)");
  const saved = new Map(r.stages.map(s => [s.label, { text: s.text, usage: s.usage, provider: s.provider, model: s.model, promptHash: s.promptHash }]));
  setCache({ get: l => saved.get(l) ?? null });
  try {
    const again = await go(c);
    assert.ok(again.r.stages.filter(s => /^panel-1-/.test(s.label)).every(s => s.cached), 'the panel stages replayed');
    assert.deepEqual(shape(again.r), first, 'each seat got its own saved reply back');
  } finally { setCache(null); }
});

test('SL-6 THE DRY RUN NEVER GIVES TWO SEATS ONE ROW: a second seat of one model on one layer is `<lab>-<n>` in every row label; a chain with one model once per layer keeps its labels', () => {
  const mini = JSON.parse(readFileSync(join(root, 'chains', 'plan-mini-council.json'), 'utf8'));
  const labelsOf = cfg => estimateChainRows(cfg, { maximum: true }).map(r => r.label);
  const base = labelsOf(mini);
  assert.equal(base.filter(l => l === 'panel-L1-haiku5.5').length, 1, 'shipped: one Haiku row');
  const twice = structuredClone(mini);
  const haiku = twice.seats.critics.find(s => s.lab === 'haiku5.5');
  twice.seats.critics.push({ ...structuredClone(haiku) });
  const after = labelsOf(twice);
  for (const l of ['panel-L1-haiku5.5', 'panel-L1-haiku5.5-2', 'panel-L1-haiku5.5-reask', 'panel-L1-haiku5.5-2-reask']) assert.equal(after.filter(x => x === l).length, 1, `${l} appears once`);
  assert.ok(after.some(l => /^ldebate-L1-haiku5\.5-2$/.test(l) || /^lpost-L1-haiku5\.5-2$/.test(l) || /-L1-haiku5\.5-2$/.test(l)), 'the exchange rows of the second seat are labelled apart too');
  const dup = after.filter((l, i) => after.indexOf(l) !== i && /^(panel|ldebate|lreply|post|reply)/.test(l));
  assert.deepEqual([...new Set(dup)].filter(l => /haiku5\.5/.test(l)), [], 'no label of the two Haikus is shared');
  for (const l of base) assert.ok(after.includes(l), `${l}: every label of the shipped chain is still there`);
  assert.equal(SK.sameLayerOrdinals(mini.seats.critics).size, 0, 'a chain with no repeated model has no ordinals');
  assert.deepEqual([...SK.sameLayerOrdinals(twice.seats.critics).values()].sort(), [1, 2]);
  assert.equal(repeatedLabsOf(twice.seats.critics).filter(r => r.keys).length, 1);
});
