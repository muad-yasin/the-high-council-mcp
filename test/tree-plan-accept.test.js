// 0.8.3 M6 unit 2b (gate page Restore_Gap_Gate_Page.md sections 10, 12; C&C 14 Oct 2026): a CHANGED plan file is accepted by the session (with its reason) or a person, through ONE writer (acceptChangedPlan), and every reader of a node's plan then reads
// the body the RECORD accepts. Real all-mock trees, $0. Each table refusal is its OWN test() that goes through the real writer (the files on disk are real; nothing the writer computes is hand-written), so one red run against a stand-in table row
// that accepts everything shows each of them red on its own (the stand-in is a staged tree: see the report).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf, TreeRefusal } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { acceptChangedPlan, candidatePlanAccept } from '../src/tree-accept.js';
import { planAuthorityOf, transitionRefusal } from '../src/tree-transitions.js';
import { readNodePlan, readPlanOf } from '../src/tree-derive-load.js';
import { readinessOf } from '../src/tree-ready.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { treeStatusPayload } from '../src/mcp/tree-status.js';
import { treeBlock } from '../src/mcp/tree-block.js';
import { contractCheckOf } from '../src/run-contract-check.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren, splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { presenceProblems } from './helpers/event-presence.js';
import { sha256Of } from '../src/thin-contract.js';
import { GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';

const ADDED = '\nOne clarifying sentence the session added: the store keeps every record for a year.\n';
const KEY_URL = ['postgres', '://user:', 'pass', '@', 'db.internal', '/db'].join('');

async function finished() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
/** R/M1 with REGISTERED CHILDREN (the deep tree of tree-affected.test.js): a non-root node whose plan the children were derived from. */
async function finishedDeep() {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
const nodeOf = (r, node) => [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node);
const dirOf = (r, node) => join(r.t.runsDir, nodeOf(r, node).runId);
const planFile = (r, node) => join(dirOf(r, node), 'deliverable.md');
const sit = (r, start, over = {}) => runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0, ...over });
const stopsOf = (r, node) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === node);
const openIds = r => stateOf(readTreeRecord(r.t.rootDir)).openStops;
const accepted = r => eventsOf(r).filter(e => e.event === 'plan_accepted');
/** Edit the plan of `node` (prose appended), sit once so the stop opens, return { stop, original, edited }. */
async function changed(r, start, node, text = ADDED) {
  const original = readFileSync(planFile(r, node), 'utf8');
  const edited = original + text;
  writeFileSync(planFile(r, node), edited);
  await sit(r, start);
  const stop = stopsOf(r, node).at(-1);
  assert.ok(stop && openIds(r).includes(stop.id), `a stop is open for ${node}`);
  return { stop, original, edited };
}
const session = (r, stop, over = {}) => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'session', via: 'mcp', reason: 'one clarifying sentence; same obligations, same split', runsDir: r.t.runsDir, ...over });
const refusal = fn => { try { fn(); } catch (e) { if (e instanceof TreeRefusal) return e.reason; throw e; } assert.fail('no refusal'); };
const infoReasons = r => readinessOf(r.t.rootDir, { work: r.t.work }).reasons.filter(x => x.code === 'accepted_change');

