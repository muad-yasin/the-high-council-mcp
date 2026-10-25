// 0.8.3 M7 apply, C2a-record commit 4, K8 (plan + gate answer: Review/Build_0.8.3/m7/C2a_Commit4_K8_Plan_2026-10-18.md; C&C thcmcp-6d: option (i), the fold fills `adopted`; condition: the fold fills it ONLY from the preview the approval BINDS).
// The record rules for adoption, on a REAL record: every event is appended through the real table (appendTreeEvent), the same way the sub-plan MONEY row of test/tree-subplan-candidates.test.js builds its tree. Nothing in src/ writes a `reused` entry yet (C2b's `describe` will), so these rows are hand-written
// previews through the real table; what they prove is the REFUSAL side and the fold, and the K4 predicate on a record the table and the fold built (not a seeded Map). $0, no run is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as TR from '../src/tree-transitions.js';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { budgetOf } from '../src/tree-budget.js';
import { frontierKey } from '../src/tree-identity.js';
import { track } from './helpers/temp-trees.js';
import { FIXTURE_BOUND, GATE_FIELDS as GF, IDS, SPLIT, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';

// a namespace import, so that a missing export (the base of this commit, for the red run) fails the tests that call it and not the whole file at link time
const { isSupersededGeneration, liveNodesByPath, orphansOf, heldKeys, candidatesOf } = TR;
const BOUND2 = 'e'.repeat(64);
const sorted = list => [...list].sort();

/**
 * R -> R/M1 (needs_decision) -> R/M1/A ($8 spent); R/M1 is regenerated (a decision opens R/M1@g2), the new plan registers R/M1@g2 and closes it; R/M1/A@g1 is now a CANDIDATE (sub route, held). Returns the tree and the parent of the NEW children frontier.
 */
function tree() {
  const t = closedRootTree(); track(t.work);
  const k1 = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, k1, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: 'needs_decision', share: 'released', returnedUsd: 10 });
  const sub = { parentNode: 'R/M1', parentGeneration: 1, parentRunId: IDS[0], splitSha256: SPLIT, children: [{ node: 'R/M1/A', generation: 1 }] };
  const k2 = frontierKey({ ...sub, openedBy: null });
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: k2, ...sub, boundSha256: FIXTURE_BOUND });
  appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GF, frontierKey: k2, revision: 1, boundSha256: FIXTURE_BOUND });
  registerKid(t, k2, 'R/M1/A', IDS[1], 10); syntheticRun(t, IDS[1], { usage: [{ file: 'a', usd: 8, provider: 'mock' }] });
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1/A', IDS[1], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1/A', generation: 1, runId: IDS[1], outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released', returnedUsd: 2 });
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: IDS[0], source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/A', generation: 1 }] });
  const dec = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, affected: [{ node: 'R/M1', generation: 1 }], ...GF });
  appendTreeEvent(t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R/M1', generation: 2 }] });
  const kR = approveFrontier(t.rootDir, ['R/M1'], { generation: 2 });
  registerKid(t, kR, 'R/M1', IDS[2], 10, 2); syntheticRun(t, IDS[2], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[2], process.pid, 2, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 2, runId: IDS[2], outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released', returnedUsd: 10 });
  return { t };
}
const reused = (over = {}) => ({ adoptsNode: 'R/M1/A', adoptsGeneration: 1, runId: IDS[1], fieldsSha256: 'a'.repeat(64), identityMap: {}, ...over });
/** the new plan's children frontier: R/M1/A@g2 (a new node on the old path) and R/M1/B@g2, which ADOPTS the old R/M1/A@g1 (a relocation onto a colliding path). `r` = the reused entry; `bound` = the preview hash. */
const preview = (t, { r = reused(), bound = FIXTURE_BOUND, children = null, key = null } = {}) => {
  const kids = children ?? [{ node: 'R/M1/A', generation: 2 }, { node: 'R/M1/B', generation: 2, ...(r ? { reused: r } : {}) }];
  const base = { parentNode: 'R/M1', parentGeneration: 2, parentRunId: IDS[2], splitSha256: SPLIT, children: kids };
  const k = key ?? frontierKey({ ...base, openedBy: null, children: kids.map(c => ({ node: c.node, generation: c.generation })) });
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: k, ...base, boundSha256: bound });
  return k;
};
const approve = (t, k, bound = FIXTURE_BOUND, revision = 1) => appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GF, frontierKey: k, revision, boundSha256: bound });
const refused = (fn, re) => assert.throws(fn, e => e instanceof TreeRefusal && re.test(e.reason ?? e.message), String(re));
const state = t => stateOf(readTreeRecord(t.rootDir));

