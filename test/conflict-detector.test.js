// E4b unit one (gate page Review/Build_0.8.3/m6-closing/E4b_Gate_Page.md; rule R): the pure detector of the alternating objection. Nothing calls it yet. Namespace access, so a staged red runs every row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CD = await import('../src/conflict-detector.js').catch(() => ({}));
const find = a => CD.findConflict(a);

const layerOf = { lo: 1, lo2: 1, hi: 2 };
const f = (lab, id, extra = {}) => ({ lab, id, ...extra });
// The swing: round 1 lo raises X; round 2 lo is heard and silent (X withdrawn), hi raises Y and a revise follows; round 3 lo raises X again.
const swing = (over = {}) => ({
  round: 3,
  failuresByRound: [{ round: 1, failures: [f('lo', 'O-x')] }, { round: 2, failures: [f('hi', 'O-y')] }, { round: 3, failures: [f('lo', 'O-x')] }],
  heardByRound: { 1: ['lo'], 2: ['lo', 'hi'], 3: ['lo'] },
  layerOf,
  revisedRounds: [1, 2],
  ...over,
});

test('E4b d1: the swing fires: X (lo) raised, let go while hi\'s Y is revised, raised again: one conflict naming both objections', () => {
  const r = find(swing());
  assert.equal(r.length, 1);
  assert.deepEqual({ ...r[0], other: undefined }, { round: 3, lab: 'lo', layer: 1, id: 'O-x', first_round: 1, silent_round: 2, other: undefined });
  assert.deepEqual(r[0].other, [{ id: 'O-y', lab: 'hi', layer: 2, round: 2 }]);
});

test('E4b d2: a SUSTAINED X is carried into round 2\'s failures, so it was not let go: no conflict', () => {
  const s = swing({ failuresByRound: [{ round: 1, failures: [f('lo', 'O-x')] }, { round: 2, failures: [f('lo', 'O-x', { carried_from_round: 1 }), f('hi', 'O-y')] }, { round: 3, failures: [f('lo', 'O-x')] }] });
  assert.deepEqual(find(s), []);
});

test('E4b d3: a lab that was NOT HEARD in round 2 was not silent, it was absent: no conflict', () => {
  assert.deepEqual(find(swing({ heardByRound: { 1: ['lo'], 2: ['hi'], 3: ['lo'] } })), []);
});

test('E4b d4: no revise for another layer in between (the only revise in 2 was for lo itself): no conflict', () => {
  const s = swing({ failuresByRound: [{ round: 1, failures: [f('lo', 'O-x')] }, { round: 2, failures: [f('lo2', 'O-z')] }, { round: 3, failures: [f('lo', 'O-x')] }], layerOf });
  assert.deepEqual(find(s), []);
});

test('E4b d5: the objection in between was never revised (round 2 ended the run or the cap): no conflict', () => {
  assert.deepEqual(find(swing({ revisedRounds: [1] })), []);
});

test('E4b d6: a CARRIED X in round 3 is no re-raise: no conflict', () => {
  const s = swing({ failuresByRound: [{ round: 1, failures: [f('lo', 'O-x')] }, { round: 2, failures: [f('hi', 'O-y')] }, { round: 3, failures: [f('lo', 'O-x', { carried_from_round: 1 })] }] });
  assert.deepEqual(find(s), []);
});

test('E4b d7: a reworded complaint about ANOTHER quote is another id: not caught (PIN, said plainly in the amendment)', () => {
  const s = swing({ failuresByRound: [{ round: 1, failures: [f('lo', 'O-x')] }, { round: 2, failures: [f('hi', 'O-y')] }, { round: 3, failures: [f('lo', 'O-x2')] }] });
  assert.deepEqual(find(s), []);
});

test('E4b d8: X never raised before round 2 (a first raise in round 3): no conflict', () => {
  const s = swing({ failuresByRound: [{ round: 1, failures: [f('lo', 'O-q')] }, { round: 2, failures: [f('hi', 'O-y')] }, { round: 3, failures: [f('lo', 'O-x')] }] });
  assert.deepEqual(find(s), []);
});

