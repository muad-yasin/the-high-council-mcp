// 0.8.4 S16 (F; T9e T21q T21bz; N29): the CHAIN side of `--finish` at a spending stop. The CLI hands the chain the recorded finish after the person's typed raise (chain.js setSpendFinish); the first call of the sitting that misses the cache inside the
// review rounds is the stage the limit stopped: the loop ends there with NO call for it (no layer-3 call is made on the stop's authority), the final read of the top layer runs, and the run ends NOT agreed with report stop.kind budget_stop, chosen finish.
// Offline, $0. A namespace import of chain.js: on a tree without the feature each row fails by assertion and the file still loads.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as chain from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { scenario, FINAL_READ_OK } from './helpers/layer-two-run.js';

afterEach(() => { chain.setSpendFinish?.(null); chain.setCache(null); chain.setBudget(null); chain.setPromptSpy(null); chain.setOutboundScan({}); setHeldForTest(null); });

const DISPUTE = { dispute: { enabled: true, stall_rounds: 2 } };
// pass 1, layer 2's call is the one the limit stopped: its stage is NOT on disk (a cut label), every earlier stage is. Layer 1 signs in pass 1 (the scenario's default has it object, which would need an answer-back in a second pass: this fixture needs only one pass)
const OPTS = { extra: { ...DISPUTE }, cutLabels: ['panel-1-lb'], overrides: { 'panel-1-la': FINAL_READ_OK['final-read-lc'], ...FINAL_READ_OK } };

test('T21q, T21bz: with the finish armed, the loop ends at the first call that misses the cache: that stage is never asked, the final read runs, the run ends NOT agreed as budget_stop, chosen finish, with the cap named', async () => {
  chain.setSpendFinish?.({ capName: 'anthropic' });
  const { result: r, served } = await scenario(OPTS);
  assert.equal(r.passed, false);
  assert.deepEqual([r.stop?.kind, r.stop?.label, r.stop?.chosen, r.stop?.pass, r.stop?.cap_name], ['budget_stop', 'panel-1-lb', 'finish', 1, 'anthropic']);
  assert.equal(r.dispute?.reason, 'finish_chosen', 'a person chose: the dispute reason is the finish');
  assert.equal(r.finalRead?.ran, true, 'T9e: the read ran before the end');
  assert.equal(r.finalRead.seats.find(s => s.lab === 'lc').read, true);
  assert.ok(served.includes('panel-1-lb'), 'the stage was looked for on disk');
  assert.ok(!r.stages.some(s => s.label === 'panel-1-lb'), 'and never asked: the finish took its place');
  assert.ok(!r.stages.some(s => s.label === 'panel-1-lc'), 'no later call of the review rounds was made');
});

test('without cap names (the run-wide limit) the stop carries no cap_name', async () => {
  chain.setSpendFinish?.({ capName: null });
  const { result: r } = await scenario(OPTS);
  assert.equal(r.stop?.kind, 'budget_stop');
  assert.equal('cap_name' in r.stop, false);
});

test('guard: the same run with the finish NOT armed asks the stage and goes on (the chain does nothing of this by itself)', async () => {
  // Not armed, the cut stage is asked for real (the mock reviewer of layer 2 objects, and the run then stalls on it: a stop of its own kind). The run is allowed to end that way here: what the guard pins is that no budget_stop is written and the finish is not taken.
  const out = await scenario(OPTS).catch(err => { if (!(err instanceof chain.RoundStopped)) throw err; return { stopped: err }; });
  const stop = out.result?.stop ?? out.stopped?.stop;
  assert.notEqual(stop?.kind, 'budget_stop', 'no budget_stop');
  if (out.result) assert.ok(out.result.stages.some(s => s.label === 'panel-1-lb'), 'the stage was asked');
  else assert.equal(stop.kind, 'stall_stop', 'the stage was asked: layer 2 objected and the run stalled on it, as it does without the cut');
});
