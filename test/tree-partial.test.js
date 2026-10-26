// A frontier that is shown AGAIN with children already registered (0.8.3 M5c5; PLAN 8.2, 12 row 3, M5 exit checks L10 under a tight budget, L13/L14 precursor). The registered children are shown and bound AS REGISTERED, at the
// grant they hold, never admitted or sized again; the shares go to the children not yet registered; and the new preview can be recorded while the frontier's own child is the active node. All-mock, $0. Folders removed at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { TreeRefusal } from '../src/tree-record.js';
import { approveHandler } from '../src/tree-approve.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { prefixOf, renderFrontierText } from '../src/tree-stop.js';
import { registerNextChild } from '../src/tree-loop.js';
import { runTree } from '../src/tree-run.js';
import { resumeCountOf } from '../src/tree-resume.js';
import { activeIsOwnChild } from '../src/tree-transitions.js';
import { trackedRealRoot, track } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { capFor, pricedDebateFigures } from './helpers/money-figures.js';
import { FIXTURE_BOUND, GATE_FIELDS, IDS, ROOT_ID, SPLIT_ROOT_HANDOFF_USD, approveFrontier, claim, closedRootTree, hostnameOf, registerKid } from './helpers/tree-fixture.js';

async function approveAgain(r, key) {
  const io = terminal([prefixOf(key), 'y']);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  return { code, shown: io.shown(), errors: io.errors() };
}
const stateOfTree = rootDir => stateOf(readTreeRecord(rootDir));

test('the tight-budget spike as a test (L10; cap 10 in the original, 11.17 since the fixture children write milestones): the file edited and restored, the shares moved; the REAL `tree approve` shows R/M1 and R/M2 as ALREADY REGISTERED at the grants they hold (never "not admitted: budget"), shares out only R/M3, records a NEW preview while R/M2 is the active node, lifts the block, and the child starts (its first claim is node_started, not a resume) under a grant no higher than shown', { timeout: 300_000 }, async () => {
  // a TIGHT budget is the point of this spike: the tightest child (R/M2, which reads R/M1's output) had a grant $0.355 above its handoff call's worst case (grant 3.33, worst case 2.975). The fixture children now ask for milestones, so
  // that worst case (whole prompt as input + maxTokens out, at the fixture row of $0.001 a token; measured on each child's spend-reservations.jsonl) is R/M1 3.293, R/M2 3.350, R/M3 3.226 (was 2.905, 2.975, 2.850), and the
  // root's own handoff costs $0.04. The share keeps the tightest child's old margin (0.355): R/M2's new worst case plus it is 3.350 + 0.355 = 3.705, a share of 3.71: cap 11.17 gives floorCents((11.17 - 0.04) / 3) = 3.71 (proposeGrants, src/tree-budget.js:333)
  // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); this test passed on fad02049 and typed the same class of figure). OLD: cap 13.73 and the share 4.56 typed (0.9275 of the priced-debate at-most). NEW: SHARE = 0.9275 x priced-debate's own at-most figure floored to the cent (the tight budget keeps its relation to the at-most), the cap is the pool that gives it. WHY: the figures move with every recorded or reworded sentence in src/roles.js.
  const SHARE = Math.floor(0.9275 * pricedDebateFigures().atMostUsd * 100 + 1e-9) / 100;
  const r = await trackedRealRoot({ ...pricedChildren(), cap: capFor(SHARE, 3, SPLIT_ROOT_HANDOFF_USD) });
  const d1 = approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });                    // R/M1 runs and closes
  const b = registerNextChild(r.t.rootDir, { work: r.t.work });                                                // R/M2 registered, holding 3.71
  assert.equal(b.node, 'R/M2');
  const file = join(r.t.runsDir, ROOT_ID, 'deliverable.md'); const original = readFileSync(file, 'utf8');
  writeFileSync(file, `${original}\nAn edit after the approval.\n`);
  const refused = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(refused.status, 'tree_refused'); assert.equal(refused.exitCode, 19);
  writeFileSync(file, original);
  const ap = await approveAgain(r, d1.frontierKey);
  assert.equal(ap.code, 0, ap.shown + ap.errors);
  // what the person was shown
  assert.match(ap.shown, new RegExp(`ALREADY REGISTERED \\(closed\\), granted \\$${SHARE.toFixed(2).replace('.', '\\.')}`)); assert.match(ap.shown, new RegExp(`ALREADY REGISTERED \\(registered\\), holding \\$${SHARE.toFixed(2).replace('.', '\\.')}`));
  assert.doesNotMatch(ap.shown, /NOT ADMITTED/); assert.doesNotMatch(ap.shown, /Not admitted, and why/);
  assert.match(ap.shown, /Approving authorizes up to \$\d+\.\d\d of new paid runs/);
  // what was recorded: a new preview and a new approval, different hashes, the registered children bound as registered
  const ev = eventsOf(r);
  const previews = ev.filter(e => e.event === 'frontier_previewed'); const approvals = ev.filter(e => e.event === 'frontier_approved');
  assert.equal(previews.length, 2); assert.equal(approvals.length, 2); assert.notEqual(previews[0].boundSha256, previews[1].boundSha256, 'the figures moved, so the hash did');
  const kids = Object.fromEntries(previews[1].children.map(c => [c.node, c]));
  assert.deepEqual([kids['R/M1'].registered, kids['R/M1'].phase, kids['R/M2'].registered, kids['R/M2'].phase, kids['R/M3'].registered], [true, 'closed', true, 'registered', undefined]);
  const heldB = ev.find(e => e.event === 'node_registered' && e.node === 'R/M2').grant.amount;
  assert.equal(kids['R/M2'].capUsd, heldB, 'the registered child is bound at the grant it holds'); assert.equal(kids['R/M1'].admitted, true);
  const st = stateOfTree(r.t.rootDir);
  assert.equal(st.sticky.has('parent_changed'), false); assert.equal(approvals[1].boundSha256, previews[1].boundSha256);
  // the sitting goes on: R/M2's FIRST claim goes down the resume path and is a node_started; R/M3 gets a grant no higher than shown
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out.status, 'nothing_to_do', JSON.stringify(out));       // restore fix-up (EDITED, disclosed; S8 G9 had 'held_by_stop': the stop the edit opened outlived the restored file): the file is back byte for byte, so the sitting closed that stop assert.deepEqual(out.started.map(s => s.node), ['R/M2', 'R/M3']);
  const ev2 = eventsOf(r);
  assert.equal(ev2.filter(e => e.event === 'node_started' && e.node === 'R/M2').length, 1, 'the first claim is node_started');
  assert.equal(ev2.filter(e => e.event === 'node_resumed' && e.node === 'R/M2').length, 0); assert.equal(resumeCountOf(readTreeRecord(r.t.rootDir), 'R/M2', 1), 0, 'a first claim is not counted as a resume');
  const g3 = ev2.find(e => e.event === 'node_registered' && e.node === 'R/M3').grant.amount;
  assert.ok(g3 <= kids['R/M3'].capUsd + 1e-9, `R/M3 was granted ${g3}, shown ${kids['R/M3'].capUsd}`);
  assert.deepEqual(phases(r), { R: 'closed', 'R/M1': 'closed', 'R/M2': 'closed', 'R/M3': 'closed' });
});

