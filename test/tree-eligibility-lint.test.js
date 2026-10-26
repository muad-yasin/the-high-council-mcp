// 0.8.3 M6 (owner's yes, 11 Oct 2026, "I'd say yes to the stop"; C&C's companion ruling, OPTION A, rulings rows 120 and 128): providerEligibility reads the SAME milestone-lint input the readiness rule reads and calls THE status policy
// (statusPolicyOk), so a provider whose lint fails the policy - or that records no lint at all - is not eligible: no consumer registers on a provider that readiness blocks at node level. One REAL record, both readers, in both directions,
// NO exception (the first version of this companion exempted a missing lint on the argument that `tree start` would never build such a tree; C&C retracted that as a convenience ruling). All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { providerEligibility } from '../src/tree-loop.js';
import { subtreeEligible } from '../src/tree-deps.js';
import { readinessOf } from '../src/tree-ready.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const NODE_LEVEL = ['status_policy', 'not_passed', 'unsigned_change', 'contract_check', 'no_milestone_lint', 'closed_incomplete'];

async function finished() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  return r;
}
const both = (r, path) => {
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  const e = providerEligibility({ record, state, runsDir: r.t.runsDir, work: r.t.work }, path);
  const blockedBy = readinessOf(r.t.rootDir, { work: r.t.work }).reasons.filter(x => NODE_LEVEL.includes(x.code) && x.scope.startsWith(`${path}@`)).map(x => x.code);
  return { eligible: e.eligible, why: e.why, blockedBy };
};

