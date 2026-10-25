// 0.8.3 M7 apply, C2b-2: the ADOPTED WALK to the end (C&C thcmcp-6d condition 2(iii); the Q6 probe of the C2b plan, with its expected values written BEFORE the run in Review/Build_0.8.3/m7/C2b2_Plan_DRAFT_2026-10-18.md section 3). A real root (the held-release X1 tree: all-mock chains, the real verbs and sittings, $0)
// whose first plan had R/M1 finished and passed is re-planned; the new root plan R@g2 SWAPS the milestones of K1 and K2 (F1 is a label, so the content match MOVES R/M1@g1 into the slot R/M2 at the same level). The person approves the new children frontier; the sitting runs the rest.
// Expected values (first written in the plan draft; the plan's rename design failed its first runs and became a swap, 18 Okt 2026, so these are the values of the design as it stands): the slot R/M2 is never registered and holds no money; R/M1 and R/M3 are registered with an equal share over THEMSELVES (k = 2); R/M1@g1's earlier spend is counted once; the agreement A1 (K1 to K2) now runs from the SLOT R/M2 to R/M1, and `tree check` names the adopted node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/api.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { bundleDirOf } from '../src/tree-continuation.js';
import { describeFrontier, findPendingFrontier, rootReplanBound, rootTaskTextOf } from '../src/tree-frontier.js';
import { effectiveLimits } from '../src/tree-budget.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { treeStatusPayload } from '../src/mcp/tree-status.js';
import { buildTreeReport } from '../src/tree-report.js';
import { writeTreeHandoff } from '../src/tree-handoff.js';
import { runTree } from '../src/tree-run.js';
import { affectedFor } from '../src/tree-affected.js';
import { subplanAffectedWanted, candidatesOf } from '../src/tree-transitions.js';
import { planRecovery } from '../src/tree-recovery.js';
import { fanOutOf } from '../src/tree-fan-out.js';
import { renderFrontierText } from '../src/tree-stop.js';
import { buildCheck } from '../src/tree-check.js';
import { amendCap, budgetOf } from '../src/tree-budget.js';
import { gatherReadinessFacts, verdictOf } from '../src/tree-ready.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { ceilCents, pricedDebateFigures } from './helpers/money-figures.js';

const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const io = answers => { const t = terminal(answers); const timer = setTimeout(() => t.stdin.end(), 8000); t.stop = () => clearTimeout(timer); return t; };

/** The new root plan's block with the milestones of K1 and K2 SWAPPED: K1's content (the finished R/M1@g1 of the first plan) now sits in the slot R/M2, K2's in R/M1. F1, the milestone, is a label: the content match MOVES R/M1@g1 into R/M2 (same level). The agreement A1 (K1 -> K2) now runs from the slot R/M2 to the slot R/M1. */
function swappedBlock() {
  const b = block3(); const [m1, m2] = [b.milestones.find(m => m.id === 'M1'), b.milestones.find(m => m.id === 'M2')];
  for (const f of ['basis', 'open_question']) [m1[f], m2[f]] = [m2[f], m1[f]];        // the milestones' own questions travel with the children (F3 compares the open question)
  b.children.find(c => c.id === 'K1').milestone = 'M2'; b.children.find(c => c.id === 'K2').milestone = 'M1';
  return b;
}

