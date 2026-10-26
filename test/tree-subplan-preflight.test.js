// SG-1 REFINED (C&C thcmcp-cd, 23 Okt 2026, "a node with no process is NOT active for SG-1"; the original question: CnC_M7_Lists.md:175): a sub-plan regenerate is refused BEFORE the person types (the root route's shape, rootReplanPreflight) while
// (1) a sitting of the tree holds its lock (it could pick up an approved frontier and start a registered child while the record sets it aside; the terminal AND the MCP session route) or (2) a node at or under a listed one has a PROCESS (running or in a
// post-run call). A registered, never-started node has no process: regenerating its parent sets it aside as dead. The table row refuses the running race again at the record.
// Rows: (P1) a sitting holds the lock: the terminal verb refuses before any typing and the session's quote refuses, nothing recorded; (P2) a RUNNING descendant is refused before typing, nothing written; (P3) a registered, never-started descendant is
// NOT refused: the decision records; (P4) the table still refuses a hand-made record that lists a RUNNING descendant dead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { affectedFor } from '../src/tree-affected.js';
import { registerNextChild } from '../src/tree-loop.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { bundleDirName } from '../src/tree-continuation.js';
import { decideHandler } from '../src/tree-decide.js';
import { runFactsOfIn, runTree } from '../src/tree-run.js';
import { recoverTree } from '../src/tree-recovery.js';
import { acquireRunLock } from '../src/run-lock.js';
import { SITTING_LOCK_FILE } from '../src/tree-files.js';
import { deadKeys, subplanAffectedWanted } from '../src/tree-transitions.js';
import { sittingFacts } from '../src/tree-stop-view.js';
import { bundleAllowanceBytesOf, budgetOf } from '../src/tree-budget.js';
import { newPlanInputBytes } from '../src/tree-decide-size.js';
import { oldPlanOf } from '../src/old-plan.js';
import { treeDecideResult } from '../src/mcp/tree-decide.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { GATE_FIELDS, ROOT_ID, claim, hostnameOf } from './helpers/tree-fixture.js';

/** The fixture block of tree-replace.test.js (oldBlock): R/M1 splits into children K1..M3 and M5 is ready. */
function oldBlock() {
  const b = block3();
  for (const m of b.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  return b;
}
const TEXT = 'The retention rule changes: keep records for 90 days.';
/** R/M1 is closed with its split; R/M1/M1 is REGISTERED (never started); `running` starts it (a live claim); a stop of R/M1 is open. */
async function stoppedWithChild({ running = false, gone = false } = {}) {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(oldBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r, { 'R/M1': 'plan-a.md' }) });
  approvePending(r);                                                                                 // R/M1's own frontier
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([reg.kind, reg.node], ['registered', 'R/M1/M1'], 'a descendant of R/M1 is registered');
  if (running || gone) appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim('R/M1/M1', stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1/M1@g1').runId, gone ? 2147483000 : process.pid, 1, hostnameOf()) });
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: state.nodes.get('R/M1@g1').runId, source: 'status', affected: affectedFor({ record, state, runsDir: r.t.runsDir, node: 'R/M1' }).affected });
  return { r, stop };
}
const decide = (r, io) => decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: {}, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
const decisions = r => eventsOf(r).filter(e => e.event === 'decision_recorded');
const decideWith = (r, flags, io) => decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });

test('P1 a sitting holds the lock: the terminal verb refuses BEFORE any typing and the session\'s quote refuses; nothing is recorded', { timeout: 300_000 }, async () => {
  const { r, stop } = await stoppedWithChild();
  const lock = acquireRunLock(treeDirOf(r.t.rootDir), { file: SITTING_LOCK_FILE });       // this process holds it: a sitting is running
  try {
    const io = terminal([]);
    const timer = setTimeout(() => io.stdin.end(), 8000);       // never reached: the refusal comes before the prompt
    const code = await decide(r, io).finally(() => clearTimeout(timer));
    assert.equal(code, 1, io.shown() + io.errors());
    assert.match(io.errors(), /a sitting of this tree is running: nothing was changed; wait for it to end/);
    assert.doesNotMatch(io.shown(), /Type your decision/, 'refused before the person typed');
    const q = JSON.parse(treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: ROOT_ID, step: 'quote', form: 'regenerate', stop: stop.id, text: TEXT, reason: 'the retention rule changed', planMode: 'fresh' } }).content[0].text);
    assert.match(q.error ?? '', /a sitting of this tree is running/, JSON.stringify(q));
  } finally { lock(); }
  assert.deepEqual(decisions(r), [], 'nothing was recorded');
});

