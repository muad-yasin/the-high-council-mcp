// PR #2 fix unit, item 1 (Sol): a judge that ANSWERED must stay on the record when the person's finish ends the run at a seat's call in the same blind panel. Offline, $0: the mock provider and the label-keyed scripted cache of
// test/helpers/layer-two-run.js. The first judge `la` answered (its stage is on disk, it raises "No retry limit is specified" rated 5); the stage of the second judge `lb` is a cache MISS, so the armed finish (a spending finish, or the
// found-secret finish) ends the run at it. Before the fix the answered judge vanished with the throw: panelVerdicts[] empty, signoff null, nothing open.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as chain from '../src/chain.js';
import { computeOutcome } from '../src/outcome.js';
import { setHeldForTest } from '../src/held-roles.js';
import { scenario, FINAL_READ_OK } from './helpers/layer-two-run.js';

afterEach(() => { chain.setSpendFinish?.(null); chain.setCache(null); chain.setBudget(null); chain.setPromptSpy(null); chain.setOutboundScan({}); setHeldForTest(null); });

const arm = kind => (kind === 'spend' ? chain.setSpendFinish({ capName: null }) : chain.setOutboundScan({ finish: true }));
const FLAT = { critics: [['la'], ['lb']], cutLabels: ['panel-1-lb'], extra: {}, answerBack: false };
const TWO_IN_LAYER = { critics: [['la', 1], ['lb', 1], ['lx', 2], ['lc', 3]], cutLabels: ['panel-1-lb'], extra: { dispute: { enabled: true, stall_rounds: 2 } }, overrides: { ...FINAL_READ_OK } };

for (const kind of ['spend', 'secret']) {
  for (const [shape, opts] of [['an unlayered blind panel', FLAT], ['a layer with two blind judges', TWO_IN_LAYER]]) {
    test(`${kind} finish in ${shape}: the judge that answered is a row marked cut, the unanswered one is not a verdict, and nobody is recorded as signed off`, async () => {
      arm(kind);
      const { result: r } = await scenario(opts);
      assert.equal(r.passed, false);
      const rows = r.panelVerdicts;
      assert.deepEqual(rows.map(v => [v.lab, v.verdict, v.cut]), [['la', 'objected', true]], 'the answered judge stays, marked cut; the judge whose call the finish ended has no row');
      assert.ok(!r.stages.some(s => s.label === 'panel-1-lb'), 'the unanswered judge was never asked');
      assert.ok(!(r.signoff ?? []).some(s => s.signedOff === true), 'no sign-off is recorded');
      assert.equal(computeOutcome(r), 'no_consensus', 'a cut row counts for no sign-off and no abstention: the outcome word is the one a finish had before');
    });
  }
}
