// 0.8.3 M6 S8-7 (the whole-tree mock test; C5's frame): ONE tree, driven end to end through the person's real verbs on all-mock chains, $0. `council tree start` (startHandler), the sitting (`tree resume`, resumeHandler),
// `tree approve` (approveHandler) and `tree decide` (decideHandler), each with a scripted terminal; no record event is written by hand, no report or run file is edited, and no src function is called to move the tree on.
// The legs, in order:
//   1 tree start -> 2 the root's split is verified -> 3 the children frontier is approved -> 4 the children run: R/M1 closes NOT passed and a blocked-child stop opens, R/M3 closes passed, R/M2 waits ->
//   5 the OBLIGATION route: `decide --stop <child stop> --obligation R@g1:C1` (a criterion the root carries) opens a ROOT stop (source obligation) and the root_affected block -> 6 `decide` on that root stop is a new root
//   plan (replansRoot); the block is lifted by that very decision -> 7 the root frontier is approved and R@g2 is registered and STARTED from its bundle -> 8 R@g2's draft is not signed, so R@g2 closes blocked on its OWN
//   (before any children frontier exists): a stop for the live root generation -> 9 `decide` -> approve: R@g3 starts and is split-verified -> 9b R@g3's children frontier is approved and its children run -> 10 the money.
// What is NOT a verb, said once: (a) the plan a model would have written is handed to each root and child run as a DRAFT (api.run's `draft`, as test/helpers/sitting.js draftStarter does for children): the mock builder
// cannot write a split block, and neither `tree start` nor the sitting's default starter takes a draft. So the starters here are the product's own api.run calls with that one extra option, nothing else changed (same
// files, same flags as src/tree-run.js apiStarter; `--criteria` left out for a root bundle). Two drafts are deliberately unsigned (R/M1 in generation 1, R@g2): the mock critics sign only a draft that carries their
// marker line, so those two runs close not passed - that is the whole of how a node comes to be blocked here; (b) the person's typed text; (c) two mock-debate variants written into the work folder as chains
// (the root's handoff seat and the child's criteria seat swapped; mock providers throughout, fixture prices).
// NOT HERE, on purpose:
//   - X1 (the `t.todo` below): approving a signed new root plan's children frontier while a node is held needs a signed, closed R@g2 with a held node; the obligation route leaves R/M3@g1 held (F2 fixed), but this walk blocks
//     R@g2 before its children frontier exists (the X4 variant). The person-opened root stop (S8-8) gives the walk where X1 fires.
//   - the adoption / reuse legs (U5 an adopted child is one node and one run in the money readers, U6 old integration passes after a re-plan, U9 held nodes cannot start/resume/top up, U10 non-adopted held nodes die
//     exactly at the approval, U14 each exit X1-X5): they land after S8-9 C2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import * as api from '../src/api.js';
import { startHandler } from '../src/tree-start.js';
import { resumeHandler } from '../src/tree-resume.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { deadKeys, heldKeys, keptKeys, latestGenerationOf } from '../src/tree-transitions.js';
import { bundleDirOf, bundleSha256Of } from '../src/tree-continuation.js';
import { budgetOf, gateTree } from '../src/tree-budget.js';
import { track } from './helpers/temp-trees.js';
import { FIXTURE_BUNDLE_ALLOWANCE_BYTES, splitRootConfig } from './helpers/tree-fixture.js';
import { splitChild } from './helpers/child-chains.js';
import { ceilCents, figuresOfConfig } from './helpers/money-figures.js';
import { block3, plan3 } from './helpers/split-fixture.js';
import { LEAF_PLAN } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';

