// BUG-C-058 (bug audit 2026-10-24, second audit of the tree files): a split frontier approved with a child "not admitted: budget" is offered again at `council tree approve` after a cap raise (frontierOffersShare; test/tree-amend-cap.test.js).
// The ROOT RE-PLAN branch of findPendingFrontier lacked that term, so a root re-plan approved while the new root run was not admitted for budget could never be offered again: "Nothing waits for your approval" for ever, although the screen,
// `--amend-cap` and tree-decide.js promise "A child that was not admitted for budget is offered again at `council tree approve`". Driven on a real mock tree, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { amendCap, budgetOf, ceilCents } from '../src/tree-budget.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { registerNextChild } from '../src/tree-loop.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';

const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const TYPED = 'Plan it again, offline store first.';
const AMEND = { gateId: GATE_FIELDS.gateId, shownSha256: GATE_FIELDS.shownSha256, actor: GATE_FIELDS.actor, via: GATE_FIELDS.via };
const io = answers => { const t = terminal(answers); const timer = setTimeout(() => t.stdin.end(), 8000); t.stop = () => clearTimeout(timer); return t; };
// a real root, R/M1 finished and passed, a stop on the root, and the re-plan decision recorded through the real verb (as test/tree-root-frontier.test.js)
async function decided() {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const stop = appendTreeEvent(r.t.rootDir, STOP);
  const t = io([`${TYPED}\n.`, stop.id, 'y']);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id, fresh: true }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop);
  assert.equal(code, 0, t.shown() + t.errors());
  return r;
}
const approve = async (r, answers) => { const t = io(answers); const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop); return { code, t }; };

test('C-058: a root re-plan approved while the new root run was not admitted for budget is offered again after the cap is raised, and then registers', async () => {
  const r = await decided();
  const b = budgetOf(r.t.rootDir); const cap0 = b.rootCapUsd;
  // the person lowers the cap to what is committed before approving: no money is free for the new root run
  amendCap(r.t.rootDir, { toCapUsd: Math.max(0.01, ceilCents(b.treeSpentUsd + b.unknownSpendHeldUsd + b.heldUsd)), expectedRevision: 1, ...AMEND });
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.equal(pending?.kind, 'root_replan', 'precondition: the re-plan frontier waits');
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  assert.deepEqual([d.preview.children[0].admitted, d.preview.children[0].refusedBy], [false, 'budget'], 'precondition: the new root run is shown not admitted for budget');
  const first = await approve(r, [pending.key.slice(0, 8), 'y']);
  assert.equal(first.code, 0, first.t.shown() + first.t.errors());
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir }), null, 'precondition: approved, nothing waits yet (no money has come back)');
  // the cap is raised, as the refusal says
  amendCap(r.t.rootDir, { toCapUsd: cap0 + 20, expectedRevision: 2, ...AMEND });
  const again = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.equal(again?.key, pending.key, 'the raise offers the same re-plan frontier again at `council tree approve`');
  const second = await approve(r, [pending.key.slice(0, 8), 'y']);
  assert.equal(second.code, 0, second.t.shown() + second.t.errors());
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'registered', JSON.stringify(reg)); assert.equal(reg.event.generation, 2);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R@g2').phase, 'registered');
});
