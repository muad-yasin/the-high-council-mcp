// Restore gap 2a (gate page 9.5 / 10.4; C&C rulings 9.5 and 3): the audit copy of the plan as accepted is kept in the run folder BEFORE the node_closed line is appended, by ONE path (keepPlanCopy) for the writers that have a plan - the member's
// exit hook and recovery - and recorded on the line (planCopy, or an explicit null; copyFailed when it could not be written). Real all-mock trees, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Of } from '../src/thin-contract.js';
import { EVENTS_FILE, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { PLAN_COPY_FILE, closedFieldsOf, keepPlanCopy } from '../src/tree-member.js';
import { bodyOfDelivered } from '../src/tree-split.js';
import { recoverTree } from '../src/tree-recovery.js';
import { runFactsOfIn, runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';

async function finished() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  return r;
}
const dirOf = (r, node) => join(r.t.runsDir, [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node).runId);

test('REAL exit hook: every closed node\'s line says planCopy: plan-at-close.md, the file is in its run folder, its sha256 is the recorded deliveredBodySha256 and its bytes are the delivered body', { timeout: 400_000 }, async () => {
  const r = await finished();
  const closes = eventsOf(r).filter(e => e.event === 'node_closed');
  assert.ok(closes.length >= 4, 'R and its three children');
  for (const e of closes) {
    assert.equal(e.planCopy, PLAN_COPY_FILE, `${e.node}`); assert.equal(e.copyFailed, undefined, `${e.node}: no failure recorded`);
    const dir = join(r.t.runsDir, e.runId); const copy = readFileSync(join(dir, PLAN_COPY_FILE), 'utf8');
    assert.equal(sha256Of(copy), e.deliveredBodySha256, `${e.node}: the copy hashes to the record`);
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    assert.equal(copy, bodyOfDelivered(readFileSync(join(dir, 'deliverable.md'), 'utf8'), report.delivered_text).body, `${e.node}: byte for byte the delivered body`);
  }
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').planCopy, PLAN_COPY_FILE, 'the fold keeps it on the node');
});

test('REAL recovery: a close written from the run\'s files carries the body hash the exit hook wrote (entry 3 left it out of this writer) AND the audit copy, written again before the event', { timeout: 400_000 }, async () => {
  const r = await finished();
  const original = eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R/M3');
  const copy = join(dirOf(r, 'R/M3'), PLAN_COPY_FILE); if (existsSync(copy)) renameSync(copy, `${copy}.away`);      // the copy is gone: RECOVERY must write it (the guard keeps this test about recovery alone: it never depends on the exit hook having kept one)
  const file = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  writeFileSync(file, `${lines.filter(l => !(JSON.parse(l).event === 'node_closed' && JSON.parse(l).node === 'R/M3')).join('\n')}\n`);
  await recoverTree(r.t.rootDir, { runFactsOf: runFactsOfIn(r.t.runsDir), facts: { pidAlive: () => false } });
  const closed = eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R/M3');
  assert.ok(closed, 'recovery closed it from the files');
  assert.equal(closed.deliveredBodySha256, original.deliveredBodySha256); assert.equal(closed.planCopy, PLAN_COPY_FILE);
  assert.equal(sha256Of(readFileSync(copy, 'utf8')), closed.deliveredBodySha256);
});

test('a copy that cannot be written does not stop the close and is RECORDED (copyFailed), a run with no plan to keep records an explicit null, and closedFieldsOf stays a pure read that never writes', async () => {
  const r = await finished();
  const runDir = dirOf(r, 'R/M2');
  assert.deepEqual(keepPlanCopy(runDir, null), { planCopy: null }, 'no body: an explicit null, not a failure');
  const tmpl = join(runDir, PLAN_COPY_FILE); if (existsSync(tmpl)) renameSync(tmpl, `${tmpl}.away`); mkdirSync(tmpl);              // a folder where the copy belongs: the rename cannot replace it
  const failed = keepPlanCopy(runDir, 'x');
  assert.equal(failed.planCopy, null); assert.match(failed.copyFailed, /\S/, 'the reason is recorded');
  const before = readdirSync(runDir).sort().join(); closedFieldsOf(runDir);
  assert.equal(readdirSync(runDir).sort().join(), before, 'closedFieldsOf writes nothing');
});
