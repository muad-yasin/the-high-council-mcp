// CHANGED ACCEPTED (already-false unit, C&C thcmcp-cd 24 Okt 2026; the dead-key sentence): OLD "its plan, or an ancestor's, was replaced"; NEW "replaced or set aside by a decision, or a node above it was" (table rows: "is dead (NEW): ..."; screens and refusals: "is dead: it was NEW, ..."). WHY: the old words are false for a node a decision LISTED (a consumer that never wrote a plan, or one with no successor) and for a transitive orphan whose parent was never replaced; the new tail holds on every route into deadKeys. Only the words moved: every row refuses the same keys as before.
// 0.8.3 M6 slice S8-3 (rulings row 130; design note sections 2, 3.4, 3.6, 6): the root re-plan LIBRARY, src/tree-root-replan.js - the preconditions that are checked before the person types, the input bundle of R@g2 (Draft A:
// no sentence of its own), and the registration through the admitted path. All-mock, $0, on a REAL closed root (test/helpers/real-root.js), with the records a decision and its approval would write appended directly (the decide
// form and the approve verb are later slices). Every working folder is removed at the end of the file (test/helpers/temp-trees.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_FILE, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { rootBundle, rootReplanPreflight, rootTaskRefOf, registerRootReplan, writeRootBundle } from '../src/tree-root-replan.js';
import { bundleSha256Of, bundleDirOf } from '../src/tree-continuation.js';
import { floorCents } from '../src/tree-budget.js';
import { registerNextChild } from '../src/tree-loop.js';
import { rootRemedies } from '../src/tree-decide-stop.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { approvePending } from './helpers/sitting.js';
import { GATE_FIELDS, FIXTURE_BOUND, ROOT_ID, claim, hostnameOf, newTree } from './helpers/tree-fixture.js';

const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const pre = (r, extra = {}) => rootReplanPreflight(r.t.rootDir, { work: r.t.work, sittingHeld: () => false, ...extra });
const withStop = async (opts) => { const r = await trackedRealRoot(opts); const stop = appendTreeEvent(r.t.rootDir, STOP); return { r, stop }; };
const eventCount = r => readTreeRecord(r.t.rootDir).events.length;

test('the preconditions accept a closed root with an open root stop, and the answer carries what the next steps need: the stop, the root being replaced, the generation, the task (path, hashes, bytes), the chain with its prices and the free money', async () => {
  const { r, stop } = await withStop();
  const p = pre(r);
  assert.equal(p.refusal, undefined, JSON.stringify(p.refusal));
  assert.equal(p.ok, true);
  assert.equal(p.stop.id, stop.id);
  assert.deepEqual(p.previous, { node: 'R', generation: 1, runId: ROOT_ID });
  assert.equal(p.generation, 2);
  assert.equal(p.task.text, readFileSync(join(r.t.work, 'tasks', 'x.md'), 'utf8'), 'the task bytes, unchanged');
  assert.equal(p.task.source, 'pin', 'the task comes from the pin in tree.json, the only source');
  assert.match(p.task.taskSha256, /^[0-9a-f]{64}$/); assert.match(p.task.taskHash, /^[0-9a-f]{12}$/);
  assert.ok(p.chain.figures.cheapestUsd > 0 && p.chain.figures.atMostUsd >= p.chain.figures.cheapestUsd);
  assert.equal(p.freeUsd, p.rootCapUsd - p.spentUsd - p.unknownSpendHeldUsd, 'free = cap - spent - held for an unreadable spend (the set-aside grants are released by the decision, not subtracted)');
  assert.ok(p.spentUsd > 0, 'the old root\'s spend stays counted');
  const named = pre(r, { stopId: stop.id });
  assert.equal(named.ok, true, 'naming the stop is the same answer');
});

