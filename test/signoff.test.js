// test/signoff.test.js
//
// The panel's per-seat record is the thing this harness exists to produce: who
// signed off, who refused, and why. These tests pin the shape a consumer reads.
//
// Added 2026-09-11 after a concrete incident. A four-lab council was asked to
// design a visual identity from a published run folder. It audited the run's
// data and reported that a holdout's *reason* had no machine-readable field -
// so the design it specified could show that a seat declined, but not why.
// That was wrong. The reasons were in `lastCritique.failures[]`, tagged with
// `lab`, and joining on that tag recovered them exactly. But four models with
// the run folder in front of them did not find the join, which is a fair test
// of whether it was discoverable. `objections` now sits on the seat's own
// record. These tests keep it there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain } from '../src/chain.js';

const seat = (model, lab) => ({ provider: 'mock', model, lab });

// Two mock critics, one of which never passes, so the run ends on a holdout
// rather than the unanimous stop. Inline rather than a chains/*.json file on
// purpose: a chain config is a published surface with a count the landing page
// asserts against, and this fixture is not a chain anyone should run.
const config = (critics) => ({
  name: 'test-signoff', maxRounds: 2, stopOnPass: true, signoff: 'unanimous',
  seats: {
    criteria: seat('mock-criteria'), builder: seat('mock-builder'),
    reviser: seat('mock-builder'), critics,
  },
});

const run = critics => runChain({
  request: 'A test request.', config: config(critics), log: () => {},
});

test('a holdout carries its own objections, not just a false verdict', async () => {
  const result = await run([
    seat('mock-critic-a', 'mock-a'),
    seat('mock-critic-holdout', 'mock-b'),
  ]);

  assert.equal(result.passed, false, 'a panel with a permanent holdout never passes');

  const held = result.signoff.find(s => s.provider === 'mock-b');
  assert.equal(held.signedOff, false);
  assert.ok(Array.isArray(held.objections), 'a holdout must carry an objections array');
  assert.ok(held.objections.length > 0, 'a seat that declined must say what it declined over');

  // The whole point is that a reader needs no second file and no join.
  const [first] = held.objections;
  assert.ok(first.criterion, 'an objection names the criterion it failed');
  assert.ok(first.problem, 'an objection names the problem');
});

test('signoff and lastCritique.failures cannot disagree about who objected', async () => {
  const result = await run([
    seat('mock-critic-a', 'mock-a'),
    seat('mock-critic-holdout', 'mock-b'),
  ]);

  // Both views are built from one pass over the same verdicts. If a later edit
  // ever computes them separately, this is the test that catches the drift.
  const fromSignoff = result.signoff
    .filter(s => s.signedOff === false)
    .flatMap(s => s.objections.map(o => ({ lab: s.provider, criterion: o.criterion, problem: o.problem })));
  const fromCritique = result.lastCritique.failures
    .map(f => ({ lab: f.lab, criterion: f.criterion, problem: f.problem }));

  assert.deepEqual(
    fromSignoff.sort((a, b) => a.lab.localeCompare(b.lab)),
    fromCritique.sort((a, b) => a.lab.localeCompare(b.lab)),
  );
});

test('a seat that signed off carries an empty objections list, never null', async () => {
  const result = await run([
    seat('mock-critic-a', 'mock-a'),
    seat('mock-critic-holdout', 'mock-b'),
  ]);

  const signed = result.signoff.find(s => s.provider === 'mock-a');
  assert.equal(signed.signedOff, true);
  // null means "no usable reply" (abstained). A seat that answered and agreed
  // has an empty list, so `objections.length` is safe to read without a guard
  // wherever `signedOff !== null`.
  assert.deepEqual(signed.objections, [], 'a sign-off is an answer, not an absence');
});

test('unanimous sign-off still reports every seat, each with no objections', async () => {
  const result = await run([
    seat('mock-critic-a', 'mock-a'),
    seat('mock-critic-b', 'mock-b'),
  ]);

  assert.equal(result.passed, true);
  assert.equal(result.signoff.length, 2);
  for (const s of result.signoff) {
    assert.equal(s.signedOff, true);
    assert.deepEqual(s.objections, []);
  }
});