const ROOT_CHAIN = 'whole-root';
const CHILD_CHAIN = 'whole-child';
const UNSIGNED = '# A draft the mock critics do not sign\n\nIt carries no marker line.\n';
const work = track(mkdtempSync(join(tmpdir(), 'thc-whole-')));
mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
writeFileSync(join(work, 'chains', `${ROOT_CHAIN}.json`), JSON.stringify({ ...splitRootConfig(), name: ROOT_CHAIN }, null, 2));
writeFileSync(join(work, 'chains', `${CHILD_CHAIN}.json`), JSON.stringify({ ...splitChild(), name: CHILD_CHAIN }, null, 2));
writeFileSync(join(work, 'plan.md'), plan3());
// EDITED 18 Okt 2026 (C2b-2, the adoption writer). OLD: R@g3 was planned from plan.md, the same plan as R@g1 - its R/M3 was unchanged. NEW: plan-g3.md, the same plan with K3's scope changed. WHY: with the writer an UNCHANGED finished sibling is ADOPTED when R@g3's children frontier is approved (test/tree-adoption-walk.test.js walks that);
// this walk is about the other case - a held node the new plan does not use is passed over (kept) and all three children run - and every count and dollar figure below is unchanged. 9b pins that nothing was adopted.
{ const b3 = block3(); b3.children.find(c => c.id === 'K3').scope = 'Define the export format, as a table.'; writeFileSync(join(work, 'plan-g3.md'), plan3(b3)); }
writeFileSync(join(work, 'plan-unsigned.md'), UNSIGNED);
writeFileSync(join(work, 'leaf-plan.md'), LEAF_PLAN);
writeFileSync(join(work, 'leaf-plan-unsigned.md'), UNSIGNED);

const S = {};                                                      // what the legs hand on: rootId, rootDir, shas taken at the end of a leg
const sha = text => createHash('sha256').update(text).digest('hex');
const fileSha = file => sha(readFileSync(file));
const events = () => readTreeRecord(S.rootDir).events;
const state = () => stateOf(readTreeRecord(S.rootDir));
const kinds = (...names) => events().filter(e => names.includes(e.event));
const nodeOf = (node, generation) => state().nodes.get(`${node}@g${generation}`);
const runDirOf = (node, generation) => join(work, 'runs', nodeOf(node, generation).runId);
const keysOf = set => [...set].sort();
const idNo = e => Number(String(e.id).slice(1));
const need = (cond, leg) => assert.ok(cond, `leg ${leg} did not complete: this leg needs it`);
const quiet = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); const buf = []; stdout.on('data', d => buf.push(String(d))); stderr.on('data', d => buf.push(String(d))); return { stdout, stderr, text: () => buf.join('') }; };

