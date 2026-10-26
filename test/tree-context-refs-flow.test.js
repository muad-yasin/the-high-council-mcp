// CR-2E-003 / CR-2E-002 / CR-2I-001 / CR-MAP-007 through the REAL verbs on all-mock trees ($0): the reference grammar, its check before a split is verified, and what a refusal leaves behind.
//   (Q1, Muad 25 Okt 2026 14:45 "Yes to all"): a split whose children name plain headings is verified and approved, and the children get the sections (restricted B); a reference that cannot resolve is refused when the split is
//   verified (check `context_refs`), so the stop opens on the plan that wrote it, never at approve; the verification records what each child's references resolved to (C&C, 25 Okt 2026: needed to tell "verified, failing now" from "never resolved").
//   (D2 F3) a refusal written by `tree approve` is history, not a verification result: once the file is back, nothing of it stays.
//   (D2 F2) a derivation refusal whose cause is a plan's own text opens a stop on the node whose text failed (a provider missing a promised heading: the provider), and the independent siblings go on; an old approve-time record
//   is only a trigger for a live re-derivation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { approveHandler } from '../src/tree-approve.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { readinessOf } from '../src/tree-ready.js';
import { bundleDirName } from '../src/tree-continuation.js';
import { splitSha256 } from '../src/tree-split.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren, splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, plan3 } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const withRefs = (refs, which = [0, 1, 2]) => { const b = block3(); for (const i of which) b.children[i].context_refs = refs; return b; };
const approve = async r => {
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  // a verified parent whose plan no longer reads comes back with key null: approve then refuses before it asks
  const io = terminal([String(pending?.key ?? 'none').slice(0, 8), 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, shown: io.shown(), errors: io.errors() };
};
const sit = (r, over = {}) => runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0, ...over });
const blockedStops = (r, node) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === node);

test('PLAIN HEADINGS (Sol S1\'s probe, D2 T1): a root split whose children name only "Overview" is verified, `tree approve` approves it, and the child\'s input holds the plan\'s "Overview" section labelled with its document', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3(withRefs(['Overview'])) });
  const a = await approve(r);
  assert.equal(a.code, 0, a.errors);
  assert.match(a.shown, /Approved: frontier/);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r), maxStarts: 1 });
  const ctx = readFileSync(join(r.t.rootDir, 'tree', 'inputs', bundleDirName('R/M1', 1), 'context.md'), 'utf8');
  const part4 = ctx.slice(ctx.indexOf('## 4. '), ctx.indexOf('## 5. '));
  assert.match(part4, /----- parent plan deliverable\.md \(sha256 [0-9a-f]{64}\), heading "Overview" -----\n## Overview\nA plan\.\n/, part4);
});

test('EARLY VALIDATION (D2 T1a): a reference that cannot resolve is refused when the split is verified (check context_refs), the stop opens on R, the split is not verified and no frontier is offered', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3(withRefs(['No such heading'], [0])), verify: false });
  await sit(r);
  const ev = eventsOf(r);
  const refusal = ev.find(e => e.event === 'blocked' && e.reason === 'expansion_refused' && e.scope === 'R@g1');
  assert.ok(refusal, 'a refusal is recorded for R');
  assert.deepEqual([refusal.transition, refusal.check], ['expansion', 'context_refs']);
  assert.match(refusal.detail, /R\/M1.*"No such heading"/, refusal.detail);
  assert.equal(ev.some(e => e.event === 'split_verified' && e.node === 'R'), false, 'the split is not verified');
  const stop = blockedStops(r, 'R').at(-1);
  assert.ok(stop && stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), 'a blocked-root stop is open');
  assert.ok(stop.blockedBy.some(b => b.code === 'expansion_refused'), JSON.stringify(stop.blockedBy));
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir }), null, 'no frontier is offered');
});

test('THE RESOLUTION IS RECORDED (C&C, 25 Okt 2026): split_verified carries, for every child, what its references resolved to', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3(), verify: false });
  await sit(r);
  const v = eventsOf(r).find(e => e.event === 'split_verified' && e.node === 'R');
  assert.ok(v, 'the split is verified');
  assert.deepEqual((v.resolvedRefs ?? []).map(x => x.child), ['K1', 'K2', 'K3']);
  for (const x of v.resolvedRefs) assert.match(x.sha256, /^[0-9a-f]{64}$/);
});

