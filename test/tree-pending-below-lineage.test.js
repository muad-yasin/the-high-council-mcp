// CR-RC-019 (builder 19's trace of T's cross-read C-2, rated P2 by C&C thcmcp-a1 on 26 Okt 2026): pendingBelowOf (src/tree-transitions.js) asks whether a finished node is WHOLE. Its `registeredGen(path)` read the newest registered
// generation of a child path ANYWHERE in the tree. The children a REPLACED generation of the same parent path registered there (orphans now, still in the record) answered for the new generation, so a regenerated sub-plan whose split
// was verified and whose children frontier nobody approved yet read as whole while none of its children existed. A root re-plan then HELD it instead of setting it aside: a wrong held set in the decision, and a wrong count on its screen.
// The fix scopes the read to the children registered under a frontier of THIS node at THIS generation (its own lineage), as `slotFilled` already was.
// Through the REAL verbs (all-mock chains, $0; the plans a model would write are handed to each run as a DRAFT, as in test/tree-nested-adoption-walk.test.js, whose legs 1-8 this follows). No hand-made record line: every stop is opened by
// the sitting after a person's edit of a run's HANDOFF.md.
//   1 `tree approve`  the root's children frontier            2 sitting   R/M1 (splits on plan-a.md) and R/M3 close passed; R/M1's split is verified, its frontier waits
//   3 `tree approve`  R/M1's children frontier                4 sitting   R/M1/M1..M3 and the consumer R/M2 close passed
//   5 HANDOFF.md of R/M1@g1 edited, sitting: a stop on it      6 `decide --stop` regenerate of R/M1; sitting: recovery opens R/M1@g2 (and its consumer R/M2@g2)
//   7 `tree approve`  R's replacement frontier                8 sitting   R/M1@g2 runs plan-a.md again (the SAME milestone ids), closes, its split is verified; nobody approves its children frontier
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { ineligibleBelowRoot, orphansOf, pendingBelowOf } from '../src/tree-transitions.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const io = answers => { const t = terminal(answers); const timer = setTimeout(() => t.stdin.end(), 8000); t.stop = () => clearTimeout(timer); return t; };
const state = r => stateOf(readTreeRecord(r.t.rootDir));
const keys = list => list.map(a => `${a.node}@g${a.generation}`);

/** R/M1's plan, the block of test/tree-nested-adoption-walk.test.js: children K1..K3 (milestones M1..M3) with questions of their own, M5 ready. Both generations of R/M1 run it, so their splits name the same child paths. */
function block() {
  const b = block3();
  for (const m of b.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  return b;
}

async function approve(r, leg) {
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending?.key, `${leg}: a frontier waits for approval`);
  const t = io([pending.key.slice(0, 8), 'y']);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop);
  assert.equal(code, 0, `${leg}: ${t.shown()}${t.errors()}`);
  return pending;
}
async function decide(r, flags, answers, leg) {
  const t = io(answers);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop);
  assert.equal(code, 0, `${leg}: ${t.shown()}${t.errors()}`);
}
/** A person edits the HANDOFF.md of a finished run; the next sitting meets the changed file and opens a stop on that node (the route test/tree-nested-adoption-walk.test.js test 1 drives). -> the stop's needs_decision_opened event. */
async function stopByHandoff(r, node, generation, start, leg) {
  const runId = state(r).nodes.get(`${node}@g${generation}`).runId;
  const file = join(r.t.runsDir, runId, 'HANDOFF.md');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nA late change to this run.\n`);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });
  const stop = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.node === node && e.generation === generation).at(-1);
  assert.ok(stop, `${leg}: the sitting opened a stop on ${node}@g${generation} (${JSON.stringify(eventsOf(r).filter(e => e.event === 'needs_decision_opened').map(e => [e.id, e.node, e.generation, e.source]))})`);
  return stop;
}

/** Legs 1-4: R/M1@g1 split, its three children and the consumer R/M2 finished. -> { r, start } */
async function finishedSplit() {
  const r = await trackedRealRoot(splitChildren());
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(block(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await approve(r, 'leg 1');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  await approve(r, 'leg 3');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.deepEqual(['R/M1/M1', 'R/M1/M2', 'R/M1/M3', 'R/M2'].map(n => phases(r)[n]), ['closed', 'closed', 'closed', 'closed'], `leg 4: ${JSON.stringify(phases(r))}`);
  return { r, start };
}

/** Legs 5-8: R/M1 planned again; R/M1@g2 closed with a verified split, its children frontier not approved (no frontier of R/M1@g2 on record). -> { r, start } */
async function regeneratedParent() {
  const { r, start } = await finishedSplit();
  const stop = await stopByHandoff(r, 'R/M1', 1, start, 'leg 5');
  // `fresh`: the earlier plan offered as data would put R/M1@g2's input over the fixture's 4000-byte allowance (the reason test/tree-nested-adoption-walk.test.js gives)
  await decide(r, { stop: stop.id, fresh: true }, ['Plan the store again.\n.', stop.id, 'y'], 'leg 6');
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });
  assert.ok(eventsOf(r).filter(e => e.event === 'generation_opened').at(-1)?.nodes.some(n => n.node === 'R/M1' && n.generation === 2), 'leg 6: R/M1@g2 is opened');
  await approve(r, 'leg 7');
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: start });
  const st = state(r);
  const n = st.nodes.get('R/M1@g2');
  assert.deepEqual([n?.phase, n?.outcome], ['closed', 'passed'], `leg 8: R/M1@g2 finished (${JSON.stringify(phases(r))})`);
  assert.deepEqual(n.verifiedSplit?.children, ['R/M1/M1', 'R/M1/M2', 'R/M1/M3'], 'leg 8: its split is verified and names the same child paths as R/M1@g1\'s');
  assert.equal([...st.frontiers.values()].some(f => f.parentNode === 'R/M1' && f.parentGeneration === 2), false, 'leg 8: no frontier of R/M1@g2 is on record (nobody ran `tree approve` for it)');
  for (const k of ['R/M1/M1@g1', 'R/M1/M2@g1', 'R/M1/M3@g1']) assert.ok(st.nodes.has(k) && orphansOf(st).has(k), `leg 8: ${k}, a child of the replaced R/M1@g1, is still in the record, an orphan`);
  return { r, start };
}

test('CR-RC-019: a regenerated sub-plan (R/M1@g2) with a verified split and NONE of its children registered is half-finished, though the replaced generation\'s children sit on the same paths; a root re-plan sets it aside', { timeout: 900_000 }, async () => {
  const { r } = await regeneratedParent();
  const st = state(r);
  assert.ok(ineligibleBelowRoot(st).includes('R/M1@g2'), `R/M1@g2 is not holdable: its split names three children and none of ITS children is registered (${JSON.stringify(ineligibleBelowRoot(st))})`);
  assert.equal(pendingBelowOf(st, st.nodes.get('R/M1@g2')), true, 'pendingBelowOf: the orphans of R/M1@g1 do not answer for R/M1@g2');
});

test('CR-RC-019, the record: the decision that plans the root again lists R/M1@g2 in its affected set (set aside, not held)', { timeout: 900_000 }, async () => {
  const { r, start } = await regeneratedParent();
  const rootStop = await stopByHandoff(r, 'R', 1, start, 'the root stop');
  await decide(r, { stop: rootStop.id }, ['Plan it again.\n.', rootStop.id, 'y'], 'the root re-plan');
  const dec = eventsOf(r).filter(e => e.event === 'decision_recorded' && e.stopId === rootStop.id).at(-1);
  assert.equal(dec?.replansRoot, true, `the decision plans the root again (${JSON.stringify(dec)})`);
  assert.ok(keys(dec.affected).includes('R/M1@g2'), `R/M1@g2 is in the decision's affected set: ${JSON.stringify(keys(dec.affected))}`);
});

