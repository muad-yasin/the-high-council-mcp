// Row 16 of M5 (0.8.3 M5f): presence pins. The record validates an optional field only when it is there, so these tests drive the REAL writers (the loop, the member's exit hook, `tree decide`) and assert, with
// test/helpers/event-presence.js, that every event they wrote carries what readers depend on: node_registered's bundle/dependsOn/obligations, node_closed's returnedUsd + thinContractSha256, guard_refused.origin,
// boundSha256 and the refusal keys on a preview, the gate fields of a decision, milestone_resolved.decisionId, blocked.frontierKey (parent_changed) and blocked.stopId (root_affected). All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerNextChild } from '../src/tree-loop.js';
import { runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { heldGuardChildren, needsDecisionChildren, pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { PRESENCE, presenceProblems } from './helpers/event-presence.js';

const decide = (r, flags, answers) => {
  const io = terminal(answers);
  const run = () => { const timer = setTimeout(() => io.stdin.end(), 6000); return decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); };
  return { io, run };
};
const seen = new Set();                                   // the event names the scenarios below actually exercised
const audit = (r, what) => { const ev = eventsOf(r); for (const e of ev) seen.add(e.event === 'blocked' ? `blocked:${e.reason}` : e.event); assert.deepEqual(presenceProblems(ev), [], what); return ev; };

test('the audit itself can fail: an event missing each pinned field is reported (so a green scenario below means the writer wrote it)', () => {
  const sha = 'a'.repeat(64);
  const cases = [
    [{ event: 'node_closed', node: 'R/M1', outcome: 'passed', returnedUsd: 1 }, 'thinContractSha256'],
    [{ event: 'node_closed', node: 'R/M1', outcome: 'passed', thinContractSha256: sha }, 'returnedUsd'],
    [{ event: 'guard_refused', node: 'R/M1' }, 'origin'],
    [{ event: 'milestone_resolved', node: 'R/M1', decisionId: 'e1' }, 'changesProvides'],
    [{ event: 'milestone_resolved', node: 'R', changesProvides: undefined }, 'decisionId'],
    [{ event: 'blocked', reason: 'parent_changed' }, 'frontierKey'],
    [{ event: 'blocked', reason: 'root_affected' }, 'stopId'],
    [{ event: 'decision_recorded', form: 'regenerate', stopId: 'e1', gateId: 'g' }, 'shownSha256'],
    [{ event: 'frontier_previewed', children: [] }, 'boundSha256'],
    [{ event: 'node_closed_unstarted', node: 'R/M2', generation: 1, gateId: 'g', shownSha256: sha }, 'stopId'],     // c3b
    [{ event: 'node_closed_unstarted', node: 'R/M2', generation: 1, stopId: 'e1', gateId: 'g' }, 'shownSha256'],
    [{ event: 'needs_decision_opened', source: 'bundle_input', node: 'R/M2', affected: [], carriers: [], parent: { node: 'R', generation: 1 } }, 'findings'],     // S5b part B: the stop before a registration
    [{ event: 'needs_decision_opened', source: 'bundle_input', node: 'R/M2', affected: [], findings: [{}], carriers: [] }, 'parent'],
    [{ event: 'needs_decision_opened', source: 'bundle_input', node: 'R', affected: [], findings: [{}], carriers: [], parent: {} }, 'child'],
    [{ event: 'frontier_previewed', boundSha256: sha, children: [{ node: 'R/M1', admitted: false, scopeSha256: sha, heldSha256: sha }] }, 'limit|refusedBy'],
  ];
  for (const [e, field] of cases) assert.match(presenceProblems([e]).join('\n'), new RegExp(field.replace('|', '\\|')), field);
  assert.deepEqual(presenceProblems([{ event: 'node_closed', node: 'R/M1', outcome: 'incomplete', returnedUsd: 0, gateId: 'g', shownSha256: sha, actor: 'person', via: 'terminal', planCopy: null }]), [], 'a person\'s close carries gate fields (and who answered, K10) instead of the pin');
  assert.match(presenceProblems([{ event: 'node_closed', node: 'R/M1', outcome: 'passed', returnedUsd: 1, thinContractSha256: sha }]).join(), /planCopy/, 'the audit copy is an explicit value on every writer');
  assert.match(presenceProblems([{ event: 'frontier_approved', frontierKey: 'k' }], { realApprovals: true }).join(), /gateId/);
});

test('the loop and the member\'s exit hook (REAL, a tight cap so one child is refused for budget): node_registered, node_closed, split_verified and the previews carry their fields', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), cap: 8 });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const ev = audit(r, 'tight-cap run');
  assert.ok(ev.some(e => e.event === 'node_closed' && e.node === 'R/M3'), 'a child closed');
  assert.ok(ev.some(e => e.event === 'frontier_previewed' && e.children.some(c => c.refusedBy === 'budget')), 'a budget refusal was previewed with its key');
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  audit(r, 'after the re-approval');
});

