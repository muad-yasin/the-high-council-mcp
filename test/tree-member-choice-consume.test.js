// CHANGED ACCEPTED (already-false unit, C&C thcmcp-cd 24 Okt 2026; the dead-key sentence): OLD "its plan, or an ancestor's, was replaced"; NEW "replaced or set aside by a decision, or a node above it was" (table rows: "is dead (NEW): ..."; screens and refusals: "is dead: it was NEW, ..."). WHY: the old words are false for a node a decision LISTED (a consumer that never wrote a plan, or one with no successor) and for a transitive orphan whose parent was never replaced; the new tail holds on every route into deadKeys. Only the words moved: every row refuses the same keys as before.
// The member verb, commit 2 (consumption; gate note Member_Verb_Gate_Note.md + delta addendum, C&C rulings 15/16 Okt 2026): a recorded `node_choice` is acted on by the next `council tree resume`, which writes the member's
// run.json roundChoices entry (the same shape the standalone --continue/--finish writes) and resumes it. CONSUMED IS DERIVED: pending until run.json holds an entry for the stop id. Offline, $0, stub starters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { exitCodeOf, resumeHandler, sittingLines } from '../src/tree-resume.js';
import { planRecovery } from '../src/tree-recovery.js';
import { runEndOf } from '../src/tree-member.js';
import { applyChoice, choiceRefusal, chooseNode, pendingChoiceOf, recordedChoiceFor, waitingForChoice } from '../src/tree-choice.js';
import { closeRefusal } from '../src/tree-close.js';
import { parseTreeArgs } from '../src/tree-cli.js';
import { foldRecord } from '../src/tree-transitions.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { FIXTURE_BOUND } from './helpers/tree-fixture.js';
import { defaultAdd, roundChoiceEntry } from '../src/overseer-rounds.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, eventsOf } from './helpers/sitting.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const dead = { pidAlive: () => false };
const STOP = { kind: 'overseer_cap', overseer_round: 7, pass: 3 };
const STOP_ID = 'overseer_cap:7:3';

/** A member stopped at its overseer limit as a real one looks after exit 23: node_started (dead pid), run folder with run.json, the marker and the partial report with its stop. */
async function stoppedMember() {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3, startRun: async () => ({ exitCode: 23 }) });
  appendTreeEvent(r.t.rootDir, { event: 'node_started', node: 'R/M1', generation: 1, runId: first.runId, pid: 999999, host: hostname() });
  const dir = join(r.t.runsDir, first.runId); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'x', task: 't', maxUsd: 5 })); writeFileSync(join(dir, 'STOPPED-overseer_cap.json'), '{}'); writeFileSync(join(dir, 'report-partial.json'), JSON.stringify({ stop: STOP }));
  return { r, dir, runId: first.runId };
}
const nodeOf = r => stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
const entries = dir => JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).roundChoices ?? [];
const sit = (r, resumeRun) => { const out = []; const io = { write: s => { out.push(String(s)); return true; } }; return resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: io, stderr: io, now: () => Date.now(), facts: dead, deps: { startRun: async () => ({ exitCode: 0 }), resumeRun } }).then(code => ({ code, text: out.join('') })); };

test('CC-1 pendingChoiceOf is derived: none without a choice; a node_choice for THIS stop is pending (not applied); a roundChoices entry for the stop is pending-applied; a choice for another stop id is not pending', async () => {
  const { r, dir } = await stoppedMember();
  assert.equal(pendingChoiceOf(dir, nodeOf(r)), null);
  await chooseNode(r.t.rootDir, { node: 'R/M1', choice: 'continue' }, { facts: dead });
  assert.deepEqual(pendingChoiceOf(dir, nodeOf(r)), { choice: 'continue', stop: STOP_ID, applied: false });
  applyChoice(dir, pendingChoiceOf(dir, nodeOf(r)));
  assert.deepEqual(pendingChoiceOf(dir, nodeOf(r)), { choice: 'continue', stop: STOP_ID, applied: true });
  const alone = await stoppedMember();
  writeFileSync(join(alone.dir, 'run.json'), JSON.stringify({ chain: 'x', task: 't', maxUsd: 5, roundChoices: [{ stop: STOP_ID, choice: 'continue', kind: 'overseer_cap', overseer_round: 7, add: 1 }] }));
  assert.equal(pendingChoiceOf(alone.dir, nodeOf(alone.r)), null, 'an entry in run.json with no recorded choice is not pending (project-writable text never starts a paid resume)');
  assert.equal(pendingChoiceOf(undefined, nodeOf(alone.r)), null, 'no run folder is not pending');
  const stale = await stoppedMember();
  appendTreeEvent(stale.r.t.rootDir, { event: 'node_choice', node: 'R/M1', generation: 1, runId: stale.runId, choice: 'continue', stop: 'overseer_cap:6:3' });
  assert.equal(pendingChoiceOf(stale.dir, nodeOf(stale.r)), null, 'a choice for another stop id is ignored');
});

