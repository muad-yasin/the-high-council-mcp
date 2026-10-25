// The tree loop, part 1 (0.8.3 M5c1; PLAN 8.1, 8.3, 8.5, 12 rows 2-3, M5 exit checks L1 (first half), L7, L8 (first half)): verifying closed nodes, choosing the next child, registering it. All-mock, $0.
// A frontier is approved here by direct appends of the previewed/approved pair (the approve verb's own tests are in test/tree-approve.test.js); the starter is not part of this slice, so a child that must have
// RUN is run through api.run exactly as the starter will.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as api from '../src/api.js';
import { readRunJson } from '../src/run-files.js';
import { MAX_CONTEXT_FILE_BYTES } from '../src/context-files.js';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { renderFrontierText } from '../src/tree-stop.js';
import { describeFrontier, findPendingFrontier, frontierReopened, heldDigest } from '../src/tree-frontier.js';
import { CONTEXT_LIMIT_BYTES, chooseNextChild, nodesToVerify, recordGuardRefusalsOnce, registerNextChild, verifyClosedNodes } from '../src/tree-loop.js';
import { detectStops } from '../src/tree-detect.js';
import { realRoot } from './helpers/real-root.js';
import { pricedChildren, pricedUnreproducingChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { ceilCents, pricedDebateFigures } from './helpers/money-figures.js';
import { GATE_FIELDS, ROOT_ID, SPLIT_ROOT_HANDOFF_USD, claim, hostnameOf, syntheticRun } from './helpers/tree-fixture.js';

// Every working folder these tests make is a temp folder of their own (a few MB each, a real child run in some): removed at the end, so a mutation run of this file does not fill the RAM-backed /tmp (8 Oct: it filled).
const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
const realRootTracked = async opts => { const r = await realRoot(opts); made.push(r.t.work); return r; };
const eventsOf = r => readTreeRecord(r.t.rootDir).events;
const inputsDir = r => join(r.t.rootDir, 'tree', 'inputs');
const bundleFolders = r => (existsSync(inputsDir(r)) ? readdirSync(inputsDir(r)).filter(n => !n.startsWith('.tmp-')) : []);

/** A real, verified root (all-mock) with priced children, its frontier previewed; `approve` also approves it (the same hash). `tweak(preview)` edits what is written, for the tampering tests. */
async function treeWith({ approve = true, tweak, ...opts } = {}) {
  const r = await realRootTracked({ ...pricedChildren(), ...opts });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  const preview = tweak ? tweak(structuredClone(d.preview)) : d.preview;
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...preview, boundSha256: d.boundSha256 });
  if (approve) appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: d.frontierKey, revision: 1, boundSha256: d.boundSha256 });
  return { r, d, key: d.frontierKey, work: r.t.work, rootDir: r.t.rootDir };
}
/** Runs a registered child as the starter will (api.run with the bundle's own files, the registered run id, a grant-sized cap). */
const startChild = (t, reg, extra = {}) => api.run({ chain: t.r.t.childChain, task: join(reg.bundleDir, 'task.md'), criteria: join(reg.bundleDir, 'criteria.json'), context: join(reg.bundleDir, 'context.md'), runId: reg.runId, treeNode: join(reg.bundleDir, 'node.json'), cwd: t.work, maxUsd: reg.grantUsd, ...extra });
/** A leaf plan with the heading a consumer's provider_refs name (the mock builder writes none), signed by the mock critics because it carries their line. */
const planWithOverview = '# The provider plan\n\n## Overview\nThe store keeps every record.\n\nREVISED MOCK DELIVERABLE\n';
/** Ends a registered node by hand (no run folder): for the scheduling tests that need a provider that FAILED. */
function closeByHand(t, node, runId, passed, status = null) {
  syntheticRun(t.r.t, runId, {});                                                   // a started node whose folder is gone is accounting_blocked (PLAN 7.2): give it the folder a real run would have
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim(node, runId, process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node, generation: 1, runId, outcome: passed ? 'passed' : 'not_passed', passed, status, share: status === 'needs_decision' ? 'revoked' : 'released' });
}

