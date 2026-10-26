// Round-semantics unit one (gate page Review/Build_0.8.3/m6-closing/Round_Semantics_Gate_Page.md): the pure bookkeeping of the pass counter and the overseer-round counter. Nothing calls it yet. Namespace access, so a staged red runs every row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OR = await import('../src/overseer-rounds.js').catch(() => ({}));
const advance = (...a) => OR.advance(...a);
const start = () => OR.newRoundState();

const cfg = (over = {}) => ({ maxOverseerRounds: 7, layerRevisions: { 1: 5, 2: 3 }, ...over });
// Feeds a list of passes through advance() until it stops; returns every result.
const run = (config, passes) => {
  let state = start(); const out = [];
  for (const p of passes) { const r = advance(config, state, p); out.push(r); state = r.state; if (r.action === 'stop' || r.action === 'done') break; }
  return out;
};
const obj1 = { outcome: 'layer_objected', layer: 1 }; const obj2 = { outcome: 'layer_objected', layer: 2 };
const verdictNo = { outcome: 'overseer_verdict', verdict: 'objected' }; const verdictYes = { outcome: 'overseer_verdict', verdict: 'signed_off' };
const unheard = layer => ({ outcome: 'unheard', layer });

test('R1 b1: a stuck layer 1 reaches the stop at its SIXTH objection with a bound of five: five revisions are allowed, the sixth is the stop', () => {
  const r = run(cfg(), Array(8).fill(obj1));
  assert.deepEqual(r.map(x => x.action), ['revise', 'revise', 'revise', 'revise', 'revise', 'stop']);
  assert.deepEqual(r[5].stop, { kind: 'layer_bound', why: 'revisions', layer: 1, used: 5, bound: 5, overseerRound: 1 });
});

test('R1 b2: layer 2 is bounded on its own count (three), and layer 1\'s count does not move it', () => {
  const r = run(cfg(), [obj1, obj1, obj2, obj2, obj2, obj2]);
  assert.deepEqual(r.map(x => x.action), ['revise', 'revise', 'revise', 'revise', 'revise', 'stop']);
  assert.deepEqual(r[5].stop, { kind: 'layer_bound', why: 'revisions', layer: 2, used: 3, bound: 3, overseerRound: 1 });
});

test('R1 b3: a layer-3 objection ENDS the overseer round and resets both bounds (the next round starts at layer 1 with its full allowance)', () => {
  const r = run(cfg(), [obj1, obj1, obj1, obj1, obj1, obj2, verdictNo, obj1, obj1, obj1, obj1, obj1, obj1]);
  assert.equal(r[6].overseerRoundEnded, true);
  assert.equal(r[6].state.overseerRound, 2);
  assert.deepEqual(r[6].state.used, { 1: 0, 2: 0 });
  assert.deepEqual(r.slice(7, 12).map(x => x.action), ['revise', 'revise', 'revise', 'revise', 'revise']);
  assert.equal(r[12].action, 'stop', 'the sixth layer-1 objection of round 2 is the stop again');
  assert.equal(r[12].stop.overseerRound, 2);
});

test('R1 b4: the seventh overseer objection is the overseer cap: a stop, not a revise; a sign-off before it is done', () => {
  const r = run(cfg(), Array(7).fill(verdictNo));
  assert.deepEqual(r.map(x => x.action), ['revise', 'revise', 'revise', 'revise', 'revise', 'revise', 'stop']);
  assert.deepEqual(r[6].stop, { kind: 'overseer_cap', rounds: 7, cap: 7 });
  const ok = run(cfg(), [verdictNo, verdictYes, verdictNo]);
  assert.deepEqual(ok.map(x => x.action), ['revise', 'done'], 'a sign-off ends the run at once');
  assert.equal(ok[1].overseerRoundEnded, true);
});

test('R1 b5: a PERMANENTLY UNHEARD layer-1 seat reaches the stop: two re-ask passes are allowed, the third is the stop (a loop bounded only by the pass cap until now)', () => {
  const r = run(cfg(), Array(10).fill(unheard(1)));
  assert.deepEqual(r.map(x => x.action), ['ask_again', 'ask_again', 'stop']);
  assert.deepEqual(r[2].stop, { kind: 'layer_bound', why: 'unheard', layer: 1, passes: 3, reasks: 2, overseerRound: 1 });
});

