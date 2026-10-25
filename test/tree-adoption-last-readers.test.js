// 0.8.3 M7 apply, C2b-1c (plan + gate answer: Review/Build_0.8.3/m7/C2b1c_Plan_2026-10-18.md; C&C thcmcp-6d: PASS). The LAST READERS of the writer's output, on a REAL record with a MOVED adoption (test/helpers/adoption-fixture.js): the adoption LAPSE (an adoption belongs to the plan that made it) and the handoff,
// whose per-node data and reading order were keyed by path. Rows that need a node with a readable verified plan (tree-check.js:66/:77/:142, bindingOf's agreement branch, the stop view) take their row from C2b-2's probe record, as ruled; the status page's live/dead paths and tree-close's waitingFor have
// no record on which today's code answers wrongly (see the commit message), so they are not moved. $0, no run is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as TR from '../src/tree-transitions.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { budgetOf } from '../src/tree-budget.js';
import { gatherHandoffFacts } from '../src/tree-handoff.js';
import { adoptedTree, replanParent } from './helpers/adoption-fixture.js';

const read = t => { const record = readTreeRecord(t.rootDir); return { record, state: stateOf(record) }; };

test('C2b-1c the adoption LAPSE: when the plan that adopted a node is planned again, the adoption ends (the node is a kept candidate again, not live in a slot of a replaced plan), the branch below it with it, and no dollar moves', () => {
  const { t } = adoptedTree({ deep: true });
  const before = read(t); const spentBefore = budgetOf(t.rootDir, {}).treeSpentUsd;
  assert.ok(before.state.adopted.has('R/M1/A@g1'), 'the fixture: adopted before the decision');
  replanParent(t);
  const { state } = read(t);
  assert.equal(state.adopted.size, 0, 'the adoption ended with its plan');
  assert.equal(state.adoptedBelow.size, 0, 'and so did the branch below it');
  assert.ok(TR.heldKeys(state).has('R/M1/A@g1'), 'the node is a kept candidate again');
  assert.equal(TR.deadKeys(state).has('R/M1/A@g1'), false, 'not dead: it can be reused or run again by the new plan');
  assert.equal(TR.deadKeys(state).has('R/M1/C@g2'), true, 'the registered-but-unstarted node of the replaced plan is dead with it');
  const spentAfter = budgetOf(t.rootDir, {}).treeSpentUsd;
  assert.ok(Math.abs(spentAfter - spentBefore) < 1e-9 && Math.abs(spentAfter - 8) < 1e-9, `the run of the reused node is counted once, before and after (${spentBefore} / ${spentAfter})`);
});

test('C2b-1c gatherHandoffFacts: the reading order names the adopted node AND the new node of its old path (each place once), and the node table carries the place of the adopted one; per-node data is not overwritten by the second node on the path', () => {
  const { t } = adoptedTree({ deep: true });
  const facts = gatherHandoffFacts(t.rootDir, { work: t.work });
  const places = facts.order.map(o => o.place ?? o.node);
  for (const p of ['R/M1/A', 'R/M1/B', 'R/M1/A/D', 'R/M1/B/D', 'R/M1/C']) assert.ok(places.includes(p), `${p} is in the reading order (${places.join(', ')})`);
  assert.equal(new Set(places).size, places.length, 'each place once');
  assert.deepEqual(facts.order.find(o => o.place === 'R/M1/B'), { node: 'R/M1/A', place: 'R/M1/B', registered: true }, 'the entry names the real path and says where it sits');
  const row = k => facts.nodes.find(n => `${n.node}@g${n.generation}` === k);
  assert.equal(row('R/M1/A@g1').place, 'R/M1/B');
  assert.equal(row('R/M1/A@g2').place, undefined);
});
