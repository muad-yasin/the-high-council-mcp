// 0.8.3 M6 (owner's yes, Muad 11 Oct 2026: "I'd say yes to the stop"; rulings row 116, CHANGELOG CL-151): a CHILD that has closed and that the readiness rule blocks at node level opens a needs_decision stop on that child, opened
// in the sitting's afterStep BEFORE the verdict is recorded; the person answers it with the regenerate form of `council tree decide --stop <id>`, which opens a NEW GENERATION (admitted under maxRuns; attemptsPerChild is not the
// route). Children only; one OPEN stop per node@generation (an answered stop holds nothing back). Real all-mock trees on the milestone mock, $0. THE RULE (C&C, rulings rows 124-125): every blocked-severity reason at a closed child's own scope
// opens it, plus closed_incomplete; there is no exception (the owner's yes on no_milestone_lint, row 128) (src/tree-blocked-child.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, stateOf, readTreeRecord } from '../src/tree-record.js';
import { sittingLines } from '../src/tree-resume.js';
import { decideHandler } from '../src/tree-decide.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { renderFrontierText } from '../src/tree-stop.js';
import { runTree, stopHandler } from '../src/tree-run.js';
import { readinessOf } from '../src/tree-ready.js';
import { openBlockedChildStops } from '../src/tree-blocked-child.js';
import { gateTree } from '../src/tree-budget.js';
import { lastReadinessOf } from '../src/tree-readiness.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren, splitChildren, splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const A1 = 'R@g1:A1';
async function finished(over = {}) {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }), ...over });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
/** Edits a node's report.json (the way a bad handoff lint would arrive), returning the restore function. */
function editReport(r, node, fn) {
  const n = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node);
  const file = join(r.t.runsDir, n.runId, 'report.json'); const original = readFileSync(file, 'utf8');
  const rep = JSON.parse(original); fn(rep); writeFileSync(file, JSON.stringify(rep));
  return () => writeFileSync(file, original);
}
const withFinding = rep => { rep.handoff_milestones = { ...rep.handoff_milestones, findings: [{ kind: 'unknown_criterion', message: 'M0 names C3' }] }; };
const blockedStops = r => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked');
const sitting = (r, start, over = {}) => runTree(r.t.rootDir, { work: r.t.work, startRun: start, ...over });
const decideStop = async (r, stopId, text = 'Regenerate this child.') => {
  const io = terminal([`${text}\n.`, stopId, 'y']);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stopId }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 0, io.shown() + io.errors());
};

test('(a) a child closed with a lint finding opens a blocked stop (source blocked, blockedBy status_policy, its closure, never the root); the recorded verdict already carries it; regenerate answers it, the new generation runs and closes ready', async () => {
  const { r, start } = await finished();
  assert.deepEqual(blockedStops(r), [], 'a healthy tree opens none');
  editReport(r, 'R/M2', withFinding);
  const out = await sitting(r, start);
  const [stop] = blockedStops(r);
  assert.equal(blockedStops(r).length, 1);
  assert.deepEqual([stop.node, stop.generation, stop.blockedBy.map(b => b.code)], ['R/M2', 1, ['status_policy']]);
  assert.ok(stop.affected.some(a => a.node === 'R/M2') && !stop.affected.some(a => a.node === 'R'), JSON.stringify(stop.affected));
  assert.equal(out.status, 'held_by_stop'); assert.deepEqual(out.stops.map(s => s.id), [stop.id], 'the sitting reports the stop it opened');
  assert.match(out.stops[0].text, /Stop e\d+: R\/M2 generation 1 finished, and the tree cannot count it:\n {2}- status_policy: R\/M2@g1: handoff Status/);
  assert.ok(out.stops[0].text.includes(`regenerate what it affects (a new generation of R/M2): council tree decide ${ROOT_ID} --stop ${stop.id}`), 'the route is the exact command, and it is the one this test runs');
  const rd = lastReadinessOf(readTreeRecord(r.t.rootDir));
  assert.ok(rd.reasons.some(x => x.code === 'open_stop') && rd.reasons.some(x => x.code === 'status_policy'), 'the stop was opened BEFORE the verdict was recorded: the recorded verdict carries it');
  await decideStop(r, stop.id);
  await sitting(r, start, { maxStarts: 0 });                                    // recovery opens the generation
  assert.ok(eventsOf(r).some(e => e.event === 'generation_opened'));
  approvePending(r); await sitting(r, start);
  const m2 = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].filter(n => n.node === 'R/M2').map(n => [n.generation, n.phase]);
  assert.deepEqual(m2, [[1, 'closed'], [2, 'closed']]);
  const v = readinessOf(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(v.reasons.map(x => [x.code, x.scope]), [['integration_unrecorded', A1]], 'R/M2@g2 closed ready: the only thing left is the agreement');
});

