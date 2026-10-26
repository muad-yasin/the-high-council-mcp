// CR-2F-002 / B7 (25 Okt 2026): two children blocked at node level in ONE verdict, one the PROVIDER of the other (the consumer expects an agreement from it), were both given a stop in one hold: the pending list was computed once, and the
// provider's stop (whose affected set puts the consumer in question) was written after the consumer already had its own. The hold now opens ONE child at a time, re-reads after each stop, and picks a child that no other pending child's
// affected set contains (a provider before its consumers), whatever the path order. Real all-mock trees; the report.json of a node is edited the way a bad handoff lint would arrive (as test/tree-blocked-child.test.js does).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateOf, readTreeRecord } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';

/** The base block: K1 (-> R/M1) provides A1 to K2 (-> R/M2). `swap` reverses it: K2 provides A1 to K1, so the CONSUMER (R/M1) sorts before its provider (R/M2). */
function block({ swap = false } = {}) {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  if (swap) {
    const [k1, k2] = b.children; const empty = (...ss) => ss.map(sibling => ({ sibling, agreements: [] }));
    k1.provides = empty('K2', 'K3'); k1.expects = [{ sibling: 'K2', agreements: ['A1'] }, ...empty('K3')];
    k2.provides = [{ sibling: 'K1', agreements: ['A1'] }, ...empty('K3')]; k2.expects = empty('K1', 'K3');
    b.agreements = [{ ...b.agreements[0], from: 'K2', to: 'K1' }];
  }
  return b;
}
async function finishedTree(opts) {
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(block(opts), { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
function lintFinding(r, node) {
  const n = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node);
  const file = join(r.t.runsDir, n.runId, 'report.json'); const rep = JSON.parse(readFileSync(file, 'utf8'));
  rep.handoff_milestones = { ...rep.handoff_milestones, findings: [{ kind: 'unknown_criterion', message: 'M0 names C3' }] };
  writeFileSync(file, JSON.stringify(rep));
}
const blockedStops = r => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked');

for (const [name, swap, provider, consumer] of [['BH-1 provider sorts first (R/M1 provides to R/M2)', false, 'R/M1', 'R/M2'], ['BH-2 CONSUMER sorts first (R/M2 provides to R/M1): the order-independent pick', true, 'R/M2', 'R/M1']]) {
  test(`${name}: both are blocked in one verdict, ONE stop is written (the provider's), and the consumer is in its affected set`, async () => {
    const { r, start } = await finishedTree({ swap });
    assert.deepEqual(blockedStops(r), [], 'a healthy tree opens none');
    lintFinding(r, provider); lintFinding(r, consumer);
    await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
    const stops = blockedStops(r);
    assert.deepEqual(stops.map(s => s.node), [provider], `one stop, the provider's (got ${JSON.stringify(stops.map(s => s.node))})`);
    assert.ok(stops[0].affected.some(a => a.node === consumer), 'the consumer is in the provider\'s affected set');
    assert.ok(stateOf(readTreeRecord(r.t.rootDir)).stale.has(`${consumer}@g1`), 'and it is stale because of that stop');
  });
}
