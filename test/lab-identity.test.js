// LAB-IDENTITY unit (19 Okt 2026; Muad 18 Okt 21:08 "a same model in separate seats is ONE lab"; C&C rulings Q1, D1-D3, D7). One model may sit on SEVERAL layers of a LAYERED critics panel: it is one lab for every count (labOf), and each seat has its own seat key
// (lab for the lowest layer, `<lab>-l<layer>` for the others) for stage labels and per-seat records. Offline, mock seats, $0. Plan note: Review/Build_0.8.3/m7/A_Lab_Identity_Plan_Note2.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, duplicateLabSlots, panelLabCount, labOf } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';

const judge = (pattern, id, lab, layer, extra = {}) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, ...(layer === undefined ? {} : { layer }), ...extra });
const chainOf = (critics, extra = {}) => ({
  name: 'lab-identity-test', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
const go = async config => { const lines = []; const r = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-li', config }); return { r, log: lines.join('\n') }; };
const labels = r => r.stages.map(s => s.label).filter(l => l.startsWith('panel-'));
const kinds = c => lintChain(c, 'li.json').map(f => f.kind);

test('LI-1 ONE MODEL ON TWO LAYERS: the lint and the run-time check allow it, the panel counts ONE lab for it, and the run keeps two stage labels, two verdicts and two seat records (red before: duplicate-lab / invalid-layer refuse the chain)', async () => {
  const c = chainOf([judge('o', 'li1', 'alpha', 1), judge('o', 'li1', 'alpha', 2), judge('o', 'li1b', 'beta', 2)]);
  assert.deepEqual(duplicateLabSlots(c), []);
  assert.deepEqual(kinds(c).filter(k => k === 'duplicate-lab' || k === 'invalid-layer'), []);
  assert.equal(panelLabCount(c), 2, 'alpha and beta: a repeated model is ONE lab');
  const { r } = await go(c);
  assert.deepEqual(labels(r).sort(), ['panel-1-alpha', 'panel-1-alpha-l2', 'panel-1-beta']);
  assert.equal(r.passed, true);
  assert.deepEqual(r.signoff.map(s => [s.lab, s.seat ?? null, s.layer]).sort(), [['alpha', null, 1], ['alpha', 'alpha-l2', 2], ['beta', null, 2]]);
  assert.equal(new Set(r.signoff.map(s => s.seat_index)).size, 3, 'each seat has its own index');
  assert.deepEqual(r.panelVerdicts.map(v => [v.lab, v.seat ?? null, v.verdict]).sort(), [['alpha', null, 'signed_off'], ['alpha', 'alpha-l2', 'signed_off'], ['beta', null, 'signed_off']]);
});

test('LI-2 NO REPEATED MODEL, NOTHING MOVES: the key IS the lab string, a verdict record has no `seat` field, the stage labels are the lab labels', async () => {
  const { seatKeyOf } = await import('../src/seat-key.js');
  const c = chainOf([judge('o', 'li2a', 'alpha', 1), judge('o', 'li2b', 'beta', 2)]);
  const { r } = await go(c);
  assert.deepEqual(labels(r).sort(), ['panel-1-alpha', 'panel-1-beta']);
  assert.equal(r.signoff.some(s => 'seat' in s), false); assert.equal(r.panelVerdicts.some(v => 'seat' in v), false);
  for (const s of c.seats.critics) assert.equal(seatKeyOf(s), labOf(s));
});

test('LI-3 EVERYTHING ELSE STAYS REFUSED: two DIFFERENT models under one lab, the same model on the SAME layer, and a repeat in a panel that is not layered', () => {
  const different = chainOf([judge('o', 'li3a', 'alpha', 1), judge('o', 'li3b', 'alpha', 2)]);
  assert.ok(kinds(different).includes('duplicate-lab') && kinds(different).includes('invalid-layer'), kinds(different).join());
  const sameLayer = chainOf([judge('o', 'li3c', 'alpha', 1), judge('o', 'li3c', 'alpha', 1)]);
  assert.ok(kinds(sameLayer).includes('duplicate-lab'), kinds(sameLayer).join());
  const flat = chainOf([judge('o', 'li3d', 'alpha'), judge('o', 'li3d', 'alpha')]);
  assert.ok(kinds(flat).includes('duplicate-lab'), kinds(flat).join());
});

test('LI-4 THE PER-CALL STAGE RECORDS: a fresh call and a replay from the cache both keep the bare lab and add `seat` for the repeated seat only (red before: neither carried `seat`, and a replay carried the key in `lab`)', async () => {
  const { setCache } = await import('../src/chain.js');
  const c = chainOf([judge('o', 'li4', 'alpha', 1), judge('o', 'li4', 'alpha', 2), judge('o', 'li4b', 'beta', 2)]);
  const shape = r => r.stages.filter(s => s.label.startsWith('panel-')).map(s => [s.label, s.lab, s.seat ?? null]).sort();
  const want = [['panel-1-alpha', 'alpha', null], ['panel-1-alpha-l2', 'alpha', 'alpha-l2'], ['panel-1-beta', 'beta', null]];
  const { r } = await go(c);
  assert.deepEqual(shape(r), want, 'fresh call');
  const saved = new Map(r.stages.map(s => [s.label, { text: s.text, usage: s.usage, provider: s.provider, model: s.model, promptHash: s.promptHash }]));
  setCache({ get: l => saved.get(l) ?? null });
  try {
    const again = await go(c);
    assert.ok(again.r.stages.filter(s => s.label.startsWith('panel-')).every(s => s.cached), 'the panel stages replayed');
    assert.deepEqual(shape(again.r), want, 'replay');
  } finally { setCache(null); }
});

// A chain that makes the repeated seat's objection REACH the dispute stage: the model answers sign, object, sign, object ... (one script, asked by both seats in turn: layer 1 always signs, layer 2 always objects), and a holdout on layer 2.
const dispute = () => chainOf([judge('oxoxoxoxox', 'li5', 'alpha', 1), judge('oxoxoxoxox', 'li5', 'alpha', 2), { provider: 'mock', model: 'mock-critic-holdout', lab: 'beta', layer: 2 }], { maxRounds: 4, dispute: { enabled: true, stall_rounds: 2 }, answer_back: { enabled: true } });
const KEY = /\balpha-l\d\b/;
const runWithPrompts = async config => { const prompts = []; setPromptSpy(p => prompts.push(p)); try { return { ...(await go(config)), prompts }; } finally { setPromptSpy(null); } };

test('LI-5 THE SEAT KEY STAYS IN `seat` FIELDS AND STAGE LABELS: no prompt text and no `lab`/`labs` value of the result carries it (red before: layers[].labs, failures and the history named alpha-l2)', async () => {
  const { r, log, prompts } = await runWithPrompts(dispute());
  assert.ok(r.stages.some(s => s.label === 'dispute'), 'precondition: the dispute stage ran');
  const inPrompts = prompts.flatMap(p => [p.system, p.user]).filter(t => typeof t === 'string' && KEY.test(t));
  assert.deepEqual(inPrompts, [], 'a prompt names the internal seat key');
  const hits = [];
  (function walk(o, path) {
    if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}.${i}`));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    else if (typeof o === 'string' && KEY.test(o) && !/\.(seat|seats|label)(\.\d+)?$/.test(path)) hits.push(`${path} = ${o.slice(0, 60)}`);
  })({ ...r, stages: undefined, history: [r.history] }, 'r');
  assert.deepEqual(hits, []);
  assert.deepEqual(log.split('\n').filter(l => KEY.test(l) && !/panel-\d+-alpha-l\d/.test(l)), [], 'the run log names the seat key outside a stage label');
});

test('LI-6 THE DISPUTE PROMPT NAMES THE SEAT MODEL AND, FOR A MODEL ON MORE THAN ONE LAYER, ITS LAYER (3b; Muad 20 Okt: "it should say the model"): the model comes from the seat record, a model on one layer has no layer note, a record with no model reads a fixed fallback (red before: the line printed the lab string)', async () => {
  const { prompts } = await runWithPrompts(dispute());
  const text = prompts.filter(p => p.label === 'dispute').map(p => p.user).join('\n');
  const lines = [...text.matchAll(/Raised by: .*/g)].map(m => m[0]);
  assert.ok(lines.includes('Raised by: mock-critic-script-oxoxoxoxox-li5 (layer 2)'), lines.join(' | '));
  assert.ok(lines.includes('Raised by: mock-critic-holdout'), lines.join(' | '));
  assert.equal(lines.some(l => KEY.test(l) || /undefined/.test(l)), false);
  const { disputeUser } = await import('../src/roles.js');
  assert.match(disputeUser({ request: 'r', criteria: ['c'], draft: 'd', failures: [{ criterion: 'c', problem: 'p', lab: 'alpha' }] }), /Raised by: \(model not recorded\)/);
});

test('LI-7 A REPEATED SEAT KEEPS ITS OPEN OBJECTION (gates count per seat, D7): a layer 2 seat that objected and was not asked in the final round is still an open objection, recorded with the bare lab and its `seat` (red before: the end-of-run lookups compared the bare lab with the seat key and dropped it)', async () => {
  const c = chainOf([judge('oxx', 'li7', 'alpha', 1), judge('oxx', 'li7', 'alpha', 2)], { maxRounds: 2, dispute: { enabled: true, stall_rounds: 3 } });
  const { r } = await go(c);
  assert.equal(r.passed, false);
  const open = r.dispute.open_objections.filter(o => o.not_asked_in_final_round);
  assert.deepEqual(open.map(o => [o.lab, o.seat ?? null]), [['alpha', 'alpha-l2']], JSON.stringify(r.dispute.open_objections));
});
