// 0.8.3 M7 apply, regenerate of a reused node (option 4, RegenSlot_Addendum2 sections 10-11): a stop on a node INSIDE an adopted branch is a stop on the branch's SLOT. Expected values, written before the run: the stop lists the closure as if the adopted root had stopped
// ([R/M1/A@g1, R/M1/A/D@g1, R/M1/C@g2]); the table accepts the decision; the recovery step opens the SLOT R/M1/B and the consumer R/M1/C at 3 and NEVER the interior path R/M1/A/D; a record with the narrower list [D@g1] folds as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { frontierKey } from '../src/tree-identity.js';
import { affectedFor } from '../src/tree-affected.js';
import { decideHandler } from '../src/tree-decide.js';
import { terminal } from './helpers/terminal.js';
import { planRecovery } from '../src/tree-recovery.js';
import { candidatesOf, subplanAffectedWanted, transitionRefusal } from '../src/tree-transitions.js';
import { FIXTURE_BOUND, IDS, ROOT_ID } from './helpers/tree-fixture.js';
import { adoptedTree } from './helpers/adoption-fixture.js';
import { adoptedNodesOf } from '../src/tree-handoff.js';
import { GATE_FIELDS } from './helpers/tree-fixture.js';

test('a stop INSIDE an adopted branch is a stop on the slot: D@g1 lists the branch closure, the decision opens the slot and the consumer, never the interior path', () => {
  const { t } = adoptedTree({ deep: true });
  const record = readTreeRecord(t.rootDir); const state = stateOf(record);
  const keys = affected => affected.map(a => `${a.node}@g${a.generation}`);
  const { affected } = affectedFor({ record, state, runsDir: t.runsDir, node: 'R/M1/A/D', generation: 1 });
  assert.deepEqual(keys(affected).sort(), ['R/M1/A/D@g1', 'R/M1/A@g1', 'R/M1/C@g2'].sort(), 'known-bad: [R/M1/A/D@g1] only, the consumer pinned to the adopted root silently loses its provider');
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1/A/D', generation: 1, runId: IDS[5], source: 'status', affected });
  appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan the child again.', form: 'regenerate', stopId: stop.id, affected: subplanAffectedWanted(stateOf(readTreeRecord(t.rootDir)), stop.id), ...GATE_FIELDS });
  const opening = planRecovery(readTreeRecord(t.rootDir), { runFactsOf: () => ({}) }).find(a => a.action === 'append' && a.event.event === 'generation_opened');
  assert.deepEqual(keys(opening.event.nodes).sort(), ['R/M1/B@g3', 'R/M1/C@g3'], 'the slot and the consumer; no interior path');
  appendTreeEvent(t.rootDir, opening.event);
  const st = stateOf(readTreeRecord(t.rootDir));
  assert.equal(st.adopted.size, 0, 'the adoption lapsed at the opening');
  assert.equal(st.maxOpened.has('R/M1/A/D'), false, 'no interior path got a generation');
});

// the decision on the branch, recorded through the table, for the rows below
function decided(t, node, generation) {
  const record = readTreeRecord(t.rootDir); const state = stateOf(record);
  const { affected } = affectedFor({ record, state, runsDir: t.runsDir, node, generation });
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node, generation, runId: state.nodes.get(`${node}@g${generation}`).runId, source: 'status', affected });       // the run of the node that really stops
  const dec = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, affected: subplanAffectedWanted(stateOf(readTreeRecord(t.rootDir)), stop.id), ...GATE_FIELDS });
  return dec;
}

test('guards of the opening: a path inside an adopted branch is never opened (guard 2), one (path, generation) twice is refused (guard 1); the slot opening itself is accepted', () => {
  const { t } = adoptedTree({ deep: true });
  const dec = decided(t, 'R/M1/A/D', 1);
  const st = stateOf(readTreeRecord(t.rootDir));
  const why = nodes => transitionRefusal(st, { id: 'x1', event: 'generation_opened', decisionId: dec.id, nodes })?.reason ?? null;
  assert.match(why([{ node: 'R/M1/A/D', generation: 3 }]), /lies inside an adopted branch/, 'known-bad: accepted, D@g3 would collide with the new plan\'s own D line');
  assert.match(why([{ node: 'R/M1/B', generation: 3 }, { node: 'R/M1/B', generation: 3 }]), /opened twice in one event/);
  assert.equal(why([{ node: 'R/M1/B', generation: 3 }, { node: 'R/M1/C', generation: 3 }]), null, 'the slot and the consumer: accepted');
});

