// A REAL tree at DEPTH 2 taken to a root re-plan, driven only through the person's verbs on all-mock chains ($0): the fixture of S8-9 C5's walk (contract §11.12, "a not-whole top-level child whose finished piece is adopted at the regenerated child's split").
// It stops right after the root re-plan decision: R@g2 is DECIDED (generation_opened), nothing of it is approved, registered or run. Not a test file.
//   leg 1 `tree start`            -> the root run (plan.md: a split block naming R/M1, R/M2, R/M3, signed)
//   leg 2 sitting                 -> the root's split is verified; the children frontier waits
//   leg 3 `tree approve`          -> the children frontier is approved
//   leg 4 sitting                 -> R/M1 (draft = child-plan.md: it SPLITS, with its own questions, signed) and the independent R/M3 close passed; R/M1's own split is verified and ITS children frontier waits
//   leg 5 `tree approve`          -> R/M1's children frontier (R/M1/M1, R/M1/M2, R/M1/M3) is approved
//   leg 6 sitting                 -> R/M1/M1 and R/M1/M2 close passed, R/M1/M3 closes NOT passed (its draft is not signed; it is the INDEPENDENT child: a consumer's critics see its provider's settled text, which carries the mock marker) and a blocked-child stop opens on it; the sitting ends held by the stop
//   leg 7 `decide --obligation`   -> the obligation route opens a ROOT stop (source obligation)
//   leg 8 `decide` on the root stop -> a new root plan (replansRoot): the decision and generation R@g2 are recorded
// What is NOT a verb, as in test/tree-whole-mock.test.js: the plan a model would have written is handed to each run as a DRAFT (api.run's `draft`); the typed text is scripted.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../../src/api.js';
import { startHandler } from '../../src/tree-start.js';
import { resumeHandler } from '../../src/tree-resume.js';
import { approveHandler } from '../../src/tree-approve.js';
import { decideHandler } from '../../src/tree-decide.js';
import { findPendingFrontier } from '../../src/tree-frontier.js';
import { readTreeRecord, stateOf } from '../../src/tree-record.js';
import { track } from './temp-trees.js';
import { splitRootConfig } from './tree-fixture.js';
import { splitChild } from './child-chains.js';
import { block3, ownQuestions, plan3 } from './split-fixture.js';
import { LEAF_PLAN } from './sitting.js';
import { terminal } from './terminal.js';

const ROOT_CHAIN = 'depth2-root';
const CHILD_CHAIN = 'depth2-child';
const UNSIGNED = '# A draft the mock critics do not sign\n\nIt carries no marker line.\n';
const quiet = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); const buf = []; stdout.on('data', d => buf.push(String(d))); stderr.on('data', d => buf.push(String(d))); return { stdout, stderr, text: () => buf.join('') }; };

