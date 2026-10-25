// D2 F4 as D3 amends it (2C-1, B15 ordering (i), CR-2I-001's old stops; Q2, Muad 25 Okt 2026 14:45 "Yes to all" on Astra's list): a verify-time refusal whose cause is a FILE is asked again at every sitting (F4a), and a stop closes
// itself when every cause it names is gone by that cause's own live test (F4c), with three outcomes per cause: resolved / still failing / unable to check (Astra (a)). Real all-mock trees, $0, the real sitting.
//   F4a must not feed the root re-plan form's unverified-split guard (D3 F4-2): the guard keeps reading "any refusal is final".
//   F4c's derivation test fails CLOSED (D3 F4-1): a re-derivation that cannot run keeps the stop open and the sitting says so apart from a derivation that ran and failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { sittingLines } from '../src/tree-resume.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { nodesToVerify } from '../src/tree-loop.js';
import { restoreDecision } from '../src/tree-restore.js';
import { transitionRefusal } from '../src/tree-transitions.js';
import { splitSha256 } from '../src/tree-split.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { block3, plan3 } from './helpers/split-fixture.js';
import { eventsOf } from './helpers/sitting.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const sit = r => runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0 });
const stopsOn = (r, node) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === node);
const restoredOf = r => eventsOf(r).filter(e => e.event === 'stop_restored');
const openIds = r => stateOf(readTreeRecord(r.t.rootDir)).openStops;
const nodeOf = (r, key) => stateOf(readTreeRecord(r.t.rootDir)).nodes.get(key);

test('T4 (F4a + F4c, B15 ordering (i)): the root task edited before the split is verified -> the sitting refuses contract_check and a stop opens on R; the file put back -> the next sitting verifies the split, closes the stop and a frontier waits', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3(), verify: false });
  const original = readFileSync(r.rootTaskPath, 'utf8');
  writeFileSync(r.rootTaskPath, `${original}\nA line the root run never saw.\n`);
  await sit(r);
  const refusal = eventsOf(r).find(e => e.event === 'blocked' && e.reason === 'expansion_refused' && e.scope === 'R@g1');
  assert.equal(refusal?.check, 'contract_check', JSON.stringify(refusal));
  const stop = stopsOn(r, 'R').at(-1);
  assert.ok(stop && openIds(r).includes(stop.id), 'a stop is open on R');
  writeFileSync(r.rootTaskPath, original);
  const back = await sit(r);
  assert.ok(eventsOf(r).some(e => e.event === 'split_verified' && e.node === 'R' && e.generation === 1), 'the split is verified on the second ask');
  assert.deepEqual(restoredOf(r).map(e => [e.stopId, e.actor]), [[stop.id, 'sitting']]);
  assert.equal(openIds(r).includes(stop.id), false);
  assert.ok(findPendingFrontier({ rootDir: r.t.rootDir }), 'a frontier waits for approval');
  assert.match(sittingLines(back, ROOT_ID).join('\n'), /Closed by the sitting: stop .* on R \(generation 1\)\..*and its split is verified now/);
});

test('F4-2: while the file still differs, the root re-plan form\'s guard (nodesToVerify, default) does NOT name the refused node, so the printed route cannot loop; the sitting\'s own list (recheck) names it', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3(), verify: false });
  writeFileSync(r.rootTaskPath, `${readFileSync(r.rootTaskPath, 'utf8')}\nA line the root run never saw.\n`);
  await sit(r);
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  assert.deepEqual(nodesToVerify({ record, state, runsDir: r.t.runsDir }).map(n => n.node), [], 'the guard: a refused node holds no re-plan');
  assert.deepEqual(nodesToVerify({ record, state, runsDir: r.t.runsDir, recheck: true }).map(n => n.node), ['R'], 'the sitting asks again (contract_check is RECHECKED)');
  await sit(r);
  assert.equal(eventsOf(r).filter(e => e.event === 'blocked' && e.reason === 'expansion_refused' && e.scope === 'R@g1' && e.check === 'contract_check').length, 1, 'asked again, written once');
});

test('T3b (F4c on an OLD CR-2I-001 stop, the migration): a stop opened from an approve-time refusal recorded as transition "expansion" after the split_verified closes at the next sitting (TWO hand-made lines, named: the old refusal and the stop 943906f opened from it)', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() });
  appendTreeEvent(r.t.rootDir, { event: 'blocked', reason: 'expansion_refused', scope: 'R@g1', transition: 'expansion', check: 'approval', detail: 'PLAN 5.5 item 4 (approval): the plan changed while it was approved' });     // hand-made 1
  const n = nodeOf(r, 'R@g1');
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: n.runId, source: 'blocked', blockedBy: [{ code: 'expansion_refused', text: 'R@g1: PLAN 5.5 item 4 (approval)' }], affected: [{ node: 'R', generation: 1 }] });   // hand-made 2
  await sit(r);
  assert.deepEqual(restoredOf(r).map(e => e.stopId), [stop.id], 'the node holds its split_verified: the stop closes');
});