test('REAL FLOW: a prose change to a leaf plan, accepted by the SESSION with its reason: ONE plan_accepted answers the stop; the node reads the ACCEPTED body, shows "accepted by the session (mcp), not signed by the panel" as an info note, and nothing blocks it', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop, original, edited } = await changed(r, start, 'R/M2');
  assert.deepEqual(stop.blockedBy.map(b => b.code).sort(), ['contract_check', 'plan_unreadable']);
  const before = nodeOf(r, 'R/M2').deliveredBodySha256;
  const out = session(r, stop);
  const ev = accepted(r);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].actor, ev[0].via, ev[0].stopId, ev[0].previousBodySha256, ev[0].acceptedBodySha256, ev[0].splitSha256, ev[0].scan], ['session', 'mcp', stop.id, before, sha256Of(edited), null, { keyFindings: 0, piiFindings: 0 }]);   // CHANGED ACCEPTED (19 Okt 2026): OLD piiFindings null ("not asked": a tree with no recorded mode). NEW 0: such a tree is asked as hard-stop and the plan held none.
  assert.equal(out.acceptedBodySha256, sha256Of(edited));
  assert.equal(openIds(r).includes(stop.id), false, 'the stop is answered');
  const n = nodeOf(r, 'R/M2');
  assert.equal(planAuthorityOf(n), sha256Of(edited)); assert.equal(n.deliveredBodySha256, sha256Of(edited)); assert.deepEqual(n.bodyHistory.map(h => [h.previous, h.accepted]), [[before, sha256Of(edited)]]);
  assert.notEqual(sha256Of(original), sha256Of(edited));
  // every reader: the record's hash for an accepted node, the report's own for the others
  assert.equal(readPlanOf(r.t.runsDir, n).plan?.text, edited, 'readPlanOf reads the accepted body');
  assert.equal(readNodePlan(dirOf(r, 'R/M2')).plan, null, 'the report-only read (no authority) does not read an edited plan: R7 is unchanged for a node with no accepted body');
  const next = await sit(r, start);
  assert.equal(stopsOf(r, 'R/M2').length, 1, 'no NEW stop: the readers are taught the accepted hash');
  assert.deepEqual(next.restored, []);
  const rd = readinessOf(r.t.rootDir, { work: r.t.work });
  assert.equal(rd.reasons.some(x => x.severity === 'blocked' && x.scope === 'R/M2@g1'), false, 'nothing blocks the accepted node');
  const info = infoReasons(r);
  assert.deepEqual(info.map(x => [x.severity, x.scope]), [['info', 'R/M2@g1']]);
  assert.match(info[0].text, /R\/M2@g1: its plan was accepted by the session \(mcp\), not signed by the panel/);
  assert.deepEqual(presenceProblems(ev), [], 'the presence audit covers plan_accepted');
  // the contract check: the tree's two callers hand the accepted hash; the person's raw command does not
  const raw = contractCheckOf(dirOf(r, 'R/M2'), { work: r.t.work });
  assert.equal(raw.exit, 1, 'the raw `council contract check` still says DRIFT for the edited file (Q-B7: true, and what a person running it should see)');
  const withAccepted = contractCheckOf(dirOf(r, 'R/M2'), { work: r.t.work, accepted: sha256Of(edited) });
  assert.equal(withAccepted.exit, 0, 'with the accepted hash the one delivered-text comparison holds as an outside comparison (never exit 2)');
  assert.ok(withAccepted.verdict.items.some(i => i.what === 'accepted text' && i.status === 'ok' && i.outside === true));
  const wrong = contractCheckOf(dirOf(r, 'R/M2'), { work: r.t.work, accepted: sha256Of(original) });
  assert.equal(wrong.exit, 1, 'a file that is not the accepted text drifts exactly as before');
});

test('the old text cannot be put back to pass: on an ACCEPTED node the bytes the panel signed read as unreadable (the record, not the report, is the authority), a NEW stop opens, and the sitting closes it again when the ACCEPTED bytes return (stop_restored against the accepted hash)', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop, original, edited } = await changed(r, start, 'R/M2');
  session(r, stop);
  await sit(r, start);
  writeFileSync(planFile(r, 'R/M2'), original);
  await sit(r, start);
  const stops = stopsOf(r, 'R/M2');
  assert.equal(stops.length, 2, 'the signed bytes no longer read for an accepted node: a new stop');
  assert.deepEqual(stops[1].blockedBy.map(b => b.code).includes('plan_unreadable'), true);
  writeFileSync(planFile(r, 'R/M2'), edited);
  const back = await sit(r, start);
  const restored = eventsOf(r).filter(e => e.event === 'stop_restored');
  assert.equal(restored.length, 1, 'the accepted bytes are back: the sitting closes the stop'); assert.equal(restored[0].deliveredBodySha256, sha256Of(edited));
  assert.equal(back.restored.length, 1);
});

test('REVERT ROUTE (nothing hard-locks): after an acceptance the panel-signed bytes are put back; the stop that opens is answered by plan_accepted with revert: the authority goes back to null and the node reads against report.json\'s own hash again', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop, original } = await changed(r, start, 'R/M2');
  session(r, stop);
  await sit(r, start);
  writeFileSync(planFile(r, 'R/M2'), original);
  await sit(r, start);
  const second = stopsOf(r, 'R/M2').at(-1);
  assert.ok(openIds(r).includes(second.id));
  const out = acceptChangedPlan(r.t.rootDir, { stopId: second.id, actor: 'session', via: 'mcp', reason: 'back to the text the panel signed', runsDir: r.t.runsDir });     // the writer sees the signed bytes on an accepted node: a revert, computed, not passed
  assert.equal(out.revert, true); assert.equal(out.acceptedBodySha256, sha256Of(original));
  const n = nodeOf(r, 'R/M2');
  assert.equal(planAuthorityOf(n), null, 'authority back to null'); assert.equal(n.deliveredBodySha256, n.closedBodySha256);
  assert.equal(n.bodyHistory.length, 2); assert.equal(n.bodyHistory[1].revert, true);
  assert.equal(readNodePlan(dirOf(r, 'R/M2')).plan?.text, original, 'read against the report\'s own hash');
  await sit(r, start);
  assert.equal(stopsOf(r, 'R/M2').length, 2, 'no further stop');
  assert.deepEqual(infoReasons(r), [], 'no accepted note any more');
  assert.match(refusal(() => acceptChangedPlan(r.t.rootDir, { stopId: stopsOf(r, 'R/M2').at(-1).id, actor: 'session', via: 'mcp', reason: 'again', runsDir: r.t.runsDir })), /is not an open stop/, 'a revert answers one open stop only');
});