test('R1 b6: the unheard count is CONSECUTIVE: a revise between two unheard passes resets it', () => {
  const r = run(cfg(), [unheard(1), unheard(1), obj1, unheard(1), unheard(1), unheard(1)]);
  assert.deepEqual(r.map(x => x.action), ['ask_again', 'ask_again', 'revise', 'ask_again', 'ask_again', 'stop']);
});

test('R1 b7: the pass counter counts every pass of the overseer round and starts again at the next one', () => {
  const r = run(cfg(), [obj1, unheard(1), obj2, verdictNo, obj1]);
  assert.deepEqual(r.map(x => x.state.passInRound), [1, 2, 3, 0, 1]);
  assert.deepEqual(r.map(x => x.state.overseerRound), [1, 1, 1, 2, 2]);
});

test('R1 b8: passCeiling is maxOverseerRounds x (b1 + b2 + 1) x (reasks + 1) (the unheard count is consecutive, so every productive pass can follow `reasks` unheard ones), and null for a malformed config (the chain-lint input)', () => {
  assert.equal(OR.passCeiling({ maxOverseerRounds: 7, layerRevisions: { 1: 5, 2: 3 } }), 189);
  assert.equal(OR.passCeiling({ maxOverseerRounds: 7, layerRevisions: { 1: 7, 2: 3 } }), 231);
  assert.equal(OR.passCeiling({ maxOverseerRounds: 7, layerRevisions: { 1: 5, 2: 3 }, reasks: 0 }), 63);
  for (const bad of [undefined, {}, { maxOverseerRounds: 0, layerRevisions: { 1: 5, 2: 3 } }, { maxOverseerRounds: 7, layerRevisions: { 1: 5 } }, { maxOverseerRounds: 7, layerRevisions: { 1: 5, 2: 3 }, reasks: -1 }, { maxOverseerRounds: 7.5, layerRevisions: { 1: 5, 2: 3 } }]) assert.equal(OR.passCeiling(bad), null);
});

test('R1 b9: advance never mutates its input state, and a malformed config or pass is an error, not a guess (PIN)', () => {
  const s = start(); const before = JSON.stringify(s);
  advance(cfg(), s, obj1);
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => advance({}, s, obj1), RangeError);
  assert.throws(() => advance(cfg(), s, { outcome: 'layer_objected', layer: 3 }), RangeError);
  assert.throws(() => advance(cfg(), s, { outcome: 'overseer_verdict', verdict: 'maybe' }), RangeError);
  assert.throws(() => advance(cfg(), s, { outcome: 'nothing' }), RangeError);
});

test('R1 b10: the module imports nothing and is pure (no clock, no randomness, no process)', () => {
  const src = readFileSync(join(resolve(here, '..'), 'src', 'overseer-rounds.js'), 'utf8');
  assert.equal(/^\s*import\s/m.test(src), false);
  assert.equal(/Date\.now|new Date|Math\.random|process\.|require\(/.test(src), false);
});

test('R1 b11: the ceiling is REACHED and never passed: the worst legal sequence (two unheard passes before every productive pass, for all seven overseer rounds) takes exactly passCeiling passes and its last result is the overseer cap', () => {
  const config = cfg();
  const round = [];
  for (let i = 0; i < 5; i++) round.push(unheard(1), unheard(1), obj1);
  for (let i = 0; i < 3; i++) round.push(unheard(2), unheard(2), obj2);
  round.push(unheard(3), unheard(3), verdictNo);
  assert.equal(round.length * 7, OR.passCeiling(config));
  const results = run(config, Array.from({ length: 7 }, () => round).flat());
  assert.equal(results.length, OR.passCeiling(config), 'every pass of the worst sequence was allowed');
  assert.deepEqual(results[results.length - 1].stop, { kind: 'overseer_cap', rounds: 7, cap: 7 });
  assert.equal(results.filter(x => x.action === 'stop').length, 1, 'and nothing stopped before the last');
  // one more unheard pass anywhere in the sequence makes it stop earlier, so the ceiling is the maximum, not an estimate
  const worse = [unheard(1), unheard(1), unheard(1)];
  assert.equal(run(config, worse).at(-1).action, 'stop');
});
