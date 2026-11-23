// 0.8.4 twin cost rows (test-only; Builder B): with caching on, each row of a same-layer twin costs EXACTLY what its sibling's row costs.
// WHY: the cache-marks sweep asserts every twin seat against ITS OWN switch-off rows ("on is at or below off", "on minus off is the lead-in"), and test/plan-claude-council.test.js PCC-6 pins "-2 costs what its sibling costs" with
// caching OFF. Neither says it with the cache ON: a twin priced as READING its sibling's entry (a cache group keyed by the lab instead of the seat) would be priced LOWER, which "on <= off" cannot see for a marked seat.
// THE CHAIN is synthetic and built so the twins have NOTHING that differs: two identical seats on layer 1 (lab tw1) and two on layer 2 (lab tw2), no persona, one seat on layer 3. The comparison is the dry run's own rows
// (Cost.estimateChainRows), label for label with the seat segment's "-2" removed (src/cost.js nameOf; the stripper is anchored on the lab and keeps a round suffix: ldebate-L1-tw1-2-x2 is paired with ldebate-L1-tw1-x2),
// in every held state (the order's batch alone, the batch with the shortened exchange, not recorded), both lifetimes and both figures. The fields compared are PCC-6's (input, output, usd, times) plus the seat and priced.
// COVERAGE: a row whose label names a twin must be compared or sit on the named exclusion list (the rows keyed by the seat KEY, not the lab: dispute-review-, and the lab-keyed ambiguity- / preflight- rows that are not enabled here);
// an unknown shape FAILS, so a new twin row cannot go unasserted the way the sweep's twin rows once did. Rows from the rule-bound / rule-go-up stages are compared like the others.
// A per-pass label (panel-<r>-tw1-2, the shape of a chain without overseer rounds) is not in TWIN or BARE, so it FAILS as an unknown shape: right for this chain, whose critics are layered and labelled by layer (a chain labelled by pass needs its own patterns).
// This chain enables no dispute stage, ambiguity union or preflight, so NO row may be on the exclusion list: test 1 asserts the count is 0 in every combination, so the list can never hide a twin row.
// LIMIT: it compares identical twins. The shipped chain's twins differ by persona; whether that moves a row is PCC-6's question (with caching off) and is not asserted here with caching on.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Cost from '../src/cost.js';
import * as Held from '../src/held-roles.js';
import * as HC from './held-prompts/held-084-cache-order.js';
import * as HB from './held-prompts/held-084-b.js';
import * as HD from './held-prompts/held-084-d27.js';

const Gate = await import('../src/cache-order-gate.js').catch(() => ({}));
afterEach(() => Held.setHeldForTest(null));

const LIVE = { ...HC };
const UNRECORDED = Object.fromEntries(Object.keys(HC).map(n => [n, undefined]));
const PAIR = { shortExchangeRule: HB.shortExchangeRule, signoffLineRule: HB.signoffLineRule };
const D27 = { draftStartLine: HD.draftStartLine, draftBoundarySentence: HD.draftBoundarySentence };
const STATES = { recorded: LIVE, release: { ...LIVE, ...PAIR, ...D27 }, unrecorded: UNRECORDED };

const KINDS = '(?:panel|ldebate|lreply|final-read|rule-bound|rule-go-up)';
const TWIN = new RegExp(`^(${KINDS}-(?:end-)?L\\d+-tw\\d)-2((?:-reask\\d*|-solo|-x\\d+)?)$`);      // the seat segment's "-2", then an optional round, re-ask or solo suffix (0.8.4 ladder unit: `-solo`, the solo ask's row, is a repeat like `-reask`)
const BARE = new RegExp(`^(${KINDS}-(?:end-)?L\\d+-tw\\d)((?:-reask\\d*|-solo|-x\\d+)?)$`);
const EXCLUDED = /^(dispute-review|ambiguity|preflight)-/;      // keyed by the seat KEY (tw1-l1-2) or by the bare lab, so not paired by "-2": named, counted, not compared
const FIELDS = ['seat', 'input', 'output', 'usd', 'times', 'priced'];
const valueOf = (r, f) => (f === 'times' ? r.times ?? 1 : r[f]);

/** -> { problems: string[], pairs: number, excluded: number }: every twin row against its sibling, both ways, and no unknown twin shape. */
function unequalTwinRows(rows) {
  const byLabel = new Map(rows.map(r => [r.label, r]));
  const problems = []; let pairs = 0, excluded = 0;
  for (const r of rows) {
    if (!/tw\d/.test(r.label)) continue;
    if (EXCLUDED.test(r.label)) { excluded++; continue; }
    const twin = TWIN.exec(r.label), bare = BARE.exec(r.label);
    if (twin) {
      const sibling = byLabel.get(twin[1] + twin[2]);
      if (!sibling) { problems.push(`${r.label}: its sibling row ${twin[1] + twin[2]} does not exist`); continue; }
      pairs++;
      for (const f of FIELDS) if (valueOf(r, f) !== valueOf(sibling, f)) problems.push(`${r.label}: ${f} is ${valueOf(r, f)} but ${sibling.label} has ${valueOf(sibling, f)}`);
    } else if (bare) {
      if (!byLabel.has(`${bare[1]}-2${bare[2]}`)) problems.push(`${r.label}: its twin row ${bare[1]}-2${bare[2]} does not exist`);
    } else problems.push(`${r.label}: a row that names a twin has a shape this test does not know (compare it or put it on the exclusion list)`);
  }
  return { problems, pairs, excluded };
}