// the starters: the product's own api.run call, plus the plan a model would have written (see the header, (a))
const rootStart = opts => api.run({ ...opts, draft: 'plan.md', rounds: 1 });
const draftFor = (node, bundleDir) => (node === 'R' ? (bundleDir.includes('R@g2') ? 'plan-unsigned.md' : bundleDir.includes('R@g3') ? 'plan-g3.md' : 'plan.md') : (node === 'R/M1' && /@g1\/?$/.test(bundleDir) ? 'leaf-plan-unsigned.md' : 'leaf-plan.md'));
const sittingStart = ({ node, chain, bundleDir, runId, grantUsd }) => api.run({
  chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}),
  context: join(bundleDir, 'context.md'), runId, treeNode: join(bundleDir, 'node.json'), piiGate: 'hard-stop', /* CHANGED ACCEPTED (19 Okt 2026, the stop is the default): OLD 'warn'. A member is launched with its tree's recorded mode and `tree start` with no flag now records hard-stop; with 'warn' every member would be refused (pii_mode_mismatch, exit 19). */ /* the tree's mode since 0.8.3: `tree start` always records one (warn by default), and a member is launched under it like src/tree-run.js apiStarter does */ cwd: work, maxUsd: grantUsd, draft: draftFor(node, bundleDir), rounds: 1,
});
async function sit() {
  const o = quiet();
  const code = await resumeHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdout: o.stdout, stderr: o.stderr, deps: { startRun: sittingStart } });
  return { code, text: o.text() };
}
async function approve() {
  const pending = findPendingFrontier({ rootDir: S.rootDir });
  assert.ok(pending, 'a frontier waits for approval');
  const t = terminal([pending.key.slice(0, 8), 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  const code = await approveHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, text: t.shown() + t.errors() };
}
async function decide(stopId, typed, flags = {}) {
  const t = terminal([`${typed}\n.`, stopId, 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: S.rootDir, rootId: S.rootId, flags: { stop: stopId, ...flags }, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, text: t.shown() + t.errors() };
}
const childKeys = generation => ['R/M1', 'R/M2', 'R/M3'].map(n => `${n}@g${generation}`);

test('leg 1 - `council tree start`: the tree and its root run are made by the real handler; the record, tree.json and the root run folder agree', async () => {
  const o = quiet();
  const code = await startHandler({ flags: { task: 'tasks/x.md', chain: ROOT_CHAIN, 'child-chain': CHILD_CHAIN, 'max-usd': '100' }, work, stdout: o.stdout, stderr: o.stderr, deps: { bundleAllowanceBytes: FIXTURE_BUNDLE_ALLOWANCE_BYTES, startRun: rootStart } });
  assert.equal(code, 0, o.text());
  [S.rootId] = readdirSync(join(work, 'runs')); S.rootDir = join(work, 'runs', S.rootId);
  assert.equal(readdirSync(join(work, 'runs')).length, 1, 'one run folder: the root');
  assert.ok(o.text().includes(`Tree ${S.rootId} started: cap $100.00 for the whole tree, root plan on ${ROOT_CHAIN}, sub-plans on ${CHILD_CHAIN}.`), o.text());
  const { tree } = readTreeRecord(S.rootDir);
  assert.equal(tree.rootCapUsd, 100);
  assert.deepEqual(tree.chains.slice(0, 2).map(c => [c.depth, c.name]), [[0, ROOT_CHAIN], [1, CHILD_CHAIN]]);
  assert.ok(tree.rootTask.task.endsWith('tasks/x.md'), 'the task is pinned in tree.json');
  assert.deepEqual(kinds('tree_started', 'node_registered', 'node_started', 'node_closed').map(e => [e.event, e.node ?? null, e.generation ?? null]),
    [['tree_started', null, null], ['node_registered', 'R', 1], ['node_started', 'R', 1], ['node_closed', 'R', 1]]);
  const closed = kinds('node_closed')[0];
  assert.deepEqual([closed.outcome, closed.status], ['passed', 'ready_for_build']);
  assert.equal(JSON.parse(readFileSync(join(runDirOf('R', 1), 'run.json'), 'utf8')).maxUsd, 100, 'the root run was held to the tree cap');
  S.g1Root = { deliverable: fileSha(join(runDirOf('R', 1), 'deliverable.md')), runId: nodeOf('R', 1).runId };
  S.leg1 = true;
});

test('leg 2 - the first sitting verifies the root\'s split and stops at the children frontier: nothing is registered, nothing is spent beyond the root', async () => {
  need(S.leg1, 1);
  const out = await sit();
  assert.equal(out.code, 20, out.text);
  assert.ok(out.text.includes(`A frontier waits for your approval: run \`council tree approve ${S.rootId}\`.`), out.text);
  const [verified] = kinds('split_verified');
  assert.deepEqual([verified.node, verified.generation, verified.children], ['R', 1, ['R/M1', 'R/M2', 'R/M3']]);
  assert.match(verified.splitSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(kinds('node_registered').map(e => `${e.node}@g${e.generation}`), ['R@g1'], 'no child is registered before the approval');
  S.leg2 = true;
});

test('leg 3 - `council tree approve` records the children frontier: previewed and approved under one hash, for the three children the split names', async () => {
  need(S.leg2, 2);
  const out = await approve();
  assert.equal(out.code, 0, out.text);
  assert.ok(out.text.includes('Children (3)'), out.text);
  const [previewed] = kinds('frontier_previewed'); const [approved] = kinds('frontier_approved');
  assert.deepEqual(previewed.children.map(c => [c.node, c.generation]), [['R/M1', 1], ['R/M2', 1], ['R/M3', 1]]);
  assert.deepEqual([approved.frontierKey, approved.boundSha256, approved.revision], [previewed.frontierKey, previewed.boundSha256, 1], 'the approval binds the hash of the preview it showed');
  assert.ok(approved.gateId && /^[0-9a-f]{64}$/.test(approved.shownSha256));
  assert.deepEqual(kinds('node_registered').map(e => e.node), ['R'], 'approving registers nothing: the sitting does');
  S.leg3 = true;
});

test('leg 4 - the children run: R/M1 closes NOT passed and a blocked-child stop opens on it, the independent R/M3 closes passed, R/M2 (which expects R/M1) is held back unregistered; the sitting ends held by the stop', async () => {
  need(S.leg3, 3);
  const out = await sit();
  assert.equal(out.code, 20, out.text);
  assert.ok(out.text.includes('2 runs went through this sitting (R/M1, R/M3), and then it stopped: an open stop holds a node back, so this is NOT finished.'), out.text);
  const m1 = nodeOf('R/M1', 1); const m3 = nodeOf('R/M3', 1);
  assert.equal(m1.phase, 'closed'); assert.notEqual(m1.outcome, 'passed', 'R/M1 ran on a draft the critics did not sign');
  assert.deepEqual([m3.phase, m3.outcome], ['closed', 'passed']);
  assert.equal(nodeOf('R/M2', 1), undefined, 'R/M2 expects an agreement from R/M1: it was never registered');
  const stops = kinds('needs_decision_opened');
  assert.equal(stops.length, 1, JSON.stringify(stops));
  const [stop] = stops; S.childStop = stop;
  assert.deepEqual([stop.node, stop.generation, stop.source, stop.blockedBy.map(b => b.code), stop.affected.map(a => a.node)], ['R/M1', 1, 'blocked', ['not_passed'], ['R/M1', 'R/M2']]);
  const rootRun = nodeOf('R', 1).runId;
  for (const k of ['R/M1@g1', 'R/M3@g1']) {
    const reg = kinds('node_registered').find(e => `${e.node}@g${e.generation}` === k);
    // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); the full suite on fad02049 read leg 4 as #5019 with 8.7 against 8.6, and legs 5-9b cascaded from it). OLD: the grant was typed (8.6, the child chain's at-most 8.594 rounded up to the cent). NEW: the grant is that figure derived from the chain's own dry run, priced for the bundle allowance this tree is started with (4000 bytes). WHY: recording the drafted words moves the estimate (8.594 -> about 8.7); a typed grant breaks on every wording change.
    const GRANT = ceilCents(figuresOfConfig({ ...splitChild(), name: CHILD_CHAIN }, { inputBytes: FIXTURE_BUNDLE_ALLOWANCE_BYTES }).atMostUsd);
    assert.deepEqual([reg.parentRunId, reg.grant.amount, reg.chain.name], [rootRun, GRANT, CHILD_CHAIN], k);
    assert.equal(JSON.parse(readFileSync(join(work, 'runs', state().nodes.get(k).runId, 'run.json'), 'utf8')).maxUsd, GRANT, `${k} ran under its grant as the cap`);      // OLD 8.59, same cause      // OLD 7
  }
  S.g1Children = Object.fromEntries(['R/M1@g1', 'R/M3@g1'].map(k => [k, fileSha(join(work, 'runs', state().nodes.get(k).runId, 'report.json'))]));
  S.leg4 = true;
});

test('leg 5 - the OBLIGATION route: `decide --stop <child stop> --obligation R@g1:C1` opens a ROOT stop (source obligation) and the root_affected block, in one lock hold with the decision LAST; the tree is blocked and starts nothing', async () => {
  need(S.leg4, 4);
  const registered = kinds('node_registered').length;
  const d = await decide(S.childStop.id, 'The root rule C1 is wrong, fix it at the root.', { obligation: 'R@g1:C1' });
  assert.equal(d.code, 0, d.text);
  assert.ok(d.text.includes('The ROOT carries this obligation. Recording this blocks the whole tree (root_affected)'), d.text);
  const rootStop = kinds('needs_decision_opened').find(e => e.source === 'obligation'); need(rootStop, 'the root stop');
  S.rootStop = rootStop;
  assert.deepEqual([rootStop.node, rootStop.generation, rootStop.originStopId, rootStop.obligation], ['R', 1, S.childStop.id, 'R@g1:C1']);
  const block = kinds('blocked').find(e => e.reason === 'root_affected'); need(block, 'the root_affected block');
  const decision = kinds('decision_recorded').at(-1); S.obligationDecision = decision;
  assert.deepEqual([block.scope, block.stopId], ['tree', rootStop.id], 'the block is written WITH the root stop\'s id');
  assert.deepEqual([decision.form, decision.stopId, decision.obligation], ['regenerate', S.childStop.id, 'R@g1:C1']);
  assert.deepEqual([idNo(block) - idNo(rootStop), idNo(decision) - idNo(block)], [1, 1], 'root stop, block, decision: adjacent, the decision last');
  const s = state();
  assert.deepEqual([s.openStops, [...s.sticky.keys()]], [[rootStop.id], ['root_affected']], 'the child stop is answered; the root stop is the one open stop and the block stands');
  const out = await sit();
  assert.equal(out.code, 20, out.text);
  assert.ok(out.text.includes('The tree is blocked: root_affected. Nothing was started.'), out.text);
  assert.ok(out.text.includes(`council tree decide ${S.rootId} --stop ${rootStop.id}`), 'the sitting names the root stop and the new-root-plan answer: ' + out.text);
  assert.equal(kinds('node_registered').length, registered, 'blocked: nothing was registered');
  S.leg5 = true;
});

test('leg 6 - `decide` on the root stop is a NEW ROOT PLAN (replansRoot): the decision and the generation R@g2 are recorded together, the replaced nodes are listed as set aside, and the root_affected block is lifted by THAT decision - before anything is approved or registered', async () => {
  need(S.leg5, 5);
  const runFolders = readdirSync(join(work, 'runs')).length;
  assert.deepEqual([...state().sticky.keys()], ['root_affected'], 'before the decision the block stands');
  const d = await decide(S.rootStop.id, 'Plan it again with a corrected C1.');
  assert.equal(d.code, 0, d.text);
  assert.ok(d.text.includes(`Answer stop ${S.rootStop.id} (obligation, R@g1) with a NEW ROOT plan?`), d.text);
  assert.ok(!d.text.includes('NOT carried'), 'one root stop open: the text has no block about other root stops (single-stop text unchanged)');
  // F2 (Muad, 12 Oct: a sub-plan is not thrown away before it is checked for reuse): R/M3@g1 closed passed with no stop of its own, so the re-plan HOLDS it; R/M1@g1 did not pass (ineligible) and R/M2 never ran.
  assert.match(d.text, /SET ASIDE from now on \(2 nodes[^)]*\):\n {2}- R@g1\n {2}- R\/M1@g1\n/);
  assert.match(d.text, /HELD \(1 node in 1 run[^)]*\):\n {2}- R\/M3@g1\n/);
  const decision = kinds('decision_recorded').at(-1); const [opened] = kinds('generation_opened').filter(e => e.nodes.some(x => x.node === 'R' && x.generation === 2));
  assert.deepEqual([decision.form, decision.replansRoot, decision.stopId, decision.text], ['regenerate', true, S.rootStop.id, 'Plan it again with a corrected C1.']);
  assert.deepEqual([opened.decisionId, opened.nodes], [decision.id, [{ node: 'R', generation: 2 }]]);
  assert.equal(idNo(opened), idNo(decision) + 1, 'the two records are adjacent: one lock hold');
  // the lift: the block's stop id is the stop this decision answers, and it is gone as soon as the decision (and its generation) is recorded - not at the approval, not at the registration (nothing is registered yet)
  const block = kinds('blocked').find(e => e.reason === 'root_affected');
  assert.equal(block.stopId, decision.stopId, 'the block belonged to the stop this decision answers');
  const s = state();
  assert.deepEqual([s.openStops, [...s.sticky.keys()]], [[], []], 'the stop is answered and the block is lifted');
  assert.equal(nodeOf('R', 2), undefined, 'R@g2 is decided, not registered: registerRootReplan did not lift anything');
  assert.equal(readdirSync(join(work, 'runs')).length, runFolders, 'no run folder was made');
  assert.ok(deadKeys(s).has('R@g1'), 'the replaced root plan is dead');
  assert.deepEqual([keysOf(heldKeys(s)), deadKeys(s).has('R/M3@g1')], [['R/M3@g1'], false], 'the finished, passed sibling is HELD, not dead');
  assert.equal(readTreeRecord(S.rootDir).tree.rootCapUsd, 100);
  S.decision1 = decision;
  S.leg6 = true;
});

test('leg 7 - the root frontier is approved and R@g2 is registered and STARTED from its bundle: the bundle holds the task bytes and the person\'s words and no criteria.json, the run is held to the grant and closes (not passed: its draft is not signed)', async () => {
  need(S.leg6, 6);
  const a = await approve();
  assert.equal(a.code, 0, a.text);
  assert.match(a.text, /Up to \$[0-9.]+ for the new root run \(R@g2\)\./);
  const [rootFrontier] = kinds('frontier_previewed').filter(e => e.kind === 'root_replan');
  assert.equal(rootFrontier.openedBy, S.decision1.id);
  assert.equal(nodeOf('R', 2), undefined, 'approving registers nothing');
  S.sit7 = await sit();
  // the first sitting after the re-plan: nothing opens generations for the OBLIGATION decision (its effect on the carriers died with the root stop it belonged to), so the held sibling is still held
  assert.deepEqual(kinds('generation_opened').filter(e => e.decisionId === S.obligationDecision.id), [], 'no stray generation_opened for the obligation decision');
  assert.deepEqual(keysOf(heldKeys(state())), ['R/M3@g1'], 'still held after the first sitting that follows the re-plan');
  const n = nodeOf('R', 2); need(n, 'R@g2 registered');
  const reg = kinds('node_registered').find(e => e.node === 'R' && e.generation === 2);
  const bundle = bundleDirOf(S.rootDir, 'R', 2);
  assert.deepEqual([reg.replacesRunId, reg.grant.amount, reg.frontierKey, reg.parentNode], [S.g1Root.runId, rootFrontier.children[0].capUsd, rootFrontier.frontierKey, null]);
  assert.notEqual(n.runId, S.rootId, 'a fresh run folder, never the tree id');
  assert.equal(reg.bundleSha256, bundleSha256Of(bundle), 'the registered hash is the bundle on disk (what the member re-checks)');
  assert.deepEqual(readdirSync(bundle).sort(), ['context.md', 'node.json', 'old-plan.md', 'task.md'], 'a root bundle has no criteria.json; it holds the earlier plan as builder-only data');      // CHANGED ACCEPTED (red triage, C&C thcmcp-cd 23 Okt 2026, ruling 3): OLD ['context.md','node.json','task.md']. NEW adds 'old-plan.md'. WHY: a5d818f (19 Okt 2026) made the earlier plan data by default for every root re-plan (`--fresh` leaves it out; src/old-plan.js; rootBundle, tree-root-replan.js:107, writes old-plan.md into the R@g bundle at registration, tree-loop.js:382), C&C thcmcp-6d accepted "data default + --fresh" 19 Okt 2026 17:20 (m7/CnC_M7_Lists.md:315), and leg 6 decides without `--fresh`; the label and the 100 KB allowance for that file are Muad's 19 Okt 17:22 yes (FOCUS-detail). Only this literal changes: leg 6 stays on the default route on purpose.
  assert.equal(readFileSync(join(bundle, 'task.md'), 'utf8'), readFileSync(join(work, 'tasks', 'x.md'), 'utf8'), 'the task bytes, unchanged');
  assert.ok(readFileSync(join(bundle, 'context.md'), 'utf8').includes(`----- decision ${S.decision1.id} -----\nPlan it again with a corrected C1.\n----- end -----`), 'the person\'s words, word for word');
  assert.equal(JSON.parse(readFileSync(join(runDirOf('R', 2), 'run.json'), 'utf8')).maxUsd, reg.grant.amount, 'started under the grant as its cap');
  assert.equal(n.phase, 'closed'); assert.notEqual(n.outcome, 'passed');
  S.g2Root = { runId: n.runId };
  S.leg7 = true;
});

test('leg 8 - R@g2 closes blocked on its OWN, before any children frontier: one stop for the LIVE root generation (source blocked, not_passed), no split verified, no frontier waits, and the sitting names a new root plan as the way out', async () => {
  need(S.leg7, 7);
  assert.equal(S.sit7.code, 20, S.sit7.text);
  const stops = kinds('needs_decision_opened').filter(e => e.generation === 2);
  assert.equal(stops.length, 1, JSON.stringify(stops));
  const [stop] = stops; S.stop2 = stop;
  assert.deepEqual([stop.node, stop.source, stop.blockedBy.map(b => b.code), stop.affected], ['R', 'blocked', ['not_passed'], [{ node: 'R', generation: 2 }]], 'a stop for the LIVE root generation');
  assert.equal(kinds('split_verified').filter(e => e.generation === 2).length, 0, 'an unsigned plan has no verified split');
  assert.equal(findPendingFrontier({ rootDir: S.rootDir }), null, 'no children frontier waits: X1 cannot fire for this root plan');
  // X5: R@g2 never finished passed, so the held node STAYS held (not released, not dead), and a closed node holds no money
  assert.deepEqual([keysOf(heldKeys(state())), kinds('held_released').length], [['R/M3@g1'], 0]);
  assert.equal(budgetOf(S.rootDir).nodes.find(n => n.key === 'R/M3@g1').heldUsd, 0);
  assert.ok(S.sit7.text.includes(`answer it with a NEW ROOT plan: council tree decide ${S.rootId} --stop ${stop.id}`), S.sit7.text);       // the sitting that opened the stop shows it in full
  assert.ok(S.sit7.text.includes('The ROOT is blocked (not_passed).'), S.sit7.text);
  const again = await sit();
  assert.equal(again.code, 20, again.text);
  assert.equal(kinds('needs_decision_opened').filter(e => e.generation === 2).length, 1, 'idempotent: a second sitting opens no second stop');
  S.leg8 = true;
});

// X1 (the test.todo that stood here, "approving a signed new root plan's children frontier releases the held nodes (they die, none adopted yet)") is now a REAL test with the opposite outcome: test/tree-held-release.test.js "X1 (K2) REAL" (C2a-record, 18 Okt 2026; OLD: they die; NEW: passed over, kept, not dead).

test('leg 9 - `decide` on R@g2\'s stop -> approve -> R@g3 starts from its bundle on a signed draft, closes passed and is split-verified; R@g2 is set aside', async () => {
  need(S.leg8, 8);
  assert.deepEqual(keysOf(heldKeys(state())), ['R/M3@g1'], 'X4 before: the sibling of the first era is still held when R@g2\'s stop is answered');
  const d = await decide(S.stop2.id, 'Third plan, this one signed.');
  assert.equal(d.code, 0, d.text);
  assert.ok(d.text.includes(`Answer stop ${S.stop2.id} (blocked, R@g2) with a NEW ROOT plan?`), d.text);
  assert.match(d.text, /SET ASIDE from now on \(1 node[^)]*\):\n {2}- R@g2\n/);
  const decision = kinds('decision_recorded').at(-1); const [opened] = kinds('generation_opened').filter(e => e.nodes.some(x => x.node === 'R' && x.generation === 3));
  assert.deepEqual([decision.replansRoot, decision.stopId, opened.decisionId], [true, S.stop2.id, decision.id]);
  assert.equal(idNo(opened), idNo(decision) + 1);
  const a = await approve();
  assert.equal(a.code, 0, a.text);
  const run = await sit();
  assert.equal(run.code, 20, run.text);
  assert.ok(run.text.includes(`A frontier waits for your approval: run \`council tree approve ${S.rootId}\`.`), run.text);
  const n = nodeOf('R', 3); need(n, 'R@g3 registered');
  assert.deepEqual([n.phase, n.outcome], ['closed', 'passed']);
  assert.equal(kinds('node_registered').find(e => e.node === 'R' && e.generation === 3).replacesRunId, S.g2Root.runId);
  assert.deepEqual(kinds('split_verified').filter(e => e.generation === 3).map(e => e.children), [['R/M1', 'R/M2', 'R/M3']]);
  const s = state();
  assert.equal(latestGenerationOf(s, 'R'), 3);
  assert.ok(['R@g1', 'R@g2'].every(k => deadKeys(s).has(k)), 'both replaced root plans are dead');
  // X4 REMOVED (13 Oct 2026; EDITED, disclosed; old: [[], true] "the next root generation opened, so the node still held from the earlier era is dead"): R@g3 offers a split whose frontier is not approved yet, so nothing has run or replaced the reuse check
  // and the sibling of the first era is still HELD (Muad, 12 Oct 21:25). Its spend is counted exactly as when it was dead (a pin on the money: no grant held, spend counted once).
  assert.deepEqual([keysOf(heldKeys(s)), deadKeys(s).has('R/M3@g1')], [['R/M3@g1'], false], 'the sibling of the first era is STILL held when R@g3 closes passed with a split');
  { const b = budgetOf(S.rootDir).nodes.find(n => n.key === 'R/M3@g1'); assert.ok(b.spentUsd > 0 && b.heldUsd === 0, 'held or dead, its spend is counted and it holds no grant'); }
  assert.equal(kinds('held_released').length, 0);
  S.leg9 = true;
});

