// 0.8.3 M6 S5b part B, c3b: the close of a child that was NEVER REGISTERED (its input was refused, a `bundle_input` stop is open). `council tree decide <root> --close <child>` records ONE `node_closed_unstarted` (no runId, $0, the typed gate, the stop
// it answers) - not a nodes row, so every reader that relies on "a node has a run folder and a grant" is untouched. The blocked-child rule still applies to the closed child (C&C ruling 1: not exempt): one more stop asks how to replace it, and its
// answer is a new generation. Real flow: the real verbs and the real gate, the real sitting; all-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { exitCodeOf } from '../src/tree-resume.js';
import { readinessOf } from '../src/tree-ready.js';
import { needsDecisionStopText } from '../src/tree-stop-view.js';
import { gatherStatusFacts } from '../src/tree-status.js';
import { decideHandler } from '../src/tree-decide.js';
import { budgetOf, gateTree } from '../src/tree-budget.js';
import { presenceProblems } from './helpers/event-presence.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const HOST = ['db', 'internal'].join('.');                      // part of the mock plan's URL (the value); it must appear in no event and no text a person reads

async function dirtyTree() {
  const sc = splitChildren(); const cfg = sc.extraChains['split-child'];
  const seat = { provider: 'mock', model: 'mock-plan-placeholder-url', maxTokens: 4000 };
  cfg.seats = { ...cfg.seats, builder: seat, reviser: seat };
  const r = await trackedRealRoot({ ...sc, plan: plan3() }); approvePending(r);
  return r;
}
const sittings = async (r, hooks = {}) => { let last; for (let i = 0; i < 6; i += 1) { last = await runTree(r.t.rootDir, { work: r.t.work, hooks }); if (last.status !== 'limit_reached') break; } return last; };
const decide = (r, flags, answers) => {
  const io = terminal(answers);
  const run = () => { const timer = setTimeout(() => io.stdin.end(), 8000); return decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); };
  return { io, run };
};
const stopsOf = (r, source) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === source);

