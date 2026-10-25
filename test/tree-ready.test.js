// The readiness rule (0.8.3 M6 slice S1; PLAN 9.1 items 1-3 and 5, the held-items part of item 4; M6 exit checks 1 (first half), 3, 4, 5, 9, 11). Two kinds of test:
//   - the RULES, on hand-built facts (verdictOf): every rule has a case that must come out `ready` and a case that must not, so a stub that always answers one verdict fails;
//   - the READERS, on real all-mock trees ($0): a finished single-node tree is `ready`, a sealed file edited afterwards is not, a real split tree shows its unexpanded children and its agreement, nothing is written.
// S1 counted no integration_recorded result; since S2 an AGREEMENT's result counts only as `council tree check` writes it (complete and bound to the versions that exist now: test/tree-check.test.js). Here a tree with an agreement or a held item is not ready, even when a BARE `pass` event is in the record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/api.js';
import { canonicalJson, sha256Of } from '../src/thin-contract.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { registerRoot } from '../src/tree-register.js';
import { runTree } from '../src/tree-run.js';
import { verifySplit } from '../src/tree-expansion.js';
import { subtreeEligible } from '../src/tree-deps.js';
import { isDeniedPath } from '../src/tools.js';
import { gatherReadinessFacts, heldTargetsOf, readinessOf, verdictOf, VERDICTS } from '../src/tree-ready.js';
import { APPROVAL_FIELDS, FIXTURE_BOUND, GATE_FIELDS, IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, newTree, registerKid, reservedLine, root as repoRoot, rootOpts, settledLine, syntheticRun, writeLines } from './helpers/tree-fixture.js';
import { track, trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- hand-built facts
const HEX = c => c.repeat(64);
const run = (over = {}) => ({ unreadable: null, passed: true, signedOff: true, sameAsSigned: true, changedBy: [], lint: { status: 'ready_for_build', findings: [] }, thinContractSha256: HEX('a'), contractExit: 0, ...over });
const node = (path, over = {}) => ({
  node: path, generation: 1, runId: `run-${path.replace(/\//g, '-')}`, phase: 'closed', depth: path.split('/').length - 1, nextGeneration: null, outcome: 'passed', closedStatus: 'ready_for_build',
  stale: [], providers: [], run: run(), split: null, held: [], ...over,
});
const split = (milestones, over = {}) => ({ readable: true, sha256: HEX('5'), verifiedSha256: HEX('5'), refusals: [], milestones, agreements: [], resolved: [], ...over });
const ms = (id, status) => ({ id, status });
const facts = (nodes, over = {}) => ({ problems: [], treeId: 'T', sticky: [], accounting: { ok: true, problems: [] }, openStops: [], limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 4, runs: nodes.length }, nodes, ...over });
const codes = r => r.reasons.map(x => x.code);
const only = (r, code) => r.reasons.filter(x => x.code === code);
/** A root that split into milestones M1 (decompose, child R/M1 given) and M2 (ready). */
const splitTree = (child = node('R/M1'), rootOver = {}) => facts([node('R', { split: split([ms('M1', 'decompose'), ms('M2', 'ready')]), ...rootOver }), child]);

test('a finished single node with a clean lint is ready, with no reason (the stub killer: not every tree is incomplete)', () => {
  const r = verdictOf(facts([node('R')]));
  assert.equal(r.verdict, 'ready'); assert.deepEqual(r.reasons, []); assert.deepEqual(r.milestones, []);
  assert.deepEqual(VERDICTS, ['ready', 'incomplete', 'blocked']);
});

test('R16: the denylist reaches the contract check: gatherReadinessFacts(rootDir, { work, deny }) asks `deny` about the task path the run folder names (an MCP caller passes isDeniedPath), and the CLI without `deny` asks nobody', async () => {
  const t = await leafTree();
  const runDir = join(t.runsDir, ROOT_ID);
  const metaFile = join(runDir, 'run.json'); const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  writeFileSync(join(t.work, '.env'), readFileSync(meta.task, 'utf8'));
  writeFileSync(metaFile, JSON.stringify({ ...meta, task: '.env' }));
  const seen = [];
  gatherReadinessFacts(t.rootDir, { work: t.work, deny: p => { seen.push(p); return isDeniedPath(p); } });
  assert.ok(seen.some(p => /\.env$/.test(p)), `deny was asked about the recorded task path: ${JSON.stringify(seen)}`);
  const open = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.equal(open.nodes[0].run.contractExit, 0, 'no deny: the CLI reads the person\'s own folder as before');
  const guarded = gatherReadinessFacts(t.rootDir, { work: t.work, deny: isDeniedPath });
  assert.ok(guarded.nodes[0].run, 'and the guarded read still answers');
});

test('R2: eligibility (subtreeEligible) and the readiness rule (verdictOf) are ONE status policy: for every Status and every mix of decompose / needs-decision milestones they agree on whether the node\'s Status is allowed', () => {
  const statuses = ['ready_for_build', 'partial', 'needs_decision', 'needs_evidence', 'blocked'];
  let allowed = 0; let refused = 0;
  for (const status of statuses) for (const hasDecompose of [false, true]) for (const hasNeeds of [false, true]) {
    const milestones = [ms('M0', 'ready'), ...(hasDecompose ? [ms('M1', 'decompose')] : []), ...(hasNeeds ? [ms('M2', 'needs-decision')] : [])];
    const findings = status === 'ready_for_build' ? [] : ['status_not_ready'];
    const children = hasDecompose ? [node('R/M1')] : [];
    const ready = verdictOf(facts([node('R', { split: split(milestones, { resolved: hasNeeds ? ['M2'] : [] }), run: run({ lint: { status, findings } }) }), ...children]));
    const policyOk = !ready.reasons.some(x => x.code === 'status_policy');
    const eligible = subtreeEligible([{ node: 'R', closed: true, passed: true, incomplete: false, status, hasDecompose, hasNeeds, openStop: false, itemsOk: true, hasBlock: false, blockOk: true }]).eligible;
    assert.equal(eligible, policyOk, `${status} decompose=${hasDecompose} needs=${hasNeeds}: eligibility says ${eligible}, the readiness rule says ${policyOk}`);
    if (policyOk) allowed += 1; else refused += 1;
  }
  assert.ok(allowed > 0 && refused > 0, 'the table has both kinds of case (not a stub that answers one way)');
});

