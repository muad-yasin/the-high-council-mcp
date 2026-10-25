// S8-6b PART 2a (C&C's go on 520cee1, 12 Oct 2026; MCP-surface SHA-stop: the P9/P14 pins move again, old -> new): what the readers say about three states that today read as "Nothing is asked of you right now" or "start the registered child with `council tree resume`" while the tree would refuse it.
//   (1) an UNSTARTED ROOT (no R registered, or R@g1 registered with no run.json): the status next step names `council tree resume`; TREE_HANDOFF.md section 6 does not send a person to a root plan that does not exist. ONE predicate (`rootUnstartedOf`, src/tree-start.js: resume's own step-0 test).
//   (2) a member start refused by the tree's personal-data rule (exit 19, a `blocked` record of reason pii_mode_mismatch; two causes, the mode or a non-empty --allow-pii): shown ONLY while the node is still `registered`, in fixed words; `detail` is never printed. A HAND start leaves run.json, so the next sitting refuses it again and
//       the next step is `decide --close`, not `resume`; with no run.json the sitting starts it and `resume` stays true. A tree whose mode reads `unusable` starts nothing: neither resume line is named.
//   (3) the root variant's bundle_input stop names its `child` (a fixed node key) in the payload and the handoff.
// New exports are read through a namespace (the habit from the views-lock slip). Everything is mock and $0; every folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as H from '../src/tree-handoff.js';
import * as U from '../src/tree-root-unstarted.js';
import * as B from '../src/tree-blocked-child.js';
import { buildTreeReport, renderTreeReport } from '../src/tree-report.js';
import { TREE_STATUS_UNTRUSTED_FIELDS, treeStatusPayload } from '../src/mcp/tree-status.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { readTreeRecord, startTree, stateOf, treeDirOf } from '../src/tree-record.js';
import { registerRoot } from '../src/tree-register.js';
import { registerNextChild } from '../src/tree-loop.js';
import { bundleDirOf } from '../src/tree-continuation.js';
import { memberStart } from '../src/tree-member.js';
import { runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { openBundleInputStop } from '../src/tree-bundle-input.js';
import { makeRootTaskPin } from '../src/tree-task-pin.js';
import { sha256Of } from '../src/thin-contract.js';
import * as api from '../src/api.js';
import { track, trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren, splitChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID, newTree } from './helpers/tree-fixture.js';

const HOSTILE = `LOUD${String.fromCodePoint(0x202E)}${'x'.repeat(60)}`;
const RESUME = id => `council tree resume ${id}`;

/** A started tree with NO root registered (the state `tree start` leaves when it is interrupted before registering R). */
function unstartedRoot(piiGate) {
  const t = newTree({ cap: 100 }); track(t.work);
  const rootDir = join(t.runsDir, '2026-10-12T20-00-00-000Z');
  startTree(rootDir, { rootCapUsd: 100, rootTask: makeRootTaskPin(join(t.work, 'tasks', 'x.md'), t.work), ...(piiGate ? { piiGate } : {}), chains: [0, 1, 2].map(depth => ({ depth, name: depth ? t.childChain : t.rootChain, sha256: t.shaIn(depth ? t.childChain : t.rootChain) })) });
  return { ...t, rootDir, rootId: '2026-10-12T20-00-00-000Z' };
}
/** tree.json holds `value` as its mode with the tree_started hash rewritten to match (A's trap in test/tree-pii-member.test.js): sound record, unusable mode. */
function makeUnusable(rootDir, value) {
  const dir = treeDirOf(rootDir); const file = join(dir, 'tree.json');
  const j = JSON.parse(readFileSync(file, 'utf8')); j.piiGate = value;
  const text = `${JSON.stringify(j, null, 2)}\n`; writeFileSync(file, text);
  const evFile = join(dir, 'events.jsonl'); const lines = readFileSync(evFile, 'utf8').split('\n'); const first = JSON.parse(lines[0]); first.treeJsonSha256 = sha256Of(text); lines[0] = JSON.stringify(first); writeFileSync(evFile, lines.join('\n'));
  assert.deepEqual(readTreeRecord(rootDir).corrupt, [], 'the record reads as sound: the hash matches');
}
const nextSteps = text => text.slice(text.indexOf('What you can do')).split('\n').slice(1).map(l => l.trim()).filter(Boolean);
const view = (rootDir, work) => { const facts = gatherStatusFacts(rootDir, { work }); return { facts, text: renderTreeStatus(facts), payload: treeStatusPayload(facts) }; };
const section6 = (rootDir, work) => { const t = H.renderTreeHandoff(H.gatherHandoffFacts(rootDir, { work })); return t.slice(t.indexOf('## 6.')); };

/** A real hard-stop tree with its first child REGISTERED; `hand()` starts it through the real CLI path (api.run), which writes run.json BEFORE memberStart refuses; `direct(piiGate, piiAllow)` calls memberStart with no run folder. */
async function registeredChild() {
  const r = await trackedRealRoot({ ...pricedChildren(), piiGate: 'hard-stop' }); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  const bundle = bundleDirOf(r.t.rootDir, reg.node, reg.event.generation);
  const lineage = JSON.parse(readFileSync(join(bundle, 'node.json'), 'utf8'));
  const inputs = { task: join(bundle, 'task.md'), criteria: join(bundle, 'criteria.json'), context: join(bundle, 'context.md') };
  const hand = () => api.run({ chain: reg.event.chain.name, task: inputs.task, criteria: inputs.criteria, context: inputs.context, runId: reg.runId, treeNode: join(bundle, 'node.json'), cwd: r.t.work, maxUsd: reg.grantUsd });
  const direct = (piiGate, piiAllow = []) => memberStart({ runDir: join(r.t.runsDir, reg.runId), runId: reg.runId, lineage, purpose: 'run', capAskedUsd: reg.grantUsd, chainPath: join(r.t.work, 'chains', 'priced-debate.json'), inputs, piiGate, piiAllow, allowSecretShaped: false, ceiling: null, work: r.t.work });
  return { r, reg, hand, direct, dir: r.t.rootDir, rootId: ROOT_ID };
}

test('P2A-1: rootUnstartedOf is resume\'s own step-0 test - no R@g1, or R@g1 registered with no run.json - and no other state', () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'p2a-runs-')); track(runsDir);
  const stateOf1 = nodes => ({ nodes: new Map(nodes.map(n => [`${n.node}@g${n.generation}`, n])) });
  assert.equal(U.rootUnstartedOf(stateOf1([]), runsDir), true, 'no root registered');
  assert.equal(U.rootUnstartedOf(stateOf1([{ node: 'R', generation: 2, phase: 'registered', runId: 'x' }]), runsDir), true, 'no generation 1 of R');
  assert.equal(U.rootUnstartedOf(stateOf1([{ node: 'R', generation: 1, phase: 'registered', runId: 'r1' }]), runsDir), true, 'registered, no run folder');
  mkdirSync(join(runsDir, 'r1')); writeFileSync(join(runsDir, 'r1', 'run.json'), '{}');
  assert.equal(U.rootUnstartedOf(stateOf1([{ node: 'R', generation: 1, phase: 'registered', runId: 'r1' }]), runsDir), false, 'registered with run.json: the run began');
  assert.equal(U.rootUnstartedOf(stateOf1([{ node: 'R', generation: 1, phase: 'closed', runId: 'r2' }]), runsDir), false, 'closed');
  assert.equal(U.rootUnstartedOf(stateOf1([{ node: 'R/M1', generation: 1, phase: 'registered', runId: 'r3' }]), runsDir), true, 'a child alone is not a root');
});