test('the M5d precursor (L13/L14): a partly registered frontier shown again after a limit raise: the registered children stay registered (not re-admitted, not re-registered), they count against the fan-out limit, the child that was not admitted now is, and the loop registers exactly that one', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 2, attemptsPerChild: 1 } });
  const pending0 = findPendingFrontier({ rootDir: r.t.rootDir });
  const d1 = approvePending(r);
  assert.deepEqual(d1.view.children.map(c => [c.node, c.admitted, c.notAdmittedReason]), [['R/M1', true, null], ['R/M2', true, null], ['R/M3', false, 'not admitted: fan-out limit']]);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(out.started.map(s => s.node), ['R/M1', 'R/M2'], 'only the admitted children ran');
  // the raise (the decide form is M5d's; its record is what this test needs)
  appendTreeEvent(r.t.rootDir, { event: 'limit_raised', limit: 'maxChildrenPerSplit', from: 2, to: 3, actor: 'person', via: 'terminal' });
  const d2 = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: pending0 });
  assert.equal(d2.refusal, undefined, JSON.stringify(d2.refusal));
  assert.deepEqual(d2.view.children.map(c => [c.node, c.admitted, c.registered?.phase ?? null]), [['R/M1', true, 'closed'], ['R/M2', true, 'closed'], ['R/M3', true, null]], 'R/M3 is admitted now; the others are shown as registered');
  assert.notEqual(d2.boundSha256, d1.boundSha256);
  // without the raise the same shown-again frontier admits nobody new (the registered ones count against the fan-out)
  const r2 = await trackedRealRoot({ ...pricedChildren(), limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 2, attemptsPerChild: 1 } });
  const p2 = findPendingFrontier({ rootDir: r2.t.rootDir }); approvePending(r2);
  await runTree(r2.t.rootDir, { work: r2.t.work, startRun: draftStarter(r2) });
  const same = describeFrontier({ rootDir: r2.t.rootDir, work: r2.t.work, pending: p2 });
  assert.deepEqual(same.view.children.map(c => [c.node, c.admitted, c.notAdmittedReason]), [['R/M1', true, null], ['R/M2', true, null], ['R/M3', false, 'not admitted: fan-out limit']]);
  // approve again at the new figures (the verb for it is M5d's: direct appends here), then the loop registers exactly R/M3
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...d2.preview, boundSha256: d2.boundSha256 });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: d2.frontierKey, revision: 2, boundSha256: d2.boundSha256 });
  const regsBefore = eventsOf(r).filter(e => e.event === 'node_registered').length;
  const next = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([next.kind, next.node], ['registered', 'R/M3']);
  assert.equal(eventsOf(r).filter(e => e.event === 'node_registered').length, regsBefore + 1, 'one registration: R/M1 and R/M2 are not registered again');
});

