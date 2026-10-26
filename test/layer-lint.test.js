// test/layer-lint.test.js
//
// 0.8.3 E1 (Layered_Panel_Contract.md section 3.2): chain-lint refuses every misuse of the per-seat `layer` key on seats.critics, so a layered panel can never be half-configured or silently flat.
// The key is lint-only in this commit: the schema row, the README row and the mechanism that reads it land together in E2 (a documented key the code ignores is the max_proposals_per_seat defect).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintChain } from '../src/chain-lint.js';

const critic = (n, layer, extra = {}) => ({ provider: 'mock', model: `mock-critic-${n}`, lab: `lab-${n}`, ...(layer === undefined ? {} : { layer }), ...extra });
const base = (critics, top = {}) => ({
  name: 'x', maxRounds: 3, signoff: 'unanimous', estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 50 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics },
  ...top,
});
const layerFindings = cfg => lintChain(cfg, 'chains/x.json').filter(f => f.kind === 'invalid-layer');

test('a layered panel of 1, 2, 3 passes lint; so does a two-layer panel and a panel with no layers at all', () => {
  assert.deepEqual(layerFindings(base([critic('a', 1), critic('b', 1), critic('c', 2), critic('d', 3)])), []);
  assert.deepEqual(layerFindings(base([critic('a', 1), critic('b', 2)])), []);
  assert.deepEqual(layerFindings(base([critic('a'), critic('b')])), [], 'no layers: today\'s behaviour, nothing to say');
});

const refused = [
  ['a layer on a seat that is not a panel critic', base([critic('a', 1), critic('b', 2)], { seats: { ...base([]).seats, critics: [critic('a', 1), critic('b', 2)], builder: { provider: 'mock', model: 'mock-builder', layer: 1 } } }), /seats\.builder.*"layer".*panel critics/],
  ['a layer on a "first" sign-off chain', base([critic('a', 1), critic('b', 2)], { signoff: 'first' }), /signs off with "first"/],
  ['a layer on a descending chain', base([critic('a', 1), critic('b', 2)], { descending: true }), /descending/],
  ['a layer on an advice chain', base([critic('a', 1), critic('b', 2)], { advise: { enabled: true, usd: 1 } }), /advice chain/],
  ['a layer with the relay panel', base([critic('a', 1), critic('b', 2)], { panel: 'relay' }), /relay/],
  ['a layer with a quorum', base([critic('a', 1), critic('b', 2)], { quorum: { minHeard: 2 } }), /quorum/],
  ['some critics layered and some not', base([critic('a', 1), critic('b')]), /1 of 2/],
  ['a layer that is not a whole number from 1 to 3 (0)', base([critic('a', 0), critic('b', 1)]), /seats\.critics\[0\].*0.*1 to 3/],
  ['a layer that is not a whole number from 1 to 3 (4)', base([critic('a', 1), critic('b', 4)]), /seats\.critics\[1\].*4/],
  ['a layer that is not a whole number from 1 to 3 (a string)', base([critic('a', '1'), critic('b', 2)]), /"1"/],
  ['a gap in the layers (1 and 3)', base([critic('a', 1), critic('b', 3)]), /1, 3.*without a gap/],
  ['layers that do not start at 1 (2 and 3)', base([critic('a', 2), critic('b', 3)]), /2, 3.*without a gap/],
  ['a layered critic with no lab of its own', base([critic('a', 1), { provider: 'mock', model: 'mock-critic-b', layer: 2 }]), /seats\.critics\[1\].*"lab"/],
  ['two layered critics that share one lab (in two layers)', base([critic('a', 1), critic('b', 2, { lab: 'lab-a' })]), /"lab-a".*seats\.critics\[0\].*seats\.critics\[1\]/],
  ['two layered critics that share one lab (in one layer)', base([critic('a', 1), critic('b', 1, { lab: 'lab-a' })]), /"lab-a"/],
];
// EDITED ACCEPTED ASSERTION (E3, 14 Oct 2026, disclosed): the row 'a layer with answer_back (until the answer-back retention lands in E3)' was a REFUSAL (/answer_back/); E3 retains a judge's open objections across the layers, so the combination is accepted (flipped below).
test('lint accepts: a layer together with answer_back (flipped in E3, which retains answer-back across the layers)', () => {
  assert.deepEqual(layerFindings(base([critic('a', 1), critic('b', 2)], { answer_back: { enabled: true } })), []);
});
for (const [name, cfg, message] of refused) {
  test(`lint refuses: ${name}`, () => {
    const found = layerFindings(cfg);
    assert.ok(found.length >= 1, `expected an invalid-layer finding, got ${JSON.stringify(lintChain(cfg, 'chains/x.json').map(f => f.kind))}`);
    assert.ok(found.some(f => message.test(f.message)), `no message matched ${message}: ${found.map(f => f.message).join(' | ')}`);
    assert.ok(found.every(f => /chains\/x\.json/.test(f.fix)), 'every fix names the chain file');
  });
}
