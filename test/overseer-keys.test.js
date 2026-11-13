// Round semantics 2a (gate page Review/Build_0.8.3/m6-closing/Round_Semantics_Gate_Page.md sections 9-10, C&C 15 Oct 2026): the keys maxOverseerRounds + layerRevisions, their lint, the derived limits every reader goes through
// (roundLimitsOf), the layer-aware estimate, the dry-run fields and the --rounds override. INERT: no shipped chain carries the keys yet; every row builds a TEST chain from plan-high-council with the keys added. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { projectTree } from '../src/tree-projection.js';
import { readChainFile } from './helpers/chain-file.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OR = await import('../src/overseer-rounds.js').catch(() => ({}));
const LY = await import('../src/layers.js').catch(() => ({}));
const COST = await import('../src/cost.js');
const DRY = await import('../src/dry-run.js');
const RL = await import('../src/roles.js');
const readChain = n => readChainFile(root, n);

// The test chain: plan-high-council with the overseer keys instead of a pass cap.
// The shipped chain carries the keys since 2b: every CHAIN-derived row reads its numbers FROM plan-high-council.json (Muad: the numbers live only there and will probably change; nothing here pins 7/5/3 or a dollar figure).
const { ladder: _shippedLadder, ...shippedBase } = readChain('plan-high-council');   // MOVED (commit 8): the shipped chain is a ladder chain now; these rows test the overseer-round mechanics, so they read an overseer variant of it with the numbers it had (7 rounds, layers 7 and 3)
const shipped = { ...shippedBase, maxOverseerRounds: 7, layerRevisions: { 1: 7, 2: 3 } };
const N = shipped.maxOverseerRounds; const B1 = shipped.layerRevisions[1]; const B2 = shipped.layerRevisions[2];
const CEIL = N * (B1 + B2 + 1) * (OR.UNHEARD_PASSES_BEFORE_STOP + OR.REASKS_NO_REVISE + 1);   // The factor 3 stays: the lone-heard pass of layer 1 keeps its two re-ask passes (10 Nov 2026); the round before had moved the factor to 1 and this one moves it back.
const overseerChain = (over = {}) => ({ ...structuredClone(shipped), ...over });
const kinds = c => LY.overseerKeyProblems(c, 'x.json');

test('K1: roundLimitsOf: a flat chain keeps maxRounds (default 2), a chain with the keys gets the DERIVED pass ceiling and its overseer rounds, malformed keys read as no overseer rounds', () => {
  assert.deepEqual(OR.roundLimitsOf({ maxRounds: 4 }), { passes: 4, overseer: null, layerRevisions: null });
  assert.deepEqual(OR.roundLimitsOf({}), { passes: 2, overseer: null, layerRevisions: null });
  assert.deepEqual(OR.roundLimitsOf(overseerChain()), { passes: CEIL, overseer: N, layerRevisions: { 1: B1, 2: B2 } });
  assert.deepEqual(OR.roundLimitsOf({ maxRounds: 3, maxOverseerRounds: 7, layerRevisions: { 1: 5 } }), { passes: 3, overseer: null, layerRevisions: null });
});

test('K2: --rounds N and a resume\'s saved value mean OVERSEER rounds on a chain that has them, maxRounds on any other; roundsSetting reads the same number back', () => {
  const o = overseerChain(); OR.setRounds(o, 4);
  assert.equal(o.maxOverseerRounds, 4); assert.equal('maxRounds' in o, false); assert.equal(OR.roundsSetting(o), 4);
  const f = { maxRounds: 3 }; OR.setRounds(f, 5);
  assert.equal(f.maxRounds, 5); assert.equal('maxOverseerRounds' in f, false); assert.equal(OR.roundsSetting(f), 5);
  assert.equal(OR.roundsSetting({}), undefined);
});