test('L1 (first half): nothing is registered and no folder is made before approve: a frontier that is previewed and not approved, or approved on a hash that is not the preview\'s, starts nothing', async () => {
  const none = await treeWith({ approve: false });
  const before = eventsOf(none.r).length;
  const pick = registerNextChild(none.rootDir, { work: none.work });
  assert.equal(pick.kind, 'none'); assert.deepEqual(pick.awaitingApproval, [none.key]);
  assert.equal(eventsOf(none.r).length, before, 'nothing written'); assert.deepEqual(bundleFolders(none.r), [], 'no bundle folder');
  assert.equal(readdirSync(none.r.t.runsDir).length, 1, 'no run folder besides the root\'s');
  // an approval that binds another hash is not an approval (approvalValid fails closed)
  appendTreeEvent(none.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: none.key, revision: 1, boundSha256: 'e'.repeat(64) });
  assert.equal(registerNextChild(none.rootDir, { work: none.work }).kind, 'none');
  assert.deepEqual(bundleFolders(none.r), []);
  // and a tree with no frontier at all
  const bare = await realRootTracked({ ...pricedChildren() });
  assert.deepEqual(registerNextChild(bare.t.rootDir, { work: bare.t.work }), { kind: 'none', waiting: [], awaitingApproval: [], drifted: [] });
});

test('L1 (second half) and M5 row 10: after approve the first child in dependency order is registered with its bundle, grant, obligations, dependsOn, split hash and a fresh run id; no run folder is made; a second call registers nothing because a node is active', async () => {
  const t = await treeWith();
  const reg = registerNextChild(t.rootDir, { work: t.work });
  assert.equal(reg.kind, 'registered', JSON.stringify(reg)); assert.equal(reg.node, 'R/M1');
  const e = reg.event;
  assert.equal(e.event, 'node_registered'); assert.equal(e.frontierKey, t.key); assert.equal(e.parentRunId, ROOT_ID); assert.equal(e.splitSha256, t.r.split);
  assert.match(e.bundleSha256, /^[0-9a-f]{64}$/); assert.ok(Number.isInteger(e.bundleBytes) && e.bundleBytes > 0);
  assert.ok(Array.isArray(e.obligations.items) && e.obligations.items.length > 0, 'the obligation map is registered with the node'); assert.deepEqual(e.dependsOn, [], 'a child that expects nothing depends on nothing');
  assert.match(e.runId, /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/); assert.notEqual(e.runId, ROOT_ID);
  assert.equal(existsSync(join(t.r.t.runsDir, e.runId)), false, 'registering makes no run folder: the run does');
  assert.deepEqual(bundleFolders(t.r), ['R.M1@g1']); assert.deepEqual(readdirSync(join(inputsDir(t.r), 'R.M1@g1')).sort(), ['context.md', 'criteria.json', 'node.json', 'task.md']);
  assert.equal(e.chain.name, 'priced-debate');
  const before = eventsOf(t.r).length;
  assert.deepEqual(registerNextChild(t.rootDir, { work: t.work }), { kind: 'active', node: 'R/M1', key: 'R/M1@g1' }, 'one node at a time');
  assert.equal(eventsOf(t.r).length, before); assert.deepEqual(bundleFolders(t.r), ['R.M1@g1']);
});

test('the grant is an equal share of what is free among the children still to register, never above the cap the approval showed, and never above what is free', async () => {
  const t = await treeWith();
  const showed = t.d.preview.children.find(c => c.node === 'R/M1').capUsd;
  const reg = registerNextChild(t.rootDir, { work: t.work });
  assert.equal(reg.event.grant.amount, showed); assert.equal(reg.event.grant.unit, 'usd');
  // an approval whose shown cap is far above anything free: the grant is the share, not the shown figure
  const inflated = await treeWith({ tweak: p => { for (const c of p.children) c.capUsd = 400; return p; } });
  const g = registerNextChild(inflated.rootDir, { work: inflated.work });
  // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); the full suite on fad02049 listed it as #4327). OLD: the bound was typed (4.92, the at-most 4.919 rounded up). NEW: it is the chain's own at-most figure rounded up to the cent. WHY: recording the drafted words moves it (4.919 -> 5.02); the point (the grant is the chain's at-most share, not the inflated 400) is unchanged.
  const atMostBound = ceilCents(pricedDebateFigures().atMostUsd);
  assert.equal(g.kind, 'registered', JSON.stringify(g)); assert.ok(g.event.grant.amount <= atMostBound + 1e-9, `${g.event.grant.amount} is the chain's at-most share (${atMostBound}: its at-most figure rounded up to the cent), not the inflated 400`);
  // a shown cap below what would be the share binds: a grant issued later may be lower than shown, never higher
  const fig = pricedDebateFigures(); const midCap = ceilCents((fig.cheapestUsd + fig.atMostUsd) / 2);      // a shown cap over the cheapest end and under the at-most figure (typed 4.5 before: OLD 3.3 over 3.2, then 4.5 over 4.119)
  const lower = await treeWith({ tweak: p => { for (const c of p.children) c.capUsd = midCap; return p; } });
  const l = registerNextChild(lower.rootDir, { work: lower.work });
  assert.equal(l.kind, 'registered', JSON.stringify(l)); assert.equal(l.event.grant.amount, midCap, `the approval showed ${midCap}: the grant is not the ${fig.atMostUsd} the chain could take`);
  // a preview that shows no cap for the child cannot be registered from
  const nocap = await treeWith({ tweak: p => { delete p.children[0].capUsd; return p; } });
  const r2 = registerNextChild(nocap.rootDir, { work: nocap.work });
  assert.equal(r2.kind, 'refused'); assert.equal(r2.check, 'approved_cap'); assert.deepEqual(bundleFolders(nocap.r), []);
});