test('R2 follow-up: a closed, passed node with NO recorded Status is not eligible (\"ended with no recorded Status\") and is not ready (no milestone lint): two readers, one rule', () => {
  const elig = subtreeEligible([{ node: 'R/M1', closed: true, passed: true, incomplete: false, status: null, openStop: false, itemsOk: true, hasBlock: false, blockOk: true }]);
  assert.equal(elig.eligible, false); assert.deepEqual(elig.why, ['R/M1 ended with no recorded Status']);
  const ready = verdictOf(facts([node('R'), node('R/M1', { closedStatus: null, run: run({ lint: null }) })]));
  assert.ok(ready.reasons.some(x => x.code === 'no_milestone_lint' && x.scope === 'R/M1@g1'), JSON.stringify(ready.reasons));
  assert.notEqual(ready.verdict, 'ready');
});

test('item 1: a root that split into a ready child and a ready milestone is ready, and both milestones are settled', () => {
  const r = verdictOf(splitTree());
  assert.equal(r.verdict, 'ready', JSON.stringify(r.reasons));
  assert.deepEqual(r.milestones.map(m => [m.node, m.id, m.status, m.settled]), [['R', 'M1', 'decompose', true], ['R', 'M2', 'ready', true]]);
});

test('M6 exit 5: an unexpanded decompose milestone is incomplete, names its child, and is never settled; a reached limit is named, a free one is not', () => {
  const unexpanded = facts([node('R', { split: split([ms('M1', 'decompose'), ms('M2', 'ready')]) })]);
  const r = verdictOf(unexpanded);
  assert.equal(r.verdict, 'incomplete');
  assert.deepEqual(codes(r), ['unexpanded']);
  assert.match(r.reasons[0].text, /milestone M1 is decompose and its child R\/M1 is not registered/);
  assert.doesNotMatch(r.reasons[0].text, /limit/, 'no limit is reached, so none is named');
  assert.deepEqual(r.milestones.map(m => m.settled), [false, true], 'the decompose milestone is not settled, the ready one is');
  const atRuns = verdictOf({ ...unexpanded, limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 4, runs: 12 } });
  assert.equal(atRuns.verdict, 'incomplete'); assert.match(atRuns.reasons[0].text, /the run limit is reached: 12 of 12/);
  const atDepth = verdictOf({ ...unexpanded, limits: { maxDepth: 0, maxRuns: 12, maxChildrenPerSplit: 4, runs: 1 } });
  assert.match(atDepth.reasons[0].text, /the depth limit 0 is reached/);
  assert.equal(atRuns.milestones.some(m => m.status === 'decompose' && m.settled), false, 'a limit never produces a ready milestone');
});

test('item 1: a needs-decision milestone settles only with a milestone_resolved, and then its node may end needs_decision with exactly status_not_ready', () => {
  const open = verdictOf(facts([node('R', { split: split([ms('M1', 'needs-decision')]), run: run({ lint: { status: 'needs_decision', findings: ['status_not_ready'] } }) })]));
  assert.equal(open.verdict, 'incomplete'); assert.deepEqual(codes(open), ['needs_decision_unresolved']); assert.equal(open.milestones[0].settled, false);
  const resolved = verdictOf(facts([node('R', { split: split([ms('M1', 'needs-decision')], { resolved: ['M1'] }), run: run({ lint: { status: 'needs_decision', findings: ['status_not_ready'] } }) })]));
  assert.equal(resolved.verdict, 'ready', JSON.stringify(resolved.reasons)); assert.equal(resolved.milestones[0].settled, true);
  const extra = verdictOf(facts([node('R', { split: split([ms('M1', 'needs-decision')], { resolved: ['M1'] }), run: run({ lint: { status: 'needs_decision', findings: ['status_not_ready', 'criterion_not_discharged'] } }) })]));
  assert.equal(extra.verdict, 'blocked'); assert.deepEqual(codes(extra), ['status_policy']);
});

test('item 2, the Status policy, case by case (partial and needs_decision are allowed only with exactly status_not_ready and only beside the milestone kind that explains them)', () => {
  const D = [ms('M1', 'decompose')]; const N = [ms('M1', 'needs-decision')]; const R = [ms('M1', 'ready')];
  const cases = [
    // [status, findings, milestones, resolved?, ok]
    ['ready_for_build', [], R, true], ['ready_for_build', [], D, true], ['ready_for_build', ['milestone_no_check'], R, false],
    ['partial', ['status_not_ready'], D, true], ['partial', ['status_not_ready'], R, false], ['partial', ['status_not_ready', 'criterion_not_discharged'], D, false], ['partial', [], D, false],
    ['needs_decision', ['status_not_ready'], N, true], ['needs_decision', ['status_not_ready'], D, false], ['blocked', ['status_not_ready'], D, false], [null, ['no_status'], R, false],
  ];
  for (const [status, findings, milestones, ok] of cases) {
    const n = node('R', { split: split(milestones, { resolved: ['M1'] }), run: run({ lint: { status, findings } }) });
    // a decompose milestone needs its child to be ready for the node to count: give it one
    const r = verdictOf(facts(milestones === D ? [n, node('R/M1')] : [n]));
    assert.equal(r.verdict === 'ready', ok, `${status} + ${findings.join(',') || 'no findings'} on ${milestones[0].status}: ${JSON.stringify(r.reasons.map(x => x.code))}`);
    if (!ok) assert.deepEqual(codes(r), ['status_policy']);
  }
});

test('M6 exit 11: a depth-1 partial node whose only finding is status_not_ready and whose decompose milestones have ready children counts; one more finding does not', () => {
  const tree = lint => facts([
    node('R', { split: split([ms('M1', 'decompose')]) }),
    node('R/M1', { split: split([ms('M1', 'decompose')]), run: run({ lint }) }),
    node('R/M1/M1'),
  ]);
  const ok = verdictOf(tree({ status: 'partial', findings: ['status_not_ready'] }));
  assert.equal(ok.verdict, 'ready', JSON.stringify(ok.reasons));
  const bad = verdictOf(tree({ status: 'partial', findings: ['status_not_ready', 'criterion_not_discharged'] }));
  assert.equal(bad.verdict, 'blocked'); assert.deepEqual(bad.reasons.map(x => [x.code, x.scope]), [['status_policy', 'R/M1@g1']]);
  assert.equal(bad.milestones.find(m => m.node === 'R' && m.id === 'M1').settled, false, 'the parent milestone is not settled while its child is not ready');
});