test('each precondition refuses with its own sentence, BEFORE anything is typed, and writes nothing (known-bad input for each)', async () => {
  // no root stop at all
  const plain = await trackedRealRoot();
  let before = eventCount(plain);
  assert.equal(pre(plain).refusal.code, 'no_root_stop');
  assert.equal(eventCount(plain), before, 'nothing written');

  const { r, stop } = await withStop();
  before = eventCount(r);
  assert.equal(pre(r, { stopId: 'e999' }).refusal.code, 'stop_not_open');
  assert.equal(pre(r, { stopId: 'e1' }).refusal.code, 'stop_not_open', 'an event that is not a stop at all (the tree_started record)');
  // a sitting runs
  assert.equal(pre(r, { sittingHeld: () => true }).refusal.code, 'sitting_running');
  assert.throws(() => rootReplanPreflight(r.t.rootDir, { work: r.t.work }), /sittingHeld is required/, 'the sitting check cannot be forgotten');
  // the task changed: a different goal is a new tree
  const taskFile = join(r.t.work, 'tasks', 'x.md');
  const original = readFileSync(taskFile, 'utf8');
  writeFileSync(taskFile, `${original}\nA different goal.\n`);
  const changed = pre(r);
  assert.equal(changed.refusal.code, 'task_changed'); assert.match(changed.refusal.text, /a different goal is a new tree/);
  writeFileSync(taskFile, original);
  assert.equal(pre(r).ok, true, 'restored: accepted again');
  // the accounting gate fails (the root run folder lost its run.json)
  const runJson = join(r.t.runsDir, ROOT_ID, 'run.json');
  renameSync(runJson, `${runJson}.away`);
  const gated = pre(r);
  assert.equal(gated.refusal.code, 'accounting_blocked', JSON.stringify(gated.refusal));
  renameSync(`${runJson}.away`, runJson);
  assert.equal(eventCount(r), before, 'nothing was written by any refusal');
  assert.ok(stop.id);
});

test('an active node blocks it (a child registered and not started counts as active), and so does money below the root chain\'s cheapest end: the cap is not raised by this verb: the person may raise it (--amend-cap) or start a new tree', async () => {
  const { r } = await withStop();
  approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  const active = pre(r);
  assert.equal(active.refusal.code, 'node_active'); assert.match(active.refusal.text, /council tree decide --close/);

  // money: after what the tree spent, the free amount must cover the root chain's cheapest end. A mock charge is written next to the root run's records (superseded/, which the gate counts), sized to leave the
  // cheapest end plus two cents (passes) and then minus two cents (refuses).
  const ok = (await withStop()).r;
  const p = pre(ok); assert.equal(p.ok, true);
  const charge = usd => { mkdirSync(join(ok.t.runsDir, ROOT_ID, 'superseded'), { recursive: true }); writeFileSync(join(ok.t.runsDir, ROOT_ID, 'superseded', 'zz-charge.usage.json'), JSON.stringify({ label: 'zz-charge', provider: 'mock', model: 'm', usd })); };
  charge(Math.round((p.freeUsd - p.chain.figures.cheapestUsd - 0.02) * 100) / 100);
  const edge = pre(ok);
  assert.equal(edge.ok, true, JSON.stringify(edge.refusal)); assert.ok(edge.freeUsd - edge.chain.figures.cheapestUsd < 0.05 && edge.freeUsd >= edge.chain.figures.cheapestUsd, 'the boundary: free is just above the cheapest end');
  charge(Math.round((p.freeUsd - p.chain.figures.cheapestUsd + 0.02) * 100) / 100);
  const tp = pre(ok);
  assert.equal(tp.refusal?.code, 'budget', JSON.stringify(tp.refusal)); // CHANGED (Astra 17, C&C order 20 Okt: a false sentence does not wait for the yes; OLD: /the root cap cannot be raised: the route is a new tree/; NEW: names --amend-cap and a new tree; WHY: council tree decide --amend-cap raises the cap in force (budgetOf reads effectiveCapUsd))
  assert.match(tp.refusal.text, /You can raise the tree's cap with `council tree decide [^ ]+ --amend-cap <total>` \(the total is yours to type\), or start a new tree with `council tree start`/); assert.doesNotMatch(tp.refusal.text, /cannot be raised/);
});

test('a pending re-plan refuses a second one: a root stop still open between the decision and its generation (the crash window the recovery rule covers) is NOT offered; a corrupt record refuses before anything else', async () => {
  const { r, stop } = await withStop();
  const second = appendTreeEvent(r.t.rootDir, STOP);          // a second open root stop of the same root plan (an obligation decision opens one)
  assert.equal(pre(r).refusal.code, 'stop_ambiguous', 'two open root stops: the person must name one');
  assert.equal(pre(r, { stopId: second.id }).ok, true, 'naming one is accepted');
  appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...GATE_FIELDS });
  // the decision is recorded, its generation_opened is not (the window between the two appends): the other root stop is still open, and a second re-plan must wait
  assert.equal(pre(r).refusal.code, 'replan_pending', JSON.stringify(pre(r)));
  const bad = await withStop();
  appendFileSync(join(treeDirOf(bad.r.t.rootDir), EVENTS_FILE), '{not json}\n');
  assert.equal(pre(bad.r).refusal.code, 'record_corrupt');
});