test('K3: lint: the test chain is clean; every misuse is refused with the key named; "maxRounds BESIDE maxOverseerRounds" is refused but a layered chain with only maxRounds is not (C&C wording)', () => {
  assert.deepEqual(kinds(overseerChain()), []);
  const msgs = c => kinds(c).map(p => p.message);
  assert.match(msgs((() => { const c = overseerChain(); delete c.layerRevisions; return c; })()).join('|'), /"maxOverseerRounds" is set without "layerRevisions"/);
  assert.match(msgs((() => { const c = overseerChain(); delete c.maxOverseerRounds; return c; })()).join('|'), /"layerRevisions" is set without "maxOverseerRounds"/);
  assert.match(msgs(overseerChain({ maxRounds: 9 })).join('|'), /"maxRounds" is set beside "maxOverseerRounds"/);
  assert.match(msgs(overseerChain({ maxOverseerRounds: 0 })).join('|'), /maxOverseerRounds must be a whole number/);
  assert.match(msgs(overseerChain({ layerRevisions: { 1: 5 } })).join('|'), /exactly the keys "1" and "2"/);
  assert.match(msgs(overseerChain({ layerRevisions: { 1: 5, 2: 0 } })).join('|'), /bounds must be whole numbers/);
  const two = overseerChain(); two.seats.critics = two.seats.critics.filter(s => s.layer !== 3);
  assert.match(msgs(two).join('|'), /not exactly three layers/);
  const flatNo = { maxOverseerRounds: 7, layerRevisions: { 1: 5, 2: 3 }, seats: { critics: [{ provider: 'mock', model: 'm', lab: 'a' }] } };
  assert.match(msgs(flatNo).join('|'), /not exactly three layers/);
});

test('K4 (PIN): every shipped chain WITHOUT the keys is untouched by the new rules, and none of their estimate rows carries a `times` field (the inert path)', () => {
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) {
    const c = readChain(f.replace(/\.json$/, ''));
    assert.deepEqual(kinds(c), [], f);
    if ('maxOverseerRounds' in c || 'ladder' in c) continue; // the shipped layered chain: its own rows are K5-K8; a ladder chain (every shipped planning chain since the ladder unit; CHANGED ACCEPTED (0.8.4 ladder unit, the solo ask; owed list 'Solo ask', 10 Nov 2026). OLD: only maxOverseerRounds) has no overseer-round keys and is priced by the ladder's own rows (test/ladder-preview.test.js)
    assert.equal(OR.roundLimitsOf(c).overseer, null, f);
    // CHANGED ACCEPTED (0.8.4, `layer_debate.enabled` removed; the pricing of the exchange widened). OLD: no estimate row of such a chain carries `times`. NEW: none does except the exchange rows (`ldebate-` / `lreply-`) of a layered unanimous chain with two judges on its lowest layer, which count the exchange's rounds (seven in the maximum). WHY: the exchange is part of every such chain, so mock-layered.json now prices it; every other row stays without `times`.
    // CHANGED ACCEPTED (0.8.4 unit 4, 4 Nov 2026; his picks OWNER 5 and 6; rebased onto the tip's exchange rows). OLD at the tip: no row but the exchange rows (`ldebate-` / `lreply-`) carries `times`. NEW: no row but the exchange rows and the repeat rows of the MAXIMUM (a judge's `...-reask` rows, two a pass, and the one `network-retries` row, three in a run) does. WHY: the upper estimate now includes those repeats; the inert path (the expected figure, and every other row) is unchanged.
    for (const maximum of [false, true]) assert.equal(COST.estimateChainRows(c, { maximum }).filter(r => !/^l(debate|reply)-/.test(r.label) && !(maximum && (/-reask$|-solo$/.test(r.label) || r.label === 'network-retries'))).some(r => 'times' in r), false, `${f} (maximum: ${maximum})`);
  }
});