test('P2 a RUNNING descendant is refused BEFORE the person types, and nothing is written (the preflight; the table row of 21f960f stays behind it)', { timeout: 300_000 }, async () => {
  const { r } = await stoppedWithChild({ running: true });
  const events0 = eventsOf(r).length;
  const io = terminal([]);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decide(r, io).finally(() => clearTimeout(timer));
  assert.equal(code, 1, io.shown() + io.errors());
  assert.match(io.errors(), /node R\/M1\/M1 is active: a sub-plan regenerate never races a running node/);
  assert.doesNotMatch(io.shown(), /Type your decision/, 'refused before the person typed');
  assert.equal(eventsOf(r).length, events0, 'the preflight writes nothing at all');
});

test('P3 a registered, NEVER-STARTED descendant has no process: the regenerate is not refused, the decision records and the descendant is set aside', { timeout: 300_000 }, async () => {
  const { r, stop } = await stoppedWithChild();
  // CHANGED (oversize unit, C&C thcmcp-cd 23 Okt 2026: sub-plan regenerate refused AT DECIDE when the new input is over the allowance; the same change is accepted in tree-replace.test.js:64). OLD: decided with no flag. NEW: `fresh: true`. WHY: the earlier plan is offered as data by default (a5d818f) and this fixture's approvals are priced for 4000 bytes: with the earlier plan the new input is about 5,646 bytes, so the decision is now refused at decide, which is not what this row tests.
  const io = terminal([`${TEXT}\n.`, stop.id, 'y']);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideWith(r, { fresh: true }, io).finally(() => clearTimeout(timer));
  assert.equal(code, 0, io.shown() + io.errors());
  const d = decisions(r);
  assert.equal(d.length, 1);
  assert.ok(d[0].affected.some(a => a.node === 'R/M1/M1'), 'the never-started descendant is listed with the set-aside nodes');
});

test('P4 the table still refuses a hand-made record that lists a RUNNING descendant dead (the preflight is not the only guard)', { timeout: 300_000 }, async () => {
  const { r, stop } = await stoppedWithChild({ running: true });
  const state = stateOf(readTreeRecord(r.t.rootDir));
  let why = null;
  try { appendTreeEvent(r.t.rootDir, { event: 'decision_recorded', form: 'regenerate', stopId: stop.id, affected: subplanAffectedWanted(state, stop.id), text: TEXT, oldPlan: { form: 'fresh' }, ...GATE_FIELDS }); } catch (e) { why = e.reason ?? e.message; }
  assert.match(String(why), /node R\/M1\/M1 is active: a sub-plan regenerate never races a running node/);
  assert.deepEqual(decisions(r), []);
});

test('P5 a node the record says runs whose process is GONE is still refused (the phase decides) but the refusal says so and names the two ways out, before the person types', { timeout: 300_000 }, async () => {
  const { r } = await stoppedWithChild({ gone: true });
  const events0 = eventsOf(r).length;
  const io = terminal([]);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decide(r, io).finally(() => clearTimeout(timer));
  assert.equal(code, 1, io.shown() + io.errors());
  assert.match(io.errors(), /node R\/M1\/M1 is marked running but its process is gone/);
  assert.ok(io.errors().includes(`council tree decide ${ROOT_ID} --close R/M1/M1@g1`) && io.errors().includes(`if its run already ended, \`council tree resume ${ROOT_ID}\` records how it ended first`), io.errors());
  assert.doesNotMatch(io.shown(), /Type your decision/);
  assert.equal(eventsOf(r).length, events0, 'nothing was written');
});

