// The layered review panel (0.8.3; contract Review/Build_0.8.3/m6-closing/Layered_Panel_Contract.md, gate page E2_Gate_Page.md): seats.critics[].layer. A layer is asked only when every seat of the
// layers below it signed off on the SAME draft; any objection ends the climb, the reviser gets the union, the next round starts at layer 1. Offline, mock seats only, $0. The judges are the scripted mocks
// `mock-critic-script-<pattern>-<suffix>` (src/providers.js: one character per ask of that model string, `x` objects and `o` signs off, the last character repeating): each test gives its models its own
// suffix, because the counters live in the process.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setCache, setBudget, setProgressHook, ExternalPause, BudgetExceeded } from '../src/chain.js';
import { computeOutcome } from '../src/outcome.js';
import { estimateChainRows } from '../src/cost.js';
import { layersHeadline } from '../src/layers.js';
import { renderLayersBoard, reportJsonShape } from '../src/report-shape.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
afterEach(() => { setCache(null); setBudget(null); setProgressHook(null); });

const script = (pattern, id) => `mock-critic-script-${pattern}-${id}`;
const judge = (pattern, id, lab, layer, extra = {}) => ({ provider: 'mock', model: script(pattern, id), lab, ...(layer === undefined ? {} : { layer }), ...extra });
const chainOf = (critics, extra = {}) => ({
  name: 'layered-test', maxRounds: 3, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
const go = async (config, opts = {}) => {
  const lines = [];
  const r = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-layered', ...opts, config });
  return { r, log: lines.join('\n') };
};
const stageLabels = r => r.stages.map(s => s.label);
const states = (r, round) => {
  assert.ok(Array.isArray(r.layers), 'the result carries no layers[] (a layered chain must record one row per round per layer)');
  return r.layers.filter(x => x.round === round).map(x => `${x.layer}:${x.state}`);
};
const PASSER = { freedoms: { pass: true } };

test('layers: an objection at layer 1 ends the climb; layers 2 and 3 are recorded not_asked and have no stage', async () => {
  const { r, log } = await go(chainOf([judge('x', 'a1', 'l1', 1), judge('o', 'a2', 'l2', 2), judge('o', 'a3', 'l3', 3)], { maxRounds: 1 }));
  assert.deepEqual(states(r, 1), ['1:objected', '2:not_asked', '3:not_asked']);
  assert.match(log, /layer 1 did not sign off \(a seat objected\); the layers above it are not asked this round\./);
  assert.match(log, /layers 2, 3 were never asked in the final round - this is NOT agreement\./);
  assert.equal(r.passed, false);
  assert.deepEqual(stageLabels(r).filter(l => l.startsWith('panel-')), ['panel-1-l1'], 'only layer 1 was asked');
  assert.deepEqual(r.signoff.map(s => [s.lab, s.layer]), [['l1', 1]], 'signoff[] lists asked seats only, each with its layer');
  assert.deepEqual(r.panelVerdicts.map(v => [v.lab, v.layer, v.verdict]), [['l1', 1, 'objected']]);
  assert.equal(computeOutcome(r), 'no_consensus', 'an objection at layer 1 with layers above it unasked is not "degraded"');
});

test('layers: a clean climb asks layer 1, then 2, then 3, and passes only when every layer signed off on one draft', async () => {
  const { r } = await go(chainOf([judge('o', 'b1', 'l1', 1), judge('o', 'b2', 'l2', 2), judge('o', 'b3', 'l3', 3), judge('o', 'b4', 'l4', 3)]));
  assert.equal(r.passed, true);
  assert.deepEqual(states(r, 1), ['1:signed_off', '2:signed_off', '3:signed_off']);
  assert.deepEqual(stageLabels(r).filter(l => l.startsWith('panel-')).sort(), ['panel-1-l1', 'panel-1-l2', 'panel-1-l3', 'panel-1-l4']);
  assert.equal(computeOutcome(r), 'consensus');
  assert.equal(layersHeadline(r.layers), 'every layer signed off (layer 1: 1 lab, layer 2: 1 lab, layer 3: 2 labs)');
});

test('layers: the next round starts at layer 1 again; a holdout at layer 2 repeats while layer 3 is never asked, and the cap line says so', async () => {
  const { r, log } = await go(chainOf([judge('o', 'c1', 'l1', 1), judge('x', 'c2', 'l2', 2), judge('o', 'c3', 'l3', 3)], { maxRounds: 3 }));
  assert.equal(r.passed, false);
  for (const round of [1, 2, 3]) assert.deepEqual(states(r, round), ['1:signed_off', '2:objected', '3:not_asked'], `round ${round}`);
  assert.equal(stageLabels(r).filter(l => l === 'panel-3-l1').length, 1, 'layer 1 is asked again in every round');
  assert.ok(!stageLabels(r).some(l => /^panel-\d-l3/.test(l)), 'layer 3 was never asked');
  assert.match(log, /layer 3 was never asked in the final round - this is NOT agreement\./);
  assert.match(layersHeadline(r.layers), /^round 3: layer 1 signed off, layer 2 objected, layer 3 was never asked - not agreement$/);
});

test('layers: a seat not heard blocks the climb; the next round carries every heard clean verdict of the layers already asked and pays only for the unheard seat', async () => {
  const critics = [judge('o', 'd1', 'l1', 1), judge('o', 'd2', 'l2', 2), { provider: 'mock', model: 'mock-unreadable', lab: 'l2b', layer: 2 }, judge('o', 'd3', 'l3', 3)];
  const { r, log } = await go(chainOf(critics, { maxRounds: 2 }));
  assert.deepEqual(states(r, 1), ['1:signed_off', '2:unheard', '3:not_asked']);
  assert.deepEqual(states(r, 2), ['1:signed_off', '2:unheard', '3:not_asked']);
  const l1round2 = r.layers.find(x => x.round === 2 && x.layer === 1);
  assert.deepEqual(l1round2.carried, [{ lab: 'l1', from_round: 1 }], 'layer 1 stands on its round-1 verdict');
  assert.ok(!stageLabels(r).includes('panel-2-l1'), 'layer 1 was not asked again on the unchanged draft');
  assert.ok(!stageLabels(r).includes('panel-2-l2'), 'nor the heard seat of layer 2');
  assert.match(log, /carrying over the verdicts of l1, l2 on this same text; asking only l2b/);
  assert.deepEqual(r.panelVerdicts.filter(v => v.round === 2 && v.carried).map(v => [v.lab, v.from_round]), [['l1', 1], ['l2', 1]]);
  assert.equal(r.passed, false);
});

test('layers: a layer in which nobody gave a verdict (only stated passes) stops the run; the reviser is never entered', async () => {
  const critics = [judge('o', 'e1', 'l1', 1), { provider: 'mock', model: 'mock-critic-passer', lab: 'l2', layer: 2 }, { provider: 'mock', model: 'mock-critic-passer', lab: 'l2b', layer: 2 }, judge('o', 'e3', 'l3', 3)];
  const { r, log } = await go(chainOf(critics, { ...PASSER, dispute: { enabled: true } }));
  assert.deepEqual(states(r, 1), ['1:signed_off', '2:abstained', '3:not_asked']);
  assert.deepEqual(r.layerStop, { round: 1, layer: 2, reason: 'only_stated_passes', labs: ['l2', 'l2b'] });
  assert.equal(r.passed, false);
  assert.ok(!stageLabels(r).some(l => l.startsWith('revise-')), 'nothing to revise against');
  assert.match(log, /round 1, layer 2: nobody gave a verdict \(only stated passes\) - there is nothing to revise against\. Stopping the loop; this is not agreement\./);
  assert.equal(r.dispute.reason, 'layer_not_signed_off');
  assert.equal(computeOutcome(r), 'degraded');
});

test('layers: the top layer needs an explicit sign-off from every seat; a stated pass there stops the run as not agreement', async () => {
  const critics = [judge('o', 'f1', 'l1', 1), judge('o', 'f2', 'l2', 2), { provider: 'mock', model: 'mock-critic-passer', lab: 'l2b', layer: 2 }];
  const { r, log } = await go(chainOf(critics, PASSER));
  assert.deepEqual(states(r, 1), ['1:signed_off', '2:abstained']);
  assert.deepEqual(r.layerStop, { round: 1, layer: 2, reason: 'top_layer_not_explicit', labs: ['l2b'] });
  assert.equal(r.passed, false, 'one overseer signing off and the other stating a pass is not a pass');
  assert.match(log, /layer 2 \(the top layer\): l2b did not sign off explicitly \(stated a pass\)\. The top layer needs an explicit sign-off from every seat\./);
  assert.notEqual(computeOutcome(r), 'consensus');
});

test('layers: with a single layer a stated pass is clean, exactly as in the unlayered panel', async () => {
  const mk = layer => chainOf([judge('o', 'g1', 'l1', layer), { provider: 'mock', model: 'mock-critic-passer', lab: 'l2', ...(layer === undefined ? {} : { layer }) }], PASSER);
  const flat = await go(mk(undefined));
  const one = await go(mk(1));
  assert.equal(flat.r.passed, true);
  assert.equal(one.r.passed, true);
  assert.deepEqual(states(one.r, 1), ['1:signed_off']);
  assert.equal(one.r.layerStop, undefined);
});

test('layers: the dispute stage carries the still-open objection of a lab whose layer was not asked in the final round', async () => {
  // Round 1: layer 1 clean, layer 2 objects. Rounds 2 and 3: layer 1 objects, so layer 2 is not asked. Layer 2's round-1 objection may still be open against the final draft.
  const { r } = await go(chainOf([judge('oxx', 'h1', 'l1', 1), judge('x', 'h2', 'l2', 2)], { maxRounds: 3, dispute: { enabled: true, stall_rounds: 9 } }));
  assert.deepEqual(states(r, 3), ['1:objected', '2:not_asked']);
  const carried = r.dispute.open_objections.filter(o => o.not_asked_in_final_round);
  assert.deepEqual(carried.map(o => [o.lab, o.last_raised_round]), [['l2', 1]]);
  assert.ok(r.dispute.open_objections.some(o => o.lab === 'l1' && !o.not_asked_in_final_round), 'layer 1 objects in the final round itself');
});

test('layers: a lab whose later heard verdict signed off is NOT carried as open; one whose latest heard verdict objected is', async () => {
  // Round 1: layer 2 objects. Round 2: layer 2 signs off (its round-1 objection is closed) and layer 3 objects. Round 3: layer 1 objects, so layers 2 and 3 are not asked.
  const { r } = await go(chainOf([judge('oox', 'i1', 'l1', 1), judge('xo', 'i2', 'l2', 2), judge('x', 'i3', 'l3', 3)], { maxRounds: 3, dispute: { enabled: true, stall_rounds: 9 } }));
  assert.deepEqual(states(r, 3), ['1:objected', '2:not_asked', '3:not_asked']);
  assert.deepEqual(r.dispute.open_objections.filter(o => o.not_asked_in_final_round).map(o => [o.lab, o.last_raised_round]), [['l3', 2]], 'l2 signed off in round 2, so only l3 is carried');
});

test('layers: estimateChainRows is the same with and without layers, in both modes (a layered round asks each seat at most once)', () => {
  const critics = [judge('o', 'j1', 'l1', 1), judge('o', 'j2', 'l2', 2), judge('o', 'j3', 'l3', 3)];
  const layered = chainOf(critics);
  const flat = chainOf(critics.map(({ layer, ...c }) => c));
  for (const maximum of [false, true]) assert.deepEqual(estimateChainRows(layered, { maximum }), estimateChainRows(flat, { maximum }), `maximum=${maximum}`);
});

test('layers: runChain itself refuses what the lint refuses; nothing runs a chain with `layer` keys flat', async () => {
  const two = [judge('o', 'k1', 'l1', 1), judge('o', 'k2', 'l2', 2)];
  const cases = {
    relay: chainOf(two, { panel: 'relay' }),
    quorum: chainOf(two, { quorum: { minHeard: 1 } }),
    first: chainOf(two, { signoff: 'first' }),
    descending: chainOf(two, { descending: { enabled: true } }),
    advise: chainOf(two, { advise: { enabled: true } }),
    'half layered': chainOf([judge('o', 'k3', 'l1', 1), judge('o', 'k4', 'l2')]),
    'a gap': chainOf([judge('o', 'k5', 'l1', 1), judge('o', 'k6', 'l2', 3)]),
    'one lab on two layers': chainOf([judge('o', 'k7', 'same', 1), judge('o', 'k8', 'same', 2)]),
    'layer outside the panel': { ...chainOf(two), seats: { ...chainOf(two).seats, builder: { provider: 'mock', model: 'mock-builder', lab: 'author', layer: 1 } } },
  };
  for (const [name, config] of Object.entries(cases)) {
    await assert.rejects(() => go(config), /layer|lab/i, name);
  }
  const ok = await go(chainOf(two, { maxRounds: 1 }));
  assert.ok(Array.isArray(ok.r.layers), 'a valid layered chain is not refused and records layers[]');
  // EDITED ACCEPTED ASSERTION (E3, 14 Oct 2026, disclosed): `answer_back` was in the refused cases above (/layer|lab/i); E3 retains answer-back across the layers, so runChain accepts the combination.
  const withAnswerBack = await go(chainOf(two, { maxRounds: 1, answer_back: { enabled: true } }));
  assert.ok(Array.isArray(withAnswerBack.r.layers), 'a layered chain with answer_back runs and records layers[]');
});

test('layers: the real CLI refuses a layered chain that breaks a layer rule (exit 1, the lint line), accepts one with answer_back, and runs mock-layered end to end', () => {
  const work = mkdtempSync(join(tmpdir(), 'layered-cli-'));
  mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'task.md'), 'Write a one-paragraph plan for a bake sale.\n');
  const bad = JSON.parse(readFileSync(join(root, 'chains', 'mock-layered.json'), 'utf8'));
  // EDITED ACCEPTED ASSERTION (E3, 14 Oct 2026, disclosed): this chain used to be made bad with `answer_back = { enabled: true }` (refused, /answer_back/); that combination is accepted now, so the real-CLI refusal pin uses a quorum, which stays refused.
  bad.quorum = { minHeard: 1 };
  writeFileSync(join(work, 'chains', 'bad.json'), JSON.stringify(bad));
  const refused = spawnSync(process.execPath, [cli, '--task', 'task.md', '--chain', 'bad'], { cwd: work, encoding: 'utf8' });
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /quorum/);
  const withAnswerBack = JSON.parse(readFileSync(join(root, 'chains', 'mock-layered.json'), 'utf8'));
  withAnswerBack.answer_back = { enabled: true };
  writeFileSync(join(work, 'chains', 'ab.json'), JSON.stringify(withAnswerBack));
  const abRun = spawnSync(process.execPath, [cli, '--task', 'task.md', '--chain', 'ab'], { cwd: work, encoding: 'utf8' });
  // 0.8.3 exit 22: a finished run whose mock panel did not agree exits 22; this test is not about agreement (exit-not-agreed.test.js pins the rule), so it accepts the two finished exits.
  assert.ok([0, 22].includes(abRun.status), abRun.stdout + abRun.stderr);
  const okRun = spawnSync(process.execPath, [cli, '--task', 'task.md', '--chain', 'mock-layered'], { cwd: work, encoding: 'utf8' });
  assert.equal(okRun.status, 0, okRun.stdout + okRun.stderr);
  const runDir = join(work, 'runs', readdirSync(join(work, 'runs')).sort().pop());
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.ok(Array.isArray(report.layers), 'report.json carries no layers[]');
  assert.deepEqual(report.layers.filter(x => x.round === 1).map(x => `${x.layer}:${x.state}`), ['1:objected', '2:not_asked', '3:not_asked'], 'round 1 stops at layer 1');
  assert.deepEqual(report.layers.filter(x => x.round === 2).map(x => `${x.layer}:${x.state}`), ['1:signed_off', '2:signed_off', '3:signed_off'], 'round 2 climbs through all three');
  assert.equal(report.passed, true);
  const board = readFileSync(join(runDir, 'BOARD.md'), 'utf8');
  assert.match(board, /## Panel layers/);
  assert.match(board, /\| 1 \| 2 \| mock-c, mock-d \| not asked/);
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  assert.ok(existsSync(join(runDir, 'deliverable.md')));
});

