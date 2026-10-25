// 0.8.3 M7 era-2 unit (Review/Build_0.8.3/m7/Era2Frontier_Plan_2026-10-19.md, rows 1-3): in a root-era-2 tree a decision of the CURRENT era registers its replacement at the number it OPENED, with one approval and the person's text in context part 7. Real verbs, all-mock, $0.
// Expected values (written before the run, from the plan): the plain stop on R/M1@g2 opens R/M1@g3; R/M1@g3 is registered (not g4); exactly one frontier_approved follows the decision; nothing is pending after that approval; part 7 of R/M1@g3's context.md holds "Plan it again." and not "this is the first generation".
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/api.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { bundleDirOf } from '../src/tree-continuation.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { runTree } from '../src/tree-run.js';
import { renderFrontierText } from '../src/tree-stop.js';
import { buildCheck } from '../src/tree-check.js';
import { amendCap, budgetOf } from '../src/tree-budget.js';
import { gatherReadinessFacts, verdictOf } from '../src/tree-ready.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';
import { affectedFor } from '../src/tree-affected.js';
import { block3, planWith } from './helpers/split-fixture.js';
const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const io = answers => { const t = terminal(answers); const timer = setTimeout(() => t.stdin.end(), 8000); t.stop = () => clearTimeout(timer); return t; };

// the new root plan CHANGES the first milestone's question and scope text, so nothing finished is adopted: a plain era-2 tree
function divergedBlock() { const b = block3(); const m1 = b.milestones.find(m => m.id === 'M1'); m1.open_question = `${m1.open_question} (revised)`; m1.basis = `${m1.basis} (revised)`; return b; }

async function walk({ rename = false, maxChildren = null, stopAtChildren = false, cap = 100, freeAtApproval = null } = {}) {
  const r = await trackedRealRoot({ ...pricedChildren(), cap, ...(maxChildren ? { limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: maxChildren, attemptsPerChild: 1 } } : {}) }); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });                     // the first plan's R/M1 runs and closes passed
  const stop = appendTreeEvent(r.t.rootDir, STOP);
  let t = io(['Plan it again, offline store first.\n.', stop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0);
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  t = io([pending.key.slice(0, 8), 'y']);                                                                       // the new root plan R@g2 is approved (a root replan frontier), as the held-release walk does
  assert.equal(await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0, t.shown() + t.errors());
  writeFileSync(join(r.t.work, 'plan-r2.md'), planWith(divergedBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const kids = draftStarter(r);
  const rootPlan = ({ chain, bundleDir, runId, grantUsd }) => api.run({ chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}), ...(existsSync(join(bundleDir, 'context.md')) ? { context: join(bundleDir, 'context.md') } : {}), runId, treeNode: join(bundleDir, 'node.json'), cwd: r.t.work, maxUsd: grantUsd, draft: 'plan-r2.md', rounds: 1 });
  const start = opts => (opts.node === 'R' ? rootPlan(opts) : kids(opts));
  const s1 = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: start });
  assert.equal(s1.status, 'limit_reached', JSON.stringify(s1));
  if (stopAtChildren) return { r, start };
  if (freeAtApproval !== null) {       // the person LOWERS the cap (a real library call, as test/tree-cap-amended.test.js) so that only freeAtApproval is free when the children frontier is approved
    const b0 = budgetOf(r.t.rootDir);
    amendCap(r.t.rootDir, { toCapUsd: Math.round((b0.treeSpentUsd + b0.heldUsd + (b0.unknownSpendHeldUsd ?? 0) + freeAtApproval) * 100) / 100, expectedRevision: 1, gateId: GATE_FIELDS.gateId, shownSha256: GATE_FIELDS.shownSha256, actor: GATE_FIELDS.actor, via: GATE_FIELDS.via });
  }
  const before = budgetOf(r.t.rootDir);
  const d = approvePending(r);                                                                                  // R@g2's children frontier: the first approval of a later root generation's children
  const after = budgetOf(r.t.rootDir);
  let s2 = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 5, startRun: start });
  for (let i = 0; i < 6 && s2.status !== 'nothing_to_do'; i += 1) s2 = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 5, startRun: start });       // sit until nothing more runs
  return { r, d, s2, pending, before, after, start };
}