test('K8 the slot rule, REFUSAL side (real table): a `reused` entry that names an unknown node, a generation the candidate does not have, or a run that is not the candidate\'s is refused, and so is one candidate in two slots of one frontier', () => {
  const { t } = tree();
  assert.deepEqual(sorted(heldKeys(state(t))), ['R/M1/A@g1'], 'the fixture: R/M1/A@g1 is a candidate of the replaced R/M1');
  refused(() => preview(t, { r: reused({ adoptsNode: 'R/M1/Z' }) }), /R\/M1\/Z@g1, which is not a candidate of this tree/);
  refused(() => preview(t, { r: reused({ adoptsGeneration: 2 }) }), /R\/M1\/A@g2, which is not a candidate of this tree/);
  refused(() => preview(t, { r: reused({ runId: IDS[7] }) }), new RegExp(`with run ${IDS[7]}, but the candidate's own run is ${IDS[1]}`));
  refused(() => preview(t, { children: [{ node: 'R/M1/A', generation: 2, reused: reused() }, { node: 'R/M1/B', generation: 2, reused: reused() }] }), /named for two slots of one frontier/);
  assert.equal(readTreeRecord(t.rootDir).events.filter(e => e.event === 'frontier_previewed' && e.parentNode === 'R/M1' && e.parentGeneration === 2).length, 0, 'nothing was recorded by the refused previews');
});

test('K8 the fold fills `adopted` from the approved preview, and K4\'s predicate then works on a REAL record: the adopted old node is live beside the new-era node of its path, is no longer an orphan or a candidate, and the others are judged as before', () => {
  const { t } = tree();
  const k = preview(t);
  assert.equal(state(t).adopted.size, 0, 'a preview alone adopts nothing');
  approve(t, k);
  registerKid(t, k, 'R/M1/A', IDS[3], 10, 2);                                   // the NEW node on the reused path
  const st = state(t);
  assert.deepEqual([...st.adopted], [['R/M1/A@g1', { slot: 'R/M1/B@g2', frontierKey: k, runId: IDS[1] }]]);
  assert.equal(isSupersededGeneration(st, 'R/M1/A', 1), false, 'K4 end to end: R/M1/A@g2 exists, yet the adopted R/M1/A@g1 is not replaced');
  assert.equal(isSupersededGeneration(st, 'R/M1', 1), true, 'R/M1@g1 was replaced and nobody adopted it');
  assert.deepEqual([...liveNodesByPath(st).get('R/M1/A')].map(n => `${n.node}@g${n.generation}`), ['R/M1/A@g2', 'R/M1/A@g1'], 'both nodes of the path are live');
  assert.equal(orphansOf(st).has('R/M1/A@g1'), false, 'an adopted node is not an orphan');
  assert.equal(heldKeys(st).has('R/M1/A@g1'), false); assert.equal(candidatesOf(st).some(c => c.key === 'R/M1/A@g1'), false, 'and it is no longer a candidate');
});