test('TABLE: the SITTING never accepts a changed plan', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  assert.match(refusal(() => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'sitting', runsDir: r.t.runsDir })), /the sitting never accepts a changed plan/);
  assert.equal(accepted(r).length, 0);
});

test('TABLE: a session answer without its written reason is refused; so is one that names no channel', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  assert.match(refusal(() => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'session', via: 'mcp', runsDir: r.t.runsDir })), /carries its written reason/);
  assert.match(refusal(() => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'session', reason: 'because', runsDir: r.t.runsDir })), /names its channel/);
  assert.equal(accepted(r).length, 0);
});

test('TABLE: a person\'s acceptance carries the typed gate; with one it is recorded as the PERSON\'s (not the session\'s)', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  assert.match(refusal(() => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', runsDir: r.t.runsDir })), /carries the gate that was typed/);
  acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: GATE_FIELDS, runsDir: r.t.runsDir });
  assert.deepEqual(accepted(r).map(e => [e.actor, e.via, e.scan.keyFindings]), [['person', 'terminal', 0]]);
  assert.deepEqual(presenceProblems(accepted(r)), []);
});

// 2c (C&C 14 Oct 2026, condition 3): a scan finding refuses for EVERY actor. CHANGED ACCEPTED TESTS: 2b's 'a person's acceptance ... findings do not bar a person' and the session sentence 'a person accepts it, not the session' encoded the opposite.
test('TABLE: a key-shaped string in the changed plan is refused for the SESSION and for the PERSON alike, the shape named and never the value; the remedy is to edit the file', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2', `${ADDED}\nThe settings come from ${KEY_URL}.\n`);
  // CHANGED ACCEPTED (19 Okt 2026, no-mode trees are asked as hard-stop): OLD the sentence named the key-shaped string only. NEW the fixture's user:pass@host line is also read as personal data (email, secret), so the sentence may add ' and N personal-data findings (...)' and say 'them'.
  const sentence = /the changed plan holds 1 key-shaped string \(.+\)( and \d+ personal-data findings? \(.+\))?: the tree holds no plan that its own key and personal-data checks refuse\. Edit the file to remove (it|them) and ask again/;
  assert.match(refusal(() => session(r, stop)), sentence);
  assert.match(refusal(() => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: GATE_FIELDS, runsDir: r.t.runsDir })), sentence);
  assert.ok(!refusal(() => session(r, stop)).includes('db.internal'), 'the sentence names the shape, not the value');
  assert.equal(accepted(r).length, 0);
});

test('TABLE (the table\'s own guard for a hand-written event): scan counts above zero are refused for every actor with the table sentence', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  const c = candidatePlanAccept(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: GATE_FIELDS, runsDir: r.t.runsDir });
  assert.equal(c.refusal, undefined, 'a clean plan is accepted by every check');
  const state = stateOf(readTreeRecord(r.t.rootDir));
  for (const actor of ['session', 'person']) {
    const x = transitionRefusal(state, { ...c.event, actor, via: actor === 'session' ? 'mcp' : 'terminal', ...(actor === 'session' ? { reason: 'r' } : {}), scan: { keyFindings: 1, piiFindings: null } });
    assert.ok(x, `the table refuses a ${actor} acceptance whose scan counts are above zero`);
    assert.match(x.reason, /the changed plan has 1 key-scan and 0 personal-data finding\(s\): nothing is accepted that the tree's own key and personal-data checks refuse; edit the file and ask again/, actor);
  }
});

test('TABLE: a CHANGED SPLIT is refused for the PERSON too until unit 2e (the sentence names the two answers: a new plan, abandon)', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const { stop } = await changed(r, start, 'R/M2', `\n${planWith(b)}\n`);
  const why = refusal(() => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: GATE_FIELDS, runsDir: r.t.runsDir }));
  assert.match(why, /is not the split that was checked/); assert.match(why, /a new plan \(regenerate\) or abandon/);
  assert.equal(accepted(r).length, 0);
});

