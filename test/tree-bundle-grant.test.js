// BUNDLE UNIT step 1 (19 Okt 2026, C&C-gated SHA-stop: money + record): the grant is priced for an INPUT of up to the tree's allowance (tree.json `bundleAllowanceBytes`, default 100,000 bytes), at preview and at registration alike, and a derived bundle
// bigger than the allowance is refused before anything is registered (`bundle_over_shown`). Real verbs, all-mock, $0. Plan note: Review/Build_0.8.3/m7/A_Bundle_Grant_Plan_Note.md + A_Bundle_Unit_Plan_Note2.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { chainFigures, bundleAllowanceBytesOf, bundleInputBytes, DEFAULT_BUNDLE_ALLOWANCE_BYTES } from '../src/tree-budget.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren, pricedDebate } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending, eventsOf } from './helpers/sitting.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { renderFrontierText, money } from '../src/tree-stop.js';
import { dryRunReport } from '../src/dry-run.js';
import { loadChainConfig } from '../src/tree-derive-load.js';
import { needsDecisionStopText } from '../src/tree-stop-view.js';
import { decideHandler } from '../src/tree-decide.js';
import { projectTree } from '../src/tree-projection.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID, cli, installSplitRoot } from './helpers/tree-fixture.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const sittings = async r => { let last; for (let i = 0; i < 6; i += 1) { last = await runTree(r.t.rootDir, { work: r.t.work }); if (last.status !== 'limit_reached') break; } return last; };

test('BG-1 the figures: with an input size the chain is priced for that input (higher than at its declared sizes, once the input passes them); with none, byte-identical to before; the setting reads as a positive whole number or the default', () => {
  // a shipped chain with real prices moves with the input (the fixture-priced mock chains do not: their prices ignore size); plan-lanes-4: 6.36 at its declared sizes -> 7.01 at 100,000 bytes (bundle-n100000.txt)
  const cfg = JSON.parse(readFileSync(new URL('../chains/outdated/plan-lanes-4.json', import.meta.url), 'utf8'));
  const plain = chainFigures(cfg); const big = chainFigures(cfg, { inputBytes: 100_000 });
  assert.ok(plain && big);
  assert.ok(big.atMostUsd > plain.atMostUsd && big.cheapestUsd >= plain.cheapestUsd, JSON.stringify({ plain, big }));
  assert.deepEqual(chainFigures(cfg, { inputBytes: null }), plain, 'no input size = the figures of today');
  assert.equal(bundleAllowanceBytesOf({}), DEFAULT_BUNDLE_ALLOWANCE_BYTES); assert.equal(bundleAllowanceBytesOf({ bundleAllowanceBytes: 5000 }), 5000);
  for (const bad of [0, -1, 1.5, '5000', null]) assert.equal(bundleAllowanceBytesOf({ bundleAllowanceBytes: bad }), DEFAULT_BUNDLE_ALLOWANCE_BYTES, String(bad));
  assert.equal(bundleInputBytes({ 'task.md': 'ab', 'context.md': 'é', 'old-plan.md': 'xyz' }), 2 + 2 + 3, 'every file of the map counts, in bytes');
});

test('BG-2 REGISTRATION: a derived bundle bigger than the allowance is refused before the child exists (a bundle_input stop - close it or re-plan it - nothing registered, nothing spent); at an allowance that fits (4000 bytes: the declared prompt of the fixture chains) the same tree registers and runs', async () => {
  const small = await trackedRealRoot({ ...splitChildren(), plan: plan3(), bundleAllowanceBytes: 800 }); approvePending(small);
  await sittings(small);
  const stops = eventsOf(small).filter(e => e.event === 'needs_decision_opened' && e.source === 'bundle_input');
  assert.ok(stops.length >= 1, JSON.stringify(eventsOf(small).filter(e => e.event === 'blocked').map(e => e.check)));
  assert.ok(stops[0].findings.some(f => /^oversize: \d+ bytes, over the 800 its approval was priced for$/.test(f.name)), JSON.stringify(stops[0].findings));
  assert.equal(stateOf(readTreeRecord(small.t.rootDir)).nodes.has('R/M1@g1'), false, 'the child was not registered');
  const ok = await trackedRealRoot({ ...splitChildren(), plan: plan3(), bundleAllowanceBytes: 4000 }); approvePending(ok);
  await sittings(ok);
  assert.equal(eventsOf(ok).some(e => e.event === 'needs_decision_opened' && e.source === 'bundle_input'), false);
  assert.ok(stateOf(readTreeRecord(ok.t.rootDir)).nodes.has('R/M1@g1'), 'at an allowance that fits the child registers');
});

