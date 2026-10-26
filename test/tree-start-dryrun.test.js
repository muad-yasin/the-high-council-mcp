// `council tree start --dry-run` (0.8.3 M6, ROADMAP 56; contract Review/Build_0.8.3/m6-closing/ROADMAP56_Tree_Start_DryRun_Contract.md, gate 1 passed with C&C's amendments 12 Oct): what a tree on two chains could cost at the default limits,
// CHANGED ACCEPTED (label rename, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD the printed label "at most" / "MAXIMUM" / "Maximum:"; NEW "upper estimate" / "UPPER ESTIMATE" / "Upper estimate:". WHY: only the printed figure label moved; the held sentences (README/docs/chain descriptions) still say "at most" and their pins here are unchanged.
// BEFORE anything is written or spent. The same refusals as `start` up to where a normal run's dry run exits (options, task, chain files, lint, milestones, policy), nothing after: no keys, no key scan, no personal-data check, no
// `--max-usd` needed. Every working folder is a temp folder of the test's own; every chain is mock or a shipped chain read at $0 (a dry run calls nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { DEFAULT_HANDLERS, TREE_ONLY_FLAGS, TREE_VALUE_FLAGS, treeCommand } from '../src/tree-cli.js';
import { shippedMilestoneChains } from '../src/tree-start.js';
import { DEFAULT_LIMITS } from '../src/tree-record.js';
import { chainFigures, DEFAULT_BUNDLE_ALLOWANCE_BYTES } from '../src/tree-budget.js';
// CHANGED ACCEPTED (19 Okt 2026, bundle unit, C&C ruling 3): OLD the sub-plan row was the chain's figures at its declared sizes (dryRunReport(kidCfg).estimate). NEW the projection prices the sub-plan for the same input as the approval (the tree's allowance), the with-task figures when the input passes the chain's assumed prompt. WHY: the start figure must equal the approval figure.
const kidAt = cfg => { const e = dryRunReport(cfg, { taskChars: DEFAULT_BUNDLE_ALLOWANCE_BYTES }).estimate; return { expectedUsd: e.expectedWithTaskUsd ?? e.expectedUsd, maximumUsd: e.maximumWithTaskUsd ?? e.maximumUsd, floorUsd: e.floorWithTaskUsd ?? e.floorUsd }; };
import { dryRunReport } from '../src/dry-run.js';
import { projectionLines } from '../src/tree-projection.js';
import { formatUsd } from '../src/cost.js';
import { cli, installSplitRoot } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const SECRET = `sk_${'live_'}${'abcd'.repeat(6)}`;
const MAIL = ['jane.doe', '@', 'mail-corp', '.de'].join('');
// the child chain differs from the root in its assumed sizes, so a total that confused the two would show
const BIG = { promptTokens: 3000, draftTokens: 2000, critiqueTokens: 600 };
function work({ task = 'Plan a tiny change.\n', policy = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-dr-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), task);
  installSplitRoot(dir);
  writeFileSync(join(dir, 'chains', 'priced-big.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-big', estimate: BIG }, null, 2));
  // a chain that fails the chain lint (a seat under a key no stage reads), one that never writes the milestone lint, and one with a seat that has no price row
  writeFileSync(join(dir, 'chains', 'lint-bad.json'), JSON.stringify({ ...pricedDebate(), name: 'lint-bad', seats: { ...pricedDebate().seats, critic: { provider: 'mock', model: 'mock-critic-a' } } }, null, 2));
  writeFileSync(join(dir, 'chains', 'no-milestones.json'), JSON.stringify({ ...pricedDebate(), name: 'no-milestones', handoff_contract: {} }, null, 2));
  writeFileSync(join(dir, 'chains', 'unpriced.json'), JSON.stringify({ ...pricedDebate(), name: 'unpriced', seats: { ...pricedDebate().seats, builder: { provider: 'openrouter', model: 'acme/not-in-the-price-table' } } }, null, 2));
  if (policy !== null) writeFileSync(join(dir, 'policy.json'), policy);
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
const startArgs = (chain, child, extra = []) => ['tree', 'start', '--task', 'tasks/x.md', '--chain', chain, '--child-chain', child, ...extra];
const snapshot = dir => JSON.stringify(readdirSync(dir, { recursive: true }).sort());
const norm = (dir, s) => s.split(dir).join('<WORK>');
const io = () => { const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough(); let o = ''; let e = ''; stdout.on('data', d => { o += d; }); stderr.on('data', d => { e += d; }); return { stdin, stdout, stderr, out: () => o, err: () => e }; };
const config = (dir, name) => JSON.parse(readFileSync(join(dir, 'chains', `${name}.json`), 'utf8'));
/** The tree's runs at the default limits, derived (never typed): depth and fan-out first, then the run limit. */
const subPlansAt = (l = DEFAULT_LIMITS) => Math.min(l.maxRuns, Array.from({ length: l.maxDepth + 1 }, (_, d) => l.maxChildrenPerSplit ** d).reduce((a, b) => a + b, 0)) - 1;
const line = (out, start) => out.split('\n').find(l => l.trimStart().startsWith(start)) ?? '';