test('P2A-2: an unstarted root names `council tree resume` on the status view and the MCP view, and the handoff does not send a person to a root plan that does not exist; R registered without run.json is the same state', () => {
  const t = unstartedRoot();
  const v = view(t.rootDir, t.work);
  assert.equal(v.facts.rootUnstarted, true);
  assert.deepEqual(nextSteps(v.text), [`start the root plan with \`${RESUME(t.rootId)}\``]);
  assert.deepEqual(nextSteps(v.payload.view), nextSteps(v.text), 'the MCP view is the same text');
  assert.ok(!('rootUnstarted' in v.payload), 'a status fact, not a payload key');
  const six = section6(t.rootDir, t.work);
  assert.ok(six.includes(`\`${RESUME(t.rootId)}\``) && !six.includes('read the root plan above'), six);
  // R@g1 registered, run folder without run.json (the second case of resume's step 0): the line still stands; the handoff's "active node" sentence is true there and stays
  registerRoot(t.rootDir, {});
  const v2 = view(t.rootDir, t.work);
  assert.equal(v2.facts.rootUnstarted, true);
  assert.deepEqual(nextSteps(v2.text), [`start the root plan with \`${RESUME(t.rootId)}\``]);
  assert.ok(section6(t.rootDir, t.work).includes('The active node: `R` (registered)'));
});

