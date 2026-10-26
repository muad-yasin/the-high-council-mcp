// M5f (the maintainer's ruling): a node_closed written by RECOVERY from the run's files carries returnedUsd, computed by the one function the member's exit hook and `--close` use (returnedUsdOf). Before, it
// carried none, so a share released through recovery never reached the pool as far as L17 could see: the budget-refused sibling was never offered again. All-mock, $0.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_FILE, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { recoverTree } from '../src/tree-recovery.js';
import { runFactsOfIn, runTree } from '../src/tree-run.js';
import { returnedUsdOf } from '../src/tree-budget.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { capFor, ceilCents, pricedDebateFigures } from './helpers/money-figures.js';
import { SPLIT_ROOT_HANDOFF_USD } from './helpers/tree-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { presenceProblems } from './helpers/event-presence.js';

test('L17 THROUGH RECOVERY: R/M3 ran and closed, its end event is lost, recovery closes it from report.json WITH returnedUsd (= returnedUsdOf), and the budget-refused R/M1 is offered again; the written event passes the presence audit', { timeout: 300_000 }, async () => {
  // CHANGED (0.8.3 estimator unit, 3c62802: the upper-estimate rows count the system text, so priced-debate's cheapest end rose 3.2 -> 4.119 and its at-most 4.0 -> 4.919; the 11 fixtures of 1e81a99 missed this one). OLD cap 8, NEW cap 10, the same relation:
  //   first pass: R/M1 is refused for budget: OLD share (8 - 0.04) / 3 = 2.65 < 3.2; NEW (10 - 0.04) / 3 = 3.32 < 4.119.
  //   after R/M3's unspent share is back (the two children left share what is available): OLD about 7.9 / 2 = 3.95, over 3.2 by 23%; NEW (10 - 0.08) / 2 = 4.96, over 4.119 by 20%. (At cap 9 the measured margin was 4.46 over 4.119, 8%: too thin to keep the case's meaning.)
  // WHY: a stale literal, not a changed behaviour.
  // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); this test passed on fad02049 and typed the same class of figure). OLD: cap 10 typed (the first share under the cheapest end, the two left 20% over it). NEW: S = 1.2 x priced-debate's own cheapest end (the share the two left children get once R/M3's unspent share is back), the cap is the pool that gives it, so the first share of three, 0.8 x the cheapest end, is under it. WHY: the figures move with every recorded or reworded sentence in src/roles.js.
  const S = ceilCents(1.2 * pricedDebateFigures().cheapestUsd);
  const r = await trackedRealRoot({ ...pricedChildren(), cap: capFor(S, 2, 2 * SPLIT_ROOT_HANDOFF_USD) });      // the root's own handoff and R/M3's, each SPLIT_ROOT_HANDOFF_USD, are spent when the other two share what is left
  approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(out.started.map(s => s.node), ['R/M3'], 'only the independent admitted child ran; R/M1 was refused for budget');
  const original = eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R/M3');
  assert.ok(original.returnedUsd > 0, 'the member\'s own close gave its unspent share back');
  // the process "died before writing its end event"
  const file = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const kept = lines.filter(l => !(JSON.parse(l).event === 'node_closed' && JSON.parse(l).node === 'R/M3'));
  assert.equal(kept.length, lines.length - 1); writeFileSync(file, `${kept.join('\n')}\n`);
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir }), null, 'before recovery nothing was released: nothing is offered');
  await recoverTree(r.t.rootDir, { runFactsOf: runFactsOfIn(r.t.runsDir), facts: { pidAlive: () => false } });
  const closed = eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R/M3');
  assert.ok(closed, 'recovery closed it from the files');
  const n = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M3@g1');
  assert.equal(closed.returnedUsd, returnedUsdOf(n, join(r.t.runsDir, n.runId), 0), 'the one function');
  assert.equal(closed.returnedUsd, original.returnedUsd, 'the same figure the member\'s own hook wrote');
  assert.deepEqual(presenceProblems([closed]), [], 'row 16: the recovery writer carries what the member hook carries (returnedUsd, thinContractSha256)');
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending, 'the released share offers the budget-refused child again (L17), through recovery');
  const child = Object.fromEntries(describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending }).view.children.map(c => [c.node, c]))['R/M1'];
  assert.equal(child.admitted, true); assert.ok(child.grant > 0, 'proposed again, with a grant');
  // and through the SITTING: the next sitting ends waiting for that approval (exit 20)
  const again = await runTree(r.t.rootDir, { work: r.t.work, facts: { pidAlive: () => false }, startRun: draftStarter(r) });
  assert.equal(again.approvalWaits, true); assert.equal(again.status, 'nothing_to_do');
});