test('(b) the regenerate is a NEW GENERATION admitted under maxRuns, not a second attempt: attempt stays 1; at the run limit the replacement is "not admitted: run limit" and the person is shown the raise hint', async () => {
  const { r, start } = await finished({ limits: { maxDepth: 2, maxRuns: 4, maxChildrenPerSplit: 4, attemptsPerChild: 1 } });
  editReport(r, 'R/M2', withFinding);
  await sitting(r, start);
  const [stop] = blockedStops(r);
  await decideStop(r, stop.id);
  await sitting(r, start, { maxStarts: 0 });
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending, 'a replacement frontier waits');
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  const m2 = d.view.children.find(c => c.node === 'R/M2');
  assert.deepEqual([m2.generation, m2.admitted, m2.refusedLimit], [2, false, 'maxRuns'], 'R + 3 children = 4 runs: a fifth is the limit stop, not an attempt');
  assert.match(m2.notAdmittedReason, /run limit/);
  assert.ok(renderFrontierText(d.view).includes('A limit can be raised only by you'), 'and the raise hint is printed (a limit refusal)');
  assert.equal(eventsOf(r).filter(e => e.event === 'node_registered' && e.node === 'R/M2').every(e => e.attempt === 1), true, 'no node was ever registered as attempt 2');
});

test('(c) a second sitting opens no second stop for the same node@generation - not while it is open, not after it is answered', async () => {
  const { r, start } = await finished();
  editReport(r, 'R/M2', withFinding);
  await sitting(r, start);
  await sitting(r, start); await sitting(r, start);
  assert.equal(blockedStops(r).length, 1, 'open: still one');
  await decideStop(r, blockedStops(r)[0].id);
  // the window between the decision and the generation it opens: the old generation is still the newest and is still blocked, but it is being replaced - nothing is opened for it
  assert.deepEqual(openBlockedChildStops(r.t.rootDir, { verdict: readinessOf(r.t.rootDir, { work: r.t.work }) }), [], 'a node being replaced gets no second stop');
  await sitting(r, start, { maxStarts: 0 }); await sitting(r, start, { maxStarts: 0 });
  assert.equal(blockedStops(r).length, 1, 'answered by regenerate: still one (the node moved to generation 2, which is not blocked)');
});

test('(d) a blocked ROOT opens a stop too (S8 G9; old: no stop, "the tree ends blocked with the reason shown"): source blocked, node R, answered by a NEW ROOT plan; the sitting ends held_by_stop and names the route', async () => {
  const { r, start } = await finished();
  editReport(r, 'R', withFinding);
  const out = await sitting(r, start);
  const [stop] = blockedStops(r);
  assert.deepEqual([stop.node, stop.generation, stop.blockedBy.map(b => b.code)], ['R', 1, ['status_policy']], 'the stop of the root, for its blocked reason');
  const v = readinessOf(r.t.rootDir, { work: r.t.work });
  assert.equal(v.verdict, 'blocked'); assert.ok(v.reasons.some(x => x.code === 'status_policy' && x.scope === 'R@g1'));
  assert.equal(out.status, 'held_by_stop'); assert.deepEqual(out.blockedStopIds.includes(stop.id), true);
  assert.deepEqual(out.rootBlocked.map(b => b.code), ['status_policy'], 'the sitting still reports the root\'s reasons');
  const lines = sittingLines(out, ROOT_ID).join('\n');
  assert.ok(lines.includes(`The ROOT is blocked (status_policy). A stop is open for it: answer it with a new root plan, \`council tree decide ${ROOT_ID}\` (add --stop <id> when more than one stop is open).`), lines);
  const screen = out.stops.find(x => x.id === stop.id)?.text ?? '';
  assert.ok(screen.includes(`answer it with a NEW ROOT plan: council tree decide ${ROOT_ID} --stop ${stop.id}`), screen);
  assert.equal(blockedStops(r).length, 1, 'idempotent: a second sitting opens no second stop');
  await sitting(r, start, { maxStarts: 0 });
  assert.equal(blockedStops(r).length, 1);
});