// one plain stop on `node`@g`generation` through the real verb, ONE approval, a FIXED number of sittings
async function cycle(r, start, node, generation, text) {
  const rec0 = readTreeRecord(r.t.rootDir); const st0 = stateOf(rec0);
  const { affected } = affectedFor({ record: rec0, state: st0, runsDir: r.t.runsDir, node, generation });
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node, generation, runId: st0.nodes.get(`${node}@g${generation}`).runId, source: 'status', affected });
  const t = io([`${text}\n.`, stop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0, t.shown() + t.errors());
  const marker = readTreeRecord(r.t.rootDir).events.length;
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: start });
  approvePending(r);
  const pendingAfterApproval = findPendingFrontier({ rootDir: r.t.rootDir });
  for (let i = 0; i < 8; i += 1) await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 5, startRun: start });       // a FIXED number of sittings
  const rec = readTreeRecord(r.t.rootDir);
  return { r, rec, st: stateOf(rec), marker, pendingAfterApproval };
}
async function plainStop() {
  const { r, start } = await walk({});
  return cycle(r, start, 'R/M1', 2, 'Plan it again, with the store first.');
}

test('era-2 numbering, UNIQUENESS across events: two successive current-era regenerates of one path open g3 then g4, each registers at exactly its opened number, no key repeats, and each replaced the one before (guard 1 only covers one event)', async () => {
  const { r, start } = await walk({});
  const first = await cycle(r, start, 'R/M1', 2, 'First reason.');
  const second = await cycle(r, start, 'R/M1', 3, 'Second reason.');
  const openedGens = second.rec.events.filter(e => e.event === 'generation_opened').flatMap(e => e.nodes).filter(o => o.node === 'R/M1').map(o => o.generation);
  const registeredGens = second.rec.events.filter(e => e.event === 'node_registered' && e.node === 'R/M1').map(e => e.generation);
  assert.deepEqual(openedGens, [3, 4], 'the second opening is above the first, in the current era');
  assert.deepEqual(registeredGens.filter(g => g > 2), [3, 4], 'each registered at exactly its opened number');
  assert.equal(new Set(registeredGens).size, registeredGens.length, 'no key repeats');
  assert.equal(second.rec.events.slice(second.marker).filter(e => e.event === 'frontier_approved').length, 1, 'ONE approval for the second replacement');
  assert.ok(readFileSync(join(bundleDirOf(r.t.rootDir, 'R/M1', 4), 'context.md'), 'utf8').includes('Second reason.'), 'part 7 of g4 holds the second decision');
  assert.equal(second.pendingAfterApproval, null, 'no second proposal for the same replacement after its approval');
  assert.equal([...second.st.frontiers.values()].filter(f => f.children.some(c => c.node === 'R/M1' && c.generation === 4)).length, 1, 'exactly one frontier in the record names R/M1@g4 (an opening and a frontier never land on one key twice)');
  assert.ok(first.st.nodes.has('R/M1@g3'));
});

test('era-2 numbering, plain stop (rows 1, 2, 3): the replacement registers at the OPENED number, after ONE approval, and its context part 7 holds the person\'s decision text', async () => {
  const { r, rec, st, marker, pendingAfterApproval } = await plainStop();
  assert.equal(st.adopted.size, 0, 'the fixture is the plain case: nothing was adopted');
  const opened = rec.events.filter(e => e.event === 'generation_opened' && e.nodes.some(o => o.node === 'R/M1')).at(-1).nodes.find(o => o.node === 'R/M1').generation;
  const registeredGens = rec.events.slice(marker).filter(e => e.event === 'node_registered' && e.node === 'R/M1').map(e => e.generation);
  const ctx = readFileSync(join(bundleDirOf(r.t.rootDir, 'R/M1', registeredGens.at(-1)), 'context.md'), 'utf8');
  assert.ok(ctx.includes('Plan it again, with the store first.'), 'part 7 holds the decision text');
  assert.equal(ctx.includes('this is the first generation'), false);
  const registered = registeredGens;
  assert.deepEqual(registered, [opened], `registered at the opened number (opened g${opened}, registered ${registered})`);
  assert.equal(rec.events.slice(marker).filter(e => e.event === 'frontier_approved').length, 1, 'ONE approval after the decision');
  assert.equal(pendingAfterApproval, null, 'nothing else is offered once the replacement is approved');
  // T9b2: the current-era opening is not part of the era boundary, so it is not skipped; the old-era skip itself is test/tree-root-generation.test.js T9b
  assert.ok((st.maxOpenedBoundary.get('R/M1') ?? 0) < opened, 'the boundary map holds only openings from before the root re-plan');
});
