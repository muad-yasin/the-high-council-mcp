// 0.8.3 M6 S2: `council tree check <rootId> <id> pass|fail` for AGREEMENTS (src/tree-check.js; version binding in src/tree-ready.js bindingOf / integrationStatusOf). Real all-mock trees on the milestone mock
// (mock-handoff-split-milestones): root R splits into R/M1 (provider), R/M2 (consumer, expects A1 from R/M1) and R/M3 (independent); every milestone ready; one agreement A1 from R/M1 to R/M2. Design:
// Review/Build_0.8.3/M6_S2_Design_Note_2026-10-11.md (section numbers in the titles); rulings rows 70-77, 111-113. Held items other than agreements are not addressable yet (their own commit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson } from '../src/thin-contract.js';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { affectedFor } from '../src/tree-affected.js';
import { readLedger } from '../src/gate-ledger.js';
import { carriersOf } from '../src/tree-obligation.js';
import { decideHandler } from '../src/tree-decide.js';
import { runTree } from '../src/tree-run.js';
import { bindingOf, gatherReadinessFacts, heldTargetsOf, integrationStatusOf, readinessOf } from '../src/tree-ready.js';
import { REFUSED_CODES, buildCheck, checkHandler, recordCheck, resolveCheckTarget } from '../src/tree-check.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { heldGuardMilestoneChildren, heldKindsMilestoneChildren, splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, blockKinds, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { assertBoundTextClean, assertRefusedWithoutAsking, dirty, dirtyMarked } from './helpers/bound-text.js';
import { presenceProblems } from './helpers/event-presence.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const PREFACE = 'REVISED MOCK DELIVERABLE\n\n';
const A1 = 'R@g1:A1';
const codes = r => r.reasons.map(x => x.code);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- fixtures
const rootBlock = () => { const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null }; return b; };
async function finishedTree(over = {}) {
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(over.block ?? rootBlock(), { preface: PREFACE }) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
/** The scripted terminal for the verb. No answers = stdin closed at once (a wrongly asked question ends instead of waiting). */
function check(r, args, answers, { tty = true } = {}) {
  const io = terminal(answers, tty ? {} : { tty: false });
  if (answers.length === 0) io.stdin.end();
  return { io, run: () => checkHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, args, flags: {}, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }) };
}
const passA1 = async r => { const c = check(r, [A1, 'pass'], [A1, 'y']); assert.equal(await c.run(), 0, c.io.shown() + c.io.errors()); return c; };
const failA1 = async r => { const c = check(r, [A1, 'fail'], [A1, 'y']); assert.equal(await c.run(), 0, c.io.shown() + c.io.errors()); return c; };
const verdict = r => readinessOf(r.t.rootDir, { work: r.t.work });
const recorded = r => eventsOf(r).filter(e => e.event === 'integration_recorded');
const decideRegenerate = async (r, stopId, text = 'The interface changes: get(id) now returns a list.', flags = {}) => {
  const io = terminal([`${text}\n.`, stopId, 'y']);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 0, io.shown() + io.errors());
};
/** A stop of `node` as detection would write it, with its real closure (the shape tree-replace.test.js uses). */
function openStopOf(r, node) {
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const n = state.nodes.get(`${node}@g1`);
  return appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node, generation: 1, runId: n.runId, source: 'status', affected: affectedFor({ record, state, runsDir: r.t.runsDir, node }).affected });
}
const targetOf = (r, arg = A1) => { const record = readTreeRecord(r.t.rootDir); const state = stateOf(record); return { record, state, runsDir: r.t.runsDir, target: resolveCheckTarget(record, state, r.t.runsDir, arg).target }; };
const statusOf = (r, arg = A1) => { const t = targetOf(r, arg); return integrationStatusOf(t); };
/** Appends raw lines to the record (ids continue; the table is the writers' job), for the shapes no real verb writes. */
function rawEvents(r, list) {
  let n = Number(readTreeRecord(r.t.rootDir).events.at(-1).id.slice(1));
  for (const ev of list) { n += 1; appendFileSync(join(r.t.rootDir, 'tree', 'events.jsonl'), `${JSON.stringify({ schema: 'tree-events/1', id: `e${n}`, at: new Date().toISOString(), ...ev })}\n`); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- exit 1 (the verdict part) and the event
test('M6 exit 1 / 1.5: a real tree on the milestone mock is incomplete NAMING R@g1:A1; typing the id records a pass; the tree is ready; the event is complete and bound', async () => {
  const { r } = await finishedTree();
  const before = verdict(r);
  assert.equal(before.verdict, 'incomplete', JSON.stringify(before.reasons));
  assert.deepEqual(before.reasons.map(x => [x.code, x.scope]), [['integration_unrecorded', A1]]);
  assert.deepEqual(before.inputs.integrations, [], 'nothing recorded: nothing listed');
  const c = await passA1(r);
  const [e] = recorded(r);
  assert.equal(recorded(r).length, 1);
  assert.deepEqual([e.agreement, e.result], [A1, 'pass']);
  assert.ok(e.gateId); assert.match(e.shownSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(e.bound).sort(), ['agreementId', 'agreementTextSha256', 'kind', 'owningGeneration', 'owningNode', 'participants', 'splitSha256']);
  assert.deepEqual([e.bound.kind, e.bound.owningNode, e.bound.owningGeneration, e.bound.agreementId], ['agreement', 'R', 1, 'A1']);
  assert.equal(e.bound.splitSha256, stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R@g1').verifiedSplit.sha);
  assert.deepEqual(e.bound.participants.map(p => [p.node, p.generation]), [['R/M1', 1], ['R/M2', 1]], 'the two children of the agreement and every node of their subtrees (leaves here), sorted by path');
  for (const p of e.bound.participants) assert.match(p.thinContractSha256, /^[0-9a-f]{64}$/);
  const after = verdict(r);
  assert.equal(after.verdict, 'ready', JSON.stringify(after.reasons));
  assert.deepEqual(after.inputs.integrations.map(i => [i.target, i.result, i.complete, i.current]), [[A1, 'pass', true, true]]);
  assert.ok(c.io.shown().includes('To approve, type the id: R@g1:A1'));
  assert.deepEqual(presenceProblems(eventsOf(r)), [], 'the event carries its fields (event-presence audit)');
  // M6 S3b (PLAN 9.2): the verb records the verdict it just changed, right after the result
  const tail = eventsOf(r).slice(-2);
  assert.deepEqual(tail.map(e => e.event), ['integration_recorded', 'readiness']); assert.equal(tail[1].verdict, 'ready');
});

test('1.5 one binding: a pass the verb recorded reads as CURRENT because the reader recomputes the same bindingOf (the pin is behaviour: the recorded bound equals bindingOf now, byte for byte in canonical JSON)', async () => {
  const { r } = await finishedTree();
  await passA1(r);
  const t = targetOf(r);
  assert.equal(canonicalJson(bindingOf(t)), canonicalJson(recorded(r)[0].bound));
  assert.equal(statusOf(r).current, true);
});
test('TRIPWIRE (not a pin): exactly one construction of `agreementTextSha256` in src/, inside tree-ready.js (the writer and the reader share bindingOf)', () => {
  const src = join(import.meta.dirname, '..', 'src');
  const hits = readdirSync(src).filter(f => f.endsWith('.js')).filter(f => /agreementTextSha256\s*[:=]/.test(readFileSync(join(src, f), 'utf8')));
  assert.deepEqual(hits, ['tree-ready.js']);
});

test('1.2 the gate text is shown, hashed and recorded clean: a control character and a bidi mark in an agreement\'s `what` (model-written, in the verified block) are gone from the gate text, the screen and the hash', async () => {
  const word = dirtyMarked('K1 exposes get and put on the store', 12);
  const b = rootBlock(); b.agreements[0].what = `${word.raw}.`;
  const { r } = await finishedTree({ block: b });
  const c = await passA1(r);
  assertBoundTextClean({ rootDir: r.t.rootDir, shownSha256: recorded(r)[0].shownSha256, shown: c.io.shown(), word: `${word.clean}.`, kind: 'tree_check' });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- exit 2: version-bound
test('M6 exit 2: a pass for A1 between R/M1@g1 and R/M2@g1; a stop on the PROVIDER regenerates BOTH (the affected set), both new generations run; the old pass no longer counts; ready only after A1 is recorded again for g2/g2', async () => {
  const { r, start } = await finishedTree();
  await passA1(r);
  assert.equal(verdict(r).verdict, 'ready');
  await decideRegenerate(r, openStopOf(r, 'R/M1').id);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });                          // recovery opens the generations
  approvePending(r); await runTree(r.t.rootDir, { work: r.t.work, startRun: start });                     // R/M1@g2 and R/M2@g2 run
  const facts = gatherReadinessFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(facts.nodes.filter(n => n.node !== 'R').map(n => [n.node, n.generation]).sort(), [['R/M1', 2], ['R/M2', 2], ['R/M3', 1]]);
  const stale = verdict(r);
  assert.notEqual(stale.verdict, 'ready'); assert.ok(stale.reasons.some(x => x.code === 'integration_unrecorded' && x.scope === A1), JSON.stringify(stale.reasons));
  assert.deepEqual(stale.inputs.integrations.map(i => [i.target, i.result, i.current]), [[A1, 'pass', false]], 'the old pass is listed, and it is not current');
  assert.equal(recorded(r).length, 1, 'nothing was edited: the old event stands');
  await passA1(r);
  assert.deepEqual(recorded(r).map(e => e.bound.participants.map(p => `${p.node}@g${p.generation}`)), [['R/M1@g1', 'R/M2@g1'], ['R/M1@g2', 'R/M2@g2']]);
  assert.equal(verdict(r).verdict, 'ready');
});

test('2 (extra case): only the CONSUMER regenerates: R/M1@g1 + R/M2@g2 makes the old pass stale as well', async () => {
  const { r, start } = await finishedTree();
  await passA1(r);
  await decideRegenerate(r, openStopOf(r, 'R/M2').id);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });
  approvePending(r); await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const f = gatherReadinessFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(f.nodes.filter(n => n.node === 'R/M1' || n.node === 'R/M2').map(n => [n.node, n.generation]), [['R/M1', 1], ['R/M2', 2]]);
  assert.notEqual(verdict(r).verdict, 'ready'); assert.deepEqual(verdict(r).inputs.integrations.map(i => i.current), [false]);
});

test('2 (subtree): a node registered LATER anywhere in a participant\'s subtree makes the old pass stale (the whole subtree is bound), and a changed thin-contract pin does too', async () => {
  const { r } = await finishedTree();
  await passA1(r);
  assert.equal(statusOf(r).current, true);
  // a new node under R/M1 (a child registered later, written by hand: no real verb registers under a leaf)
  rawEvents(r, [{ event: 'node_registered', node: 'R/M1/Z', generation: 1, runId: 'run-late', attempt: 1, depth: 2, parentNode: 'R/M1', frontierKey: null, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' } }]);
  const st = statusOf(r);
  assert.deepEqual(st.now.participants.map(p => p.node), ['R/M1', 'R/M1/Z', 'R/M2'], 'the new node is in the binding');
  assert.equal(st.current, false); assert.equal(st.result, 'pass');
});

test('2 (pin): a changed thin-contract pin of a participant makes the old pass stale, and a fresh recording is refused ("changed since it closed")', async () => {
  const { r } = await finishedTree();
  await passA1(r);
  assert.equal(statusOf(r).current, true);
  const m2 = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(n => n.node === 'R/M2');
  const f = join(r.t.runsDir, m2.runId, 'report.json'); const rep = JSON.parse(readFileSync(f, 'utf8'));
  rep.thin_contract = { ...rep.thin_contract, sha256: 'e'.repeat(64) }; writeFileSync(f, JSON.stringify(rep));
  assert.equal(statusOf(r).current, false, 'the recorded bound no longer equals the binding now');
  assert.notEqual(verdict(r).verdict, 'ready');
  await assertRefusedWithoutAsking(check(r, [A1, 'fail'], []), /changed since it closed|cannot cut|cannot be bound/);
});

test('2 (pins): an INCOMPLETE event never counts (no gateId, no shownSha256, no bound, one bound field altered by one character, a participant dropped), and the NEWEST event decides - on ONE tree, with the unaltered event as the control between the variants', async () => {
  const { r } = await finishedTree();
  await passA1(r);
  const good = recorded(r)[0];
  const goodFields = { gateId: good.gateId, shownSha256: good.shownSha256, actor: good.actor, via: good.via, bound: good.bound };       // K10 (EDITED; OLD: gate fields + bound; NEW: and who answered, which the real verb wrote on `good`; WHY: the table requires it on a new integration result)
  const variants = [
    { gateId: undefined }, { shownSha256: undefined }, { bound: undefined },
    { bound: { ...good.bound, splitSha256: `${good.bound.splitSha256.slice(0, 63)}0` } },
    { bound: { ...good.bound, participants: good.bound.participants.slice(1) } },
    { bound: { ...good.bound, agreementTextSha256: `${good.bound.agreementTextSha256.slice(0, 63)}0` } },
  ];
  assert.equal(verdict(r).verdict, 'ready', 'the recorded pass counts');
  const append = fields => appendTreeEvent(r.t.rootDir, { event: 'integration_recorded', agreement: A1, result: 'pass', ...Object.fromEntries(Object.entries(fields).filter(([, val]) => val !== undefined)) });
  for (const [i, v] of variants.entries()) {
    append({ ...goodFields, ...v });
    assert.notEqual(verdict(r).verdict, 'ready', `variant ${i} must not count (the newest event decides)`);
    append(goodFields);                                                            // the control: the unaltered event, appended last, counts again on this very tree
    assert.equal(verdict(r).verdict, 'ready', `after variant ${i} the unaltered event counts again, so the variant was refused for its own defect`);
  }
  // a bare pass appended after a good pass: not ready, though an older complete current pass exists (fail-closed)
  append({});
  assert.notEqual(verdict(r).verdict, 'ready'); assert.deepEqual(verdict(r).inputs.integrations.map(i => [i.complete, i.current]), [[false, false]]);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- exit 6: fail
test('M6 exit 6 / 1.7: `check ... fail` writes the result and a NODE-LESS integration stop in one hold; its affected set holds R/M1 and R/M2 (never R, never the independent R/M3); no root_affected; the tree is blocked with integration_failed', async () => {
  const { r } = await finishedTree();
  const c = await failA1(r);
  const ev = eventsOf(r);
  const shownList = ev.find(e => e.event === 'needs_decision_opened' && e.source === 'integration').affected.map(a => `${a.node}@g${a.generation}`).join(', ');
  assert.ok(c.io.shown().includes(`stops these nodes: ${shownList}.`), 'the person was shown exactly the nodes the stop then holds');
  const i = ev.findIndex(e => e.event === 'integration_recorded');
  assert.equal(ev[i].result, 'fail'); assert.equal(ev[i + 1].event, 'needs_decision_opened', 'adjacent: one lock hold');
  const stop = ev[i + 1];
  assert.equal(stop.source, 'integration'); assert.equal(stop.agreement, A1); assert.equal(Object.hasOwn(stop, 'node'), false, 'a node-less stop');
  const nodes = stop.affected.map(a => a.node);
  assert.ok(nodes.includes('R/M1') && nodes.includes('R/M2')); assert.equal(nodes.includes('R'), false); assert.equal(nodes.includes('R/M3'), false);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).sticky.has('root_affected'), false);
  const v = verdict(r);
  assert.equal(v.verdict, 'blocked'); assert.ok(codes(v).includes('integration_failed') && codes(v).includes('open_stop'), JSON.stringify(v.reasons));
  assert.deepEqual(presenceProblems(ev), []);
});

test('1.7 an integration stop is answered by `decide --stop <id>` (no other option), even while another stop is open: the decision is recorded (form regenerate, stopId the stop), the affected nodes keep their stale marks, and the next sitting opens their new generations', async () => {
  const { r, start } = await finishedTree();
  const c = await failA1(r);
  const stop = eventsOf(r).find(e => e.event === 'needs_decision_opened' && e.source === 'integration');
  assert.ok(c.io.shown().includes(`stop ${stop.id} is open. \`council tree decide ${ROOT_ID} --stop ${stop.id}\` answers it`), 'the route is named only because THIS test runs exactly that form');
  openStopOf(r, 'R/M3');                                                           // a SECOND stop is open: the form with --stop still answers the integration one
  await decideRegenerate(r, stop.id, undefined, { stop: stop.id });
  const dec = eventsOf(r).find(e => e.event === 'decision_recorded');
  assert.equal(dec.form, 'regenerate'); assert.equal(dec.stopId, stop.id);
  assert.ok(stateOf(readTreeRecord(r.t.rootDir)).stale.size > 0, 'the affected nodes are held stale until their new generations exist');
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, startRun: start });
  assert.ok(eventsOf(r).some(e => e.event === 'generation_opened'));
});

test('1.6.5 a second `fail` at the same versions is refused as a duplicate (one open stop per failure), writing nothing', async () => {
  const { r } = await finishedTree();
  await failA1(r);
  const n = eventsOf(r).length;
  await assertRefusedWithoutAsking(check(r, [A1, 'fail'], []), /already recorded at these versions/);
  assert.equal(eventsOf(r).length, n);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- refusals (1.1, 1.6)
test('refusals ask nobody and write nothing: an unknown id; a result that is not pass or fail (exit 2); a second pass while one is current', async () => {
  const { r } = await finishedTree();
  const ledgerOf = () => (existsSync(join(r.t.rootDir, 'gate-ledger.jsonl')) ? readFileSync(join(r.t.rootDir, 'gate-ledger.jsonl'), 'utf8') : '');
  const events0 = eventsOf(r).length; const ledger0 = ledgerOf();
  await assertRefusedWithoutAsking(check(r, ['R@g1:A9', 'pass'], []), /no agreement or held item named "R@g1:A9" in this tree/);   // C&C row 119: the refusal names both things the id could have named
  for (const word of ['Pass', 'PASS', 'yes', 'ok', '1', '']) await assertRefusedWithoutAsking(check(r, [A1, word], []), /exactly pass or fail/, { code: 2 });
  await assertRefusedWithoutAsking(check(r, [A1], []), /exactly pass or fail/, { code: 2 });
  assert.equal(eventsOf(r).length, events0); assert.equal(ledgerOf(), ledger0, 'no gate was requested by any refusal');
  await passA1(r);
  await assertRefusedWithoutAsking(check(r, [A1, 'pass'], []), /already recorded and current/);
});

test('1.4 a bare id that only one node holds resolves; a qualified id of a thing that is not an agreement is refused', async () => {
  const { r } = await finishedTree();
  const t = targetOf(r, 'A1');
  assert.deepEqual([t.target.qid, t.target.from, t.target.to], [A1, 'R/M1', 'R/M2']);
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  assert.match(resolveCheckTarget(record, state, r.t.runsDir, 'R@g1:M1').refusal, /no agreement/);
  assert.match(resolveCheckTarget(record, state, r.t.runsDir, 'not an id').refusal, /is not an id/);
});

test('1.6.2 rule 2: an id naming the owner\'s OLD generation is refused naming the newer one (the owner R is given an opened generation 2 by a raw event: no real verb regenerates the root)', async () => {
  const { r } = await finishedTree();
  rawEvents(r, [{ event: 'generation_opened', decisionId: 'e1', nodes: [{ node: 'R', generation: 2 }] }]);
  await assertRefusedWithoutAsking(check(r, [A1, 'pass'], []), /R is now generation 2/);
  assert.equal(recorded(r).length, 0);
});

test('1.6.1 rule 1: recording is refused while a node of either subtree has a reason from the EXACT list (a participant under an open stop is named); the list itself is written out here', async () => {
  const EXPECTED = ['generation_pending', 'not_started', 'running', 'stopped', 'closed_incomplete', 'report_unreadable', 'plan_unreadable', 'not_passed', 'unsigned_change', 'contract_check', 'no_milestone_lint', 'status_policy', 'stale', 'provider_pin',
    'split_unreadable', 'split_changed', 'expansion_refused', 'split_not_verified', 'unexpanded', 'needs_decision_unresolved', 'open_stop'];
  assert.deepEqual([...REFUSED_CODES], EXPECTED, 'the exact list');
  for (const excluded of ['integration_unrecorded', 'held_unrecorded', 'integration_failed']) assert.equal(REFUSED_CODES.includes(excluded), false, `${excluded} on a participant does not refuse (two held items on one subtree would refuse each other)`);
  const { r } = await finishedTree();
  openStopOf(r, 'R/M1');
  await assertRefusedWithoutAsking(check(r, [A1, 'pass'], []), /R\/M1@g1 - (open_stop|stale)/);
  assert.equal(recorded(r).length, 0);
});

test('1.6.4 UNREACHABLE (not a behaviour claim): "a pass after a fail at the same versions" cannot happen through a real verb. While the fail\'s stop is open the pass is refused; once `decide` answers the stop the affected nodes carry held stale marks and rule 1 refuses until their new generations exist, which change the versions', async () => {
  const { r } = await finishedTree();
  await failA1(r);
  await assertRefusedWithoutAsking(check(r, [A1, 'pass'], []), /an integration stop \(e\d+\) is open/);
  const stop = eventsOf(r).find(e => e.event === 'needs_decision_opened' && e.source === 'integration');
  await decideRegenerate(r, stop.id);
  await assertRefusedWithoutAsking(check(r, [A1, 'pass'], []), /R\/M\d@g1 - stale/);
});

test('terminal only: no terminal -> exit 2 and nothing written; stdin EOF before the typed id, a wrong typed id, and a decline write nothing', async () => {
  const { r } = await finishedTree();
  const n = eventsOf(r).length;
  const notty = check(r, [A1, 'pass'], [], { tty: false }); assert.equal(await notty.run(), 2); assert.equal(eventsOf(r).length, n);
  const wrong = check(r, [A1, 'pass'], ['R@g1:A2', 'y']); assert.equal(await wrong.run(), 1); assert.equal(eventsOf(r).length, n);
  const no = check(r, [A1, 'pass'], [A1, 'n']); assert.equal(await no.run(), 1); assert.equal(eventsOf(r).length, n);
  assert.equal(readdirSync(join(r.t.rootDir, 'tree', 'gate-texts')).filter(f => f.startsWith('tree_check-')).length >= 1, true, 'the asked ones requested a gate (the no-terminal one did not need to)');
});

test('1.2 after the yes: a participant that changed while the person read is caught by the rebuild (exit 1, the approval NOT used, nothing recorded); the binding is checked again INSIDE the lock for a change after that (recordCheck refuses, nothing recorded)', async () => {
  const { r } = await finishedTree();
  const n0 = eventsOf(r).length;
  const io = terminal([A1, 'y']);
  io.stdout.on('data', d => { if (/\[y\/N\]/.test(String(d)) && !io.__done) { io.__done = true; openStopOf(r, 'R/M1'); } });
  const code = await checkHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, args: [A1, 'pass'], flags: {}, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 1, io.shown() + io.errors()); assert.match(io.errors(), /what you were shown has changed|cannot be bound yet/);
  assert.equal(recorded(r).length, 0, 'nothing was recorded'); assert.equal(eventsOf(r).length, n0 + 1, 'only the stop the test itself wrote');
  assert.equal((readLedger(r.t.rootDir).lines ?? []).filter(l => l.event === 'tree_checked').length, 0, 'the approval was not spent');
});

test('1.2 INSIDE the lock: recordCheck recomputes every rule and the binding before the first append; a participant changed after the person read, or a binding that is not the one shown, is a TreeRefusal and nothing is appended', async () => {
  const { r } = await finishedTree();
  const input = { rootDir: r.t.rootDir, work: r.t.work, arg: A1, result: 'pass', gateId: 'g-test', shownSha256: 'a'.repeat(64), actor: 'person', via: 'terminal' };
  const shown = buildCheck(input);
  assert.equal(shown.refusal, undefined);
  const n0 = eventsOf(r).length;
  // (a) the binding shown is not the binding now: nothing is recorded
  const wrongBound = { ...shown, bound: { ...shown.bound, splitSha256: 'b'.repeat(64) } };
  assert.throws(() => recordCheck({ ...input, shown: wrongBound }), e => e instanceof TreeRefusal && /changed while you were reading/.test(e.reason));
  assert.equal(eventsOf(r).length, n0);
  // (b) a participant changed after the text was built: the rules fail inside the lock
  openStopOf(r, 'R/M1');
  assert.throws(() => recordCheck({ ...input, shown }), e => e instanceof TreeRefusal && /no longer holds/.test(e.reason));
  assert.equal(recorded(r).length, 0); assert.equal(eventsOf(r).length, n0 + 1, 'only the stop the test itself wrote');
  // (c) the control: with nothing changed, the same call records
  const fresh = await finishedTree();
  const ok = recordCheck({ rootDir: fresh.r.t.rootDir, work: fresh.r.t.work, arg: A1, result: 'pass', shown: buildCheck({ rootDir: fresh.r.t.rootDir, work: fresh.r.t.work, arg: A1, result: 'pass' }), gateId: 'g-test', shownSha256: 'a'.repeat(64), actor: 'person', via: 'terminal' });
  assert.equal(ok.event.result, 'pass'); assert.equal(recorded(fresh.r).length, 1);
});

test('1.7 a fail whose affected set changed between the text and the lock is refused inside it (the person approved a list of nodes to stop)', async () => {
  const { r } = await finishedTree();
  const input = { rootDir: r.t.rootDir, work: r.t.work, arg: A1, result: 'fail', gateId: 'g-test', shownSha256: 'a'.repeat(64), actor: 'person', via: 'terminal' };
  const shown = buildCheck(input);
  assert.ok(shown.affected.length >= 2);
  const n0 = eventsOf(r).length;
  assert.throws(() => recordCheck({ ...input, shown: { ...shown, affected: shown.affected.slice(1) } }), e => e instanceof TreeRefusal && /nodes a failure would stop changed/.test(e.reason));
  assert.equal(eventsOf(r).length, n0);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- held items (design 1.4, rows 72-73)
/** A finished tree whose children carry a REAL held item: `kinds` = a check the child chain cannot enforce (check_not_enforced), `guard` = an item the child chain's guard refused (context only). Every milestone ready. */
async function heldTree(which) {
  const opts = which === 'kinds' ? heldKindsMilestoneChildren() : heldGuardMilestoneChildren();
  const b = which === 'kinds' ? blockKinds() : rootBlock();
  b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...opts, plan: planWith(b, { preface: PREFACE }) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
const heldReasons = r => verdict(r).reasons.filter(x => x.code === 'held_unrecorded');
const passOf = async (r, id) => { const c = check(r, [id, 'pass'], [id, 'y']); assert.equal(await c.run(), 0, c.io.shown() + c.io.errors()); return c; };

test('1.4 a REAL check_not_enforced item: the tree is incomplete naming it by its ORIGIN label (R@g1:C2, what `decide --obligation` takes), typing that label records a pass bound to every node that carries it; the agreement is a separate target', async () => {
  const { r } = await heldTree('kinds');
  const held = heldReasons(r);
  assert.deepEqual(held.map(x => x.scope), ['R@g1:C2'], JSON.stringify(verdict(r).reasons));
  assert.match(held[0].text, /^check not enforced R@g1:C2 \(/);
  const before = verdict(r);
  assert.deepEqual(before.reasons.map(x => [x.code, x.scope]).sort(), [['held_unrecorded', 'R@g1:C2'], ['integration_unrecorded', A1]].sort());
  const c = await passOf(r, 'R@g1:C2');
  const [e] = recorded(r);
  assert.equal(e.agreement, 'R@g1:C2'); assert.equal(e.bound.kind, 'obligation'); assert.match(e.bound.obligationKey, /^[0-9a-f]{64}$/);
  assert.ok(e.bound.participants.length >= 1 && e.bound.participants.every(p => /^[0-9a-f]{64}$/.test(p.thinContractSha256)));
  assert.ok(c.io.shown().includes('Held item R@g1:C2 (check not enforced)') && c.io.shown().includes('carried by: R/M1@g1'), c.io.shown());
  assert.deepEqual(heldReasons(r), [], 'the held item is recorded'); assert.deepEqual(verdict(r).reasons.map(x => x.scope), [A1], 'the agreement is still open: its own target');
  await passA1(r);
  assert.equal(verdict(r).verdict, 'ready', JSON.stringify(verdict(r).reasons));
  assert.deepEqual(presenceProblems(eventsOf(r)), []);
});

test('1.4 a REAL guard-refused item (context only) is addressed the same way; the OVERLAP: a held check and the agreement share R/M1 in their participants and record in EITHER order (a held/agreement reason on a participant does not refuse)', async () => {
  const a = await heldTree('guard');
  assert.deepEqual(heldReasons(a.r).map(x => x.scope), ['R@g1:C2']); assert.match(heldReasons(a.r)[0].text, /^guard refused R@g1:C2 \(/);
  await passOf(a.r, 'R@g1:C2'); await passA1(a.r);                      // held first, then the agreement
  assert.equal(verdict(a.r).verdict, 'ready', JSON.stringify(verdict(a.r).reasons));
  const b = await heldTree('guard');
  await passA1(b.r); await passOf(b.r, 'R@g1:C2');                      // the agreement first, then the held item
  assert.equal(verdict(b.r).verdict, 'ready', JSON.stringify(verdict(b.r).reasons));
  assert.equal(statusOf(a.r).current, true, 'recording the held item did not stale the agreement (its bound does not include the obligation)');
});

test('1.4 every `scope` S1 produces resolves to exactly one target (agreement qids and held labels), through resolveCheckTarget; a held label that names nothing is refused; a bare held id is not an address', async () => {
  for (const which of ['kinds', 'guard']) {
    const { r } = await heldTree(which);
    const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
    for (const x of verdict(r).reasons.filter(q => q.code === 'integration_unrecorded' || q.code === 'held_unrecorded')) {
      const res = resolveCheckTarget(record, state, r.t.runsDir, x.scope);
      assert.equal(res.refusal, undefined, `${x.scope}: ${res.refusal}`); assert.equal(res.target.qid, x.scope);
    }
    // row 119 (b): held is not carried - every held target's carriers are a subset of carriersOf(its origin) minus the origin node, on both real fixtures
    for (const t of heldTargetsOf({ record, state })) {
      const m = /^(R(?:\/[A-Za-z][A-Za-z0-9_-]*)*)@g(\d+):(.+)$/.exec(t.label);
      const carried = carriersOf({ record, state, origin: { node: m[1], generation: Number(m[2]), id: m[3] } }).filter(p => p !== m[1]);
      assert.ok(t.carriers.length >= 1 && t.carriers.every(c => carried.includes(c.node)), `${t.label}: held ${JSON.stringify(t.carriers.map(c => c.node))} within carried-minus-origin ${JSON.stringify(carried)}`);
    }
    assert.match(resolveCheckTarget(record, state, r.t.runsDir, 'R@g1:C9').refusal, /no agreement/);
    assert.match(resolveCheckTarget(record, state, r.t.runsDir, 'C2').refusal, /no agreement/, 'a bare id addresses agreements only');
  }
});

test('1.7 a FAIL on a held item opens the node-less integration stop with the carriers\' closure; a held pass goes stale when a carrier regenerates', async () => {
  const { r, start } = await heldTree('kinds');
  const c = check(r, ['R@g1:C2', 'fail'], ['R@g1:C2', 'y']); assert.equal(await c.run(), 0, c.io.shown() + c.io.errors());
  const stop = eventsOf(r).find(e => e.event === 'needs_decision_opened' && e.source === 'integration');
  assert.equal(stop.agreement, 'R@g1:C2'); assert.equal(Object.hasOwn(stop, 'node'), false);
  assert.ok(stop.affected.some(a => a.node === 'R/M1')); assert.equal(stop.affected.some(a => a.node === 'R'), false);
  assert.ok(codes(verdict(r)).includes('integration_failed'));
  const other = await heldTree('kinds');
  await passOf(other.r, 'R@g1:C2');
  assert.equal(statusOf(other.r, 'R@g1:C2').current, true);
  await decideRegenerate(other.r, openStopOf(other.r, 'R/M1').id);
  await runTree(other.r.t.rootDir, { work: other.r.t.work, maxStarts: 0, startRun: other.start });
  approvePending(other.r); await runTree(other.r.t.rootDir, { work: other.r.t.work, startRun: other.start });
  assert.equal(statusOf(other.r, 'R@g1:C2').current, false, 'R/M1 is generation 2: the old pass is history');
  void start;
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- gate and ledger (Q1)
test('Q1: a tree_check gate is used ONCE and spends tree_checked, naming the agreement and the result', async () => {
  const { r } = await finishedTree();
  await passA1(r);
  const uses = readLedger(r.t.rootDir).lines.filter(l => l.event === 'tree_checked');
  assert.equal(uses.length, 1);
  assert.deepEqual([uses[0].agreement, uses[0].result], [A1, 'pass']);
  assert.equal(uses[0].gate, recorded(r)[0].gateId, 'the event names the gate whose approval it spent');
});
