// 0.8.4 round 1, held fix R3: a run that ended EARLY at the session's proposal with NO objection standing in the record is not told as "open objections". Through the real CLI, $0 (test/helpers/early-ladder-run.js: the ladder chain, every judge a mock, the
// writer external): leg P1 = every judge signs off, the handler says not yet, the revise carries the EARLY-FINISH line, the overseer layer says yes: nothing is open (signed_text.open_objections 0; the dispute record has no list: it did not run).
// The four readers: the run state (finishedRunState), the banner of HANDOFF.md, the reason the run's own handoff PROMPT gives its seat, and the banner the `council handoff --from-run` reader builds from the report (finishedState). The headline's
// count ("0 open objection(s) go to the builder") is a count, not the finished-with-open-objections claim, and is not one of them.
// What tells the case apart (not a wording pin): where nothing stands, none of the four says "open objections"; where something stands, all four do. Controls: leg P2 (3 objections stand: the same four keep today's words), and the report of leg P1 with ONE field swapped
// (open_objections 2; the dispute record listing one that stands; a late finding standing: then "nothing stands" does not hold and today's words stay).
import test from 'node:test';
import assert from 'node:assert/strict';
import { earlyLadderRun } from './helpers/early-ladder-run.js';
import { finishedRunState } from '../src/run-status.js';
import { finishedState } from '../src/handoff-from-run.js';
import * as CH from '../src/chain.js';
const { earlyTasksFromReport, withBuilderTasks } = CH;
import * as EM from '../src/ending-matrix.js';   // the case reader is looked up by name so the file also loads over a tree that has not got it (the red run reads the tip's source)
const { agreedOf } = EM;

const LEGS = { P1: () => 'mock-exch-support-keep-clean', P2: l => (l === 1 ? 'mock-exch-support-keep-always-sev5' : 'mock-exch-support-keep-clean') };
const ran = {};
const leg = k => (ran[k] ??= earlyLadderRun({ name: `enp-${k.toLowerCase()}`, critic: LEGS[k] }));
const OPEN = /open objections/;
const stateOf = r => finishedState({ passed: agreedOf(r), outcome: r.outcome, delivered_text: r.delivered_text, ending_word: r.ending_word, at_once: EM.finishedAtOnceCase?.(r) });
const bannerLines = w => w.handoffMd.split('\n').slice(0, 3).join('\n');
const promptLine = w => w.handoffPrompt.split('\n')[0];
const tasksSection = w => { const i = w.handoffMd.indexOf('## Builder tasks left open at the early finish'); return i < 0 ? '' : w.handoffMd.slice(i, w.handoffMd.indexOf('## Before you build', i)); };

function premise(w, open) {
  assert.ok(w.report, `premise: the run wrote report.json (steps ${JSON.stringify(w.steps)})`);
  assert.equal(w.report.stop?.kind, 'early_finish', 'premise: the run ended early');
  assert.equal(w.report.signed_text.open_objections, open, 'premise: the count at the end');
  assert.ok(w.handoffMd.startsWith('> **Not a signed-off plan.**'), 'premise: the not-signed-off banner');
  assert.ok(w.handoffPrompt && w.handoffPrompt.includes('early_finish'), 'premise: the handoff prompt carries the ending line');
}

test('R3 (the run state): an early finish with nothing standing in the record does not say "open objections"', () => {
  const w = leg('P1'); premise(w, 0);
  assert.equal(w.report.dispute?.open_objections, undefined, 'premise: the dispute record has no list');
  assert.doesNotMatch(finishedRunState(w.report), OPEN);
});
test('R3 (the banner of HANDOFF.md): the same run: the banner reason is not "finished with open objections"', () => {
  const w = leg('P1'); premise(w, 0);
  assert.doesNotMatch(bannerLines(w), /finished with open objections/);
});
test('R3 (the handoff prompt): the same run: the reason the handoff seat is given is not "finished with open objections"', () => {
  const w = leg('P1'); premise(w, 0);
  assert.doesNotMatch(promptLine(w), /finished with open objections/);
});
test('R3 (--from-run): the banner built from the report of the same run is not "finished with open objections", and it is the reason the run itself gave', () => {
  const w = leg('P1'); premise(w, 0);
  assert.doesNotMatch(stateOf(w.report).reason, OPEN);
  assert.ok(promptLine(w).includes(`(${stateOf(w.report).reason})`), 'the report reader and the run wrote one reason');
});

test('R3 (the builder-tasks section of HANDOFF.md): with nothing standing it does not say that objections are open below it', () => {
  const w = leg('P1'); premise(w, 0);
  const sec = tasksSection(w);
  assert.ok(sec.length > 0, 'premise: the section that says how the run ended is written');
  assert.doesNotMatch(sec, /^- BT-/m, 'premise: it lists no task');
  assert.doesNotMatch(sec, /Each objection below is still open/);
});
test('R3 (--from-run): the handoff rebuilt from the report has the same builder-tasks section as the run\'s own HANDOFF.md for the same record', () => {
  const w = leg('P1'); premise(w, 0);
  const tasks = earlyTasksFromReport?.(w.report);   // no premise on its shape: over the tip's source it is null (the rebuilt handoff has no such section) and the equality below is where this fails
  const fromRun = tasks ? withBuilderTasks('X', tasks) : 'X';
  const sec = fromRun.includes('## Builder tasks left open') ? fromRun.slice(fromRun.indexOf('## Builder tasks left open')) : '';
  assert.equal(sec.trimEnd(), tasksSection(w).trimEnd());
});