test('rootTaskRefOf: the PIN in tree.json is the only source; a damaged pin refuses; no pin refuses (no fall-back to run.json: no real tree lacks a pin, and an untested production branch kept alive by a fixture is not kept)', async () => {
  const r = await trackedRealRoot();
  const tree = readTreeRecord(r.t.rootDir).tree;
  assert.equal(rootTaskRefOf(tree).source, 'pin', 'the fixture tree is pinned like a tree `council tree start` makes');
  assert.equal(rootTaskRefOf({ ...tree, rootTask: { task: '/a/b.md', cwd: '/a', taskHash: 'a'.repeat(12) } }).ref.task, '/a/b.md');
  assert.equal(rootTaskRefOf({ ...tree, rootTask: { task: '/a/b.md' } }).refusal.code, 'task_pin_unusable');
  const { rootTask, ...noPin } = tree;
  assert.ok(rootTask);
  assert.equal(rootTaskRefOf(noPin).refusal.code, 'task_not_recorded');
});

test('the other refusals the preflight owns, each reached through the real record: a stop of another node (stop_not_root), no registered root (no_root), a root chain that is not the registered one (chain_unreadable), and a hand-edited tree.json (record_corrupt: the hash tree_started recorded guards the pin, so task_pin_unusable is reachable through rootTaskRefOf only)', async () => {
  // a stop of a CHILD is not answered by a new root plan: the child runs and closes, then holds a stop
  const { r } = await withStop();
  approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  mkdirSync(join(r.t.runsDir, reg.runId), { recursive: true }); writeFileSync(join(r.t.runsDir, reg.runId, 'run.json'), JSON.stringify({ runId: reg.runId }));
  appendTreeEvent(r.t.rootDir, { event: 'node_started', node: reg.node, generation: reg.event.generation, runId: reg.runId, pid: process.pid, host: 'localhost' });
  appendTreeEvent(r.t.rootDir, { event: 'node_closed', node: reg.node, generation: reg.event.generation, runId: reg.runId, outcome: 'passed', passed: true, status: 'needs_decision', share: 'released', returnedUsd: 0 });
  const childStop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: reg.node, generation: reg.event.generation, runId: reg.runId, source: 'node_closed', affected: [{ node: reg.node, generation: reg.event.generation }] });
  assert.equal(pre(r, { stopId: childStop.id }).refusal.code, 'stop_not_root');
  assert.equal(pre(r).ok, true, 'without a name, the only ROOT stop is the one chosen: the child\'s stop is not offered');

  // no registered root at all
  const bare = newTree();
  assert.equal(rootReplanPreflight(bare.rootDir, { work: bare.work, sittingHeld: () => false }).refusal.code, 'no_root');

  // the root chain file is not the one the tree registered
  const chainFile = join(r.t.work, 'chains', 'split-root.json');
  const chainText = readFileSync(chainFile, 'utf8');
  const q = await withStop();
  const qChain = join(q.r.t.work, 'chains', 'split-root.json');
  writeFileSync(qChain, `${readFileSync(qChain, 'utf8')} `);
  assert.equal(pre(q.r).refusal.code, 'chain_unreadable');
  assert.ok(chainText.length > 0);

  // a damaged pin written into tree.json by hand (createTreeFile refuses to write one): the record's own hash guard refuses first, so the pin check cannot be reached this way
  const d = await withStop();
  const treeFile = join(treeDirOf(d.r.t.rootDir), 'tree.json');
  const tj = JSON.parse(readFileSync(treeFile, 'utf8')); tj.rootTask = { task: 5 };
  writeFileSync(treeFile, `${JSON.stringify(tj, null, 2)}\n`);
  const damaged = pre(d.r);
  assert.equal(damaged.refusal.code, 'record_corrupt', JSON.stringify(damaged.refusal));
});