test('DR-1 `tree start --dry-run` prints the projection and exits 0, writes NOTHING (no runs/, no tree.json, no lock), consumes no run id and starts no run; no --max-usd is needed', async () => {
  const dir = work(); const before = snapshot(dir);
  const r = run(dir, startArgs('split-root', 'priced-big', ['--dry-run']));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /^Tree cost, PROJECTED/m); assert.match(r.stdout, /nothing was started, written or spent/);
  assert.equal(snapshot(dir), before, 'the work folder is unchanged'); assert.equal(existsSync(join(dir, 'runs')), false);
  // through the handler: neither the starter nor the run-id maker is ever called
  const d = io(); const touched = [];
  const code = await treeCommand(startArgs('split-root', 'priced-big', ['--dry-run']).slice(1), { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: () => { touched.push('startRun'); throw new Error('no run'); }, newRunId: () => { touched.push('newRunId'); throw new Error('no id'); } } }) } });
  assert.equal(code, 0, d.err() + d.out()); assert.deepEqual(touched, []); assert.equal(snapshot(dir), before);
});

test('DR-2 the arithmetic: root + (runs - 1) x sub-plan, every dollar figure labelled PROJECTED, the conditions on the heading and the whole-tree line; the sub-plan at-most IS the figure admission caps a grant at', () => {
  const dir = work(); const rootCfg = { ...config(dir, 'split-root') }; const kidCfg = config(dir, 'priced-big');
  const rootEst = dryRunReport(rootCfg, { taskChars: 'Plan a tiny change.\n'.length }).estimate; const kidEst = kidAt(kidCfg);
  const rootMax = rootEst.maximumWithTaskUsd ?? rootEst.maximumUsd; const rootExp = rootEst.expectedWithTaskUsd ?? rootEst.expectedUsd;
  const n = subPlansAt();
  assert.equal(n, DEFAULT_LIMITS.maxRuns - 1, 'at the default limits the run limit binds: depth and fan-out allow more runs than maxRuns');
  assert.ok(kidEst.maximumUsd > 0 && rootMax > 0 && kidEst.maximumUsd !== rootMax, 'a priced pair that differs, so a confused total would show');
  assert.equal(chainFigures(kidCfg, { inputBytes: DEFAULT_BUNDLE_ALLOWANCE_BYTES }).atMostUsd, kidEst.maximumUsd, 'the figure admission uses');
  const r = run(dir, startArgs('split-root', 'priced-big', ['--dry-run'])); assert.equal(r.status, 0, r.stderr);
  const head = line(r.stdout, 'Tree cost, PROJECTED'); const rootRow = line(r.stdout, 'root plan'); const kidRow = line(r.stdout, 'sub-plan'); const whole = line(r.stdout, 'whole tree');
  for (const [name, l] of [['heading', head], ['root row', rootRow], ['sub-plan row', kidRow], ['whole-tree row', whole]]) assert.match(l, /PROJECTED/, `${name}: ${l}`);
  assert.ok(rootRow.includes(`expected ${formatUsd(rootExp)}`) && rootRow.includes(`upper estimate ${formatUsd(rootMax)}`), rootRow);
  assert.ok(kidRow.includes(`expected ${formatUsd(kidEst.expectedUsd)}`) && kidRow.includes(`upper estimate ${formatUsd(kidEst.maximumUsd)}`) && kidRow.includes(`cheapest end ${formatUsd(kidEst.floorUsd)}`), kidRow);
  assert.ok(whole.includes(`expected ${formatUsd(rootExp + n * kidEst.expectedUsd)}`) && whole.includes(`upper estimate ${formatUsd(rootMax + n * kidEst.maximumUsd)}`), whole);
  assert.ok(whole.includes(`${DEFAULT_LIMITS.maxRuns} runs: the root + ${n} sub-plans`), whole);
  // C&C amendment 1 (+ my advisor: the prompt size): "at most" is true only for one clean pass at the chains' assumed prompt sizes, at the default limits, before a root re-plan or a top-up, and the line that prints it says so
  for (const l of [head, whole]) assert.match(l, /one clean pass of each chain at its assumed prompt sizes, at the default limits, before any root re-plan or top-up/, l);
  assert.match(r.stdout, /src\/pricing\.json as of /, 'the price table is named, with its date');
});

