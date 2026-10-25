// D2 F5 as D3 amends it (CR-2G-001, the unverified-split loop; Q3, Muad 25 Okt 2026 14:45 "Yes to all" on Astra's list: "allow narrowly defined free reconciliation under a block; keep execution blocked") and CR-2G-004 (with D3 F5-2).
// ONE record-only phase (src/tree-run.js recordOnlyPhase) runs at the top of every sitting step AND before `tree resume`'s blocked branch: recovery's completions (now ahead of the sticky return), the verification of finished splits, the
// sitting's close test. Nothing starts, resumes or registers under a block. CR-2G-004: a root re-plan waits for a recorded decision that is not opened yet ("run `council tree resume` first"), except the decisions the re-plan itself
// supersedes, which recovery skips under root_affected by the SAME predicate (tree-transitions.js supersededByRootReplan). Real verbs on all-mock chains, $0; the plans are drafts handed to each run (api.run's `draft`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import { startHandler } from '../src/tree-start.js';
import { resumeHandler } from '../src/tree-resume.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { requestStop } from '../src/tree-run.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { track } from './helpers/temp-trees.js';
import { splitRootConfig } from './helpers/tree-fixture.js';
import { splitChild } from './helpers/child-chains.js';
import { block3, ownQuestions, plan3 } from './helpers/split-fixture.js';
import { LEAF_PLAN } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';

const quiet = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); const buf = []; stdout.on('data', d => buf.push(String(d))); stderr.on('data', d => buf.push(String(d))); return { stdout, stderr, text: () => buf.join('') }; };
const UNSIGNED = '# A draft the mock critics do not sign\n\nIt carries no marker line.\n';

test('T5 (F5a, CR-2G-001\'s door A4-V2): R/M1\'s plan edited after its children frontier was approved -> parent_changed and a stop on R/M1; the person regenerates R/M1; the NEXT resume opens the decision under the block, the block lifts and the replacement waits for approval', { timeout: 900_000 }, async () => {
  const S = await driveToDepthTwoReplan({ stopAfterChildFrontier: true });
  const m1 = S.nodeOf('R/M1', 1);
  const file = join(S.work, 'runs', m1.runId, 'deliverable.md');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nAn edit after the panel signed.\n`);
  const blocked = await S.sit();
  assert.ok(S.state().sticky.has('parent_changed'), `the drifted parent blocks the tree: ${blocked.text}`);
  const stop = S.kinds('needs_decision_opened').filter(e => e.node === 'R/M1').at(-1);
  assert.ok(stop, `a stop is open on R/M1: ${blocked.text}`);
  const d = await S.decide(stop.id, 'Plan R/M1 again.');
  assert.equal(d.code, 0, d.text);
  const decision = S.kinds('decision_recorded').at(-1);
  const again = await S.sit();
  assert.ok(S.kinds('generation_opened').some(e => e.decisionId === decision.id), `the decision is opened by the resume: ${again.text}`);
  assert.equal(S.state().sticky.has('parent_changed'), false, `the block lifts with the replaced parent: ${again.text}`);
  assert.ok(findPendingFrontier({ rootDir: S.rootDir }), 'the replacement waits for approval');
});

test('T5c (F5b, the unverified-split loop): R/M3 closes with a split but the person stopped the sitting before it was verified; root_affected by the obligation route; the root re-plan form refuses ("not verified yet: run resume"); the resume now verifies it UNDER the block, so the re-plan form goes on', { timeout: 900_000 }, async () => {
  const work = track(mkdtempSync(join(tmpdir(), 'thc-f5c-')));
  mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  writeFileSync(join(work, 'chains', 'f5c-root.json'), JSON.stringify({ ...splitRootConfig(), name: 'f5c-root' }, null, 2));
  writeFileSync(join(work, 'chains', 'f5c-child.json'), JSON.stringify({ ...splitChild(), name: 'f5c-child' }, null, 2));
  writeFileSync(join(work, 'plan.md'), plan3());
  // R/M3's own split: R/M3 (K3) carries only C1 (global) and C2 (inherited), so its block names those two classes only (a class C3 is not one of its locked criteria: split_invalid, found by the probe of this test's first run)
  const m3Block = ownQuestions(block3()); m3Block.classes = m3Block.classes.filter(c => c.id !== 'C3'); for (const c of m3Block.children) c.inherits = c.inherits.map(x => (x === 'C3' ? 'C2' : x));
  writeFileSync(join(work, 'child-plan.md'), plan3(m3Block));
  writeFileSync(join(work, 'leaf-plan.md'), LEAF_PLAN);
  writeFileSync(join(work, 'leaf-plan-unsigned.md'), UNSIGNED);
  const S = {};
  const kinds = (...names) => readTreeRecord(S.rootDir).events.filter(e => names.includes(e.event));
  const state = () => stateOf(readTreeRecord(S.rootDir));
  const draftFor = node => (node === 'R' ? 'plan.md' : node === 'R/M1' ? 'leaf-plan-unsigned.md' : node === 'R/M3' ? 'child-plan.md' : 'leaf-plan.md');
  const startRun = async ({ node, chain, bundleDir, runId, grantUsd }) => {
    const res = await api.run({ chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}), context: join(bundleDir, 'context.md'), runId, treeNode: join(bundleDir, 'node.json'), piiGate: 'hard-stop', cwd: work, maxUsd: grantUsd, draft: draftFor(node), rounds: 1 });
    if (node === 'R/M3') requestStop(S.rootDir);            // the person's `council tree stop` while R/M3 runs: the next step ends the sitting before it verifies R/M3's split
    return res;
  };
  const sit = async () => { const o = quiet(); const code = await resumeHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdout: o.stdout, stderr: o.stderr, deps: { startRun } }); return { code, text: o.text() }; };
  const approve = async () => {
    const pending = findPendingFrontier({ rootDir: S.rootDir }); assert.ok(pending);
    const t = terminal([pending.key.slice(0, 8), 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
    const code = await approveHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
    return { code, text: t.shown() + t.errors() };
  };
  const decide = async (stopId, typed, flags = {}, answers = [`${typed}\n.`, stopId, 'y']) => {
    const t = terminal(answers); const timer = setTimeout(() => t.stdin.end(), 8000);
    const code = await decideHandler({ rootDir: S.rootDir, rootId: S.rootId, flags: { stop: stopId, ...flags }, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
    return { code, text: t.shown() + t.errors() };
  };
  const o = quiet();
  assert.equal(await startHandler({ flags: { task: 'tasks/x.md', chain: 'f5c-root', 'child-chain': 'f5c-child', 'max-usd': '100' }, work, stdout: o.stdout, stderr: o.stderr, deps: { bundleAllowanceBytes: 4000, startRun: opts => api.run({ ...opts, draft: 'plan.md', rounds: 1 }) } }), 0, o.text());
  [S.rootId] = readdirSync(join(work, 'runs')); S.rootDir = join(work, 'runs', S.rootId);
  assert.equal((await sit()).code, 20); assert.equal((await approve()).code, 0);
  const run = await sit();
  const m3 = state().nodes.get('R/M3@g1');
  assert.deepEqual([m3?.phase, m3?.outcome], ['closed', 'passed'], run.text);
  assert.equal(kinds('split_verified').some(e => e.node === 'R/M3'), false, `the person's stop ended the sitting before R/M3 was verified: ${run.text}`);
  const childStop = kinds('needs_decision_opened').find(e => e.node === 'R/M1');
  assert.ok(childStop, `R/M1 (not signed) has a stop: ${run.text}`);
  assert.equal((await decide(childStop.id, 'The root rule C1 is wrong, fix it at the root.', { obligation: 'R@g1:C1' })).code, 0);
  assert.ok(state().sticky.has('root_affected'));
  const rootStop = kinds('needs_decision_opened').find(e => e.source === 'obligation');
  const refused = await decide(rootStop.id, 'Plan it again with a corrected C1.');
  assert.match(refused.text, /R\/M3@g1 has a split that is not verified yet/, refused.text);
  const resumed = await sit();
  assert.ok(kinds('split_verified').some(e => e.node === 'R/M3' && e.generation === 1), `the resume verifies R/M3 under the block: ${resumed.text}`);
  assert.ok(state().sticky.has('root_affected'), 'the block stands: nothing was started');
  const d = await decide(rootStop.id, 'Plan it again with a corrected C1.');
  assert.equal(d.code, 0, d.text);
  assert.equal(kinds('decision_recorded').at(-1).replansRoot, true);
});

