// 0.8.3 M6 F2b (the crash window; HARD-LOCK ruled by C&C before S8-8; page Review/Build_0.8.3/m6-closing/F2b_Crash_Window_Quarter_Page.md, fix (ii)). A root re-plan is TWO records in one lock hold: `decision_recorded {replansRoot}`,
// then `generation_opened`. A kill between them leaves a decision that is answered (nothing for `decide` to answer) and, on the obligation route, a sticky `root_affected` block that only the era boundary - the missing record -
// clears; `planRecovery` used to return `blocked` for any sticky block BEFORE its `opening` step, so the tree was wedged. Now an unopened replansRoot decision is finished ahead of the sticky check (and after record_corrupt).
// The crash state is made the way a kill makes it: a REAL flow (the real verbs of test/tree-whole-mock.test.js, single-stop, and of test/tree-f2-two-stops.test.js, two-stop with a fourth independent child) up to the re-plan decision,
// then events.jsonl is TRUNCATED at the `generation_opened` with every later line dropped (after a real `decide` the tail is decision_recorded, generation_opened, readiness). Nothing is written by hand except two records: the ONE `blocked
// parent_changed` record of the parent_changed test (shape copied from test/tree-decide-stops.test.js) and, in the race tests, the generation_opened that the `beforeAppend` seam appends at the moment recovery is about to
// write it (the writer's second append winning the race). events.jsonl has no hash chain, so the truncated record reads clean.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import { startHandler } from '../src/tree-start.js';
import { resumeHandler } from '../src/tree-resume.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { planRecovery, recoverTree } from '../src/tree-recovery.js';
import { heldKeys } from '../src/tree-transitions.js';
import { track } from './helpers/temp-trees.js';
import { splitRootConfig } from './helpers/tree-fixture.js';
import { splitChild } from './helpers/child-chains.js';
import { block3, plan3 } from './helpers/split-fixture.js';
import { LEAF_PLAN } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';

const UNSIGNED = '# A draft the mock critics do not sign\n\nIt carries no marker line.\n';

/** block3 plus a fourth child K4 (milestone M4, independent of K1-K3), as in test/tree-f2-two-stops.test.js. */
function block4() {
  const b = block3();
  b.milestones[3] = { id: 'M4', status: 'decompose', basis: 'the reporting layer is not settled', open_question: 'Which reports are produced?' };
  for (const c of b.children) { c.provides.push({ sibling: 'K4', agreements: [] }); c.expects.push({ sibling: 'K4', agreements: [] }); }
  b.children.push({ id: 'K4', milestone: 'M4', scope: 'Define the reports.', inherits: ['C2'], obligations: [], context_refs: ['parent-plan: Overview'],
    provides: ['K1', 'K2', 'K3'].map(sibling => ({ sibling, agreements: [] })), expects: ['K1', 'K2', 'K3'].map(sibling => ({ sibling, agreements: [] })) });
  return b;
}

/**
 * A tree walked with the real verbs up to the root re-plan decision (obligation route). `two`: two children stop and BOTH are answered with --obligation (two root stops, two blocks), the plan has the fourth child, and the held
 * sibling is R/M4; single: one child stops (R/M1), the held sibling is R/M3. -> helpers + the ids the tests need.
 */