/** -> { work, rootDir, rootId, childStop, rootStop, decision, opened, kinds(), state(), nodeOf(node, generation), sit(), approve() }. Every assertion names the leg that failed. */
export async function driveToDepthTwoReplan({ taskText = 'Plan a tiny change.\n', startFlags = {}, stopBeforeReplan = false, stopAtChildStop = false } = {}) {
  const work = track(mkdtempSync(join(tmpdir(), 'thc-depth2-')));
  mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), taskText);
  writeFileSync(join(work, 'chains', `${ROOT_CHAIN}.json`), JSON.stringify({ ...splitRootConfig(), name: ROOT_CHAIN }, null, 2));
  writeFileSync(join(work, 'chains', `${CHILD_CHAIN}.json`), JSON.stringify({ ...splitChild(), name: CHILD_CHAIN }, null, 2));
  writeFileSync(join(work, 'plan.md'), plan3());
  writeFileSync(join(work, 'child-plan.md'), plan3(ownQuestions(block3())));                  // R/M1's own plan: a split whose questions are its own (a child may not ask the question an ancestor asked: PLAN 5.5 item 4)
  writeFileSync(join(work, 'leaf-plan.md'), LEAF_PLAN);
  writeFileSync(join(work, 'leaf-plan-unsigned.md'), UNSIGNED);
  const S = { work };
  const kinds = (...names) => readTreeRecord(S.rootDir).events.filter(e => names.includes(e.event));
  const state = () => stateOf(readTreeRecord(S.rootDir));
  const nodeOf = (node, generation) => state().nodes.get(`${node}@g${generation}`);
  const draftFor = node => (node === 'R' ? 'plan.md' : node === 'R/M1' ? 'child-plan.md' : node === 'R/M1/M3' ? 'leaf-plan-unsigned.md' : 'leaf-plan.md');
  const rootStart = opts => api.run({ ...opts, draft: 'plan.md', rounds: 1 });
  const sittingStart = ({ node, chain, bundleDir, runId, grantUsd }) => api.run({
    chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}),
    context: join(bundleDir, 'context.md'), runId, treeNode: join(bundleDir, 'node.json'), piiGate: 'hard-stop', /* CHANGED ACCEPTED (19 Okt 2026, the stop is the default): OLD 'warn'. A member is launched with its tree's recorded mode and `tree start` with no flag now records hard-stop; with 'warn' every member would be refused (pii_mode_mismatch, exit 19). */ /* the tree's mode since 0.8.3: `tree start` always records one (warn by default), and a member is launched under it like src/tree-run.js apiStarter does */ cwd: work, maxUsd: grantUsd, draft: draftFor(node), rounds: 1,
  });
  S.kinds = kinds; S.state = state; S.nodeOf = nodeOf;
  S.sit = async () => { const o = quiet(); const code = await resumeHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdout: o.stdout, stderr: o.stderr, deps: { startRun: sittingStart } }); S.lastSit = o.text().slice(0, 900); return { code, text: o.text() }; };
  S.approve = async () => {
    const pending = findPendingFrontier({ rootDir: S.rootDir }); assert.ok(pending, `a frontier waits for approval; the record: ${readTreeRecord(S.rootDir).events.map(e => `${e.id}:${e.event}${e.node ? `(${e.node}@g${e.generation}${e.source ? ` ${e.source} ${JSON.stringify(e.blockedBy ?? '')}` : ''})` : ''}`).join(' ')}; last sitting: ${S.lastSit ?? ''}`);
    const t = terminal([pending.key.slice(0, 8), 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
    const code = await approveHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
    return { code, text: t.shown() + t.errors(), pending };
  };
  const decide = async (stopId, typed, flags = {}) => {
    const t = terminal([`${typed}\n.`, stopId, 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
    const code = await decideHandler({ rootDir: S.rootDir, rootId: S.rootId, flags: { stop: stopId, ...flags }, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
    return { code, text: t.shown() + t.errors() };
  };

  // leg 1
  const o = quiet();
  assert.equal(await startHandler({ flags: { task: 'tasks/x.md', chain: ROOT_CHAIN, 'child-chain': CHILD_CHAIN, 'max-usd': '100', ...startFlags }, work, stdout: o.stdout, stderr: o.stderr, deps: { bundleAllowanceBytes: 4000, startRun: rootStart } }), 0, `leg 1: ${o.text()}`);
  [S.rootId] = readdirSync(join(work, 'runs')); S.rootDir = join(work, 'runs', S.rootId);
  // legs 2-3: the root's split, its children frontier
  let r = await S.sit(); assert.equal(r.code, 20, `leg 2: ${r.text}`);
  r = await S.approve(); assert.equal(r.code, 0, `leg 3: ${r.text}`);
  // leg 4: R/M1 (it splits) and R/M3 run; R/M1's own split is verified and its children frontier waits
  r = await S.sit(); assert.equal(r.code, 20, `leg 4: ${r.text}`);
  assert.deepEqual([S.nodeOf('R/M1', 1)?.phase, S.nodeOf('R/M1', 1)?.outcome], ['closed', 'passed'], `leg 4: R/M1 must close passed with a split. ${r.text}`);
  // leg 5
  r = await S.approve(); assert.equal(r.code, 0, `leg 5: ${r.text}`);
  // leg 6
  r = await S.sit(); assert.equal(r.code, 20, `leg 6: ${r.text} || nodes: ${[...S.state().nodes.values()].map(x => `${x.node}@g${x.generation} ${x.phase}/${x.outcome}/${x.closedStatus}`).join('; ')}`);
  const stops = kinds('needs_decision_opened'); assert.equal(stops.length, 1, `leg 6: one blocked-child stop expected: ${JSON.stringify(stops)} ${r.text}`);
  [S.childStop] = stops;
  assert.deepEqual([S.childStop.node, S.childStop.source], ['R/M1/M3', 'blocked'], 'leg 6');
  S.decide = decide;
  if (stopAtChildStop) return S;       // bundle unit step 2 (slot route): the blocked child's stop is still open
  // leg 7
  let d = await decide(S.childStop.id, 'The root rule C1 is wrong, fix it at the root.', { obligation: 'R@g1:C1' }); assert.equal(d.code, 0, `leg 7: ${d.text}`);
  S.rootStop = kinds('needs_decision_opened').find(e => e.source === 'obligation'); assert.ok(S.rootStop, 'leg 7: the root stop');
  S.decide = decide;       // bundle unit step 2: a test may take leg 8 itself (flags, a different tree.json allowance) with `stopBeforeReplan`
  if (stopBeforeReplan) return S;
  // leg 8
  d = await decide(S.rootStop.id, 'Plan it again with a corrected C1.'); assert.equal(d.code, 0, `leg 8: ${d.text}`);
  S.decision = kinds('decision_recorded').at(-1);
  [S.opened] = kinds('generation_opened').filter(e => e.nodes.some(x => x.node === 'R' && x.generation === 2));
  assert.ok(S.decision?.replansRoot === true && S.opened, 'leg 8: the replansRoot decision and R@g2 are recorded');
  return S;
}
