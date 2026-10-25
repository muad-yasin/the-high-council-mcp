// D2 F10 with D3 F10-1 (CR-2A-002) at DEPTH, through the REAL verbs: the first nested adoption a test reaches without writing the adoption by hand. test/tree-replan-place.test.js pins the rule on a record built through the table
// (test/helpers/adoption-fixture.js); test/tree-adoption-walk.test.js T10 (1) pins it with real verbs at the ROOT level only. Here the adoption sits one level down: R/M1 splits, its children run and finish, R/M1 is planned again
// (`council tree decide --stop`), and R/M1@g2's children frontier ADOPTS the finished R/M1/M3@g1 in place (slot R/M1/M3@g2). The adopted node sits under R/M1@g2 (its adopting frontier's parent), which hangs under the current
// root plan R@g1, so a stop on it makes it ineligible for the next root re-plan. Before F10 the walk filed it under R/M1@g1 (its own frontier's parent), which the regenerate decision made dead, and never judged it.
// The legs (all-mock chains, $0; the plans a model would write are handed to each run as a DRAFT, as in test/tree-replace.test.js):
//   1 `tree approve`  the root's children frontier            2 sitting   R/M1 (splits on plan-a.md) and R/M3 close passed; R/M1's split is verified, its frontier waits
//   3 `tree approve`  R/M1's children frontier                4 sitting   R/M1/M1..M3 and the consumer R/M2 close passed
//   5 `decide --stop` regenerate of R/M1 (hand-made 1: its stop) 6 sitting   recovery opens R/M1@g2 and its consumer R/M2@g2
//   7 `tree approve`  R's replacement frontier                8 sitting   R/M1@g2 runs plan-b.md (K1's scope changed, K3 the same), closes, its split is verified
//   9 `tree approve`  R/M1@g2's children frontier: the preview carries `reused` for R/M1/M3 (R/M1/M3@g1, compared the same); K1 changed and K2 lost its supplier, so both are new runs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { affectedFor } from '../src/tree-affected.js';
import { deadKeys, ineligibleBelowRoot } from '../src/tree-transitions.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const ADOPTED = 'R/M1/M3@g1';
const io = answers => { const t = terminal(answers); const timer = setTimeout(() => t.stdin.end(), 8000); t.stop = () => clearTimeout(timer); return t; };
const state = r => stateOf(readTreeRecord(r.t.rootDir));
const keys = list => list.map(a => `${a.node}@g${a.generation}`);

/** R/M1's plan (the block of test/tree-replace.test.js): children K1..K3 with questions of their own (a child may not repeat an ancestor's question), M5 ready. K1 provides A1 to K2; K3 is independent. */
function oldBlock() {
  const b = block3();
  for (const m of b.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  return b;
}
/** R/M1@g2's plan: the same block with K1's scope changed. K3 (no agreement, same scope, same question) compares the same, so its finished run is adopted; K1 is changed and K2's supplier is not reused, so they are new runs (the fixture's shape: one slot reused, the others fresh). */
function newBlock() { const b = oldBlock(); b.children.find(c => c.id === 'K1').scope += ' Also add an export step.'; return b; }

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

/** Legs 1-9. -> { r, start, frontier: the key of R/M1@g2's children frontier }. Nothing after the adopting approval has run. */
async function nestedAdoption() {
  const r = await trackedRealRoot(splitChildren());
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(oldBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  writeFileSync(join(r.t.work, 'plan-b.md'), planWith(newBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = a => draftStarter(r, { 'R/M1': a.generation >= 2 ? 'plan-b.md' : 'plan-a.md' })(a);
  await approve(r, 'leg 1');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  await approve(r, 'leg 3');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.deepEqual(['R/M1/M1', 'R/M1/M2', 'R/M1/M3', 'R/M2'].map(n => phases(r)[n]), ['closed', 'closed', 'closed', 'closed'], `leg 4: ${JSON.stringify(phases(r))}`);
  assert.equal(state(r).nodes.get(ADOPTED)?.outcome, 'passed', 'leg 4: the child to be adopted finished and passed');
  // hand-made 1: the stop on R/M1@g1, as detection would write it (its closure). No verb opens a stop on a child that closed passed (`--open-root-stop` is the root's); test/tree-replace.test.js writes the same line
  const rec0 = readTreeRecord(r.t.rootDir); const st0 = stateOf(rec0);
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: st0.nodes.get('R/M1@g1').runId, source: 'status', affected: affectedFor({ record: rec0, state: st0, runsDir: r.t.runsDir, node: 'R/M1' }).affected });
  // `fresh`: the fixture's approvals are priced for a 4000-byte input, and the earlier plan offered as data would put R/M1@g2's input over it (the reason test/tree-replace.test.js gives); part 7 of a child's context is not compared, so it does not touch the reuse verdict
  await decide(r, { stop: stop.id, fresh: true }, ['Plan the store again.\n.', stop.id, 'y'], 'leg 5');
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });
  assert.deepEqual(eventsOf(r).filter(e => e.event === 'generation_opened').at(-1)?.nodes.map(n => `${n.node}@g${n.generation}`).sort(), ['R/M1@g2', 'R/M2@g2'], 'leg 6: the replaced R/M1 and its consumer R/M2 are opened at 2');
  await approve(r, 'leg 7');
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: start });
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.deepEqual([pending?.parent?.node, pending?.parent?.generation], ['R/M1', 2], `leg 8: R/M1@g2's own children frontier waits (${JSON.stringify(pending?.parent)}; ${JSON.stringify(phases(r))})`);
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  assert.deepEqual((d.preview.candidates ?? []).filter(c => c.fate === 'adopted').map(({ key, fate, reason, slot }) => ({ key, fate, reason, slot })), [{ key: ADOPTED, fate: 'adopted', reason: 'same', slot: 'R/M1/M3@g2' }], `leg 8: the comparison adopts R/M1/M3@g1 into its own path, and only it (${JSON.stringify(d.preview.candidates)})`);
  const slot = d.preview.children.find(c => c.node === 'R/M1/M3');
  assert.deepEqual([slot?.reused?.adoptsNode, slot?.reused?.adoptsGeneration], ['R/M1/M3', 1], `leg 8: the preview's slot carries the reuse (${JSON.stringify(d.preview.children)})`);
  await approve(r, 'leg 9');
  return { r, start, frontier: pending.key };
}

