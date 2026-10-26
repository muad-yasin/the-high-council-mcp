// 0.8.3 M6 F2 (Muad, 12 Oct 2026: "throwing a sub-plan away before even checking if it is genuinely still useful ... would be a really stupid decision"; C&C gate 1 on Review/Build_0.8.3/m6-closing/F2_Held_After_Obligation_Mechanism.md):
// the obligation route with TWO root stops open at once, driven through the real verbs (startHandler, resumeHandler, approveHandler, decideHandler) on all-mock chains, $0. Two children close with stops and are answered with
// `--obligation R@g1:C1`: two root stops (source obligation) and two root_affected blocks stand. The root is then RE-PLANNED on the first root stop. What F2 requires, each a group with its own red at 520cee1:
//   G1 the re-plan's gate text names the OTHER root stop it will retire and shows the words the person typed for it (a stop is never answered silently; those words are not carried into the new root plan - said so, once);
//   G2 the finished, passed independent child (R/M4) is HELD, not set aside: eligibility is asked and the obligation decisions' own marks do not count;
//   G3 neither obligation decision gets a `generation_opened` later (their pending effect on the carriers died with the root stops they belonged to), so the held child stays held through the first sitting that follows;
//   G4 the second repair words are not fed into the new root plan's bundle (by design: text the person did not choose is not fed in).
// The test-side split has a FOURTH child, independent of the others and signed, because with the shared three-child block no sibling passes when R/M1 and R/M3 both fail. The plan drafts handed to the runs are the same
// stand-in as test/tree-whole-mock.test.js (api.run's `draft`; R/M1 and R/M3 get an unsigned draft, so they close not passed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import { startHandler } from '../src/tree-start.js';
import { resumeHandler } from '../src/tree-resume.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { deadKeys, heldKeys, obligationOriginOf } from '../src/tree-transitions.js';
import { bundleDirOf } from '../src/tree-continuation.js';
import { track } from './helpers/temp-trees.js';
import { splitRootConfig } from './helpers/tree-fixture.js';
import { splitChild } from './helpers/child-chains.js';
import { block3, plan3 } from './helpers/split-fixture.js';
import { LEAF_PLAN } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';

const ROOT_CHAIN = 'f2-root';
const CHILD_CHAIN = 'f2-child';
const UNSIGNED = '# A draft the mock critics do not sign\n\nIt carries no marker line.\n';
const FIRST = 'First: the root rule C1 is wrong.';
const SECOND = 'Second: C1 is wrong here too, and for another reason.';
const REPLAN = 'Plan it again with a corrected C1.';

/** block3 plus a fourth child K4 (milestone M4, independent of K1-K3): every child lists every sibling in provides and expects. */
function block4() {
  const b = block3();
  b.milestones[3] = { id: 'M4', status: 'decompose', basis: 'the reporting layer is not settled', open_question: 'Which reports are produced?' };
  for (const c of b.children) { c.provides.push({ sibling: 'K4', agreements: [] }); c.expects.push({ sibling: 'K4', agreements: [] }); }
  b.children.push({ id: 'K4', milestone: 'M4', scope: 'Define the reports.', inherits: ['C2'], obligations: [], context_refs: ['parent-plan: Overview'],
    provides: ['K1', 'K2', 'K3'].map(sibling => ({ sibling, agreements: [] })), expects: ['K1', 'K2', 'K3'].map(sibling => ({ sibling, agreements: [] })) });
  return b;
}

const work = track(mkdtempSync(join(tmpdir(), 'thc-f2-')));
mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
writeFileSync(join(work, 'chains', `${ROOT_CHAIN}.json`), JSON.stringify({ ...splitRootConfig(), name: ROOT_CHAIN }, null, 2));
writeFileSync(join(work, 'chains', `${CHILD_CHAIN}.json`), JSON.stringify({ ...splitChild(), name: CHILD_CHAIN }, null, 2));
writeFileSync(join(work, 'plan.md'), plan3(block4()));
writeFileSync(join(work, 'leaf-plan.md'), LEAF_PLAN);
writeFileSync(join(work, 'leaf-plan-unsigned.md'), UNSIGNED);