test('item 2 fails closed: a report with no milestone lint record is blocked, never "no findings"', () => {
  const r = verdictOf(facts([node('R', { run: run({ lint: null }) })]));
  assert.equal(r.verdict, 'blocked'); assert.deepEqual(codes(r), ['no_milestone_lint']);
});

test('M6 exit 3: the root is judged like any child: unsigned text, a lint finding, a failed contract check each keep the tree from ready, and the child gets the same verdict', () => {
  for (const path of ['R', 'R/M1']) {
    const mk = over => { const nodes = [node('R', { split: split([ms('M1', 'decompose')]) }), node('R/M1')]; const i = nodes.findIndex(n => n.node === path); nodes[i] = { ...nodes[i], run: run(over) }; return facts(nodes); };
    assert.equal(verdictOf(mk({})).verdict, 'ready', path);
    const unsigned = verdictOf(mk({ sameAsSigned: false, changedBy: ['reviser', 'final_edit'] }));
    assert.equal(unsigned.verdict, 'blocked', path); assert.equal(only(unsigned, 'unsigned_change').length, 1);
    assert.match(unsigned.reasons.find(x => x.code === 'unsigned_change').text, /blocked: unsigned change.*changed by reviser, final_edit/, path);
    assert.equal(verdictOf(mk({ signedOff: false })).verdict, 'blocked', path);
    assert.deepEqual(codes(verdictOf(mk({ lint: { status: 'ready_for_build', findings: ['milestone_no_check'] } }))), ['status_policy'], path);
    for (const exit of [1, 2, null]) assert.deepEqual(codes(verdictOf(mk({ contractExit: exit }))), ['contract_check'], `${path} exit ${exit}`);
  }
});

test('item 5: a run that did not pass is blocked; one closed incomplete by a person, still running, registered only or stopped at its cap is incomplete', () => {
  assert.deepEqual(codes(verdictOf(facts([node('R', { run: run({ passed: false }) })]))), ['not_passed']);
  assert.equal(verdictOf(facts([node('R', { run: { unreadable: 'report.json is missing or unreadable' } })])).verdict, 'blocked');
  const incompleteBy = { closed_incomplete: { outcome: 'incomplete' }, running: { phase: 'running', run: null }, not_started: { phase: 'registered', run: null }, stopped: { phase: 'stopped', run: null } };
  for (const [code, over] of Object.entries(incompleteBy)) { const r = verdictOf(facts([node('R', over)])); assert.equal(r.verdict, 'incomplete', code); assert.deepEqual(codes(r), [code]); }
});

test('item 5: stale nodes are incomplete (a stop put them in question; a provider has a newer generation), a re-sealed provider is blocked, a newer generation that is only opened is pending', () => {
  const stale = verdictOf(splitTree(node('R/M1', { stale: ['stop e5 put it in question'] })));
  assert.equal(stale.verdict, 'incomplete'); assert.deepEqual(stale.reasons.map(x => [x.code, x.scope]), [['stale', 'R/M1@g1']]);
  const consumer = pins => verdictOf(splitTree(node('R/M1', { providers: [pins] })));
  const gen2 = consumer({ node: 'R/M2', boundGeneration: 1, newestGeneration: 2, pinChanged: false });
  assert.equal(gen2.verdict, 'incomplete'); assert.match(gen2.reasons[0].text, /registered against R\/M2@g1, and R\/M2 now has generation 2/);
  const pin = consumer({ node: 'R/M2', boundGeneration: 1, newestGeneration: 1, pinChanged: true });
  assert.equal(pin.verdict, 'blocked'); assert.deepEqual(codes(pin), ['provider_pin']);
  assert.equal(consumer({ node: 'R/M2', boundGeneration: 1, newestGeneration: 1, pinChanged: false }).verdict, 'ready', 'the same provider, unchanged, blocks nothing');
  const pending = verdictOf(splitTree(node('R/M1', { nextGeneration: 2, run: run({ passed: false, contractExit: 1 }) })));
  assert.deepEqual(codes(pending), ['generation_pending'], 'the replaced generation is not judged further: its broken run adds nothing, and the milestone it would settle is not read');
  assert.equal(only(pending, 'generation_pending').length, 1); assert.equal(pending.verdict, 'incomplete'); assert.match(pending.reasons.find(x => x.code === 'generation_pending').text, /generation 2 was opened and is not registered yet/);
});

test('item 5: an open needs_decision stop and each sticky block keep the tree from ready; so does a failing accounting gate; a missing root is incomplete', () => {
  const stop = verdictOf({ ...facts([node('R')]), openStops: [{ id: 'e7', node: 'R', generation: 1 }] });
  assert.equal(stop.verdict, 'incomplete'); assert.deepEqual(codes(stop), ['open_stop']);
  for (const reason of ['parent_changed', 'root_affected', 'record_corrupt']) { const r = verdictOf({ ...facts([node('R')]), sticky: [reason] }); assert.equal(r.verdict, 'blocked', reason); assert.match(r.reasons[0].text, new RegExp(reason)); }
  const acct = verdictOf({ ...facts([node('R')]), accounting: { ok: false, problems: [{ code: 'mirror_disagrees', detail: 'R:r1 differs' }] } });
  assert.equal(acct.verdict, 'blocked'); assert.match(acct.reasons[0].text, /mirror_disagrees \(R:r1 differs\)/);
  const none = verdictOf(facts([]));
  assert.equal(none.verdict, 'incomplete'); assert.deepEqual(codes(none), ['root_missing']);
});

test('item 1 / PLAN 5.5: a split that is not verified is incomplete; a refusal recorded after its last verification, a changed block or an unreadable fence is blocked', () => {
  const at = over => verdictOf(facts([node('R', { split: split([ms('M1', 'ready')], over) })]));
  assert.deepEqual(codes(at({ verifiedSha256: null })), ['split_not_verified']);
  assert.equal(at({ verifiedSha256: null }).verdict, 'incomplete');
  const refused = at({ refusals: [{ check: 'handoff_differs', detail: 'PLAN 5.5 item 3 (handoff_differs): children[0].scope differs' }] });
  assert.equal(refused.verdict, 'blocked'); assert.deepEqual(codes(refused), ['expansion_refused']); assert.match(refused.reasons[0].text, /children\[0\]\.scope differs/);
  const refusedUnverified = at({ verifiedSha256: null, refusals: [{ check: 'no_split', detail: 'the plan holds no split block' }] });
  assert.deepEqual(codes(refusedUnverified), ['expansion_refused'], 'a refusal with no verification is one reason, not two');
  const changed = at({ refusals: [{ check: 'split_changed', detail: 'R@g1 was verified with split abc; its plan now reads as def: the first verification stands' }] });
  assert.deepEqual(codes(changed), ['split_changed']); assert.equal(changed.verdict, 'blocked');
  const drift = at({ sha256: HEX('6') }); assert.deepEqual(codes(drift), ['split_changed']);
  assert.deepEqual(codes(at({ readable: false, sha256: null })), ['split_unreadable']);
});