// The expected per-ask rows come from the existing flat estimate of the same panel (derived, never typed): one pass of every critic.
const perAsk = (chain, maximum) => {
  const flat = structuredClone(chain); delete flat.maxOverseerRounds; delete flat.layerRevisions; flat.maxRounds = 2;
  const rows = COST.estimateChainRows(flat, { maximum }).filter(r => !(/-(reask|solo)$/.test(r.label) || r.label === 'network-retries'));   // 0.8.4 unit 4 (and the ladder unit: the solo ask's `-solo` rows are repeat rows too; FINDING, not on the owed list, 10 Nov 2026): the repeat rows of the maximum are not per-ask rows (test/dry-run-repeats.test.js covers them)
  const byLab = new Map(rows.filter(r => /^panel-1-/.test(r.label)).map(r => [r.label.replace(/^panel-1-/, ''), r.usd]));
  const revise = rows.find(r => r.label === 'revise-1').usd;
  // CHANGED ACCEPTED (0.8.4, the pricing of the exchange widened). OLD: `rest` = every row that is not a panel or revise row. NEW: the exchange rows are taken out of `rest` and returned as `exchange`: the flat chain prices the exchange once per pass (usd already multiplied by the exchange's rounds), so pass 1's rows are ONE ask of layer 1 with its whole exchange. WHY: the layer-aware estimate asks layer 1 times(1) times, and every ask runs the exchange.
  const rest = rows.filter(r => !/^panel-\d+-|^revise-\d+$|^l(debate|reply)-\d+-/.test(r.label)).reduce((n, r) => n + r.usd, 0);
  const exchange = rows.filter(r => /^l(debate|reply)-1-/.test(r.label)).reduce((n, r) => n + r.usd, 0);
  // CHANGED ACCEPTED (0.8.4 apply, 11 Nov 2026; C&C released the re-pin; K5 flipped at dc60423a, the 112 held names recorded). OLD: every flat `ldebate-1-*` / `lreply-1-*` row was a layer-1 row (14 rows, 7.229 a pass), so `exchange` times layer 1's count was the exchange term. NEW: the flat twin prices an exchange for the seats of EVERY layer (24 rows: layer 1 7.782, layer 2 12.964, layer 3 24.063 a pass), so the term is taken per layer of the seat the row names and multiplied by THAT layer's count (`exchangeByLayer`). WHY: the recorded words give layers 2 and 3 their one-round exchange; the layer-aware estimate prices them at their own counts (layer 2 b2+1 asks x n rounds, layer 3 n), and multiplying all flat exchange rows by layer 1's factor counted layers 2 and 3 too often. Per layer the layer-aware per-call cost equals the flat per-call cost (probe on the tip: haiku L1 0.32317, opus L2 2.57801, fable L3 5.13879 both) and the counts are 231 / 28 / 7 against 3 / 1 / 1 rounds (layer 1 stops its exchange after 3 rounds: the ladder unit eb2a1f43; layers 2 and 3 have one round: the short-exchange rule).
  const layerOf = new Map((chain.seats.critics || []).map(sx => [sx.lab, sx.layer]));
  const exchangeByLayer = { 1: 0, 2: 0, 3: 0 };
  for (const r of rows.filter(r => /^l(debate|reply)-1-/.test(r.label))) { const lab = r.label.replace(/^l(debate|reply)-1-/, '').replace(/-x[23]$/, ''); exchangeByLayer[layerOf.get(lab)] = (exchangeByLayer[layerOf.get(lab)] ?? 0) + r.usd; }
  return { byLab, revise, rest, exchange, exchangeByLayer };
};
const sum = rows => rows.reduce((n, r) => n + r.usd, 0);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('K5: the layer-aware estimate: EXPECTED = seven overseer rounds each ending after one climb; MAXIMUM = every allowed revision used in every round (layer 1 asked b1+b2+1 times, layer 2 b2+1, layer 3 once); both derived from the flat per-ask rows', () => {
  const c = overseerChain(); const n = N, b1 = B1, b2 = B2;
  const layerOfLab = new Map(c.seats.critics.map(s => [s.lab, s.layer]));
  for (const maximum of [false, true]) {
    const { byLab, revise, rest, exchangeByLayer } = perAsk(c, maximum);
    const times = layer => (maximum ? n * ({ 1: b1 + b2 + 1, 2: b2 + 1 }[layer] ?? 1) : n);
    assert.deepEqual(Object.keys(exchangeByLayer).sort(), ['1', '2', '3'], 'every flat exchange row names a seat of layer 1, 2 or 3 (no row of an unknown seat is counted at layer 1\'s factor)');
    let panel = 0; for (const [lab, usd] of byLab) panel += usd * times(layerOfLab.get(lab));
    const revises = maximum ? n * (b1 + b2) + (n - 1) : n - 1;
    // CHANGED ACCEPTED TEST (0.8.4 unit 4, 04 Nov 2026; his picks OWNER 5 and 6). OLD at the tip: the whole maximum is rest + panel + exchange * times(1) + revises. NEW: the same, without the repeat rows the maximum now adds (a judge's `...-reask` rows and the `network-retries` row; covered by test/dry-run-repeats.test.js). WHY: the upper estimate includes re-asks and network retries at their expected cost.
    // CHANGED ACCEPTED (0.8.4 apply, 11 Nov 2026, with the exchange term above). OLD: the filter dropped only the repeat rows. NEW: it also drops the maximum-only rows of the go-up rulings and of the proposer return (`rule-bound-`, `rule-go-up-`, `return-`), born at dc60423a (438.875 on this chain's maximum; none in the expected figure). WHY: they are not per-ask rows of the flat twin; their INPUT sizes, counts and times are pinned BY TERM in K5b below (the same file), and the SENT prompts are compared in the spy legs: GL-IN (test/stall-ratings.test.js, the rule- calls of UB-6's shape) and RET-IN (test/proposer-return.test.js, the return- calls); m1-layer1-cost GC-1 pins the rule-bound rows on all seven chains. As the repeat rows are covered by test/dry-run-repeats.test.js. (The earlier wording of this comment said the rows' money was carried by s7c-cost and m1-layer1-cost; it was not pinned there: corrected, group 7.)
    near(sum(COST.estimateChainRows(c, { maximum }).filter(r => !(/-reask$|-solo$/.test(r.label) || r.label === 'network-retries' || /^(rule-bound-|rule-go-up-|return-)/.test(r.label)))), rest + panel + Object.entries(exchangeByLayer).reduce((t, [L, usd]) => t + usd * times(Number(L)), 0) + revise * revises, maximum ? 'maximum' : 'expected');
  }
  const rows = COST.estimateChainRows(c, { maximum: true });
  const l1 = rows.find(r => r.label.startsWith('panel-L1-'));
  assert.equal(l1.times, N * (B1 + B2 + 1), 'a layer-1 seat is one row standing for its calls, usd already multiplied');
  assert.ok(rows.filter(r => /^panel-/.test(r.label)).every(r => /^panel-L[123]-/.test(r.label)), 'no flat panel-<pass> row');
});

