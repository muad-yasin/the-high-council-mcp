// 0.8.3 M5: needs_decision, regeneration, root affected, stale, qualified ids (PLAN 8.4, 10.1). Part 1 (M5a): the stop TEXT; pure. Later slices add the propagation and the decide forms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNeedsDecisionStop } from '../src/tree-stop.js';
import { needsDecisionView } from './helpers/stop-views.js';

test('a needs_decision stop shows the node\'s own words, what it provides and expects, the affected set with the reason each node is in it (finished ones stale), the spend and the released share, the work that can still run and the choices', () => {
  const t = renderNeedsDecisionStop(needsDecisionView());
  assert.ok(t.startsWith('Stop e57: R/M1 generation 1 ended with the Status needs_decision.'));
  assert.ok(t.includes('| The store depends on a choice only the owner can make: single file or a server.') && t.includes('| I cannot settle it from the plan.'), 'the handoff\'s own words, verbatim');
  assert.ok(t.includes('- A1 to R/M2: K1 exposes get(id) and put(record) on the store.'));
  assert.ok(t.includes('R/M2 (finished, now stale): it expects an agreement from R/M1'));
  assert.ok(t.includes('Spent on it so far $1.37; its unspent share $3.88 went back to the pool; its spend stays counted.'));
  assert.ok(t.includes('Independent work that can still run: R/M3'));
  assert.ok(t.includes('decide --milestone <id>') && t.includes('(--obligation)'));
  assert.equal(t.includes('The ROOT is affected'), false);
  const root = renderNeedsDecisionStop({ ...needsDecisionView(), rootAffected: true });
  assert.ok(root.includes('The ROOT is affected: the tree cannot become ready') && root.includes('The root plan is never rewritten.'));
  const none = renderNeedsDecisionStop({ ...needsDecisionView(), independent: [], whatThisIs: null });
  assert.ok(none.includes('Independent work that can still run: (none)') && none.includes('(the handoff has no text under "What this is")'));
});