async function walk({ rename = true, changed = false, maxChildren = null, stopAtChildren = false, cap = 100, freeAtApproval = null } = {}) {
  const r = await trackedRealRoot({ ...pricedChildren(), cap, ...(maxChildren ? { limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: maxChildren, attemptsPerChild: 1 } } : {}) }); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });                     // the first plan's R/M1 runs and closes passed
  const stop = appendTreeEvent(r.t.rootDir, STOP);
  let t = io(['Plan it again, offline store first.\n.', stop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0);
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  t = io([pending.key.slice(0, 8), 'y']);                                                                       // the new root plan R@g2 is approved (a root replan frontier), as the held-release walk does
  assert.equal(await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0, t.shown() + t.errors());
  writeFileSync(join(r.t.work, 'plan-r2.md'), planWith((() => { const b = rename ? swappedBlock() : block3(); if (changed) b.children.find(c => c.id === 'K1').scope += ' Also add an export step.'; return b; })(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
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

test('C2b-2 the adopted walk: R/M1@g1 is MOVED into the slot R/M2, the slot is never registered and holds no money, the others get an equal share over themselves, the earlier spend is counted once', async () => {
  const { r, d, s2, before, after } = await walk();       // MONEY, honest limit: at this cap the chain ceilings (4.00 each) bind, so the share over k = 2 and over k = 3 are both the ceiling and the share check below cannot tell them apart; a tight-cap variant changes the FIRST era (at a cap of 6.12 R/M3 ran instead of R/M1), so it needs its own walk (owed, reported)
  assert.deepEqual([after.treeSpentUsd, after.heldUsd], [before.treeSpentUsd, before.heldUsd], 'MONEY: the approval that adopts a finished run moves no dollar: spent and held are what they were (a grant is issued only when a fresh child registers)');
  const rec = readTreeRecord(r.t.rootDir); const st = stateOf(rec);
  assert.deepEqual([...st.adopted.entries()].map(([k, v]) => [k, v.slot]), [['R/M1@g1', 'R/M2@g2']], 'the finished R/M1 is adopted into the renamed slot');
  const kids = d.preview.children;
  const slot = kids.find(c => c.node === 'R/M2');
  assert.deepEqual([slot.reused.adoptsNode, slot.capUsd, slot.ceilingUsd, slot.admitted], ['R/M1', 0, 0, true]);
  const fresh = kids.filter(c => c !== slot);
  const share = Math.floor(Math.min(...fresh.map(c => c.ceilingUsd), d.view.budget.availableUsd / fresh.length) * 100) / 100;
  assert.deepEqual(fresh.map(c => c.capUsd), fresh.map(c => Math.min(c.ceilingUsd, Math.floor(d.view.budget.availableUsd / fresh.length * 100) / 100)), `MONEY: each new child holds min(its ceiling, the free money / k) with k = the NEW children only = ${fresh.length} (${JSON.stringify(fresh.map(c => [c.node, c.capUsd]))}, available ${d.view.budget.availableUsd}, share ${share})`);
  assert.equal(fresh.length, 2, 'k is 2: the slot is not in the split');
  const registered = rec.events.filter(e => e.event === 'node_registered' && e.generation === 2).map(e => e.node);
  assert.ok(registered.length > 1, `the sitting registered the new children: ${JSON.stringify(s2)}`);
  assert.ok(!registered.includes('R/M2'), `the slot is never registered (${registered.join(', ')})`);
  assert.deepEqual(registered.filter(n => n !== 'R').sort(), fresh.map(c => c.node).sort(), 'every other child is registered');
  const b = budgetOf(r.t.rootDir);
  assert.equal(b.nodes.filter(n => n.key === 'R/M1@g1').length, 1, 'the adopted node appears once in the money');
  const spentOfAdopted = b.nodes.find(n => n.key === 'R/M1@g1').spentUsd;
  assert.equal(spentOfAdopted, before.nodes.find(n => n.key === 'R/M1@g1').spentUsd, 'the adopted run spent nothing new');
  assert.ok(Math.abs(b.treeSpentUsd - b.nodes.reduce((n, x) => n + x.spentUsd, 0)) < 0.0001, 'COUNTED ONCE: the tree spend is the sum of every node spend, the adopted run included exactly once');
  assert.equal(s2.status, 'nothing_to_do', `the walk reaches the end: ${JSON.stringify(s2)}`);
  // the hard-lock question of the C2b plan (Q4/Q6): the adopted node still carries the OLD obligation identities; nothing about it may keep the tree from being judged ready
  const verdict = verdictOf(gatherReadinessFacts(r.t.rootDir, { work: r.t.work }));
  const blockers = verdict.reasons.filter(x => /R\/M1@g1|R\/M2@g2|R\/M2\b/.test(String(x.scope)));
  assert.deepEqual(blockers.map(x => `${x.scope} ${x.code}`), [], `the adopted node and its slot hold nothing back (all reasons: ${JSON.stringify(verdict.reasons.map(x => [x.scope, x.code]))})`);
});

test('C2b-2 the adopted walk: `tree check` on the agreement that touches the MOVED child names the slot and the adopted node', async () => {
  const { r } = await walk();
  const rec = readTreeRecord(r.t.rootDir);
  const b = buildCheck({ rootDir: r.t.rootDir, work: r.t.work, arg: 'R@g2:A1', result: 'fail' });
  assert.ok(!b.refusal, `the check resolves: ${JSON.stringify(b.refusal)} (record: ${rec.events.filter(e => e.event === 'split_verified').length} splits)`);
  assert.deepEqual([b.target.from, b.target.to], ['R/M2', 'R/M1'], 'the ends are PLACES: the slot the adopted node fills (R/M2) and the slot of K2 (R/M1)');
  const listed = b.affected.map(a => `${a.node}@g${a.generation}`);
  assert.ok(listed.includes('R/M1@g1'), `the adopted node is affected (${listed.join(', ')})`);
  assert.ok(b.text.includes('from R/M2 to R/M1'), 'the screen names the slot');
  assert.ok(b.bound.participants.some(p => p.node === 'R/M1' && p.generation === 1), `the check binds the ADOPTED run (${JSON.stringify(b.bound.participants.map(p => [p.node, p.generation]))})`);
});

test('C2b-2 the adopted walk, control: a new root plan that does NOT rename the milestone adopts R/M1 in place (slot R/M1@g2)', async () => {
  const { r, d } = await walk({ rename: false });
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual([...st.adopted.keys()], ['R/M1@g1']);
  assert.equal(st.adopted.get('R/M1@g1').slot, 'R/M1@g2', 'same level, same path: adopted in place');
  assert.equal(d.preview.children.find(c => c.node === 'R/M1').capUsd, 0);
});

test('C2b-2 the width of a split is ONE count: with maxChildrenPerSplit 2 the reused slot fills one place, the first new child the other, the next new child is refused by the limit, and the screen counts the same "2 of 2"', async () => {
  const { r, d } = await walk({ maxChildren: 2 });
  const slot = d.view.children.find(c => c.reused);
  assert.ok(slot, 'the slot is reused');
  const fresh = d.view.children.filter(c => !c.reused);
  assert.deepEqual(fresh.map(c => c.admitted), [true, false], `the first new child fits, the next does not (${JSON.stringify(fresh.map(c => [c.node, c.admitted, c.notAdmittedReason]))})`);
  assert.match(fresh[1].notAdmittedReason, /fan-out limit/);
  assert.deepEqual(d.view.limits.find(l => l.limit === 'children per split'), { limit: 'children per split', count: 2, effective: 2 }, 'the screen counts the reused slot too');
  assert.match(renderFrontierText(d.view), /children per split: 2 of 2/);
  assert.ok(r);
});

test('C2b-2 R15: a candidate that stops being free between the screen and the answer changes what would be approved: the approval is refused, nothing is recorded (known-bad: no damage, the approval goes through)', async () => {
  const run = async damage => {
    const { r } = await walk({ stopAtChildren: true });
    const pending = findPendingFrontier({ rootDir: r.t.rootDir });
    let calls = 0;
    const describe = args => {
      calls += 1;
      if (calls === 2 && damage) { const folder = bundleDirOf(r.t.rootDir, 'R/M1', 1); writeFileSync(join(folder, 'task.md'), `${readFileSync(join(folder, 'task.md'), 'utf8')}\nEdited while the person read.\n`); }
      return describeFrontier(args);
    };
    const t = io([pending.key.slice(0, 8), 'y']);
    const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now(), deps: { describeFrontier: describe } }).finally(t.stop);
    return { code, text: t.shown() + t.errors(), events: readTreeRecord(r.t.rootDir).events, pending };
  };
  const bad = await run(true);
  assert.equal(bad.code, 1, bad.text);
  assert.match(bad.text, /what you were shown has changed/);
  assert.equal(bad.events.filter(e => e.event === 'frontier_approved' && e.frontierKey === bad.pending.key).length, 0, 'nothing was approved');
  const good = await run(false);
  assert.equal(good.code, 0, good.text);
  assert.equal(good.events.filter(e => e.event === 'frontier_approved' && e.frontierKey === good.pending.key).length, 1, 'control: without the damage the same approval is recorded');
});

// CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); the full suite on fad02049 listed it as #3689). OLD: 11.00 free at the approval and two caps of 4.92, the priced-debate ceiling (typed). NEW: the pool is 2.25 x the chain's own at-most figure and the caps are the figure rounded up to the cent.
// WHY: recording the drafted words moves the estimate (priced-debate at-most 4.919 -> 5.02), so a typed pool and a typed cap break on every wording change. The relation is the same: a share over k = 2 (1.125 x the at-most) reaches the ceiling, a share over k = 3 (0.75 x) would not.
test('C2b-2 MONEY: with 2.25 x the chain\'s at-most free at the approval the two NEW children are sized over k = 2 (the pool / 2 reaches their ceilings); the reused slot is not in the split (known-bad: the slot back in the split, k = 3, sizes each at a third of the pool, under the ceiling)', async () => {
  const fig = pricedDebateFigures(); const ceiling = ceilCents(fig.atMostUsd); const free = ceilCents(2.25 * fig.atMostUsd);
  assert.ok(free / 2 >= ceiling && free / 3 < ceiling, 'fixture: a share over two reaches the ceiling and a share over three does not');
  const { d } = await walk({ freeAtApproval: free });
  const slot = d.preview.children.find(c => c.reused);
  const fresh = d.preview.children.filter(c => !c.reused);
  assert.equal(slot.capUsd, 0);
  // CHANGED (24 Okt 2026, C&C ruling on PX finding 2): availableUsd is cap - spent - held with no rounding, so a derived cap can read 11.290000000000001 for 11.29; the assertion is about the cent, so it compares in cents
  assert.equal(Math.round(d.view.budget.availableUsd * 100) / 100, free, `the cap was lowered so that ${free} is free`);
  // (19-20 Okt 2026 history of this row: the ceiling moved with the estimator, and a binding at-most is granted whole, rounded up to the cent: test/tree-grant-rounding.test.js)
  assert.deepEqual(fresh.map(c => c.capUsd), [ceiling, ceiling], `a share over k = 2 reaches the ceiling (${JSON.stringify(fresh.map(c => [c.node, c.capUsd, c.ceilingUsd, c.notAdmittedReason]))})`);
});

// C2b-2 money fix-up 2 (plan Review/Build_0.8.3/m7/C2b2_Money_Fixup_Plan_2026-10-19.md; found by the plain-stop probe, disclosed to C&C 19 Okt): a SECOND preview of the adopting split. A plain stop on R/M1@g2 (the consumer of the swapped agreement) re-plans it, and in a root-era-2 tree the standard frontier is previewed AGAIN under a new key.
// Before the fix the new preview lost the slot's `reused` entry and the sitting REGISTERED R/M2@g2 fresh with a $4.00 grant beside the adopted run (one key, two fillers). Expected values, written before the run: R/M2 is registered by nobody and no node_registered names it; the adoption is unchanged (R/M1@g1 -> R/M2@g2);
// the second frontier shows the slot as held by the finished run (not admitted, no grant) and its width counts the slot once; the sitting ends quiet (nothing_to_do, no approval waiting). FIXED sittings after the approval (a loop that stops on the status of the sitting before the approval ran no sitting at all and gave two false findings).
test('C2b-2 fix-up 2 MONEY: after a plain stop re-previews the adopting split under a new key, the slot R/M2 is still reused: never registered, no grant, nothing stranded', async () => {
  const { r, start } = await walk({});
  const rec0 = readTreeRecord(r.t.rootDir); const st0 = stateOf(rec0);
  const first = st0.adopted.get('R/M1@g1').frontierKey;
  const { affected } = affectedFor({ record: rec0, state: st0, runsDir: r.t.runsDir, node: 'R/M1', generation: 2 });
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 2, runId: st0.nodes.get('R/M1@g2').runId, source: 'status', affected });
  const t = io(['Plan it again.\n.', stop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0, t.shown() + t.errors());
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: start });
  approvePending(r);
  let s = null;
  for (let i = 0; i < 8; i += 1) s = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 5, startRun: start });       // a FIXED number of sittings
  const rec = readTreeRecord(r.t.rootDir); const st = stateOf(rec);
  assert.deepEqual([...st.adopted.entries()].map(([k, v]) => [k, v.slot]), [['R/M1@g1', 'R/M2@g2']], 'the adoption is unchanged');
  assert.equal(rec.events.filter(e => e.event === 'node_registered' && e.node === 'R/M2').length, 0, 'MONEY: no fresh run, so no $4.00 grant, was registered for the slot the finished run fills');
  assert.equal(st.nodes.has('R/M2@g2'), false);
  // AMENDED 19 Okt 2026 (era-2 unit; was: the second preview shows the slot as held): the plain stop no longer re-keys the standard frontier. The replacement is previewed by the decision's own frontier with ONLY the opened child, and registers at the opened number. The held child and the width are pinned in test/tree-adoption-slot-guard.test.js rows 1 and 3.
  const replacement = [...st.frontiers].filter(([k, f]) => k !== first && f.parentNode === 'R' && f.parentGeneration === 2);
  assert.deepEqual(replacement.map(([, f]) => f.children.map(c => `${c.node}@g${c.generation}`)), [['R/M1@g3']], 'the replacement frontier carries the opened child only, no R/M2');
  assert.ok(st.nodes.has('R/M1@g3'), 'the replacement registered at the OPENED number');
  assert.equal(s.status, 'nothing_to_do', JSON.stringify(s));
  assert.equal(s.approvalWaits, false, 'nothing is stranded behind an approval');
});

