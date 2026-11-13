// 0.8.4 S7c, commit 3 (money; W41): the MAXIMUM figure of a lower-layer seat's review also carries the section that shows it the top layer's reasons for an objection of its that the top layer overruled: 400 input tokens per top-layer judge (K3), per call, on the seat's review row,
// its in-pass re-ask row and (on a chain without overseer rounds) its per-pass rows. The expected figure never moves. $0, offline: estimateChainRows over the shipped layered chains (cloned with answer_back switched on).
// NOT DRIVEN (named): the unit is an approximation (400 per reason, one objection per seat; the real bound is K3 x the ruling call's output cap per ruling, and reasons are shown whole); the per-call gain is an upper bound (the section shows once per block).
// CHANGED ACCEPTED TEST (0.8.4 apply, group 7, C&C RULING_STEP5_6 C, D, G; the printed facts: job 97). Every sentence these rows held back (the stall words, the go-up words, the rating demand, the W41 section, the three S8 sorting words) is RECORDED in src/roles.js and in force in every shipped run: the rows read the
// RECORDED state, no held map. OLD: RS-S7c-1 "ONLY the layer-2 rows gain 400 x K3" (go-up route) and RS-S7c-2 "every lower-layer review row gains 400 x K3" (stall route, dispute.enabled), each against a map that set the other route's names to `undefined`; RS-S7c-3 "the section alone, the stall words without dispute.enabled, or no answer_back:
// nothing moves" and RS-S7c-4 "the stall gate: the demand NOT recorded -> unchanged" on the same maps. NEW (RS-S7c-1, RS-S7c-2): on the recorded state EVERY seat below the top layer gains the top layer's reasons section (400 x K3) by the SORTING route, whatever the stall and go-up gates say (the section needs only answer_back, a layered chain of two layers
// or more and the section recorded), the second layer of three also gains 400 x K1, and the top layer gains its sort list: the per-call gain of every panel row is derived BY TERM (test/helpers/layer-gains.js), in both shapes; the figure is independent of dispute.enabled. The REAL off is answer_back removed: every gain is zero. RS-S7c-3 and RS-S7c-4 are REMOVED (G, C): RS-S7c-3 compared equal figures on a banned map (green for the wrong reason, a duplicate of the real-off assertion below) and RS-S7c-4's first half could not be built without a map that sets a recorded name to undefined.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateChainRows } from '../src/cost.js';
import { shippedOverseerChains, withAnswerBack, withoutAnswerBack, noOverseer, layersOf, rowGain, noLedgerGain, rowTimes, panelRows } from './helpers/layer-gains.js';

const shipped = shippedOverseerChains();

test('RS-S7c-1: every panel row of the MAXIMUM gains its layer\'s sections by term (layer 1: 400 x K3; layer 2 of three: 400 x (K3 + K1); layer 3: 400 x (K1 + K2)), times n x (visits of its layer), in both shapes; the expected figure never moves; answer_back removed moves nothing', () => {
  assert.ok(shipped.length >= 7, `the shipped layered chains were found (${shipped.length})`);   // CHANGED ACCEPTED TEST (0.8.4 seats and retirements unit): OLD bar 8. NEW bar: 7 (seven planning chains left after the three retirements and the China mini). WHY: the count moves with the thing it counts
  let checked = 0; let priced = 0;
  for (const base of shipped) for (const [shape, c] of [['overseer rounds', withAnswerBack(base)], ['no overseer rounds', withAnswerBack(noOverseer(base))]]) {
    const { K } = layersOf(c);
    const rows = panelRows(c);
    assert.ok(rows.length > 0, `${c.name} (${shape}): panel rows found`);
    for (const r of rows) {
      assert.equal(r.perCall - r.expPerCall, rowGain(c, r), `${c.name} (${shape}): ${r.label} gains by term (layer ${r.layer}; K1 ${K[1]}, K2 ${K[2]}, K3 ${K[3]})`);
      if (shape === 'overseer rounds') assert.equal(r.times, rowTimes(c, r.kind === 'reask3' ? layersOf(c).top : r.layer, r.kind === 'reask3' ? 'review' : r.kind), `${c.name}: ${r.label} times`);
      checked++; if (r.priced && r.usd > 0) priced++;
    }
    // the expected figure never moves: it carries no gain (the maximum rows are the only ones that do)
    const ex = estimateChainRows(c, { maximum: false }); const exOff = estimateChainRows(withoutAnswerBack(c), { maximum: false });
    assert.deepEqual(ex.map(r => r.label), exOff.map(r => r.label), `${c.name} (${shape}): the same expected rows with and without answer_back`);
    // the REAL off: no ledger -> no gain on any panel row
    for (const r of panelRows(withoutAnswerBack(c))) assert.equal(r.perCall - r.expPerCall, noLedgerGain(r), `${c.name} (${shape}): ${r.label}: answer_back off -> no section gain (the top seat's -reask3 keeps its one note)`);
  }
  assert.ok(checked > 0 && priced > 0, 'at least one priced panel row was checked (this row can fail)');
});

test('RS-S7c-2: the gains do not depend on dispute.enabled (the sorting route needs no dispute stage): the same per-call gains with the dispute stage on and off, in both shapes', () => {
  let compared = 0;
  for (const base of shipped) for (const shape of [c0 => c0, noOverseer]) {
    const on = withAnswerBack(shape({ ...base, dispute: { ...(base.dispute || {}), enabled: true } })); const off = withAnswerBack(shape({ ...base, dispute: { ...(base.dispute || {}), enabled: false } }));
    const a = panelRows(on); const b = panelRows(off);
    assert.deepEqual(a.map(r => [r.label, r.perCall - r.expPerCall]), b.map(r => [r.label, r.perCall - r.expPerCall]), `${base.name}: dispute on and off gain the same per call`);
    compared += a.length;
  }
  assert.ok(compared > 0, 'rows were compared (this row can fail)');
});

// RS-S7c-3 and RS-S7c-4: REMOVED, see the header (C&C G and C): RS-S7c-3 compared equal figures on a held-off map; RS-S7c-4's first half ("the demand NOT recorded: unchanged") cannot be built without setting a recorded name to undefined, and its control ("with the demand recorded the section is priced") is RS-S7c-1.