test('DR-3 the shared refusals are start\'s own: the same text and exit code for the same input (options, task, chain files, lint, milestones, policy); a bad --max-usd is checked as start checks it', () => {
  const cases = [
    ['no chain', dir => ['tree', 'start', '--task', 'tasks/x.md', '--child-chain', 'priced-big'], null],
    ['no task file', () => ['tree', 'start', '--task', 'tasks/none.md', '--chain', 'split-root', '--child-chain', 'priced-big'], null],
    ['unknown chain', () => startArgs('split-root', 'nope'), null],
    ['lint', () => startArgs('lint-bad', 'priced-big'), null],
    ['no milestones (child)', () => startArgs('split-root', 'no-milestones'), null],
    ['policy refuses (the child chain is held to it too)', () => startArgs('split-root', 'plan-mini-council'), JSON.stringify({ allowed_providers: ['mock'] })],
    ['policy unreadable', () => startArgs('split-root', 'priced-big'), '{ not json'],
    ['bad cap', () => startArgs('split-root', 'priced-big', ['--max-usd', 'lots']), null],
    ['cap none', () => startArgs('split-root', 'priced-big', ['--max-usd', 'none']), null],
  ];
  for (const [name, args, policy] of cases) {
    const dir = work({ policy }); const before = snapshot(dir);
    const real = run(dir, [...args(dir), ...(args(dir).includes('--max-usd') ? [] : ['--max-usd', '5'])]); const dry = run(dir, [...args(dir), '--dry-run']);
    assert.notEqual(real.status, 0, `${name}: the real start refuses (${real.stderr})`);
    assert.equal(dry.status, real.status, `${name}: the same exit code (${dry.stderr})`); assert.equal(norm(dir, dry.stderr), norm(dir, real.stderr), `${name}: the same text`);
    assert.equal(snapshot(dir), before, `${name}: nothing written`);
  }
});