// (d) racingRefusalOf (C&C thcmcp-cd 23 Okt 2026, GO; A-DRAFT words): the PHASE still decides (a node the record says runs is refused whatever its process does), the WORDS follow what `--close` can really do (src/tree-close.js activeNodeWords, shared with the root
// re-plan's preflight). Every real entry (the terminal verb, MCP tree_decide quote and answer) goes through buildStopDecision, whose preflight is this one; the table row only meets a hand-made record.
// (P7) a node whose process is gone and whose run folder already holds the end: resume first, never "close it" (tree-close.js refuses --close there); (P8) the same node paused at an external seat: it is answered, not closed.
async function goneWithFolderFile(file) {
  const { r } = await stoppedWithChild({ gone: true });
  const runId = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1/M1@g1').runId;
  mkdirSync(join(r.t.runsDir, runId), { recursive: true }); writeFileSync(join(r.t.runsDir, runId, file), '{}');
  const events0 = eventsOf(r).length;
  const io = terminal([]);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decide(r, io).finally(() => clearTimeout(timer));
  assert.equal(code, 1, io.shown() + io.errors());
  assert.doesNotMatch(io.shown(), /Type your decision/, 'refused before the person typed');
  assert.equal(eventsOf(r).length, events0, 'nothing was written');
  return { text: io.errors(), treeId: stateOf(readTreeRecord(r.t.rootDir)).treeId };
}
test('P7 a node whose process is gone and whose run folder already holds the end: the refusal says resume first, never "close it" (OLD: "Close it")', { timeout: 300_000 }, async () => {
  const { text } = await goneWithFolderFile('STOPPED-budget.json');
  assert.ok(text.includes("R/M1/M1@g1's run already ended") && text.includes('Do that first, then decide again'), text);
  assert.equal(text.includes('Close it'), false, text);
});
test('P8 a node whose process is gone, paused at an external seat: the refusal says it waits for the person, never "close it"', { timeout: 300_000 }, async () => {
  const { text, treeId } = await goneWithFolderFile('NEEDS-builder.md');
  assert.ok(text.includes('R/M1/M1@g1 is paused, waiting for an external answer') && text.includes(`\`council tree resume ${treeId}\` says how to give it`), text);
  assert.equal(text.includes('Close it'), false, text);
});