test('item 4 (held items), S1: every agreement, check-not-enforced item and context-only obligation is a reason naming its id; S1 counts no recorded pass; no reason names a command', () => {
  const held = [
    { kind: 'check_not_enforced', key: 'k1', label: 'R@g1:C2', text: 'The heading Assumptions is named' },
    { kind: 'guard_refused', key: 'k2', label: 'R@g1:C3', text: 'The summary is written to BOARD.md' },
    { kind: 'context_only', key: 'k3', label: 'R@g1:C4', text: 'Nothing leaves the building' },
  ];
  const r = verdictOf(facts([node('R', { split: split([ms('M1', 'ready')], { agreements: ['A1', 'A2'] }), held })]));
  assert.equal(r.verdict, 'incomplete');
  assert.deepEqual(r.reasons.map(x => [x.code, x.scope]), [['integration_unrecorded', 'R@g1:A1'], ['integration_unrecorded', 'R@g1:A2'], ['held_unrecorded', 'R@g1:C2'], ['held_unrecorded', 'R@g1:C3'], ['held_unrecorded', 'R@g1:C4']]);
  assert.match(r.reasons.find(x => x.scope === 'R@g1:C2').text, /check not enforced R@g1:C2 \("The heading Assumptions is named"\) has no recorded pass/);
  for (const x of r.reasons) assert.doesNotMatch(x.text, /council tree|tree check|--/, 'no route is named until a test shows the tree accepts it (the 4b rule)');
  // an obligation carried by two nodes is one reason: the carrier loop saw it once
  const twice = verdictOf(facts([node('R', { split: split([ms('M1', 'decompose')]), held: [held[2]] }), node('R/M1', { held: [held[2]] })]));
  assert.equal(only(twice, 'held_unrecorded').length, 1, 'deduplicated by identity, not by carrier');
});

test('precedence: blocked wins over incomplete and both stay listed; removing the blocked reason leaves incomplete', () => {
  const both = verdictOf(splitTree(node('R/M1', { run: run({ contractExit: 1 }) }), { split: split([ms('M1', 'decompose'), ms('M2', 'needs-decision')]) }));
  assert.equal(both.verdict, 'blocked'); assert.deepEqual([...new Set(both.reasons.map(x => x.severity))].sort(), ['blocked', 'incomplete']);
  const without = verdictOf(splitTree(node('R/M1'), { split: split([ms('M1', 'decompose'), ms('M2', 'needs-decision')]) }));
  assert.equal(without.verdict, 'incomplete'); assert.deepEqual(codes(without), ['needs_decision_unresolved']);
});

test('a facts object with problems (tree.json or the record does not read, the tree has not started) is blocked and nothing else is judged', () => {
  const r = verdictOf({ ...facts([node('R', { run: run({ passed: false }) })]), problems: ['the tree record is corrupt at line 3: not valid UTF-8 JSON'] });
  assert.equal(r.verdict, 'blocked'); assert.deepEqual(codes(r), ['record_unreadable']); assert.deepEqual(r.inputs.nodes, []);
});

test('the answer is plain, sorted and repeatable: no Map or Set, reasons sorted by scope, inputs sorted by path, two calls canonical-JSON-equal (S3 compares inputs)', () => {
  const f = facts([node('R/M2'), node('R', { split: split([ms('M1', 'decompose'), ms('M2', 'decompose')], { agreements: ['A2', 'A1'] }) }), node('R/M1', { run: run({ contractExit: 2 }) })]);
  const a = verdictOf(f); const b = verdictOf(JSON.parse(JSON.stringify(f)));
  assert.equal(canonicalJson(a), canonicalJson(b)); assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'it survives a JSON round trip unchanged');
  assert.deepEqual(a.inputs.nodes.map(n => n.node), ['R', 'R/M1', 'R/M2']);
  assert.deepEqual(Object.keys(a.inputs.nodes[0]), ['node', 'generation', 'runId', 'phase', 'passed', 'status', 'thinContractSha256']);
  assert.deepEqual(a.inputs.integrations, []);
  const scopes = a.reasons.map(x => x.scope); assert.deepEqual(scopes, [...scopes].sort());
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- real trees
const leafRootChain = () => {
  const c = JSON.parse(readFileSync(join(repoRoot, 'chains', 'mock-debate.json'), 'utf8'));
  return { ...c, seats: { ...c.seats, handoff: { provider: 'mock', model: 'mock-handoff-reads-prompt' } }, handoff_contract: { ...(c.handoff_contract ?? {}), milestones: true } };
};
/** A single-node tree whose root really ran (all-mock) on a chain that writes milestones: the one real tree that can be ready. */
async function leafTree() {
  const t = newTree({ rootChain: 'leaf-root', extraChains: { 'leaf-root': leafRootChain() } });
  track(t.work);
  registerRoot(t.rootDir);
  const res = await api.run(rootOpts(t));
  assert.equal(res.exitCode, 0, res.outputTail);
  return t;
}
/** Every file AND folder under a folder: [path, size, sha256] (a folder: [path + "/", 0, ""]), sorted: an empty folder a reader created shows too. */
function snapshot(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    return e.isDirectory() ? [[`${p.slice(base.length)}/`, 0, ''], ...snapshot(p, base)] : [[p.slice(base.length), statSync(p).size, sha256Of(readFileSync(p, 'utf8'))]];
  }).sort((x, y) => (x[0] < y[0] ? -1 : 1));
}
/** The real facts of a tree with a healthy lint patched in for every node (the all-mock split chain writes no milestones, so its reports have none): what is left is the tree's own structure. */
const healthy = f => ({ ...f, nodes: f.nodes.map(n => (n.run && !n.run.unreadable ? { ...n, run: { ...n.run, lint: { status: 'ready_for_build', findings: [] } } } : n)) });

