// BUG-C-057 (bug audit 2026-10-24, second audit of the tree files): holdability asks whether a finished node is WHOLE (pendingBelow: every child its verified split names, and every child of its approved frontiers, is registered). A child that a finished
// run fills (a `reused` entry of the approved frontier) is by the record's own rule never registered (tree-recovery.js: "a slot filled by a finished run is never registered, so it is not a child left to register"), so a finished, passed parent
// with such a slot stayed "half-finished" for ever: listed as ineligible by a later root re-plan, dead, and never offered for reuse. Pure folds of hand-written events (the fold reads only the fields set here).
//
// WHAT THIS CANNOT SHOW: the state is hand-written, not produced by the sub-plan adoption route (a real regenerate that adopts a finished run into a slot, then a root re-plan); the audit's trace of that route was read, not run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stateOf } from '../src/tree-record.js';
import { ineligibleBelowRoot, pendingBelowOf } from '../src/tree-transitions.js';

const registered = (id, node, generation, frontierKey, parentNode, depth) => ({ id, event: 'node_registered', node, generation, runId: `run-${node}-${generation}`, attempt: 1, frontierKey, parentNode, depth, grant: { amount: 1 } });
const previewed = (id, frontierKey, parentNode, parentGeneration, children) => ({ id, event: 'frontier_previewed', frontierKey, parentNode, parentGeneration, children, boundSha256: 'h' });
const approved = (id, frontierKey) => ({ id, event: 'frontier_approved', frontierKey, revision: 1, boundSha256: 'h' });
const passed = (id, node, generation) => ({ id, event: 'node_closed', node, generation, outcome: 'passed', status: 'passed' });
const record = events => ({ events, corrupt: [], tree: {} });
// R@g1 with one finished, passed child R/P whose verified split names one child, R/P/A
const BASE = [
  registered('e1', 'R', 1, null, null, 0), previewed('e2', 'kR', 'R', 1, [{ node: 'R/P', generation: 1 }]), registered('e3', 'R/P', 1, 'kR', 'R', 1), passed('e4', 'R/P', 1),
  { id: 'e5', event: 'split_verified', node: 'R/P', generation: 1, splitSha256: 's', runId: 'run-R/P-1', children: ['R/P/A'] },
];
const ineligible = events => ineligibleBelowRoot(stateOf(record(events)));

test('C-057: a finished parent whose approved frontier fills a slot with a finished run (a reused child, never registered) is whole, not half-finished', () => {
  const REUSED = { adoptsNode: 'R/Q/Z', adoptsGeneration: 1, runId: 'run-R/Q/Z-1' };
  const events = [...BASE, previewed('e6', 'kP', 'R/P', 1, [{ node: 'R/P/A', generation: 1, reused: REUSED }]), approved('e7', 'kP')];
  const state = stateOf(record(events));
  assert.equal(state.adopted.get('R/Q/Z@g1')?.slot, 'R/P/A@g1', 'precondition: the approved frontier adopts the finished run into the slot');
  assert.equal(state.nodes.has('R/P/A@g1'), false, 'precondition: the slot is not a registered node');
  assert.deepEqual(ineligibleBelowRoot(state), [], 'R/P is whole: it can be held for the reuse check');
});

test('C-057: the half-finished rule still holds - a split child nobody registered, and an approved frontier child that is not a reused one, keep the parent ineligible; all children registered and closed make it whole', () => {
  assert.deepEqual(ineligible(BASE), ['R/P@g1'], 'the verified split names R/P/A and nothing registered it');
  const unregistered = [...BASE, previewed('e6', 'kP', 'R/P', 1, [{ node: 'R/P/A', generation: 1 }]), approved('e7', 'kP')];
  assert.deepEqual(ineligible(unregistered), ['R/P@g1'], 'an approved child that is neither registered nor reused is still pending');
  const whole = [...unregistered, registered('e8', 'R/P/A', 1, 'kP', 'R/P', 2), passed('e9', 'R/P/A', 1)];
  assert.deepEqual(ineligible(whole), [], 'every child registered and closed passed: whole');
});

test('C-057 (scope): a slot another generation of the parent path was adopted into does not make this generation whole - the adoption counts for the parent generation whose frontier made it', () => {
  const REUSED = { adoptsNode: 'R/Q/Z', adoptsGeneration: 1, runId: 'run-R/Q/Z-1' };
  const split = (id, node, generation) => ({ id, event: 'split_verified', node, generation, splitSha256: 's', runId: `run-${node}-${generation}`, children: ['R/P/A'] });
  // R/P@g1: finished and passed, its verified split names R/P/A, nothing registered it and no frontier of it fills it. R/P@g2 (a regenerate): the same split, and its approved frontier fills R/P/A with a finished run.
  const events = [
    registered('e1', 'R', 1, null, null, 0), previewed('e2', 'kR1', 'R', 1, [{ node: 'R/P', generation: 1 }]), registered('e3', 'R/P', 1, 'kR1', 'R', 1), passed('e4', 'R/P', 1), split('e5', 'R/P', 1),
    { id: 'e6', event: 'generation_opened', decisionId: 'd1', nodes: [{ node: 'R/P', generation: 2 }] },
    previewed('e7', 'kR2', 'R', 1, [{ node: 'R/P', generation: 2 }]), registered('e8', 'R/P', 2, 'kR2', 'R', 1), passed('e9', 'R/P', 2), split('e10', 'R/P', 2),
    previewed('e11', 'kP2', 'R/P', 2, [{ node: 'R/P/A', generation: 1, reused: REUSED }]), approved('e12', 'kP2'),
  ];
  const state = stateOf(record(events));
  assert.equal(state.adopted.get('R/Q/Z@g1')?.frontierKey, 'kP2', 'precondition: the adoption was made by the frontier of R/P@g2');
  assert.equal(pendingBelowOf(state, state.nodes.get('R/P@g2')), false, 'R/P@g2: the slot is filled under its own frontier');
  assert.equal(pendingBelowOf(state, state.nodes.get('R/P@g1')), true, 'R/P@g1: its own split child was never registered or filled, whatever a later generation did');
});
