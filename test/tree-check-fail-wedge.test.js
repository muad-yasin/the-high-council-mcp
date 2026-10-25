// 0.8.3 M6 check-fail wedge (src/tree-check.js integrationGapsOf + failAffectedOf, src/tree-detect.js detectIntegrationStops, the sitting in src/tree-run.js). `council tree check <id> fail` writes `integration_recorded` and then the
// node-less integration stop in one lock hold; a process that ended between the two appends left a failure with no stop: readiness `integration_failed`, nothing to answer, and `tree check fail` refused the duplicate of a
// stop that did not exist. Every state here is made by the real verbs on a real all-mock tree (the milestone mock of test/tree-check.test.js); the crash state is made by TRUNCATING events.jsonl at the stop (the record has no hash
// chain, so what is left reads clean and is exactly what a kill between the two appends leaves). Nothing is written by hand except that cut and, in the last test, one moved plan file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { runTree } from '../src/tree-run.js';
import { sittingLines } from '../src/tree-resume.js';
import { readinessOf } from '../src/tree-ready.js';
import { checkHandler } from '../src/tree-check.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { assertRefusedWithoutAsking } from './helpers/bound-text.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const A1 = 'R@g1:A1';
const rootBlock = () => { const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null }; return b; };
async function finishedTree() {
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(rootBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
function check(r, args, answers) {
  const io = terminal(answers);
  if (answers.length === 0) io.stdin.end();
  return { io, run: () => checkHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, args, flags: {}, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }) };
}
const record = async (r, result) => { const c = check(r, [A1, result], [A1, 'y']); assert.equal(await c.run(), 0, c.io.shown() + c.io.errors()); };
const integrationStops = r => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'integration');
/** The state a kill between the verb's two appends leaves: the file cut at the stop, so the failure is the last record. */
function crashAtStop(r) {
  const file = join(r.t.rootDir, 'tree', 'events.jsonl');
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const cut = lines.findIndex(l => { const e = JSON.parse(l); return e.event === 'needs_decision_opened' && e.source === 'integration'; });
  assert.ok(cut > 0, 'the real verb wrote a stop to cut');
  writeFileSync(file, `${lines.slice(0, cut).join('\n')}\n`);
  assert.equal(eventsOf(r).at(-1).event, 'integration_recorded', 'the failure is the last record');
  assert.equal(integrationStops(r).length, 0);
}
const sitting = (r, start) => runTree(r.t.rootDir, { work: r.t.work, startRun: start });
const verdict = r => readinessOf(r.t.rootDir, { work: r.t.work });
const bare = e => { const { id, at, ...rest } = e; return rest; };

test('the crash state wedges today and a sitting repairs it: the failure with no stop gets its stop (no node, source integration, the agreement named); the tree is blocked on integration_failed + open_stop, and a second sitting writes nothing more', async () => {
  const { r, start } = await finishedTree();
  await record(r, 'fail');
  crashAtStop(r);
  const before = verdict(r);
  assert.equal(before.verdict, 'blocked'); assert.deepEqual(before.reasons.map(x => x.code), ['integration_failed'], 'no stop: nothing to answer');
  const res = await sitting(r, start);
  const stops = integrationStops(r);
  assert.equal(stops.length, 1, JSON.stringify(res.stops));
  assert.equal(stops[0].agreement, A1); assert.equal(Object.hasOwn(stops[0], 'node'), false);
  assert.deepEqual(res.stops.map(s => s.id), [stops[0].id], 'the sitting reports it');
  assert.match(sittingLines(res, ROOT_ID).join('\n'), new RegExp(`Stop ${stops[0].id}: the integration check of ${A1} was recorded as FAILED, but its stop was not written then`));
  assert.ok(verdict(r).reasons.map(x => x.code).includes('open_stop'));
  await sitting(r, start);
  assert.equal(integrationStops(r).length, 1, 'idempotent: the stop exists now');
});

test('the recovered stop IS the stop the verb would have written: an uncrashed twin tree and the repaired tree hold deep-equal stops (id and time aside), and the affected set is the closure of both children and is not empty', async () => {
  const twin = await finishedTree(); await record(twin.r, 'fail');
  const { r, start } = await finishedTree(); await record(r, 'fail'); crashAtStop(r); await sitting(r, start);
  const [made] = integrationStops(twin.r); const [recovered] = integrationStops(r);
  assert.ok(made && recovered);
  assert.deepEqual(bare(recovered), bare(made));
  const nodes = recovered.affected.map(a => a.node);
  assert.ok(nodes.includes('R/M1') && nodes.includes('R/M2') && !nodes.includes('R') && !nodes.includes('R/M3'), JSON.stringify(recovered.affected));
});