test('a real finished single-node tree (all-mock, milestones on) is ready, with its inputs; the same tree is not ready once a sealed file is edited', async () => {
  const t = await leafTree();
  const untouched = snapshot(t.work);
  const r = readinessOf(t.rootDir, { work: t.work });
  assert.deepEqual(snapshot(t.work), untouched, 'the first read of a finished tree writes nothing (file, folder or byte)');
  assert.equal(r.verdict, 'ready', JSON.stringify(r.reasons));
  assert.deepEqual(r.inputs.nodes.map(n => [n.node, n.generation, n.phase, n.passed, n.status]), [['R', 1, 'closed', true, 'ready_for_build']]);
  assert.match(r.inputs.nodes[0].thinContractSha256, /^[0-9a-f]{64}$/);
  // the check can fail: the delivered file is no longer the file the run wrote
  appendFileSync(join(t.runsDir, ROOT_ID, 'deliverable.md'), '\nA later edit.\n');
  const after = readinessOf(t.rootDir, { work: t.work });
  assert.equal(after.verdict, 'blocked'); assert.ok(codes(after).includes('contract_check'), JSON.stringify(after.reasons));
});

test('a real record that does not read is blocked and nothing else is judged; `work` is required', async () => {
  const t = await leafTree();
  assert.throws(() => readinessOf(t.rootDir), /`work`/);
  appendFileSync(join(t.rootDir, 'tree', 'events.jsonl'), 'this is not json\n');
  const r = readinessOf(t.rootDir, { work: t.work });
  assert.equal(r.verdict, 'blocked'); assert.deepEqual(codes(r), ['record_unreadable']); assert.match(r.reasons[0].text, /corrupt/);
});

test('a real split tree: after the root ran, the children are unexpanded and the agreement is open; the all-mock split root records its milestone lint (M6 fixtures), so the real reader is incomplete and not blocked; the same record with the root\'s lint removed is blocked no_milestone_lint; the facts are plain data', async () => {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const facts0 = gatherReadinessFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(JSON.parse(JSON.stringify(facts0)), facts0, 'facts hold no Map, Set or undefined');
  assert.equal(facts0.nodes.length, 1); assert.equal(facts0.nodes[0].split.verifiedSha256, r.split, 'the verified split of the record is read');
  assert.deepEqual(facts0.nodes[0].split.milestones.map(m => m.id), ['M1', 'M2', 'M3', 'M4', 'M5']); assert.deepEqual(facts0.nodes[0].split.agreements, ['A1']);
  const v = verdictOf(facts0);
  assert.equal(v.verdict, 'incomplete'); assert.deepEqual(only(v, 'no_milestone_lint'), [], 'the root recorded a lint');
  assert.deepEqual(only(v, 'unexpanded').map(x => x.text.match(/child (\S+)/)[1]), ['R/M1', 'R/M2', 'R/M3']);
  assert.deepEqual(codes(v).filter((c, i, a) => a.indexOf(c) === i), ['unexpanded', 'integration_unrecorded']);
  assert.equal(verdictOf(healthy(facts0)).verdict, 'incomplete', 'the patched control still reads the same');
  // the same record with the root's lint taken out (the way a project-writable report can lose it): the old reading, from the real reader
  const file = join(r.runDir, 'report.json'); const rep = JSON.parse(readFileSync(file, 'utf8')); delete rep.handoff_milestones; writeFileSync(file, JSON.stringify(rep));
  const bare = verdictOf(gatherReadinessFacts(r.t.rootDir, { work: r.t.work }));
  assert.equal(bare.verdict, 'blocked'); assert.deepEqual(only(bare, 'no_milestone_lint').map(x => x.scope), ['R@g1']);
  assert.equal(r.runDir.endsWith(ROOT_ID), true);
});