test('CC-2 applyChoice writes the ONE entry shape (stop id, choice, kind, round, no add for a continue, add 0 for a finish), keeps the rest of run.json, writes once; roundChoiceEntry with a config equals what the standalone path wrote', async () => {
  const { r, dir } = await stoppedMember();
  await chooseNode(r.t.rootDir, { node: 'R/M1', choice: 'finish' }, { facts: dead });
  applyChoice(dir, pendingChoiceOf(dir, nodeOf(r)));
  applyChoice(dir, { choice: 'finish', stop: STOP_ID, applied: true });
  assert.deepEqual(entries(dir), [{ stop: STOP_ID, choice: 'finish', kind: 'overseer_cap', overseer_round: 7, add: 0 }]);
  assert.equal(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).maxUsd, 5, 'the rest of run.json is kept');
  assert.deepEqual(roundChoiceEntry(STOP, 'continue'), { stop: STOP_ID, choice: 'continue', kind: 'overseer_cap', overseer_round: 7 });
  const config = { maxRounds: 3 };
  assert.deepEqual(roundChoiceEntry(STOP, 'continue', config), { stop: STOP_ID, choice: 'continue', kind: 'overseer_cap', overseer_round: 7, add: defaultAdd(STOP, config) });
});

test('CC-3 a sitting over a recorded choice writes the entry BEFORE it resumes the member, resumes it once, and prints that the choice is applied', async () => {
  const { r, dir } = await stoppedMember();
  await chooseNode(r.t.rootDir, { node: 'R/M1', choice: 'continue' }, { facts: dead });
  const seen = [];
  const { text } = await sit(r, async () => { seen.push(entries(dir).length); return { exitCode: 0 }; });
  assert.deepEqual(seen, [1], 'resumeRun ran once and the entry was already on disk');
  assert.match(text, /your choice for its stop \(continue\) is applied/);
  assert.equal(entries(dir).length, 1);
});

test('CC-4 crash window: the choice is on record AND the entry is on disk but the resume never ended (no node_resumed): the next sitting resumes once plainly, nothing is written twice; an entry with NO recorded choice holds at awaiting_choice (exit 20), nothing resumed', async () => {
  const { r, dir } = await stoppedMember();
  await chooseNode(r.t.rootDir, { node: 'R/M1', choice: 'continue' }, { facts: dead });
  applyChoice(dir, pendingChoiceOf(dir, nodeOf(r)));
  let resumed = 0;
  const { text } = await sit(r, async () => { resumed += 1; return { exitCode: 0 }; });
  assert.equal(resumed, 1); assert.equal(entries(dir).length, 1); assert.doesNotMatch(text, /is applied/, 'nothing was applied again');
  const alone = await stoppedMember();
  writeFileSync(join(alone.dir, 'run.json'), JSON.stringify({ chain: 'x', task: 't', maxUsd: 5, roundChoices: [{ stop: STOP_ID, choice: 'continue', kind: 'overseer_cap', overseer_round: 7, add: 1 }] }));
  let held = 0;
  const b = await sit(alone.r, async () => { held += 1; return { exitCode: 0 }; });
  assert.deepEqual([b.code, held], [20, 0]);
});