test('stop_dead: an open stop of a root generation that was already replaced is refused by name even if a record holds one (the table no longer writes one; a record written before that rule may)', async () => {
  const { r, stop } = await withStop();
  const p = pre(r); assert.equal(p.ok, true);
  const dec = appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: stop.id, replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...GATE_FIELDS });
  appendTreeEvent(r.t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R', generation: 2 }] });
  const bundle = rootBundle({ treeId: ROOT_ID, generation: 2, decisions: [{ id: dec.id, text: 'again' }], taskText: p.task.text }); writeRootBundle(r.t.rootDir, bundle);
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', kind: 'root_replan', openedBy: dec.id, frontierKey: 'kRoot', parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: [{ node: 'R', generation: 2 }], boundSha256: FIXTURE_BOUND });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, boundSha256: FIXTURE_BOUND, frontierKey: 'kRoot', revision: 1 });
  const ev = registerRootReplan(r.t.rootDir, { generation: 2, frontierKey: 'kRoot', bundle, chain: p.chain, previous: p.previous, taskSha256: p.task.taskSha256, capUsd: p.chain.figures.atMostUsd });
  mkdirSync(join(r.t.runsDir, ev.runId), { recursive: true }); writeFileSync(join(r.t.runsDir, ev.runId, 'run.json'), JSON.stringify({ runId: ev.runId }));
  appendTreeEvent(r.t.rootDir, { event: 'node_started', node: 'R', generation: 2, runId: ev.runId, pid: process.pid, host: 'localhost' });
  appendTreeEvent(r.t.rootDir, { event: 'node_closed', node: 'R', generation: 2, runId: ev.runId, outcome: 'passed', passed: true, status: 'needs_decision', share: 'released', returnedUsd: 0 });
  // the table refuses a stop on the dead R@g1 (S8-3 fix-up) ...
  assert.throws(() => appendTreeEvent(r.t.rootDir, STOP), e => e.name === 'TreeRefusal' && /replaced or set aside by a decision, or a node above it was/.test(e.message));
  // ... so write the line the way an OLDER version would have (hand-written), and the preflight still refuses it by name
  const rec = readTreeRecord(r.t.rootDir); const last = rec.events.at(-1);
  const line = { schema: 'tree-events/1', ...STOP, id: `e${Number(String(last.id).replace(/\D/g, '')) + 1}`, at: last.at };
  appendFileSync(join(treeDirOf(r.t.rootDir), EVENTS_FILE), `${JSON.stringify(line)}\n`);
  const after = pre(r);
  assert.ok(after.refusal, 'a dead-generation stop is never the stop to answer');
  assert.equal(after.refusal.code, 'no_root_stop', 'without a name: no stop of the LIVE root plan, so none is chosen');
  const named = pre(r, { stopId: line.id });
  assert.equal(named.refusal.code, 'stop_dead', JSON.stringify(named.refusal));
  assert.match(named.refusal.text, /R@g1, a root plan that was already replaced \(the root now is R@g2\)/);
});

test('D2 F13e (B22a / CR-2B-001): once R@g2 is REGISTERED, rootRemedies offers no milestone of R@g1 (its stop is no longer the one to answer, so `--milestone R@g1:<id>` beside the new root\'s stop would refuse); while R@g2 is only opened, R@g1\'s stay', async () => {
  const { r, stop } = await withStop();
  const p = pre(r); assert.equal(p.ok, true);
  const remedies = () => { const rec = readTreeRecord(r.t.rootDir); return rootRemedies(rec, stateOf(rec), r.t.runsDir); };
  // control (passes at both heads): the real root's split marks M5 needs-decision (test/helpers/split-fixture.js block3), so R@g1:M5 answers the root stop in place
  assert.deepEqual(remedies(), ['R@g1:M5']);
  const dec = appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: stop.id, replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...GATE_FIELDS });
  appendTreeEvent(r.t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R', generation: 2 }] });
  assert.deepEqual(remedies(), ['R@g1:M5'], 'an opened, unregistered R@g2 is not the newest REGISTERED root generation (control: passes at both heads)');
  const bundle = rootBundle({ treeId: ROOT_ID, generation: 2, decisions: [{ id: dec.id, text: 'again' }], taskText: p.task.text }); writeRootBundle(r.t.rootDir, bundle);
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', kind: 'root_replan', openedBy: dec.id, frontierKey: 'kRoot', parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: [{ node: 'R', generation: 2 }], boundSha256: FIXTURE_BOUND });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, boundSha256: FIXTURE_BOUND, frontierKey: 'kRoot', revision: 1 });
  registerRootReplan(r.t.rootDir, { generation: 2, frontierKey: 'kRoot', bundle, chain: p.chain, previous: p.previous, taskSha256: p.task.taskSha256, capUsd: p.chain.figures.atMostUsd });
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.has('R@g2'), true, 'precondition: R@g2 is registered');
  // RED at f7ccc764: ['R@g1:M5'] (rootRemedies walked every root generation)
  assert.deepEqual(remedies(), [], 'R@g2 has no closed plan yet, so nothing answers a root stop in place; R@g1:M5 is not offered');
});

