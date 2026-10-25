// BUG-B-006 (lane B bug audit, 24 Okt 2026): a split child whose acceptance list is EMPTY (it inherits nothing, has no obligation of its own, and the parent has no global criterion) passed every split check, was shown on the
// frontier screen as "Admitted" with a grant, was approved, and then every sitting refused it at registration (`no_criteria`, tree-loop.js) and ended `refused`, so the siblings after it never registered. The screen now says
// "not admitted" before the person approves, and the child takes no share of the free money. Real flow on a real root, all-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { renderFrontierText } from '../src/tree-stop.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

/** block3 with every criterion delegated, K1 taking C1 and C2, K2 taking C3 and K3 taking nothing: every check of the split passes (a delegated criterion must be inherited by SOME child). */
function emptyChildBlock() {
  const b = block3();
  b.classes = [{ id: 'C1', class: 'delegated' }, { id: 'C2', class: 'delegated' }, { id: 'C3', class: 'delegated' }];
  b.children[0].inherits = ['C1', 'C2']; b.children[1].inherits = ['C3']; b.children[2].inherits = [];
  return b;
}

test('a child with no acceptance item left is NOT ADMITTED on the frontier screen, with a zero grant and the reason in the bound preview; its siblings are admitted and a sitting starts them', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: planWith(emptyChildBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending, 'the split is verified and waits for approval');
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  const kid = node => d.view.children.find(c => c.node === node);
  assert.equal(kid('R/M3').admitted, false, JSON.stringify(kid('R/M3')));
  assert.equal(kid('R/M3').grant, 0);
  assert.equal(kid('R/M3').refusedBy, 'no_criteria');
  assert.equal(kid('R/M3').notAdmittedReason, 'not admitted: no acceptance item is left after the guards (a run needs a criteria list)');
  assert.equal(kid('R/M1').admitted, true); assert.equal(kid('R/M2').admitted, true);
  assert.match(renderFrontierText(d.view), /no acceptance item is left after the guards/, 'the person reads why before approving');
  const bound = d.preview.children.find(c => c.node === 'R/M3');
  assert.deepEqual([bound.admitted, bound.capUsd, bound.refusedBy], [false, 0, 'no_criteria'], 'the reason is in the bound preview');
  approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.notEqual(out.status, 'refused', JSON.stringify(out));
  const nodes = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.keys()].filter(k => /^R\/M\d@g1$/.test(k)).sort();
  assert.deepEqual(nodes, ['R/M1@g1', 'R/M2@g1'], 'the siblings registered; the child with nothing to accept never did');
});