test('CC-5 a choice for ANOTHER stop id is ignored: the sitting holds at awaiting_choice (exit 20), resumes nothing, and `runTree` does the same', async () => {
  const { r, runId } = await stoppedMember();
  appendTreeEvent(r.t.rootDir, { event: 'node_choice', node: 'R/M1', generation: 1, runId, choice: 'continue', stop: 'overseer_cap:6:3' });
  let resumed = 0;
  const { code } = await sit(r, async () => { resumed += 1; return { exitCode: 0 }; });
  assert.deepEqual([code, resumed], [20, 0]);
  const loop = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3, facts: dead, startRun: async () => ({ exitCode: 0 }), resumeRun: async () => { resumed += 1; return { exitCode: 0 }; } });
  assert.deepEqual([loop.status, exitCodeOf(loop), resumed], ['awaiting_choice', 20, 0]);
});

test('CC-6 the runTree loop does not resume a chosen member itself: it answers interrupted (the sitting that follows is `tree resume`); recovery plans a resume carrying the choice, and a wait_for_person when none is recorded', async () => {
  const { r, dir } = await stoppedMember();
  const plan = () => planRecovery(readTreeRecord(r.t.rootDir), { runFactsOf: () => ({ hasRunJson: true, runDir: dir, end: runEndOf(dir), paused: false }), facts: dead });
  assert.deepEqual(plan().map(a => [a.action, a.reason]), [['wait_for_person', 'round_stop']]);
  await chooseNode(r.t.rootDir, { node: 'R/M1', choice: 'finish' }, { facts: dead });
  assert.deepEqual(plan().map(a => [a.action, a.choice]), [['resume', 'finish']]);
  let resumed = 0;
  const loop = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3, facts: dead, startRun: async () => ({ exitCode: 0 }), resumeRun: async () => { resumed += 1; return { exitCode: 0 }; } });
  assert.deepEqual([loop.status, resumed], ['interrupted', 0]);
  assert.equal(eventsOf(r).some(e => e.event === 'node_resumed'), false);
});

test('CC-7 no choice verb over MCP: nothing under src/mcp names the choice writer, the event, or the two flags (a person gives the choice at a terminal)', () => {
  const root = new URL('../src/mcp/', import.meta.url).pathname;
  const hits = readdirSync(root).filter(f => f.endsWith('.js')).filter(f => /chooseNode|node_choice|continue-node|finish-node|applyChoice/.test(readFileSync(join(root, f), 'utf8')));
  assert.deepEqual(hits, []);
});

test('CC-8 the held reviewNotesAnswer carries the copied-block clause before the NOTE lines instruction: the NOTE lines go last, below any block the writer was asked to copy', async () => {
  const H = await import('./held-prompts/held-083.js');
  const text = H.reviewNotesAnswer({ rows: [{ id: 'N-0000000a', kind: 'proposal', raised_count: 1, text: 'Add a queue' }] });
  assert.match(text, /As the very last lines of your reply, after everything else \(after any block you were asked to copy\), add one line per item: NOTE-TAKEN/);
});