test('Regenerate of a REUSED node at the MAXIMUM width (maxChildrenPerSplit 2: the slot + one new child = 2 of 2): the stop on the adopted R/M1@g1 opens the next generation of its SLOT R/M2 (and of its consumer R/M1), the adoption lapses at the OPENING (before anything is registered) and stops counting in the width, and the frontier proposed afterwards admits the slot again (no hard lock); known-bad: openingOf as before opens R/M1 at g2, a generation that exists', async () => {
  const { r, d } = await walk({ maxChildren: 2 });
  const rec0 = readTreeRecord(r.t.rootDir); const st0 = stateOf(rec0);
  const adoptingKey = [...st0.adopted.values()][0].frontierKey;
  assert.equal(fanOutOf(st0, adoptingKey), 2, 'before: one registered new child + the adopted slot = the whole width');
  const { affected } = affectedFor({ record: rec0, state: st0, runsDir: r.t.runsDir, node: 'R/M1', generation: 1 });
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: st0.nodes.get('R/M1@g1').runId, source: 'status', affected });
  appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, affected: subplanAffectedWanted(stateOf(readTreeRecord(r.t.rootDir)), stop.id), ...GATE_FIELDS });
  const opening = planRecovery(readTreeRecord(r.t.rootDir), { runFactsOf: () => ({}) }).find(a => a.action === 'append' && a.event.event === 'generation_opened');
  assert.deepEqual(opening.event.nodes.map(n => `${n.node}@g${n.generation}`).sort(), ['R/M1@g3', 'R/M2@g3'], 'the SLOT R/M2 (was g2) and the consumer R/M1 (was g2) are opened at 3');
  appendTreeEvent(r.t.rootDir, opening.event);
  const rec = readTreeRecord(r.t.rootDir); const st = stateOf(rec);
  assert.equal(st.adopted.size, 0, 'the adoption lapsed at the opening, nothing registered yet (the lapse fires on OPENED)');
  assert.equal(fanOutOf(st, adoptingKey), 1, 'and it no longer counts in the width of the adopting frontier');
  assert.equal(candidatesOf(st).find(c => c.key === 'R/M1@g1')?.state, 'set_aside', 'R/M1@g1, listed by the decision that plans it again, is SET ASIDE (the root route; on the sub-plan route of test/tree-carriers-adopted.test.js it stays a kept candidate)');
  const pf = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pf && pf.key !== adoptingKey, 'a frontier is proposed for the replaced slot');
  const view = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: pf }).view;
  const slotAgain = view.children.find(c => c.node === 'R/M2');
  assert.equal(slotAgain.admitted, true, `the slot is admitted again, not refused by the width (${JSON.stringify(view.children.map(c => [c.node, c.generation, c.admitted, c.notAdmittedReason]))})`);
  assert.equal(slotAgain.generation, 3, `at the OPENED number of the slot (${slotAgain.generation}); era-2 unit: the frontier no longer counts one above it`);
  assert.ok(d);
});

