// 0.8.4 S4b (M1), C&C's item 4: the MAXIMUM rows of the ENDING exchange (MONEY). They are the rows of the ordinary exchange (one helper, src/cost.js pushExchangeRows), so a direct Anthropic layer-1 seat with prompt caching on carries the write
// premium of the marked rounds 2..R, and the last round's text (W26 and its reply half) is priced. Offline, no run, $0. WRITTEN WITHOUT A RUN (overnight, no box).
// The config is the one of test/prompt-cache-money.test.js (the dry-run row there): four direct Anthropic judges, layers 1 to 3, two judges at layer 1.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { estimateChainRows } from '../src/cost.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';
import { readdirSync, readFileSync } from 'node:fs';
import { resolveChainSeats } from '../src/chain.js';
import { exchangeJudgeCount } from '../src/layer-debate.js';
import * as HC084 from './held-prompts/held-084-c.js';
const EP = await import('../src/ending-exchange-prompts.js').catch(() => ({}));   // guarded: on a tree without the module the row below fails by TypeError and the file still loads

afterEach(() => setHeldForTest(null));
const W26 = { lateFindingRule: HB084.lateFindingRule, lastRoundReplyRule: HB084.lastRoundReplyRule };
const seat = (lab, layer) => ({ provider: 'anthropic', model: 'claude-sonnet-5', lab, layer, maxTokens: 2000 });
const config = { name: 'dry', signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 20000, draftTokens: 30000, critiqueTokens: 2000 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [seat('a', 1), seat('b', 1), seat('c', 2), seat('d', 3)] } };
const on = { ...config, prompt_cache: { enabled: true } };
const rowsOf = (cfg, held, maximum = true) => { setHeldForTest(held); return estimateChainRows(cfg, { maximum }); };
const named = (rows, label) => rows.find(r => r.label === label);
const perCall = r => r.usd / (r.times ?? 1);
const tokensPerCall = r => r.input / (r.times ?? 1);

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'HELD: with W26 not recorded the maximum has no ending row, and a recorded W26 changes no other row'; the last row asserted `W26 held: no ending row` for every shipped layered chain. NEW: the held halves are removed (K7: after the recording no shipped run is held; SIBLINGS: the three 'C&C item 4' rows and the shipped-chain row assert the ending rows as recorded); what stays is the expected figure carrying no ending row. WHY: lateFindingRule (W26) is recorded; endingExchangeOn() is true (src/ending-exchange-prompts.js:10).
test('the expected figure carries no ending row: it runs only at a finish or the round cap', () => {
  assert.deepEqual(rowsOf(on, { ...DEMAND, ...W26 }, false).filter(r => r.label.includes('-end-')), [], 'the expected figure carries no ending row: it runs only at a finish or the round cap');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, the order is live; C&C's ruling of 11 Nov 2026 for this file: a shape change, the pin moves to the order-live shape). OLD (cache part a, commit 7): round 1 unmarked, round 2 its own row at the write price (`-x2`), rounds 3..7 a row of five calls at the read price (`-x3`): ruling B's rows. NEW: with the order live ruling B's rows do not exist (src/cost.js pushExchangeRows: its marks are not sent). A direct Anthropic layer-1 seat that the order marks has, in the ENDING exchange (no panel before it, so its first post writes the group's entry): `ldebate-end-L1-<lab>` one call at the write price, `ldebate-end-L1-<lab>-x2` the other six calls at the read price, and `lreply-end-L1-<lab>` all seven answers at the read price; no `-x3` row. The ordinary exchange rows are one row per kind on every pass, all at the read price (the panel before them wrote the entry). WHY: the box probe of job 18 printed the rows (ldebate-end 1 call, -x2 6 calls, lreply-end 7 calls, ordinary 9 calls) for this config; the money direction is unchanged: the reading calls are asserted at or below the uncached call here, and the cached total at or below the uncached total in the cache-off row below.
test('C&C item 4: the ending exchange has the order-live rows: the first post writes (one call), the other six posts and all seven answers read; no ruling-B rows; every reading call is at or below the uncached call', () => {
  const rows = rowsOf(on, { ...DEMAND, ...W26 }), off = rowsOf(config, { ...DEMAND, ...W26 });
  for (const lab of ['a', 'b']) {
    const first = named(rows, `ldebate-end-L1-${lab}`), rest = named(rows, `ldebate-end-L1-${lab}-x2`), answers = named(rows, `lreply-end-L1-${lab}`);
    assert.ok(first && rest && answers, `ldebate-end-L1-${lab}: the first post (writes), the other posts (read) and the answers (read)`);
    assert.deepEqual([first.times, rest.times, answers.times], [undefined, 6, 7], `${lab}: one writing post, six reading posts, seven reading answers`);
    const ordinaryPost = named(rows, `ldebate-L1-${lab}`), ordinaryAnswer = named(rows, `lreply-L1-${lab}`);
    assert.ok(ordinaryPost && ordinaryAnswer, 'the ordinary exchange rows exist beside it');
    assert.ok(perCall(first) > perCall(ordinaryPost), `${lab}: the writing post of the ending exchange costs more per call than an ordinary reading post`);
    assert.ok(perCall(rest) >= perCall(ordinaryPost) - 1e-12, `${lab}: a reading post of the ending exchange is priced at least as the ordinary one (the last round only adds text)`);
    assert.ok(perCall(answers) >= perCall(ordinaryAnswer), `${lab}: a reading answer of the ending exchange is priced at least as the ordinary one`);
    assert.ok(perCall(rest) <= perCall(named(off, `ldebate-end-L1-${lab}`)) && perCall(answers) <= perCall(named(off, `lreply-end-L1-${lab}`)), `${lab}: no reading call of the cached ending exchange costs more than the uncached one (the writing call carries the write premium by design; the total is asserted in the cache-off row below)`);
  }
  assert.equal(rows.some(r => /^(ldebate|lreply)-(end-)?L1-.*-x3$/.test(r.label)), false, 'ruling B\'s read row (-x3) does not exist with the order live');
});

test('C&C item 4: with the cache OFF the ending rows are one row of seven calls, and the cached maximum is at or below it (one write, then reads)', () => {
  const held = { ...DEMAND, ...W26 };
  const off = rowsOf(config, held); const marked = rowsOf(on, held);
  const sumEnd = rows => rows.filter(r => r.label.includes('-end-')).reduce((t, r) => t + r.usd, 0);
  const plain = named(off, 'ldebate-end-L1-a');
  assert.equal(plain?.times, 7, 'cache off: one row for every round');
  assert.equal(named(off, 'ldebate-end-L1-a-x2'), undefined);
  assert.ok(sumEnd(marked) <= sumEnd(off) + 1e-9, 'the maximum with the cache on is at or below the maximum with it off: one write, then reads');
});

test('C&C item 4: the last round is priced: an ending answer call carries the tokens of W26\'s reply half that the label\'s recorded system text does not', () => {
  const held = { ...DEMAND, ...W26 };
  const rows = rowsOf(config, held);
  const ending = named(rows, 'lreply-end-L1-a'); const ordinary = named(rows, 'lreply-L1-a');
  assert.ok(ending && ordinary);
  const half = Math.ceil(HB084.lastRoundReplyRule().length / 4);
  assert.ok(tokensPerCall(ending) >= tokensPerCall(ordinary) + half - 1, `an ending answer call carries at least the reply half more than an ordinary one (${tokensPerCall(ending)} vs ${tokensPerCall(ordinary)} + ${half})`);
});

// C&C's question after the fix-ups: a chain that cannot compose the last round must fail a TEST, not a run or `council doctor`. Every shipped layered chain, W26 and the rating demand injected together (and the seat-title words, which ride on the post prompt of the chains that switch seat_personas on).
test('every shipped layered chain composes the last round\'s prompts (post and reply, both values of "again") and prices the ending exchange in the maximum, with W26 and the rating demand recorded together', () => {
  const dir = new URL('../chains/', import.meta.url);
  const layered = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))])
    .filter(([, c]) => c.signoff === 'unanimous' && Array.isArray(c.seats?.critics) && c.seats.critics.length > 0 && c.seats.critics.every(x => x.layer !== undefined));
  assert.ok(layered.length >= 8, `the premise: the shipped layered chains were found (${layered.length}): ${layered.map(([f]) => f).join(', ')}`);   // CHANGED ACCEPTED TEST (0.8.4 seats and retirements unit): OLD bar 10. NEW bar: 8 (seven planning chains and mock-layered). WHY: the count moves with the thing it counts
  for (const [file, raw] of layered) {
    setHeldForTest({ ...DEMAND, ...W26, seatTitleBlock: HC084.seatTitleBlock });
    const config = resolveChainSeats(raw);
    assert.doesNotThrow(() => EP.assertEndingPrompts(config), `${file}: the last round's prompts compose`);
    const rows = estimateChainRows(config, { maximum: true });
    if (exchangeJudgeCount(config) >= 2) assert.ok(rows.some(r => /^ldebate-end-L\d+-/.test(r.label)) && rows.some(r => /^lreply-end-L\d+-/.test(r.label)), `${file}: the maximum prices the ending exchange`);
  }
});