// CHANGED ACCEPTED (0.8.4 apply, group 7, C&C RULING_STEP5_6 E; figures printed in job 98). K5's sum filters the maximum-only rows of the go-up rulings and the proposer return out of the flat twin's per-ask arithmetic; the filter stays ONLY with those rows pinned in the same commit: this row pins their INPUT sizes, counts and times BY TERM on the converted
// plan-high-council (n 7, b2 3, K1 = K2 = 5, K3 = 2, P 3, estimate 28000/10000/5000 as printed), and none of them is in the expected figure. The sent prompts are compared in the spy legs: the rule- calls on UB-6's shape (test/stall-ratings.test.js) and the return- calls in the proposer-return fixture (test/proposer-return.test.js, RET-IN).
test('K5b: the maximum-only rows by term: rule-bound (one per layer-2 seat, n x (b2 + 1)), rule-go-up (one per top-layer seat, n) and the proposer return (3P rows, n - 1); none in the expected figure', () => {
  const c = overseerChain(); const a = { ...COST.DEFAULT_ESTIMATE, ...(c.estimate || {}) };
  const K = layer => c.seats.critics.filter(s => s.layer === layer).length; const P = c.seats.proposers.length;
  const sys = text => COST.estimateTokens(text);   // the estimator's unit: ceil(length / 4)
  const mx = COST.estimateChainRows(c, { maximum: true }); const ex = COST.estimateChainRows(c, { maximum: false });
  const perCall = r => r.input / (r.times ?? 1);
  for (const family of ['rule-bound-', 'rule-go-up-', 'return-']) assert.equal(ex.filter(r => r.label.startsWith(family)).length, 0, `${family}: not in the expected figure`);
  const bound = mx.filter(r => r.label.startsWith('rule-bound-L2-'));
  assert.equal(bound.length, K(2), 'rule-bound: one row per layer-2 seat');
  for (const r of bound) { assert.equal(r.times, N * (B2 + 1), `${r.label}: times n x (b2 + 1)`); assert.equal(perCall(r), a.promptTokens + a.draftTokens + 400 * K(1) + sys(RL.escalationRulingSystem({ sendUp: true })), `${r.label}: prompt + draft + 400 x K1 + the send-up ruling system text`); }
  const goUp = mx.filter(r => r.label.startsWith('rule-go-up-L3-'));
  assert.equal(goUp.length, K(3), 'rule-go-up: one row per top-layer seat');
  for (const r of goUp) { assert.equal(r.times, N, `${r.label}: times n`); assert.equal(perCall(r), a.promptTokens + a.draftTokens + 400 * K(2) + sys(RL.goUpRulingSystem()), `${r.label}: prompt + draft + 400 x K2 + the go-up ruling system text`); }
  // the proposer return: 3P rows, each n - 1 times; the system term is the return's one system line; the caps are the proposers' own (maxTokens or the seat default)
  const capOf = seat => seat.maxTokens ?? COST.SEAT_DEFAULT_MAX_TOKENS; const line = sys(RL.proposerReturnSystem());
  const ret = mx.filter(r => r.label.startsWith('return-'));
  assert.equal(ret.length, 3 * P, 'return: 3P rows');
  for (const seat of c.seats.proposers) {
    const others = c.seats.proposers.filter(o => o !== seat).reduce((t, o) => t + capOf(o), 0); const row = kind => ret.find(r => r.label === `return-${kind}-${seat.lab}`);
    assert.equal(row('alt').times, N - 1); assert.equal(row('post').times, N - 1); assert.equal(row('answer').times, N - 1);
    assert.equal(perCall(row('alt')), a.promptTokens + a.draftTokens + 1000 + (c.proposals ? COST.TYPICAL_OUTPUT_TOKENS.skeleton : 0) + line, `${seat.lab}: return-alt = prompt + draft + 1000 (entry and objection) + the skeleton's typical size + the system line`);
    assert.equal(perCall(row('post')), a.promptTokens + 1000 + others + line, `${seat.lab}: return-post = prompt + 1000 + the other proposers' caps + the system line`);
    assert.equal(perCall(row('answer')), a.promptTokens + 1000 + capOf(seat) + others + line, `${seat.lab}: return-answer = prompt + 1000 + its own cap + the others' caps + the system line`);
  }
});

