// D2 F13 (printed ways, RULE 1c; lane T, G5+6; corrections D3 F13-1): the way out a person can type is printed where the state is shown. Offline, $0: pure renders over hand-built facts and views for the text-only items, and the
// member's own start (src/tree-member.js memberStart) on synthetic all-mock trees for the two refusals it writes. Items here: a (S9: `tree status` and the member's accounting refusal name `--accounting <node>@g<n>` for each node with a KEYED
// gate problem), c (S10: no live grant names `--close`), f (S11: the root's choice stop names --abandon, never --close R), j (S14: a provider_pin stop names the restore of the provider's files), and the status line under a
// `council tree stop` marker. Item e is in test/tree-root-replan.test.js, item g in test/tree-bundle-rebuild.test.js (the WRITE ORDER test), and j's gather path in test/tree-restore.test.js (R6 + R11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { TreeRefusal, appendTreeEvent, readTreeRecord } from '../src/tree-record.js';
import { gateTree } from '../src/tree-budget.js';
import { memberStart } from '../src/tree-member.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { sittingLines } from '../src/tree-resume.js';
import { renderNeedsDecisionStop } from '../src/tree-stop.js';
import { IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, reservedLine, root as repoRoot, settledLine, syntheticRun, writeLines } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';

const S9 = (root, k) => `For ${k}: \`council tree decide ${root} --accounting ${k}\` lets you accept, as a typed decision, the charges the accounting gate cannot prove for it (no number changes).`;
const S10 = (root, k) => `Nothing is left of its grant: give it up with \`council tree decide ${root} --close ${k}\`.`;
const S11 = root => `To end the tree instead: \`council tree decide ${root} --abandon\`.`;
const S14 = (p, node) => `  Put the run files of ${p} back as its run wrote them: the next \`council tree resume\` closes this stop by itself when its thin contract reads as the one ${node} was registered against.`;
const RESUME_LINE = root => `  go on with \`council tree resume ${root}\`: it lifts the stop that \`council tree stop\` set`;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- `tree status`, on hand-built facts
const T1 = '2026-10-25T12:00:01.000Z';
const facts = (over = {}) => ({
  rootId: 'rootid', treeId: 'rootid', position: { lastEventId: 'e9', lastEventAt: T1, events: 9 }, consistency: null, problems: [], stopMarker: false,
  readiness: { source: 'computed', verdict: 'ready', reasons: [], eventId: 'e9', at: T1 },
  gate: { ok: true, problems: [] },
  nodes: [{ node: 'R', generation: 1, depth: 0, runId: 'rootid', phase: 'closed', outcome: 'passed', nextGeneration: null }],
  waiting: [], awaitingApproval: [], held: { registeredNotStarted: [], parentChanged: [], guardRefusals: [] }, splitChanged: [], dead: [], openStops: [],
  limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 4, attemptsPerChild: 1, runs: 1, raised: [] },
  money: { unit: 'usd', rootCapUsd: 100, memberSpend: { sumUsd: 0.7, members: [{ node: 'R', generation: 1, runId: 'rootid', started: true, runSpentUsd: 0.7 }], reservations: [] }, adjustments: { sumUsd: 0, reservations: [] } },
  ...over,
});
const lines = text => text.split('\n');
const section = (text, head) => { const i = lines(text).indexOf(head); if (i < 0) return ''; const rest = lines(text).slice(i + 1); const j = rest.findIndex(l => l !== '' && !l.startsWith(' ')); return rest.slice(0, j < 0 ? rest.length : j).join('\n').trimEnd(); };