// SLOT FIX (Option A, C&C thcmcp-cd 23 Okt 2026): the dead registered descendant of P3 no longer holds the slot, so it no longer blocks a ROOT stop or a root re-plan. The root route's rule is unchanged (S8 2.3: a LIVE registered child still counts active); this row drives the
// root re-plan with real verbs (the sub-plan decision of P3, the recovery step that opens its generation, the root decision: the preflight tree-root-replan.js:103, the table row :1417, the fold) and shows what becomes of D = R/M1/M1@g1: registered, never started, listed dead by the sub-plan regenerate.
// The obligation route (`decide --obligation`) opens its root stop without reading state.active (only a stop a PERSON opens does, tree-person-stop.js:32 and the row :1346); from the root decision on the two routes run the same preflight (:75) and row (:1393), exercised here.
test('P6 a dead registered descendant (P3) blocks neither a person-opened root stop nor the root re-plan (real verbs); afterwards it is STILL registered, dead, holds $0, was never started, and no screen offers it', { timeout: 300_000 }, async () => {
  const { r, stop } = await stoppedWithChild();
  const io = terminal([`${TEXT}\n.`, stop.id, 'y']);                         // `fresh: true`: as in P3 (OLD: no flag; WHY: with the earlier plan as data the new input is over this fixture's 4000-byte allowance and is refused at decide)
  const timer = setTimeout(() => io.stdin.end(), 8000);
  assert.equal(await decideWith(r, { fresh: true }, io).finally(() => clearTimeout(timer)), 0, io.shown() + io.errors());
  const D = 'R/M1/M1@g1';
  // the decision only DECIDES the new generation (G3: a node is dead once its generation is OPENED); the sitting's record-only recovery step opens it
  await recoverTree(r.t.rootDir, { runFactsOf: runFactsOfIn(r.t.runsDir), facts: {}, now: () => Date.now() });
  const state = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(deadKeys(state).has(D), true, 'D is dead (listed by the regenerate, its generation opened)');
  assert.equal(state.nodes.get(D).phase, 'registered');
  assert.equal(state.active, null, 'NEW (OLD: D): it holds no slot');
  // 1. the replacement of R/M1 needs its children frontier approved before a person may open a stop on the root (the person-stop preflight says so: "a frontier of children waits for your approval"); approve it the way this file's fixture does (registers nothing),
  //    then the person opens a stop on the root plan (preflight tree-person-stop.js:32 and row :1370 read state.active)
  approvePending(r);
  const io2 = terminal(['The plan is wrong at the root.\n.', 'R@g1', 'y']); const timer2 = setTimeout(() => io2.stdin.end(), 8000);
  assert.equal(await decideWith(r, { 'open-root-stop': true }, io2).finally(() => clearTimeout(timer2)), 0, io2.shown() + io2.errors());
  const rootStop = eventsOf(r).find(e => e.event === 'needs_decision_opened' && e.source === 'person');
  assert.ok(rootStop, 'the person stop is recorded');
  // 2. the root decision: the preflight (tree-root-replan.js 2.3) and the row :1393 read state.active; D is not live, so it is not in ineligibleBelowRoot and the decision does not list it
  const io3 = terminal([`${TEXT}\n.`, rootStop.id, 'y']); const timer3 = setTimeout(() => io3.stdin.end(), 8000);
  assert.equal(await decideWith(r, { stop: rootStop.id }, io3).finally(() => clearTimeout(timer3)), 0, io3.shown() + io3.errors());
  const dec = eventsOf(r).find(e => e.event === 'decision_recorded' && e.replansRoot === true);
  assert.ok(dec, 'the root re-plan is recorded (OLD: refused, D is active)');
  assert.equal(dec.affected.some(a => a.node === 'R/M1/M1'), false, 'D is not listed: a dead registered node is not in ineligibleBelowRoot');
  // 3. the END state of D
  const after = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(after.nodes.get(D).phase, 'registered', 'END PHASE: still registered');
  assert.equal(deadKeys(after).has(D), true, 'still dead');
  assert.equal(eventsOf(r).some(e => e.event === 'node_started' && e.node === 'R/M1/M1'), false, 'never started');
  assert.equal(budgetOf(r.t.rootDir).nodes.find(n => n.key === D).heldUsd, 0, 'it holds $0');
  assert.deepEqual(sittingFacts(r.t.rootDir).registeredNotStarted, [], 'and no screen offers it as a registered child to start');
});