test('leg 9b - R@g3\'s children frontier is approved and its three children run and close passed: the tree has no open stop and no block', async () => {
  need(S.leg9, 9);
  const a = await approve();
  assert.equal(a.code, 0, a.text);
  // the generation of R@g3's children, DERIVED from childGenerationOf (src/tree-transitions.js): max(parentGeneration, 1 + the newest generation of the path that an OLDER parent generation proposed, or that a decision opened for it).
  // Here parentGeneration = 3; R/M1 and R/M3 were registered at g1 (older parent R@g1) -> 1 + 1 = 2; R/M2 never was and no decision opened a generation for it -> 1 + 0 = 1. All three are below the parent's own generation,
  // and 'never below the parent's own generation' makes every one of them 3. (The stray opening of the old obligation decision, now gone, also gave 3: the number does not depend on it.) The approved frontier must agree.
  const approvedFrontier = kinds('frontier_previewed').at(-1);
  assert.deepEqual(approvedFrontier.children.map(c => `${c.node}@g${c.generation}`), childKeys(3), 'the approved frontier proposes the derived generations');
  // X1 (EDITED, new assertion): the approval of R@g3's children frontier PASSES OVER the sibling of the first era
  // EDITED 18 Okt 2026 (C2a-record K2). OLD: [keysOf(heldKeys), deadKeys.has('R/M3@g1')] = [[], true] ("released the sibling": nothing adopts until S8-9). NEW: [['R/M3@g1'], ['R/M3@g1'], false]: still held, passed over (kept), not dead. WHY: release is not death (Muad 12 Oct 21:25).
  { const rel = state(); assert.deepEqual([keysOf(heldKeys(rel)), keysOf(keptKeys(rel)), deadKeys(rel).has('R/M3@g1')], [['R/M3@g1'], ['R/M3@g1'], false], 'X1: the first approval of a children frontier of R@g3 passed the sibling over'); }
  { const rel = state(); assert.equal(rel.adopted.size, 0, 'nothing was adopted (pin, C2b-2): the changed scope is why R/M3@g1 is kept'); assert.equal(approvedFrontier.children.some(c => c.reused), false, 'and the approved preview carries no reused entry'); }
  const out = await sit();
  assert.equal(out.code, 0, out.text);
  assert.ok(out.text.includes('Done for now: 3 runs went through this sitting (R/M1, R/M2, R/M3).'), out.text);
  const s = state();
  for (const k of childKeys(3)) assert.deepEqual([s.nodes.get(k).phase, s.nodes.get(k).outcome], ['closed', 'passed'], k);
  assert.deepEqual([s.openStops, [...s.sticky.keys()]], [[], []]);
  // the replaced runs are byte for byte what their runs wrote (T14): the first root plan and the two generation-1 children that ran
  assert.equal(fileSha(join(work, 'runs', S.g1Root.runId, 'deliverable.md')), S.g1Root.deliverable, 'the replaced root plan is untouched');
  for (const [k, digest] of Object.entries(S.g1Children)) assert.equal(fileSha(join(work, 'runs', s.nodes.get(k).runId, 'report.json')), digest, `${k}: the replaced child's report is untouched`);
  S.leg9b = true;
});

