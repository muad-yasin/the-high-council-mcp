// 0.8.3 M7 apply, C2b-ob (records; plan Review/Build_0.8.3/m7/CarriersOf_Note_2026-10-18.md; C&C thcmcp-6d: GO, a separate commit before C2b-2). WHO CARRIES an obligation is answered by NODE, not by path: on a REAL record with a MOVED adoption (test/helpers/adoption-fixture.js, `held`) the adopted
// R/M1/A@g1 carries a rule by its registration and the new R/M1/A@g2 does not, so a decision that widens to the carriers must name the adopted node. Rows: the pure answer, and the REAL verb (`council tree decide --obligation`, src/tree-decide-stop.js:168) whose recorded decision lists it. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as OB from '../src/tree-obligation.js';        // a namespace import, so a missing export (the base of this commit, for the red run) fails the test that calls it and not the whole file at link time
import { affectedFor } from '../src/tree-affected.js';
import { decideHandler } from '../src/tree-decide.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { planRecovery } from '../src/tree-recovery.js';
import { candidatesOf } from '../src/tree-transitions.js';
import { terminal } from './helpers/terminal.js';
import { IDS, ROOT_ID } from './helpers/tree-fixture.js';
import { HELD_FROM_SIBLING, HELD_IDENTITY, adoptedTree } from './helpers/adoption-fixture.js';

const ORIGIN = { node: HELD_IDENTITY.originNode, generation: HELD_IDENTITY.originGeneration, id: HELD_IDENTITY.originId };
const view = t => { const record = readTreeRecord(t.rootDir); return { record, state: stateOf(record) }; };
const keysOf = list => list.map(n => `${n.node}@g${n.generation}`);

test('C2b-ob carrierNodesOf: the ADOPTED node that carries the rule is a carrier (the new node of its path, which carries nothing, is not), the origin node is its newest, and carriersOf keeps its old answer (paths)', () => {
  const { t } = adoptedTree({ held: true });
  const { record, state } = view(t);
  assert.deepEqual(keysOf(OB.carrierNodesOf({ record, state, origin: ORIGIN })), ['R/M1@g2', 'R/M1/A@g1']);
  assert.deepEqual(OB.carriersOf({ record, state, origin: ORIGIN }), ['R/M1', 'R/M1/A'], 'the path view, as before');
});

test('C2b-ob affectedFor: a carrier given as a node closes over ITS place (the adopted branch), and a carrier given as a bare path - what an older caller or record holds - still reads', () => {
  const { t } = adoptedTree({ held: true, deep: true });
  const { record, state } = view(t);
  const byNode = keysOf(affectedFor({ record, state, runsDir: t.runsDir, node: 'R/M1', obligationCarriers: [{ node: 'R/M1/A', generation: 1 }], seedless: true }).affected);
  assert.ok(byNode.includes('R/M1/A@g1') && byNode.includes('R/M1/A/D@g1'), byNode.join(', '));
  assert.ok(!byNode.includes('R/M1/A@g2') && !byNode.includes('R/M1/A/D@g2'), `the new nodes of the old path are not widened to (${byNode.join(', ')})`);
  const byPath = affectedFor({ record, state, runsDir: t.runsDir, node: 'R/M1', obligationCarriers: ['R/M1/A'], seedless: true }).affected;
  assert.ok(byPath.length > 0, 'a bare-path carrier still gives an answer');
});

test('C2b-ob the REAL verb: `council tree decide --obligation` on a rule that ONLY the ADOPTED node carries records a decision that lists the adopted node AND the stopped new node of its path, as two entries (known-bad at the base: "no node of this tree carries it")', async () => {
  const { t } = adoptedTree({ held: HELD_FROM_SIBLING });          // the rule originates at R/M2, outside the tree: the registration of R/M1/A@g1 is the only thing that names it
  const { record, state } = view(t);
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1/A', generation: 2, runId: IDS[3], source: 'status', affected: affectedFor({ record, state, runsDir: t.runsDir, node: 'R/M1/A', generation: 2 }).affected });
  const io = terminal(['The retention rule changes.\n.', stop.id, 'y']);
  const timer = setTimeout(() => io.stdin.end(), 6000);
  const code = await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id, obligation: 'R/M1/A@g1:C1' }, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  clearTimeout(timer);
  assert.equal(code, 0, io.shown() + io.errors());
  assert.match(io.shown(), /R\/M1\/A@g1 is reused finished work: it fills the slot R\/M1\/B\. Recording this plans that slot again, and the finished run no longer fills it\./, 'B-DRAFT: the screen says what planning a reused node again does');
  const dec = readTreeRecord(t.rootDir).events.filter(e => e.event === 'decision_recorded').at(-1);
  const listed = keysOf(dec.affected);
  assert.ok(listed.includes('R/M1/A@g1'), `the decision widened to the carrier (${listed.join(', ')})`);
  assert.ok(listed.includes('R/M1/A@g2'), `the stopped node stays listed beside it: two nodes of one path are two entries (${listed.join(', ')})`);
  assert.ok(listed.includes('R/M1/C@g2'), `and so does the consumer pinned to the carrier (${listed.join(', ')})`);
  // Regenerate of a REUSED node (option 4, RegenSlot_Plan): the recovery step opens the next generation of the SLOT R/M1/B (the slot was g2, nothing registered or opened on that path: 3), not R/M1/A at g2, which already exists. Expected values written before the run: B 3, the new node's own path A 3, C 3.
  const opened = planRecovery(readTreeRecord(t.rootDir), { runFactsOf: () => ({}) }).find(a => a.action === 'append' && a.event.event === 'generation_opened');
  assert.deepEqual(opened.event.nodes.map(n => `${n.node}@g${n.generation}`).sort(), ['R/M1/A@g3', 'R/M1/B@g3', 'R/M1/C@g3'], 'known-bad: the node\'s own number, {R/M1/A, 2}, a generation that already exists');
  appendTreeEvent(t.rootDir, opened.event);
  const after = view(t).state;
  assert.equal(after.adopted.size, 0, 'the slot was opened again: the reuse ends with it');
  assert.equal(after.maxOpened.get('R/M1/B'), 3);
  assert.ok(candidatesOf(after).some(c => c.key === 'R/M1/A@g1' && c.state !== 'set_aside'), 'and R/M1/A@g1 is a candidate again');
});

test('C2b-ob carrierNodesOf, the ORIGIN node: a rule that is the ADOPTED node\'s own refinement (an item with no identity) has the origin R/M1/A@g1, so the carrier is that node and not the newest live node of its path (known-bad: the clause took R/M1/A@g2)', () => {
  const { t } = adoptedTree({ held: 'own' });
  const { record, state } = view(t);
  const origin = OB.resolveObligation({ record, state, runsDir: t.runsDir, arg: 'R/M1/A@g1:C1' }).origin;
  assert.deepEqual(origin, { node: 'R/M1/A', generation: 1, id: 'C1' }, 'the origin of an item with no identity is its own node');
  assert.deepEqual(keysOf(OB.carrierNodesOf({ record, state, origin })), ['R/M1/A@g1']);
});