// OVERSIZE AT DECIDE (SG-1 unit; C&C thcmcp-cd 23 Okt 2026): a sub-plan regenerate whose new plan's input would be over the allowance its approval was priced for is refused when the person has typed, before anything is approved or written, for the terminal AND the MCP
// session route; registration (tree-loop.js) is the same measurement and stays the backstop. Rows: (O1) terminal, oversize; (O2) the session's quote, oversize; (O3) the earlier plan offered as data is what pushes it over: refused with the existing sentence, and --fresh passes;
// (O4) the estimate agrees with registration: a decision that passes decide registers its child with no bundle_input stop (a cross-check: it cannot be red on the old source, where decide measured nothing); (O5) the size cannot be checked: the screen says so, per node, with a fixed cause;
// (O8) the what-if's figure for EACH node it measures equals the bytes registration really wrote for it, the never-registered consumer R/M2 included (C&C thcmcp-cd ruling 23 Okt 2026: fail-closed on any node, so the figure it refuses on must be the one registration confirms); (O5b) the same in the session's quote; (O6) a decision that lists nothing opens nothing to measure: ok false, said; (O7) the registered chain file is gone or edited: said, with a fixed cause.
const bigText = n => `${'The retention rule changes: keep every record for 90 days and tell the owner. '.repeat(Math.ceil(n / 76)).slice(0, n)}`;
/** The text length at which the LARGEST new plan the decision opens (R/M1 and the never-registered consumer R/M2, whose input is a little larger) is as large as `want` allows (searched with the SAME what-if, in steps of 50 bytes). */
function sizeFor(r, stop, want) {
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const stopEvent = record.events.find(e => e.id === stop.id);
  const at = n => newPlanInputBytes({ rootDir: r.t.rootDir, record, runsDir: r.t.runsDir, work: r.t.work, decisionArgs: { decisionText: bigText(n), affected: subplanAffectedWanted(state, stop.id), form: 'regenerate', stop: stopEvent, covers: [], gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' } });
  let n = 50; let last = null; let measured = null;
  for (; n < 15000; n += 50) { const got = at(n); assert.equal(got.ok, true, JSON.stringify(got)); measured = Math.max(...got.byNode.values()); if (measured > want) break; last = n; }
  // fail LOUDLY: a search that found no text length at or under `want` (the smallest text already over it) or never reached it would turn every row below into a vacuous pass
  if (last === null) assert.fail(`sizeFor: even a 50-byte decision text measures ${Math.max(...at(50).byNode.values())} bytes, over ${want}`);
  assert.ok(n < 15000, `sizeFor: the new plan never grew past ${want} bytes (last measured ${measured})`);
  return last;
}
test('O1 an oversize sub-plan decision is refused when it is typed, on the terminal: nothing is approved, nothing is written', { timeout: 300_000 }, async () => {
  const { r } = await stoppedWithChild();
  const events0 = eventsOf(r).length; const allowance = bundleAllowanceBytesOf(readTreeRecord(r.t.rootDir).tree);
  // `fresh: true`: without it the PREFLIGHT (the same code, run with a placeholder text before anything is asked) already adds the earlier plan (about 4 KB here) and refuses with the earlier-plan sentence before the person types: that case is O3. This row is about the TYPED text.
  const io = terminal([`${bigText(allowance + 2000)}\n.`]);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideWith(r, { fresh: true }, io).finally(() => clearTimeout(timer));
  assert.equal(code, 1, io.shown() + io.errors());
  assert.match(io.errors(), new RegExp(`the new plan of R/M1: its input would be about \\d+ bytes, over the ${allowance} this tree's approval was priced for`));
  assert.equal(io.shown().includes('To approve, type the stop id'), false, 'refused before the approval screen');
  assert.equal(eventsOf(r).length, events0, 'nothing was written');
});
test('O2 the same through the session route: the quote refuses and writes nothing', { timeout: 300_000 }, async () => {
  const { r, stop } = await stoppedWithChild();
  const events0 = eventsOf(r).length; const allowance = bundleAllowanceBytesOf(readTreeRecord(r.t.rootDir).tree);
  const q = JSON.parse(treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: ROOT_ID, step: 'quote', form: 'regenerate', stop: stop.id, text: bigText(allowance + 2000), reason: 'the retention rule changed', planMode: 'fresh' } }).content[0].text);
  assert.match(q.error ?? '', /the new plan of R\/M1: its input would be about \d+ bytes, over the \d+ this tree's approval was priced for/, JSON.stringify(q));
  assert.equal(eventsOf(r).length, events0, 'nothing was written');
});
test('O3 the earlier plan offered as data is what pushes it over: refused with the existing sentence, and --fresh passes', { timeout: 300_000 }, async () => {
  const { r, stop } = await stoppedWithChild();
  const allowance = bundleAllowanceBytesOf(readTreeRecord(r.t.rootDir).tree);
  const oldBytes = oldPlanOf({ rootDir: r.t.rootDir, node: stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1') }).bytes;
  assert.ok(oldBytes > 100, `the earlier plan must add more than the 100-byte margin below (${oldBytes})`);
  const n = sizeFor(r, stop, allowance - 100);        // the new plan fits WITHOUT the earlier plan (100 bytes under the allowance) and not with it (the earlier plan adds oldBytes > 100)
  const io = terminal([`${bigText(n)}\n.`]);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  assert.equal(await decide(r, io).finally(() => clearTimeout(timer)), 1, io.shown() + io.errors());
  assert.match(io.errors(), /leave the earlier plan out/, io.errors());
  assert.doesNotMatch(io.shown(), /Type your decision/, 'this half is decided at the PREFLIGHT, whatever the text: refused before the person types');
  const io2 = terminal([`${bigText(n)}\n.`, stop.id, 'y']);
  const timer2 = setTimeout(() => io2.stdin.end(), 8000);
  assert.equal(await decideWith(r, { fresh: true }, io2).finally(() => clearTimeout(timer2)), 0, io2.shown() + io2.errors());
  assert.equal(decisions(r).length, 1, 'with --fresh the decision is recorded');
});
test('O4 the estimate agrees with registration: a decision just under the allowance passes decide and its child registers with no bundle_input stop', { timeout: 300_000 }, async () => {
  const { r, stop } = await stoppedWithChild();
  const allowance = bundleAllowanceBytesOf(readTreeRecord(r.t.rootDir).tree);
  const n = sizeFor(r, stop, allowance - 50);
  const io = terminal([`${bigText(n)}\n.`, stop.id, 'y']);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  assert.equal(await decideWith(r, { fresh: true }, io).finally(() => clearTimeout(timer)), 0, io.shown() + io.errors());
  await recoverTree(r.t.rootDir, { runFactsOf: runFactsOfIn(r.t.runsDir), facts: {}, now: () => Date.now() });
  approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([reg.kind, reg.node], ['registered', 'R/M1'], 'the replacement of R/M1 is the child that registers: ' + JSON.stringify(reg));
  assert.equal(eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'bundle_input').length, 0, 'no bundle_input stop');
});
/** The root plan file is moved away: R/M1's new plan cannot be derived (its parent plan is not there), so the size cannot be checked. */
async function sizeUnknown() {
  const { r, stop } = await stoppedWithChild();
  renameSync(join(r.t.runsDir, ROOT_ID, 'deliverable.md'), join(r.t.runsDir, ROOT_ID, 'deliverable.md.away'));
  return { r, stop };
}
// the line names the nodes it could not measure (the stop lists R/M1 and the never-registered consumer R/M2) and gives ONE fixed cause (never the raw message, which can carry a local path): a moved plan file reads as `the plan it grows from is missing or has changed` (the box row of e69a2ed showed it)
const SKIP_LINE = /The size of the new plan's input could not be checked now for R\/M1, R\/M2 \(the plan it grows from is missing or has changed\); it is checked again before those plans start\./;
/** The bytes registration wrote for a node: every file of its bundle folder (tree/inputs/<node>@g<n>), the same sum registration measured (bundleInputBytes over derived.files, which writeBundle writes one file each). */
// WHAT O8 CHECKS: it compares the FUNCTION decide calls (newPlanInputBytes, with arguments mirrored from buildStopDecision: gate fields 'g' where decide passes 'what-if') with registration's bundles; it does not read decide's own figure. The same plan-a is planned again (a real divergence also comes from a DIFFERENT new plan: the consumer's estimate is built from the replaced provider's pieces, not the new provider's).
const registeredFiles = (r, node, generation) => { const dir = join(r.t.rootDir, 'tree', 'inputs', bundleDirName(node, generation)); return Object.fromEntries(readdirSync(dir).sort().map(f => [f, readFileSync(join(dir, f)).length])); };
const registeredBytes = (r, node, generation) => Object.values(registeredFiles(r, node, generation)).reduce((n, b) => n + b, 0);
test('O8 the what-if figure for each node the decision opens (R/M1@g2 and the never-registered consumer R/M2@g2) against the bytes registration wrote for it', { timeout: 600_000 }, async () => {
  const { r, stop } = await stoppedWithChild();
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const est = newPlanInputBytes({ rootDir: r.t.rootDir, record, runsDir: r.t.runsDir, work: r.t.work, decisionArgs: { decisionText: TEXT, affected: subplanAffectedWanted(state, stop.id), form: 'regenerate', stop: record.events.find(e => e.id === stop.id), covers: [], gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' } });
  assert.deepEqual([est.ok, [...est.byNode.keys()].sort(), est.skipped], [true, ['R/M1', 'R/M2'], []], `both nodes the decision opens are measured: ${JSON.stringify(est)}`);
  const io = terminal([`${TEXT}\n.`, stop.id, 'y']);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  assert.equal(await decideWith(r, { fresh: true }, io).finally(() => clearTimeout(timer)), 0, io.shown() + io.errors());
  await recoverTree(r.t.rootDir, { runFactsOf: runFactsOfIn(r.t.runsDir), facts: {}, now: () => Date.now() });
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  const registered = () => eventsOf(r).filter(e => e.event === 'node_registered').map(e => `${e.node}@g${e.generation}`);
  for (let round = 0; round < 12 && !registered().includes('R/M2@g2'); round += 1) {
    if (findPendingFrontier({ rootDir: r.t.rootDir })) approvePending(r);          // the replacement's frontier, then R/M1@g2's own split
    await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  }
  assert.ok(registered().includes('R/M2@g2'), `the consumer registered at g2 (registered: ${registered().join(', ')})`);
  const got = [registeredBytes(r, 'R/M1', 2), registeredBytes(r, 'R/M2', 2)]; const want = [est.byNode.get('R/M1'), est.byNode.get('R/M2')];
  assert.deepEqual(got, want, `registration R/M1 ${got[0]} R/M2 ${got[1]}; what-if R/M1 ${want[0]} R/M2 ${want[1]}; registered files R/M1@g2 ${JSON.stringify(registeredFiles(r, 'R/M1', 2))} R/M2@g2 ${JSON.stringify(registeredFiles(r, 'R/M2', 2))}`);
});
test('O5 when the size cannot be checked the screen SAYS so, naming the node and a fixed cause, and registration stays the backstop: the approval screen still comes, with one line about it', { timeout: 300_000 }, async () => {
  const { r } = await sizeUnknown();
  const io = terminal([`${TEXT}\n.`]);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  await decide(r, io).finally(() => clearTimeout(timer));
  assert.match(io.shown(), SKIP_LINE, io.shown() + io.errors());
  assert.equal(io.shown().includes(r.t.runsDir), false, 'no local path in the line');
});
test('O5b the same through the session route: the QUOTE (the text an MCP agent shows the person) carries the skip line, and no local path', { timeout: 300_000 }, async () => {
  const { r, stop } = await sizeUnknown();
  const q = JSON.parse(treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: ROOT_ID, step: 'quote', form: 'regenerate', stop: stop.id, text: TEXT, reason: 'the retention rule changed', planMode: 'fresh' } }).content[0].text);
  assert.match(q.text ?? '', SKIP_LINE, JSON.stringify(q));
  assert.equal(String(q.text).includes(r.t.runsDir), false, 'no local path in the quote');
});
test('O6 a decision that lists nothing opens no plan: the what-if SAYS so (ok: false, a fixed cause) instead of reading as "nothing is over the allowance" (openingOf returns an event with no nodes; only a hand-made decisionArgs reaches this: a real regenerate lists at least the stopped node)', { timeout: 300_000 }, async () => {
  const { r, stop } = await stoppedWithChild();
  const record = readTreeRecord(r.t.rootDir);
  const got = newPlanInputBytes({ rootDir: r.t.rootDir, record, runsDir: r.t.runsDir, work: r.t.work, decisionArgs: { decisionText: TEXT, affected: [], form: 'regenerate', stop: record.events.find(e => e.id === stop.id), covers: [], gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' } });
  assert.deepEqual(got, { ok: false, why: 'the decision opens no new plan' }, JSON.stringify(got));
});
test('O7 the chain file the tree registered is gone or edited (a package update, a project copy): the size cannot be checked, the screen SAYS so with a fixed cause (never the message, which names a local path), and decide still works', { timeout: 300_000 }, async () => {
  const { r } = await stoppedWithChild();
  mkdirSync(join(r.t.work, 'chains'), { recursive: true });
  for (const c of readTreeRecord(r.t.rootDir).tree.chains) writeFileSync(join(r.t.work, 'chains', `${c.name}.json`), '{}');          // a project copy of the same name wins over the package's, and its sha256 is not the registered one
  const io = terminal([`${TEXT}\n.`]);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  await decide(r, io).finally(() => clearTimeout(timer));
  assert.match(io.shown(), /The size of the new plan's input could not be checked now for R\/M1, R\/M2 \([^)]*the chain file it needs is missing or has changed[^)]*\); it is checked again before those plans start\./, io.shown() + io.errors());
  assert.equal(io.shown().includes(r.t.work), false, 'no local path in the line');
});