test('rootBundle (Draft A): task.md is the task bytes; context.md is the existing part-7 shape around the person\'s text and NOTHING else; node.json carries the bundle hash and is not part of it; a different text is a different hash; no criteria.json', () => {
  const text = 'Use the offline store.\n```\nnot a fence of ours\n```\n# a heading line\n';
  const b = rootBundle({ treeId: 't1', generation: 2, decisions: [{ id: 'e6', text }], taskText: 'The goal.\n' });
  assert.deepEqual(Object.keys(b.files).sort(), ['context.md', 'node.json', 'task.md']);
  assert.equal(b.files['task.md'], 'The goal.\n');
  assert.equal(b.files['context.md'], `# Context\n\n## 7. The decisions that opened this generation\n\n----- decision e6 -----\n${text}----- end -----\n\n`, 'exactly the part-7 shape and the person\'s bytes');
  const lineage = JSON.parse(b.files['node.json']);
  assert.deepEqual(lineage, { treeId: 't1', node: 'R', generation: 2, attempt: 1, parentNode: null, depth: 0, splitSha256: null, bundleSha256: b.bundleSha256 });
  assert.equal(b.bundleBytes, Object.values(b.files).reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0));
  const other = rootBundle({ treeId: 't1', generation: 2, decisions: [{ id: 'e6', text: `${text}x` }], taskText: 'The goal.\n' });
  assert.notEqual(other.bundleSha256, b.bundleSha256, 'the repair is pinned in the hash');
  assert.equal(rootBundle({ treeId: 't1', generation: 2, decisions: [{ id: 'e6', text }], taskText: 'The goal.\n' }).bundleSha256, b.bundleSha256, 'the same inputs give the same hash');
  assert.throws(() => rootBundle({ treeId: 't', generation: 1, decisions: [{ id: 'e', text: 'x' }], taskText: 't' }), /generation 2 or later/);
  assert.throws(() => rootBundle({ treeId: 't', generation: 2, decisions: [], taskText: 't' }), /decisions that opened/);
  assert.throws(() => rootBundle({ treeId: 't', generation: 2, decisions: [{ id: 'e', text: '' }], taskText: 't' }), /decisions that opened/);
});

