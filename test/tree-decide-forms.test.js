// `council tree decide` regenerate and `--milestone` (0.8.3 M5d, sub-commit 5; PLAN 8.4, 10.1; Q3): the decision text is typed at the terminal BEFORE the gate text is built. All-mock, $0. Stops are hand-appended
// (`needs_decision_opened`); M5e's detection replaces that shape. Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Of } from '../src/thin-contract.js';
import { TREE_DIR } from '../src/tree-record.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { DECISION_MAX_BYTES } from '../src/tree-decide-stop.js';
import { decideHandler } from '../src/tree-decide.js';
import { bundleDirOf } from '../src/tree-continuation.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { renderFrontierText } from '../src/tree-stop.js';
import { buildStopDecision } from '../src/tree-decide-stop.js';
import { TreeRefusal } from '../src/tree-record.js';
import { pricedChildren } from './helpers/child-chains.js';
import { GATE_FIELDS } from './helpers/tree-fixture.js';
import { recoverTree } from '../src/tree-recovery.js';
import { resumeHandler } from '../src/tree-resume.js';
import { trackedRealRoot, track } from './helpers/temp-trees.js';
import { block3, ownQuestions, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { runTree } from '../src/tree-run.js';
import { splitChildren } from './helpers/child-chains.js';
import { writeFileSync } from 'node:fs';
import { terminal } from './helpers/terminal.js';
import { assertBoundTextClean, dirty, dirtyMarked } from './helpers/bound-text.js';
import { parseTreeArgs } from '../src/tree-cli.js';
import { IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';

const decide = (rootDir, work, flags, answers, { onPrompt, tty } = {}) => {
  const io = terminal(answers, tty === false ? { tty: false } : {});
  if (onPrompt) io.stdout.on('data', d => { if (/\[y\/N\]/.test(String(d))) onPrompt(); });
  // a safety net: if a (mutated) form wrongly waits for more input, the terminal ends after 6 s instead of hanging the file
  const run = () => { const timer = setTimeout(() => io.stdin.end(), 6000); return decideHandler({ rootDir, rootId: ROOT_ID, flags, work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); };
  return { io, run };
};
const events = rootDir => readTreeRecord(rootDir).events;
const stopOf = (rootDir, extra = {}) => appendTreeEvent(rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'status', affected: [{ node: 'R/M1', generation: 1 }], ...extra });
/** The root plus a CLOSED child R/M1 (synthetic): a regenerate answers a CHILD's stop (the root is never regenerated, PLAN 8.4). */
const simple = () => {
  const t = closedRootTree({ cap: 50 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: 'needs_decision', share: 'revoked' });
  return t;
};
const childStop = (rootDir, extra = {}) => stopOf(rootDir, { node: 'R/M1', runId: IDS[0], ...extra });
const TEXT = 'We keep the old API.\nThe store stays SQLite.';

test('regenerate: the text is typed BEFORE the gate text, shown word for word; typing the stop id records decision_recorded { stopId, text, affected = the stop\'s set, form, gateId, shownSha256 } and NOTHING else; the stop\'s own marks clear', async () => {
  const t = simple(); const stop = childStop(t.rootDir);
  const d = decide(t.rootDir, t.work, {}, [`${TEXT}\n.`, stop.id, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const shown = d.io.shown();
  assert.ok(shown.indexOf('End it with a line holding only a dot') < shown.indexOf('Answer stop'), 'the decision is asked for first');
  assert.match(shown, new RegExp(`Answer stop ${stop.id} \\(status, R/M1@g1\\) with a new plan\\?`)); assert.ok(shown.includes(`----- decision -----\n${TEXT}\n----- end -----`)); assert.match(shown, /  - R\/M1@g1/);
  assert.match(shown, new RegExp(`To approve, type the stop id: ${stop.id}\\n`)); assert.match(shown, /Type the stop id shown in the last line above: /);
  const dec = events(t.rootDir).filter(e => e.event === 'decision_recorded'); assert.equal(dec.length, 1);
  assert.deepEqual([dec[0].text, dec[0].form, dec[0].stopId, dec[0].affected], [TEXT, 'regenerate', stop.id, [{ node: 'R/M1', generation: 1 }]]); assert.ok(dec[0].gateId); assert.match(dec[0].shownSha256, /^[0-9a-f]{64}$/);
  const file = join(t.rootDir, TREE_DIR, 'gate-texts', `tree_decide-${dec[0].shownSha256.slice(0, 16)}.txt`);
  assert.equal(sha256Of(readFileSync(file, 'utf8')), dec[0].shownSha256); assert.ok(readFileSync(file, 'utf8').includes(dec[0].text), 'the recorded text is inside the text the person read');
  const st = stateOf(readTreeRecord(t.rootDir)); assert.deepEqual([st.openStops.length, [...st.stale]], [0, ['R/M1@g1']], 'the stop is answered; a regenerate HOLDS its marks (the node is being replaced)');
  // EDITED in M6 S3b (disclosed; old: assert.equal(events(t.rootDir).at(-1).id, dec[0].id, 'the decision is the last event: nothing else was written')): a decision records the verdict after it (PLAN 9.2), so the last event is a `readiness` record and the decision is the one before it - nothing ELSE was written
  assert.deepEqual(events(t.rootDir).slice(-2).map(e => e.event), ['decision_recorded', 'readiness']); assert.equal(events(t.rootDir).at(-2).id, dec[0].id);
});

test('terminalSafe is applied once: a control character and a bidi mark in the typed text are gone from the recorded text AND the gate text, and the two agree', async () => {
  const t = simple(); const stop = childStop(t.rootDir);
  const d = decide(t.rootDir, t.work, {}, ['keep‮it\u0007 safe\n.', stop.id, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const dec = events(t.rootDir).find(e => e.event === 'decision_recorded'); assert.equal(dec.text, 'keepit safe');
  assert.equal(/[‮\u0007]/.test(readFileSync(join(t.rootDir, TREE_DIR, 'gate-texts', `tree_decide-${dec.shownSha256.slice(0, 16)}.txt`), 'utf8')), false);
});

test('Q3 refusals ask nobody and write nothing: empty or whitespace-only text; text over the cap (checked while reading; the cap is exact); no open stop; an unknown or ambiguous --stop; stdin that is not a terminal; the input ending before the dot', async () => {
  const t = simple(); const before = () => events(t.rootDir).length;
  const none = decide(t.rootDir, t.work, {}, []); assert.equal(await none.run(), 1); assert.match(none.io.errors(), /no stop is open: there is nothing to decide\. Nothing was asked and nothing was written\./); assert.equal(none.io.shown(), '', 'nobody was asked to type');
  const a = childStop(t.rootDir); const b = childStop(t.rootDir, { affected: [] }); const n = before();
  const amb = decide(t.rootDir, t.work, {}, []); assert.equal(await amb.run(), 1); assert.match(amb.io.errors(), /2 stops are open[^]*name the one this answers with --stop/); assert.equal(amb.io.shown(), '');
  const unk = decide(t.rootDir, t.work, { stop: 'e999' }, []); assert.equal(await unk.run(), 1); assert.match(unk.io.errors(), /--stop e999: that is not an open stop/);
  const notty = decide(t.rootDir, t.work, { stop: a.id }, [], { tty: false }); assert.equal(await notty.run(), 2); assert.match(notty.io.errors(), /typed at a terminal[^]*no flag or file for it/); assert.equal(before(), n);
  const empty = decide(t.rootDir, t.work, { stop: a.id }, ['\n.']); assert.equal(await empty.run(), 1); assert.match(empty.io.errors(), /the decision is empty/);
  const spaces = decide(t.rootDir, t.work, { stop: a.id }, ['   \n  \n.']); assert.equal(await spaces.run(), 1); assert.match(spaces.io.errors(), /the decision is empty/);
  const edge = 'x'.repeat(DECISION_MAX_BYTES);
  const over = decide(t.rootDir, t.work, { stop: a.id }, [`${edge}y\n.`]); assert.equal(await over.run(), 1); assert.match(over.io.errors(), new RegExp(`longer than ${DECISION_MAX_BYTES} bytes`));
  const exact = decide(t.rootDir, t.work, { stop: a.id }, [`${edge}\n.`, a.id, 'y']); assert.equal(await exact.run(), 0, exact.io.shown() + exact.io.errors());   // exactly the cap is allowed
  assert.equal(events(t.rootDir).find(e => e.event === 'decision_recorded').text.length, DECISION_MAX_BYTES);
  const t2 = simple(); const c = childStop(t2.rootDir);
  const eof = decide(t2.rootDir, t2.work, { stop: c.id }, ['no closing dot here']); const p = eof.run(); eof.io.stdin.end(); assert.equal(await p, 1); assert.match(eof.io.errors(), /the input ended before the closing line/);
  void b;
});

test('the typed step is the stop id; a wrong one, a decline write nothing; a stop answered while the person read means the yes is NOT used (the text is not asked again)', async () => {
  const t = simple(); const stop = childStop(t.rootDir); const other = childStop(t.rootDir, { affected: [] });
  const wrong = decide(t.rootDir, t.work, { stop: stop.id }, [TEXT + '\n.', other.id, 'y']); assert.equal(await wrong.run(), 1); assert.match(wrong.io.shown(), /That is not what the text asks you to type/);
  const no = decide(t.rootDir, t.work, { stop: stop.id }, [TEXT + '\n.', stop.id, 'n']); assert.equal(await no.run(), 1);
  assert.equal(events(t.rootDir).filter(e => e.event === 'decision_recorded').length, 0);
  const moved = decide(t.rootDir, t.work, { stop: stop.id }, [TEXT + '\n.', stop.id, 'y'], { onPrompt: () => appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'someone else answered', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: stop.id, gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' }) });
  assert.equal(await moved.run(), 1); assert.match(moved.io.errors(), /what you were shown has changed while you were reading it[^]*approval was NOT used/);
  assert.equal(events(t.rootDir).filter(e => e.event === 'decision_recorded').length, 1, 'only the other answer');
  assert.equal(moved.io.shown().split('Type your decision').length - 1, 1, 'the text was typed once and not asked again');
});

test('the text is never a flag: --text and its like are not options of `tree decide` (the parser refuses them); --obligation and --stop belong to the stop forms only', async () => {
  const t = simple(); const stop = childStop(t.rootDir);
  for (const f of ['--text', '--decision', '--message', '--changes-provides', '--yes', '--no']) assert.match(parseTreeArgs(['decide', 'r1', f, 'hello']).error ?? '', /not an option|no option approves anything/, f);
  const flags = f => decide(t.rootDir, t.work, f, []);
  const x = flags({ 'top-up': 'R/M1', amount: '1', stop: stop.id }); assert.equal(await x.run(), 2); assert.match(x.io.errors(), /--obligation and --stop belong to the stop forms/);
  const y = flags({ close: 'R/M1', obligation: 'R@g1:A1' }); assert.equal(await y.run(), 2);
});

// ----------------------------------------------------------------------------------------------------------------------- resolve in place (--milestone)
test('--milestone (resolve in place), real root whose split marks M5 needs-decision: a bare id that names exactly one milestone works; typing the qualified milestone id writes decision_recorded (form milestone, stop untouched) THEN milestone_resolved in one hold, the stop is answered and ITS marks cleared; recovery opens NO generation; `tree resume` neither', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot({});
  const stop = stopOf(r.t.rootDir, { affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] });
  const d = decide(r.t.rootDir, r.t.work, { milestone: 'M5' }, [`${TEXT}\n.`, 'R@g1:M5', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const shown = d.io.shown();
  assert.match(shown, /Resolve R@g1:M5 in place, answering stop /); assert.match(shown, /The milestone's question: Does the old API stay\?/); assert.match(shown, /Its basis: the owner has not said whether the old API stays/);
  assert.equal(shown.includes('Does this answer change anything'), false, 'the root provides to no sibling: it is not asked'); assert.equal(/Typing the milestone id/.test(shown), false, 'the old claim is gone'); assert.match(shown, /To approve, type the milestone id: R@g1:M5\n/);
  const ev = events(r.t.rootDir); const dec = ev.find(e => e.event === 'decision_recorded'); const res = ev.find(e => e.event === 'milestone_resolved');
  assert.deepEqual([dec.form, dec.stopId, dec.node, dec.generation, dec.milestone, dec.text, dec.affected], ['milestone', stop.id, 'R', 1, 'M5', TEXT, []]);
  assert.deepEqual([res.node, res.generation, res.milestone, res.decisionId], ['R', 1, 'M5', dec.id]); assert.equal('changesProvides' in res, false, 'the root: no field'); assert.equal(ev.indexOf(res), ev.indexOf(dec) + 1, 'back to back');
  const st = stateOf(readTreeRecord(r.t.rootDir)); assert.deepEqual([st.openStops.length, st.stale.size], [0, 0]);
  const calls = []; const io = terminal([]);
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), deps: { startRun: async () => { calls.push('start'); return { exitCode: 0 }; }, resumeRun: async () => { calls.push('resume'); return { exitCode: 0 }; } } });
  assert.equal(calls.length, 0, `code ${code}: ${io.shown()}${io.errors()}`); assert.equal(events(r.t.rootDir).some(e => e.event === 'generation_opened'), false, 'an in-place decision opens no generation');
  // already resolved: with another stop open, refused before anybody types
  stopOf(r.t.rootDir, { affected: [] });
  const again = decide(r.t.rootDir, r.t.work, { milestone: 'R@g1:M5' }, []); assert.equal(await again.run(), 1); assert.match(again.io.errors(), /R@g1:M5 is already resolved/); assert.equal(again.io.shown(), '');
});

test('--milestone: a ready milestone, an unknown one and a malformed one are refused before anybody types; an ambiguous bare id (M5 on R and on R/M1) lists the matches and changes nothing; the qualified id resolves exactly that one (PLAN 10.1)', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(ownQuestions(block3()), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));      // its OWN questions: a plan repeating the root's is refused and would carry a blocked stop of its own
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r, { 'R/M1': 'plan-a.md' }) });
  const stop = stopOf(r.t.rootDir, { node: 'R/M1' }); const n = events(r.t.rootDir).length;
  for (const [arg, re] of [['M4', /no needs-decision milestone of that name in this tree \(open: R@g1:M5, R\/M1@g1:M5\)/], ['Z9', /no needs-decision milestone/], ['R/M1:M5', /no needs-decision milestone/], ['M5', /is ambiguous: R@g1:M5, R\/M1@g1:M5; name one as <node>@g<n>:<id>\. Nothing was changed/]]) {
    const x = decide(r.t.rootDir, r.t.work, { milestone: arg }, []); assert.equal(await x.run(), 1, arg); assert.match(x.io.errors(), re, arg); assert.equal(x.io.shown(), '', `${arg}: nobody was asked to type`);
  }
  assert.equal(events(r.t.rootDir).length, n);
  const ob = decide(r.t.rootDir, r.t.work, { milestone: 'R/M1@g1:M5', obligation: 'R/M1@g1:ZZ' }, []); assert.equal(await ob.run(), 1); assert.match(ob.io.errors(), /R\/M1@g1 carries no obligation ZZ/); assert.equal(ob.io.shown(), '');
  const ok = decide(r.t.rootDir, r.t.work, { milestone: 'R/M1@g1:M5' }, ['no', 'Child decision.\n.', 'R/M1@g1:M5', 'y']); assert.equal(await ok.run(), 0, ok.io.shown() + ok.io.errors());
  const res = events(r.t.rootDir).find(e => e.event === 'milestone_resolved'); assert.deepEqual([res.node, res.milestone], ['R/M1', 'M5']);
  void stop;
});

test('R6 (Astra F9): a tree with an OPEN stop and nothing runnable exits 20 (stopped for a person), never 0, starts nothing, and the text names the stop and the command that answers it', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });                         // every child ran and closed
  const stop = stopOf(r.t.rootDir, { node: 'R/M3', runId: readTreeRecord(r.t.rootDir).events.find(e => e.event === 'node_registered' && e.node === 'R/M3').runId, affected: [{ node: 'R/M3', generation: 1 }] });
  const calls = []; const io = terminal([]);
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), deps: { startRun: async () => { calls.push('start'); return { exitCode: 0 }; }, resumeRun: async () => { calls.push('resume'); return { exitCode: 0 }; } } });
  assert.equal(calls.length, 0, 'nothing started');
  assert.equal(code, 20, `${io.shown()}${io.errors()}`);
  assert.match(io.shown(), new RegExp(`Open stop: ${stop.id}\\. Answer it with \`council tree decide ${ROOT_ID}\``));
});