test('L7: a provider that closed but whose panel did not pass is not eligible: its consumer is not registered, an independent sibling is; the sitting says which child waits and why', async () => {
  const t = await treeWith();
  const k1 = registerNextChild(t.rootDir, { work: t.work });
  closeByHand(t, 'R/M1', k1.runId, false);
  const pick = chooseNextChild(t.rootDir, { work: t.work });
  assert.equal(pick.kind, 'child'); assert.equal(pick.node, 'R/M3', 'R/M2 expects from R/M1, so the independent R/M3 goes first');
  assert.deepEqual(pick.waiting.map(w => w.node), ['R/M2']); assert.match(pick.waiting[0].why.join(' '), /R\/M1 closed but the panel did not pass it/);
  assert.equal(registerNextChild(t.rootDir, { work: t.work }).node, 'R/M3');
  closeByHand(t, 'R/M3', stateOf(readTreeRecord(t.rootDir)).nodes.get('R/M3@g1').runId, true);
  const last = registerNextChild(t.rootDir, { work: t.work });
  assert.equal(last.kind, 'none'); assert.deepEqual(last.waiting.map(w => w.node), ['R/M2']);
  assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.has('R/M2@g1'), false, 'the consumer was never registered');
});

test('L8 (first half) and row 10: a consumer waits while its provider has not been registered or has not closed; once the provider ran, passed and holds PLAN 5.5 items 1-2 it is registered with dependsOn pinning the provider\'s thin contract', { timeout: 120_000 }, async () => {
  const t = await treeWith();
  const k1 = registerNextChild(t.rootDir, { work: t.work });
  // K1 is registered but has not run: R/M2 must wait, R/M3 goes on being the independent candidate
  let pick = chooseNextChild(t.rootDir, { work: t.work });
  assert.equal(pick.node, 'R/M3'); assert.match(pick.waiting[0].why.join(' '), /R\/M1 has not closed/);
  writeFileSync(join(t.work, 'k1-plan.md'), planWithOverview);
  const res = await startChild(t, k1, { draft: 'k1-plan.md', rounds: 1 });
  assert.equal(res.exitCode, 0, res.outputTail);
  const st = stateOf(readTreeRecord(t.rootDir));
  assert.equal(st.nodes.get('R/M1@g1').phase, 'closed');
  // a leaf has no split block: nothing to verify, nothing recorded
  assert.deepEqual(nodesToVerify({ record: readTreeRecord(t.rootDir), state: st, runsDir: t.r.t.runsDir }), []);
  const before = eventsOf(t.r).length;
  assert.deepEqual(verifyClosedNodes(t.rootDir, { work: t.work }), []); assert.equal(eventsOf(t.r).length, before);
  // PLAN 5.5 items 1-2 are checked NOW, not remembered: a provider whose deliverable.md was edited after it closed is not eligible until it is what the run wrote
  const deliverable = join(t.r.t.runsDir, k1.runId, 'deliverable.md'); const original = readFileSync(deliverable, 'utf8');
  writeFileSync(deliverable, `${original}\nAn edit after the review.\n`);
  pick = chooseNextChild(t.rootDir, { work: t.work });
  assert.equal(pick.node, 'R/M3'); assert.match(pick.waiting.map(w => w.why.join(' ')).join(' '), /R\/M1 no longer holds PLAN 5\.5 items 1-2/);
  writeFileSync(deliverable, original);
  pick = chooseNextChild(t.rootDir, { work: t.work });
  assert.equal(pick.node, 'R/M2', 'the provider is eligible now: dependency order puts the consumer before the independent R/M3'); assert.deepEqual(pick.waiting, []);
  const k2 = registerNextChild(t.rootDir, { work: t.work });
  assert.equal(k2.kind, 'registered', JSON.stringify(k2));
  const pin = readTreeRecord(t.rootDir).events.find(e => e.event === 'node_closed' && e.node === 'R/M1').thinContractSha256;
  assert.deepEqual(k2.event.dependsOn.map(d => [d.node, d.generation, d.thinContractSha256]), [['R/M1', 1, pin]], 'dependsOn names the provider\'s subtree with its pin');
});