test('registration through the admitted path: after the decision, its generation, the root replacement frontier and its approval, R@g2 registers with a fresh run id, the run it replaces, the task hash and the bundle the member will re-check; before the approval it is refused and nothing is registered', async () => {
  const { r, stop } = await withStop();
  const p = pre(r); assert.equal(p.ok, true);
  const dec = appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'Plan the whole task again, offline first.', form: 'regenerate', stopId: stop.id, replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...GATE_FIELDS });
  appendTreeEvent(r.t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R', generation: 2 }] });
  const bundle = rootBundle({ treeId: ROOT_ID, generation: 2, decisions: [{ id: dec.id, text: 'Plan the whole task again, offline first.' }], taskText: p.task.text });
  const written = writeRootBundle(r.t.rootDir, bundle);
  assert.equal(written.written, true); assert.equal(written.dir, bundleDirOf(r.t.rootDir, 'R', 2));
  assert.equal(bundleSha256Of(written.dir), bundle.bundleSha256, 'the files on disk hash to the bundle hash the registration will carry (what the member\'s CLI re-checks)');
  assert.equal(writeRootBundle(r.t.rootDir, bundle).written, false, 'a crash retry rewrites the same bundle identically: nothing changes');
  // the cap the approval showed, strictly BELOW what is free and the chain's at-most (what is free can rise after an approval): the grant is that cap, never more
  const capUsd = Math.max(p.chain.figures.cheapestUsd, floorCents(Math.min(p.freeUsd, p.chain.figures.atMostUsd)) - 0.01);
  assert.ok(capUsd < Math.min(floorCents(p.freeUsd), p.chain.figures.atMostUsd), 'the fixture can tell a clamp from none');
  const args = { generation: 2, frontierKey: 'kRoot', bundle, chain: p.chain, previous: p.previous, taskSha256: p.task.taskSha256, capUsd };
  assert.throws(() => registerRootReplan(r.t.rootDir, { ...args, capUsd: undefined }), /needs `capUsd`/, 'the cap is required: no default that hides a forgotten argument');
  // known-bad: no approved root replacement frontier yet
  const n0 = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'node_registered').length;
  assert.throws(() => registerRootReplan(r.t.rootDir, args), e => e.name === 'TreeRefusal' || /frontier/.test(String(e.message)));
  assert.equal(readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'node_registered').length, n0, 'nothing was registered');
  // the frontier and its approval, as `tree approve` would record them
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', kind: 'root_replan', openedBy: dec.id, frontierKey: 'kRoot', parentNode: null, parentGeneration: null, parentRunId: null, splitSha256: null, children: [{ node: 'R', generation: 2 }], boundSha256: FIXTURE_BOUND });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, boundSha256: FIXTURE_BOUND, frontierKey: 'kRoot', revision: 1 });
  const ev = registerRootReplan(r.t.rootDir, args);
  assert.equal(ev.event, 'node_registered'); assert.equal(ev.node, 'R'); assert.equal(ev.generation, 2);
  assert.notEqual(ev.runId, ROOT_ID, 'a fresh run folder id, never the tree id'); assert.equal(ev.replacesRunId, ROOT_ID);
  assert.equal(ev.taskSha256, p.task.taskSha256); assert.equal(ev.bundleSha256, bundle.bundleSha256); assert.equal(ev.bundleBytes, bundle.bundleBytes);
  assert.equal(ev.parentNode, null); assert.equal(ev.depth, 0); assert.equal(ev.splitSha256, null);
  assert.equal(ev.grant.amount, capUsd, 'the cap the approval showed - below the free amount and the chain\'s at-most figure, so neither of them is the grant');
  const state = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(state.nodes.get('R@g2').phase, 'registered'); assert.equal(state.active, 'R@g2');
  // twice: refused, nothing more registered
  assert.throws(() => registerRootReplan(r.t.rootDir, args), e => e.name === 'TreeRefusal');
  assert.equal(readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'node_registered').length, n0 + 1);
  assert.ok(existsSync(join(written.dir, 'node.json')));
});