test('the recovered stop is answerable: `decide --stop <id>` records the regenerate decision, and `tree check fail` is refused with the right reason before the repair (the stop was never written) and after it (the stop is the duplicate)', async () => {
  const { r, start } = await finishedTree();
  await record(r, 'fail'); crashAtStop(r);
  const n = eventsOf(r).length;
  await assertRefusedWithoutAsking(check(r, [A1, 'fail'], []), /stop was never written\. Run `council tree resume`: it writes the stop once the plan files can be read/);   // EDITED in the M7 apply (E74b; old: "...never written (the process ended between the two records). Run `council tree resume`: it writes the stop once the plan files read")
  assert.equal(eventsOf(r).length, n, 'the refusal wrote nothing');
  await sitting(r, start);
  await assertRefusedWithoutAsking(check(r, [A1, 'fail'], []), /its stop is a duplicate; answer that stop instead/);
  const [stop] = integrationStops(r);
  const io = terminal([`The interface changes: get(id) now returns a list.\n.`, stop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  const dec = eventsOf(r).find(e => e.event === 'decision_recorded');
  assert.equal(dec.form, 'regenerate'); assert.equal(dec.stopId, stop.id);
});

test('nothing is written when the failure needs no stop (each case beside the control that DOES write one): a later pass superseded it; its stop exists and was answered; the versions moved on after the answer', async () => {
  // control: the crash state with nothing else writes its stop
  const control = await finishedTree(); await record(control.r, 'fail'); crashAtStop(control.r); await sitting(control.r, control.start);
  assert.equal(integrationStops(control.r).length, 1, 'control: the repair writes the stop');
  // a pass recorded after the crash: the newest result is a pass
  const passed = await finishedTree(); await record(passed.r, 'fail'); crashAtStop(passed.r);
  await record(passed.r, 'pass');
  await sitting(passed.r, passed.start);
  assert.equal(integrationStops(passed.r).length, 0, 'the newest result is a pass: no stop');
  // an uncrashed failure whose stop was answered, then the new generations run: the old failure is history
  const answered = await finishedTree(); await record(answered.r, 'fail');
  const [stop] = integrationStops(answered.r);
  const io = terminal([`The interface changes: get(id) now returns a list.\n.`, stop.id, 'y']);
  assert.equal(await decideHandler({ rootDir: answered.r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: answered.r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  await sitting(answered.r, answered.start);
  assert.equal(integrationStops(answered.r).length, 1, 'answered, then replaced: still the one stop it had');
  await sitting(answered.r, answered.start);
  assert.equal(integrationStops(answered.r).length, 1);
});

test('FAIL CLOSED: the crash state with the owner\'s plan unreadable writes NO stop, the sitting names the file and the way out, the failure stays recorded and `tree check fail` is still refused; restoring the file lets the next sitting write the stop', async () => {
  const { r, start } = await finishedTree();
  await record(r, 'fail'); crashAtStop(r);
  const owner = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R@g1');
  const plan = join(r.t.runsDir, owner.runId, 'deliverable.md');
  renameSync(plan, `${plan}.moved`);
  const res = await sitting(r, start);
  assert.equal(integrationStops(r).length, 0, 'unreadable: nothing is written');
  assert.deepEqual(res.integrationGaps.map(g => [g.agreement, g.files]), [[A1, [`${owner.runId}/report.json`, `${owner.runId}/deliverable.md`]]]);
  const text = sittingLines(res, ROOT_ID).join('\n');
  assert.match(text, new RegExp(`The integration check of ${A1} was recorded as FAILED, but its stop was not written: the plan of R@g1 cannot be read`));
  assert.ok(text.includes(`Restore the file named above (the plan is ${owner.runId}/deliverable.md, the report ${owner.runId}/report.json, in the runs folder), then run \`council tree resume ${ROOT_ID}\` again: the stop is written then.`), text);   // EDITED in the M7 apply (E74a; old: includes the deliverable path and the resume command only; pass-2 shape with the real run id)
  assert.equal(eventsOf(r).filter(e => e.event === 'integration_recorded').length, 1, 'the failure stays recorded');
  renameSync(`${plan}.moved`, plan);
  await sitting(r, start);
  assert.equal(integrationStops(r).length, 1, 'restored: the next sitting writes the stop');
});

// the sitting's own sentence for an integration stop (commit 2): the generic "Open stop ... resolve in place with --milestone <id>" line named a milestone a node-less stop does not have (`decide --milestone` refuses it), so
// an integration stop gets the ONE remedy it has, `--stop <id>`, and the generic line is not printed for it. The same sentence stands after an UNCRASHED `tree check fail` (the stop the verb wrote itself) and after a recovered one.
test('the sitting names the one remedy of an integration stop (--stop <id>, regenerate) and not the generic milestone line: after an uncrashed `tree check fail` and after a recovered one', async () => {
  const sentence = (id, extra = '') => `Integration stop ${id}: answer it with \`council tree decide ${ROOT_ID} --stop ${id}\` (regenerate what it affects).${extra}`;
  // (1) the verb wrote its own stop, nothing crashed
  const plain = await finishedTree(); await record(plain.r, 'fail');
  const [own] = integrationStops(plain.r);
  const ownText = sittingLines(await sitting(plain.r, plain.start), ROOT_ID).join('\n');
  assert.ok(ownText.includes(sentence(own.id)), ownText);
  assert.ok(!ownText.includes('--milestone') && !ownText.includes('Open stop'), `the generic line is not printed for an integration stop:\n${ownText}`);
  // (2) the crash state: the sitting writes the stop, says so once, and gives the same one remedy
  const crashed = await finishedTree(); await record(crashed.r, 'fail'); crashAtStop(crashed.r);
  const text = sittingLines(await sitting(crashed.r, crashed.start), ROOT_ID).join('\n');
  const [made] = integrationStops(crashed.r);
  assert.equal(text.split(sentence(made.id)).length, 2, `the sentence is printed once:\n${text}`);
  assert.ok(!text.includes('--milestone') && !text.includes('Open stop'), text);
  assert.match(text, new RegExp(`Stop ${made.id}: the integration check of ${A1} was recorded as FAILED, but its stop was not written then`));
});