test(':375 slot-keyed: a finished part of the branch that the decision does not list stays a clean kept candidate (not stale for good); a record that lists only the interior node folds and opens as before', () => {
  const { t } = adoptedTree({ deep: true });
  const dec = decided(t, 'R/M1/A', 1);       // A@g1 is finished, so the decision lists [A@g1, C@g2] and NOT its finished child D@g1
  assert.equal(dec.affected.some(a => a.node === 'R/M1/A/D'), false, 'D@g1 is not listed');
  const opening = planRecovery(readTreeRecord(t.rootDir), { runFactsOf: () => ({}) }).find(a => a.action === 'append' && a.event.event === 'generation_opened');
  appendTreeEvent(t.rootDir, opening.event);
  const st = stateOf(readTreeRecord(t.rootDir));
  assert.equal(st.stale.has('R/M1/A/D@g1'), false, 'known-bad: stale for good (the exemption looked for the replaced node under the SLOT\'s path)');
  assert.equal(candidatesOf(st).find(c => c.key === 'R/M1/A/D@g1')?.state, 'kept');
});

test('GOLDEN: a pre-change decision that lists only the interior node D@g1 still folds, and its opening goes to the slot (no interior path)', () => {
  const { t } = adoptedTree({ deep: true });
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1/A/D', generation: 1, runId: IDS[5], source: 'status', affected: [{ node: 'R/M1/A/D', generation: 1 }] });
  appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, affected: [{ node: 'R/M1/A/D', generation: 1 }], ...GATE_FIELDS });
  const opening = planRecovery(readTreeRecord(t.rootDir), { runFactsOf: () => ({}) }).find(a => a.action === 'append' && a.event.event === 'generation_opened');
  assert.deepEqual(opening.event.nodes.map(n => `${n.node}@g${n.generation}`), ['R/M1/B@g3']);
  assert.equal(transitionRefusal(stateOf(readTreeRecord(t.rootDir)), { id: 'x2', ...opening.event }), null);
});

test('guard 2 ACCEPTS the ordinary case: a plain stop on the NEW plan\'s own D@g2 (A@g1 still adopted) opens D@g3 on the shared path, and the stop is not widened to the branch (known-bad: guard 2 without the outside clause refuses it)', () => {
  const { t } = adoptedTree({ deep: true });
  const dec = decided(t, 'R/M1/A/D', 2);
  assert.equal(dec.affected.some(a => a.node === 'R/M1/A' && a.generation === 1), false, 'not widened to the adopted branch: D@g2 belongs to the new plan');
  const opening = planRecovery(readTreeRecord(t.rootDir), { runFactsOf: () => ({}) }).find(a => a.action === 'append' && a.event.event === 'generation_opened');
  assert.ok(opening.event.nodes.some(n => n.node === 'R/M1/A/D' && n.generation === 3), JSON.stringify(opening.event.nodes));
  assert.equal(transitionRefusal(stateOf(readTreeRecord(t.rootDir)), { id: 'x3', ...opening.event }), null);
});

test('REAL VERB on an interior stop: `council tree decide --stop` on D@g1 inside the adopted branch lists the branch closure on the screen, says the adopted run stops filling its slot, exits 0, and opens the slot and the consumer', async () => {
  const { t } = adoptedTree({ deep: true });
  const record = readTreeRecord(t.rootDir); const state = stateOf(record);
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1/A/D', generation: 1, runId: IDS[5], source: 'status', affected: affectedFor({ record, state, runsDir: t.runsDir, node: 'R/M1/A/D', generation: 1 }).affected });
  const io = terminal(['Plan it again.\n.', stop.id, 'y']);
  const timer = setTimeout(() => io.stdin.end(), 6000);
  const code = await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id }, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  clearTimeout(timer);
  assert.equal(code, 0, io.shown() + io.errors());
  for (const k of ['R/M1/A@g1', 'R/M1/A/D@g1', 'R/M1/C@g2']) assert.ok(io.shown().includes(`- ${k}`), `the screen lists ${k}`);
  assert.match(io.shown(), /R\/M1\/A@g1 is reused finished work: it fills the slot R\/M1\/B\./);
  const opening = planRecovery(readTreeRecord(t.rootDir), { runFactsOf: () => ({}) }).find(a => a.action === 'append' && a.event.event === 'generation_opened');
  assert.deepEqual(opening.event.nodes.map(n => `${n.node}@g${n.generation}`).sort(), ['R/M1/B@g3', 'R/M1/C@g3']);
});