test('NO EXCEPTION (the owner\'s yes on no_milestone_lint, rulings row 128): a child that records NO lint opens the stop too (blockedBy no_milestone_lint) - it was the documented exception of b13359a, and this assertion is the one that flipped', async () => {
  const { r, start } = await finished();
  editReport(r, 'R/M3', rep => { delete rep.handoff_milestones; });
  await sitting(r, start);
  assert.deepEqual(blockedStops(r).map(e => [e.node, e.blockedBy.map(b => b.code)]), [['R/M3', ['no_milestone_lint']]]);
  assert.ok(readinessOf(r.t.rootDir, { work: r.t.work }).reasons.some(x => x.code === 'no_milestone_lint' && x.scope === 'R/M3@g1'), 'and readiness blocks it, as before');
});

test('(e) a node a person closed incomplete (`decide --close`) had NO route to a replacement; it opens the stop now, and the regenerate answer opens its new generation', async () => {
  const { pricedChildren } = await import('./helpers/child-chains.js');
  const { registerNextChild } = await import('../src/tree-loop.js');
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  assert.equal(registerNextChild(r.t.rootDir, { work: r.t.work }).node, 'R/M1');
  const io = terminal(['R/M1', 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { close: 'R/M1' }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr }), 0, io.shown() + io.errors());
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const [stop] = blockedStops(r);
  assert.deepEqual([stop.node, stop.blockedBy.map(b => b.code)], ['R/M1', ['closed_incomplete']]);
  await decideStop(r, stop.id);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });
  assert.ok(eventsOf(r).some(e => e.event === 'generation_opened' && e.nodes.some(n => n.node === 'R/M1' && n.generation === 2)), 'R/M1 has a generation 2 to run');
});

