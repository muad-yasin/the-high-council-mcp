// 0.8.3 M7 KEEP (plan Review/Build_0.8.3/m7/Keep_Plan2_2026-10-19.md; C&C thcmcp-6d, Muad 19 Okt 2026): a person (or the session, with its written reason) accepts a finished run that ended needs_decision AS IT IS.
// The new decision form 'keep' answers a node_closed stop in place (marks released, nothing opened) and records the node in `accepted`; every reader of the close's status goes through ONE helper (endedNeedsDecision).
import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesOf, endedNeedsDecision, foldRecord, keepRefusal, transitionRefusal } from '../src/tree-transitions.js';
import { statusPolicyOk } from '../src/tree-deps.js';
import { wholeBranchOf } from '../src/tree-reuse-wire.js';
import { FIXTURE_BOUND, GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { runTree } from '../src/tree-run.js';
import { gatherReadinessFacts, verdictOf } from '../src/tree-ready.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { readFileSync } from 'node:fs';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { treeStatusPayload } from '../src/mcp/tree-status.js';
import { buildTreeReport } from '../src/tree-report.js';
import { writeTreeHandoff } from '../src/tree-handoff.js';

const G = GATE_FIELDS;
const runFor = (n, g) => (n === 'R' && g === 1 ? 't' : `run-${n.replace(/\//g, '-')}-${g}`);
const reg = (n, g, parent, fk, extra = {}) => ({ event: 'node_registered', node: n, generation: g, runId: runFor(n, g), attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' }, ...extra });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const started = (id, n, g) => ({ id, event: 'node_started', node: n, generation: g, runId: runFor(n, g), pid: 1, host: 'h' });
const closed = (id, n, g, extra = {}) => ({ id, event: 'node_closed', node: n, generation: g, runId: runFor(n, g), outcome: 'passed', passed: true, status: null, share: 'released', ...extra });
const stop = (id, n, g, source = 'node_closed') => ({ id, event: 'needs_decision_opened', node: n, generation: g, runId: runFor(n, g), source, affected: [{ node: n, generation: g }] });

// R closed; its child R/M1 finished passed with the Status needs_decision; the node_closed stop on R/M1 is open (e9)
const BASE = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1, { status: 'needs_decision' }), stop('e9', 'R/M1', 1)];
const KEEP = { id: 'e10', event: 'decision_recorded', text: 'The open question is for the next milestone; the result stands.', form: 'keep', stopId: 'e9', node: 'R/M1', generation: 1, affected: [], ...G };
const why = (state, event, facts) => transitionRefusal(state, event, facts)?.reason ?? null;

test('KEEP, the fold: the stop is answered and its marks released, nothing opens, the raw status stays on the record, and the node is ACCEPTED', () => {
  const before = foldRecord(BASE);
  assert.deepEqual(before.openStops, ['e9']); assert.equal(endedNeedsDecision(before, before.nodes.get('R/M1@g1')), true, 'before: it ended needs_decision for every reader');
  const state = foldRecord([...BASE, KEEP]);
  assert.deepEqual(state.openStops, [], 'the stop is answered');
  assert.equal(state.stale.has('R/M1@g1'), false, 'its stale mark is released');
  assert.equal(state.nodes.get('R/M1@g1').closedStatus, 'needs_decision', 'the raw status stays (restore compares it)');
  assert.deepEqual([...state.accepted], ['R/M1@g1']);
  assert.equal(endedNeedsDecision(state, state.nodes.get('R/M1@g1')), false);
  assert.equal(state.maxOpened.size, 0, 'nothing was opened');
  assert.equal(transitionRefusal(before, KEEP), null);
  assert.equal(foldRecord(BASE).accepted.size, 0, 'a record from before folds as it did: nothing accepted');
});

test('KEEP, the table row: node_closed stops only (never a bundle_input or blocked stop), the node it names, a finished passed needs_decision run, not twice, the session only with its written reason', () => {
  const s = foldRecord(BASE);
  const other = (source, id) => foldRecord([...BASE, stop(id, 'R/M1', 1, source)]);
  assert.match(why(foldRecord([...BASE.filter(e => e.id !== 'e9'), stop('e9', 'R/M1', 1, 'bundle_input')]), KEEP) ?? '', /does not come from a finished run with status needs_decision \(source: bundle_input\)/, 'PII stops stay the person\'s');
  assert.match(why(foldRecord([...BASE.filter(e => e.id !== 'e9'), stop('e9', 'R/M1', 1, 'blocked')]), KEEP) ?? '', /source: blocked/);
  assert.match(why(s, { ...KEEP, node: 'R/M2' }) ?? '', /is about R\/M1@g1, not R\/M2@g1/);
  assert.match(why(s, { ...KEEP, stopId: 'e77' }) ?? '', /names an open stop|no open stop|not open/);
  assert.match(why(foldRecord([...BASE, KEEP]), { ...KEEP, id: 'e11' }) ?? '', /names an open stop|not open|already accepted|no open stop/);
  assert.match(why(s, { ...KEEP, actor: 'session', via: 'mcp' }) ?? '', /written reason/, 'the session needs its reason');
  assert.equal(why(s, { ...KEEP, actor: 'session', via: 'mcp', reason: 'the open question belongs to a later milestone' }), null, 'the session may keep, with a reason');
  assert.match(why(s, { ...KEEP, actor: 'session', via: 'terminal', reason: 'x' }) ?? '', /channel/);
  assert.match(why(s, { ...KEEP, gateId: undefined }) ?? '', /gate/);
  // the fold trusts the event's fields, so the row binds them: a keep that re-plans the root, lists nodes, covers other stops or names a milestone is not a keep
  for (const [field, extra] of [['replansRoot', { replansRoot: true }], ['affected', { affected: [{ node: 'R/M1', generation: 1 }] }], ['covers', { covers: ['e9'] }], ['milestone', { milestone: 'M1' }]]) assert.match(why(s, { ...KEEP, ...extra }) ?? '', /a keep (names|carries|is)/, `a keep with ${field} is refused`);
  // not a finished passed needs_decision run
  assert.match(keepRefusal(foldRecord([...BASE.filter(e => e.id !== 'e4c'), closed('e4c', 'R/M1', 1, { status: 'ready_for_build' })]), { stopId: 'e9', node: 'R/M1', generation: 1 }) ?? '', /not a finished, passed run that ended needs_decision/);
  assert.match(keepRefusal(s, { stopId: 'e9', node: 'R/M1', generation: 1 }, { milestonesOf: () => [{ status: 'needs-decision' }] }) ?? '', /Resolve it with --milestone/);
  assert.match(keepRefusal(foldRecord([...BASE.slice(0, 3), closed('e2c', 'R', 1, { status: 'needs_decision' }), stop('e9', 'R', 1)]), { stopId: 'e9', node: 'R', generation: 1 }) ?? '', /root plan cannot be accepted with --keep/);
});

test('KEEP, the readers: an accepted node is whole and no longer set aside as needs_decision; the status policy lets it through without a needs-decision milestone (and still refuses it before)', () => {
  const before = foldRecord(BASE); const after = foldRecord([...BASE, KEEP]);
  assert.equal(wholeBranchOf(before, 'R/M1@g1'), false); assert.equal(wholeBranchOf(after, 'R/M1@g1'), true);
  assert.equal(statusPolicyOk({ status: 'needs_decision', hasNeeds: false }), false);
  assert.equal(statusPolicyOk({ status: 'needs_decision', hasNeeds: false, accepted: true }), true);
  assert.equal(statusPolicyOk({ status: 'needs_decision', hasNeeds: false, accepted: true, findings: ['something_else'] }), false, 'accepting the status does not excuse a lint finding');
  void candidatesOf;
});

test('KEEP, the REAL VERB: `council tree decide --keep` accepts a child that ended needs_decision with no milestone (a real node_closed stop, no blocked stop first); the stop is answered, the decision and the node are recorded, and the next sitting opens NO stop on it and the verdict holds no reason scoped at it', async () => {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.openStops.length, 1); const stopId = st.openStops[0]; const meta = st.stopMeta.get(stopId);
  assert.equal(meta.source, 'node_closed', 'the scope is reachable: a milestone-less needs_decision close opens a node_closed stop, no blocked stop first');
  const key = `${meta.node}@g${meta.generation}`;
  const verdictBefore = verdictOf(gatherReadinessFacts(r.t.rootDir, { work: r.t.work })).reasons.filter(x => String(x.scope) === key).map(x => x.code);
  const t = terminal(['The result stands.\n.', key, 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { keep: key }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, t.shown() + t.errors());
  if (process.env.KEEP_PRINT) console.log('--- SCREEN\n' + t.shown());
  assert.match(t.shown(), new RegExp(`Accept ${key.replace(/[/@]/g, '\\$&')} as it is\\?`));
  const rec = readTreeRecord(r.t.rootDir); const after = stateOf(rec);
  const d = rec.events.find(e => e.event === 'decision_recorded' && e.form === 'keep');
  assert.ok(d && d.stopId === stopId && d.actor === 'person' && d.via === 'terminal' && d.shownSha256, JSON.stringify(d));
  assert.deepEqual(after.openStops, []); assert.ok(after.accepted.has(key));
  const stopsBefore = rec.events.filter(e => e.event === 'needs_decision_opened').length;
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const rec2 = readTreeRecord(r.t.rootDir);
  assert.equal(rec2.events.filter(e => e.event === 'needs_decision_opened' && e.node === meta.node && e.generation === meta.generation).length, 1, 'the next sitting opens no new stop on the accepted node (a blocked-child stop would only be answerable by regenerating, which undoes the keep)');
  const verdictAfter = verdictOf(gatherReadinessFacts(r.t.rootDir, { work: r.t.work })).reasons.filter(x => String(x.scope) === key).map(x => x.code);
  assert.ok(verdictBefore.includes('status_policy'), `before the keep the node is held back by the status policy (${JSON.stringify(verdictBefore)}): the change the keep makes`);
  assert.deepEqual(verdictAfter, [], `no reason scoped at the accepted node (before the keep: ${JSON.stringify(verdictBefore)})`);
  void stopsBefore;
  // the readers (additive, omitted when nothing was accepted)
  const f = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(f.acceptedNodes.map(o => [o.node, o.generation, o.actor]), [[meta.node, meta.generation, 'person']]);
  assert.match(renderTreeStatus(f), /Finished runs accepted as they are:\n  R\/M1 generation 1 \(run \S+\) was accepted as it is, decision e\d+, by a person/);
  assert.equal(treeStatusPayload(f).acceptedNodes.length, 1); assert.equal(buildTreeReport(r.t.rootDir, { work: r.t.work }).acceptedNodes.length, 1);
  assert.match(readFileSync(writeTreeHandoff(r.t.rootDir, { work: r.t.work }).path, 'utf8'), /### Finished runs accepted as they are\n\n- R\/M1 generation 1/);
  const plain = await trackedRealRoot(needsDecisionChildren()); approvePending(plain);
  assert.equal('acceptedNodes' in gatherStatusFacts(plain.t.rootDir, { work: plain.t.work }), false, 'golden: nothing accepted, no field');
});

test('KEEP x C3 (6d): after a root re-plan an ACCEPTED node is an ordinary held candidate (eligible), while the same node not accepted is set aside as needs_decision', () => {
  const rootStop = { id: 'e30', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
  const replan = (affected, id) => ({ id, event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: 'e30', replansRoot: true, affected, ...G });
  const open = id => ({ id, event: 'generation_opened', decisionId: id === 'e33' ? 'e32' : 'e32', nodes: [{ node: 'R', generation: 2 }] });
  // R must be closed with a stop for the root decision: reuse BASE (R closed) and add the root stop
  const withKeep = foldRecord([...BASE, KEEP, rootStop, replan([{ node: 'R', generation: 1 }], 'e32'), open('e33')]);
  const noKeep = foldRecord([...BASE.filter(e => e.id !== 'e9'), rootStop, replan([{ node: 'R', generation: 1 }, { node: 'R/M1', generation: 1 }], 'e32'), open('e33')]);
  const c1 = candidatesOf(withKeep).find(c => c.key === 'R/M1@g1'); const c0 = candidatesOf(noKeep).find(c => c.key === 'R/M1@g1');
  assert.equal(c1?.eligible, true, JSON.stringify(c1)); assert.equal(c1.state, 'held');
  assert.equal(c0?.state, 'set_aside'); assert.equal(c0.eligible?.code, 'needs_decision');
});

test('KEEP refuses a stop on a LISTED or DEAD node (6d): a root re-plan answers every open stop of the nodes it sets aside, so a keep on one is refused because the stop is not open (the dead/held/retired checks of keepRefusal are the backstop behind that)', () => {
  const m2 = [{ id: 'e11', ...reg('R/M2', 1, 'R', 'kA') }, started('e11b', 'R/M2', 1), closed('e11c', 'R/M2', 1, { status: 'needs_decision' }), stop('e12', 'R/M2', 1)];
  const base = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1),
    ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1), ...m2,
    { id: 'e30', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'node_closed', affected: [{ node: 'R', generation: 1 }] },
    { id: 'e32', event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: 'e30', replansRoot: true, affected: [{ node: 'R', generation: 1 }, { node: 'R/M2', generation: 1 }], ...G },
    { id: 'e33', event: 'generation_opened', decisionId: 'e32', nodes: [{ node: 'R', generation: 2 }] }];
  const state = foldRecord(base);
  assert.equal(state.openStops.includes('e12'), false, 'the re-plan answered the stop of the set-aside node');
  assert.match(keepRefusal(state, { stopId: 'e12', node: 'R/M2', generation: 1 }) ?? '', /not open/);
});