// ROW 6 (era-2 adopted branch with a verified split). Fixture note: adoptedTree({ agreement }) stores A's children frontier under a placeholder split hash, while split_verified carries the real one, so the loop's key never matched the stored one (a fixture artifact, observed: pending cccccccc vs stored bbbbbbbb). Here the stored frontier is re-written under the VERIFIED hash, so the only thing that can still propose children for the frozen adopted parent A@g1 is the loop's numbering.
test('ROW 6: a verified split under an ADOPTED branch proposes no children for the frozen parent, in era 1 and after a root re-plan opened era 2', () => {
  const { t } = adoptedTree({ agreement: true, finishC: true });
  const rec = readTreeRecord(t.rootDir);
  const verified = rec.events.find(e => e.event === 'split_verified' && e.node === 'R/M1/A').splitSha256;
  const kids = [{ node: 'R/M1/A/M1', generation: 1 }, { node: 'R/M1/A/M2', generation: 1 }];
  const base = { parentNode: 'R/M1/A', parentGeneration: 1, parentRunId: stateOf(rec).nodes.get('R/M1/A@g1').runId, splitSha256: verified, children: kids };
  const k = frontierKey({ ...base, openedBy: null });
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: k, ...base, boundSha256: FIXTURE_BOUND });
  appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: k, revision: 1, boundSha256: FIXTURE_BOUND });
  assert.equal(findPendingFrontier({ rootDir: t.rootDir }), null, 'era 1: nothing is proposed for the frozen adopted parent');
  const raw = ev => { const r = readTreeRecord(t.rootDir); appendFileSync(join(t.rootDir, 'tree', 'events.jsonl'), `${JSON.stringify({ schema: r.events.at(-1).schema, id: `e${Math.max(...r.events.map(e => Number(e.id.slice(1)))) + 1}`, ...ev, at: new Date().toISOString() })}\n`); return `e${Math.max(...r.events.map(e => Number(e.id.slice(1)))) + 1}`; };
  const d = raw({ event: 'decision_recorded', text: 'Plan the root again.', form: 'regenerate', stopId: 'none', affected: [], replansRoot: true, actor: 'person', via: 'terminal', gateId: 'g', shownSha256: '0'.repeat(64) });
  raw({ event: 'generation_opened', decisionId: d, nodes: [{ node: 'R', generation: 2 }] });       // a root opening, written by hand: the table needs a whole root re-plan for it, the fold does not
  assert.equal(stateOf(readTreeRecord(t.rootDir)).maxOpened.get('R'), 2, 'the tree is in root era 2');
  const pend = findPendingFrontier({ rootDir: t.rootDir });
  assert.deepEqual(pend ? pend.children.map(c => `${c.node}@g${c.generation}`) : [], ['R@g2'], 'era 2: the only thing pending is the root re-plan itself, nothing for the frozen adopted parent');
});

test('C4: adoptedNodesOf on the SUB-PLAN route: the adopted run, its slot, the parent it was adopted under and the decision that replaced the parent (read from the replacement frontier\'s openedBy)', () => {
  const { t } = adoptedTree({});
  let rec = readTreeRecord(t.rootDir);
  const dec = rec.events.find(e => e.event === 'decision_recorded');
  const kR = stateOf(rec).nodes.get('R/M1@g2').frontierKey;
  assert.deepEqual(adoptedNodesOf(stateOf(rec)).map(o => [o.node, o.slot, o.under, o.decisionId]), [['R/M1/A', 'R/M1/B@g2', 'R/M1@g2', null]], 'the fixture\'s replacement frontier was previewed without an openedBy: nothing to name');
  const pv = rec.events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === kR).at(-1);
  // hand-appended (the table refuses a preview while a node is active; the real replacement frontier is previewed with openedBy by findPendingFrontier, so this only reproduces its record shape)
  appendFileSync(join(t.rootDir, 'tree', 'events.jsonl'), `${JSON.stringify({ schema: rec.events.at(-1).schema, id: `e${Math.max(...rec.events.map(e => Number(e.id.slice(1)))) + 1}`, event: 'frontier_previewed', frontierKey: kR, parentNode: pv.parentNode, parentGeneration: pv.parentGeneration, parentRunId: pv.parentRunId, splitSha256: pv.splitSha256, children: pv.children, boundSha256: pv.boundSha256, openedBy: dec.id, at: new Date().toISOString() })}\n`);
  rec = readTreeRecord(t.rootDir);
  assert.deepEqual(adoptedNodesOf(stateOf(rec)), [{ node: 'R/M1/A', generation: 1, runId: IDS[1], slot: 'R/M1/B@g2', under: 'R/M1@g2', decisionId: dec.id }]);
});