test('F13a S9 (status): a failing accounting gate names `--accounting <node>@g<n>` once per node with a KEYED problem; an unkeyed problem, an advice run and the node-less over_committed get no such line', () => {
  const gate = { ok: false, problems: [
    { code: 'settlement_not_mirrored', node: 'R/M1@g1', runId: 'run-1', keys: ['run-1:r1'] },
    { code: 'mirror_disagrees', node: 'R/M1@g1', runId: 'run-1', keys: ['run-1:r2'] },                // a second keyed problem of the same node: still ONE line for it
    { code: 'member_run_json', node: 'R/M2@g1', runId: 'run-2', keys: [] },                          // B20b: restored by hand, no acceptance
    { code: 'mirror_ahead_of_file', node: 'advice:a1', runId: 'run-3', keys: ['run-3:r1'] },         // an advice run: `--accounting` reads no such node
    { code: 'over_committed', node: null, runId: null, keys: [] },
  ] };
  const text = renderTreeStatus(facts({ readiness: { source: 'computed', verdict: 'blocked', reasons: [], eventId: 'e9', at: T1 }, gate }));
  assert.match(text, /The accounting gate does not trust the record \(5 problems: /, 'the existing gate line stays');
  // RED at f7ccc764: the status names no --accounting at all (D1a B20: "status ... names no command")
  assert.ok(lines(text).includes(`  ${S9('rootid', 'R/M1@g1')}`), text);
  assert.equal(text.split('--accounting').length - 1, 1, 'ONE line, for R/M1@g1 (two keyed problems), none for the others');
  assert.equal(text.includes('--accounting R/M2'), false); assert.equal(text.includes('advice:a1'), false);
  // control (passes at both heads): a passing gate prints neither line
  assert.equal(renderTreeStatus(facts()).includes('--accounting'), false);
});

test('F13 status line: under a `council tree stop` marker with nothing else to do, "What you can do" names `tree resume` (which lifts the marker) instead of "Nothing is asked of you right now."', () => {
  const stopped = renderTreeStatus(facts({ stopMarker: true }));
  // RED at f7ccc764: the section is "  Nothing is asked of you right now." (Review/Build_0.8.3/m8/cr-fixes/M_F14_status_before_after.txt, the second block)
  assert.equal(section(stopped, 'What you can do'), RESUME_LINE('rootid'), stopped);
  assert.equal(stopped.includes('Nothing is asked of you right now.'), false);
  // controls (pass at both heads): no marker keeps the old line; a marker with something else to do keeps that and adds nothing
  assert.equal(section(renderTreeStatus(facts()), 'What you can do'), '  Nothing is asked of you right now.');
  const withStop = renderTreeStatus(facts({ stopMarker: true, openStops: [{ id: 'e7', node: 'R/M1', generation: 1, text: 'Stop e7.\n  - regenerate: council tree decide rootid --stop e7\n' }] }));
  assert.equal(section(withStop, 'What you can do'), '  answer the open stop with `council tree decide rootid` (the stop text above says how)');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the member's start (memberStart), synthetic all-mock trees
const lineageOf = node => ({ treeId: ROOT_ID, node, generation: 1, attempt: 1 });
const startOf = (t, node, runId, extra = {}) => {
  try { memberStart({ runDir: join(t.runsDir, runId), runId, lineage: lineageOf(node), purpose: 'run', capAskedUsd: 5, chainPath: join(repoRoot, 'chains', 'mock-budget.json'), inputs: {}, piiGate: null, piiAllow: [], allowSecretShaped: false, ceiling: null, work: t.work, ...extra }); return null; } catch (e) { return e; }
};
const lastBlocked = t => readTreeRecord(t.rootDir).events.filter(e => e.event === 'blocked').at(-1);
/** R closed; R/M1 registered with `grant`, STARTED (its claim is ours, read as dead through `facts.pidAlive`: an interrupted node), one paid stage reserved and settled in its own file; `mirrorSettled` false loses the settled mirror line. */
function interruptedChild({ grant = 10, usd = 0.6, mirrorSettled = true } = {}) {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], grant);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[0], { usage: [{ file: 'build', usd, reservationId: 'r1' }] });
  writeLines(t, IDS[0], 'R/M1', [reservedLine('r1', 1.0, 'build')]);
  writeLines(t, IDS[0], 'R/M1', [settledLine('r1', 'recorded', usd)], { mirror: mirrorSettled });
  return t;
}
const DEAD_CLAIM = { pidAlive: () => false };

test('F13a S9 (member): the accounting refusal of a member start names `--accounting <node>@g<n>` on its own line for the node whose problem is keyed, in the error and in the `blocked` record', () => {
  const t = interruptedChild({ mirrorSettled: false });
  const g = gateTree(t.rootDir);
  assert.equal(g.ok, false, 'precondition: the gate fails');
  assert.deepEqual(g.problems.map(p => [p.code, p.node, p.keys]), [['settlement_not_mirrored', 'R/M1@g1', [`${IDS[0]}:r1`]]], 'precondition: one KEYED problem, on R/M1@g1');
  const e = startOf(t, 'R/M1', IDS[0], { facts: DEAD_CLAIM });
  assert.ok(e instanceof TreeRefusal, String(e));
  assert.equal(e.code, 'accounting_blocked', e.message);
  // RED at f7ccc764: the detail is the one line "the accounting gate fails: settlement_not_mirrored (...)" and names no command
  assert.ok(e.reason.split('\n').includes(S9(ROOT_ID, 'R/M1@g1')), e.reason);
  assert.ok(e.reason.startsWith('the accounting gate fails: settlement_not_mirrored ('), 'the existing first line stays first');
  const b = lastBlocked(t);
  assert.deepEqual([b.reason, b.scope], ['accounting_blocked', 'R/M1@g1']);
  assert.equal(b.detail, e.reason, 'the record holds the same words');
});

