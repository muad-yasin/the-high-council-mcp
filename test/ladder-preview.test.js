// 0.8.4 (the ladder unit, commit 7; Muad 10 Nov 2026: "7 reads upper figure, 3 expected. I think this is OK to have for today, we can update once we have more runs"): the price preview of a LADDER chain, in top-layer READS (the read that signs off counts),
// one number for every ladder chain. UPPER: 7 reads, each climb with the full ladder below it (block 3: 12 layer-1 passes, 3 layer-2 visits), labelled an assumption; a number typed with --rounds replaces it. EXPECTED: 3 reads at the measured climb (8 layer-1 passes, 1 layer-2 pass).
// Offline, pure (no call is made). WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dryRunReport } from '../src/dry-run.js';
import { estimateChainRows, previewOfLadder, ladderExpectedWords, ladderUpperWords, PREVIEW_READS_UPPER, PREVIEW_READS_EXPECTED, PREVIEW_EXPECTED_CLIMB } from '../src/cost.js';
import { roundLimitsOf } from '../src/overseer-rounds.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seat = (lab, layer, extra = {}) => ({ provider: 'mock', model: 'mock-priced', lab, layer, maxTokens: 3000, ...extra });
const chain = (critics, extra = {}) => ({ name: 'ladder-preview-test', signoff: 'unanimous', ladder: { block: 3, visits: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra });
const SMALL = [seat('la', 1), seat('lb', 1), seat('lc', 2), seat('ld', 3)];
const timesOf = (rows, label) => rows.find(r => r.label === label)?.times ?? null;

test('LP-1 (the two figures in reads): the upper figure counts 7 top-layer reads, each with the full ladder below it (12 layer-1 passes, 3 layer-2 visits); the expected figure 3 reads at the measured climb (8 layer-1 passes, 1 layer-2 pass); layer 3 is asked once per read', () => {
  assert.deepEqual([PREVIEW_READS_UPPER, PREVIEW_READS_EXPECTED, { ...PREVIEW_EXPECTED_CLIMB }], [7, 3, { 1: 8, 2: 1 }]);
  const cfg = chain(SMALL);
  const up = estimateChainRows(cfg, { maximum: true }); const ex = estimateChainRows(cfg, { maximum: false });
  assert.deepEqual([timesOf(up, 'panel-L1-la'), timesOf(up, 'panel-L2-lc'), timesOf(up, 'panel-L3-ld')], [7 * 12, 7 * 3, 7]);
  assert.deepEqual([timesOf(ex, 'panel-L1-la'), timesOf(ex, 'panel-L2-lc'), timesOf(ex, 'panel-L3-ld')], [3 * 8, 3 * 1, 3]);
});

test('LP-2 (a typed number replaces the upper figure\'s assumption): --rounds N on a ladder chain is the person\'s own bound on top-layer reads (maxRounds): the upper figure uses it, the expected figure never exceeds it', () => {
  const typed = n => chain(SMALL, { maxRounds: n });
  assert.deepEqual([previewOfLadder(roundLimitsOf(typed(4)), true).reads, previewOfLadder(roundLimitsOf(typed(4)), true).assumed], [4, false]);
  assert.deepEqual([previewOfLadder(roundLimitsOf(chain(SMALL)), true).reads, previewOfLadder(roundLimitsOf(chain(SMALL)), true).assumed], [7, true]);
  assert.equal(previewOfLadder(roundLimitsOf(typed(2)), false).reads, 2, 'the expected figure never exceeds the typed bound');
  assert.equal(previewOfLadder(roundLimitsOf(typed(9)), false).reads, 3);
  assert.equal(timesOf(estimateChainRows(typed(4), { maximum: true }), 'panel-L3-ld'), 4);
});

test('LP-3 (ONE number for every ladder chain): a small and a large panel are priced on the same number of reads; a chain that is not a ladder chain has no ladder preview', () => {
  const LARGE = [seat('la', 1), seat('lb', 1), seat('lc', 1), seat('ld', 2), seat('le', 2), seat('lf', 2), seat('lg', 3), seat('lh', 3)];
  for (const c of [chain(SMALL), chain(LARGE)]) assert.equal(timesOf(estimateChainRows(c, { maximum: true }), `panel-L3-${c.seats.critics.at(-1).lab}`), 7);
  assert.equal(previewOfLadder(roundLimitsOf({ ...chain(SMALL), ladder: undefined, maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 } }), true), null);
});

test('LP-4 (the labels count READS and say the upper figure is an assumption): the sentences name the top-layer reads, the read that signs off included, and the upper one says it is an assumption that a typed number replaces; with a typed number it says so', () => {
  const lim = roundLimitsOf(chain(SMALL));
  assert.match(ladderExpectedWords(lim), /3 top-layer reads \(the read that signs off counts\), each after a climb of about 8 layer-1 passes and 1 layer-2 pass/);
  assert.match(ladderUpperWords(lim), /7 top-layer reads \(an assumption, not a limit: a number you type with --rounds replaces it\), each with the full ladder below it \(layer 1 in blocks of 3, 3 layer-2 visits\)/);
  assert.match(ladderUpperWords(roundLimitsOf(chain(SMALL, { maxRounds: 4 }))), /4 top-layer reads \(the number you typed with --rounds\)/);
  assert.equal(ladderUpperWords(roundLimitsOf({ ...chain(SMALL), ladder: undefined, maxRounds: 2 })), '');
});