test('K8 a candidate fills ONE slot: a second frontier that names an already adopted candidate is refused at the preview; two competing previews, the first approved, make the second approval STALE (refused); a re-approval of the same frontier is fine', () => {
  const { t } = tree();
  const k1 = preview(t);
  const k2 = preview(t, { children: [{ node: 'R/M1/A', generation: 2 }, { node: 'R/M1/C', generation: 2, reused: reused() }], bound: BOUND2 });
  assert.notEqual(k1, k2);
  approve(t, k1);
  refused(() => approve(t, k2, BOUND2), /the approval is stale: candidate R\/M1\/A@g1 is already adopted by frontier .* into R\/M1\/B@g2/);
  refused(() => preview(t, { children: [{ node: 'R/M1/A', generation: 2 }, { node: 'R/M1/D', generation: 2, reused: reused() }], bound: 'd'.repeat(64) }), /already adopted by frontier/);
  approve(t, k1, FIXTURE_BOUND, 2);                                               // a re-approval of the frontier that already holds the binding
  assert.deepEqual([...state(t).adopted.keys()], ['R/M1/A@g1']);
});

test('K8 the STATE GUARD (C&C condition): `adopted` is filled only from the preview the approval BINDS. Preview 1 with `reused`, preview 2 of the SAME frontier key without it, the approval of preview 2: NOT adopted; the control (approval of preview 1) adopts', () => {
  const { t } = tree();
  const key = 'k-same-frontier';
  const kidsWith = [{ node: 'R/M1/A', generation: 2 }, { node: 'R/M1/B', generation: 2, reused: reused() }];
  const kidsWithout = [{ node: 'R/M1/A', generation: 2 }, { node: 'R/M1/B', generation: 2 }];
  preview(t, { children: kidsWith, key, bound: FIXTURE_BOUND });
  preview(t, { children: kidsWithout, key, bound: BOUND2 });
  approve(t, key, BOUND2);
  assert.equal(state(t).adopted.size, 0, 'the approval binds preview 2, which adopts nothing; the earlier preview 1 must not count');
  const { t: c } = tree();
  preview(c, { children: kidsWith, key, bound: FIXTURE_BOUND });
  approve(c, key, FIXTURE_BOUND);
  assert.deepEqual([...state(c).adopted.keys()], ['R/M1/A@g1'], 'control: the same frontier, the approval binds the preview that adopts');
  // and the binding ends when the approval stops binding: a LATER preview of the same frontier (a new hash, still naming the candidate) is not approved, so the earlier approval no longer applies and nothing is adopted (the line `if (!approvalValid(f)) continue;` of the fold)
  preview(c, { children: kidsWith, key, bound: 'c'.repeat(64) });
  assert.equal(state(c).adopted.size, 0, 'the approval binds the OLD hash: the re-previewed frontier adopts nothing until it is approved again');
});

test('K8 abandon retires the candidates (the list is empty and a preview afterwards is refused by the final-tree rule); and MONEY on a real record: the adopted node\'s $8 is counted once before and after the adoption and the pool is unchanged', () => {
  const { t } = tree();
  const before = budgetOf(t.rootDir);
  const k = preview(t); approve(t, k);
  assert.deepEqual([...state(t).adopted.keys()], ['R/M1/A@g1'], 'the adoption really happened (without it the money comparison below would hold at a base where nothing adopts)');
  const after = budgetOf(t.rootDir);
  assert.equal(after.treeSpentUsd >= 8 - 1e-9, true, 'the $8 stays spent'); assert.equal(after.treeSpentUsd, before.treeSpentUsd, 'adopting moves no dollar');
  assert.equal(after.heldUsd, before.heldUsd); assert.equal(after.availableUsd, before.availableUsd);
  const { t: g } = tree();
  appendTreeEvent(g.rootDir, { event: 'tree_abandoned', ...GF });
  refused(() => preview(g), /was abandoned by a person/);                       // the table refuses EVERY event of a final tree with the abandon sentence before the slot rule is reached (rule (a)'s 'tree not abandoned' clause is a backstop for the fold, whose candidate list is empty after an abandon)
  assert.equal(candidatesOf(state(g)).length, 0);
});