test('R8 (Opus 3-4): the gate text of a --milestone resolution holds no control or bidi character from the plan\'s question (terminalSafe): the hashed text, the hash the decision kept and the screen are clean', async () => {
  const word = dirtyMarked('the old API', 4);
  const b = block3(); b.milestones[4] = { ...b.milestones[4], open_question: `Does ${word.raw} stay?` };
  const r = await trackedRealRoot({ plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  stopOf(r.t.rootDir, { affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] });
  const d = decide(r.t.rootDir, r.t.work, { milestone: 'M5' }, [`${TEXT}\n.`, 'R@g1:M5', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const dec = events(r.t.rootDir).find(e => e.event === 'decision_recorded');
  assertBoundTextClean({ rootDir: r.t.rootDir, shownSha256: dec.shownSha256, shown: d.io.shown(), word: `Does ${word.clean} stay?` });
});

test('R12 (Astra F2, Opus 1-4): a node whose split holds TWO needs-decision milestones keeps its stop open until the LAST one is resolved: the first answer records milestone_resolved with `remaining` and releases nothing, the second answers the stop and clears its marks', async () => {
  const b = block3(); b.milestones.push({ id: 'M6', status: 'needs-decision', basis: 'nobody has said whether exports stay', open_question: 'Do exports stay?' });
  const r = await trackedRealRoot({ plan: planWith(b, { extraMilestones: ['M6'], preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const stop = stopOf(r.t.rootDir, { affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] });
  const st = () => stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st().stale.has('R/M1@g1'), true, 'the fixture: the stop holds R/M1');
  const first = decide(r.t.rootDir, r.t.work, { milestone: 'R@g1:M5' }, [`${TEXT}\n.`, 'R@g1:M5', 'y']);
  assert.equal(await first.run(), 0, first.io.shown() + first.io.errors());
  assert.match(first.io.shown(), /R@g1:M6 is still unresolved: the stop stays open; nothing is released/);
  const res1 = events(r.t.rootDir).filter(e => e.event === 'milestone_resolved');
  assert.deepEqual(res1.map(e => [e.milestone, e.remaining]), [['M5', ['M6']]], 'the event says what is still unresolved');
  assert.deepEqual(st().openStops, [stop.id], 'the stop is STILL open');
  assert.equal(st().stale.has('R/M1@g1'), true, 'and its marks are still held');
  // the second milestone is still answerable (it used to find no stop)
  const second = decide(r.t.rootDir, r.t.work, { milestone: 'R@g1:M6' }, [`${TEXT}\n.`, 'R@g1:M6', 'y']);
  assert.equal(await second.run(), 0, second.io.shown() + second.io.errors());
  assert.equal(/still unresolved/.test(second.io.shown()), false, 'the last answer says nothing is left');
  assert.deepEqual(events(r.t.rootDir).filter(e => e.event === 'milestone_resolved').map(e => [e.milestone, e.remaining]), [['M5', ['M6']], ['M6', []]]);
  assert.deepEqual(st().openStops, [], 'the last answer answers the stop'); assert.equal(st().stale.size, 0, 'and releases its marks');
});

test('R12 with the root cover (CL-139): a root with two open own stops and two needs-decision milestones: the first answer releases nothing, the LAST answers EVERY open root stop in one bound decision', async () => {
  const b = block3(); b.milestones.push({ id: 'M6', status: 'needs-decision', basis: 'nobody has said whether exports stay', open_question: 'Do exports stay?' });
  const r = await trackedRealRoot({ plan: planWith(b, { extraMilestones: ['M6'], preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const s1 = stopOf(r.t.rootDir, { affected: [{ node: 'R', generation: 1 }] }); const s2 = stopOf(r.t.rootDir, { affected: [{ node: 'R', generation: 1 }] });
  const st = () => stateOf(readTreeRecord(r.t.rootDir));
  const first = decide(r.t.rootDir, r.t.work, { milestone: 'R@g1:M5' }, [`${TEXT}\n.`, 'R@g1:M5', 'y']);
  assert.equal(await first.run(), 0, first.io.shown() + first.io.errors());
  assert.match(first.io.shown(), /still unresolved: the stop stays open; nothing is released/); assert.deepEqual(st().openStops, [s1.id, s2.id], 'both root stops are still open');
  const second = decide(r.t.rootDir, r.t.work, { milestone: 'R@g1:M6' }, [`${TEXT}\n.`, 'R@g1:M6', 'y']);
  assert.equal(await second.run(), 0, second.io.shown() + second.io.errors());
  assert.match(second.io.shown(), /EVERY open stop of the root/); assert.deepEqual(st().openStops, [], 'the last answer covers both');
  assert.deepEqual(events(r.t.rootDir).filter(e => e.event === 'decision_recorded').map(e => e.covers ?? null), [[s2.id], [s2.id]].map(x => x), 'each decision names the other root stop it would cover');
});

test('R10(a) corrected in R12: a root with TWO own needs_decision stops and no obligation: the one resolution answers both and its text names them but claims no root_affected block (there is none)', async () => {
  const r = await trackedRealRoot({});
  const a = stopOf(r.t.rootDir, { affected: [{ node: 'R', generation: 1 }] }); const b = stopOf(r.t.rootDir, { affected: [{ node: 'R', generation: 1 }] });
  const d = decide(r.t.rootDir, r.t.work, { milestone: 'R@g1:M5' }, [`${TEXT}\n.`, 'R@g1:M5', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /the stops listed above are answered: their stale marks are cleared\./);
  assert.equal(/root_affected/.test(d.io.shown()), false, 'no block exists, so none is claimed lifted');
  assert.deepEqual(stateOf(readTreeRecord(r.t.rootDir)).openStops, [], `both stops (${a.id}, ${b.id}) are answered`);
});

test('R2 (M5 API reviews): a provider whose Status is needs_decision is NOT eligible while its needs-decision milestone is unresolved, and IS once the person resolved it in place (the one status policy of the readiness rule: needs_decision is allowed with a needs-decision milestone); its consumer is then chosen', { timeout: 400_000 }, async () => {
  const { providerEligibility } = await import('../src/tree-loop.js');
  const { chooseNextChild } = await import('../src/tree-loop.js');
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(ownQuestions(block3()), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));      // its OWN questions: a plan repeating the root's is refused and would carry a blocked stop of its own
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r, { 'R/M1': 'plan-a.md' }) });
  const file = join(r.t.rootDir, TREE_DIR, 'events.jsonl');
  writeFileSync(file, readFileSync(file, 'utf8').split('\n').map(l => (l.includes('"event":"node_closed"') && l.includes('"node":"R/M1"') ? l.replace(/"status":(null|"[a-z_]*")/, '"status":"needs_decision"') : l)).join('\n'));
  const view = () => { const record = readTreeRecord(r.t.rootDir); return { record, state: stateOf(record), runsDir: join(r.t.rootDir, '..'), work: r.t.work }; };
  assert.equal(events(r.t.rootDir).find(e => e.event === 'node_closed' && e.node === 'R/M1').status, 'needs_decision', 'the fixture: R/M1 ended needs_decision');
  const before = providerEligibility(view(), 'R/M1');
  assert.equal(before.eligible, false); assert.match(before.why.join(' | '), /R\/M1's milestone M5 needs a decision and none is recorded/);
  stopOf(r.t.rootDir, { node: 'R/M1' });
  const ok = decide(r.t.rootDir, r.t.work, { milestone: 'R/M1@g1:M5' }, ['no', 'Child decision.\n.', 'R/M1@g1:M5', 'y']); assert.equal(await ok.run(), 0, ok.io.shown() + ok.io.errors());
  const after = providerEligibility(view(), 'R/M1');
  // resolved in place: nothing about its Status or its needs-decision milestone is left (its decompose milestones still have no registered child in this fixture, which is a different wait)
  assert.deepEqual(after.why.filter(w => /needs_decision|needs a decision/.test(w)), [], JSON.stringify(after.why));
  assert.ok(after.why.every(w => /is not registered yet/.test(w)), JSON.stringify(after.why));
  const pick = chooseNextChild(r.t.rootDir, { work: r.t.work });
  assert.ok(!pick.waiting?.some(w => /ended with needs_decision/.test(w.why.join(' '))), `no consumer waits for R/M1's Status any more: ${JSON.stringify(pick.waiting)}`);
});

test('--obligation is validated by IDENTITY before anybody types (M5e S4): a malformed id, a node not in the tree, a root id the root\'s list does not hold (the old test accepted any well-formed root id) are refused; the positive paths (widening, root_affected) are in tree-decide-obligation.test.js', async () => {
  const t = simple(); childStop(t.rootDir);
  for (const [arg, re] of [['A1', /write it as <node>@g<n>:<id>/], ['R/M9@g1:C1', /R\/M9@g1 is not in this tree/], ['R@g9:C1', /R@g9 is not in this tree/], ['R@g1:A3', /the root's acceptance list holds nothing, not A3/], ['R/M1@g1:C9', /R\/M1@g1 carries no obligation C9/]]) {
    const x = decide(t.rootDir, t.work, { obligation: arg }, []); assert.equal(await x.run(), 1, arg); assert.match(x.io.errors(), re); assert.equal(x.io.shown(), '');
  }
});

test('the apply re-checks UNDER the tree lock before its first append: a milestone resolved, or a stop answered, between the rebuild and the lock is refused with no orphan decision_recorded', async () => {
  const r = await trackedRealRoot({});
  const s1 = stopOf(r.t.rootDir); const s2 = stopOf(r.t.rootDir, { affected: [] });
  const args = { rootDir: r.t.rootDir, rootId: ROOT_ID, form: 'milestone', milestoneArg: 'R@g1:M5', stopArg: s1.id, decisionText: 'A decision.' };
  const built = buildStopDecision(args); assert.equal(built.refusal, undefined);
  // someone else resolves the milestone (through stop s2) after the form was built
  const other = appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'resolved elsewhere', affected: [], form: 'milestone', stopId: s2.id, node: 'R', generation: 1, milestone: 'M5', ...GATE_FIELDS });
  appendTreeEvent(r.t.rootDir, { event: 'milestone_resolved', node: 'R', generation: 1, milestone: 'M5', decisionId: other.id });
  const n = events(r.t.rootDir).length;
  assert.throws(() => built.apply({ gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' }), e => e instanceof TreeRefusal && /R@g1:M5 is already resolved/.test(e.reason));
  assert.equal(events(r.t.rootDir).length, n, 'no orphan decision_recorded');
  // a stop answered after the build
  const t = simple(); const a = childStop(t.rootDir);
  const regen = buildStopDecision({ rootDir: t.rootDir, rootId: ROOT_ID, form: 'regenerate', stopArg: a.id, decisionText: 'x' });
  appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'answered first', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: a.id, ...GATE_FIELDS }); // EDITED in the M7 apply (C2a-record commit 2; old: `affected: []`; why: the table now binds a regenerate's list to the stop's recorded set, so a hand-written decision lists the node its stop recorded)
  const m = events(t.rootDir).length;
  assert.throws(() => regen.apply({ gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' }), e => e instanceof TreeRefusal && /is no longer open/.test(e.reason)); assert.equal(events(t.rootDir).length, m);
});

// M5e S5, THE FLIP (the "M5d interim" test, end to end): after a regenerate decision on a real tree the REPLACEMENT frontier waits for approval with the decision verbatim, the consumer waits, the independent child runs, and after
// the approval the replacement runs with the decision byte for byte in its context.md; then the consumer starts and pins the replacement.
test('M5e S5, the flip, end to end: a regenerate decision opens generation 2 of the affected node ONLY; `tree resume` says "approve" (exit 20), registers no replacement before the approval, keeps the consumer waiting and runs the independent child; the replacement frontier lists R/M1@g2 with the decision; after the approval R/M1@g2 runs with the decision BYTE FOR BYTE in context.md; then R/M2 starts pinning R/M1@g2; R/M1@g1 stays stale', { timeout: 500_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });                 // R/M1 closed
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'x', source: 'status', affected: [{ node: 'R/M1', generation: 1 }] });
  const DECISION = 'Start the storage plan again.\nKeep the record store SQLite.';
  const d = decide(r.t.rootDir, r.t.work, {}, [`${DECISION}\n.`, stop.id, 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.deepEqual([...stateOf(readTreeRecord(r.t.rootDir)).stale], ['R/M1@g1'], 'the stop is answered, its mark is HELD');
  const n = events(r.t.rootDir).length;
  const io = terminal([]);
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), deps: { startRun: draftStarter(r), resumeRun: async () => ({ exitCode: 0 }) } });
  assert.equal(code, 20, 'stopped for a person: the replacement waits for an approval\n' + io.shown() + io.errors());
  const added = events(r.t.rootDir).slice(n); const dec = events(r.t.rootDir).find(e => e.event === 'decision_recorded');
  assert.deepEqual([added[0].event, added[0].nodes], ['generation_opened', [{ node: 'R/M1', generation: 2 }]], 'the interrupted decision gets its generation first');
  assert.equal(added.some(e => e.event === 'node_registered' && e.node === 'R/M1'), false, 'no replacement is registered before its approval');
  assert.equal(added.some(e => e.event === 'node_registered' && e.node === 'R/M2'), false, 'the consumer of a node being replaced does NOT start');
  assert.deepEqual(added.filter(e => e.event === 'node_registered').map(e => e.node), ['R/M3'], 'the independent sibling goes on');
  assert.match(io.shown(), /NOT finished/); assert.match(io.shown(), /R\/M2 is held: provider K1: R\/M1 is stale: decision e\d+ is replacing it/);
  assert.match(io.shown(), new RegExp(`Being replaced by decision ${dec.id}: the replacement waits for your approval: run \`council tree approve`));
  // the replacement frontier
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.deepEqual([pending.children, pending.openedBy], [[{ node: 'R/M1', generation: 2 }], { id: dec.id, text: DECISION }]);
  const described = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(described.refusal, undefined, JSON.stringify(described.refusal));
  assert.deepEqual(described.view.children.map(c => [c.node, c.generation, c.admitted, c.registered]), [['R/M1', 2, true, null]], 'a FRESH admission, not "already registered"'); assert.ok(described.view.children[0].grant > 0);
  assert.deepEqual(described.view.openedBy, [{ id: dec.id, text: DECISION }]); assert.ok(DECISION.split('\n').every(l => renderFrontierText(described.view).includes(`      | ${l}`)), 'the approval text shows the decision word for word (every line, quoted)');
  const gens = events(r.t.rootDir).filter(e => e.event === 'generation_opened'); assert.equal(gens.length, 1);
  // approve it, run: the replacement starts with the decision in its context.md, byte for byte
  const ap = approvePending(r); assert.equal(ap.frontierKey, pending.key);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out.status, 'nothing_to_do', JSON.stringify(out)); assert.deepEqual(out.started.map(x => x.node), ['R/M1', 'R/M2']);
  const reg = events(r.t.rootDir).filter(e => e.event === 'node_registered');
  assert.deepEqual(reg.filter(e => e.node === 'R/M1').map(e => e.generation), [1, 2]);
  const context = readFileSync(join(bundleDirOf(r.t.rootDir, 'R/M1', 2), 'context.md'), 'utf8');
  assert.ok(context.includes(`----- decision ${dec.id} -----\n${DECISION}\n----- end -----`), 'the decision, byte for byte');
  const r2 = reg.find(e => e.node === 'R/M2'); assert.deepEqual(r2.dependsOn.map(x => [x.node, x.generation]), [['R/M1', 2]], 'the consumer pins the REPLACEMENT');
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.stale.has('R/M1@g1'), true, 'the replaced generation stays stale for good: nothing is released'); assert.equal(st.stale.size, 1); assert.equal(st.sticky.size, 0);
  assert.equal(st.nodes.get('R/M1@g2').phase, 'closed'); assert.equal(st.nodes.get('R/M2@g1').phase, 'closed');
});

// ----------------------------------------------------------------------------------------------------------------------- PLAN 8.4: what a stopped child provides, and whose stop a resolution answers
test('PLAN 8.4: for a stopped CHILD the form asks "Does this answer change anything <node> provides to a sibling? (yes/no)" BEFORE the text; "yes" refuses (regenerate form), nothing asked, no gate, nothing written; only yes/no (any case) counts; "no" goes into the hashed gate text and onto milestone_resolved (changesProvides false); it is asked once', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(ownQuestions(block3()), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));      // its OWN questions: a plan repeating the root's is refused and would carry a blocked stop of its own
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r, { 'R/M1': 'plan-a.md' }) });
  stopOf(r.t.rootDir, { node: 'R/M1' });
  const gateDir = join(r.t.rootDir, TREE_DIR, 'gate-texts'); const gates = () => (existsSync(gateDir) ? readdirSync(gateDir).length : 0);
  const n = events(r.t.rootDir).length; const g = gates();
  const flags = { milestone: 'R/M1@g1:M5' };
  const yes = decide(r.t.rootDir, r.t.work, flags, ['yes']); assert.equal(await yes.run(), 1);
  assert.match(yes.io.errors(), /this changes what R\/M1 provides: use the regenerate form \(council tree decide /); assert.match(yes.io.errors(), /No gate was requested and nothing was written\.$/m); assert.equal(yes.io.shown().includes('Type your decision'), false, 'no text was asked after a yes');
  for (const bad of ['y', '', 'maybe', 'nope']) { const x = decide(r.t.rootDir, r.t.work, flags, [bad]); assert.equal(await x.run(), 1, JSON.stringify(bad)); assert.match(x.io.errors(), /must be yes or no|ended before the question/); assert.equal(x.io.shown().includes('Type your decision'), false); }
  const eof = decide(r.t.rootDir, r.t.work, flags, []); const p = eof.run(); eof.io.stdin.end(); assert.equal(await p, 1);
  assert.equal(events(r.t.rootDir).length, n, 'nothing written'); assert.equal(gates(), g, 'no gate was requested');
  const ok = decide(r.t.rootDir, r.t.work, flags, [' NO ', 'Child decision.\n.', 'R/M1@g1:M5', 'y']); assert.equal(await ok.run(), 0, ok.io.shown() + ok.io.errors());
  const shown = ok.io.shown();
  assert.equal(shown.split('provides to a sibling? (yes/no): ').length - 1, 1, 'the question is asked once, not again after the yes'); assert.equal(/Typing the milestone id/.test(shown), false);
  assert.ok(shown.indexOf('(yes/no): ') < shown.indexOf('Type your decision'), 'the question comes before the text');
  const res = events(r.t.rootDir).find(e => e.event === 'milestone_resolved'); assert.equal(res.changesProvides, false);
  const after = stateOf(readTreeRecord(r.t.rootDir)); assert.deepEqual([after.openStops.length, [...after.stale]], [0, []], 'row 8: the "no" answer RELEASES the stop\'s marks (R/M1 is free again)');
  const dec = events(r.t.rootDir).find(e => e.event === 'decision_recorded');
  const file = readFileSync(join(gateDir, `tree_decide-${dec.shownSha256.slice(0, 16)}.txt`), 'utf8'); assert.equal(sha256Of(file), dec.shownSha256);
  assert.match(file, /Does this answer change anything R\/M1 provides to a sibling\? You answered: no\./, 'the answer is inside the hashed text');
});