test('LP-5 (a KEYED chain, the direct Anthropic seats): a ladder chain whose seats are direct Anthropic seats is priced on the same reads, every row has a finite price, and the upper figure is above the expected one; the panel rows of a keyed seat carry the cache write/read marks the way the overseer chains do (no ladder-specific price)', () => {
  const keyed = [seat('ka', 1, { provider: 'anthropic', model: 'claude-haiku-5-5' }), seat('kb', 1, { provider: 'anthropic', model: 'claude-haiku-5-5' }), seat('kc', 2, { provider: 'anthropic', model: 'claude-sonnet-5-5' }), seat('kd', 3, { provider: 'anthropic', model: 'claude-opus-5-5' })];
  const cfg = chain(keyed);
  const up = estimateChainRows(cfg, { maximum: true }); const ex = estimateChainRows(cfg, { maximum: false });
  assert.equal(timesOf(up, 'panel-L3-kd'), 7);
  const total = rows => rows.reduce((n, r) => n + (Number.isFinite(r.usd) ? r.usd : NaN), 0);
  assert.ok(Number.isFinite(total(up)) && Number.isFinite(total(ex)), 'every row is priced');
  assert.ok(total(up) > total(ex), 'the upper figure is above the expected one');
});

test('LP-6 (SOURCE PINS): the dry run prints the ladder sentences and carries the basis in its JSON; the shipped overseer chains keep their own sentence', () => {
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8'); const dry = readFileSync(join(root, 'src', 'dry-run.js'), 'utf8');
  // CHANGED ACCEPTED (0.8.4, the --rounds fix-up; C&C ruling 11 Nov 2026): OLD: ladderExpectedWords(roundLimitsOf(config)) and ladderUpperWords(roundLimitsOf(config)) with the chain's limits alone. NEW: both also take the number the run is bound by, ladderTypedReads(), a typed --rounds N (or a resumed run's saved one),
  // which the dry run's two sentences print; with none typed the two words are the same as before (LP-4). WHY: a typed N on a ladder run reached no figure (probe on the box, 11 Nov 2026: --rounds 4 and --rounds 9 printed the same dry run as no --rounds); the pin keeps that the two sentences are fed the number.
  assert.match(cli, /roundLimitsOf\(config\)\.ladder \? ladderExpectedWords\(roundLimitsOf\(config\), ladderTypedReads\(\)\)/);
  assert.match(cli, /ladderUpperWords\(roundLimitsOf\(config\), ladderTypedReads\(\)\)/);
  assert.match(dry, /previewReads: \{ expected: previewOfLadder/);
  assert.match(cli, /seven overseer rounds each ending after ONE climb/);
});

test('LP-7 (the expected figure never counts more passes per read than the chain\'s ladder allows, and is never above the upper figure): the smallest accepted ladder (block 1, visits 1: the upper climb is 2 layer-1 passes and 1 layer-2 visit) has an expected climb of at most that, and the expected total is not above the upper total, with or without a typed number', () => {
  for (const extra of [{}, { maxRounds: 2 }, { maxRounds: 1 }]) {
    const cfg = chain(SMALL, { ladder: { block: 1, visits: 1 }, ...extra });
    const lim = roundLimitsOf(cfg); const e = previewOfLadder(lim, false); const u = previewOfLadder(lim, true);
    assert.ok(e.climb[1] <= u.climb[1] && e.climb[2] <= u.climb[2] && e.reads <= u.reads, JSON.stringify({ e, u }));
    const total = rows => rows.reduce((n, r) => n + r.usd, 0);
    assert.ok(total(estimateChainRows(cfg, { maximum: false })) <= total(estimateChainRows(cfg, { maximum: true })), `expected above upper: ${JSON.stringify(extra)}`);
  }
  assert.deepEqual(previewOfLadder(roundLimitsOf(chain(SMALL, { ladder: { block: 1, visits: 1 } })), false).climb, { 1: 2, 2: 1 });
  assert.deepEqual(previewOfLadder(roundLimitsOf(chain(SMALL)), false).climb, { 1: 8, 2: 1 }, 'the shipped 3/3 ladder does not move');
});

test('LP-8 (LADDER_GO line 35, "cap screen = dry run"): the figures the limit screen prints (src/cli.js sums estimateChainRows, expected and maximum) are the dry run\'s: dryRunReport\'s expectedUsd and maximumUsd equal those sums for a ladder chain, and the cli computes the screen from the same function', () => {
  const cfg = chain(SMALL);
  const sum = rows => rows.reduce((n, r) => n + r.usd, 0);
  const rep = dryRunReport(cfg);
  assert.equal(rep.estimate.expectedUsd.toFixed(6), sum(estimateChainRows(cfg)).toFixed(6));
  assert.equal(rep.estimate.maximumUsd.toFixed(6), sum(estimateChainRows(cfg, { maximum: true })).toFixed(6));
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  // CHANGED ACCEPTED (0.8.4, the --rounds fix-up; C&C ruling 11 Nov 2026): OLD: the screen's two sums called estimateChainRows(config, { fromRun, accounts: !!capName }) and the same with maximum: true. NEW: both also pass `typedReads`, the number of top-layer reads the run is bound by (null when none is typed, which is the same call as before). WHY: the limit screen of a run typed with --rounds N must price N reads, as the dry run does.
  assert.match(cli, /const expected = oneCall \? oneCall\.usd : estimateChainRows\(config, \{ fromRun, accounts: !!capName, typedReads \}\)/);
  assert.match(cli, /const most = oneCall \? oneCall\.usd : estimateChainRows\(config, \{ fromRun, maximum: true, accounts: !!capName, typedReads \}\)/);
});