test('leg 10 - the money across all three root plans: the cap never moved, every run that started is counted once (the replaced ones included), no grant is held by a node that cannot spend, the accounting gate is clean', async () => {
  need(S.leg9b, '9b');
  const record = readTreeRecord(S.rootDir);
  assert.equal(record.tree.rootCapUsd, 100, 'tree.json is never edited');
  const gate = gateTree(S.rootDir, { record });
  assert.equal(gate.ok, true, JSON.stringify(gate.problems));
  const startedRuns = new Set(record.events.filter(e => e.event === 'node_started').map(e => e.runId));
  assert.equal(startedRuns.size, 8, 'R@g1, R/M1@g1, R/M3@g1, R@g2, R@g3 and the three children of R@g3: eight runs (R/M2@g1 never started)');
  assert.deepEqual(gate.members.map(m => m.runId).sort(), [...startedRuns].sort(), 'the gate counts exactly the runs that started, each once');
  const sum = Math.round(gate.members.reduce((a, m) => a + m.spentUsd, 0) * 1e6) / 1e6;
  assert.ok(gate.treeSpentUsd > 0);
  assert.equal(Math.round(gate.treeSpentUsd * 1e6) / 1e6, sum, 'the tree total is the sum of the members: a replaced run\'s spend stays counted, once');
  const budget = budgetOf(S.rootDir, { record, gate });
  assert.equal(budget.heldUsd, 0, 'every node is closed or dead: no grant is still held');
  assert.ok(Math.abs(budget.availableUsd - (100 - gate.treeSpentUsd)) < 1e-9);
  for (const n of budget.nodes.filter(x => ['R@g1', 'R@g2', 'R/M1@g1', 'R/M3@g1'].includes(x.key))) assert.ok(n.spentUsd > 0, `${n.key}: a replaced node's spend is still counted`);
});