const S = {};
const events = () => readTreeRecord(S.rootDir).events;
const state = () => stateOf(readTreeRecord(S.rootDir));
const kinds = (...names) => events().filter(e => names.includes(e.event));
const keysOf = set => [...set].sort();
const need = (cond, leg) => assert.ok(cond, `${leg} did not complete: this test needs it`);
const quiet = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); const buf = []; stdout.on('data', d => buf.push(String(d))); stderr.on('data', d => buf.push(String(d))); return { stdout, stderr, text: () => buf.join('') }; };
const rootStart = opts => api.run({ ...opts, draft: 'plan.md', rounds: 1 });
const draftFor = (node, bundleDir) => (node === 'R' ? 'plan.md' : ((node === 'R/M1' || node === 'R/M3') && /@g1\/?$/.test(bundleDir) ? 'leaf-plan-unsigned.md' : 'leaf-plan.md'));
const sittingStart = ({ node, chain, bundleDir, runId, grantUsd }) => api.run({
  chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}),
  context: join(bundleDir, 'context.md'), runId, treeNode: join(bundleDir, 'node.json'), piiGate: 'hard-stop', /* CHANGED ACCEPTED (19 Okt 2026, the stop is the default): OLD 'warn'. A member is launched with its tree's recorded mode and `tree start` with no flag now records hard-stop; with 'warn' every member would be refused (pii_mode_mismatch, exit 19). */ /* the tree's mode since 0.8.3 (`tree start` always records one, warn by default); a member is launched under it, as src/tree-run.js apiStarter does */ cwd: work, maxUsd: grantUsd, draft: draftFor(node, bundleDir), rounds: 1,
});
async function sit() {
  const o = quiet();
  const code = await resumeHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdout: o.stdout, stderr: o.stderr, deps: { startRun: sittingStart } });
  return { code, text: o.text() };
}
async function approve() {
  const pending = findPendingFrontier({ rootDir: S.rootDir }); assert.ok(pending, 'a frontier waits for approval');
  const t = terminal([pending.key.slice(0, 8), 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  const code = await approveHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, text: t.shown() + t.errors() };
}
async function decide(stopId, typed, flags = {}) {
  const t = terminal([`${typed}\n.`, stopId, 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: S.rootDir, rootId: S.rootId, flags: { stop: stopId, ...flags }, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, text: t.shown() + t.errors() };
}

test('setup - two children close not passed with stops (R/M1, R/M3), the independent R/M4 passes, R/M2 waits; both stops are answered with --obligation R@g1:C1: TWO root stops and TWO root_affected blocks stand', async () => {
  const o = quiet();
  const code = await startHandler({ flags: { task: 'tasks/x.md', chain: ROOT_CHAIN, 'child-chain': CHILD_CHAIN, 'max-usd': '100' }, work, stdout: o.stdout, stderr: o.stderr, deps: { bundleAllowanceBytes: 4000, startRun: rootStart } });
  assert.equal(code, 0, o.text());
  [S.rootId] = readdirSync(join(work, 'runs')); S.rootDir = join(work, 'runs', S.rootId);
  assert.equal((await sit()).code, 20); assert.equal((await approve()).code, 0);
  const run = await sit();
  assert.equal(run.code, 20, run.text);
  const stops = kinds('needs_decision_opened'); assert.deepEqual(stops.map(e => e.node), ['R/M1', 'R/M3']);
  const phases = Object.fromEntries([...state().nodes.values()].map(n => [`${n.node}@g${n.generation}`, [n.phase, n.outcome]]));
  assert.deepEqual([phases['R/M4@g1'], phases['R/M2@g1']], [['closed', 'passed'], undefined], 'R/M4 passed; R/M2 expects R/M1 and was never registered');
  const a = await decide(stops[0].id, FIRST, { obligation: 'R@g1:C1' }); assert.equal(a.code, 0, a.text);
  const b = await decide(stops[1].id, SECOND, { obligation: 'R@g1:C1' }); assert.equal(b.code, 0, b.text);
  const rootStops = kinds('needs_decision_opened').filter(e => e.source === 'obligation');
  assert.deepEqual(rootStops.map(e => e.originStopId), stops.map(e => e.id), 'one root stop per child stop answered');
  assert.deepEqual(kinds('blocked').filter(e => e.reason === 'root_affected').map(e => e.stopId), rootStops.map(e => e.id), 'one block per root stop');
  S.rootStops = rootStops; S.childStops = stops;
  S.obligationDecisions = kinds('decision_recorded').filter(e => e.obligation === 'R@g1:C1');
  assert.equal(S.obligationDecisions.length, 2);
  S.setup = true;
});

test('G1 + G2 - the re-plan on the FIRST root stop: its gate text names the other root stop it retires and shows the words typed for it (not carried), and the passed independent child R/M4 is HELD', async () => {
  need(S.setup, 'setup');
  const [first, second] = S.rootStops;
  // CHANGED ACCEPTED (red triage, C&C thcmcp-cd 23 Okt 2026). OLD: no flag. NEW: `{ fresh: true }`. WHY: since a5d818f (19 Okt: the earlier root plan goes in as DATA by default, and the size is checked at decide for every root re-plan) the input is about 4743 bytes, over the 4000 this setup priced the tree for (`bundleAllowanceBytes: 4000`), so decide refuses; G4's context asserts still hold (the old plan text contains neither FIRST nor SECOND). Run sheet RUN_SHEET_7AM_2026-10-20.md names the 4000-byte cause for G4.
  const d = await decide(first.id, REPLAN, { fresh: true });
  assert.equal(d.code, 0, d.text);
  // G1
  assert.ok(d.text.includes(`Also answered by this decision: the other open stop of the replaced plan (${second.id})`), d.text);
  assert.ok(d.text.includes(`Stop ${second.id} (about the obligation R@g1:C1; your answer ${S.obligationDecisions[1].id} to stop ${S.childStops[1].id}), your words then:`), d.text);
  assert.ok(d.text.includes(`----- decision ${S.obligationDecisions[1].id} -----\n${SECOND}\n----- end -----`), d.text);
  assert.ok(d.text.includes('These earlier words of yours are NOT carried into the new root plan.'), d.text);
  // G2
  assert.match(d.text, /SET ASIDE from now on \(3 nodes[^)]*\):\n {2}- R@g1\n {2}- R\/M1@g1\n {2}- R\/M3@g1\n/);
  assert.match(d.text, /HELD \(1 node in 1 run[^)]*\):\n {2}- R\/M4@g1\n/);
  const s = state();
  assert.deepEqual([keysOf(heldKeys(s)), deadKeys(s).has('R/M4@g1'), s.openStops, [...s.sticky.keys()]], [['R/M4@g1'], false, [], []], 'held, not dead; BOTH root stops retired, BOTH blocks lifted');
  S.replan = true;
});