test('R3 (the early ask over an empty list): the ask the overseer layer was shown does not speak of objections below it or of the last pass\'s objections', () => {
  const w = leg('P1'); premise(w, 0);
  assert.ok(w.asks.length > 0, 'premise: the ask was sent');
  assert.doesNotMatch(w.asks[0].text, /^- O-/m, 'premise: it lists no objection');
  assert.doesNotMatch(w.asks[0].text, /hand the objections below to the builder|Every objection of the last pass|with these objections as tasks/);
});

test('R3 controls (leg P2, 3 objections stand): the same four readers keep "open objections"', () => {
  const w = leg('P2'); premise(w, 3);
  assert.match(finishedRunState(w.report), /^done: open objections/);
  assert.match(bannerLines(w), /finished with open objections/);
  assert.match(promptLine(w), /finished with open objections/);
  assert.equal(stateOf(w.report).reason, 'finished with open objections');
  assert.match(tasksSection(w), /Each objection below is still open/, 'the builder-tasks section keeps its lead, with the rows it speaks of');
});   // (what the ask lists when objections of earlier passes stand is the new behaviour of test/early-finish-open-record.test.js, not a control)
test('R3 controls (leg P1\'s report, one field swapped): a count above 0, or a dispute entry that stands, keeps today\'s words', () => {
  const base = leg('P1').report;
  const two = structuredClone(base); two.signed_text.open_objections = 2;
  assert.match(finishedRunState(two), /^done: open objections/);
  assert.equal(stateOf(two).reason, 'finished with open objections');
  const listed = structuredClone(base); listed.dispute = { ...listed.dispute, open_objections: [{ id: 'O-0a0a0a0a', lab: 'x' }] };
  assert.equal(stateOf(listed).reason, 'finished with open objections', 'a dispute entry that stands: the count alone does not decide');
});
test('R3 (leg P1\'s report, one field swapped): a dispute entry the closing read closed does not stand; where a late finding stands, nothing stands is not claimed and today\'s words stay', () => {
  const base = leg('P1').report;
  const closed = structuredClone(base); closed.dispute = { ...closed.dispute, open_objections: [{ id: 'O-0a0a0a0a', lab: 'x', closed_by: 'final_read' }] };
  assert.doesNotMatch(stateOf(closed).reason, OPEN, 'a dispute entry the closing read closed does not stand');
  const late = structuredClone(base); late.late_findings = [{ id: 'L-12345678' }];
  assert.equal(stateOf(late).reason, 'finished with open objections', 'a late finding that stands: the one fact of "nothing stands" does not hold, so the old reason stays');
  assert.match(finishedRunState(late), /^done: open objections/);
});
test('R3 (the builder-task section, C&C 80296ad3): the empty variant is written only where nothing stands; with a late finding standing and no task there is no section; the run\'s own writer and the rebuilt one decide the same way', () => {
  const base = leg('P1').report;
  const late = structuredClone(base); late.late_findings = [{ id: 'L-12345678' }];
  assert.equal(earlyTasksFromReport(late), null, 'a late finding stands, no task: the rebuilt handoff has no section');
  const closed = structuredClone(base); closed.dispute = { ...closed.dispute, open_objections: [{ id: 'O-0a0a0a0a', lab: 'x', closed_by: 'final_read' }] };
  assert.equal(earlyTasksFromReport(closed), null, 'the closing read closed every task: no section, as before (S8 c3)');
  assert.deepEqual(earlyTasksFromReport(base), [], 'nothing stands: the empty variant');
  const one = structuredClone(base); one.signed_text.open_objections = 1; one.dispute = { ran: true, open_objections: [{ id: 'O-0a0a0a0a', lab: 'x', criterion: 'c', problem: 'p' }] };
  assert.equal(earlyTasksFromReport(one).length, 1, 'a task that stands: the section with it');
  const counted = structuredClone(base); counted.signed_text.open_objections = 2;
  assert.equal(earlyTasksFromReport(counted), null, 'a count above 0 with no listed task: no section (the lead would speak of rows that are not there)');
  // the run's own writer: the same decision, called with the same fact
  const write = (tasks, r, closedAny = false) => CH.earlyTasksToWrite?.(tasks, EM.finishedEarlyNothingOpen(r), closedAny);
  assert.equal(write([], late), null, 'the run\'s own handoff: a late finding stands, no task: no section');
  assert.deepEqual(write([], base), [], 'the run\'s own handoff: nothing stands: the empty variant');
  assert.equal(write(null, counted), null, 'the run\'s own handoff: a count above 0 with no task: no section');
  assert.equal(write([], closed, true), null, 'the run\'s own handoff: the closing read closed every task: no section');
});
