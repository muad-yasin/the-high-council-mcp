// 0.8.3 M6 S8-5 (design note 3.3, 3.4, 8.2; C&C 12 Oct): the way ON from a root re-plan decision. The root_replan frontier (no parent, opened by the decision), `council tree approve` for it (the text of note 8.2), and the registration of R@g2 through the
// admitted path with the decision's text in its bundle - plus the loop's writer of exit X2 of the held state (held_released). Real flow: trackedRealRoot, the real decide and approve verbs, the real gate. All-mock, $0.
// NOT here (S8-5b, tree-run.js): starting R@g2 (apiStarter leaves --criteria out when the bundle has none) - the registration is the last step this slice owns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { registerNextChild } from '../src/tree-loop.js';
import { bundleSha256Of, bundleDirOf } from '../src/tree-continuation.js';
import { runTree } from '../src/tree-run.js';
import { deadKeys, heldKeys, keptKeys } from '../src/tree-transitions.js';
import { sha256Of } from '../src/thin-contract.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { PRESENCE } from './helpers/event-presence.js';
import { ROOT_ID, claim, hostnameOf } from './helpers/tree-fixture.js';

const STOP = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] };
const TYPED = 'Plan it again, offline store first.';
const io = answers => { const t = terminal(answers); const timer = setTimeout(() => t.stdin.end(), 8000); t.stop = () => clearTimeout(timer); return t; };
// a real root, R/M1 finished and passed (eligible), a stop on the root, and the decision recorded through the real verb
async function decided() {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const stop = appendTreeEvent(r.t.rootDir, STOP);
  const t = io([`${TYPED}\n.`, stop.id, 'y']);
  // CHANGED ACCEPTED (red triage, C&C thcmcp-cd 23 Okt 2026, Q2). OLD: no flag. NEW: `fresh: true`. WHY: since a5d818f the earlier root plan is offered as DATA by default, so the approve screen says "An input, as DATA: ..." (A-DRAFT, tree-stop.js:144); this test pins the APPROVED wording "Not an input: the earlier root plan.", which is the --fresh sentence (tree-stop.js:145). `decided()` is shared by this file's three tests; the other two (the known-bad task edit and the registration row) assert nothing about the earlier plan (grep: the only earlier-plan needles are in the WAY ON test), so `fresh` changes only the size of their input.
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { stop: stop.id, fresh: true }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop);
  assert.equal(code, 0, t.shown() + t.errors());
  return { r, stop };
}
const approve = async (r, answers) => { const t = io(answers); const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(t.stop); return { code, t }; };

test('THE WAY ON: the decision opens a root_replan frontier; `council tree approve` shows it (note 8.2), records the preview and the approval; the loop registers R@g2 with a fresh run id, the run it replaces, the task hash and a bundle that holds the decision text byte for byte', async () => {
  const { r } = await decided();
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.equal(pending.kind, 'root_replan'); assert.deepEqual(pending.children, [{ node: 'R', generation: 2 }]); assert.equal(pending.openedBy.text, TYPED);
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  assert.equal(d.preview.kind, 'root_replan'); assert.equal(d.preview.parentNode, null); assert.equal(d.preview.children.length, 1);
  const { code, t } = await approve(r, [pending.key.slice(0, 8), 'y']);
  assert.equal(code, 0, t.shown() + t.errors());
  for (const needle of ['Start a NEW ROOT run (R@g2)?', 'It was decided by this decision, word for word:', TYPED, `it replaces R@g1, run ${ROOT_ID}`, 'Admitted.', 'Not an input: the earlier root plan.', 'The earlier plan R@g1', '1 finished node is held below the earlier plan', 'Approving authorizes up to $', `To approve, type the first 8 characters of the frontier key: ${pending.key.slice(0, 8)}`]) assert.ok(t.shown().includes(needle), `the approve text has: ${needle}\n${t.shown()}`);
  const ev = eventsOf(r); const prev = ev.find(e => e.event === 'frontier_previewed' && e.kind === 'root_replan'); const appr = ev.find(e => e.event === 'frontier_approved' && e.frontierKey === pending.key);
  assert.ok(prev && appr, 'the preview and the approval are recorded'); assert.ok(appr.gateId && /^[0-9a-f]{64}$/.test(appr.shownSha256));
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir }), null, 'approved: nothing waits');
  // the loop registers it
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'registered', JSON.stringify(reg)); assert.equal(reg.node, 'R'); assert.equal(reg.event.generation, 2);
  assert.notEqual(reg.runId, ROOT_ID); assert.equal(reg.event.replacesRunId, ROOT_ID); assert.match(reg.event.taskSha256, /^[0-9a-f]{64}$/);
  assert.equal(reg.event.grant.amount, prev.children[0].capUsd, 'the grant is the cap the approval showed');
  assert.equal(bundleSha256Of(bundleDirOf(r.t.rootDir, 'R', 2)), reg.event.bundleSha256, 'the files on disk hash to the registered bundle (what the member re-checks)');
  assert.ok(readFileSync(join(bundleDirOf(r.t.rootDir, 'R', 2), 'context.md'), 'utf8').includes(`----- decision ${pending.openedBy.id} -----\n${TYPED}\n----- end -----`), 'the typed repair, verbatim, in the new root\'s context');
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R@g2').phase, 'registered');
});