test('row 9 and 17: after a node closes passed with a split block, verifySplit is called with the tree\'s REAL inheritedGlobal and ancestorQuestions; each node is verified once', async () => {
  const t = await treeWith();
  const k1 = registerNextChild(t.rootDir, { work: t.work });
  closeByHand(t, 'R/M1', k1.runId, true);
  const calls = [];
  const spy = (rootDir, args) => { calls.push(args); return { refusal: null, sha256: 'a'.repeat(64), event: appendTreeEvent(rootDir, { event: 'split_verified', node: args.node, generation: args.generation, runId: args.runId, splitSha256: 'a'.repeat(64), children: [`${args.node}/M1`] }) }; };   // `children` (S8 held state): the real writer records the child paths the verified block names; no block sits behind this spy, so the path is ASSUMED (an absent list would read as unknown)
  const out = verifyClosedNodes(t.rootDir, { work: t.work, deps: { verify: spy, holdsSplit: () => true } });
  assert.deepEqual(out.map(o => o.node), ['R/M1']); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].inheritedGlobal, ['C1'], 'C1 was global where it began (the root), so R/M1 must address it'); assert.deepEqual(calls[0].ancestorQuestions, ['Which store holds the records?'], 'the question of the milestone R/M1 answers, from the root\'s verified block');
  assert.equal(calls[0].node, 'R/M1'); assert.equal(calls[0].runId, k1.runId);
  assert.deepEqual(verifyClosedNodes(t.rootDir, { work: t.work, deps: { verify: spy, holdsSplit: () => true } }), [], 'verified once'); assert.equal(calls.length, 1);
  // an ancestor whose plan cannot be read is refused, never checked against less
  const lost = await treeWith();
  const k = registerNextChild(lost.rootDir, { work: lost.work });
  closeByHand(lost, 'R/M1', k.runId, true);
  writeFileSync(join(lost.r.t.runsDir, ROOT_ID, 'deliverable.md'), 'gone');
  const refused = verifyClosedNodes(lost.rootDir, { work: lost.work, deps: { verify: () => assert.fail('must not be called'), holdsSplit: () => true } });
  assert.equal(refused[0].refusal.check, 'ancestor_questions');
  assert.ok(readTreeRecord(lost.rootDir).events.some(e => e.event === 'blocked' && e.reason === 'expansion_refused' && e.scope === 'R/M1@g1' && e.check === 'ancestor_questions'));
});