test('AN APPROVE-TIME REFUSAL IS HISTORY (D2 F3, CR-2I-001 door (b)): approve while the plan is edited is refused; with the bytes back, approve works, nothing reads the refusal as the plan\'s, and no stop opens', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() });
  const file = join(r.runDir, 'deliverable.md'); const original = readFileSync(file, 'utf8');
  writeFileSync(file, `${original}\nOne line added after the panel signed.\n`);
  assert.equal((await approve(r)).code, 19);
  const line = eventsOf(r).filter(e => e.event === 'blocked' && e.reason === 'expansion_refused' && e.scope === 'R@g1').at(-1);
  assert.equal(line?.transition, 'approval', JSON.stringify(line));
  writeFileSync(file, original);
  const a = await approve(r);
  assert.equal(a.code, 0, a.errors);
  await sit(r);
  assert.equal(readinessOf(r.t.rootDir, { work: r.t.work }).reasons.some(x => x.code === 'expansion_refused' && x.scope === 'R@g1'), false);
  assert.equal(blockedStops(r, 'R').length, 0, 'no blocked-root stop');
});

test('A PROVIDER WITHOUT ITS PROMISED HEADING (CR-MAP-007, D2 T2b): the stop opens on the PROVIDER (derivation_refused), its consumer is held, and the independent sibling registers', { timeout: 600_000 }, async () => {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: plan3(b) });
  approvePending(r);
  writeFileSync(join(r.t.work, 'no-overview.md'), '# The provider plan\n\n## Store\nThe store keeps every record.\n\nREVISED MOCK DELIVERABLE\n');
  const start = draftStarter(r, { 'R/M1': 'no-overview.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const stop = blockedStops(r, 'R/M1').at(-1);
  assert.ok(stop && stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), 'a stop is open on R/M1');
  assert.ok(stop.blockedBy.some(x => x.code === 'derivation_refused' && /Overview/.test(x.text)), JSON.stringify(stop.blockedBy));
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const nodes = stateOf(readTreeRecord(r.t.rootDir)).nodes;
  assert.equal(nodes.has('R/M3@g1'), true, 'the independent sibling registers');
  assert.equal(nodes.has('R/M2@g1'), false, 'the consumer is held');
});

test('AN OLD APPROVE-TIME DERIVATION RECORD (written at 943906f) is a trigger, never the verdict: when the child still cannot be derived a stop opens on the parent; when it derives now, nothing stays (TWO hand-made lines, named: the old record)', { timeout: 600_000 }, async () => {
  // the record exactly as 943906f leaves it: a split_verified written by the old verification (no reference check) and the derivation refusal `tree approve` recorded on the CHILD's key
  const old = async (refs) => {
    const block = withRefs(refs, [0]);
    const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3(block), verify: false });
    appendTreeEvent(r.t.rootDir, { event: 'split_verified', node: 'R', generation: 1, runId: ROOT_ID, splitSha256: splitSha256(block), children: block.children.map(c => `R/${c.milestone}`) });     // hand-made 1
    appendTreeEvent(r.t.rootDir, { event: 'blocked', reason: 'expansion_refused', scope: 'R/M1@g1', transition: 'derivation', check: 'missing_context', detail: 'the reference "x" names no source document' });   // hand-made 2
    await sit(r);
    return r;
  };
  const still = await old(['No such heading']);
  const stop = blockedStops(still, 'R').at(-1);
  assert.ok(stop && stateOf(readTreeRecord(still.t.rootDir)).openStops.includes(stop.id), 'a stop is open on R');
  assert.ok(stop.blockedBy.some(x => x.code === 'derivation_refused' && /R\/M1/.test(x.text)), JSON.stringify(stop.blockedBy));
  const fine = await old(['Overview']);
  assert.equal(readinessOf(fine.t.rootDir, { work: fine.t.work }).reasons.some(x => x.code === 'derivation_refused'), false);
  assert.equal(blockedStops(fine, 'R').length, 0, 'nothing stays of a refusal the live derivation no longer gives');
});