test('KEEP refuses a node a regenerate decision LISTS (6d\'s owed row): the stop on a listed descendant stays open after the sub-plan decision, and a keep on it is refused until it is dead; the unlisted control is accepted', () => {
  const base = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1),
    ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1, { status: 'needs_decision' }),
    ...front('kB', 'R/M1', 1, [{ node: 'R/M1/A', generation: 1 }], 'e5'), { id: 'e6', ...reg('R/M1/A', 1, 'R/M1', 'kB') }, started('e6b', 'R/M1/A', 1), closed('e6c', 'R/M1/A', 1, { status: 'needs_decision' }),
    stop('e7', 'R/M1', 1), stop('e8', 'R/M1/A', 1)];
  const keepA = { ...KEEP, id: 'e20', stopId: 'e8', node: 'R/M1/A', generation: 1 };
  assert.equal(why(foldRecord(base), keepA), null, 'control: nothing lists R/M1/A, so the keep is accepted');
  const decided = [...base, { id: 'e9', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e7', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/A', generation: 1 }], ...G }];
  const state = foldRecord(decided);
  assert.ok(state.openStops.includes('e8'), 'the stop on the listed descendant is still open');
  assert.match(why(state, keepA) ?? '', /was replaced or set aside by decision e9/, 'a keep on a listed node is refused from the decision on');
});