test('guard_refused carries its origin (REAL held fixture)', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(heldGuardChildren());
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const ev = audit(r, 'held guard');
  assert.ok(ev.filter(e => e.event === 'guard_refused').length >= 2);
});

test('parent_changed carries the frontier key (REAL: the parent\'s deliverable edited after the approval)', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.equal(registerNextChild(r.t.rootDir, { work: r.t.work }).node, 'R/M2');
  const file = join(r.t.runsDir, ROOT_ID, 'deliverable.md'); writeFileSync(file, `${readFileSync(file, 'utf8')}\nAn edit after the approval.\n`);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const ev = audit(r, 'parent changed');
  assert.ok(ev.some(e => e.event === 'blocked' && e.reason === 'parent_changed'));
});

test('a stop, a root-origin obligation decision, a root resolution in place and the generation they open (REAL verbs): every event carries its fields', { timeout: 600_000 }, async () => {
  const r = await trackedRealRoot(needsDecisionChildren());
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const s1 = eventsOf(r).find(e => e.event === 'needs_decision_opened');
  const d = decide(r, { stop: s1.id, obligation: 'R@g1:C1' }, ['The retention rule is wrong.\n.', s1.id, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const m = decide(r, { milestone: 'M5' }, ['The old API stays.\n.', 'R@g1:M5', 'y']);
  assert.equal(await m.run(), 0, m.io.shown() + m.io.errors());
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const ev = audit(r, 'stops and decisions');
  for (const name of ['needs_decision_opened', 'decision_recorded', 'milestone_resolved', 'generation_opened']) assert.ok(ev.some(e => e.event === name), name);
  assert.ok(ev.some(e => e.event === 'blocked' && e.reason === 'root_affected' && e.stopId));
});

test('coverage: every event the audit has a rule for, that these scenarios can write, was seen (a rule nobody exercises is not a pin)', () => {
  const exercised = ['node_registered', 'node_closed', 'guard_refused', 'frontier_previewed', 'split_verified', 'decision_recorded', 'milestone_resolved', 'needs_decision_opened', 'generation_opened', 'blocked:parent_changed', 'blocked:root_affected'];
  for (const name of exercised) assert.ok(seen.has(name), `${name} was never written by a scenario of this file`);
  // budget commit 1 (EDITED, disclosed; old list without 'cap_amended'): cap_amended is not written by any scenario of this file (no verb writes it until the next commit); amendCap's lines are audited in test/tree-cap-amended.test.js
  // 0.8.3 (EDITED, disclosed; old list without 'chain_limits_amended'): chain_limits_amended is not written by any scenario of this file; its audit line runs in test/tree-chain-limits.test.js TL-3 (the real form writes it)
  // limit_raised and accounting_accepted are pinned by the table (the gate fields are REQUIRED there; test/tree-decide-limits, tree-decide-accounting)
  // M6 S2 (EDITED, disclosed; old: ['accounting_accepted', 'limit_raised']): integration_recorded is exercised by test/tree-check.test.js (the real verb writes it; presenceProblems runs there), not by a scenario of this file
  assert.deepEqual(Object.keys(PRESENCE).filter(k => !exercised.some(x => x.split(':')[0] === k)).sort(), ['accounting_accepted', 'bundle_input_allowed', 'cap_amended', 'chain_limits_amended', 'grant_issued', 'held_released', 'integration_recorded', 'limit_raised', 'node_closed_unstarted', 'plan_accepted', 'stop_restored', 'tree_abandoned']);       // 2b (EDITED, disclosed; checker change named in the report; old list without plan_accepted): its one writer is acceptChangedPlan, exercised by test/tree-plan-accept.test.js, which runs presenceProblems       // c3b (EDITED, disclosed; old: without node_closed_unstarted): its writer (`decide --close` on a child never registered) is exercised by test/tree-bundle-input.test.js, where presenceProblems runs on the record       // S8-5 (EDITED, disclosed; old: without held_released): its writer (the loop, exit X2 of the held state) is exercised by test/tree-root-frontier.test.js, which runs presenceProblems on the event it wrote
});