test('P2A-3: no resume line where resume would refuse: an unreadable record (problems), and a tree whose personal-data mode reads `unusable` (every start refused, fail closed)', () => {
  const broken = unstartedRoot('warn');
  const j = JSON.parse(readFileSync(join(treeDirOf(broken.rootDir), 'tree.json'), 'utf8')); j.piiGate = 7; writeFileSync(join(treeDirOf(broken.rootDir), 'tree.json'), JSON.stringify(j));
  const vb = view(broken.rootDir, broken.work);
  assert.ok(vb.facts.problems.length > 0); assert.equal(vb.facts.rootUnstarted, false);
  assert.ok(!vb.text.includes(RESUME(broken.rootId)), 'the early-return branch names no resume');
  const t = unstartedRoot('warn'); makeUnusable(t.rootDir, 7);
  const v = view(t.rootDir, t.work);
  assert.equal(v.facts.problems.length, 0); assert.equal(v.facts.piiGate, 'unusable');
  assert.ok(!v.text.includes('council tree resume'), v.text);
  assert.deepEqual(nextSteps(v.text), [H.NO_START_UNUSABLE]);
  assert.ok(section6(t.rootDir, t.work).includes(H.NO_START_UNUSABLE) && !section6(t.rootDir, t.work).includes('council tree resume'));
});

test('P2A-4: a HAND start through the real CLI is refused (exit 19) BEFORE it wrote run.json (member unit, 13 Oct 2026; it used to write run.json first and trap the node): the refusal shows on every reader, the next step is still `resume` (a sitting starts the node afresh under the tree\'s mode), and the sitting then starts it', async () => {
  const c = await registeredChild();
  assert.equal((await c.hand()).exitCode, 19);
  assert.equal(existsSync(join(c.r.t.runsDir, c.reg.runId, 'run.json')), false, 'nothing saved the wrong mode');
  const key = 'R/M1@g1';
  let v = view(c.dir, c.r.t.work);
  assert.deepEqual(v.facts.memberRefusals, [{ node: 'R/M1', generation: 1, count: 1, runJson: false }]);
  assert.ok(v.text.includes(H.memberRefusalLine(v.facts.memberRefusals[0])), v.text);
  assert.deepEqual(nextSteps(v.text), [`start the registered child with \`council tree resume ${c.rootId}\``]);
  assert.deepEqual(v.payload.memberRefusals, v.facts.memberRefusals);
  const hf = H.renderTreeHandoff(H.gatherHandoffFacts(c.dir, { work: c.r.t.work }));
  assert.ok(hf.includes('### Refused member starts') && hf.includes(`\`${key}\``) && hf.includes(H.MEMBER_REFUSAL_REASON), hf);
  // the sitting starts the node with the tree's mode: no refusal, and the display ends because the node is no longer registered-not-started
  await runTree(c.dir, { work: c.r.t.work });
  assert.equal(readTreeRecord(c.dir).events.filter(e => e.event === 'node_started' && e.node === 'R/M1').length, 1, 'the sitting started R/M1 (not refused, not idle)');
  v = view(c.dir, c.r.t.work);
  assert.deepEqual(v.facts.memberRefusals, []);
});