test('row 17: a closed root whose split fails the mechanical checks is recorded as expansion_refused with the item and the field, creates no folder, and is not asked again; a valid one gets split_verified', async () => {
  const bad = block3(); bad.children[0].inherits = ['C9'];                              // a child inherits a class that does not exist (PLAN 5.3)
  const t = await realRootTracked({ ...pricedChildren(), verify: false, plan: planWith(bad, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const [one] = verifyClosedNodes(t.t.rootDir, { work: t.t.work });
  assert.equal(one.node, 'R'); assert.equal(one.refusal.item, 4); assert.equal(one.refusal.check, 'split_invalid');
  const rec = eventsOf(t).filter(e => e.event === 'blocked' && e.reason === 'expansion_refused');
  assert.deepEqual(rec.map(e => [e.scope, e.check]), [['R@g1', 'split_invalid']]);
  assert.equal(eventsOf(t).some(e => e.event === 'split_verified'), false); assert.deepEqual(bundleFolders(t), []);
  assert.deepEqual(verifyClosedNodes(t.t.rootDir, { work: t.t.work }), [], 'not asked again');
  const good = await realRootTracked({ ...pricedChildren(), verify: false });
  const [ok] = verifyClosedNodes(good.t.rootDir, { work: good.t.work });
  assert.equal(ok.refusal, null); assert.equal(ok.sha256, (await realRootTracked({ ...pricedChildren() })).split, 'the same block hashes the same'); assert.ok(eventsOf(good).some(e => e.event === 'split_verified' && e.splitSha256 === ok.sha256));
});

test('row 12: a derivation refusal at registration (the provider\'s plan has no "Overview" heading its provider_refs name) is a blocked record, creates no folder and no registration, is written once, and the sitting ends naming the child', { timeout: 120_000 }, async () => {
  const t = await treeWith();
  const k1 = registerNextChild(t.rootDir, { work: t.work });
  assert.equal((await startChild(t, k1)).exitCode, 0);                               // the mock builder's plan has no headings
  const a = registerNextChild(t.rootDir, { work: t.work });
  assert.equal(a.kind, 'refused'); assert.equal(a.node, 'R/M2'); assert.equal(a.check, 'missing_context'); assert.match(a.detail, /heading "Overview" \(provider_refs\) must exist exactly once in its plan, found 0/);
  assert.deepEqual(bundleFolders(t.r), ['R.M1@g1'], 'no bundle folder for R/M2'); assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.has('R/M2@g1'), false);
  const blocked = () => eventsOf(t.r).filter(e => e.event === 'blocked' && e.scope === 'R/M2@g1');
  assert.deepEqual(blocked().map(e => [e.reason, e.check]), [['expansion_refused', 'missing_context']]);
  assert.equal(registerNextChild(t.rootDir, { work: t.work }).kind, 'refused'); assert.equal(blocked().length, 1, 'said again on screen, written once');
});

test('row 14: a context.md over the CLI\'s own limit is refused BEFORE registration (no bundle, no registration); the limit is the CLI\'s constant', async () => {
  assert.equal(CONTEXT_LIMIT_BYTES, MAX_CONTEXT_FILE_BYTES); assert.equal(CONTEXT_LIMIT_BYTES, 2_000_000);
  const t = await treeWith();
  const small = registerNextChild(t.rootDir, { work: t.work, contextLimitBytes: 100 });
  assert.equal(small.kind, 'refused'); assert.equal(small.check, 'context_size'); assert.match(small.detail, /over the 100 the CLI accepts/);
  assert.deepEqual(bundleFolders(t.r), []); assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.has('R/M1@g1'), false);
  assert.equal(registerNextChild(t.rootDir, { work: t.work }).kind, 'registered', 'the same child registers when it fits');
});

test('the approval binds the held items: a preview whose held digest is not the full derivation\'s refuses the registration (check held_changed), names the items, writes a blocked record and makes no folder; the digest ignores order and notices an added item', async () => {
  const t = await treeWith({ tweak: p => { p.children[0].heldSha256 = 'f'.repeat(64); return p; } });
  const r = registerNextChild(t.rootDir, { work: t.work });
  assert.equal(r.kind, 'refused'); assert.equal(r.check, 'held_changed'); assert.match(r.detail, /run `council tree approve` again/);
  assert.deepEqual(bundleFolders(t.r), []); assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.has('R/M1@g1'), false);
  assert.deepEqual(eventsOf(t.r).filter(e => e.event === 'blocked' && e.scope === 'R/M1@g1').map(e => e.check), ['held_changed']);
  // a preview from before the digest existed carries none: that is not the digest of the derivation either
  const old = await treeWith({ tweak: p => { delete p.children[0].heldSha256; return p; } });
  assert.equal(registerNextChild(old.rootDir, { work: old.work }).check, 'held_changed');
  const form = { guardRefused: [{ guard: 'infeasibleCriteria', form: 'Write HANDOFF.md', identity: null }], checkNotEnforced: [{ id: 'C2', form: { criterion: 'x', check: 'ls', on: 'build' } }] };
  assert.equal(heldDigest(form), heldDigest({ guardRefused: form.guardRefused, checkNotEnforced: [...form.checkNotEnforced] }));
  assert.equal(heldDigest({ ...form, guardRefused: [...form.guardRefused, { guard: 'metaCriteria', form: 'Be good', identity: null }] }) === heldDigest(form), false);
  assert.equal(heldDigest({ ...form, checkNotEnforced: [] }) === heldDigest(form), false, 'a check that is not enforced counts as much as a refused item');
  assert.equal(heldDigest({ guardRefused: [], checkNotEnforced: [] }), t.d.preview.children[1].heldSha256, 'a child with no held item has the empty digest, in the preview and in the derivation');
});

test('a registration that admission refuses AFTER the bundle was written leaves a bundle that a later sitting re-derives byte for byte (written: false, no throw)', async () => {
  const t = await treeWith();
  const refuseOnce = () => { throw new TreeRefusal({ code: 'continuation_refused', transition: 'node_registered', reason: 'not admitted: budget (test)' }); };
  const a = registerNextChild(t.rootDir, { work: t.work, deps: { register: refuseOnce } });
  assert.deepEqual([a.kind, a.node, a.check], ['refused', 'R/M1', 'continuation_refused']);
  const files = () => readdirSync(join(inputsDir(t.r), 'R.M1@g1')).sort().map(f => [f, readFileSync(join(inputsDir(t.r), 'R.M1@g1', f), 'utf8')]);
  const firstBundle = files();
  const b = registerNextChild(t.rootDir, { work: t.work });
  assert.equal(b.kind, 'registered', JSON.stringify(b)); assert.deepEqual(files(), firstBundle, 'the bundle is the same bytes');
  assert.equal(b.event.bundleSha256, readTreeRecord(t.rootDir).events.find(e => e.event === 'node_registered' && e.node === 'R/M1').bundleSha256);
});