test('PLAN 8.4: a resolution in place answers ONLY the stop of the node whose split holds the milestone: another node\'s open stop is refused before any gate, --stop naming it is refused, two stops of the same node need --stop; the table enforces the same binding and a stopped child\'s resolution must carry changesProvides false', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(ownQuestions(block3()), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));      // its OWN questions: a plan repeating the root's is refused and would carry a blocked stop of its own
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r, { 'R/M1': 'plan-a.md' }) });
  const rootStop = stopOf(r.t.rootDir); const n = events(r.t.rootDir).length;                         // an open stop of R; the milestone is R/M1's
  const none = decide(r.t.rootDir, r.t.work, { milestone: 'R/M1@g1:M5' }, []); assert.equal(await none.run(), 1); assert.match(none.io.errors(), /no open stop of R\/M1@g1, the node whose split holds the milestone/); assert.equal(none.io.shown(), '');
  const named = decide(r.t.rootDir, r.t.work, { milestone: 'R/M1@g1:M5', stop: rootStop.id }, []); assert.equal(await named.run(), 1); assert.match(named.io.errors(), /that is the stop of R@g1; a milestone is resolved in place only through the stop of R\/M1@g1/);
  assert.equal(events(r.t.rootDir).length, n);
  const a = stopOf(r.t.rootDir, { node: 'R/M1' }); const b = stopOf(r.t.rootDir, { node: 'R/M1' });
  const two = decide(r.t.rootDir, r.t.work, { milestone: 'R/M1@g1:M5' }, []); assert.equal(await two.run(), 1); assert.match(two.io.errors(), new RegExp(`2 stops are open of R/M1@g1[^]*${a.id}[^]*${b.id}[^]*--stop`)); assert.equal(two.io.errors().includes(rootStop.id + ' ('), false, 'only that node\'s stops are listed');
  // the table: a milestone decision names the stop of its own node; a stop with no node cannot be bound
  const bare = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', source: 'integration' });
  for (const sid of [rootStop.id, bare.id]) assert.throws(() => appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'x', affected: [], form: 'milestone', stopId: sid, node: 'R/M1', generation: 1, milestone: 'M5', ...GATE_FIELDS }), e => e instanceof TreeRefusal && /answers only the stop of R\/M1@g1/.test(e.reason));
  const ok = appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', text: 'x', affected: [], form: 'milestone', stopId: a.id, node: 'R/M1', generation: 1, milestone: 'M5', ...GATE_FIELDS });
  const res = f => appendTreeEvent(r.t.rootDir, { event: 'milestone_resolved', node: 'R/M1', generation: 1, milestone: 'M5', decisionId: ok.id, ...f });
  assert.throws(() => res({}), e => e instanceof TreeRefusal && /changesProvides false/.test(e.reason), 'a bare resolution of a stopped child');
  assert.throws(() => res({ changesProvides: true }), e => e instanceof TreeRefusal && /regenerate form, not a resolution in place/.test(e.reason));
  assert.equal(res({ changesProvides: false }).event, 'milestone_resolved');
});