test('TABLE: a changed THIN CONTRACT pin (report.json edited as well as the plan) is not a body-only change: refused for every actor', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const rp = join(dirOf(r, 'R/M2'), 'report.json');
  const report = JSON.parse(readFileSync(rp, 'utf8')); report.thin_contract.sha256 = 'f'.repeat(64); writeFileSync(rp, JSON.stringify(report));
  const { stop } = await changed(r, start, 'R/M2');
  assert.match(refusal(() => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: GATE_FIELDS, runsDir: r.t.runsDir })), /the report itself was changed, not only the plan/);
});

test('TABLE: a SESSION never accepts a change to the ROOT\'s plan; a PERSON may (the root\'s children are registered, and the person is allowed)', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R');
  assert.match(refusal(() => session(r, stop)), /the root's plan is the person's/);
  acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: GATE_FIELDS, runsDir: r.t.runsDir });
  assert.equal(accepted(r).length, 1); assert.equal(accepted(r)[0].actor, 'person');
  await sit(r, start);
  assert.deepEqual(infoReasons(r).map(x => x.scope), ['R@g1'], 'the root reads as accepted, not signed by the panel');
});

test('TABLE (children row): a non-root node WITH registered children derived from its old plan is PERSON-ONLY: the session is refused with the children named, the person is not', { timeout: 600_000 }, async () => {
  const { r, start } = await finishedDeep();
  assert.ok([...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].some(n => n.node.startsWith('R/M1/')), 'R/M1 has registered children');
  const { stop } = await changed(r, start, 'R/M1');
  assert.match(refusal(() => session(r, stop)), /R\/M1@g1 has \d+ registered children? derived from its old plan \(.*\): a person accepts a change to it/);
  acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: GATE_FIELDS, runsDir: r.t.runsDir });
  assert.equal(accepted(r).length, 1);
});

test('TABLE (approved-frontier row): a node whose split\'s children are APPROVED but not registered yet (the approval was shown a preview built from its old plan; the children\'s bundles will quote sections of it) is PERSON-ONLY too', { timeout: 600_000 }, async () => {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);                                                                    // R/M1's frontier is approved; nothing of it is registered yet
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal([...st.nodes.values()].some(n => n.node.startsWith('R/M1/')), false, 'no child of R/M1 is registered');
  const { stop } = await changed(r, start, 'R/M1');
  assert.match(refusal(() => session(r, stop)), /the children of R\/M1@g1 were already approved \(.*\) on a preview built from its old plan, and their bundles quote sections of it: a person accepts a change to it/);
  acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: GATE_FIELDS, runsDir: r.t.runsDir });
  assert.equal(accepted(r).length, 1);
});

test('TABLE (dependents row): a node that registered siblings were REGISTERED AGAINST (they depend on its plan; their bundles quote what it provides and nothing re-reads a registered bundle) is PERSON-ONLY: the session is refused with the dependents named, the person is not', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const dependents = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].filter(n => (n.dependsOn ?? []).some(d => d.node === 'R/M1'));
  assert.ok(dependents.length >= 1, 'R/M2 was registered against R/M1 (it expects A1 from it)');
  const { stop } = await changed(r, start, 'R/M1');
  assert.match(refusal(() => session(r, stop)), /registered nodes? depends? on R\/M1@g1 \(R\/M2.*\) and were registered against its old plan: a person accepts a change to it/);
  acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: GATE_FIELDS, runsDir: r.t.runsDir });
  assert.equal(accepted(r).length, 1);
});

test('TABLE: an answer must name an OPEN blocked-child stop of that node (a stale or unknown id is refused, nothing is written)', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  session(r, stop);
  assert.match(refusal(() => session(r, stop)), /is not an open stop/);
  assert.match(refusal(() => acceptChangedPlan(r.t.rootDir, { stopId: 'e99999', actor: 'session', via: 'mcp', reason: 'x', runsDir: r.t.runsDir })), /is not an open stop/);
  assert.equal(accepted(r).length, 1);
});

test('LIBRARY: the session\'s written reason is scanned like any typed text: a key-shaped reason is refused and nothing is written', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  assert.match(refusal(() => session(r, stop, { reason: `see ${KEY_URL}` })), /reason holds a key-shaped or personal-data-shaped string/);
  assert.equal(accepted(r).length, 0);
});