// RED TRIAGE, root wording (C&C thcmcp-cd 23 Okt 2026, ruling 2 + 3; A-DRAFT sentences): the "a node is active" refusal says what `--close` can really do for THAT node. The rule (S8 2.3) is unchanged: every row below still refuses.
// Rows: (W1) a node whose process is alive cannot be closed: the sentence says wait; (W2) a node the record says runs, whose process is gone and whose run folder already holds the end: the sentence goes to `council tree resume`, not to --close
// (tree-close.js:30-31 refuses it); (W4, W5) a node that waits for the PERSON's answer (an overseer stop, an external seat) is pointed to `council tree resume` for how to answer it and warned that closing ends a run that waits for them, never steered to close it as if it were dead; (W3) the same dead claim with NO end in the folder is closable: today's sentence ("--close ends it") is true there and stays (control, green before and after).
const treeIdOf = r => stateOf(readTreeRecord(r.t.rootDir)).treeId;
async function withRunningChild({ pid, file = null, partial = null, choice = null }) {
  const { r } = await withStop();
  approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  const runId = stateOf(readTreeRecord(r.t.rootDir)).nodes.get(`${reg.node}@g1`).runId;
  appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim(reg.node, runId, pid, 1, hostnameOf()) });
  if (file) { mkdirSync(join(r.t.runsDir, runId), { recursive: true }); writeFileSync(join(r.t.runsDir, runId, file), '{}'); }       // a file in the node's run folder: the end, or the wait, the folder shows
  if (partial) { mkdirSync(join(r.t.runsDir, runId), { recursive: true }); writeFileSync(join(r.t.runsDir, runId, 'report-partial.json'), JSON.stringify({ stop: partial })); }
  if (choice) appendTreeEvent(r.t.rootDir, { event: 'node_choice', node: reg.node, generation: 1, runId, ...choice });
  return { r, key: `${reg.node}@g1` };
}
test('W1 a node whose process is alive: the root re-plan is refused (the rule is unchanged) and the sentence says to wait, never that --close ends it', { timeout: 300_000 }, async () => {
  const { r, key } = await withRunningChild({ pid: process.pid });
  const before = eventCount(r);
  const p = pre(r);
  assert.equal(p.refusal.code, 'node_active', JSON.stringify(p.refusal));
  assert.match(p.refusal.text, new RegExp(`${key} is running: pid ${process.pid} on .* holds its claim and is alive`));
  assert.match(p.refusal.text, /Wait for it to end, then decide again: a root re-plan never races a running node/);
  assert.equal(p.refusal.text.includes('ends it'), false, p.refusal.text);
  assert.equal(eventCount(r), before, 'nothing was written');
});
test('W2 a node that runs on paper, whose process is gone and whose run folder holds the end: the sentence sends the person to `council tree resume`, not to --close', { timeout: 300_000 }, async () => {
  const { r, key } = await withRunningChild({ pid: 2147483000, file: 'STOPPED-budget.json' });
  const p = pre(r);
  assert.equal(p.refusal.code, 'node_active', JSON.stringify(p.refusal));
  assert.match(p.refusal.text, new RegExp(`${key}'s run already ended`));
  assert.ok(p.refusal.text.includes('`council tree resume` records how it ended') && p.refusal.text.includes('Do that first, then decide again'), p.refusal.text);
  assert.equal(p.refusal.text.includes('ends it'), false, p.refusal.text);
});
test('W3 (control) a dead claim whose run has NOT ended is closable: today\'s sentence stays, because it is true there', { timeout: 300_000 }, async () => {
  const { r } = await withRunningChild({ pid: 2147483000 });
  const p = pre(r);
  assert.equal(p.refusal.code, 'node_active', JSON.stringify(p.refusal));
  assert.ok(p.refusal.text.includes('answer or close it first') && p.refusal.text.includes('`council tree decide --close` ends it'), p.refusal.text);
});
test('W4 a node stopped at its overseer limit, waiting for the person\'s choice: the sentence says to answer it first and that closing ends a run that waits for them', { timeout: 300_000 }, async () => {
  const { r, key } = await withRunningChild({ pid: 2147483000, file: 'STOPPED-overseer_cap.json' });
  const p = pre(r);
  assert.equal(p.refusal.code, 'node_active', JSON.stringify(p.refusal));
  assert.ok(p.refusal.text.includes(`${key} is stopped at its overseer limit, not agreed, waiting for a choice: it waits for your answer; \`council tree resume ${treeIdOf(r)}\` says how to give it. Then decide again`), p.refusal.text);
  assert.ok(p.refusal.text.includes('closing it would end a run that waits for you'), p.refusal.text);
  assert.equal(p.refusal.text.includes('answer or close it first'), false, p.refusal.text);
});
test('W5 a node paused at an external seat: the same, with its own words', { timeout: 300_000 }, async () => {
  const { r, key } = await withRunningChild({ pid: 2147483000, file: 'NEEDS-builder.md' });
  const p = pre(r);
  assert.equal(p.refusal.code, 'node_active', JSON.stringify(p.refusal));
  assert.ok(p.refusal.text.includes(`${key} is paused, waiting for an external answer`) && p.refusal.text.includes(`\`council tree resume ${treeIdOf(r)}\` says how to give it. Then decide again`), p.refusal.text);
});
test('W6 a node that runs on paper, whose process is gone and whose run folder holds report.json (the common end of a run): the same sentence as W2, the close is not offered', { timeout: 300_000 }, async () => {
  const { r, key } = await withRunningChild({ pid: 2147483000, file: 'report.json' });
  const p = pre(r);
  assert.equal(p.refusal.code, 'node_active', JSON.stringify(p.refusal));
  assert.match(p.refusal.text, new RegExp(`${key}'s run already ended`));
  assert.ok(p.refusal.text.includes('`council tree resume` records how it ended') && p.refusal.text.includes('Do that first, then decide again'), p.refusal.text);
  assert.equal(p.refusal.text.includes('ends it'), false, p.refusal.text);
});
test('W7 a node stopped by a price refusal: it is told to raise the price first (its own words say how), not to run `council tree resume` alone, and closing is warned against', { timeout: 300_000 }, async () => {
  const { r, key } = await withRunningChild({ pid: 2147483000, file: 'STOPPED-price_refused.json' });
  const p = pre(r);
  assert.equal(p.refusal.code, 'node_active', JSON.stringify(p.refusal));
  assert.ok(p.refusal.text.includes(`${key} is stopped by a price refusal`) && p.refusal.text.includes('Do that first (resume asks the refused stage again and can cost money), then decide again (closing it would end a run that waits for you)'), p.refusal.text);
  assert.equal(p.refusal.text.includes('says how to give it'), false, p.refusal.text);
});
test('W10 a price stop on the seat\'s OWN limits (recognised-own): the root refusal names the runnable accept step (root id and the chain the node was registered with), as the close screen does (integration\'s rule: printed whole or not at all; OLD at this re-pick: describePhase was called without ctx, so the step was left out)', { timeout: 300_000 }, async () => {
  const { r, key } = await withRunningChild({ pid: 2147483000, file: 'STOPPED-price_refused.json', partial: { kind: 'price_refused', recognised: true, ownPin: true } });
  const p = pre(r);
  assert.equal(p.refusal.code, 'node_active', JSON.stringify(p.refusal));
  const treeId = stateOf(readTreeRecord(r.t.rootDir)).treeId;
  assert.match(p.refusal.text, new RegExp(`${key} is stopped by a price refusal \\(change the numbers of the seat's own provider.max_price in the chain, accept them with \`council tree decide ${treeId} --accept-chain-limits [\\w.-]+\`, then resume\\)`), p.refusal.text);
  assert.ok(p.refusal.text.includes('Do that first (resume asks the refused stage again and can cost money)'), p.refusal.text);
});
test('W8 a round stop whose choice is ALREADY recorded no longer waits: the sentence says resume applies it, starts the member again and can cost money', { timeout: 300_000 }, async () => {
  const { r, key } = await withRunningChild({ pid: 2147483000, file: 'STOPPED-overseer_cap.json', partial: { kind: 'overseer_cap', overseer_round: 7, pass: 3 }, choice: { choice: 'continue', stop: 'overseer_cap:7:3' } });
  const p = pre(r);
  assert.equal(p.refusal.code, 'node_active', JSON.stringify(p.refusal));
  assert.ok(p.refusal.text.includes(`${key} is stopped and your choice for it is recorded: \`council tree resume ${treeIdOf(r)}\` applies it and starts the member again, which can cost money.`), p.refusal.text);
  assert.equal(p.refusal.text.includes('waits for your answer'), false, p.refusal.text);
});
// W9: a node that waits for a person whose plan was REPLACED (the table of today refuses to replace a running node, so the three lines are written by hand, as an older version would have): resume says it cannot be given a choice, so the sentence says give it up, not "says how to give it"
const hand = (r, ev) => { const last = readTreeRecord(r.t.rootDir).events.at(-1); const id = `e${Number(String(last.id).replace(/\D/g, '')) + 1}`; appendFileSync(join(treeDirOf(r.t.rootDir), EVENTS_FILE), `${JSON.stringify({ schema: 'tree-events/1', ...ev, id, at: last.at })}\n`); return id; };
test('W9 an overseer-stopped node whose plan was REPLACED is told to give it up, not that resume says how to give it a choice', { timeout: 300_000 }, async () => {
  const { r, key } = await withRunningChild({ pid: 2147483000, file: 'STOPPED-overseer_cap.json' });
  const node = key.replace(/@g1$/, '');
  const runId = stateOf(readTreeRecord(r.t.rootDir)).nodes.get(key).runId;
  const stopId = hand(r, { event: 'needs_decision_opened', node, generation: 1, runId, source: 'node_closed', affected: [{ node, generation: 1 }] });
  const decId = hand(r, { event: 'decision_recorded', text: 't', affected: [{ node, generation: 1 }], form: 'regenerate', stopId, gateId: 'g', shownSha256: '0'.repeat(64) });
  hand(r, { event: 'generation_opened', decisionId: decId, nodes: [{ node, generation: 2 }] });
  const p = pre(r);
  assert.equal(p.refusal?.code, 'node_active', JSON.stringify(p.refusal));
  assert.ok(p.refusal.text.includes(`${key} was stopped and waits for a person, but its plan was replaced, so it can no longer be resumed or given a choice. Give it up with \`council tree decide ${treeIdOf(r)} --close ${key}\``), p.refusal.text);
  assert.equal(p.refusal.text.includes('says how to give it'), false, p.refusal.text);
});