test('layers: a spend stop between layers keeps layers[] in the partial record (the layer being asked is unfinished, the next not_asked)', async () => {
  const critics = [judge('o', 'l1x', 'l1', 1), { provider: 'mock', model: 'mock-priced', lab: 'l2', layer: 2, maxTokens: 8000 }, judge('o', 'l3x', 'l3', 3)];
  setBudget(1);
  const err = await go(chainOf(critics, { maxRounds: 1 })).then(() => null, e => e);
  assert.ok(err instanceof BudgetExceeded, String(err));
  assert.ok(Array.isArray(err.partial?.layers), 'the partial record carries no layers[]');
  assert.deepEqual(err.partial.layers.map(x => `${x.layer}:${x.state}`), ['1:signed_off', '2:unfinished', '3:not_asked']);
});

test('layers: an external seat in layer 2 pauses the run there; the resumed climb replays layer 1 from disk and records the same layers', async () => {
  const PASS = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });
  const config = () => chainOf([judge('o', 'm1', 'l1', 1), { provider: 'external', model: 'claude-code-session', lab: 'ext', layer: 2 }, judge('o', 'm3', 'l3', 3)], { maxRounds: 1 });
  const saved = new Map();
  const paused = await go(config(), { onStage: s => saved.set(s.label, s) }).then(() => null, e => e);
  assert.ok(paused instanceof ExternalPause, String(paused));
  assert.equal(paused.label, 'panel-1-ext');
  assert.ok(saved.has('panel-1-l1') && !saved.has('panel-1-l3'), 'layer 1 ran; layer 3 did not start');
  setCache({ get: label => saved.get(label) ?? (label === 'panel-1-ext' ? { text: PASS, provider: 'external', model: 'claude-code-session', usage: { input: 0, output: 0 }, usd: 0, promptHash: paused.promptHash } : null) });
  const { r } = await go(config());
  assert.deepEqual(states(r, 1), ['1:signed_off', '2:signed_off', '3:signed_off']);
  assert.equal(r.passed, true);
  assert.equal(r.stages.find(s => s.label === 'panel-1-l1').cached, true, 'layer 1 was replayed from disk, not asked again');
  assert.equal(r.stages.find(s => s.label === 'panel-1-l3').cached, undefined, 'layer 3 is a new call');
});

