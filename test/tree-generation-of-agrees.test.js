// BUG-C-061 (bug audit 2026-10-24, second audit of the tree files): src/tree-transitions.js says (R13) that the generation the STOP side names for a path (generationOf) and the generation the PREVIEW side gives its child (childGenerationOf)
// must agree. After a child was regenerated and its PARENT was then regenerated, generationOf kept the raw opened number of the old parent's child (2) while the new split's frontier gives the child 3, so a stop before registration
// for the child (a bundle_input stop) was refused by the table ("is not the generation the next registration would use") with no stop to answer. Pure folds of hand-written events (the fold reads only the fields set here).
//
// WHAT THIS CANNOT SHOW: the red reaches the two numbering functions, not the producing path (the bundle_input writer in src/tree-bundle-input.js and the table row that refuses the stop); the audit's trace through those was read, not run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stateOf } from '../src/tree-record.js';
import { childGenerationOf, generationOf } from '../src/tree-transitions.js';

const registered = (id, node, generation, frontierKey, parentNode, depth) => ({ id, event: 'node_registered', node, generation, runId: `run-${node}-${generation}`, attempt: 1, frontierKey, parentNode, depth, grant: { amount: 1 } });
const previewed = (id, frontierKey, parentNode, parentGeneration, children) => ({ id, event: 'frontier_previewed', frontierKey, parentNode, parentGeneration, children });
const record = events => ({ events, corrupt: [], tree: {} });

// R/P (g1) split into R/P/A; A is regenerated (A@g2 opened and registered under the same parent generation); then R/P is regenerated (R/P@g2 opened and registered).
const EVENTS = [
  previewed('e1', 'kP1', 'R', 1, [{ node: 'R/P', generation: 1 }]), registered('e2', 'R/P', 1, 'kP1', 'R', 1),
  previewed('e3', 'kA1', 'R/P', 1, [{ node: 'R/P/A', generation: 1 }]), registered('e4', 'R/P/A', 1, 'kA1', 'R/P', 2),
  { id: 'e5', event: 'generation_opened', decisionId: 'd1', nodes: [{ node: 'R/P/A', generation: 2 }] },
  previewed('e6', 'kA2', 'R/P', 1, [{ node: 'R/P/A', generation: 2 }]), registered('e7', 'R/P/A', 2, 'kA2', 'R/P', 2),
  { id: 'e8', event: 'generation_opened', decisionId: 'd2', nodes: [{ node: 'R/P', generation: 2 }] },
  previewed('e9', 'kP2', 'R', 1, [{ node: 'R/P', generation: 2 }]), registered('e10', 'R/P', 2, 'kP2', 'R', 1),
];

test('C-061: after a child and then its parent were regenerated, the stop side and the preview side name the same generation for the child (the next registration of R/P/A is g3)', () => {
  const state = stateOf(record(EVENTS));
  assert.equal(state.maxOpened.get('R/P/A'), 2, 'precondition: the old era opened R/P/A@g2');
  assert.equal(state.nodes.has('R/P/A@g2'), true, 'precondition: and registered it');
  assert.equal(childGenerationOf(state, 2, 'R/P/A'), 3, 'the new split of R/P@g2 gives its child above both old generations');
  assert.equal(generationOf(state, 'R/P/A'), 3, 'the stop side names the same number');
});

test('C-061: the numbering that already agreed still agrees - a child never regenerated, a child regenerated under its current parent, a path nothing registered', () => {
  const plain = stateOf(record(EVENTS.slice(0, 4)));
  assert.equal(generationOf(plain, 'R/P/A'), 1);
  assert.equal(generationOf(plain, 'R/P/B'), childGenerationOf(plain, 1, 'R/P/B'));
  // A regenerated under the SAME parent generation: the opened number is the next registration's, which is what the table expects for a current-era replacement
  const regen = stateOf(record(EVENTS.slice(0, 7)));
  assert.equal(generationOf(regen, 'R/P/A'), 2);
  // an opening nobody registered yet still counts (the replacement registers at the number it opened)
  const opened = stateOf(record([...EVENTS.slice(0, 7), { id: 'e8', event: 'generation_opened', decisionId: 'd3', nodes: [{ node: 'R/P/A', generation: 3 }] }]));
  assert.equal(generationOf(opened, 'R/P/A'), 3);
});