// A DEAD member in a round stop: R/M1 was replaced (a regenerate decision, its generation opened), so its child R/M1/M1 is an orphan that is still `running`; its run ended at an overseer limit.
const G = { gateId: 'g', shownSha256: '0'.repeat(64) };
const RUN = 'run-R-M1-M1-1';
const reg = (n, parent, fk, runId) => ({ event: 'node_registered', node: n, generation: 1, runId, attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' } });
const startedOf = (id, n, runId) => ({ id, event: 'node_started', node: n, generation: 1, runId, pid: 1, host: 'h' });
const front = (fk, parent, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: 1, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const orphanState = () => foldRecord([{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', null, null, 't'), depth: 0 }, startedOf('e2b', 'R', 't'), { id: 'e2c', event: 'node_closed', node: 'R', generation: 1, runId: 't', outcome: 'passed', passed: true, status: null, share: 'released' },
  ...front('kA', 'R', [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 'R', 'kA', 'run-R-M1-1') }, startedOf('e4b', 'R/M1', 'run-R-M1-1'), { id: 'e4c', event: 'node_closed', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', outcome: 'passed', passed: true, status: 'needs_decision', share: 'released' },
  ...front('kB', 'R/M1', [{ node: 'R/M1/M1', generation: 1 }], 'e5'), { id: 'e6', ...reg('R/M1/M1', 'R/M1', 'kB', RUN) }, startedOf('e6b', 'R/M1/M1', RUN),
  { id: 'e7', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/M1', generation: 1 }] },
  { id: 'e8', event: 'decision_recorded', text: 'redo', form: 'regenerate', stopId: 'e7', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/M1', generation: 1 }], ...G },
  { id: 'e9', event: 'generation_opened', decisionId: 'e8', nodes: [{ node: 'R/M1', generation: 2 }] }]);

test('CC-9 a DEAD member at a round stop is never offered a choice and never given one: the refusal names that its plan was replaced and the --close command with the REAL tree id; the "Waiting for a choice" list leaves it out', () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'cc9-'));
  const dir = join(runsDir, RUN); mkdirSync(dir);
  writeFileSync(join(dir, 'run.json'), '{}'); writeFileSync(join(dir, 'STOPPED-overseer_cap.json'), '{}'); writeFileSync(join(dir, 'report-partial.json'), JSON.stringify({ stop: STOP }));
  const state = orphanState(); const facts = { pidAlive: () => false, host: 'h' };
  const why = choiceRefusal({ state, runsDir, node: 'R/M1/M1', generation: 1, facts, rootId: 'tree-x' });
  assert.equal(why?.kind, 'dead'); assert.match(why.reason, /replaced or set aside by a decision, or a node above it was/); assert.match(why.reason, /council tree decide tree-x --close R\/M1\/M1/);
  assert.deepEqual(waitingForChoice(state, runsDir, facts), []);
  assert.equal(closeRefusal({ state, runsDir, node: 'R/M1/M1', generation: 1, facts, rootId: 'tree-x' }), null, 'the way out the text names really is open for a dead running member');
  const lines = sittingLines({ status: 'awaiting_choice', started: [], node: 'R/M1/M1', runId: RUN, stopped: [], replaced: 'dead' }, 'tree-x').join('\n');
  assert.match(lines, /cannot be given a choice: its plan was replaced \(it is dead\)/); assert.doesNotMatch(lines, /Your choice/);
  const cmd = lines.match(/`(council tree decide tree-x --close R\/M1\/M1)`/)?.[1]; assert.ok(cmd, lines);
  const parsed = parseTreeArgs(cmd.split(' ').slice(2)); assert.equal(parsed.error, undefined, 'the printed command parses back as the decide form'); assert.equal(parsed.verb, 'decide');
});

test('CC-10 chooseNode passes the tree id: a refusal under the lock prints no "<tree id>" placeholder (an unreadable stop names --close with the real id)', async () => {
  const { r, dir } = await stoppedMember();
  writeFileSync(join(dir, 'report-partial.json'), '{}');
  assert.throws(() => chooseNode(r.t.rootDir, { node: 'R/M1', choice: 'continue', rootId: 'tree-x' }, { facts: dead }), e => /tree decide tree-x --close R\/M1/.test(e.message) && !/<tree id>/.test(e.message));
});

test('CC-11 the CLI lookup recordedChoiceFor: a choice stands only when the tree record holds it for THIS stop id and it is the SAME choice the run.json entry carries (record says finish, entry says continue: no)', async () => {
  const { r } = await stoppedMember();
  assert.equal(recordedChoiceFor(r.t.rootDir, { node: 'R/M1', generation: 1 }, STOP_ID, 'continue'), false, 'nothing recorded');
  await chooseNode(r.t.rootDir, { node: 'R/M1', choice: 'finish' }, { facts: dead });
  assert.equal(recordedChoiceFor(r.t.rootDir, { node: 'R/M1', generation: 1 }, STOP_ID, 'finish'), true);
  assert.equal(recordedChoiceFor(r.t.rootDir, { node: 'R/M1', generation: 1 }, STOP_ID, 'continue'), false, 'an entry that disagrees with the record never stands');
  assert.equal(recordedChoiceFor(r.t.rootDir, { node: 'R/M1', generation: 1 }, 'overseer_cap:6:3', 'finish'), false, 'another stop id');
});