test('layers: round-end fires once per layered round with the labs actually asked, and never on an unlayered chain', async () => {
  const events = [];
  setProgressHook(e => { if (e.kind === 'round-end') events.push(e); });
  await go(chainOf([judge('x', 'n1', 'l1', 1), judge('o', 'n2', 'l2', 2)], { maxRounds: 1 }));
  assert.deepEqual(events, [{ kind: 'round-end', round: 1, labs: ['l1'] }]);
  events.length = 0;
  await go(chainOf([judge('o', 'n3', 'l1'), judge('o', 'n4', 'l2')]));
  assert.deepEqual(events, [], 'an unlayered chain emits no round-end');
});

test('layers: an unlayered report carries none of the layered fields', async () => {
  const { r } = await go(chainOf([judge('x', 'o1', 'l1'), judge('o', 'o2', 'l2')], { maxRounds: 2 }));
  assert.equal(r.layers, undefined);
  assert.equal(r.layerStop, undefined);
  assert.ok(r.signoff.every(s => !('layer' in s)));
  assert.ok(r.panelVerdicts.every(v => !('layer' in v) && !('from_round' in v)));
  assert.equal(renderLayersBoard(undefined), '');
});

test('layersHeadline and the Panel layers table: every layer is named, a layer never asked is a row', () => {
  assert.equal(layersHeadline(undefined), null);
  assert.equal(layersHeadline([]), null);
  const rows = [
    { round: 1, layer: 1, labs: ['a'], state: 'objected' }, { round: 1, layer: 2, labs: ['b', 'c'], state: 'not_asked' },
    { round: 2, layer: 1, labs: ['a'], state: 'signed_off' }, { round: 2, layer: 2, labs: ['b', 'c'], state: 'abstained' }, { round: 2, layer: 3, labs: ['d'], state: 'not_asked' },
  ];
  assert.equal(layersHeadline(rows), 'round 2: layer 1 signed off, layer 2 gave no usable verdict, layer 3 was never asked - not agreement');
  const table = renderLayersBoard(rows, { round: 2, layer: 2, reason: 'only_stated_passes', labs: ['b', 'c'] });
  assert.match(table, /^## Panel layers/);
  assert.match(table, /\| 1 \| 2 \| b, c \| not asked \(a layer below did not sign off\) \|/);
  assert.match(table, /nobody in it gave a verdict, only stated passes\. This is not agreement\./);
});

test('layers: report.json\'s shape carries the layers of a layered run', async () => {
  const critics = [judge('o', 'p1', 'l1', 1), judge('o', 'p2', 'l2', 2)];
  const { r } = await go(chainOf(critics, { maxRounds: 1 }));
  const report = reportJsonShape({ runId: 'r-layered', chain: 'layered-test', task: 'task.md', result: r });
  assert.ok(Array.isArray(report.layers), 'report.json carries no layers[]');
  assert.deepEqual(report.layers.map(x => x.state), ['signed_off', 'signed_off']);
});