test('G3 - neither obligation decision ever gets a generation_opened, and the held child is still held after the first sitting that follows the re-plan', async () => {
  need(S.replan, 'G1 + G2');
  const run = await sit();
  assert.equal(run.code, 20, run.text);
  const ids = S.obligationDecisions.map(e => e.id);
  assert.deepEqual(kinds('generation_opened').filter(e => ids.includes(e.decisionId)), [], 'no generation_opened carries an obligation decision\'s id');
  assert.deepEqual(keysOf(heldKeys(state())), ['R/M4@g1'], 'still held');
  S.sat = true;
});

test('G4 - R@g2 starts from a bundle that holds the re-plan words and NEITHER earlier repair text; the held child is still held while it waits for its children frontier', async () => {
  need(S.sat, 'G3');
  assert.equal((await approve()).code, 0);
  const run = await sit();
  assert.equal(run.code, 20, run.text);
  const g2 = state().nodes.get('R@g2'); need(g2, 'R@g2 registered');
  assert.deepEqual([g2.phase, g2.outcome], ['closed', 'passed']);
  const context = readFileSync(join(bundleDirOf(S.rootDir, 'R', 2), 'context.md'), 'utf8');
  assert.ok(context.includes(REPLAN), 'the re-plan words are in the bundle');
  assert.ok(!context.includes(FIRST) && !context.includes(SECOND), 'text the person did not choose is not fed in');
  assert.deepEqual(keysOf(heldKeys(state())), ['R/M4@g1'], 'held until the new root plan\'s children frontier is approved (X1)');
  assert.equal(kinds('held_released').length, 0);
});

test('fail closed - an origin that cannot be proved from events is none: a root stop with no originStopId, an originStopId that names no decision, a stop of a child, and an unknown stop all give null (so the allowance and the supersede do nothing)', () => {
  const stopMeta = new Map([['e5', { node: 'R', generation: 1, originStopId: 'e2' }], ['e6', { node: 'R', generation: 1, originStopId: 'e0' }], ['e7', { node: 'R', generation: 1 }], ['e8', { node: 'R/M1', generation: 1, originStopId: 'e2' }]]);
  const decisions = new Map([['e3', { stopId: 'e2' }]]);
  assert.deepEqual(obligationOriginOf({ stopMeta, decisions }, 'e5'), { originStopId: 'e2', decisionId: 'e3' });
  for (const id of ['e6', 'e7', 'e8', 'e99']) assert.equal(obligationOriginOf({ stopMeta, decisions }, id), null, id);
});