test('M6 exit 1 (first half): a real split tree whose children all passed and whose one integration check is unrecorded is incomplete NAMING it; a bare `pass` event in the record changes nothing in S1; nothing is written', async () => {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  const one = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(one.started.map(s => s.node), ['R/M1', 'R/M2', 'R/M3']);
  const untouched = snapshot(r.t.work);                                    // taken BEFORE the first read of this tree
  const f = healthy(gatherReadinessFacts(r.t.rootDir, { work: r.t.work }));
  assert.deepEqual(f.nodes.map(n => [n.node, n.phase, n.run.passed, n.run.contractExit]), [['R', 'closed', true, 0], ['R/M1', 'closed', true, 0], ['R/M2', 'closed', true, 0], ['R/M3', 'closed', true, 0]]);
  const v = verdictOf(f);
  assert.equal(v.verdict, 'incomplete', JSON.stringify(v.reasons));
  assert.deepEqual(v.reasons.map(x => [x.code, x.scope]), [['integration_unrecorded', 'R@g1:A1']]);
  assert.match(v.reasons[0].text, /agreement R@g1:A1 has no recorded pass/);
  assert.deepEqual(v.milestones.filter(m => !m.settled), [], 'every milestone is settled: the children are ready');
  assert.deepEqual(v.inputs.nodes.map(n => n.node), ['R', 'R/M1', 'R/M2', 'R/M3']);
  readinessOf(r.t.rootDir, { work: r.t.work }); readinessOf(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(snapshot(r.t.work), untouched, 'reading writes nothing: no file changed, none added, no folder made, in the root folder or anywhere in the working folder');
  // a bare result is not counted: it has no gate, no hash and no binding (the negative case; the positive ones are in test/tree-check.test.js)
  appendTreeEvent(r.t.rootDir, { event: 'integration_recorded', agreement: 'R@g1:A1', result: 'pass' });
  const afterPass = verdictOf(healthy(gatherReadinessFacts(r.t.rootDir, { work: r.t.work })));
  assert.equal(afterPass.verdict, 'incomplete'); assert.deepEqual(afterPass.reasons.map(x => x.scope), ['R@g1:A1']);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- newest generation and orphans (a record written by hand, as test/tree-replace.test.js does)
/** Appends events to a tree's record as raw lines (ids continue the record's; the reader checks shape, the transition table is the writers' job). */
function rawEvents(t, list) {
  let n = Number(readTreeRecord(t.rootDir).events.at(-1).id.slice(1));
  for (const ev of list) { n += 1; appendFileSync(join(t.rootDir, 'tree', 'events.jsonl'), `${JSON.stringify({ schema: 'tree-events/1', id: `e${n}`, at: new Date().toISOString(), ...ev })}\n`); }
}
const runIdOf = (node, generation) => `run-${node.replace(/\//g, '-')}-${generation}`;
const reg = (node, generation, parentNode, frontierKey, depth, over = {}) => ({ event: 'node_registered', node, generation, runId: runIdOf(node, generation), attempt: 1, depth, parentNode, frontierKey, chain: { name: 'c', sha256: HEX('a') }, grant: { amount: 1, unit: 'usd' }, ...over });
const started = (node, generation) => ({ event: 'node_started', node, generation, runId: runIdOf(node, generation), pid: 1, host: 'h' });
const closed = (node, generation) => ({ event: 'node_closed', node, generation, runId: runIdOf(node, generation), outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' });
const front = (frontierKey, parentNode, parentGeneration, children) => [{ event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey, parentNode, parentGeneration, parentRunId: 'x', splitSha256: 's', children }, { event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey, revision: 1 }];
const lastId = t => readTreeRecord(t.rootDir).events.at(-1).id;
const rootEvents = () => [{ ...reg('R', 1, null, null, 0), runId: ROOT_ID }, { ...started('R', 1), runId: ROOT_ID }, { ...closed('R', 1), runId: ROOT_ID }];
/** R closed; R/M1 g1 closed with a frontier of R/M1/M1 g1 registered and closed under it; a decision then replaced R/M1: generation 2 is OPENED (and registered when `registered`). */
function replacedTree(registered) {
  const t = newTree({ childChain: 'mock-budget' }); track(t.work);
  rawEvents(t, [...rootEvents(),
    ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }]), reg('R/M1', 1, 'R', 'kA', 1), started('R/M1', 1), closed('R/M1', 1),
    ...front('kB', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }]), reg('R/M1/M1', 1, 'R/M1', 'kB', 2), started('R/M1/M1', 1), closed('R/M1/M1', 1),
    { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'status', affected: [{ node: 'R/M1', generation: 1 }] }]);
  const stop = lastId(t);
  rawEvents(t, [{ event: 'decision_recorded', text: 't', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: stop, gateId: 'g', shownSha256: HEX('0') }]);
  rawEvents(t, [{ event: 'generation_opened', decisionId: lastId(t), nodes: [{ node: 'R/M1', generation: 2 }] }]);
  if (registered) rawEvents(t, [...front('kC', 'R', 1, [{ node: 'R/M1', generation: 2 }]), reg('R/M1', 2, 'R', 'kC', 1), started('R/M1', 2), closed('R/M1', 2)]);
  return t;
}
/** R with two children: R/M2 (a consumer, registered with `dependsOn` the provider R/M1 at generation 1) and R/M1; `regenerated`: a decision replaced R/M1 and generation 2 is registered and closed. */
function consumerTree({ regenerated = false, pin = false } = {}) {
  const t = newTree({ childChain: 'mock-budget' }); track(t.work);
  rawEvents(t, [...rootEvents(), ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }]),
    reg('R/M1', 1, 'R', 'kA', 1), started('R/M1', 1), closed('R/M1', 1),
    reg('R/M2', 1, 'R', 'kA', 1, { dependsOn: [{ node: 'R/M1', generation: 1, ...(pin ? { thinContractSha256: HEX('b') } : {}) }] }), started('R/M2', 1), closed('R/M2', 1)]);
  if (regenerated) {
    rawEvents(t, [{ event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runIdOf('R/M1', 1), source: 'status', affected: [{ node: 'R/M1', generation: 1 }] }]);
    const stop = lastId(t);
    rawEvents(t, [{ event: 'decision_recorded', text: 't', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: stop, gateId: 'g', shownSha256: HEX('0') }]);
    rawEvents(t, [{ event: 'generation_opened', decisionId: lastId(t), nodes: [{ node: 'R/M1', generation: 2 }] }, ...front('kC', 'R', 1, [{ node: 'R/M1', generation: 2 }]), reg('R/M1', 2, 'R', 'kC', 1), started('R/M1', 2), closed('R/M1', 2)]);
  }
  return t;
}
const factOf = (f, path) => f.nodes.find(n => n.node === path);

test('newest generation only, orphans out (PLAN 9.3 item 3): once generation 2 of R/M1 is registered, g1 is not judged and R/M1/M1 (a child of the replaced g1) is not part of the tree', () => {
  const t = replacedTree(true);
  const f = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.deepEqual(f.nodes.map(n => [n.node, n.generation, n.nextGeneration]), [['R', 1, null], ['R/M1', 2, null]], 'the newest generation of each path; the orphan R/M1/M1 is gone');
  assert.equal(verdictOf(f).reasons.some(x => x.scope.startsWith('R/M1/M1')), false);
});

test('a generation a decision OPENED but that is not registered yet is "pending" on the registered older one (not a verdict on g1), and the orphan is out here too', () => {
  const t = replacedTree(false);
  const f = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.deepEqual(f.nodes.map(n => [n.node, n.generation, n.nextGeneration]), [['R', 1, null], ['R/M1', 1, 2]]);
  const v = verdictOf(f);
  assert.deepEqual(only(v, 'generation_pending').map(x => [x.scope, x.text]), [['R/M1@g1', 'R/M1: generation 2 was opened and is not registered yet']]);
  assert.deepEqual(v.reasons.filter(x => x.scope === 'R/M1@g1').map(x => x.code), ['generation_pending'], 'g1 gets no other judgement: it is being replaced');
});

test('M6 exit 9, against the real reader: when R/M1 opens generation 2, its consumer R/M2 (registered against g1) is read as stale and the verdict is not ready; unchanged, the same consumer is not', () => {
  const t = consumerTree({ regenerated: true });
  const f = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.deepEqual(factOf(f, 'R/M2').providers, [{ node: 'R/M1', boundGeneration: 1, newestGeneration: 2, pinChanged: false }]);
  const v = verdictOf(f);
  assert.notEqual(v.verdict, 'ready'); assert.deepEqual(v.reasons.filter(x => x.code === 'stale').map(x => x.scope), ['R/M2@g1']);
  const calm = consumerTree();
  const c = gatherReadinessFacts(calm.rootDir, { work: calm.work });
  assert.deepEqual(factOf(c, 'R/M2').providers, [{ node: 'R/M1', boundGeneration: 1, newestGeneration: 1, pinChanged: false }]);
  assert.equal(verdictOf(c).reasons.some(x => x.code === 'stale' || x.code === 'provider_pin'), false);
});

test('a consumer registered against a provider pin that its provider\'s report cannot show any more (the run folder is gone) reads as a changed pin: blocked, not silently fine', () => {
  const t = consumerTree({ pin: true });
  const f = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.equal(factOf(f, 'R/M2').providers[0].pinChanged, true);
  assert.deepEqual(verdictOf(f).reasons.filter(x => x.code === 'provider_pin').map(x => x.scope), ['R/M2@g1']);
});