test('REAL-VERB PROBE, regenerate of a reused node: `council tree decide --stop` on the adopted R/M1@g1 (the stop itself is appended; the verb, the recovery step, the approval and the sitting are the real ones) ends at nothing_to_do with the slot R/M2 registered afresh', async () => {
  // Expected values: the screen carries the reused line; the verb exits 0; the sitting opens R/M2@g3 and R/M1@g3 (written before the first run); the slot registers afresh and the sitting ends nothing_to_do; readiness holds no reason on R/M1@g1, R/M2@g2 or R/M2@g3. The number 4 for the new registrations was NOT written blind: it comes from a first run (the frontier counts one above the opened 3 once the root has re-planned).
  const { r, start } = await walk({});
  const rec0 = readTreeRecord(r.t.rootDir); const st0 = stateOf(rec0);
  const { affected } = affectedFor({ record: rec0, state: st0, runsDir: r.t.runsDir, node: 'R/M1', generation: 1 });
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: st0.nodes.get('R/M1@g1').runId, source: 'status', affected });
  const t = io(['Plan it again.\n.', stop.id, 'y']);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop);
  assert.equal(code, 0, t.shown() + t.errors());
  assert.match(t.shown(), /R\/M1@g1 is reused finished work: it fills the slot R\/M2\. Recording this plans that slot again, and the finished run no longer fills it\./);
  let s = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: start });
  const opened = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'generation_opened').at(-1);
  assert.deepEqual(opened.nodes.map(n => `${n.node}@g${n.generation}`).sort(), ['R/M1@g3', 'R/M2@g3'], JSON.stringify(s));
  approvePending(r);
  s = null;
  for (let i = 0; i < 8; i += 1) s = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 5, startRun: start });       // a FIXED number of sittings, `s` reset: a loop that stops on the status of the sitting BEFORE the approval ran no sitting after it (twice a false finding)
  assert.equal(s.status, 'nothing_to_do', JSON.stringify(s));
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.ok(st.nodes.has('R/M2@g3') && st.nodes.has('R/M1@g3'), 'the slot and its consumer are registered afresh at the OPENED numbers (era-2 unit: opened == registered)');
  assert.equal([...st.nodes.keys()].some(k => /@g4$/.test(k)), false, 'nothing is registered one above the opened number');
  const slotRegs = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'node_registered' && e.node === 'R/M2').map(e => e.generation);
  assert.deepEqual(slotRegs, [3], 'EXACTLY ONE registration for the slot path after the regenerate, at the opened number and at no other (the adoption lapsed, so slotHeldBy no longer guards it)');
  const openedNow = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'generation_opened').at(-1).nodes;
  for (const o of openedNow) assert.ok(st.nodes.has(`${o.node}@g${o.generation}`) && [...st.nodes.keys()].filter(k => k.startsWith(`${o.node}@g`)).every(k => Number(k.split('@g')[1]) <= o.generation), `${o.node} registers at exactly the number openingTargetOf opened (${o.generation}): below it the slot would be refused as superseded, above it part 7 is lost`);
  for (const path of ['R/M2', 'R/M1']) assert.ok(readFileSync(join(bundleDirOf(r.t.rootDir, path, 3), 'context.md'), 'utf8').includes('Plan it again.'), `part 7 of ${path}@g3 holds the person's decision text (the adopted copy of the era-2 push-blocker)`);
  // BUNDLE UNIT step 2 (slot route): the stopped plan is offered as data to the SLOT it filled (R/M2), not to its consumer R/M1; the adoption lapsed at the opening, so the target was fixed at decide
  assert.equal(readFileSync(join(bundleDirOf(r.t.rootDir, 'R/M2', 3), 'old-plan.md'), 'utf8').length > 0, true, 'the slot R/M2@g3 holds the earlier plan');
  assert.equal(existsSync(join(bundleDirOf(r.t.rootDir, 'R/M1', 3), 'old-plan.md')), false, 'its consumer R/M1@g3 does not');
  const reasons = verdictOf(gatherReadinessFacts(r.t.rootDir, { work: r.t.work })).reasons.filter(x => /R\/M1@g1|R\/M2@g2|R\/M2@g3/.test(String(x.scope)));
  assert.deepEqual(reasons.map(x => `${x.scope} ${x.code}`), []);
});