test('known-bad: the task edited after the approval is refused AT REGISTRATION (nothing registered, a blocked record names it); and `approve` of a changed task is refused with nothing recorded', async () => {
  const { r } = await decided();
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const taskFile = join(r.t.work, 'tasks', 'x.md'); const original = readFileSync(taskFile, 'utf8');
  // before the approval: approve refuses, nothing is recorded
  writeFileSync(taskFile, `${original}\nA different goal.\n`);
  const n0 = readTreeRecord(r.t.rootDir).events.length;
  const refused = await approve(r, [pending.key.slice(0, 8), 'y']);
  assert.equal(refused.code, 19); assert.match(refused.t.errors(), /a different goal is a new tree/); assert.equal(readTreeRecord(r.t.rootDir).events.length, n0, 'nothing recorded');
  // approve on the unchanged task, then edit it before the loop registers
  writeFileSync(taskFile, original);
  const ok = await approve(r, [pending.key.slice(0, 8), 'y']); assert.equal(ok.code, 0, ok.t.shown() + ok.t.errors());
  writeFileSync(taskFile, `${original}\nA different goal.\n`);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'refused'); assert.equal(reg.check, 'task_changed');
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.has('R@g2'), false, 'nothing registered');
  assert.ok(eventsOf(r).some(e => e.event === 'blocked' && e.scope === 'R@g2' && e.check === 'task_changed'));
});

test('X2, the writer: the new root plan closes PASSED with no split block -> the loop writes held_released { no_split } for the held nodes, once; they are passed over (K2: kept, not dead); the event carries its fields (the PRESENCE row)', async () => {
  const { r } = await decided();
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.equal((await approve(r, [pending.key.slice(0, 8), 'y'])).code, 0);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered');
  assert.deepEqual([...heldKeys(stateOf(readTreeRecord(r.t.rootDir)))], ['R/M1@g1'], 'held while R@g2 runs');
  // R@g2 "runs" and closes passed with a plan that holds no split block
  // T1-7 (13 Oct 2026) EDITED, disclosed: the folder used to hold run.json and a deliverable.md and NO report.json, so the plan did not READ (readNodePlan -> null) and the release passed by the misread the audit names (an unreadable plan taken for "no
  // split block"). Now the run folder holds what a delivered run holds: a report.json whose delivered_text.body_sha256 is the hash of the deliverable's body, so the plan READS and really has no split block.
  const runDir = join(r.t.runsDir, reg.runId); mkdirSync(runDir, { recursive: true });
  const body = '# Plan\n\nA plan with no split block.\n';
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ runId: reg.runId })); writeFileSync(join(runDir, 'deliverable.md'), body);
  writeFileSync(join(runDir, 'report.json'), JSON.stringify({ delivered_text: { body_sha256: sha256Of(body), harness_notes: [] } }));
  appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim('R', reg.runId, process.pid, 2, hostnameOf()) });
  appendTreeEvent(r.t.rootDir, { event: 'node_closed', node: 'R', generation: 2, runId: reg.runId, outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released', returnedUsd: 0 });
  const before = eventsOf(r).length;
  registerNextChild(r.t.rootDir, { work: r.t.work });                                // the loop's step
  const released = eventsOf(r).filter(e => e.event === 'held_released');
  assert.equal(released.length, 1); assert.equal(released[0].reason, 'no_split'); assert.deepEqual(released[0].nodes, ['R/M1@g1']);
  assert.deepEqual(PRESENCE.held_released(released[0]), [], 'the PRESENCE row finds its fields');
  // EDITED 18 Okt 2026 (C2a-record K2). OLD: assert.equal(heldKeys(...).size, 0) (the release emptied the held set; "they die"). NEW: still held, passed over, not dead; the "once" assertion below is what the writer's repeat guard (held minus kept) protects.
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual([...heldKeys(st)], ['R/M1@g1']); assert.deepEqual([...keptKeys(st)], ['R/M1@g1']); assert.equal(deadKeys(st).has('R/M1@g1'), false);
  const after = eventsOf(r).length;
  registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(eventsOf(r).filter(e => e.event === 'held_released').length, 1, 'once'); assert.ok(after > before);
});