test('M6 exit 4, the clearing half, from the real record: a stop puts the consumer in question; a milestone-form decision plus milestone_resolved (changesProvides false) clears the stop and the mark', () => {
  const t = consumerTree();
  rawEvents(t, [{ event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runIdOf('R/M1', 1), source: 'status', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] }]);
  const stop = lastId(t);
  const open = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.deepEqual(open.openStops, [{ id: stop, node: 'R/M1', generation: 1 }]);
  assert.equal(factOf(open, 'R/M2').stale.length, 1, 'the stop marks the consumer');
  assert.ok(verdictOf(open).reasons.some(x => x.code === 'open_stop') && verdictOf(open).reasons.some(x => x.code === 'stale'));
  rawEvents(t, [{ event: 'decision_recorded', text: 'keep the interface', affected: [], form: 'milestone', stopId: stop, gateId: 'g', shownSha256: HEX('0'), node: 'R/M1', generation: 1, milestone: 'M1' }]);
  rawEvents(t, [{ event: 'milestone_resolved', node: 'R/M1', generation: 1, milestone: 'M1', decisionId: lastId(t), changesProvides: false }]);
  const done = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.deepEqual(done.openStops, []); assert.deepEqual(factOf(done, 'R/M2').stale, []);
  assert.equal(verdictOf(done).reasons.some(x => x.code === 'open_stop' || x.code === 'stale'), false);
});

test('sticky tree blocks are read from the record; a refused request recorded as `blocked` (transition_refused) is history and blocks nothing', () => {
  const t = consumerTree();
  rawEvents(t, [{ event: 'blocked', reason: 'transition_refused', scope: 'R/M1@g1', transition: 'node_resumed', detail: 'R/M1@g1 is closed' }]);
  const calm = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.deepEqual(calm.sticky, []); assert.equal(verdictOf(calm).reasons.some(x => x.code === 'sticky_block'), false);
  rawEvents(t, [{ event: 'blocked', reason: 'root_affected', scope: 'tree' }]);
  const f = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.deepEqual(f.sticky, ['root_affected']); assert.equal(verdictOf(f).verdict, 'blocked');
});

test('held items are read from a registered node\'s obligation map: check-not-enforced items, guard-refused and context-only entries; the same obligation carried by two nodes is read once', () => {
  const t = newTree({ childChain: 'mock-budget' }); track(t.work);
  const idt = (id, form) => ({ originNode: 'R', originGeneration: 1, originId: id, originClass: 'delegated', textSha256: HEX('1'), form });
  const map = { items: [{ id: 'C1', identity: idt('C2', 'The heading Assumptions is named'), checkNotEnforced: true }, { id: 'C2', identity: idt('C3', 'Plain') }],
    context: [{ identity: idt('C4', 'The summary is written to BOARD.md'), form: 'The summary is written to BOARD.md', reason: 'guard_refused', guard: 'g' }, { identity: null, form: 'Keep the old API', reason: 'context' }] };
  rawEvents(t, [...rootEvents(), ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }]),
    reg('R/M1', 1, 'R', 'kA', 1, { obligations: map }), started('R/M1', 1), closed('R/M1', 1), reg('R/M2', 1, 'R', 'kA', 1, { obligations: map }), started('R/M2', 1), closed('R/M2', 1)]);
  const f = gatherReadinessFacts(t.rootDir, { work: t.work });
  // EDITED in M6 S2 (disclosed; old labels: the carrier's positional id 'R/M1@g1:C1' and the carrier 'R/M1@g1'): a held item is addressed by its ORIGIN (design 1.4) - what `decide --obligation` takes - and an entry with no identity by
  // `<refinement node>@g<n>:ref-<12 hex of its key>`; every carrier is named on the entry
  const held = factOf(f, 'R/M1').held;
  assert.deepEqual(held.map(h => [h.kind, h.label.replace(/ref-[0-9a-f]{12}$/, 'ref-KEY')]), [['context_only', 'R/M1@g1:ref-KEY'], ['check_not_enforced', 'R@g1:C2'], ['guard_refused', 'R@g1:C4']]);   // sorted by label
  assert.match(held[0].label, /^R\/M1@g1:ref-[0-9a-f]{12}$/);
  assert.deepEqual(held.map(h => h.carriers.map(c => c.node)), [['R/M1', 'R/M2'], ['R/M1', 'R/M2'], ['R/M1', 'R/M2']], 'every carrier of the same obligation is named');
  assert.deepEqual(factOf(f, 'R/M2').held, [], 'the second carrier\'s copies are the same obligations');
  assert.deepEqual(verdictOf(f).reasons.filter(x => x.code === 'held_unrecorded').map(x => x.scope.replace(/ref-[0-9a-f]{12}$/, 'ref-KEY')).sort(), ['R/M1@g1:ref-KEY', 'R@g1:C2', 'R@g1:C4']);
});

// CHANGED ACCEPTED TEST (lane T, G1, D2 F3; C&C accepted the readiness rule on 25 Okt 2026 after reading this test). OLD BAR: a refusal recorded AFTER the last verification counted as `expansion_refused`. NEW BAR: once a split_verified
// exists no refusal record counts; before it, every one does. WHY: after a verification the only writer of such a line is `tree approve` (CR-2I-001), whose refusal is read live and was never the plan's verdict; counting it froze a
// plan that was never wrong behind a paid new plan.
test('the record\'s milestone_resolved events are read per node AND generation, and a refusal counts only while the node has no verification', async () => {
  const r = await trackedRealRoot({ verify: false });
  const refusal = detail => ({ event: 'blocked', reason: 'expansion_refused', scope: 'R@g1', transition: 'expansion', check: 'ancestor_questions', detail });
  rawEvents(r.t, [refusal('before: older than the verification')]);
  assert.deepEqual(gatherReadinessFacts(r.t.rootDir, { work: r.t.work }).nodes[0].split.refusals.map(x => x.detail), ['before: older than the verification'], 'before any verification a refusal counts');
  const v = verifySplit(r.t.rootDir, { node: 'R', generation: 1, runId: ROOT_ID, runDir: r.runDir, work: r.t.work, inheritedGlobal: [], ancestorQuestions: [] });
  assert.equal(v.refusal, null);
  assert.deepEqual(gatherReadinessFacts(r.t.rootDir, { work: r.t.work }).nodes[0].split.refusals, [], 'a refusal older than the verification is history');
  rawEvents(r.t, [refusal('after: newer than the verification'), { event: 'milestone_resolved', node: 'R', generation: 1, milestone: 'M5', decisionId: 'e1', changesProvides: false }, { event: 'milestone_resolved', node: 'R', generation: 2, milestone: 'M4', decisionId: 'e1' }, { event: 'milestone_resolved', node: 'R/M1', generation: 1, milestone: 'M3', decisionId: 'e1' }]);
  const f = gatherReadinessFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(f.nodes[0].split.refusals, [], 'CHANGED: a refusal newer than the verification is history too (D2 F3)');
  assert.deepEqual(f.nodes[0].split.resolved, ['M5'], 'only this node and generation');
  const out = verdictOf(healthy(f));
  assert.equal(out.reasons.some(x => x.code === 'expansion_refused'), false, 'CHANGED: nothing holds the verified plan back');
  assert.equal(out.milestones.find(m => m.id === 'M5').settled, true); assert.equal(out.milestones.find(m => m.id === 'M4').settled, true, 'M4 is a ready milestone; the stray g2 event settled nothing else');
});