async function walk({ two }) {
  const work = track(mkdtempSync(join(tmpdir(), 'thc-crash-')));
  mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  writeFileSync(join(work, 'chains', 'cr-root.json'), JSON.stringify({ ...splitRootConfig(), name: 'cr-root' }, null, 2));
  writeFileSync(join(work, 'chains', 'cr-child.json'), JSON.stringify({ ...splitChild(), name: 'cr-child' }, null, 2));
  writeFileSync(join(work, 'plan.md'), plan3(two ? block4() : block3()));
  writeFileSync(join(work, 'leaf-plan.md'), LEAF_PLAN); writeFileSync(join(work, 'leaf-plan-unsigned.md'), UNSIGNED);
  const W = { work, held: two ? 'R/M4@g1' : 'R/M3@g1' };
  const bad = two ? ['R/M1', 'R/M3'] : ['R/M1'];
  const quiet = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); const buf = []; stdout.on('data', d => buf.push(String(d))); stderr.on('data', d => buf.push(String(d))); return { stdout, stderr, text: () => buf.join('') }; };
  const sittingStart = ({ node, chain, bundleDir, runId, grantUsd }) => api.run({
    chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}),
    context: join(bundleDir, 'context.md'), runId, treeNode: join(bundleDir, 'node.json'), piiGate: 'hard-stop', /* CHANGED ACCEPTED (19 Okt 2026, the stop is the default): OLD 'warn'. A member is launched with its tree's recorded mode and `tree start` with no flag now records hard-stop; with 'warn' every member would be refused (pii_mode_mismatch, exit 19). */ /* the tree's mode since 0.8.3: `tree start` always records one (warn by default), and a member is launched under it like src/tree-run.js apiStarter does */ cwd: work, maxUsd: grantUsd,
    draft: node === 'R' ? 'plan.md' : (bad.includes(node) && /@g1\/?$/.test(bundleDir) ? 'leaf-plan-unsigned.md' : 'leaf-plan.md'), rounds: 1,
  });
  W.sit = async () => { const o = quiet(); const code = await resumeHandler({ rootDir: W.rootDir, rootId: W.rootId, work, stdout: o.stdout, stderr: o.stderr, deps: { startRun: sittingStart } }); return { code, text: o.text() }; };
  W.approve = async () => {
    const pending = findPendingFrontier({ rootDir: W.rootDir }); assert.ok(pending, 'a frontier waits for approval');
    const t = terminal([pending.key.slice(0, 8), 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
    const code = await approveHandler({ rootDir: W.rootDir, rootId: W.rootId, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
    return { code, text: t.shown() + t.errors() };
  };
  W.decide = async (stopId, typed, flags = {}) => {
    const t = terminal([`${typed}\n.`, stopId, 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
    const code = await decideHandler({ rootDir: W.rootDir, rootId: W.rootId, flags: { stop: stopId, ...flags }, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
    return { code, text: t.shown() + t.errors() };
  };
  W.events = () => readTreeRecord(W.rootDir).events;
  W.kinds = (...names) => W.events().filter(e => names.includes(e.event));
  W.state = () => stateOf(readTreeRecord(W.rootDir));
  const o = quiet();
  // CHANGED (0.8.3 bundle unit step 2a, a5d818f: a root re-plan now offers the EARLIER PLAN as data, so the new plan's input is the task + the decision + that plan): OLD allowance 4000; NEW 6000 (headroom over the 4743 bytes measured for the two-stop walk). WHY: the two-stop walk's new input is 4743 bytes, so
  // `tree decide` refused it ("over the 4000 this tree's approval was priced for"; a stale literal, the refusal is the intended rule). The crash this file pins is unchanged.
  const code = await startHandler({ flags: { task: 'tasks/x.md', chain: 'cr-root', 'child-chain': 'cr-child', 'max-usd': '100' }, work, stdout: o.stdout, stderr: o.stderr, deps: { bundleAllowanceBytes: 6000, startRun: opts => api.run({ ...opts, draft: 'plan.md', rounds: 1 }) } });
  assert.equal(code, 0, o.text());
  [W.rootId] = readdirSync(join(work, 'runs')); W.rootDir = join(work, 'runs', W.rootId);
  assert.equal((await W.sit()).code, 20); assert.equal((await W.approve()).code, 0);
  assert.equal((await W.sit()).code, 20);
  const childStops = W.kinds('needs_decision_opened');
  assert.deepEqual(childStops.map(e => e.node), bad);
  for (const s of childStops) assert.equal((await W.decide(s.id, `Words about ${s.node}: C1 is wrong.`, { obligation: 'R@g1:C1' })).code, 0);
  W.obligationDecisions = W.kinds('decision_recorded').map(e => e.id);
  W.rootStops = W.kinds('needs_decision_opened').filter(e => e.source === 'obligation');
  assert.equal(W.rootStops.length, bad.length);
  assert.equal((await W.decide(W.rootStops[0].id, 'Plan it again with a corrected C1.')).code, 0);
  W.replan = W.kinds('decision_recorded').at(-1);
  assert.equal(W.replan.replansRoot, true);
  return W;
}

/** The crash: drop the `generation_opened` of the re-plan and every line after it (the readiness record the decide verb writes next). */
function crash(W) {
  const file = join(treeDirOf(W.rootDir), 'events.jsonl');
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const cut = lines.findIndex(l => { const e = JSON.parse(l); return e.event === 'generation_opened' && e.decisionId === W.replan.id; });
  assert.ok(cut > 0, 'the walk wrote the generation_opened');
  writeFileSync(file, `${lines.slice(0, cut).join('\n')}\n`);
  const rec = readTreeRecord(W.rootDir);
  assert.deepEqual(rec.corrupt, [], 'a truncated tail reads clean: events.jsonl has no hash chain');
  assert.equal(rec.events.at(-1).id, W.replan.id, 'the record ends in the re-plan decision');
}

/** What the wedge is, and what finishing the decision must write: the SAME record the one-hold writer appends. */
function assertCrashState(W) {
  const s = W.state();
  assert.deepEqual([...s.sticky.keys()], ['root_affected'], 'the block that wedged the tree stands');
  assert.deepEqual([...heldKeys(s)], [], 'nothing is orphaned (so nothing is held) until R@g2 opens');
  const actions = planRecovery(readTreeRecord(W.rootDir), { runFactsOf: () => ({ hasRunJson: true, runDir: W.work, end: null, paused: false }) });
  assert.deepEqual(actions.map(a => [a.action, a.event?.event, a.event?.decisionId, a.event?.nodes]), [['append', 'generation_opened', W.replan.id, [{ node: 'R', generation: 2 }]]],
    'the first thing recovery plans is the re-plan\'s generation_opened for R@g2 exactly (R only: the children are not opened)');
}

async function assertFinished(W) {
  const run = await W.sit();
  assert.equal(run.code, 20, run.text);
  assert.ok(run.text.includes(`A frontier waits for your approval: run \`council tree approve ${W.rootId}\`.`), run.text);
  const opened = W.kinds('generation_opened').filter(e => e.decisionId === W.replan.id);
  assert.deepEqual(opened.map(e => e.nodes), [[{ node: 'R', generation: 2 }]], 'exactly one opening, exactly the writer\'s');
  const s = W.state();
  assert.deepEqual([...s.sticky.keys()], [], 'the era boundary lifted the block(s)');
  assert.deepEqual(s.openStops, [], 'every open root stop is retired');
  assert.equal(findPendingFrontier({ rootDir: W.rootDir })?.kind, 'root_replan', 'the new root plan\'s frontier is offered');
  assert.deepEqual([...heldKeys(s)], [W.held], 'the opening is what creates the hold: the finished sibling is held now');
  assert.deepEqual(W.kinds('generation_opened').filter(e => W.obligationDecisions.includes(e.decisionId)), [], 'no stray opening for an obligation decision');
  assert.equal((await W.sit()).code, 20);
  assert.equal(W.kinds('generation_opened').filter(e => e.decisionId === W.replan.id).length, 1, 'a second sitting writes nothing more');
  assert.deepEqual([...heldKeys(W.state())], [W.held]);
}

test('single-stop walk: killed between the re-plan decision and its generation_opened, the tree is NOT wedged - a sitting writes R@g2\'s opening, lifts root_affected, offers the root frontier, and the finished sibling is held', async () => {
  const W = await walk({ two: false });
  crash(W);
  assertCrashState(W);
  await assertFinished(W);
});

test('two-stop walk: the same crash with TWO root stops and TWO blocks - one opening retires both stops and lifts both blocks, neither obligation decision gets a stray opening, the held sibling is R/M4', async () => {
  const W = await walk({ two: true });
  crash(W);
  assert.equal(W.state().openStops.length, 1, 'the second root stop is still open in the crash state: only the era boundary (the missing record) retires it');
  assertCrashState(W);
  assert.deepEqual([...W.state().sticky.keys()], ['root_affected']);
  await assertFinished(W);
});

test('fail closed: a CORRUPT record plus an unopened re-plan stays blocked by record_corrupt - nothing is written (the early step runs after the corrupt check)', async () => {
  const W = await walk({ two: false });
  crash(W);
  const file = join(treeDirOf(W.rootDir), 'events.jsonl');
  appendFileSync(file, '{this line is not json}\n');
  const corrupt = readTreeRecord(W.rootDir);
  assert.ok(corrupt.corrupt.length > 0);
  // planRecovery itself: the corrupt check comes first, so the unopened re-plan is NOT finished on a record that does not read
  assert.deepEqual(planRecovery(corrupt, { runFactsOf: () => ({}) }).map(a => [a.action, a.reason]), [['blocked', 'record_corrupt']]);
  const before = readFileSync(file, 'utf8');
  const run = await W.sit();
  assert.ok(run.text.includes('the tree record is corrupt') && run.text.includes('Nothing was started'), run.text);
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing was written into a record that does not read');
});

test('another sticky block standing (parent_changed): the opening is still written and it ENDS that block too (the era boundary drops the old era\'s blocks); nothing starts - no registration, no grant, no reservation - because the new root plan\'s frontier waits for approval', async () => {
  const W = await walk({ two: false });
  crash(W);
  const key = W.kinds('frontier_approved')[0].frontierKey;
  // the ONE hand-written record of this file; shape copied from test/tree-decide-stops.test.js
  appendTreeEvent(W.rootDir, { event: 'blocked', reason: 'parent_changed', scope: 'R/M1@g1', frontierKey: key, check: 'ancestor', ancestor: 'R', detail: 'test' });
  assert.deepEqual([...W.state().sticky.keys()].sort(), ['parent_changed', 'root_affected']);
  const registered = W.kinds('node_registered').length; const reservations = W.kinds('reservation_mirrored').length;
  const run = await W.sit();
  assert.equal(run.code, 20, run.text);
  assert.ok(run.text.includes(`waits for your approval: run \`council tree approve ${W.rootId}\``), run.text);
  // what `approve` offers is the new root plan's frontier. The sitting's text here also names the OLD children frontier key (8c1f...: the hand-written block named it, which re-opens its approval), a frontier of the replaced
  // parent that `approve` never offers - reported to C&C as a finding (a stale key in the text), not pinned.
  assert.equal(findPendingFrontier({ rootDir: W.rootDir })?.kind, 'root_replan', 'the frontier `tree approve` offers is the new root plan\'s, not the old children frontier');
  assert.equal(W.kinds('generation_opened').filter(e => e.decisionId === W.replan.id).length, 1, 'the opening was written');
  assert.deepEqual([...W.state().sticky.keys()], [], 'both old-era blocks ended with it (design note 5a)');
  assert.equal(W.kinds('node_registered').length, registered, 'no registration');
  assert.equal(W.kinds('grant_issued').length, 0, 'no money was granted');
  assert.equal(W.kinds('reservation_mirrored').length, reservations, 'no reservation line');
});

// The RACE (C&C ruling on finding 2): `recoverTree` plans from one read and appends later, each append taking the lock. A writer whose second append lands in between (the sitting started between decide's preflight and its apply,
// or read between the two appends) leaves the planned opening already written, and the table refuses it with a TreeRefusal. Before fix (ii) a sitting on the obligation route appended nothing there (the sticky check came first);
// with it the refusal reached the person as a stack trace. The seam is `beforeAppend`: a test moves the record exactly there.
test('the race: the record moves between recovery\'s read and its append (the writer\'s own generation_opened lands first) - recovery re-plans once from a fresh read, finds nothing to do, and does not throw', async () => {
  const W = await walk({ two: false });
  crash(W);
  const runFactsOf = () => ({ hasRunJson: true, runDir: W.work, end: null, paused: false });
  let calls = 0;
  const beforeAppend = action => {
    calls += 1;
    if (calls === 1) appendTreeEvent(W.rootDir, action.event);          // the writer's second append wins the race: exactly the record recovery was about to write
  };
  const out = await recoverTree(W.rootDir, { runFactsOf, beforeAppend });
  assert.equal(calls, 1, 'the hook ran once: the fresh plan had nothing left to append');
  assert.equal(W.kinds('generation_opened').filter(e => e.decisionId === W.replan.id).length, 1, 'one opening in the record, not two');
  assert.deepEqual(out.applied, [], 'recovery applied nothing itself: the refused append is not counted as applied');
  assert.deepEqual([...W.state().sticky.keys()], [], 'the era boundary lifted the block');
});

test('the race, persistent: a second refusal is NOT swallowed - recovery retries once from a fresh read and then lets the TreeRefusal propagate', async () => {
  const W = await walk({ two: false });
  crash(W);
  const runFactsOf = () => ({ hasRunJson: true, runDir: W.work, end: null, paused: false });
  let calls = 0;
  const beforeAppend = () => { calls += 1; throw new TreeRefusal({ code: 'continuation_refused', transition: 'generation_opened', reason: 'the record moved again' }); };
  await assert.rejects(recoverTree(W.rootDir, { runFactsOf, beforeAppend }), e => e instanceof TreeRefusal && /moved again/.test(e.reason ?? e.message));
  assert.equal(calls, 2, 'one attempt, one re-plan from a fresh read, then the second refusal propagates');
});