// 0.8.3 M7 C3 step a (fate codes in the preview, bound by boundSha256): what became of every candidate the reuse check looked at is a CODE in frontier_previewed.candidates (never words: the printed text is bound by the gate's shownSha256).
test('C3 a: the preview of the adopted walk carries the fate CODE of the candidate, the approval binds it, and a second description right after the approval gives the SAME hash', async () => {
  const { r } = await walk({ stopAtChildren: true });
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const d0 = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.deepEqual(d0.preview.candidates, [{ key: 'R/M1@g1', fate: 'adopted', reason: 'same', slot: 'R/M2@g2' }], 'the finished R/M1@g1 is adopted into R/M2@g2: codes only');
  const d = approvePending(r);
  const f = stateOf(readTreeRecord(r.t.rootDir)).frontiers.get(d.frontierKey);
  assert.equal(f.previewHash, d0.boundSha256, 'the approval bound the hash that includes the codes');
  const storedEv = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === d.frontierKey).at(-1);
  assert.deepEqual(storedEv.candidates, d0.preview.candidates, 'the stored preview event carries the codes the approval bound');
  const reusedSlots = d0.preview.children.filter(c => c.reused).map(c => `${c.node}@g${c.generation}`).sort();
  assert.deepEqual(d0.preview.candidates.filter(c => c.fate === 'adopted').map(c => c.slot).sort(), reusedSlots, 'INVARIANT: every reused child has an adopted candidate in the same slot, and the reverse');
  const again = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) ?? pending });
  assert.equal(again.boundSha256, f.previewHash, 'right after the approval the frontier describes to the SAME hash (no silent re-preview, no invalid approval)');
});