test('the accounting gate is read live: a settled charge its evidence cannot prove blocks the tree, named by the gate\'s own code; without the problem the same tree is not blocked by it', () => {
  const build = withProblem => {
    const t = closedRootTree({ cap: 100 }); track(t.work);
    const key = approveFrontier(t.rootDir, ['R/M1']);
    registerKid(t, key, 'R/M1', IDS[0], 10);
    appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
    const dir = syntheticRun(t, IDS[0], { usage: [{ file: 'build', usd: 0.6, reservationId: 'r1' }] });
    writeLines(t, IDS[0], 'R/M1', [reservedLine('r1', 1.0, 'build'), settledLine('r1', 'recorded', 0.6)]);
    if (withProblem) unlinkSync(join(dir, 'build.usage.json'));
    return t;
  };
  const t1 = build(true); const bad = gatherReadinessFacts(t1.rootDir, { work: t1.work });
  assert.equal(bad.accounting.ok, false); assert.deepEqual(bad.accounting.problems.map(p => p.code), ['settlement_without_evidence']);
  const v = verdictOf(bad);
  assert.equal(v.verdict, 'blocked'); assert.match(v.reasons.find(x => x.code === 'accounting_blocked').text, /settlement_without_evidence/);
  const t2 = build(false); const fine = gatherReadinessFacts(t2.rootDir, { work: t2.work });
  assert.equal(fine.accounting.ok, true); assert.equal(verdictOf(fine).reasons.some(x => x.code === 'accounting_blocked'), false);
});

test('a closing record that names another run id for the same node and generation is not this node\'s close', () => {
  const t = consumerTree();
  rawEvents(t, [{ event: 'node_closed', node: 'R/M1', generation: 1, runId: 'some-other-run', outcome: 'incomplete', share: 'released', gateId: 'g', shownSha256: HEX('0') }]);
  const f = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.equal(factOf(f, 'R/M1').outcome, 'passed', 'the close of the registered run (passed) stands');
});

test('the module only reads: it imports no record writer, no lock and no write call, and goes through src/run-files.js for run folders', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tree-ready.js'), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const word of ['appendTreeEvent', 'appendTreeEventLocked', 'withTreeLock', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'writeRunFile', 'unlinkSync', 'rmSync']) assert.equal(code.includes(word), false, `tree-ready.js uses ${word}`);
  assert.doesNotMatch(code, /from 'node:fs'/, 'a run folder is read through src/run-files.js (symlink-safe), never a raw fs call');
  assert.match(code, /from '\.\/run-files\.js'/);
  assert.equal(resolve(repoRoot, 'src', 'tree-ready.js').endsWith('tree-ready.js'), true);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- M6 S2: one target per obligation identity
test('ONE target per obligation identity whatever its kind: the same identity guard-refused at one carrier and check_not_enforced at another is one target with both kinds and both carriers, addressed by its ORIGIN; an entry with no identity is addressed by its refinement node and the first 12 hex of its key', () => {
  const t = newTree({ childChain: 'mock-budget' }); track(t.work);
  const idt = (id, form) => ({ originNode: 'R', originGeneration: 1, originId: id, originClass: 'delegated', textSha256: HEX('1'), form });
  const same = idt('C2', 'The summary is written to BOARD.md');
  const m1 = { items: [], context: [{ identity: same, form: same.form, reason: 'guard_refused', guard: 'infeasibleCriteria' }, { identity: null, form: 'Keep the old API', refinement: 'R/M1', reason: 'guard_refused', guard: 'g' }] };
  const m2 = { items: [{ id: 'C1', identity: same, checkNotEnforced: true }], context: [] };
  rawEvents(t, [...rootEvents(), ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }]),
    reg('R/M1', 1, 'R', 'kA', 1, { obligations: m1 }), started('R/M1', 1), closed('R/M1', 1), reg('R/M2', 1, 'R', 'kA', 1, { obligations: m2 }), started('R/M2', 1), closed('R/M2', 1)]);
  const record = readTreeRecord(t.rootDir); const state = stateOf(record);
  const targets = heldTargetsOf({ record, state });
  assert.equal(targets.length, 2);
  const byId = targets.find(x => x.label === 'R@g1:C2'); const ref = targets.find(x => x.label !== 'R@g1:C2');
  assert.deepEqual([byId.kinds, byId.carriers.map(c => c.node), byId.qid], [['check_not_enforced', 'guard_refused'], ['R/M1', 'R/M2'], 'R@g1:C2']);
  assert.match(ref.label, /^R\/M1@g1:ref-[0-9a-f]{12}$/); assert.ok(ref.key.startsWith(ref.label.split('ref-')[1]), 'the label carries the first 12 hex of the entry key');
  assert.deepEqual([ref.kinds, ref.carriers.map(c => c.node)], [['guard_refused'], ['R/M1']]);
  const reasons = verdictOf(gatherReadinessFacts(t.rootDir, { work: t.work })).reasons.filter(x => x.code === 'held_unrecorded');
  assert.equal(reasons.length, 2, 'two reasons, not three: the identity is not listed once per kind');
  assert.match(reasons.find(x => x.scope === 'R@g1:C2').text, /^check not enforced and guard refused R@g1:C2 \(/, 'the text names every kind');
});
