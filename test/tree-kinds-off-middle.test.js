// BUG-B-007 (lane B bug audit, 24 Okt 2026): a tree whose ROOT chain has criterion kinds ON and whose CHILD chain has them OFF. The child's run takes the inherited checkable item as plain text and records no `criteria_kinds`
// (src/chain.js takeCriteria / src/report-shape.js: kinds are recorded only for a kinds-on chain), so when that child itself splits, tree-derive-load's formsOfReport gave the plain string while the origin's identity holds the object
// form: parentObligations threw `weakened_obligation` ("in words that are not the origin's") although the words were identical, and every `council tree approve` of the grandchildren frontier was refused. The parent's own copy
// is now accepted when its TEXT still hashes to the origin's, and the grandchildren inherit the ORIGIN's form, so the checkable item stays check_not_enforced instead of silently becoming plain text. Real flow, all-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { heldKindsMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

test('a kinds-OFF child that splits: its grandchildren frontier is described (no weakened_obligation) and the inherited checkable item is still not enforced, with its check', async () => {
  const r = await trackedRealRoot(heldKindsMilestoneChildren()); approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const one = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r, { 'R/M1': 'plan-a.md' }) });
  assert.deepEqual(one.verified.map(v => [v.node, v.refusal]), [['R/M1', null]], JSON.stringify(one));
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.equal(pending?.parent?.node, 'R/M1', 'the kinds-off child\'s own split waits for approval');
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  const held = d.view.children.filter(c => c.notEnforced.length > 0);
  assert.ok(held.length > 0, 'the checkable item the grandchildren inherit is still check_not_enforced (its kind survived the plain-text hop)');
  assert.ok(held.every(c => c.notEnforced.every(n => typeof n.check === 'string' && n.check.length > 0)), JSON.stringify(held.map(c => c.notEnforced)));
});