test('CR-2G-004: a regenerate decision recorded and not opened yet (no resume between) holds a new root plan back ("run `council tree resume` first"); after the resume opens it, the new root plan goes on', { timeout: 900_000 }, async () => {
  const S = await driveToDepthTwoReplan({ stopAtChildStop: true });
  const d1 = await S.decide(S.childStop.id, 'Plan R/M1/M3 again.');
  assert.equal(d1.code, 0, d1.text);
  const regenerate = S.kinds('decision_recorded').at(-1);
  assert.equal(S.kinds('generation_opened').some(e => e.decisionId === regenerate.id), false, 'not opened: no resume ran');
  const t = terminal(['The plan needs a different approach.\n.', 'R@g1', 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  const opened = await decideHandler({ rootDir: S.rootDir, rootId: S.rootId, flags: { 'open-root-stop': true }, work: S.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.equal(opened, 0, t.shown() + t.errors());
  const rootStop = S.kinds('needs_decision_opened').filter(e => e.node === 'R').at(-1);
  const held = await S.decide(rootStop.id, 'Plan it again.');
  assert.notEqual(held.code, 0);
  assert.match(held.text, new RegExp(`decision ${regenerate.id} is recorded but the new plan it asked for is not opened yet: run \`council tree resume ${S.rootId}\` first, then decide`), held.text);
  assert.equal(S.kinds('decision_recorded').some(e => e.replansRoot === true), false, 'no root re-plan was recorded');
  await S.sit();
  const d2 = await S.decide(rootStop.id, 'Plan it again.');
  assert.equal(d2.code, 0, d2.text);
  assert.equal(S.kinds('decision_recorded').at(-1).replansRoot, true);
});