test('DR-4 it asks no key, no key scan and no personal-data check: shipped chains whose keys are missing and a task holding a key-shaped string and an e-mail address still print the projection (exit 0); the same inputs without --dry-run are refused', () => {
  // 0.8.3 (lane B): cheap-7-v2 retired to chains/outdated/; plan-mini-council, a shipped real-key chain that writes the milestone lint, is the fixture now.
  assert.ok(shippedMilestoneChains().includes('plan-mini-council'), 'plan-mini-council is a shipped chain that writes the milestone lint (the fixture of this test)');
  const dir = work({ task: `Plan a change. Key ${SECRET}. Contact ${MAIL}.\n` }); const before = snapshot(dir);
  const dry = run(dir, startArgs('plan-mini-council', 'plan-mini-council', ['--dry-run'])); assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Not checked here: API keys, the key scan and the personal-data check of the task/);
  assert.equal(snapshot(dir), before);
  const real = run(dir, startArgs('plan-mini-council', 'plan-mini-council', ['--max-usd', '5']));
  assert.equal(real.status, 5, 'the real start stops at the missing key first'); assert.equal(snapshot(dir), before);
});

test('DR-5 an unpriced seat is shown as "not priced" and NO whole-tree total is printed (a sum that leaves a seat out reads as complete); exit 0; start refuses the same pair (5)', () => {
  const dir = work();
  const dry = run(dir, startArgs('unpriced', 'priced-big', ['--dry-run'])); assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /unpriced: the seat openrouter\/acme\/not-in-the-price-table is not priced: no total for the whole tree can be given \(council tree start refuses a chain with an unpriced seat\)/);
  assert.equal(line(dry.stdout, 'whole tree'), '', dry.stdout);
  const real = run(dir, startArgs('unpriced', 'priced-big', ['--max-usd', '5'])); assert.equal(real.status, 5, real.stderr);
  const kid = run(dir, startArgs('split-root', 'unpriced', ['--dry-run'])); assert.equal(kid.status, 0, kid.stderr); assert.equal(line(kid.stdout, 'whole tree'), '');
});

test('DR-6 the cap sentences come from the tree\'s admission rule and never predict a count: below the root\'s at-most, below the whole tree\'s, at or above it; none without --max-usd, which is optional', () => {
  const dir = work(); const rootCfg = config(dir, 'split-root'); const kidCfg = config(dir, 'priced-big');
  const rootEst = dryRunReport(rootCfg, { taskChars: 20 }).estimate; const kidEst = kidAt(kidCfg);
  const rootMax = rootEst.maximumWithTaskUsd ?? rootEst.maximumUsd; const whole = rootMax + subPlansAt() * kidEst.maximumUsd;
  const at = cap => run(dir, startArgs('split-root', 'priced-big', ['--dry-run', '--max-usd', String(cap)]));
  const low = at((rootMax / 2).toFixed(6)); assert.equal(low.status, 0, low.stderr);
  assert.match(low.stdout, /the root run alone can spend more than this cap; it may stop at the cap before its plan is finished/);
  const mid = at(((rootMax + whole) / 2).toFixed(6)); assert.equal(mid.status, 0, mid.stderr);
  // CHANGED ACCEPTED (A3b, E42, 18 Okt 2026). OLD: "the tree never spends more than the cap. A sub-plan is admitted only when ...". NEW: "the tree counts its spend against the cap and admits a sub-plan only when ...". WHY: the old sentence was a money promise
  // that a call priced at $0 when its cost is not recorded can break (E141); the new one states the mechanism (final wording, pass 2).
  assert.match(mid.stdout, /the tree counts its spend against the cap and admits a sub-plan only when its share of the money still free reaches the cheapest end of its chain/);
  assert.ok(mid.stdout.includes(formatUsd(kidEst.floorUsd)) && /PROJECTED/.test(line(mid.stdout, 'the tree counts') + mid.stdout), 'the cheapest end is named');
  const high = at((whole * 2).toFixed(6)); assert.equal(high.status, 0, high.stderr);
  assert.match(high.stdout, /the cap is above the largest this projection reaches \(PROJECTED upper estimate [^)]*\); a run can still reach the cap through calls this projection leaves out/);   // E42: OLD ended at the bracket; NEW adds the clause that the cap can still be reached
  const none = run(dir, startArgs('split-root', 'priced-big', ['--dry-run']));
  assert.doesNotMatch(none.stdout, /this cap|the tree counts its spend|the cap is above/);
  for (const o of [low.stdout, mid.stdout, high.stdout]) assert.doesNotMatch(o, /\bwill run\b|sub-plans will|only \d+ sub-plan/, 'no sentence predicts how many sub-plans run');
});