test('BG-3 THE SCREEN LINE (Muad 19 Okt: "priced for an input of up to 100 KB"): the approval screen names the input size its figures are priced for, in the unit of the allowance (KB = 1000 bytes)', async () => {
  for (const [bytes, line] of [[100_000, 'priced for an input of up to 100 KB'], [4000, 'priced for an input of up to 4 KB']]) {
    const r = await trackedRealRoot({ ...splitChildren(), plan: plan3(), bundleAllowanceBytes: bytes });
    const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
    const text = renderFrontierText(d.view);
    assert.ok(text.includes(line), `${bytes}: ${text.split('\n').filter(l => l.includes('Price')).join(' | ')}`);
    assert.equal(text.includes('task-less'), false);
  }
});

test('BG-4 OVERSIZE IS ITS OWN KIND (C&C 19 Okt): its stop names the ways that work (close it unstarted, or re-plan the parent smaller), never offers --allow-pii-node, and `--allow-pii-node` on it is refused with its own sentence (a PII allowance must not let unpriced bytes through); the finding carries no line', async () => {
  const r = await trackedRealRoot({ ...splitChildren(), plan: plan3(), bundleAllowanceBytes: 800 }); approvePending(r);
  await sittings(r);
  const [stop] = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'bundle_input');
  assert.ok(stop, 'a stop was opened');
  assert.deepEqual(stop.findings.map(f => [f.file, f.line]), [['(whole input)', null]]);
  const text = needsDecisionStopText(r.t.rootDir, stop);
  assert.equal(text.includes('--allow-pii-node'), false, text); assert.ok(text.includes(`--close ${(stop.child ?? stop).node}`) || text.includes('--close'), text); assert.ok(text.includes('--stop'), text); assert.equal(/line null/.test(text), false);
  const io = terminal([(stop.child ?? stop).node, 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { 'allow-pii-node': `${(stop.child ?? stop).node}@g${(stop.child ?? stop).generation}` }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.equal(code, 1, io.shown() + io.errors()); assert.match(io.errors(), /is about an input over the size its approval was priced for/);
  assert.equal(eventsOf(r).some(e => e.event === 'bundle_input_allowed'), false);
});

test('BG-5 A TASK OVER THE ALLOWANCE IS REFUSED AT START (C&C 19 Okt): `tree start` prints the size, the limit and the way out, exit 2, nothing started; a task under it starts', () => {
  const mk = size => { const dir = mkdtempSync(join(tmpdir(), 'thc-bg5-')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), `Plan a tiny change.\n${'x'.repeat(size)}\n`); installSplitRoot(dir); writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2)); return dir; };
  const start = dir => spawnSync(process.execPath, [cli, 'tree', 'start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  const big = mk(100_001); const r = start(big);
  assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stderr, /the task is 100\d{3} bytes, over the 100000 bytes a sub-plan's approval is priced for/);
  const ok = start(mk(2000)); assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('BG-6 THE START FIGURE IS THE APPROVAL FIGURE (C&C 19 Okt): the projection `tree start` prints prices the child chain for the same input as the approval does (same chainFigures path): cheapest end and at-most agree', () => {
  const cfg = JSON.parse(readFileSync(new URL('../chains/outdated/plan-lanes-4.json', import.meta.url), 'utf8'));
  const p = projectTree({ root: { name: 'r', config: cfg, taskChars: 2000 }, child: { name: 'c', config: cfg, taskChars: 100_000 } });
  const f = chainFigures(cfg, { inputBytes: 100_000 });
  assert.equal(p.child.maximumUsd, f.atMostUsd); assert.equal(p.child.cheapestUsd, f.cheapestUsd);
  assert.ok(p.child.maximumUsd > chainFigures(cfg).atMostUsd, 'and it is higher than the declared-size figure');
});

test('BG-AS8b ONE BASIS ON THE CHILDREN SCREEN (no words changed): cheapest end, expected and upper estimate are all priced for the allowance, so the expected figure is the with-input one', async () => {
  const r = await trackedRealRoot({ ...splitChildren(), plan: plan3(), bundleAllowanceBytes: 100_000 });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  const text = renderFrontierText(d.view);
  const kid = loadChainConfig({ tree: readTreeRecord(r.t.rootDir).tree, depth: 1, work: r.t.work });
  const e = dryRunReport(kid.config, { taskChars: 100_000 }).estimate;
  assert.ok(Number.isFinite(e.expectedWithTaskUsd) && e.expectedWithTaskUsd - e.expectedUsd >= 0.01, `fixture: both bases are reachable (${e.expectedUsd} without the input, ${e.expectedWithTaskUsd} with it)`);
  assert.ok(text.includes(`${money(e.floorWithTaskUsd)} cheapest end, ${money(e.expectedWithTaskUsd)} expected,`), text.split('\n').filter(l => l.includes('Price')).join(' | '));       // red at 8c71d2b: the no-task expected figure
});
