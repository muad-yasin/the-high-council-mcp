// 0.8.4 (the ladder unit, commit 5; C&C 10 Nov 2026, Muad's exchange ideas): (1) a round with no withdrawal and no new objection ends the exchange; a changed stance or a reworded amend no longer counts as a change that keeps it going.
// (2) the LAYER-1 exchange stops after 3 rounds; the ENDING exchange keeps its 7. Offline, mock seats, $0. WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides.
// OWED, NOT MOVED HERE (named in the unit report): the older rows whose fixtures ran the layer-1 exchange for SEVEN rounds on a flipping stance (T3c, T22ac, T22am, RU-S1-15, RU-S3-67 x2, the raised_in x7 row, GL-1 of test/m1-layer1-go-up.test.js, the exchange rows of test/call-ceiling.test.js that pin 3072, 2142, 56 x 13): their premise is gone by rule, so each needs a fixture that makes progress every round, and the call-ceiling numbers need the new layer-1 figure. The first box run lists them.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { EXCHANGE_ROUNDS, LAYER_ONE_EXCHANGE_ROUNDS } from '../src/layer-debate.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const chainOf = (critics, extra = {}) => ({
  name: 'exchange-ideas-test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra });
const go = async config => { const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-exchange-ideas', config }); return r; };
const roundsOf = r => r.layerDebates[0].rounds.map(x => x.round);

test('EX-1 (idea 1: a changed stance does not keep the exchange going): e2 flips its stance in EVERY round (the old rule: a change every round, so the exchange ran to its end), nobody withdraws and nobody names a new objection: layer 1\'s second round always runs, and it ends there (rounds [1, 2]), no safety stop', async () => {
  const r = await go(chainOf([seat('mock-exch-support-keep-ex1', 'e1', 1), seat('mock-exch-alt-keep-ex1', 'e2', 1), seat('mock-critic-x', 'e9', 2)], { maxOverseerRounds: 2, layerRevisions: { 1: 3, 2: 1 } }));
  assert.deepEqual(roundsOf(r), [1, 2]);
  assert.notEqual(r.layerDebates[0].safety_stop, true, 'ended by the rule, not by the limit');
});

test('EX-2 (idea 2: the layer-1 exchange stops after 3 rounds): a judge that names a NEW objection on every ask makes progress in every round; the exchange stops after round 3 (the limit, not the rule): rounds [1, 2, 3], safety stop recorded; the limit is 3 and the ending exchange keeps 7', async () => {
  assert.equal(LAYER_ONE_EXCHANGE_ROUNDS, 3); assert.equal(EXCHANGE_ROUNDS, 7);
  const r = await go(chainOf([seat('mock-exch-support-keep-ex2a', 'e1', 1), seat('mock-exch-newevery-keep-ex2b', 'e2', 1), seat('mock-critic-x', 'e9', 2)], { maxOverseerRounds: 2, layerRevisions: { 1: 3, 2: 1 } }));
  assert.deepEqual(roundsOf(r), [1, 2, 3]);
  assert.equal(r.layerDebates[0].safety_stop, true, 'the limit ended it while it was still making progress');
});

test('EX-3 (SOURCE PINS, the two rules): the exchange loop ends on a round with no withdrawal and no new objection, and a reworded amend adds nothing to the changed set; the layer-1 limit and the ending exchange\'s limit are two constants (the ending exchange asks for EXCHANGE_ROUNDS, layer 1 for LAYER_ONE_EXCHANGE_ROUNDS)', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  assert.match(src, /const progressed = withdrawnNow > 0 \|\| newCount > 0;/);
  assert.match(src, /if \(\(ending \? !changed : !progressed\) && \(k >= 2 \|\| !layerOne\)\) break;/, 'the ending exchange keeps its own rule (idea 1 names the layer exchange)');
  assert.match(src, /amendedNow \+= 1; if \(ending\) changedIds\.add\(o\.id\); \}/, 'an amend is not a change of a layer exchange; it still is one of the ending exchange');
  assert.match(src, /const roundsAllowed = layerOne && !ending \? LAYER_ONE_EXCHANGE_ROUNDS : EXCHANGE_ROUNDS;/);
});
