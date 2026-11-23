// 0.8.4 M1 COMPLETE, unit U2, commit U2-3 (money): what the automatic go-up at layer 1's revision bound adds to the MAXIMUM figure. (1) the layer-2 RULING calls at the bound: one row per layer-2 seat, `rule-bound-L<layer>-<seat>`, n x (b2 + 1) times, sized like the seat's review plus about 400 tokens per layer-1 judge;
// (2) the REVIVAL of S7c's W41 reach: in a chain of EXACTLY TWO layers the go-up lands on the top layer, so the layer-1 review rows also carry the top layer's reasons section (400 x K2). The expected figure never moves. $0, offline: estimateChainRows over the shipped layered chains.
// CHANGED ACCEPTED TEST (0.8.4 apply, group 7, C&C RULING_STEP5_6 C, D, F, G). Every name these rows once held back (the ruling sentences, the go-up line, the rating demand) is RECORDED in src/roles.js and is in force in every shipped run, so the rows read the RECORDED state: no held map. OLD: the rows ran on
// maps that set the three go-up ruling names to `undefined` (a state that no longer exists), compared the figure with and without the go-up line, and carried negatives built on those maps. NEW: the figures are DERIVED BY TERM from the chain's own seat counts (test/helpers/layer-gains.js) and the REAL offs
// are kept (answer_back removed, no overseer rounds). The sibling that pins the same figures with every name recorded is these rows. GC-3 is REMOVED (OLD/NEW/WHY at its place).
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateChainRows, estimateTokens, DEFAULT_ESTIMATE } from '../src/cost.js';
import * as R from '../src/roles.js';
import { shippedOverseerChains, withAnswerBack, withoutAnswerBack, noOverseer, twoLayers, layersOf, rowGain, noLedgerGain, panelRows } from './helpers/layer-gains.js';

const shipped = shippedOverseerChains();
const isBound = r => r.label.startsWith('rule-bound-');
const estimateOf = c => ({ ...DEFAULT_ESTIMATE, ...(c.estimate || {}) });

test('GC-1: the MAXIMUM lists one `rule-bound-` row per layer-2 seat, n x (b2 + 1) times, each sized by term: promptTokens + draftTokens + 400 x K1 + the send-up ruling system text; the expected figure lists none; answer_back removed or no overseer rounds lists none', () => {
  assert.ok(shipped.length >= 7, `the shipped layered chains were found (${shipped.length})`);   // CHANGED ACCEPTED TEST (0.8.4 seats and retirements unit): OLD bar 8. NEW bar: 7 (seven planning chains left after the three retirements and the China mini). WHY: the count moves with the thing it counts
  // OLD: `assert.ok(r.input / times >= 400 * k1)` (a lower bound on the objections term) and `withoutBound(on.max) deepEqual off.max` on held maps. NEW: the exact per-call input by term (the old figure's bound is TIGHTENED, not loosened); the sentence term is the ceil(length / 4) of the recorded send-up ruling text.
  const system = estimateTokens(R.escalationRulingSystem({ sendUp: true }));
  for (const base of shipped) {
    const c = withAnswerBack(base); const { K } = layersOf(c); const a = estimateOf(c); const n = c.maxOverseerRounds; const b2 = c.layerRevisions[2];
    const rows = estimateChainRows(c, { maximum: true }).filter(isBound);
    assert.equal(rows.length, K[2], `${c.name}: one row per layer-2 seat`);
    for (const r of rows) {
      assert.equal(r.times ?? 1, n * (b2 + 1), `${c.name}: ${r.label} times = n x (b2 + 1)`);
      assert.equal(r.input / (r.times ?? 1), a.promptTokens + a.draftTokens + 400 * K[1] + system, `${c.name}: ${r.label} per call = prompt + draft + 400 x K1 (${K[1]}) + the send-up ruling system text (${system})`);
      assert.equal(r.priced, true, `${c.name}: ${r.label} is priced (a shipped, priced seat)`); assert.ok(r.usd > 0, `${c.name}: ${r.label} costs something`);
    }
    assert.equal(estimateChainRows(c, { maximum: false }).filter(isBound).length, 0, `${c.name}: the expected figure never lists a ruling row`);
    // the real offs: no ledger (answer_back) -> the go-up has nothing to rule on; no overseer rounds -> no layer-1 stop
    assert.equal(estimateChainRows(withoutAnswerBack(c), { maximum: true }).filter(isBound).length, 0, `${c.name}: answer_back off -> no rows`);
    assert.equal(estimateChainRows(noOverseer(c), { maximum: true }).filter(isBound).length, 0, `${c.name}: no overseer rounds -> no layer-1 stop -> no rows`);
  }
  // OLD (removed, C): `figures(c, { ...NO_RULINGS, ...LINE })` ("the ruling sentences not recorded -> no rows") and `{ ...STALL, ...LINE_NO_DEMAND }` ("the rating demand not recorded -> no rows"). WHY: both names are recorded in every shipped run (roles.js), so neither state can be built without a map that sets a recorded name to undefined.
});

test('GC-2 (the S7c revival): in a chain of EXACTLY TWO layers the layer-1 review rows carry 400 x K2 and the top layer 400 x K1, by term; the same chain without answer_back moves nothing', () => {
  let rowsChecked = 0;
  for (const base of shipped) {
    const two = twoLayers(base); const { K } = layersOf(two);
    for (const r of panelRows(two)) {
      assert.equal(r.perCall - r.expPerCall, rowGain(two, r), `${base.name}: ${r.label} gains by term: layer ${r.layer} of two: ${r.layer === 1 ? `400 x K2 (${K[2]})` : `400 x K1 (${K[1]})`}`);
      if (r.kind === 'review') { assert.equal(r.priced && r.usd > 0, true, `${base.name}: ${r.label} priced`); rowsChecked++; }
    }
    for (const r of panelRows(withoutAnswerBack(two))) assert.equal(r.perCall - r.expPerCall, noLedgerGain(r), `${base.name}: ${r.label}: answer_back off -> no section gain (the top seat's -reask3 keeps its one note)`);
  }
  assert.ok(rowsChecked > 0, 'at least one priced review row was checked (this row can fail)');
  // OLD (removed, C): `figures(two, { ...STALL, ...W41 })` ("no go-up line -> nothing"), `LINE_NO_DEMAND` ("the rating demand not recorded -> nothing") and the three-layer `three` leg ("the W41 section alone moves nothing"). WHY: the go-up line, the demand and the W41 section are recorded: those states do not exist; the three-layer shape's gains are pinned by layerGain in test/s7c-cost.test.js (RS-S7c-1).
});

// GC-3 (OLD: "the layer-2 REVIEW rows already count the go-up visits: each shipped chain's `panel-L2-*` rows run n x (b2 + 1) times") is REMOVED (C&C G): it compared figures on the held-off STALL map and passed for the wrong reason. WHY: RS-S7c-1 asserts the times of every panel row per layer (layer 2: n x (b2 + 1)) on the recorded state.
