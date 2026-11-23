// A1 (Astra / C&C order of 20 Okt): the dissent block at the top of the deliverable names a repeated model's LAYER, in the shape of the reviser's approved "Raised by: <model> (layer N)" line (roles.js:248);
// a lab on one layer reads exactly as before. One MOCK run, offline, $0: the LI-5 chain of test/lab-identity.test.js (model "alpha" on layers 1 and 2, layer 2 objects; "beta" a holdout on layer 2).
import test from 'node:test';
import assert from 'node:assert/strict';

test('DL-1: a model on two layers shows "(layer 2)" in the dissent block; a lab on one layer is byte-identical; no seat key leaks', async () => {
  const { runChain } = await import('../src/chain.js');
  const judge = (id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-oxoxoxoxox-${id}`, lab, layer });
  const config = {
    name: 'dissent-layer-test', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [judge('dl1', 'alpha', 1), judge('dl1', 'alpha', 2), { provider: 'mock', model: 'mock-critic-holdout', lab: 'beta', layer: 2 }] },
    dispute: { enabled: true, stall_rounds: 3 }, answer_back: { enabled: true },   // CHANGED (0.8.4 S5 U-C fix-up, 08 Nov 2026). OLD: maxRounds 4, stall_rounds 2 (the run ended in round 2 by the stall rule). NEW: maxRounds 2, stall_rounds 3: the same two rounds, ended by the round cap. WHY: layer 2 is the top layer, so a stall there is now a stop for the person, not an ending; a window of 3 cannot be reached in two passes. (Same change as LI-5's chain in lab-identity.test.js.)
  };
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-dl', config });
  const lines = [...(r.deliverable ?? '').matchAll(/\*Raised by [^\n]*/g)].map(m => m[0]);
  assert.ok(lines.includes('*Raised by alpha (layer 2), round 1, never resolved.*'), lines.join(' | '));
  assert.ok(lines.includes('*Raised by beta, round 1, never resolved.*'), 'a lab on one layer reads exactly as before: ' + lines.join(' | '));
  assert.ok(!/alpha-l\d/.test(r.deliverable), 'the internal seat key does not leak');
});