test('ONE real record, both readers: a healthy provider is eligible and readiness finds no node-level reason; a lint finding, or a Status the node\'s split does not allow, makes BOTH refuse it (the hard lock found at 5cd5cc0: readiness blocked a node eligibility let a consumer register on)', async () => {
  const r = await finished();
  const m2 = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(n => n.node === 'R/M2');
  const file = join(r.t.runsDir, m2.runId, 'report.json'); const original = readFileSync(file, 'utf8');
  const edit = fn => { const rep = JSON.parse(original); fn(rep); writeFileSync(file, JSON.stringify(rep)); };
  try {
    assert.deepEqual(both(r, 'R/M2'), { eligible: true, why: [], blockedBy: [] }, 'healthy: both agree it is fine');
    edit(rep => { rep.handoff_milestones = { ...rep.handoff_milestones, findings: [{ kind: 'unknown_criterion', message: 'M0 names C3' }] }; });
    const finding = both(r, 'R/M2');
    assert.deepEqual([finding.eligible, finding.blockedBy], [false, ['status_policy']], 'a finding under ready_for_build: both refuse');
    assert.match(finding.why.join(' | '), /R\/M2's milestone lint \(Status "ready_for_build", findings unknown_criterion\) is not one a ready node may have/);
    edit(rep => { rep.handoff_milestones = { ...rep.handoff_milestones, status: 'partial', findings: [{ kind: 'status_not_ready', message: 'x' }] }; });
    const partial = both(r, 'R/M2');
    assert.deepEqual([partial.eligible, partial.blockedBy], [false, ['status_policy']], 'partial with no decompose milestone in its split: both refuse');
    writeFileSync(file, original);
    assert.deepEqual(both(r, 'R/M2'), { eligible: true, why: [], blockedBy: [] }, 'the control: the report restored, both agree again');
  } finally { writeFileSync(file, original); }
});

test('NO EXCEPTION (rulings row 128): a node that records no milestone lint is refused by BOTH readers - readiness blocks it (no_milestone_lint) and eligibility says why - on one real record, with the restored report as the control', async () => {
  const r = await finished();
  const m2 = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(n => n.node === 'R/M2');
  const file = join(r.t.runsDir, m2.runId, 'report.json'); const original = readFileSync(file, 'utf8');
  try {
    const rep = JSON.parse(original); delete rep.handoff_milestones; writeFileSync(file, JSON.stringify(rep));
    const x = both(r, 'R/M2');
    assert.deepEqual(x.blockedBy, ['no_milestone_lint'], 'readiness fails closed on a missing lint');
    assert.equal(x.eligible, false, 'and so does eligibility: no exception');
    assert.match(x.why.join(' | '), /R\/M2 records no milestone lint \(handoff_milestones\), so "no findings" cannot be shown/);
    writeFileSync(file, original);
    assert.deepEqual(both(r, 'R/M2'), { eligible: true, why: [], blockedBy: [] }, 'the control: the report restored, both agree again');
  } finally { writeFileSync(file, original); }
});

test('an UNREADABLE report.json is refused with that reason, not with "records no milestone lint" (C&C 12 Oct: that sentence would send the person looking for a lint in a file that cannot be read): one real record, restored report as the control', async () => {
  const r = await finished();
  const m2 = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(n => n.node === 'R/M2');
  const file = join(r.t.runsDir, m2.runId, 'report.json'); const original = readFileSync(file, 'utf8');
  try {
    writeFileSync(file, '{ not json');
    const x = both(r, 'R/M2');
    assert.equal(x.eligible, false);
    assert.ok(x.why.includes("R/M2's report.json does not read, so its milestone lint cannot be shown"), JSON.stringify(x.why));
    assert.equal(x.why.some(w => /records no milestone lint/.test(w)), false, 'and not the missing-lint sentence');
    writeFileSync(file, original);
    assert.deepEqual(both(r, 'R/M2'), { eligible: true, why: [], blockedBy: [] }, 'the control: restored, both agree again');
  } finally { writeFileSync(file, original); }
  const base = { node: 'R/M1', closed: true, passed: true, status: 'ready_for_build', openStop: false, staleBecause: [], itemsOk: true, hasBlock: false, blockOk: false };
  assert.match(subtreeEligible([{ ...base, lint: null, reportUnreadable: true }]).why[0], /report\.json does not read/);
  assert.match(subtreeEligible([{ ...base, lint: null, reportUnreadable: false }]).why[0], /records no milestone lint/);
});

test('subtreeEligible calls THE status policy with the lint: undefined (not given: hand-built facts) is not judged, null (no lint) is refused, a lint through statusPolicyOk is judged with the node\'s milestone kinds', () => {
  const base = { node: 'R/M1', closed: true, passed: true, status: 'ready_for_build', openStop: false, staleBecause: [], itemsOk: true, hasBlock: false, blockOk: false };
  assert.equal(subtreeEligible([base]).eligible, true, 'no lint field: as before');
  const none = subtreeEligible([{ ...base, lint: null }]);
  assert.deepEqual([none.eligible, /R\/M1 records no milestone lint/.test(none.why[0])], [false, true], 'null = the report records no lint: refused, like readiness');
  assert.equal(subtreeEligible([{ ...base, incomplete: true, lint: null }]).why.some(w => /milestone lint/.test(w)), false, 'a node a person closed incomplete is refused for that, not also for a missing lint');
  assert.equal(subtreeEligible([{ ...base, lint: { status: 'ready_for_build', findings: [] } }]).eligible, true);
  const bad = subtreeEligible([{ ...base, lint: { status: 'ready_for_build', findings: ['unknown_criterion'] } }]);
  assert.deepEqual([bad.eligible, /findings unknown_criterion/.test(bad.why[0])], [false, true]);
  assert.equal(subtreeEligible([{ ...base, status: 'partial', hasDecompose: true, lint: { status: 'partial', findings: ['status_not_ready'] } }]).eligible, true, 'partial + exactly status_not_ready is allowed when the split has a decompose milestone');
  assert.equal(subtreeEligible([{ ...base, status: 'partial', hasDecompose: false, lint: { status: 'partial', findings: ['status_not_ready'] } }]).eligible, false);
  assert.equal(subtreeEligible([{ ...base, incomplete: true, lint: { status: 'ready_for_build', findings: ['x'] } }]).why.some(w => /milestone lint/.test(w)), false, 'a node a person closed incomplete is refused for that, not also for its lint');
});