test('NESTED adoption by real verbs: R/M1@g2\'s children frontier adopts the finished R/M1/M3@g1; a stop on it (its HANDOFF.md changed) makes it ineligible for the next root re-plan (ineligibleBelowRoot lists it); before the stop it is not listed (control)', { timeout: 900_000 }, async () => {
  const { r, start, frontier } = await nestedAdoption();
  const st0 = state(r);
  assert.deepEqual([...st0.adopted.entries()].map(([k, v]) => [k, v.slot]), [[ADOPTED, 'R/M1/M3@g2']], 'the adoption is in force: the nested one, in place');
  assert.equal(st0.adopted.get(ADOPTED).frontierKey, frontier, 'by the approval of R/M1@g2\'s children frontier');
  const f = st0.frontiers.get(frontier);
  assert.deepEqual([f.parentNode, f.parentGeneration], ['R/M1', 2]);
  // why the walk by the node's OWN frontier missed it: that frontier's parent is R/M1@g1, which the regenerate decision made dead
  const own = st0.frontiers.get(st0.nodes.get(ADOPTED).frontierKey);
  assert.deepEqual([own.parentNode, own.parentGeneration], ['R/M1', 1]);
  assert.ok(deadKeys(st0).has('R/M1@g1') && !deadKeys(st0).has(ADOPTED), 'R/M1@g1 is dead; the adopted node is live');
  assert.equal(ineligibleBelowRoot(st0).includes(ADOPTED), false, `control: finished and passed, no stop: holdable (${JSON.stringify(ineligibleBelowRoot(st0))})`);
  const runId = st0.nodes.get(ADOPTED).runId;
  writeFileSync(join(r.t.runsDir, runId, 'HANDOFF.md'), `${readFileSync(join(r.t.runsDir, runId, 'HANDOFF.md'), 'utf8')}\nA late change to the adopted run.\n`);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });                            // the sitting meets the changed file: a stop on R/M1/M3@g1
  const opened = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.node === 'R/M1/M3' && e.generation === 1);
  assert.equal(opened.length, 1, `the real cause opened ONE stop on the adopted node (${JSON.stringify(eventsOf(r).filter(e => e.event === 'needs_decision_opened').map(e => [e.id, e.node, e.generation, e.source]))})`);
  const st = state(r);
  assert.ok(ineligibleBelowRoot(st).includes(ADOPTED), `the nested adopted node is judged BY PLACE, under R/M1@g2 under R@g1: ${JSON.stringify(ineligibleBelowRoot(st))}`);
});

test('NESTED adoption by real verbs, the root re-plan: with the tree finished, a stop on the adopted R/M1/M3@g1 puts it in the affected set of the decision that plans the root again (T10 (1)\'s assertion, one level down)', { timeout: 900_000 }, async () => {
  const { r, start } = await nestedAdoption();
  let s = null;
  for (let i = 0; i < 8; i += 1) s = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 5, startRun: start });       // a FIXED number of sittings: the new children and the consumer R/M2@g2 run (a person's root stop needs a finished tree)
  assert.ok(state(r).adopted.has(ADOPTED), `the adoption still holds after the sittings (${JSON.stringify(s)})`);
  const runId = state(r).nodes.get(ADOPTED).runId;
  writeFileSync(join(r.t.runsDir, runId, 'HANDOFF.md'), `${readFileSync(join(r.t.runsDir, runId, 'HANDOFF.md'), 'utf8')}\nA late change to the adopted run.\n`);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });
  assert.ok(eventsOf(r).some(e => e.event === 'needs_decision_opened' && e.node === 'R/M1/M3' && e.generation === 1), `a stop on the adopted node (last sitting before the change: ${JSON.stringify(s)})`);
  await decide(r, { 'open-root-stop': true }, ['The adopted export format no longer matches its run: plan again.\n.', 'R@g1', 'y'], 'the root stop');
  const rootStop = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.node === 'R').at(-1);
  await decide(r, { stop: rootStop.id }, ['Plan it again.\n.', rootStop.id, 'y'], 'the root re-plan');
  const dec = eventsOf(r).filter(e => e.event === 'decision_recorded' && e.stopId === rootStop.id).at(-1);
  assert.equal(dec.replansRoot, true);
  assert.ok(keys(dec.affected).includes(ADOPTED), `the nested adopted R/M1/M3@g1 is in the decision's affected: ${JSON.stringify(keys(dec.affected))}`);
});
