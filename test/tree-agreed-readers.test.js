// 0.8.4 D1 (UNIT 3, C&C's ruling of 09 Nov 2026 on the tree's passed copies): every tree decision and every recorded tree copy of "the run passed" reads the matrix's agreed reading (agreedOf), so a run that signed off
// but whose final read objected is NOT passed to the tree. Records written before keep their bytes; a comparison of an older record with the live reading fails closed with its reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/api.js';
import { closedFieldsOf } from '../src/tree-member.js';
import { nodesToVerify } from '../src/tree-loop.js';
import { snapshotOfRun, restoreDecision } from '../src/tree-restore.js';
import { expansionCheck } from '../src/tree-expansion.js';
import { gatherReadinessFacts, verdictOf } from '../src/tree-ready.js';
import { recordReadiness } from '../src/tree-readiness.js';
import { readTreeRecord } from '../src/tree-record.js';
import { registerRoot } from '../src/tree-register.js';
import { ROOT_ID, newTree, rootOpts } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OBJECTS = { ran: true, run_end: 'agreed', final_sha: 'a'.repeat(12), seats: [{ read: true, meets: false }] };   // the final read ran after an agreed ending and a top-layer seat objected: finalReadBlocksAgreement
const CLEAR = { ran: true, run_end: 'agreed', final_sha: 'a'.repeat(12), seats: [{ read: true, meets: true }] };
const made = [];
const folder = (report, extra = {}) => {
  const runs = mkdtempSync(join(tmpdir(), 'agr-')); made.push(runs);
  const dir = join(runs, 'r1'); mkdirSync(dir);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  for (const [f, text] of Object.entries(extra)) writeFileSync(join(dir, f), text);
  return { runs, dir };
};
test.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

test('R1 the node_closed fields a finished run gives: a signed-off run whose final read objected is not_passed; the same run with a clear read is passed; a plain passed report is unchanged', () => {
  const blocked = closedFieldsOf(folder({ passed: true, final_read: OBJECTS }).dir);
  assert.deepEqual([blocked.outcome, blocked.passed], ['not_passed', false]);
  const clear = closedFieldsOf(folder({ passed: true, final_read: CLEAR }).dir);
  assert.deepEqual([clear.outcome, clear.passed], ['passed', true]);
  const plain = closedFieldsOf(folder({ passed: true }).dir);
  assert.deepEqual([plain.outcome, plain.passed], ['passed', true]);
  assert.deepEqual([closedFieldsOf(folder({ passed: false }).dir).passed, closedFieldsOf(folder({ passed: true, ending_word: 'round_cap' }).dir).passed], [false, false], 'a row that can never be agreed is not passed whatever else the report holds');
});

test('R2 the tree loop decides from the recorded copy: the closed node of a run whose final read objected is not offered for split verification, the same node with a clear read is', () => {
  const offered = report => {
    const { runs, dir } = folder(report);
    const fields = closedFieldsOf(dir);
    const n = { node: 'R', generation: 1, runId: 'r1', phase: 'closed' };
    const record = { events: [{ event: 'node_closed', node: 'R', generation: 1, runId: 'r1', ...fields }] };
    const state = { nodes: new Map([['R@g1', n]]) };
    return nodesToVerify({ record, state, runsDir: runs, holdsSplit: () => true }).map(x => x.node);
  };
  assert.deepEqual(offered({ passed: true, final_read: CLEAR }), ['R']);
  assert.deepEqual(offered({ passed: true, final_read: OBJECTS }), [], 'treated as not passed: no split work is pushed for it');
});

test('R3 restore: the snapshot reads the matrix\'s agreement, so an OLDER record (outcome passed) against the live not-agreed reading is closure_differs (to the person), never restored', () => {
  const { runs } = folder({ passed: true, final_read: OBJECTS });
  const snap = snapshotOfRun(runs, 'r1');
  assert.equal(snap.unreadable, undefined, JSON.stringify(snap));
  assert.equal(snap.passed, false);
  const stop = { id: 's1', node: 'R', generation: 1, runId: 'r1' };
  const older = { phase: 'closed', runId: 'r1', outcome: 'passed', closedStatus: null, deliveredBodySha256: 'x', thinContractSha256: null };
  const state = { stopMeta: new Map([['s1', { source: 'blocked', blockedCodes: ['report_unreadable'] }]]), openStops: ['s1'], nodes: new Map([['R@g1', older]]) };
  const d = restoreDecision({ state, stop, snapshot: { ...snap, observedBodySha256: 'x' } });
  assert.deepEqual([d.restore, d.why], [false, 'closure_differs']);
  // the same record against a live agreed reading restores (the comparison is about the reading, nothing else)
  const ok = snapshotOfRun(folder({ passed: true, final_read: CLEAR }).runs, 'r1');
  assert.equal(restoreDecision({ state, stop, snapshot: { ...ok, observedBodySha256: 'x' } }).restore, true);
});

test('R4 the expansion check: the panel did not pass a plan whose final read objected (panel_passed, the first thing it checks)', () => {
  const r = expansionCheck({ runDir: folder({ passed: true, signed_text: { signed_off: true }, delivered_text: { same_as_signed: true }, final_read: OBJECTS }).dir, work: tmpdir(), upTo: 1 });
  assert.equal(r.refusal?.check, 'panel_passed');
});

// the readiness rule on a REAL all-mock tree (the envelope of test/tree-ready.test.js leafTree, which passes)
const leafRootChain = () => {
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  return { ...c, seats: { ...c.seats, handoff: { provider: 'mock', model: 'mock-handoff-reads-prompt' } }, handoff_contract: { ...(c.handoff_contract ?? {}), milestones: true } };
};
test('R5 readiness: the node fact `passed` (and so the readiness answer\'s input hash) reads the matrix: a leaf whose report now says its final read objected is blocked as not_passed', async () => {
  const t = newTree({ rootChain: 'leaf-root', extraChains: { 'leaf-root': leafRootChain() } });
  track(t.work);
  registerRoot(t.rootDir);
  const res = await api.run(rootOpts(t));
  assert.equal(res.exitCode, 0, res.outputTail);
  const before = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.equal(before.nodes[0].run.passed, true);
  const first = recordReadiness(t.rootDir, { work: t.work });
  assert.equal(first.appended, true, JSON.stringify(first));
  const file = join(t.runsDir, ROOT_ID, 'report.json');
  const report = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...report, final_read: OBJECTS }));
  const after = gatherReadinessFacts(t.rootDir, { work: t.work });
  assert.equal(after.nodes[0].run.passed, false);
  assert.ok(verdictOf(after).reasons.some(r => r.code === 'not_passed'));
  // the answer recorded from the old reading (passed true) is stale: the tree asks again and the new answer is blocked, not ready
  const again = recordReadiness(t.rootDir, { work: t.work });
  assert.equal(again.appended, true, 'the stale answer is not reused');
  assert.equal(again.verdict, 'blocked');
  const last = readTreeRecord(t.rootDir).events.filter(e => e.event === 'readiness').at(-1);
  assert.ok(last.reasons.some(r => r.code === 'not_passed'), JSON.stringify(last.reasons));
});
