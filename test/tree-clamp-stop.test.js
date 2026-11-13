// 0.8.4 base reds (test-only; Builder B): THE STOP THAT THE STATUS CLAMP LEAVES A CHILD THAT DID NOT AGREE.
// Since efe7f4fc (D29, src/handoff-status.js) a run that did not agree cannot say ready_for_build or partial in its HANDOFF.md: the harness replaces the word with needs_decision and records that it did
// (report.json handoff_milestones.status_set_by_harness). A tree child reads that Status (src/tree-member.js closedPartsOf), so it closes with needs_decision, and src/tree-detect.js opens a `node_closed` stop
// for it, not a `blocked` one. test/handoff-status-clamp.test.js pins the closing FIELDS; nothing pinned the STOP. This file pins it, on a real all-mock tree ($0), with the fixture of
// test/tree-blocked-child.test.js (f) (trackedRealRoot + splitMilestoneChildren + a draft for R/M1 that carries a split block with the needs-decision milestone M5), except that the draft is NOT signed.
// WHAT IT PINS (today's behaviour, not a requirement): (1) the stop's source is node_closed and no blocked stop stands beside it; (2) the closing event says not_passed and needs_decision, and report.json keeps the
// seat's own word beside the harness's (status ready_for_build, status_set_by_harness needs_decision); (3) the printed choices carry no KEEP line and `--keep` is refused for it ("a finished, passed run");
// (4) the one in-place answer a not-agreed child can have, `--milestone`, answers the stop but does NOT make the child count as ready: the next step opens the blocked-child stop (not_passed) and the verdict stays not ready.
// LIMIT: a pin shows what the code does now. It fails if the clamp stops reaching the tree, if KEEP starts accepting a run that did not agree, or if an in-place answer starts clearing not_passed.
// PREDICTIONS (not run when written): that the unsigned plan's split block is read for its milestones (openMilestones reads the node's deliverable); if it is not, the milestone assertions fail and that is a finding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateOf, readTreeRecord } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { openMilestones } from '../src/tree-decide-stop.js';
import { runTree } from '../src/tree-run.js';
import { needsDecisionStopText } from '../src/tree-stop-view.js';
import { readinessOf } from '../src/tree-ready.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const blockedStops = r => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === 'R/M1');      // scoped to the child under test: the default root plan may open stops of its own elsewhere
const sitting = (r, start, over = {}) => runTree(r.t.rootDir, { work: r.t.work, startRun: start, ...over });

/** A real tree whose R/M1 is handed an UNSIGNED plan (no marker preface: the mock critics do not sign it) with a split block holding the needs-decision milestone M5; one sitting runs R/M1 only. */
async function notAgreedChild() {
  const children = splitMilestoneChildren();
  children.extraChains['split-ms-child'].estimate = { promptTokens: 1500, draftTokens: 1500, critiqueTokens: 300 };      // as (f): the child's handoff prompt carries the milestone request, so the chain declares the larger assumed prompt
  const r = await trackedRealRoot(children); approvePending(r);
  const own = block3(); for (const m of own.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;      // its own questions: the expansion is not refused
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(own));                                                              // NO preface: unsigned
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  const out = await sitting(r, start, { maxStarts: 1 });
  const stop = eventsOf(r).find(e => e.event === 'needs_decision_opened' && e.node === 'R/M1');
  return { r, start, out, stop };
}

test('CLAMP-STOP-1: a child that did not agree and whose seat said ready_for_build closes needs_decision: ONE node_closed stop, no blocked stop beside it, the record says the harness set the Status, no KEEP among the choices, --keep refused', async () => {
  const { r, stop } = await notAgreedChild();
  assert.ok(stop, `R/M1 opened a stop: ${JSON.stringify(eventsOf(r).map(e => e.event))}`);
  assert.equal(stop.source, 'node_closed');
  assert.equal(stop.blockedBy, undefined, 'a node_closed stop carries no blockedBy');
  assert.deepEqual(blockedStops(r), [], 'no blocked stop stands beside it (on R/M1)');
  // (2) the closing event and the record
  const closed = eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R/M1');
  assert.deepEqual([closed.outcome, closed.passed, closed.status], ['not_passed', false, 'needs_decision']);
  const n = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === 'R/M1');
  const rep = JSON.parse(readFileSync(join(r.t.runsDir, n.runId, 'report.json'), 'utf8'));
  assert.deepEqual([rep.handoff_milestones.status, rep.handoff_milestones.status_set_by_harness], ['ready_for_build', 'needs_decision'], 'the seat\'s own word stays on the record; the harness says it set the Status');
  // (3) the printed choices
  const text = needsDecisionStopText(r.t.rootDir, stop);      // the very text the sitting prints for this stop (src/tree-stop-view.js)
  assert.ok(text.includes(`council tree decide ${ROOT_ID} --stop ${stop.id}`), text);
  assert.equal(text.includes('--keep'), false, `no KEEP line is printed for a child that did not agree:\n${text}`);
  const eventsBefore = eventsOf(r).length;
  const t = terminal(['The result stands.\n.', 'R/M1@g1', 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { keep: 'R/M1@g1' }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.notEqual(code, 0, t.shown() + t.errors());
  assert.match(t.shown() + t.errors(), /is not a finished, passed run that ended needs_decision/);
  assert.equal(eventsOf(r).length, eventsBefore, 'the refused keep wrote nothing');
  assert.ok(stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), 'and the stop is still open');
});

test('CLAMP-STOP-2: the in-place answer (--milestone) answers the stop but does not make the child count as ready: the next step opens the blocked-child stop (not_passed) and the verdict stays not ready', async () => {
  const { r, start, stop } = await notAgreedChild();
  assert.ok(stop && stop.source === 'node_closed', JSON.stringify(stop));
  const rec = readTreeRecord(r.t.rootDir);
  assert.deepEqual(openMilestones(rec, stateOf(rec), r.t.runsDir).filter(m => m.node === 'R/M1' && !m.resolved).map(m => m.key), ['R/M1@g1:M5'], 'PREDICTION: the unsigned plan\'s split block is read, so M5 is an open needs-decision milestone');
  const io = terminal(['no', 'The old API stays.\n.', 'R/M1@g1:M5', 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { milestone: 'R/M1@g1:M5', stop: stop.id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), false, 'the stop is answered in place');
  await sitting(r, start, { maxStarts: 0 });
  const [blocked] = blockedStops(r);
  assert.equal(blockedStops(r).length, 1, 'the next step opened the blocked-child stop: an answered stop holds nothing back');
  assert.deepEqual([blocked.node, blocked.generation], ['R/M1', 1]);
  assert.ok(blocked.blockedBy.some(b => b.code === 'not_passed'), JSON.stringify(blocked.blockedBy));
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.accepted.has('R/M1@g1'), false, 'nothing reads as approved: R/M1@g1 is not accepted');
  assert.equal(eventsOf(r).some(e => e.event === 'decision_recorded' && e.form === 'keep'), false, 'and no keep decision was recorded');
  assert.equal(eventsOf(r).some(e => e.event === 'plan_accepted'), false, 'and no plan acceptance was recorded');
  assert.equal(st.nodes.get('R/M1@g1').acceptedBy ?? null, null, 'R/M1@g1 carries no plan acceptance (the field planAuthorityOf and the stop view read)');
  const v = readinessOf(r.t.rootDir, { work: r.t.work });
  assert.notEqual(v.verdict, 'ready');
  assert.ok(v.reasons.some(x => x.code === 'not_passed' && x.scope === 'R/M1@g1'), JSON.stringify(v.reasons.map(x => [x.code, x.scope])));
});