test('DR-7 `--dry-run` belongs to `start` alone: another tree verb refuses it as it always did, `--dry-run=true` is refused like every flag, twice is "given twice", and a normal run\'s --dry-run still prices', () => {
  const dir = work();
  const other = run(dir, ['tree', 'status', 'x', '--dry-run']); assert.notEqual(other.status, 0); assert.match(other.stderr, /--dry-run: not an option of `council tree status`/);
  const eq = run(dir, startArgs('split-root', 'priced-big', ['--dry-run=true'])); assert.notEqual(eq.status, 0); assert.equal(existsSync(join(dir, 'runs')), false);
  const twice = run(dir, startArgs('split-root', 'priced-big', ['--dry-run', '--dry-run'])); assert.equal(twice.status, 2); assert.match(twice.stderr, /--dry-run was given twice/);
  const normal = run(dir, ['--task', 'tasks/x.md', '--chain', 'priced-big', '--dry-run']); assert.equal(normal.status, 0, normal.stderr); assert.match(normal.stdout, /TOTAL/); assert.doesNotMatch(normal.stdout, /Tree cost/);
});

test('DR-8 `dry-run` is a SHARED flag, not a tree-only one: it is in neither derived list, so a normal run\'s --dry-run is never refused as tree-only', () => {
  assert.equal(TREE_ONLY_FLAGS.includes('dry-run'), false); assert.equal(TREE_VALUE_FLAGS.includes('dry-run'), false);
  const dir = work(); const r = run(dir, ['--task', 'tasks/x.md', '--chain', 'priced-big', '--dry-run']); assert.equal(r.status, 0, r.stderr);
});

test('DR-7 (E42): the upper estimate is explained once, after the rows (not a ceiling; the cap is what stops spending), and the sub-plan row says what the cheapest end is', () => {
  const dir = work();
  const r = run(dir, startArgs('split-root', 'priced-big', ['--dry-run', '--max-usd', '1000']));
  assert.equal(r.status, 0, r.stderr);
  const said = 'The upper estimate is the largest figure this projection reaches, not a ceiling: the cap you give (--max-usd) is what stops spending.';
  assert.equal(r.stdout.split(said).length - 1, 1, 'said once');
  assert.ok(r.stdout.indexOf(said) > r.stdout.indexOf('  whole tree  '), 'after the rows');
  assert.ok(line(r.stdout, 'sub-plan').includes("(per run, at the chain's assumed sizes; cheapest end: the least one run is projected to cost)"));
});

test('DR-8 (E42 fix-up): the upper-estimate explanation also prints when the sub-plan chain is unpriced (no whole-tree row, but the root row still shows the upper estimate), once, and not when no row is priced', () => {
  const row = (name, priced) => ({ name, priced, unpriced: [], expectedUsd: priced ? 1 : null, maximumUsd: priced ? 2 : null, cheapestUsd: priced ? 0.5 : null, externalStages: 0 });
  const said = 'The upper estimate is the largest figure this projection reaches, not a ceiling';
  const count = lines => lines.filter(l => l.includes(said)).length;
  assert.equal(count(projectionLines({ root: row('r', true), child: row('k', false), total: null, runs: 1, subPlans: 0, capNote: null })), 1, 'one priced row, no whole-tree row');
  assert.equal(count(projectionLines({ root: row('r', true), child: row('k', true), total: { expectedUsd: 3, maximumUsd: 6 }, runs: 3, subPlans: 2, capNote: null })), 1, 'both priced: once');
  assert.equal(count(projectionLines({ root: row('r', false), child: row('k', false), total: null, runs: 1, subPlans: 0, capNote: null })), 0, 'no row shows an upper estimate: nothing to explain');
});