test('K6: the dry run: maxRounds is null and maxOverseerRounds + passCeiling are reported for the test chain; a flat chain\'s report is unchanged (no new key); the floor is ONE climb with no revise', () => {
  const r = DRY.dryRunReport(overseerChain());
  assert.equal(r.maxRounds, null); assert.equal(r.maxOverseerRounds, N); assert.equal(r.passCeiling, CEIL);
  const flat = DRY.dryRunReport(readChain('plan-daily-7'));
  assert.equal('maxOverseerRounds' in flat, false); assert.equal('passCeiling' in flat, false);
  const one = overseerChain({ maxOverseerRounds: 1 });
  near(r.estimate.floorUsd, sum(COST.estimateChainRows(one)), 'floor = the 1-round estimate');
  assert.equal(COST.estimateChainRows(one).some(x => x.label === 'revise-all'), false, 'one overseer round has no revise');
});

test('K7: the schema accepts the keys and refuses a layerRevisions without layer 2', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
  assert.equal(validate(overseerChain()), true, JSON.stringify(validate.errors));
  assert.equal(validate(overseerChain({ layerRevisions: { 1: 5 } })), false);
});

test('K8: the CLI dry run of a chain with the keys says "Overseer rounds: N", names the plain-run shape in the Expected line and the bound-exhausted shape and its exclusions in the Maximum line, shows repeat counts, and counts repeats in "N of M stages"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ovk-'));
  try {
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'chains', 'ovk.json'), JSON.stringify({ ...overseerChain(), name: 'ovk' }));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'ovk', '--task', 'tasks/t.md', '--dry-run'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Overseer rounds: ${N} \\(a round ends when the top layer gives a verdict;.*at most ${CEIL} passes, a ceiling, not a plan\\)`));
    assert.match(r.stdout, new RegExp(`Expected: .*${N} overseer rounds each ending after ONE climb`));
    assert.match(r.stdout, new RegExp(`layer 1 up to ${B1}, layer 2 up to ${B2} per round.*in-pass re-asks \\(up to 2 per seat\\).*The limit you type is the only ceiling`));
    // 0.8.4 S11 (S11-w5): the sentence moves with the code that has priced the in-pass re-asks since unit 4; the whole-sentence pin above keeps its words in their order
    assert.match(r.stdout, /it counts the in-pass re-asks \(up to 2 per seat\) at the review's expected cost, but not up to 2 consecutive passes that re-ask a silent seat/);
    assert.doesNotMatch(r.stdout, /does not count the in-pass re-asks/);
    assert.match(r.stdout, new RegExp(`panel-L1-\\S+ x${N}\\b`));
    const total = COST.estimateChainRows(overseerChain()).reduce((n, x) => n + (x.times ?? 1), 0);
    const ext = COST.estimateChainRows(overseerChain()).filter(x => x.seat.startsWith('external/')).reduce((n, x) => n + (x.times ?? 1), 0);
    assert.ok(r.stdout.includes(`${ext} of ${total} stages are answered by external seats`), `${ext} of ${total}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('K10: the tree projection counts REPEATS: stages and externalStages sum `times` (the number of calls the rows stand for), not the number of rows', () => {
  const c = overseerChain(); const rows = COST.estimateChainRows(c);
  const p = projectTree({ root: { name: 'ovk', config: c }, child: { name: 'ovk', config: c } });
  assert.equal(p.root.stages, rows.reduce((n, r) => n + (r.times ?? 1), 0));
  assert.equal(p.root.externalStages, rows.filter(r => r.seat.startsWith('external/')).reduce((n, r) => n + (r.times ?? 1), 0));
  assert.ok(p.root.stages > rows.length, 'repeats were counted');
});

test('K11: the --json dry run carries the repeat counts (times, maximumTimes) on the layer rows and maxOverseerRounds / passCeiling on the report; a flat chain\'s rows have neither', () => {
  const r = DRY.dryRunReport(overseerChain());
  const l1 = r.rows.find(x => x.label.startsWith('panel-L1-'));
  assert.equal(l1.times, N); assert.equal(l1.maximumTimes, N * (B1 + B2 + 1));
  assert.ok(r.rows.filter(x => x.label.startsWith('panel-L')).every(x => x.times === N && x.maximumTimes >= N));
  const flat = DRY.dryRunReport(readChain('plan-daily-7'));
  assert.equal(flat.rows.some(x => 'times' in x || 'maximumTimes' in x), false);
});