test('E4b d9: it fires at the FIRST re-raise only: a re-raise in round 3 means round 4 (X present again after 3) is not a second swing', () => {
  const s = swing({ round: 4, failuresByRound: [{ round: 1, failures: [f('lo', 'O-x')] }, { round: 2, failures: [f('hi', 'O-y')] }, { round: 3, failures: [f('lo', 'O-x')] }, { round: 4, failures: [f('lo', 'O-x')] }], heardByRound: { 1: ['lo'], 2: ['lo', 'hi'], 3: ['lo'], 4: ['lo'] }, revisedRounds: [1, 2, 3] });
  assert.deepEqual(find(s), []);
});

test('E4b d10: the window starts at the FIRST heard round after the id was last present, so every other-layer revise since counts; sorted by lab then id, other objections in round order', () => {
  const s = {
    round: 5,
    failuresByRound: [{ round: 1, failures: [f('lo', 'O-x'), f('lo2', 'O-w')] }, { round: 2, failures: [f('hi', 'O-y')] }, { round: 3, failures: [f('hi', 'O-v')] }, { round: 4, failures: [] }, { round: 5, failures: [f('lo2', 'O-w'), f('lo', 'O-x')] }],
    heardByRound: { 1: ['lo', 'lo2'], 2: ['lo', 'lo2', 'hi'], 3: ['lo', 'lo2', 'hi'], 4: ['lo', 'lo2'], 5: ['lo', 'lo2'] },
    layerOf, revisedRounds: [1, 2, 3, 4],
  };
  const r = find(s);
  assert.deepEqual(r.map(x => x.lab + ':' + x.id + ':a' + x.first_round + ':b' + x.silent_round), ['lo:O-x:a1:b2', 'lo2:O-w:a1:b2']);
  assert.deepEqual(r[0].other, [{ id: 'O-y', lab: 'hi', layer: 2, round: 2 }, { id: 'O-v', lab: 'hi', layer: 2, round: 3 }]);
});

test('E4b d10b: a sustained X (carried in round 2) that is later withdrawn and re-raised: the window starts after its LAST appearance', () => {
  const s = {
    round: 4,
    failuresByRound: [{ round: 1, failures: [f('lo', 'O-x')] }, { round: 2, failures: [f('lo', 'O-x', { carried_from_round: 1 })] }, { round: 3, failures: [f('hi', 'O-y')] }, { round: 4, failures: [f('lo', 'O-x')] }],
    heardByRound: { 1: ['lo'], 2: ['hi'], 3: ['lo', 'hi'], 4: ['lo'] }, layerOf, revisedRounds: [1, 2, 3],
  };
  const r = find(s);
  assert.equal(r.length, 1);
  assert.equal(r[0].first_round, 1); assert.equal(r[0].silent_round, 3);
  assert.deepEqual(r[0].other, [{ id: 'O-y', lab: 'hi', layer: 2, round: 3 }]);
});

test('E4b d11: malformed or missing input is "no conflict", never an error', () => {
  assert.deepEqual(find(undefined), []);
  assert.deepEqual(find({}), []);
  assert.deepEqual(find({ round: 3, failuresByRound: [null, { round: 'x' }, { round: 3, failures: [null, { lab: 1 }] }] }), []);
  assert.deepEqual(find({ round: 3, failuresByRound: 'no' }), []);
});

test('E4b d12: the module imports nothing and is pure (no clock, no randomness)', () => {
  const src = readFileSync(join(resolve(here, '..'), 'src', 'conflict-detector.js'), 'utf8');
  assert.equal(/^\s*import\s/m.test(src), false);
  assert.equal(/Date\.now|new Date|Math\.random|process\.|require\(/.test(src), false);
  const a = JSON.stringify(find(swing())); const b = JSON.stringify(find(swing()));
  assert.equal(a, b);
});

test('E4b d13: an other-layer objection that reached the reviser as a CARRIED failure counts as revised for (chain.js folds carried openOwn failures into allFailures, which is what revise-N is given)', () => {
  const s = swing({ failuresByRound: [{ round: 1, failures: [f('lo', 'O-x')] }, { round: 2, failures: [f('hi', 'O-y', { carried_from_round: 1 })] }, { round: 3, failures: [f('lo', 'O-x')] }] });
  const r = find(s);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].other, [{ id: 'O-y', lab: 'hi', layer: 2, round: 2 }]);
});