test('item 7 (2b), site 1: the decision text a PERSON types is refused when it holds a hidden character (naming the code; no gate, nothing written); the soft hyphen and a joiner stay allowed', async () => {
  const t = simple(); const stop = childStop(t.rootDir); const n = events(t.rootDir).length;
  const gates = () => { const d = join(t.rootDir, TREE_DIR, 'gate-texts'); return existsSync(d) ? readdirSync(d).length : 0; };
  const g0 = gates();
  const bad = decide(t.rootDir, t.work, { stop: stop.id }, [`keep${String.fromCodePoint(0x200B)}it\n.`, stop.id, 'y']);
  assert.equal(await bad.run(), 1, bad.io.shown() + bad.io.errors());
  assert.match(bad.io.errors(), /the decision holds an invisible character \(U\+200B\) that you cannot see on the screen; type it again without it\. No gate was requested and nothing was written\./);
  assert.equal(events(t.rootDir).length, n, 'nothing was recorded'); assert.equal(gates(), g0, 'and no gate text was written');
  const ok = decide(t.rootDir, t.work, { stop: stop.id }, [`co${String.fromCodePoint(0xAD)}operate${String.fromCodePoint(0x200D)} please\n.`, stop.id, 'y']);
  assert.equal(await ok.run(), 0, ok.io.shown() + ok.io.errors());
  const dec = events(t.rootDir).find(e => e.event === 'decision_recorded');
  assert.ok(dec.text.includes(String.fromCodePoint(0xAD)), 'the quiet characters are recorded as typed');
  assert.ok(readFileSync(join(t.rootDir, TREE_DIR, 'gate-texts', `tree_decide-${dec.shownSha256.slice(0, 16)}.txt`), 'utf8').includes('[U+00AD]'), 'and the gate text shows where they sit');
});