test('P2A-4b: the LEGACY trapped state (a refused hand start that DID write run.json, from before the member unit): the next step is `decide --close`, not `resume`; the entry shape is exactly the documented one on every reader; closing the node ends the display', async () => {
  const c = await registeredChild();
  assert.equal((await c.hand()).exitCode, 19);
  // THE ONE HAND-MADE FILE: the state an older run left (the readers only look whether the node's run folder holds a run.json); the real verbs can no longer produce it
  mkdirSync(join(c.r.t.runsDir, c.reg.runId), { recursive: true }); writeFileSync(join(c.r.t.runsDir, c.reg.runId, 'run.json'), '{}');
  const key = 'R/M1@g1';
  let v = view(c.dir, c.r.t.work);
  assert.deepEqual(v.facts.memberRefusals, [{ node: 'R/M1', generation: 1, count: 1, runJson: true }]);
  assert.ok(v.text.includes(H.memberRefusalLine(v.facts.memberRefusals[0])), v.text);
  assert.deepEqual(nextSteps(v.text), [H.closeRefusedLine('R/M1', c.rootId)]);
  assert.ok(!v.text.includes('council tree resume'), 'a resume would be refused again');
  assert.deepEqual(v.payload.memberRefusals, v.facts.memberRefusals);
  for (const entry of [v.payload.memberRefusals[0], v.facts.memberRefusals[0], buildTreeReport(c.dir, { work: c.r.t.work }).memberRefusals[0]]) assert.deepEqual(Object.keys(entry).sort(), ['count', 'generation', 'node', 'runJson'], 'the entry shape is exactly four fixed keys: no detail, no scope string');
  assert.deepEqual(buildTreeReport(c.dir, { work: c.r.t.work }).memberRefusals, v.facts.memberRefusals);
  assert.deepEqual(JSON.parse(renderTreeReport(buildTreeReport(c.dir, { work: c.r.t.work }))).memberRefusals, v.facts.memberRefusals);
  const hf = H.renderTreeHandoff(H.gatherHandoffFacts(c.dir, { work: c.r.t.work }));
  assert.ok(hf.includes('### Refused member starts') && hf.includes(`\`${key}\``) && hf.includes(H.MEMBER_REFUSAL_REASON), hf);
  // `decide --close` is the exit, and a node that is no longer registered shows no refusal
  const io = terminal(['R/M1', 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  assert.equal(await decideHandler({ rootDir: c.dir, rootId: c.rootId, flags: { close: 'R/M1' }, work: c.r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)), 0, io.shown() + io.errors());
  v = view(c.dir, c.r.t.work);
  assert.deepEqual(v.facts.memberRefusals, []); assert.ok(!v.text.includes(H.MEMBER_REFUSAL_REASON));
  assert.ok(!H.renderTreeHandoff(H.gatherHandoffFacts(c.dir, { work: c.r.t.work })).includes('### Refused member starts'));
});

test('P2A-5: a refusal with NO run.json (memberStart called without a run folder) keeps the truthful `resume` line; the --allow-pii cause reads the same sentence as the mode cause; a corrected start leaves nothing stale', async () => {
  const c = await registeredChild();
  assert.throws(() => c.direct(null), e => e.code === 'pii_mode_mismatch');
  assert.throws(() => c.direct('hard-stop', ['email']), e => e.code === 'pii_mode_mismatch' && /no --allow-pii/.test(e.reason));
  const v = view(c.dir, c.r.t.work);
  assert.deepEqual(v.facts.memberRefusals, [{ node: 'R/M1', generation: 1, count: 2, runJson: false }], 'both causes, one line');
  assert.deepEqual(nextSteps(v.text), [`start the registered child with \`${RESUME(c.rootId)}\``]);
  assert.ok(v.text.includes(H.MEMBER_REFUSAL_REASON));
  assert.equal(c.direct('hard-stop').claim.event, 'node_started', 'the matching start goes through');
  assert.deepEqual(view(c.dir, c.r.t.work).facts.memberRefusals, [], 'the node ran: the old refusal is history');
});

test('P2A-6: `detail` is printed on NO surface: with a hostile unusable mode the member\'s detail is in the record, and only the handoff\'s one `Why:` line (part 1) carries the 40 characters of tree.json - no reader prints the detail wording', async () => {
  const c = await registeredChild();
  makeUnusable(c.dir, HOSTILE);
  assert.throws(() => c.direct(null), e => e.code === 'pii_mode_mismatch' && /no member of this tree starts while it is/.test(e.reason));   // EDITED in the M7 apply (E84; old: "starts until it is a tree started again")
  assert.ok(readTreeRecord(c.dir).events.some(e => e.reason === 'pii_mode_mismatch' && /no member of this tree starts while it is\. The route is a new tree, started with `council tree start`\./.test(e.detail) && !e.detail.includes('Close the node') && e.detail.includes('LOUD')), 'the record holds the detail (E84: the route is a new tree, never a close)');
  const w = c.r.t.work; const v = view(c.dir, w);
  assert.deepEqual(v.facts.memberRefusals, [{ node: 'R/M1', generation: 1, count: 1, runJson: false }]);
  assert.deepEqual(nextSteps(v.text), [H.NO_START_UNUSABLE], 'unusable: neither resume line');
  const handoff = H.renderTreeHandoff(H.gatherHandoffFacts(c.dir, { work: w }));
  const report = buildTreeReport(c.dir, { work: w });
  const surfaces = [['status view', v.text], ['MCP view', v.payload.view], ['MCP payload', JSON.stringify(v.payload)], ['status facts', JSON.stringify(v.facts)], ['report.json', renderTreeReport(report)], ['handoff', handoff]];
  for (const [name, text] of surfaces) assert.ok(!text.includes('no member of this tree starts while it is'), `${name} does not carry the detail wording`);
  for (const [name, text] of surfaces.filter(([n]) => n !== 'handoff')) assert.ok(!text.includes('LOUD'), `${name} does not carry the tree.json characters`);
  const loud = handoff.split('\n').filter(l => l.includes('LOUD'));
  assert.equal(loud.length, 1, 'the handoff carries the characters on exactly one line'); assert.match(loud[0], /^Why: /);
  assert.ok(!/[‮\u001b]/.test(handoff), 'and nothing unsafe reaches the file');
});

test('P2A-7: the root variant\'s bundle_input stop names its `child` as a fixed node key in the payload and the handoff; the child variant and a malformed `child` name none; childKeyOf shape-checks', async () => {
  assert.equal(H.childKeyOf({ child: { node: 'R/M3', generation: 1 } }), 'R/M3@g1');
  for (const bad of [undefined, null, 'R/M3', {}, { node: 7, generation: 1 }, { node: 'R/M3', generation: '1' }, { node: 'R/M3', generation: 1.5 }, { node: 'R/M3', generation: 0 }, { node: '', generation: 1 }]) assert.equal(H.childKeyOf({ child: bad }), null, JSON.stringify(bad));
  assert.equal(H.childKeyOf({}), null);
  const r = await trackedRealRoot({ ...splitChildren(), plan: plan3() }); approvePending(r);
  openBundleInputStop(r.t.rootDir, { child: { node: 'R/M3', generation: 1 }, parent: { node: 'R', generation: 1 }, found: { findings: [{ file: 'context.md', line: 3, name: 'URL credentials (scheme://user:pass@)' }], carriers: [], parentOwned: true } });
  const v = view(r.t.rootDir, r.t.work);
  assert.deepEqual(v.payload.openStops.map(s => [s.node, s.generation, s.child]), [['R', 1, 'R/M3@g1']]);
  assert.deepEqual(Object.keys(v.payload.openStops[0]).sort(), ['child', 'generation', 'id', 'node', 'text'], 'the openStops entry shape (no test pinned it before this one)');
  assert.ok(TREE_STATUS_UNTRUSTED_FIELDS.includes('openStops'), 'the entry is under an already untrusted field');
  assert.match(H.renderTreeHandoff(H.gatherHandoffFacts(r.t.rootDir, { work: r.t.work })), /needs_decision on `R@g1` \(for child `R\/M3@g1`\), opened by bundle_input/);
});

test('P2A-8: the untrusted classification does not change (`memberRefusals` carries node names like `nodes`, which is not listed), and a facts object with no `memberRefusals` renders no refusal line', () => {
  assert.ok(!TREE_STATUS_UNTRUSTED_FIELDS.includes('memberRefusals'));
  const t = unstartedRoot();
  const { memberRefusals, ...rest } = gatherStatusFacts(t.rootDir, { work: t.work });
  assert.deepEqual(memberRefusals, []);
  assert.ok(!renderTreeStatus(rest).includes(H.MEMBER_REFUSAL_REASON));
});

test('P2A-9: after `decide --close` on a member, the next sitting opens the stop that offers a way on, so until then the view names `council tree resume` (not "Nothing is asked of you"); once the stop is open it names `decide` and not resume', async () => {
  const c = await registeredChild();
  assert.equal((await c.hand()).exitCode, 19);
  const io = terminal(['R/M1', 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  assert.equal(await decideHandler({ rootDir: c.dir, rootId: c.rootId, flags: { close: 'R/M1' }, work: c.r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)), 0, io.shown() + io.errors());
  let v = view(c.dir, c.r.t.work);
  assert.deepEqual(v.facts.stopToOpen, ['R/M1@g1']);
  assert.deepEqual(nextSteps(v.text), [H.stopToOpenLine(['R/M1@g1'], c.rootId)]);
  assert.deepEqual(nextSteps(v.payload.view), nextSteps(v.text));
  assert.ok(!('stopToOpen' in v.payload), 'a status fact, not a payload key');
  const out = await runTree(c.dir, { work: c.r.t.work });
  assert.equal(out.status, 'held_by_stop', 'the sitting does open the stop: the line was true');
  v = view(c.dir, c.r.t.work);
  assert.deepEqual(v.facts.stopToOpen, []);
  assert.ok(v.facts.openStops.length === 1 && !nextSteps(v.text).some(l => l.includes('council tree resume')), nextSteps(v.text).join(' | '));
  assert.match(nextSteps(v.text)[0], /council tree decide/);
});

test('P2A-10: a child a person closed BEFORE it ever started (c3b, no nodes row): until the sitting opens its stop the view names `council tree resume`, after it the stop; the status asks the blocked-child module\'s own pure half (pendingBlockedChildren), not a copy of its filters', async () => {
  const sc = splitChildren(); const cfg = sc.extraChains['split-child'];
  const seat = { provider: 'mock', model: 'mock-plan-placeholder-url', maxTokens: 4000 };
  cfg.seats = { ...cfg.seats, builder: seat, reviser: seat };
  const r = await trackedRealRoot({ ...sc, plan: plan3() }); approvePending(r);
  const sittings = async () => { let last; for (let i = 0; i < 6; i += 1) { last = await runTree(r.t.rootDir, { work: r.t.work }); if (last.status !== 'limit_reached') break; } return last; };
  assert.equal((await sittings()).status, 'held_by_stop', 'the dirty provider text opens the bundle_input stop on R/M2');
  const io = terminal(['R/M2', 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { close: 'R/M2' }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)), 0, io.shown() + io.errors());
  let v = view(r.t.rootDir, r.t.work);
  assert.deepEqual(v.facts.stopToOpen, ['R/M2@g1']);
  assert.deepEqual(nextSteps(v.text), [H.stopToOpenLine(['R/M2@g1'], ROOT_ID)], 'before the sitting: nothing is open to answer, resume opens the stop');
  const record = readTreeRecord(r.t.rootDir);
  assert.deepEqual(B.pendingBlockedChildren(record, stateOf(record), { reasons: v.facts.readiness.reasons }).map(p => [p.node, p.generation]), [['R/M2', 1]], 'the shared pure half says the same');
  assert.equal((await runTree(r.t.rootDir, { work: r.t.work })).status, 'held_by_stop');
  v = view(r.t.rootDir, r.t.work);
  assert.deepEqual(v.facts.stopToOpen, []);
  assert.match(nextSteps(v.text)[0], /council tree decide/); assert.ok(!v.text.includes('council tree resume'));
  const after = readTreeRecord(r.t.rootDir);
  assert.deepEqual(B.pendingBlockedChildren(after, stateOf(after), { reasons: view(r.t.rootDir, r.t.work).facts.readiness.reasons }), [], 'with the stop open, nothing is pending');
});
