// E170 (0.8.3 M7 apply, Fable pass-2 final wording): the stop screen of a node whose plan cannot be read (a blocked code plan_unreadable) says how to put it right, and names `--accept-plan` (E172), the route that exists now.
// A pure render over a hand-built view: offline, $0, no run folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNeedsDecisionStop } from '../src/tree-stop.js';

const view = codes => ({
  stopId: 'e9', rootId: 'RID', node: 'R/M2', generation: 1, blockedBy: codes.map(code => ({ code, text: 'x' })), acceptedPlan: null, person: null, provides: [], expects: [], affected: [], independent: [],
  held: 0, budget: { rootCapUsd: 5, spentUsd: 0, heldUsd: 0, availableUsd: 5 }, limits: [], unexpanded: [],
});
const screen = codes => renderNeedsDecisionStop(view(codes));      // returns the screen as one string

test('E170: a plan_unreadable stop says to put deliverable.md back as the run wrote it, what the sitting compares, and the accept route', () => {
  const text = screen(['plan_unreadable']);
  assert.ok(text.includes("Put deliverable.md of R/M2 back exactly as the run wrote it (in that run's folder): the next `council tree resume` closes this stop by itself when the plan text matches what was recorded (and, where a contract check failed, when that check passes again), and says so."), text);
  // CHANGED ACCEPTED TEST (G7, Fable FINAL T-04, 26 Okt 2026). OLD: 'A file that was changed is not closed that way: its answers are a new plan (regenerate), abandon, or accepting the change: `council tree decide RID --accept-plan --stop e9`.'
  assert.ok(text.includes('If the change was meant, the stop is not closed that way: its answers are a new plan (regenerate), abandon, or accepting the change with `council tree decide RID --accept-plan --stop e9`.'), text);
});

test('E170 CONTROL (passes at base too): a stop that holds only report_unreadable keeps its own restore hint and gets no plan hint', () => {
  const text = screen(['report_unreadable']);
  assert.ok(text.includes('Restore the report.json of R/M2 first'), text);
  assert.equal(text.includes('Put deliverable.md'), false);
});
