// Money fixtures shared by the budget tests (budget commits 0 and 1): a child with paid calls written the way a member writes them, and the gate-page-2 invariant read from the tree itself. Not a test file.
import assert from 'node:assert/strict';
import { appendTreeEvent } from '../../src/tree-record.js';
import { MONEY_EPS, budgetOf, gateTree } from '../../src/tree-budget.js';
import { claim, hostnameOf, registerKid, reservedLine, settledLine, syntheticRun, writeLines } from './tree-fixture.js';

const codes = g => g.problems.map(p => p.code);

/** The invariant of gate page section 2, read from the tree itself: the gate passes, nothing is over-committed, and `available` is exactly what is left. */
export function assertInvariant(rootDir, label) {
  const gate = gateTree(rootDir);
  assert.equal(gate.ok, true, `${label}: the gate passes (${codes(gate)})`);
  const b = budgetOf(rootDir, { gate });
  const exposure = b.treeSpentUsd + b.unknownSpendHeldUsd + b.heldUsd;
  assert.ok(exposure <= b.rootCapUsd + MONEY_EPS, `${label}: settled + unsettled + unknown + unspent grants (${exposure}) never exceed the cap (${b.rootCapUsd})`);
  assert.ok(b.availableUsd >= -MONEY_EPS, `${label}: available is not negative (${b.availableUsd})`);
  assert.ok(Math.abs(b.availableUsd - (b.rootCapUsd - exposure)) < 1e-6, `${label}: available = cap - the three terms`);
  return b;
}

/** One child with a grant, started, with paid calls written the way a member writes them, then stopped at its cap (so it is not the active node and holds grant - spent). calls: [{ id, reservedUsd, settledUsd? }] (no settledUsd = in flight). */
export function stoppedKid(t, key, node, id, grantUsd, calls) {
  registerKid(t, key, node, id, grantUsd);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim(node, id, process.pid, 1, hostnameOf()) });
  spend(t, node, id, calls);
  appendTreeEvent(t.rootDir, { event: 'node_stopped', node, generation: 1, runId: id, reason: 'budget' });
}
export function spend(t, node, id, calls) {
  const usage = calls.filter(c => c.settledUsd !== undefined).map(c => ({ file: `stage-${c.id}`, usd: c.settledUsd, reservationId: c.id }));
  syntheticRun(t, id, { usage });
  writeLines(t, id, node, calls.flatMap(c => [reservedLine(c.id, c.reservedUsd, `stage-${c.id}`), ...(c.settledUsd !== undefined ? [settledLine(c.id, 'recorded', c.settledUsd)] : [])]));
}