const seat = (lab, layer) => ({ provider: 'anthropic', model: 'claude-sonnet-5', lab, layer, maxTokens: 2000 });
const configOf = ttl => ({
  name: 'twin-cost', signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 20000, draftTokens: 30000, critiqueTokens: 2000 }, prompt_cache: { enabled: true, ttl },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [seat('tw1', 1), seat('tw1', 1), seat('tw2', 2), seat('tw2', 2), seat('top', 3)] },
});

test('TWIN COST ROWS: with caching on, every "-2" row of a same-layer twin costs exactly what its sibling row costs, in every held state, both lifetimes and both figures', () => {
  const problems = []; let pairs = 0, excluded = 0, combos = 0;
  for (const [state, held] of Object.entries(STATES)) for (const ttl of ['5m', '1h']) for (const maximum of [false, true]) {
    Held.setHeldForTest({ ...held });
    const config = configOf(ttl), here = `${state} ${ttl} ${maximum ? 'maximum' : 'expected'}`;
    // the cache is in play for the first twin pair: marked where the order is live, not marked where it is not (read from the gate, not from the rows)
    const marked = Gate.markTtlOf(config, config.seats.critics[1]);
    if (marked !== (state === 'unrecorded' ? null : ttl)) problems.push(`${here}: the layer-1 twin's mark is ${marked}`);
    const rows = Cost.estimateChainRows(config, { maximum });
    const got = unequalTwinRows(rows);
    pairs += got.pairs; excluded += got.excluded; combos++;
    if (got.excluded !== 0) problems.push(`${here}: ${got.excluded} twin row(s) sit on the exclusion list (this chain enables none of the stages that write them)`);
    for (const lab of ['tw1', 'tw2']) if (!rows.some(r => TWIN.test(r.label) && r.label.includes(`-${lab}-2`))) problems.push(`${here}: no "-2" row of ${lab} was found (counted from the rows)`);
    if (got.pairs === 0) problems.push(`${here}: no pair was compared`);
    problems.push(...got.problems.map(p => `${here}: ${p}`));
  }
  console.log(`TWIN pairs compared: ${pairs} over ${combos} combinations (twin rows on the exclusion list, not paired: ${excluded})`);
  assert.deepEqual(problems, []);
});

test('TWIN COST ROWS, the comparison itself: a wrong field, a missing sibling, an unpaired row and an unknown shape are each reported, and the stripper keeps a round suffix', () => {
  const row = (label, over = {}) => ({ label, seat: 'anthropic/claude-sonnet-5', input: 100, output: 10, usd: 1, priced: true, ...over });
  const ok = [row('panel-L1-tw1'), row('panel-L1-tw1-2'), row('ldebate-L1-tw1-x2', { times: 2 }), row('ldebate-L1-tw1-2-x2', { times: 2 }), row('dispute-review-tw1-l1-2')];
  assert.deepEqual(unequalTwinRows(ok), { problems: [], pairs: 2, excluded: 1 });
  const wrongUsd = unequalTwinRows([row('panel-L1-tw1'), row('panel-L1-tw1-2', { usd: 0.4 })]);
  assert.equal(wrongUsd.problems.length, 1); assert.match(wrongUsd.problems[0], /panel-L1-tw1-2: usd is 0\.4 but panel-L1-tw1 has 1/);
  const wrongSuffixPair = unequalTwinRows([row('ldebate-L1-tw1-x2'), row('ldebate-L1-tw1-2-x2', { input: 99 })]);
  assert.match(wrongSuffixPair.problems.join('|'), /ldebate-L1-tw1-2-x2: input is 99 but ldebate-L1-tw1-x2 has 100/);
  assert.match(unequalTwinRows([row('ldebate-L1-tw1-2-x2')]).problems[0], /its sibling row ldebate-L1-tw1-x2 does not exist/);      // "-2" removed, "-x2" kept
  assert.match(unequalTwinRows([row('panel-L1-tw1')]).problems[0], /its twin row panel-L1-tw1-2 does not exist/);
  assert.match(unequalTwinRows([row('panel-L1-tw1-3')]).problems[0], /a shape this test does not know/);
  assert.match(unequalTwinRows([row('panel-3-tw1-2')]).problems[0], /a shape this test does not know/);      // a per-pass label is not a layered chain's shape: it fails loudly, it is not skipped
  // the stripper's hard cases: a lab that ENDS in the ordinal (tw2) with a round suffix equal to it (-x2): the seat segment's "-2" goes, nothing else
  assert.deepEqual(unequalTwinRows([row('ldebate-L2-tw2-x2', { times: 2 }), row('ldebate-L2-tw2-2-x2', { times: 2 })]), { problems: [], pairs: 1, excluded: 0 });
  const hardUnequal = unequalTwinRows([row('ldebate-L2-tw2-x2'), row('ldebate-L2-tw2-2-x2', { output: 11 })]);
  assert.deepEqual(hardUnequal.problems, ['ldebate-L2-tw2-2-x2: output is 11 but ldebate-L2-tw2-x2 has 10']);
  assert.deepEqual(unequalTwinRows([row('ldebate-L2-tw2-2-x2')]).problems, ['ldebate-L2-tw2-2-x2: its sibling row ldebate-L2-tw2-x2 does not exist']);      // not ...tw-x2, not ...tw2-2
  assert.deepEqual(unequalTwinRows([row('ldebate-L2-tw2-x2')]).problems, ['ldebate-L2-tw2-x2: its twin row ldebate-L2-tw2-2-x2 does not exist']);
  assert.deepEqual(unequalTwinRows([row('panel-L2-tw2'), row('panel-L2-tw2-2'), row('panel-L2-tw2-reask'), row('panel-L2-tw2-2-reask')]), { problems: [], pairs: 2, excluded: 0 });
  assert.match(unequalTwinRows([row('panel-L2-tw2-2-2')]).problems[0], /a shape this test does not know/);
});