test('(f) the REAL sequence for the key: a child ends Status needs_decision with a disallowed finding; its status stop is open, so no blocked stop is opened beside it; resolved in place with --milestone the node stays at g1 and is still status_policy-blocked, so the blocked stop opens on the NEXT step (an answered stop holds nothing back), and while it is open no second one opens; the end text then gives the regenerate sentence only', async () => {
  // this child is handed a plan with a split block, so its handoff prompt (about 2100 tokens with the milestone request) projects over the 4.00 ceiling a 2000-token assumption gives (the ceiling finding, rulings row 126): the chain declares the larger assumed prompt
  const nd = needsDecisionChildren(); nd.extraChains['nd-debate'].estimate = { promptTokens: 1500, draftTokens: 1500, critiqueTokens: 300 };
  const r = await trackedRealRoot(nd); approvePending(r);
  const own = block3(); for (const m of own.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;      // its own questions: the expansion is not refused
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(own, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await sitting(r, start, { maxStarts: 1 });
  const statusStop = eventsOf(r).find(e => e.event === 'needs_decision_opened' && e.node === 'R/M1');
  assert.equal(statusStop.source, 'node_closed', 'the close of a needs_decision child opened its own stop (detection, source node_closed)');
  editReport(r, 'R/M1', rep => { rep.handoff_milestones = { status: 'needs_decision', findings: [{ kind: 'unknown_criterion', message: 'M0 names C3' }] }; });
  await sitting(r, start, { maxStarts: 0 });
  assert.deepEqual(blockedStops(r), [], 'the status stop is OPEN: no blocked stop beside it');
  const io = terminal(['no', 'The old API stays.\n.', 'R/M1@g1:M5', 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { milestone: 'R/M1@g1:M5', stop: statusStop.id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(statusStop.id), false, 'the status stop is answered in place');
  await sitting(r, start, { maxStarts: 0 });
  const [stop] = blockedStops(r);
  assert.equal(blockedStops(r).length, 1, 'the next step opened the blocked stop');
  assert.deepEqual([stop.node, stop.generation, stop.blockedBy.map(b => b.code)], ['R/M1', 1, ['status_policy']]);
  await sitting(r, start, { maxStarts: 0 });
  const out = await sitting(r, start);                                           // a genuine sitting: it ends held_by_stop (a capped one ends limit_reached and prints no stop line)
  assert.equal(blockedStops(r).length, 1, 'open: no duplicate');
  assert.equal(out.status, 'held_by_stop');
  assert.deepEqual(out.blockedStopIds, [stop.id], 'the sitting result names the blocked stop apart from other open stops');
  const lines = sittingLines(out, ROOT_ID).join('\n');
  assert.ok(lines.includes(`Blocked-child stop ${stop.id}: answer it with \`council tree decide ${ROOT_ID} --stop ${stop.id}\` (a new generation of the child).`), lines);
  // R/M3 (independent, same fixture) ended needs_decision too: ITS open stop legitimately gets the generic sentence; the blocked stop must not be in it
  const generic = lines.split('\n').filter(l => /resolve in place with --milestone/.test(l));
  assert.equal(generic.length, 1, lines); assert.equal(generic[0].includes(stop.id), false, 'a blocked stop is never told "resolve in place"');
});

test('(g) THE RULE, generically: report_unreadable and expansion_refused are on no list, and each opens a blocked stop on its child (blockedBy names exactly that code)', async () => {
  const { r, start } = await finished();
  const n = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === 'R/M2');
  writeFileSync(join(r.t.runsDir, n.runId, 'report.json'), '{ not json');
  await sitting(r, start, { maxStarts: 0 });
  assert.deepEqual(blockedStops(r).map(e => [e.node, e.blockedBy.map(b => b.code)]), [['R/M2', ['report_unreadable']]]);
  const q = await trackedRealRoot(splitChildren()); approvePending(q);
  writeFileSync(join(q.t.work, 'plan-a.md'), planWith(block3(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));      // its open questions repeat the root's: the expansion is refused (no frontierKey: nothing to re-approve)
  const start2 = draftStarter(q, { 'R/M1': 'plan-a.md' });
  await sitting(q, start2); await sitting(q, start2, { maxStarts: 0 });
  assert.deepEqual(blockedStops(q).map(e => [e.node, e.blockedBy.map(b => b.code)]), [['R/M1', ['expansion_refused']]]);
});

test('(h) report_unreadable: what THIS commit does, pinned (rulings row 129, PLAN section 12 row 7): the stop opens and its screen says to restore the report first; regenerate opens generation 2; the replacement cannot be approved while the accounting gate fails (the superseded folder is still read); `decide --accounting` cannot accept an unreadable record; `tree stop` still works. If the owner later lets an acceptance cover it, this test is edited with disclosure', async () => {
  const { r, start } = await finished();
  const n = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === 'R/M2');
  writeFileSync(join(r.t.runsDir, n.runId, 'report.json'), '{ not json');
  const out = await sitting(r, start, { maxStarts: 0 });
  const [stop] = blockedStops(r);
  assert.deepEqual(stop.blockedBy.map(b => b.code), ['report_unreadable']);
  const screen = out.stops.find(x => x.id === stop.id).text;
  assert.ok(screen.includes('Restore the report.json of R/M2 first: the accounting gate reads every run folder, so regenerating cannot go on (the replacement cannot be approved) while that file does not read. If it cannot be restored, `council tree decide ' + ROOT_ID + ' --accounting R/M2` accepts, as a typed decision, the figure the usage files beside it give: the tree then counts at least that for R/M2.'), screen);
  assert.equal(screen.includes('in place: council tree decide'), false, 'and no in-place route is offered for a blocked stop');
  await decideStop(r, stop.id);
  await sitting(r, start, { maxStarts: 0 });
  assert.ok(eventsOf(r).some(e => e.event === 'generation_opened' && e.nodes.some(x => x.node === 'R/M2' && x.generation === 2)), 'regenerate opened generation 2');
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.deepEqual([d.refusal.check, d.refusal.field], ['accounting', 'accounting gate'], JSON.stringify(d.refusal));
  assert.match(d.refusal.detail, /the accounting gate fails: report_unreadable \(report\.json not valid JSON\)/);
  // answer 1 (the Muad-approved recommendation, 12 Oct): the usage files beside the unreadable report give a figure, so a person can ACCEPT it, by a typed decision, and the replacement can be approved
  const before = gateTree(r.t.rootDir);
  const spentBefore = before.treeSpentUsd;
  const io = terminal(['R/M2', 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { accounting: 'R/M2' }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  assert.match(io.shown(), /Restoring the report\.json is the better fix\. Accepting instead records that YOU accept the figure above/);
  assert.match(io.shown(), /the tree counts at least \$[0-9.]+ for it, built from [0-9]+ files? beside the report/);
  assert.match(io.shown(), /The cross-tree spend line \(`council --spend`\) reads the run folders alone and can show less for this one run/);
  const accepted = eventsOf(r).filter(e => e.event === 'accounting_accepted').at(-1);
  assert.ok(accepted.reservationIds.includes(`${n.runId}:report.json`));
  assert.equal(accepted.unreadableReports.length, 1); assert.equal(accepted.unreadableReports[0].runId, n.runId);
  assert.ok(accepted.unreadableReports[0].files.length > 0 && accepted.unreadableReports[0].files.every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
  const after = gateTree(r.t.rootDir);
  assert.equal(after.ok, true, JSON.stringify(after.problems));
  assert.equal(after.treeSpentUsd, spentBefore, 'accepting changes no number: the figure was already counted');
  const d2 = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.equal(d2.refusal, undefined, JSON.stringify(d2.refusal));
  const stopIo = terminal([]);
  assert.equal(await stopHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, stdout: stopIo.stdout, stderr: stopIo.stderr, now: () => Date.now() }), 0, 'a person can still stop the tree');
});

test('(i) a provider with a blocked stop: its consumer never registers (the stop\'s affected set is the mechanism, eligibility the second reader): R/M1 closes alone, a finding blocks it, the stop names R/M2 as affected, and no sitting afterwards registers R/M2 while the independent R/M3 still runs', async () => {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r); const start = draftStarter(r);
  await sitting(r, start, { maxStarts: 1 });                                                // R/M1 only
  const phases = () => Object.fromEntries([...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].map(x => [x.node, x.phase]));
  assert.equal(phases()['R/M1'], 'closed'); assert.equal(phases()['R/M2'], undefined, 'the consumer waits for its provider');
  editReport(r, 'R/M1', withFinding);
  await sitting(r, start); await sitting(r, start);
  const [stop] = blockedStops(r);
  assert.deepEqual([stop.node, stop.blockedBy.map(x => x.code)], ['R/M1', ['status_policy']]);
  assert.ok(stop.affected.some(a => a.node === 'R/M2'), `the stop's affected set names the consumer: ${JSON.stringify(stop.affected)}`);
  assert.equal(phases()['R/M2'], undefined, 'R/M2 never registered');
  assert.equal(phases()['R/M3'], 'closed', 'while the independent sibling ran');
});

test('--milestone on a blocked stop is REFUSED naming the regenerate form, and writes nothing (a hand-appended blocked stop on a node with an unresolved needs-decision milestone: the real sequence cannot produce that pair, because an open stop of any source holds the key)', async () => {
  const r = await trackedRealRoot(splitChildren()); approvePending(r);
  const own = block3(); for (const m of own.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(own, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  await sitting(r, draftStarter(r, { 'R/M1': 'plan-a.md' }), { maxStarts: 1 });
  const node = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === 'R/M1');
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: node.runId, source: 'blocked', blockedBy: [{ code: 'status_policy', text: 'x' }], affected: [{ node: 'R/M1', generation: 1 }] });
  const before = eventsOf(r).length;
  const io = terminal([]); io.stdin.end();
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { milestone: 'R/M1@g1:M5', stop: stop.id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 1); assert.match(io.errors(), new RegExp(`stop ${stop.id} is a blocked-child stop: it has one answer, a new generation of the child: \`council tree decide ${ROOT_ID} --stop ${stop.id}\`\\. Nothing was changed`));
  assert.equal(io.shown(), '', 'nobody was asked to type'); assert.equal(eventsOf(r).length, before, 'nothing was written');
});
