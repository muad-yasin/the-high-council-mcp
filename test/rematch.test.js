// Item C (blind rematch) - relay/runs/2026-09-15T15-12-52-325Z/deliverable.md.
// Unit tests against src/rematch.js's pure reshuffleSeats(), per this repo's own convention of
// testing an extracted pure module directly (test/outcome.test.js does the same), leaving the
// full CLI wiring to test/rematch-cli.test.js's integration coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reshuffleSeats } from '../src/rematch.js';

function critics(n) {
  return Array.from({ length: n }, (_, i) => ({ provider: 'mock', model: `mock-critic-${i}`, lab: `lab-${i}` }));
}

test('1. a 2-seat critics array always ends up with a different provider/model per seat than it started with', () => {
  const config = { seats: { critics: critics(2) } };
  for (const seed of [0, 1, 2, 99, -5]) {
    const out = reshuffleSeats(config, seed);
    assert.notEqual(out.seats.critics[0].model, config.seats.critics[0].model, `seed ${seed}`);
    assert.notEqual(out.seats.critics[1].model, config.seats.critics[1].model, `seed ${seed}`);
  }
});

test('2. a 5-seat critics array has no fixed points for any seed - a guaranteed derangement, not merely likely', () => {
  const config = { seats: { critics: critics(5) } };
  for (let seed = 0; seed < 20; seed++) {
    const out = reshuffleSeats(config, seed);
    for (let i = 0; i < 5; i++) {
      assert.notEqual(out.seats.critics[i].model, config.seats.critics[i].model, `seed ${seed}, seat ${i}`);
    }
  }
});

test('3. the same seed against the same config always produces the same permutation - deterministic, per backend-developer rule 10', () => {
  const config = { seats: { critics: critics(4) } };
  const a = reshuffleSeats(config, 42);
  const b = reshuffleSeats(config, 42);
  assert.deepEqual(a.seats.critics.map(s => s.model), b.seats.critics.map(s => s.model));
});

test('4. the original config object is never mutated', () => {
  const config = { seats: { critics: critics(3) } };
  const before = JSON.stringify(config);
  reshuffleSeats(config, 7);
  assert.equal(JSON.stringify(config), before);
});

test('5. lab fields are re-anonymized to fresh sequential labels, independent of original lab identity', () => {
  const config = { seats: { critics: [
    { provider: 'a', model: 'm1', lab: 'known-strong-lab' },
    { provider: 'b', model: 'm2', lab: 'known-weak-lab' },
  ] } };
  const out = reshuffleSeats(config, 1);
  assert.deepEqual(out.seats.critics.map(s => s.lab), ['lab-1', 'lab-2']);
});

test('6. a critics array of length 0 or 1 keeps its models - no non-trivial permutation exists - but a lone seat still loses its lab name', () => {
  const zero = { seats: { critics: [] } };
  const one = { seats: { critics: critics(1) } };
  assert.deepEqual(reshuffleSeats(zero, 3).seats.critics, []);
  // Since 0.7.8 (PR #13 verification, finding 4) every seat's lab comes from one config-wide map.
  assert.deepEqual(reshuffleSeats(one, 3).seats.critics, [{ ...one.seats.critics[0], lab: 'lab-1' }]);
});

test('7. proposers array is reshuffled independently of critics, when both are present', () => {
  const config = { seats: { critics: critics(2), proposers: [
    { provider: 'p', model: 'prop-a', lab: 'lab-1' },
    { provider: 'p', model: 'prop-b', lab: 'lab-2' },
  ] } };
  const out = reshuffleSeats(config, 1);
  assert.notEqual(out.seats.proposers[0].model, config.seats.proposers[0].model);
  assert.notEqual(out.seats.proposers[1].model, config.seats.proposers[1].model);
});

test('8. every non-seat, non-array-seat field in the config passes through untouched', () => {
  const config = {
    name: 'x', maxRounds: 3, signoff: 'unanimous',
    seats: { critics: critics(2), criteria: { provider: 'mock', model: 'mock-criteria' } },
  };
  const out = reshuffleSeats(config, 1);
  assert.equal(out.name, 'x');
  assert.equal(out.maxRounds, 3);
  assert.equal(out.signoff, 'unanimous');
  assert.deepEqual(out.seats.criteria, config.seats.criteria);
});

test('9. a negative seed is handled the same as a normalized positive one - no crash, still a derangement', () => {
  const config = { seats: { critics: critics(3) } };
  const out = reshuffleSeats(config, -7);
  for (let i = 0; i < 3; i++) assert.notEqual(out.seats.critics[i].model, config.seats.critics[i].model);
});

test('10. an extra field (e.g. thinking config) travels with its provider/model pair through the reshuffle', () => {
  const config = { seats: { critics: [
    { provider: 'a', model: 'm1', lab: 'lab-1', extra: { thinking: { type: 'enabled' } } },
    { provider: 'b', model: 'm2', lab: 'lab-2' },
  ] } };
  const out = reshuffleSeats(config, 1);
  // seed 1 on a 2-element array rotates by shift 1, so slot 0 now holds what was slot 1's pair.
  assert.equal(out.seats.critics[0].model, 'm2');
  assert.equal(out.seats.critics[0].extra, undefined);
  assert.equal(out.seats.critics[1].model, 'm1');
  assert.deepEqual(out.seats.critics[1].extra, { thinking: { type: 'enabled' } });
});

test('11. a tiered config: one lab keeps one label in every list, two labs never share one, and alternatives + deep_dive are renamed too', () => {
  const m = (model, lab) => ({ provider: 'openrouter', model, lab });
  const anchors = [m('a/astra', 'astra'), m('b/fable', 'fable'), m('c/pro', 'pro')];
  const config = { seats: {
    proposers: [m('x/luna', 'luna'), m('y/flash', 'flash'), m('z/qwen', 'qwen'), m('w/mini', 'mini')],
    critics: anchors,
    alternatives: [...anchors].reverse(),
    deep_dive: m('y/flash', 'flash'),
  } };
  for (const seed of [0, 1, 2, 7]) {
    const out = reshuffleSeats(config, seed);
    const all = [...out.seats.proposers, ...out.seats.critics, ...out.seats.alternatives, out.seats.deep_dive];
    const labOfModel = new Map();
    const modelOfLab = new Map();
    for (const s of all) {
      assert.match(s.lab, /^lab-\d+$/, `seed ${seed}: ${s.model} kept a real name`);
      if (labOfModel.has(s.model)) assert.equal(labOfModel.get(s.model), s.lab, `seed ${seed}: ${s.model} has two labels`);
      if (modelOfLab.has(s.lab)) assert.equal(modelOfLab.get(s.lab), s.model, `seed ${seed}: ${s.lab} names two models`);
      labOfModel.set(s.model, s.lab); modelOfLab.set(s.lab, s.model);
    }
    assert.equal(out.seats.deep_dive.model, 'y/flash', 'the deep-dive seat keeps its model');
  }
});