test('one scheduler: recovery only says a frontier has children left (no node named), and the production code registers children through registerChildAdmitted in tree-loop.js and uses runFrontier nowhere', () => {
  const srcDir = join(import.meta.dirname, '..', 'src');
  const loop = readFileSync(join(srcDir, 'tree-loop.js'), 'utf8');
  assert.match(loop, /deps\.register \?\? registerChildAdmitted/); assert.equal(/registerChildUnchecked/.test(loop), false);
  const code = f => readFileSync(join(srcDir, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const users = readdirSync(srcDir).filter(f => f.endsWith('.js') && f !== 'tree-register.js' && code(f).includes('runFrontier'));
  assert.deepEqual(users, [], 'runFrontier is a fixture helper: nothing in src/ calls it');
  const recovery = readFileSync(join(srcDir, 'tree-recovery.js'), 'utf8');
  assert.match(recovery, /action: 'register_next', frontierKey \}/); assert.equal(/register_next', frontierKey, node/.test(recovery), false);
});

test('the split the approval was shown is the split the plan holds now: a preview that names another verified split refuses the registration (split_changed) and makes no folder', async () => {
  const t = await treeWith({ tweak: p => { p.splitSha256 = 'c'.repeat(64); return p; } });
  const r = registerNextChild(t.rootDir, { work: t.work });
  assert.equal(r.kind, 'refused'); assert.equal(r.check, 'split_changed'); assert.deepEqual(bundleFolders(t.r), []);
  assert.deepEqual(eventsOf(t.r).filter(e => e.event === 'blocked' && e.scope === 'R/M1@g1').map(e => e.check), ['split_changed']);
});

test('a provider that a stop put in question (stale) is not eligible: its consumer waits for it (M5e: the stop is opened by the REAL writer, so the consumer is in the closure and is stale itself)', async () => {
  const t = await treeWith();
  const k1 = registerNextChild(t.rootDir, { work: t.work });
  closeByHand(t, 'R/M1', k1.runId, true, 'needs_decision');
  assert.equal(detectStops(t.rootDir).length, 1, 'the REAL writer opens the stop (this fixture was a hand-appended event without a runId)');
  const pick = chooseNextChild(t.rootDir, { work: t.work });
  assert.equal(pick.node, 'R/M3'); assert.match(pick.waiting.map(w => w.why.join(' ')).join(' '), /R\/M2 is stale: stop e\d+ put it in question/);
});

test('a provider with an open stop is not eligible even when the stop\'s recorded set does not cover its consumer (a hand-appended stop whose affected set holds R/M1 only): the provider rule itself, independent of the closure', async () => {
  const t = await treeWith();
  const k1 = registerNextChild(t.rootDir, { work: t.work });
  closeByHand(t, 'R/M1', k1.runId, true);
  appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', source: 'node_closed', node: 'R/M1', generation: 1, affected: [{ node: 'R/M1', generation: 1 }] });
  const pick = chooseNextChild(t.rootDir, { work: t.work });
  assert.equal(pick.node, 'R/M3'); assert.match(pick.waiting.map(w => w.why.join(' ')).join(' '), /R\/M1 has an open stop/);
  assert.equal(pick.waiting.find(w => w.node === 'R/M2').held, true, 'held by the open stop: the sitting will end held_by_stop, not nothing_to_do');
});

test('guard_refused is written once per (node, item, guard): the same held child met again after an admission refusal does not repeat it, and a new item is added', async () => {
  const t = await treeWith();
  const d = { node: 'R/M1', generation: 1, guardRefused: [{ guard: 'infeasibleCriteria', form: 'Write HANDOFF.md', identity: null }, { guard: 'metaCriteria', form: 'Be good', identity: null }] };
  assert.equal(recordGuardRefusalsOnce(t.rootDir, d).length, 2);
  assert.equal(recordGuardRefusalsOnce(t.rootDir, d).length, 0, 'nothing new');
  assert.equal(recordGuardRefusalsOnce(t.rootDir, { ...d, guardRefused: [...d.guardRefused, { guard: 'metaCriteria', form: 'Be great', identity: null }] }).length, 1, 'only the new item');
  assert.equal(eventsOf(t.r).filter(e => e.event === 'guard_refused').length, 3);
});

test('a provider that split but whose handoff did not reproduce its block is not eligible (PLAN 5.5 item 3): its consumer waits and the reason says so', { timeout: 120_000 }, async () => {
  const t = await treeWith(pricedUnreproducingChildren());                       // the fixture child's handoff seat is the old mock-priced one: it does not copy the block
  const k1 = registerNextChild(t.rootDir, { work: t.work });
  writeFileSync(join(t.work, 'k1-plan.md'), planWith(block3(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));   // a valid block in the plan; the child chain's handoff seat does not copy it
  const res = await startChild(t, k1, { draft: 'k1-plan.md', rounds: 1 });
  assert.equal(res.exitCode, 0, res.outputTail);
  const pick = chooseNextChild(t.rootDir, { work: t.work });
  assert.equal(pick.node, 'R/M3', 'the independent sibling goes first');
  const why = pick.waiting.map(w => w.why.join(' ')).join(' ');
  assert.match(why, /R\/M1 holds a split block the handoff did not reproduce/);
  // the child is otherwise sound (its seat wrote a clean milestone lint), so the reproduction is the ONLY reason it is not eligible
  assert.deepEqual(readRunJson(join(dirname(t.rootDir), k1.runId), 'report.json').handoff_milestones.findings, []);
  assert.equal(/lint|Status/.test(why.replace(/R\/M1 holds a split block the handoff did not reproduce/g, '')), false, why);
});

test('fail closed: a child the grant formula does not admit now gets no grant (a tampered preview that admits all three under a root cap of 9 cannot register any: three equal shares are 3.00, under the chain\'s cheapest 4.119; was 3.20 before the system text was counted)', async () => {
  const t = await treeWith({ cap: 9, tweak: p => { for (const c of p.children) { c.admitted = true; delete c.reason; c.capUsd = 3.3; } return p; } });
  const r = registerNextChild(t.rootDir, { work: t.work });
  // CHANGED ACCEPTED (lane T, G3+4, D2 F9a): OLD check 'continuation_refused'. NEW 'admission_changed': the preview admitted the child and registration refused it for budget, so the frontier waits for a new approval (a reopen line); it still registers nothing
  assert.equal(r.kind, 'refused'); assert.equal(r.check, 'admission_changed'); assert.match(r.detail, /not admitted: budget/);
  assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.has('R/M1@g1'), false, 'nothing was registered');
  assert.ok(eventsOf(t.r).some(e => e.event === 'blocked' && e.scope === 'R/M1@g1' && /not admitted: budget/.test(e.detail)));
});

test('an error that is not a refusal is not recorded as one: an unreadable root task file propagates out of registerNextChild instead of becoming a "parent" refusal', async () => {
  const t = await treeWith();
  const before = eventsOf(t.r).length;
  assert.throws(() => registerNextChild(t.rootDir, { work: t.work, rootTaskPath: join(t.work, 'tasks', 'missing.md') }), /ENOENT/);
  assert.equal(eventsOf(t.r).length, before, 'nothing recorded'); assert.deepEqual(bundleFolders(t.r), []);
});

// CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); the full suite on fad02049 listed this file's #4327; this test passed there and typed the same class of figure). OLD: cap 13.5378 + 0.04, a share of 4.5126 over the cheapest end 4.119, registered as 4.51 (typed). NEW: the share is a sub-cent amount (X.XXXX, 0.0076 past the cent since the fix-up below; 0.0026 before) half way between the chain's cheapest end and at-most figure, so the relation (a sub-cent share floors to the cent, previewed, bound and registered at the floored figure) holds whatever the estimate is.
test('R14 (Astra F8): what the approval authorises is what the text shows, to the cent and never above it: a sub-cent share is previewed, bound and registered floored to the cent, the text says that figure, and the ceiling check still lets it register', async () => {
  const fig = pricedDebateFigures();
  const whole = Math.floor(((fig.cheapestUsd + fig.atMostUsd) / 2) * 100) / 100;      // the share floored to the cent
  // CHANGED ACCEPTED (money-test conversion fix-up, lane C, 24 Okt 2026; C&C thcmcp-cd "take the 0.0076 offset"): OLD offset 0.0026 (0.26 cent past the cent, as the original 4.5126 was); NEW 0.0076 (0.76 cent). WHY: at 0.26 cent the floor and round-to-nearest give the SAME grant, so the test could not catch a regression that rounds to nearest, which would authorize a cent more than the text shows (the "never above" half of this property); at 0.76 cent floor gives `whole` and round-to-nearest gives `whole + 0.01`. Typed on purpose: it forces a sub-cent share past the half cent for any figure.
  const share = whole + 0.0076;                                                       // 0.0076 past the cent: a sub-cent share more than half way to the next cent
  const t = await treeWith({ cap: Math.round((3 * share + SPLIT_ROOT_HANDOFF_USD) * 10000) / 10000 });
  const grants = t.d.preview.children.map(c => c.capUsd);
  assert.deepEqual(grants, [whole, whole, whole], `the bound grant is the shown one, floored to the cent: ${JSON.stringify(grants)}`);
  assert.ok(t.d.preview.children.every(c => c.capUsd <= c.ceilingUsd + 1e-9), 'never above the ceiling');
  assert.equal(t.d.preview.children.every(c => Math.round(c.ceilingUsd * 100) === c.ceilingUsd * 100 || Math.abs(c.ceilingUsd * 100 - Math.round(c.ceilingUsd * 100)) < 1e-6), true, 'the ceiling is whole cents too');
  assert.match(renderFrontierText(t.d.view), new RegExp(`Proposed grant: \\$${whole.toFixed(2).replace('.', '\\.')}, never more than`));
  const reg = registerNextChild(t.rootDir, { work: t.work });
  assert.equal(reg.kind, 'registered', JSON.stringify(reg)); assert.equal(reg.grantUsd, whole, `registered at the shown figure, not at ${share}`);
});

test('R5 (Fable Q2-1): the ceiling the approval showed is part of what it approved - a chain whose at-most figure is not the shown one refuses the registration (ceiling_changed), makes no folder, and reopens the frontier like held_changed', async () => {
  const t = await treeWith({ tweak: p => { p.children[0].ceilingUsd = p.children[0].ceilingUsd + 5; return p; } });   // the approval showed a ceiling the chain no longer has
  assert.equal(findPendingFrontier({ rootDir: t.rootDir }), null, 'approved and valid: nothing waits yet');
  const r = registerNextChild(t.rootDir, { work: t.work });
  assert.deepEqual([r.kind, r.check], ['refused', 'ceiling_changed'], JSON.stringify(r)); assert.match(r.detail, /the most R\/M1@g1's chain can cost is [0-9.]+ now, not the [0-9.]+ the approval showed/);
  assert.deepEqual(bundleFolders(t.r), [], 'no folder'); assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.has('R/M1@g1'), false);
  const blocked = eventsOf(t.r).filter(e => e.event === 'blocked' && e.check === 'ceiling_changed');
  assert.equal(blocked.length, 1); assert.equal(blocked[0].frontierKey, t.key);
  assert.equal(frontierReopened(readTreeRecord(t.rootDir), t.key), true);
  assert.equal(findPendingFrontier({ rootDir: t.rootDir })?.key, t.key, 'approve shows it again');
  // the way back: a fresh preview shows the REAL ceiling, the person approves it, and the child registers (describeFrontier and registration compute the same figure, so there is no permanent refusal)
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', ...t.d.preview, boundSha256: t.d.boundSha256 });
  appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: t.key, revision: 2, boundSha256: t.d.boundSha256 });
  assert.equal(registerNextChild(t.rootDir, { work: t.work }).kind, 'registered');
});