test('F13a S9 (status, the real reader): `tree status` on the same tree reads the keyed problem through the report (node and keys) and names the acceptance for R/M1@g1', () => {
  const t = interruptedChild({ mirrorSettled: false });
  const text = renderTreeStatus(gatherStatusFacts(t.rootDir, { work: t.work }));
  assert.match(text, /The accounting gate does not trust the record \(1 problem: settlement_not_mirrored\)/, 'precondition: the gate line');
  // RED at f7ccc764: no --accounting line
  assert.ok(lines(text).includes(`  ${S9(ROOT_ID, 'R/M1@g1')}`), text);
});

test('F13c S10: a member start refused for "no live grant" names `--close <node>@g<n>` (the LOOP of an interrupted node whose spend reached its grant, B21b)', () => {
  const t = interruptedChild({ grant: 1, usd: 1 });
  assert.equal(gateTree(t.rootDir).ok, true, 'precondition: the gate passes (the settled line is mirrored and proven)');
  const e = startOf(t, 'R/M1', IDS[0], { facts: DEAD_CLAIM, deps: { ancestorCheck: () => null } });       // the synthetic root has no thin contract; the ancestor check is not what this test is about
  assert.ok(e instanceof TreeRefusal, String(e));
  assert.equal(lastBlocked(t).check, 'grant', e.message);
  assert.match(e.reason, /^R\/M1@g1 has no live grant: min\(grant 1\.0000 - spent /, 'the existing words stay first');
  // RED at f7ccc764: the detail ends at the room figure ("= 0.0000") and names no way out
  assert.match(e.reason, /\) = -?\d+\.\d{4}\. Nothing is left of its grant: /, e.reason); assert.ok(e.reason.endsWith(`. ${S10(ROOT_ID, 'R/M1@g1')}`), e.reason);
  assert.equal(lastBlocked(t).detail, e.reason);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the sitting's end text (sittingLines), pure
test('F13f S11: a ROOT stopped at its overseer limit or at a conflict is never offered `--close R` (the close refuses the root); it is offered --abandon. A child keeps its close', () => {
  for (const conflict of [false, true]) {
    const root = sittingLines({ status: 'awaiting_choice', started: [], node: 'R', runId: 'run-r', conflict, stopped: [], replaced: null }, 'rootid').join('\n');
    // RED at f7ccc764: "To give the node up instead: `council tree decide rootid --close R`."
    assert.equal(root.includes('--close R'), false, root);
    assert.ok(root.endsWith(` ${S11('rootid')}`), root);
    const child = sittingLines({ status: 'awaiting_choice', started: [], node: 'R/M1', runId: 'run-1', conflict, stopped: [], replaced: null }, 'rootid').join('\n');
    assert.ok(child.endsWith('To give the node up instead: `council tree decide rootid --close R/M1`.'), child);
    assert.equal(child.includes('--abandon'), false);
  }
  const deadRoot = sittingLines({ status: 'awaiting_choice', started: [], node: 'R', runId: 'run-r', conflict: false, stopped: [], replaced: 'dead' }, 'rootid').join('\n');
  assert.equal(deadRoot.includes('--close R'), false, deadRoot); assert.ok(deadRoot.endsWith(` ${S11('rootid')}`), deadRoot);
  const deadChild = sittingLines({ status: 'awaiting_choice', started: [], node: 'R/M1', runId: 'run-1', conflict: false, stopped: [], replaced: 'dead' }, 'rootid').join('\n');
  assert.ok(deadChild.endsWith('To give the node up: `council tree decide rootid --close R/M1`.'), deadChild);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the stop screen (renderNeedsDecisionStop), pure
const stopView = (codes, over = {}) => ({
  stopId: 'e9', rootId: 'RID', node: 'R/M2', generation: 1, blockedBy: codes.map(code => ({ code, text: 'x' })), acceptedPlan: null, person: null, provides: [], expects: [], affected: [], independent: [],
  held: 0, budget: { rootCapUsd: 5, spentUsd: 0, heldUsd: 0, availableUsd: 5 }, limits: [], unexpanded: [], ...over,
});

test('F13j S14: a provider_pin stop names, for each provider the node registered a pin against, the restore of its run files that closes the stop by itself', () => {
  const text = renderNeedsDecisionStop(stopView(['provider_pin'], { pinProviders: ['R/M1@g1', 'R/M3@g2'] }));
  // RED at f7ccc764: a provider_pin stop printed only its paid route (regenerate); no restore line (D1a B3c)
  assert.ok(lines(text).includes(S14('R/M1@g1', 'R/M2')), text);
  assert.ok(lines(text).includes(S14('R/M3@g2', 'R/M2')), text);
  // controls (pass at both heads): no provider_pin, no line, even with providers in the view; a view without the field (every older caller) prints none
  assert.equal(renderNeedsDecisionStop(stopView(['report_unreadable'], { pinProviders: ['R/M1@g1'] })).includes('Put the run files of'), false);
  assert.equal(renderNeedsDecisionStop(stopView(['provider_pin'])).includes('Put the run files of'), false);
});