test('CR-RC-019, the neighbour (control): a whole R/M1@g1 one of whose children was REGENERATED (R/M1/M3@g1 -> R/M1/M3@g2, registered and finished) stays whole: the regenerated child is registered under a frontier of R/M1@g1', { timeout: 900_000 }, async () => {
  const { r, start } = await finishedSplit();
  const stop = await stopByHandoff(r, 'R/M1/M3', 1, start, 'the child stop');
  await decide(r, { stop: stop.id, fresh: true }, ['Plan this part again.\n.', stop.id, 'y'], 'the child regenerate');
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });
  // the stop also puts the consumers of R/M1/M3's ancestors in question (src/tree-affected.js), so the decision can open R/M2@g2 beside R/M1/M3@g2: their replacement frontiers are offered one at a time (R's first, by path order).
  // A FIXED number of rounds, each approving what waits and sitting once; the loop reads the regenerated child by KEY (the path's phase is R/M1/M3@g1's until g2 registers)
  for (let i = 0; i < 6 && state(r).nodes.get('R/M1/M3@g2')?.phase !== 'closed'; i += 1) {
    if (findPendingFrontier({ rootDir: r.t.rootDir })?.key) await approve(r, `round ${i + 1}: a replacement frontier`);
    await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 2, startRun: start });
  }
  const st = state(r);
  const regen = st.nodes.get('R/M1/M3@g2');
  assert.deepEqual([regen?.phase, regen?.outcome], ['closed', 'passed'], `the regenerated child finished (${JSON.stringify(phases(r))}; opened ${JSON.stringify(eventsOf(r).filter(e => e.event === 'generation_opened').map(e => e.nodes))}; approved ${JSON.stringify(eventsOf(r).filter(e => e.event === 'frontier_approved').length)})`);
  const f = st.frontiers.get(regen.frontierKey);
  assert.deepEqual([f?.parentNode, f?.parentGeneration], ['R/M1', 1], 'the lineage: the regenerated child is registered under a frontier whose parent is R/M1@g1 (the scope key)');
  assert.equal(pendingBelowOf(st, st.nodes.get('R/M1@g1')), false, 'R/M1@g1 is whole');
  assert.equal(ineligibleBelowRoot(st).includes('R/M1@g1'), false, `and holdable (${JSON.stringify(ineligibleBelowRoot(st))})`);
});
