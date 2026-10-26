// 0.8.3 M6 F2 fix-up (C&C Q5 ruling, 12 Oct 2026): the node whose OWN stop started the obligation route stays INELIGIBLE for the root re-plan's hold, even when its run PASSED. The obligation decision's widening is released (a clean
// sibling is held, test/tree-f2-two-stops.test.js and the whole-tree file), but the child's own stop is a shown reason and its dependents follow "a sub-plan whose supplier is redone is redone too".
// The real-verb walk: R/M1 closes PASSED but BLOCKED (its plan holds a split fence that does not read: readiness code split_unreadable, a blocked-severity reason at its own scope, so a blocked-child stop opens although the run
// passed), R/M3 closes passed and clean. `decide --stop <R/M1's stop> --obligation R@g1:C1` -> root stop -> the re-plan: R/M1@g1 is SET ASIDE, R/M3@g1 is HELD. All-mock, $0; the plan drafts are the stand-in described in
// test/tree-whole-mock.test.js (api.run's `draft`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
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
import { deadKeys, heldKeys } from '../src/tree-transitions.js';
import { track } from './helpers/temp-trees.js';
import { splitRootConfig } from './helpers/tree-fixture.js';
import { splitChild } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { LEAF_PLAN } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';

const ROOT_CHAIN = 'f2o-root';
const CHILD_CHAIN = 'f2o-child';
const BAD_FENCE = '\n```the-high-council:tree-split\n{ this is not json\n```\n';
const work = track(mkdtempSync(join(tmpdir(), 'thc-f2o-')));
mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
writeFileSync(join(work, 'chains', `${ROOT_CHAIN}.json`), JSON.stringify({ ...splitRootConfig(), name: ROOT_CHAIN }, null, 2));
writeFileSync(join(work, 'chains', `${CHILD_CHAIN}.json`), JSON.stringify({ ...splitChild(), name: CHILD_CHAIN }, null, 2));
writeFileSync(join(work, 'plan.md'), plan3());
writeFileSync(join(work, 'leaf-plan.md'), LEAF_PLAN);
writeFileSync(join(work, 'leaf-plan-blocked.md'), `${LEAF_PLAN}${BAD_FENCE}`);

const S = {};
const state = () => stateOf(readTreeRecord(S.rootDir));
const kinds = (...names) => readTreeRecord(S.rootDir).events.filter(e => names.includes(e.event));
const keysOf = set => [...set].sort();
const quiet = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); const buf = []; stdout.on('data', d => buf.push(String(d))); stderr.on('data', d => buf.push(String(d))); return { stdout, stderr, text: () => buf.join('') }; };
const rootStart = opts => api.run({ ...opts, draft: 'plan.md', rounds: 1 });
const sittingStart = ({ node, chain, bundleDir, runId, grantUsd }) => api.run({
  chain, task: join(bundleDir, 'task.md'), ...(existsSync(join(bundleDir, 'criteria.json')) ? { criteria: join(bundleDir, 'criteria.json') } : {}),
  context: join(bundleDir, 'context.md'), runId, treeNode: join(bundleDir, 'node.json'), piiGate: 'hard-stop', /* CHANGED ACCEPTED (19 Okt 2026, the stop is the default): OLD 'warn'. A member is launched with its tree's recorded mode and `tree start` with no flag now records hard-stop; with 'warn' every member would be refused (pii_mode_mismatch, exit 19). */ /* the tree's mode since 0.8.3 (`tree start` always records one, warn by default); a member is launched under it, as src/tree-run.js apiStarter does */ cwd: work, maxUsd: grantUsd, draft: node === 'R' ? 'plan.md' : (node === 'R/M1' ? 'leaf-plan-blocked.md' : 'leaf-plan.md'), rounds: 1,
});
async function sit() { const o = quiet(); const code = await resumeHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdout: o.stdout, stderr: o.stderr, deps: { startRun: sittingStart } }); return { code, text: o.text() }; }
async function approve() {
  const pending = findPendingFrontier({ rootDir: S.rootDir }); assert.ok(pending);
  const t = terminal([pending.key.slice(0, 8), 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  const code = await approveHandler({ rootDir: S.rootDir, rootId: S.rootId, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, text: t.shown() + t.errors() };
}
async function decide(stopId, typed, flags = {}) {
  const t = terminal([`${typed}\n.`, stopId, 'y']); const timer = setTimeout(() => t.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: S.rootDir, rootId: S.rootId, flags: { stop: stopId, ...flags }, work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, text: t.shown() + t.errors() };
}

test('the origin child that PASSED but is blocked by its own stop stays ineligible: the re-plan sets R/M1@g1 aside and holds only the clean sibling R/M3@g1', async () => {
  const o = quiet();
  assert.equal(await startHandler({ flags: { task: 'tasks/x.md', chain: ROOT_CHAIN, 'child-chain': CHILD_CHAIN, 'max-usd': '100' }, work, stdout: o.stdout, stderr: o.stderr, deps: { bundleAllowanceBytes: 4000, startRun: rootStart } }), 0, o.text());
  [S.rootId] = readdirSync(join(work, 'runs')); S.rootDir = join(work, 'runs', S.rootId);
  assert.equal((await sit()).code, 20); assert.equal((await approve()).code, 0);
  const run = await sit();
  assert.equal(run.code, 20, run.text);
  const m1 = state().nodes.get('R/M1@g1'); const m3 = state().nodes.get('R/M3@g1');
  assert.deepEqual([m1.phase, m1.outcome, m3.phase, m3.outcome], ['closed', 'passed', 'closed', 'passed'], 'R/M1 PASSED (its run is fine); only its plan\'s split fence is unreadable');
  const [childStop] = kinds('needs_decision_opened'); assert.deepEqual([childStop.node, childStop.source, childStop.blockedBy.map(b => b.code)], ['R/M1', 'blocked', ['split_unreadable']]);
  const obl = await decide(childStop.id, 'The root rule C1 is wrong, fix it at the root.', { obligation: 'R@g1:C1' });
  assert.equal(obl.code, 0, obl.text);
  const rootStop = kinds('needs_decision_opened').find(e => e.source === 'obligation'); assert.ok(rootStop);
  const d = await decide(rootStop.id, 'Plan it again with a corrected C1.');
  assert.equal(d.code, 0, d.text);
  assert.match(d.text, /SET ASIDE from now on \(2 nodes[^)]*\):\n {2}- R@g1\n {2}- R\/M1@g1\n/, 'the origin child is set aside although it passed: its own stop is a shown reason');
  assert.match(d.text, /HELD \(1 node in 1 run[^)]*\):\n {2}- R\/M3@g1\n/);
  const s = state();
  assert.deepEqual([keysOf(heldKeys(s)), deadKeys(s).has('R/M1@g1')], [['R/M3@g1'], true]);
});