test('F4-1 FAIL CLOSED: a derivation_refused stop whose re-derivation cannot run (the root task is gone) stays open, writes no stop_restored, and the sitting says it could not be checked (not that it failed)', { timeout: 600_000 }, async () => {
  const block = block3(); block.children[0].context_refs = ['No such heading'];
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3(block), verify: false });
  // the record as 943906f leaves it (as in tree-context-refs-flow.test.js): a split_verified with no reference check, and a derivation refusal on the CHILD's key
  appendTreeEvent(r.t.rootDir, { event: 'split_verified', node: 'R', generation: 1, runId: ROOT_ID, splitSha256: splitSha256(block), children: block.children.map(c => `R/${c.milestone}`) });     // hand-made 1
  appendTreeEvent(r.t.rootDir, { event: 'blocked', reason: 'expansion_refused', scope: 'R/M1@g1', transition: 'derivation', check: 'missing_context', detail: 'the reference "No such heading" names no source document' });   // hand-made 2
  await sit(r);
  const stop = stopsOn(r, 'R').at(-1);
  assert.ok(stop && stop.blockedBy.some(b => b.code === 'derivation_refused'), 'a derivation_refused stop is open on R');
  renameSync(r.rootTaskPath, `${r.rootTaskPath}.away`);
  const out = await sit(r);
  assert.equal(restoredOf(r).length, 0, 'nothing is closed');
  assert.ok(openIds(r).includes(stop.id));
  assert.deepEqual(out.unchecked.map(u => [u.stopId, u.why]), [[stop.id, 'derivation_not_run']]);
  assert.match(sittingLines(out, ROOT_ID).join('\n'), /stays open: the children it holds back could not be derived again this time .* which is not the same as a derivation that ran and failed/);
});

test('F4c, derivation_refused (pure close test + the table): resolved closes and the event names rechecked; still and unable keep it open with their own words; the table takes the closure only with rechecked', { timeout: 600_000 }, async () => {
  const sha = 'a'.repeat(64);
  const state = { stopMeta: new Map([['e5', { source: 'blocked', blockedCodes: ['derivation_refused'], node: 'R/M1', generation: 1, runId: 'x' }]]), openStops: ['e5'], nodes: new Map([['R/M1@g1', { phase: 'closed', runId: 'x', deliveredBodySha256: sha, thinContractSha256: sha, outcome: 'passed', closedStatus: null, dependsOn: [] }]]) };
  const stop = { id: 'e5', node: 'R/M1', generation: 1, runId: 'x' };
  const snapshot = { observedBodySha256: sha, thinContractSha256: sha, passed: true, status: null };
  assert.deepEqual(restoreDecision({ state, stop, snapshot }), { restore: false, why: 'derivation_not_run' }, 'no re-derivation given = not run');
  assert.deepEqual(restoreDecision({ state, stop, snapshot, derivation: 'unable' }), { restore: false, why: 'derivation_not_run' });
  assert.deepEqual(restoreDecision({ state, stop, snapshot, derivation: 'still' }), { restore: false, why: 'derivation_still' });
  const ok = restoreDecision({ state, stop, snapshot, derivation: 'resolved' });
  assert.equal(ok.restore, true); assert.deepEqual(ok.event.rechecked, ['derivation_refused']);
  // the table, on a REAL record holding a derivation_refused stop (the old-record route above)
  const block = block3(); block.children[0].context_refs = ['No such heading'];
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3(block), verify: false });
  appendTreeEvent(r.t.rootDir, { event: 'split_verified', node: 'R', generation: 1, runId: ROOT_ID, splitSha256: splitSha256(block), children: block.children.map(c => `R/${c.milestone}`) });     // hand-made 1
  appendTreeEvent(r.t.rootDir, { event: 'blocked', reason: 'expansion_refused', scope: 'R/M1@g1', transition: 'derivation', check: 'missing_context', detail: 'the reference "No such heading" names no source document' });   // hand-made 2
  await sit(r);
  const real = stopsOn(r, 'R').at(-1);
  const n = nodeOf(r, 'R@g1');
  const candidate = over => ({ event: 'stop_restored', actor: 'sitting', stopId: real.id, node: 'R', generation: 1, runId: real.runId, deliveredBodySha256: n.deliveredBodySha256, observedBodySha256: n.deliveredBodySha256, ...(n.thinContractSha256 ? { thinContractSha256: n.thinContractSha256 } : {}), ...over });
  const refused = ev => transitionRefusal(stateOf(readTreeRecord(r.t.rootDir)), ev)?.reason ?? null;
  assert.match(String(refused(candidate({}))), /rechecked list must name exactly that/);
  assert.equal(refused(candidate({ rechecked: ['derivation_refused'] })), null);
  assert.equal(restoredOf(r).length, 0, 'the live re-derivation still refuses: the sitting closed nothing');
});