test('THE CLOSE, real verbs: ONE node_closed_unstarted (no runId, the gate, the stop it answers), $0, no nodes row; the accounting gate and the budget still read; the child is never registered or derived again', async () => {
  const r = await dirtyTree();
  const out = await sittings(r); assert.equal(out.status, 'held_by_stop', JSON.stringify(out));
  const [stop] = stopsOf(r, 'bundle_input'); assert.equal(stop.node, 'R/M2');
  const before = budgetOf(r.t.rootDir);
  const d = decide(r, { close: 'R/M2' }, ['R/M2', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.ok(d.io.shown().includes('Next: run `council tree resume') , 'the close says the next step: the sitting opens the stop that asks how to replace it');
  for (const needle of ['Close R/M2@g1 as incomplete, before it ever started?', `Stop ${stop.id} refused it`, 'context.md line', 'Nothing was registered, started or spent; no money was held for it, so none is returned.', 'Closing ends this generation of R/M2 for good: it is never started, and this stop is answered by the close.', 'To approve, type the node path: R/M2']) assert.ok(d.io.shown().includes(needle), `the form has: ${needle}\n${d.io.shown()}`);   // EDITED in the M7 apply (group 3b, fix-up; old needle: 'Nothing was registered, started or spent: $0.00'; why: the close form's money sentence says nothing was held, so nothing is returned, and the new closing paragraph names what the close ends)
  assert.equal(d.io.shown().includes(HOST), false);
  const closes = eventsOf(r).filter(e => e.event === 'node_closed_unstarted'); assert.equal(closes.length, 1);
  const [c] = closes;
  assert.deepEqual([c.node, c.generation, c.stopId], ['R/M2', 1, stop.id]); assert.equal(Object.hasOwn(c, 'runId'), false); assert.ok(c.gateId && /^[0-9a-f]{64}$/.test(c.shownSha256));
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.nodes.has('R/M2@g1'), false, 'no nodes row: every row has a run and a grant');
  assert.ok(st.closedUnstarted.has('R/M2@g1')); assert.equal(st.openStops.includes(stop.id), false, 'the same event answered the stop');
  assert.equal(gateTree(r.t.rootDir).ok, true); const after = budgetOf(r.t.rootDir); assert.equal(after.availableUsd, before.availableUsd, '$0: nothing was held, nothing returned');
  assert.deepEqual(presenceProblems(eventsOf(r)), []);
  assert.equal(JSON.stringify(eventsOf(r)).includes(HOST), false);
});

test('AFTER THE CLOSE: the next sitting does not derive the child, opens the blocked-child stop on it (no runId, source blocked), ends held_by_stop (exit 20); readiness says it was closed before it started; the stop text and the status carry the way on; a second sitting writes nothing', async () => {
  const r = await dirtyTree();
  await sittings(r);
  const d = decide(r, { close: 'R/M2' }, ['R/M2', 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  let derived = 0;
  const out = await runTree(r.t.rootDir, { work: r.t.work, hooks: { afterDerive: () => { derived += 1; } } });
  assert.equal(out.status, 'held_by_stop', JSON.stringify(out)); assert.equal(exitCodeOf(out), 20); assert.equal(derived, 0, 'the closed child is not derived');
  const blocked = stopsOf(r, 'blocked'); assert.equal(blocked.length, 1, 'ruling 1: not exempt from the blocked-child rule');
  const [b] = blocked;
  assert.deepEqual([b.node, b.generation], ['R/M2', 1]); assert.equal(Object.hasOwn(b, 'runId'), false);
  assert.ok(b.blockedBy.some(x => x.code === 'closed_incomplete' && /closed before it started/.test(x.text)), JSON.stringify(b.blockedBy));
  const v = readinessOf(r.t.rootDir, { work: r.t.work });
  assert.notEqual(v.verdict, 'ready');
  assert.ok(v.reasons.some(x => x.code === 'closed_incomplete' && x.scope === 'R/M2@g1' && /closed before it started/.test(x.text)), JSON.stringify(v.reasons));
  const text = needsDecisionStopText(r.t.rootDir, b);
  for (const needle of ['R/M2 generation 1 was closed before it started, by your decision', '$0.00', `council tree decide ${ROOT_ID} --stop ${b.id}`]) assert.ok(text.includes(needle), `the stop text has: ${needle}\n${text}`);
  const facts = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  assert.ok(facts.openStops.some(s => s.id === b.id && /council tree decide/.test(s.text ?? '')), 'the status view lists the stop WITH its command');
  const n = eventsOf(r).length; const again = await runTree(r.t.rootDir, { work: r.t.work });
  assert.equal(again.status, 'held_by_stop'); assert.equal(eventsOf(r).length, n, 'nothing more was written');
});

test('THE WAY ON from the closed child: a regenerate answer to its blocked stop gives R/M2 the next generation (a fresh key); the dirty carrier opens a NEW bundle_input stop at R/M2@g2, exactly one open', async () => {
  const r = await dirtyTree();
  await sittings(r);
  assert.equal(await decide(r, { close: 'R/M2' }, ['R/M2', 'y']).run(), 0);
  await runTree(r.t.rootDir, { work: r.t.work });
  const [b] = stopsOf(r, 'blocked');
  const d = decide(r, { stop: b.id }, ['Replace it, with the credential left out.\n.', b.id, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  let out = await runTree(r.t.rootDir, { work: r.t.work });
  assert.equal(out.approvalWaits, true, JSON.stringify(out));
  const opened = eventsOf(r).filter(e => e.event === 'generation_opened').at(-1);
  assert.ok(opened.nodes.some(n => n.node === 'R/M2' && n.generation === 2), JSON.stringify(opened.nodes));
  approvePending(r);
  out = await sittings(r); assert.equal(out.status, 'held_by_stop', JSON.stringify(out));
  const st = stateOf(readTreeRecord(r.t.rootDir));
  const input = stopsOf(r, 'bundle_input'); assert.equal(input.length, 2); assert.deepEqual([input[1].node, input[1].generation], ['R/M2', 2]);
  assert.equal(st.openStops.filter(id => st.stopMeta.get(id).source === 'bundle_input').length, 1);
  assert.equal(st.nodes.has('R/M2@g2'), false); assert.ok(st.closedUnstarted.has('R/M2@g1'));
});

test('THE TABLE (c3b rows): the close names an open bundle_input stop of THIS child and a gate; a registered node, a foreign stop, a second close and a missing gate are each refused with their own sentence; a registration or a new stop for a closed key is refused; a valid close is accepted', async () => {
  const r = await dirtyTree();
  await sittings(r);
  const [stop] = stopsOf(r, 'bundle_input');
  const G = { gateId: 'g-1', shownSha256: 'a'.repeat(64), actor: 'person', via: 'terminal' };       // K10 (EDITED; OLD: gate fields only; NEW: and who answered; WHY: the table requires it on a close)
  const close = over => ({ event: 'node_closed_unstarted', node: 'R/M2', generation: 1, stopId: stop.id, ...G, ...over });
  const refused = (ev, why) => assert.throws(() => appendTreeEvent(r.t.rootDir, ev), e => e.name === 'TreeRefusal' && why.test(e.reason), JSON.stringify(ev));
  refused(close({ node: 'R/M3' }), /is registered/);
  refused(close({ stopId: 'e1' }), /open stop of the input kind/);
  refused(close({ node: 'R/M7' }), /is about R\/M2@g1, not R\/M7@g1/);
  assert.throws(() => appendTreeEvent(r.t.rootDir, close({ gateId: undefined })), /gateId/, 'a close without the gate is refused (the record shape requires it)');
  // K10 (C2a-record commit 5, fix-up; C&C 6d condition 7): a close before a start is a person's answer and says who gave it
  refused(close({ actor: undefined, via: undefined }), /records who gave it/);
  refused(close({ actor: 'session', via: 'mcp', reason: 'r' }), /person's only/);
  const ok = appendTreeEvent(r.t.rootDir, close({})); assert.equal(ok.event, 'node_closed_unstarted');
  refused(close({}), /already closed|open stop of the input kind/);
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.ok(st.closedUnstarted.has('R/M2@g1'));
  refused({ event: 'node_registered', node: 'R/M2', generation: 1, runId: 'x', attempt: 1, depth: 1, parentNode: 'R', frontierKey: 'k', chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' } }, /closed by a person before it started: it is never registered/);
  refused({ event: 'needs_decision_opened', source: 'bundle_input', node: 'R/M2', generation: 1, parent: { node: 'R', generation: 1 }, findings: stop.findings, carriers: [], affected: [{ node: 'R/M2', generation: 1 }] }, /closed by a person before it started: no stop is opened/);
});

test('THE ROOT VARIANT: a bundle_input stop recorded on the root is found by (R, child) and closed through the child\'s path', async () => {
  const { openBundleInputStop } = await import('../src/tree-bundle-input.js');
  const r = await trackedRealRoot({ ...splitChildren(), plan: plan3() }); approvePending(r);
  const opened = openBundleInputStop(r.t.rootDir, { child: { node: 'R/M3', generation: 1 }, parent: { node: 'R', generation: 1 }, found: { findings: [{ file: 'context.md', line: 3, name: 'URL credentials (scheme://user:pass@)' }], carriers: [], parentOwned: true } });
  assert.equal(opened.kind, 'stop_opened'); assert.equal(opened.stop.node, 'R');
  const d = decide(r, { close: 'R/M3' }, ['R/M3', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.ok(st.closedUnstarted.has('R/M3@g1')); assert.equal(st.openStops.length, 0, 'the root-variant stop is answered by the close');
  // a path with no such stop keeps the old refusal
  const none = decide(r, { close: 'R/M2' }, []); assert.equal(await none.run(), 1); assert.match(none.io.errors(), /no such node in this tree/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- Finding A (C&C go): a frontier shown AGAIN must not promise a child that was closed before it started

test('A FRONTIER SHOWN AGAIN after the close (a parent_changed answered by approving): the closed child is NOT admitted (its own refusedBy), holds no grant share, the registered siblings stay as they are; the approval clears the parent_changed block', async () => {
  const { describeFrontier, findPendingFrontier } = await import('../src/tree-frontier.js');
  const { parentChangedEvent } = await import('../src/tree-continuation.js');
  const r = await dirtyTree();
  await sittings(r);
  const d = decide(r, { close: 'R/M2' }, ['R/M2', 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const key = [...stateOf(readTreeRecord(r.t.rootDir)).frontiers.keys()][0];
  appendTreeEvent(r.t.rootDir, parentChangedEvent({ scope: 'R/M1@g1', frontierKey: key, detail: 'the parent plan changed after the approval', ancestor: 'R' }));
  assert.ok(stateOf(readTreeRecord(r.t.rootDir)).sticky.has('parent_changed'), 'the tree is blocked by the changed parent');
  const pending = findPendingFrontier({ rootDir: r.t.rootDir }); assert.ok(pending, 'the frontier waits for an approval again');
  const shown = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending }); assert.equal(shown.refusal, undefined, JSON.stringify(shown.refusal));
  const byNode = Object.fromEntries(shown.preview.children.map(c => [c.node, c]));
  assert.equal(byNode['R/M2'].admitted, false, 'the closed child is not promised'); assert.equal(byNode['R/M2'].refusedBy, 'closed_unstarted'); assert.equal(byNode['R/M2'].capUsd, 0);
  assert.match(shown.view.children.find(c => c.node === 'R/M2').notAdmittedReason, /closed before it started/);
  assert.ok(byNode['R/M1'].registered && byNode['R/M3'].registered, 'the registered siblings are shown as registered');
  approvePending(r);
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.sticky.has('parent_changed'), false, 'the approval clears the block (the exit)');
  assert.deepEqual(presenceProblems(eventsOf(r).filter(e => e.event === 'frontier_previewed')), [], 'the preview carries its refusedBy');
  const out = await runTree(r.t.rootDir, { work: r.t.work }); assert.equal(out.status, 'held_by_stop', JSON.stringify(out));
  assert.equal(readTreeRecord(r.t.rootDir).events.some(e => e.event === 'node_registered' && e.node === 'R/M2'), false, 'R/M2 is still not registered');
});

test('R18 does not re-offer a child that was closed before it started: a preview that bound it "stale" does not reopen the frontier once its stop was answered by the close', async () => {
  const { frontierReopened } = await import('../src/tree-frontier.js');
  const r = await dirtyTree();
  await sittings(r);
  assert.equal(await decide(r, { close: 'R/M2' }, ['R/M2', 'y']).run(), 0);
  const rec = readTreeRecord(r.t.rootDir);
  const key = [...stateOf(rec).frontiers.keys()][0];
  const last = rec.events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === key).at(-1);
  const { id, at, schema, ...rest } = last;
  appendTreeEvent(r.t.rootDir, { ...rest, children: rest.children.map(c => (c.node === 'R/M2' ? { ...c, admitted: false, capUsd: 0, refusedBy: 'stale' } : c)) });
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), key), false, 'the closed child is settled: nothing is offered again');
});