test('C3 a, golden: the ROOT route is untouched by the fate codes - the root re-plan preview carries none, and the writer and the loop (rootReplanBound) give the same hash', async () => {
  const { r } = await walk({ stopAtChildren: true });
  const rec = readTreeRecord(r.t.rootDir); const st = stateOf(rec);
  const rp = rec.events.filter(e => e.event === 'frontier_previewed' && e.kind === 'root_replan').at(-1);
  assert.ok(rp, 'the walk approved a root re-plan frontier');
  assert.equal('candidates' in rp, false, 'a root re-plan preview carries no fate codes');
  const decision = rec.events.find(e => e.event === 'decision_recorded' && e.id === rp.openedBy);
  const task = rootTaskTextOf(rec.tree);
  const payload = { frontierKey: rp.frontierKey, kind: rp.kind, openedBy: rp.openedBy, parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: rp.children };
  assert.equal(rootReplanBound({ preview: payload, limits: effectiveLimits(rec.tree, rec.events), decisionText: decision.text, taskText: task.text, oldPlan: decision.oldPlan ?? null }), st.frontiers.get(rp.frontierKey).previewHash, 'the loop recompute equals the stored hash');       // CHANGED ACCEPTED (bundle unit step 2): OLD no oldPlan; NEW the recorded choice about the earlier plan is part of what the approval binds, and the loop recomputes with it. WHY: data is the default.
  // known-bad input: a writer that gained a field the loop's payload does not carry would no longer match
  assert.notEqual(rootReplanBound({ preview: { ...payload, candidates: [{ key: 'x', fate: 'kept', reason: 'scope' }] }, limits: effectiveLimits(rec.tree, rec.events), decisionText: decision.text, taskText: task.text }), st.frontiers.get(rp.frontierKey).previewHash, 'a root preview with a field the loop does not rebuild would not match: the row can fail');
});