test('the table: frontier_previewed is written when the only active node is a child of THAT frontier (registered or interrupted), and refused when it belongs to another; the same one condition serves `tree approve`', () => {
  const t = closedRootTree(); track(t.work);
  const k1 = approveFrontier(t.rootDir, ['R/M1']); const k2 = approveFrontier(t.rootDir, ['R/M2']);
  registerKid(t, k1, 'R/M1', IDS[0], 10);
  const st = stateOfTree(t.rootDir);
  assert.equal(activeIsOwnChild(st, k1), true); assert.equal(activeIsOwnChild(st, k2), false);
  const preview = key => ({ event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: key, parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: 'b'.repeat(64), children: [{ node: 'R/M1', generation: 1 }] });
  assert.doesNotThrow(() => appendTreeEvent(t.rootDir, preview(k1)), 'its own child is the active node');
  assert.throws(() => appendTreeEvent(t.rootDir, preview(k2)), e => e instanceof TreeRefusal && /a frontier is previewed when nothing is/.test(e.reason));
  assert.equal(activeIsOwnChild(stateOfTree(closedRootTree().rootDir), k1), false, 'nothing active: the condition is for an ACTIVE node');
});

test('the table: the own child must be IDLE: a child whose claim\'s process is alive is running and blocks a new preview; the same child with a dead claim (interrupted) does not', () => {
  const t = closedRootTree(); track(t.work);
  const k1 = approveFrontier(t.rootDir, ['R/M1']);
  registerKid(t, k1, 'R/M1', IDS[0], 10);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  const st = stateOfTree(t.rootDir);
  assert.equal(activeIsOwnChild(st, k1, { pidAlive: () => true }), false, 'alive: running'); assert.equal(activeIsOwnChild(st, k1, { pidAlive: () => false }), true, 'dead: interrupted');
  const preview = { event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: k1, parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: 'b'.repeat(64), children: [{ node: 'R/M1', generation: 1 }] };
  assert.throws(() => appendTreeEvent(t.rootDir, preview, { facts: { pidAlive: () => true } }), e => e instanceof TreeRefusal && /a frontier is previewed when nothing is/.test(e.reason));
  assert.doesNotThrow(() => appendTreeEvent(t.rootDir, preview, { facts: { pidAlive: () => false } }));
  // a closed child with a post-run paid call in flight is active too, and it is not idle
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: null, share: 'released' });
  appendTreeEvent(t.rootDir, { event: 'node_resumed', purpose: 'post_run', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  const post = stateOfTree(t.rootDir);
  assert.equal(post.active, 'R/M1@g1'); assert.equal(activeIsOwnChild(post, k1, { pidAlive: () => false }), false, 'a post-run call is in flight');
});

test('the text: an already registered child is not asked again, is not listed as not admitted, and adds nothing to what the approval authorizes (the sentences are code-built for the person)', () => {
  const view = (registered) => ({
    frontierKey: 'a'.repeat(64), rootId: ROOT_ID, parent: { node: 'R', generation: 1, runId: ROOT_ID, splitSha256: 'b'.repeat(64), results: [] }, openedBy: [],
    children: [
      { node: 'R/M1', generation: 1, milestone: 'M1', scope: 's1', chain: { name: 'c', figures: null }, grant: 3.3333, ceiling: 4, admitted: true, notAdmittedReason: null, mayStop: false, registered, inherited: [], refinements: [], provides: [], expects: [], refused: [], notEnforced: [], lints: [] },
      { node: 'R/M2', generation: 1, milestone: 'M2', scope: 's2', chain: { name: 'c', figures: null }, grant: 0, ceiling: 4, admitted: false, notAdmittedReason: 'not admitted: fan-out limit', mayStop: false, registered: null, inherited: [], refinements: [], provides: [], expects: [], refused: [], notEnforced: [], lints: [] },
    ],
    budget: { rootCapUsd: 10, spentUsd: 0, heldUsd: 3.33, availableUsd: 6.67 }, limits: [], unexpanded: [],
  });
  const t = renderFrontierText(view({ phase: 'registered', heldUsd: 3.3333, runId: 'r1' }));
  assert.match(t, /ALREADY REGISTERED \(registered\), holding \$3\.33 \(run r1\); it keeps the grant it has; this approval adds no new money for it and does not size it again\./);
  assert.doesNotMatch(t, /Proposed grant: \$3\.33/); assert.match(t, /Not admitted, and why\n  R\/M2 generation 1/); assert.doesNotMatch(t, /R\/M1 generation 1: not admitted/);
  assert.match(t, /Approving authorizes no new paid runs \(every child above is already registered or not admitted\)/);
  assert.match(renderFrontierText(view({ phase: 'closed', heldUsd: 3.3333, runId: 'r1' })), /ALREADY REGISTERED \(closed\), granted \$3\.33/);
  const fresh = renderFrontierText(view(null));
  assert.match(fresh, /Proposed grant: \$3\.33, never more than \$4\.00/); assert.match(fresh, /Approving authorizes up to \$3\.33 of new paid runs/);
});