test('held_changed and split_changed reopen the frontier: `tree approve` finds it pending again (not "nothing waits"), the loop waits for that approval, a refusal that happens again is written again, and a corrected approval lets the child register', async () => {
  const t = await treeWith({ tweak: p => { p.children[0].heldSha256 = 'f'.repeat(64); return p; } });
  assert.equal(findPendingFrontier({ rootDir: t.rootDir }), null, 'approved and valid: nothing waits yet');
  const first = registerNextChild(t.rootDir, { work: t.work });
  assert.equal(first.check, 'held_changed');
  const blocked = () => eventsOf(t.r).filter(e => e.event === 'blocked' && e.check === 'held_changed');
  assert.equal(blocked().length, 1); assert.equal(blocked()[0].frontierKey, t.key);
  assert.equal(frontierReopened(readTreeRecord(t.rootDir), t.key), true);
  assert.equal(findPendingFrontier({ rootDir: t.rootDir })?.key, t.key, 'approve shows it again');
  assert.deepEqual(chooseNextChild(t.rootDir, { work: t.work }).awaitingApproval, [t.key]);
  // the person approves again but what is shown is still wrong: the refusal is written again and the frontier waits again
  const wrong = structuredClone(t.d.preview); wrong.children[0].heldSha256 = 'f'.repeat(64);
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', ...wrong, boundSha256: 'd'.repeat(64) });
  appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: t.key, revision: 2, boundSha256: 'd'.repeat(64) });
  assert.equal(frontierReopened(readTreeRecord(t.rootDir), t.key), false, 'a newer approval answers the refusal');
  assert.equal(registerNextChild(t.rootDir, { work: t.work }).check, 'held_changed'); assert.equal(blocked().length, 2, 'written again, not deduplicated');
  assert.equal(frontierReopened(readTreeRecord(t.rootDir), t.key), true);
  // a correct approval (what a fresh preview shows now) lets it through
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', ...t.d.preview, boundSha256: t.d.boundSha256 });
  appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: t.key, revision: 3, boundSha256: t.d.boundSha256 });
  assert.equal(registerNextChild(t.rootDir, { work: t.work }).kind, 'registered');
});