test('C3 b: the screen prints the pass-2 per-child line for a REUSED slot and for a CHANGED one, and the passed-over candidate; the codes are bound, the words are not', async () => {
  const a = await walk({ stopAtChildren: true });
  const da = describeFrontier({ rootDir: a.r.t.rootDir, work: a.r.t.work, pending: findPendingFrontier({ rootDir: a.r.t.rootDir }) });
  const ta = renderFrontierText(da.view);
  assert.match(ta, /R\/M2: same \(scope identical; acceptance list identical: \d+ items?; .*\): REUSED: no new run and no new spend; run \S+ and its spend \$[\d.]+ carried\./, ta);
  assert.match(ta, /That run was R\/M1 generation 1 in the earlier plan\./);
  const adopted = budgetOf(a.r.t.rootDir).nodes.find(n => n.key === 'R/M1@g1');
  assert.ok(ta.includes(`and its spend ${'$' + adopted.spentUsd.toFixed(2)} carried`) || ta.includes(`and its spend $${adopted.spentUsd} carried`), `the printed figure equals the adopted run's own spend ${adopted.spentUsd}\n${ta}`);
  assert.equal(/B-DRAFT/.test(ta), false, 'no internal marker is printed');
  assert.doesNotMatch(ta, /Earlier finished runs this plan does not use/, 'adopted: nothing passed over');
  const c = await walk({ stopAtChildren: true, rename: false, changed: true });
  const dc = describeFrontier({ rootDir: c.r.t.rootDir, work: c.r.t.work, pending: findPendingFrontier({ rootDir: c.r.t.rootDir }) });
  const tc = renderFrontierText(dc.view);
  assert.match(tc, /R\/M1: changed: scope differs.*: a NEW run \(grant \$[\d.]+\)\./s, tc);
  assert.match(tc, /Earlier finished runs this plan does not use[\s\S]*R\/M1@g1 \(compared with R\/M1@g2\): changed: scope differs/, tc);
  assert.deepEqual(dc.preview.candidates.map(x => [x.key, x.fate, x.reason]), [['R/M1@g1', 'kept', 'scope']], 'the bound fate is the CODE');
  assert.equal(JSON.stringify(dc.preview).includes('scope differs'), false, 'no words in the bound preview');
  assert.equal(/B-DRAFT/.test(tc), false, 'no internal marker is printed');
  const printedKept = [...tc.matchAll(/^  - (R\/\S+@g\d+)/gm)].map(m => m[1]);
  assert.deepEqual(printedKept, dc.preview.candidates.filter(x => x.fate === 'kept').map(x => x.key), 'the printed passed-over keys are the bound kept keys');
  // REAL VERB: the screen the person reads through `council tree approve`, both cases
  for (const [label, w] of [['reused', a], ['changed', c]]) {
    const t2 = io([findPendingFrontier({ rootDir: w.r.t.rootDir }).key.slice(0, 8), 'n']);
    await approveHandler({ rootDir: w.r.t.rootDir, rootId: ROOT_ID, work: w.r.t.work, stdin: t2.stdin, stdout: t2.stdout, stderr: t2.stderr, now: () => Date.now() }).finally(t2.stop);
    const shown = t2.shown();
    assert.equal(/B-DRAFT/.test(shown), false, `${label}: no internal marker on the real screen`);
    if (process.env.C3_PRINT) console.log(`--- ${label}\n` + shown.split('\n').filter(l => /REUSED|a NEW run|Earlier finished|That run was|^  - R\//.test(l)).join('\n'));
  }
});

test('C4a: status, TREE_HANDOFF.md, tree report and the tree_status payload name the adopted run, its slot, the plan it was adopted into and the decision; a tree that adopted nothing gains no field', async () => {
  const { r } = await walk();
  const f = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(f.adoptedNodes.map(o => [o.node, o.generation, o.slot, o.under]), [['R/M1', 1, 'R/M2@g2', 'R@g2']]);
  assert.match(f.adoptedNodes[0].decisionId ?? '', /^e\d+$/, 'the decision that opened the new root plan (the root route reads it from the root_replan frontier)');
  assert.match(renderTreeStatus(f), /Finished runs of an earlier plan that fill a slot of this one:\n  R\/M1 generation 1 \(run \S+\) fills R\/M2@g2 of R@g2, decision e\d+/);
  assert.deepEqual(treeStatusPayload(f).adoptedNodes.map(o => o.slot), ['R/M2@g2'], 'MCP: an ADDITIVE field');
  assert.equal(buildTreeReport(r.t.rootDir, { work: r.t.work }).adoptedNodes.length, 1);
  const h = writeTreeHandoff(r.t.rootDir, { work: r.t.work });
  assert.match(readFileSync(h.path, 'utf8'), /2\. `R\/M1` \(an earlier plan's run that fills `R\/M2`\)\n3\. `R\/M1`\n/, 'the reading order no longer lists two bare R/M1 entries');
  assert.match(readFileSync(h.path, 'utf8'), /### Finished runs of an earlier plan that fill a slot of this one\n\n- R\/M1 generation 1 \(run \S+\) fills R\/M2@g2 of R@g2, decision e\d+/);
  if (process.env.C4_PRINT) console.log('--- HANDOFF\n' + readFileSync(h.path, 'utf8').split('\n').slice(0, 60).join('\n'));
  // golden: nothing adopted, no field anywhere
  const plain = await trackedRealRoot({ ...pricedChildren(), cap: 100 }); approvePending(plain);
  const pf = gatherStatusFacts(plain.t.rootDir, { work: plain.t.work });
  assert.equal('adoptedNodes' in pf, false); assert.equal('adoptedNodes' in treeStatusPayload(pf), false);
  assert.equal('adoptedNodes' in buildTreeReport(plain.t.rootDir, { work: plain.t.work }), false);
});

test('C4a: the abandon screen names the kept earlier runs it retires', async () => {
  const { r } = await walk({ rename: false, changed: true });
  const t = io(['n']);
  await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { abandon: true }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop);
  assert.match(t.shown(), /Finished runs of an earlier plan that are held or kept as candidates; abandoning retires them: R\/M1@g1\./, t.shown() + t.errors());
});

// D2 F10 / D3 F10-1 (CR-2A-002), T10 part (1), real verbs: a node the CURRENT root plan ADOPTED (R/M1@g1, adopted in place into the slot R/M1@g2 by R@g2's children frontier) whose run then fails is judged at the next root re-plan,
// BY PLACE: it sits under R@g2 (its adopting frontier's parent), not under R@g1 (the plan that first registered it). Before, only nodes whose OWN frontier hung under R@rootGen were judged, so it stayed held, eligible for reuse.
test('T10 (1) CR-2A-002: an adopted node of the current root plan whose HANDOFF.md then changes is SET ASIDE at the next root re-plan (listed in the decision\'s affected, candidatesOf not eligible), not held eligible', async () => {
  const { r, start } = await walk({ rename: false });
  const st0 = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st0.adopted.get('R/M1@g1')?.slot, 'R/M1@g2', 'R/M1@g1 is adopted in place by R@g2\'s frontier');
  const m1 = st0.nodes.get('R/M1@g1');
  writeFileSync(join(r.t.runsDir, m1.runId, 'HANDOFF.md'), `${readFileSync(join(r.t.runsDir, m1.runId, 'HANDOFF.md'), 'utf8')}\nA late change to the adopted run.\n`);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });                            // the sitting meets the changed file: a stop on R/M1@g1
  let t = io(['The adopted store no longer matches its run: plan again.\n.', 'R@g2', 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { 'open-root-stop': true }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0, t.shown() + t.errors());
  const rootStop = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'needs_decision_opened' && e.node === 'R').at(-1);
  t = io(['Plan it again.\n.', rootStop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: rootStop.id }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop), 0, t.shown() + t.errors());
  const dec = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'decision_recorded' && e.stopId === rootStop.id).at(-1);
  assert.ok(dec.affected.some(a => a.node === 'R/M1' && a.generation === 1), `the adopted R/M1@g1 is in the decision's affected: ${JSON.stringify(dec.affected)}`);
  const cand = candidatesOf(stateOf(readTreeRecord(r.t.rootDir))).find(c => c.key === 'R/M1@g1');
  assert.ok(cand && cand.eligible !== true, `R/M1@g1 is not held eligible: ${JSON.stringify(cand)}`);
});
