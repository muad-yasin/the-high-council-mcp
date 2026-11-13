// 0.8.4 S6 (M1), U6-4: the rows of the SHORTENED exchange of the layers above the lowest in the cost estimate (MONEY; Q8, src/cost.js upperExchangeLayers). One round, a post row and an answer row per judge (2K rows) of each such layer with two or more judges,
// on that layer's pass count; the text each row carries includes the W5 and W14 tails. Offline, no run, $0. WRITTEN WITHOUT A RUN (overnight, no box). Held (the pair not recorded): no row and no figure moves.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { estimateChainRows } from '../src/cost.js';
import { setHeldForTest } from '../src/held-roles.js';
import { resolveChainSeats } from '../src/chain.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => setHeldForTest(null));
const PAIR = { shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule };
const W5 = HB084.shortExchangeRule(); const W14 = HB084.signoffLineRule();
const seat = (lab, layer) => ({ provider: 'anthropic', model: 'claude-sonnet-5', lab, layer, maxTokens: 2000 });
const critics = [seat('a', 1), seat('b', 1), seat('c', 2), seat('d', 2), seat('e', 3), seat('f', 3)];
const base = { signoff: 'unanimous', estimate: { promptTokens: 20000, draftTokens: 30000, critiqueTokens: 2000 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics } };
const overseer = { name: 'dry-overseer', ...base, maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 } };
const plain = { name: 'dry-plain', ...base, maxRounds: 2 };
const rowsOf = (cfg, held, maximum = true) => { setHeldForTest(held); return estimateChainRows(cfg, { maximum }); };
const named = (rows, label) => rows.find(r => r.label === label);
const tokensPerCall = r => r.input / (r.times ?? 1);
const upper = rows => rows.filter(r => /^(ldebate|lreply)-(L[23]|[0-9]+)-[c-f]$/.test(r.label));

// REMOVED (0.8.4 apply, K7, job 16): 'PIN (held): with the pair not recorded, or only one of the two words, no row of the shortened exchange exists ...'. A held-state row: W5 and W14 are recorded in every shipped run, so a map that only leaves them out falls through to the recorded words and the rows exist (job 16: 'dry-overseer: no upper-layer exchange row' failed); no HELD_OFF map for 0.8.4 names. Recorded-state siblings in THIS file: the Q8 rows below (the rows of the shortened exchange, their labels, pass counts and tokens).
test('Q8, overseer rounds: with the pair recorded each layer above the lowest with two judges gets one post row and one answer row per judge on that layer\'s pass count, one round, and no other row moves', () => {
  for (const maximum of [true, false]) {
    const on = rowsOf(overseer, { ...DEMAND, ...PAIR }, maximum);
    // REMOVED HALF (0.8.4 apply, K7, job 16): `assert.deepEqual(on.filter(r => !upper(on).includes(r)), held, 'only the upper-layer rows are added')` with `held` = the rows with the pair NOT recorded: not buildable without a held-off map, which is banned for 0.8.4 names (the pair is recorded). Sibling: the label, pass-count and no-marked-row assertions below, on the recorded rows.
    assert.deepEqual(upper(on).map(r => r.label).sort(), ['c', 'd', 'e', 'f'].flatMap(l => [`ldebate-L${'cd'.includes(l) ? 2 : 3}-${l}`, `lreply-L${'cd'.includes(l) ? 2 : 3}-${l}`]).sort(), `${maximum ? 'maximum' : 'expected'}: 2K rows per layer`);
    const pass = { c: maximum ? 2 : undefined, d: maximum ? 2 : undefined, e: undefined, f: undefined };   // layer 2 is asked b2 + 1 times per overseer round at most; layer 3 once
    for (const [l, times] of Object.entries(pass)) for (const kind of ['ldebate', 'lreply']) assert.equal(named(on, `${kind}-L${'cd'.includes(l) ? 2 : 3}-${l}`).times, times, `${kind} ${l}: the layer's pass count`);
    assert.equal(on.some(r => /^(ldebate|lreply)-L[23]-.*-x2$/.test(r.label)), false, 'one round: no marked-round row');
  }
});

// CHANGED ACCEPTED TEST (0.8.4 apply, the order is live; the shape change C&C ruled for ending-exchange-cost on 11 Nov 2026, applied here (C&C's walk confirms the extension): the pin moves to the order-live shape). OLD (ruling B): layer 1's later rounds were marked rows (-x2) and the upper layers' one round was never marked, so an upper call cost what it cost with the cache off. NEW: with the order live ruling B's rows do not exist; a marked seat's exchange rows read the entry the panel wrote, at every layer. What stays: the upper layers' one round has NO marked-round row (no -x2), the same rows (labels and call counts) as with the cache off, and no call costs more with the cache on than off. WHY: job 16 showed the old premise red (no -x2 row at layer 1 any more); the box probe of job 18 printed the order-live rows (a layer-1 call at the read price, about a third of the uncached call).
test('Q8, prompt caching on (direct Anthropic seats, the maximum): the upper layers\' one round has no marked-round row and the same rows as with the cache off; with the order live no call costs more cached than uncached', () => {
  const pc = r => r.usd / (r.times ?? 1);
  const off = rowsOf(overseer, { ...DEMAND, ...PAIR }); const cached = rowsOf({ ...overseer, prompt_cache: { enabled: true } }, { ...DEMAND, ...PAIR });
  assert.ok(!cached.some(r => /^(ldebate|lreply)-L\d-.*-x[23]$/.test(r.label)), 'ruling B\'s rows (-x2, -x3) do not exist with the order live');
  assert.ok(pc(named(cached, 'ldebate-L1-a')) < pc(named(off, 'ldebate-L1-a')), 'the premise: the cache is on, and a layer-1 call reads the entry (it costs less than the uncached call)');
  for (const label of ['ldebate-L2-c', 'lreply-L2-d', 'ldebate-L3-e', 'lreply-L3-f']) {
    const a = named(off, label); const b = named(cached, label);
    assert.equal(b.times, a.times, `${label}: the same row with the cache on and off`);
    assert.ok(pc(b) <= pc(a) + 1e-12, `${label}: a call costs no more with the cache on`);
  }
});

test('Q8, no overseer rounds: one set of rows per pass for the layers above the lowest, labels ldebate-<pass>-<seat>, and no other row moves', () => {
  const on = rowsOf(plain, { ...DEMAND, ...PAIR });
  // REMOVED HALF (0.8.4 apply, K7, job 16): 'only the upper-layer rows are added' against the rows with the pair NOT recorded (not buildable without a held-off map, banned for 0.8.4 names). Sibling: the label assertion below.
  const want = [1, 2].flatMap(r => ['c', 'd', 'e', 'f'].flatMap(l => [`ldebate-${r}-${l}`, `lreply-${r}-${l}`])).sort();
  assert.deepEqual(upper(on).map(r => r.label).sort(), want);
});

test('Q8, the text is priced: an upper-layer call carries the tokens of the tails that layer 1\'s call does not (W5 on both prompts, W14 on the answer)', () => {
  const on = rowsOf(overseer, { ...DEMAND, ...PAIR });
  const post = tokensPerCall(named(on, 'ldebate-L2-c')) - tokensPerCall(named(on, 'ldebate-L1-a'));
  const reply = tokensPerCall(named(on, 'lreply-L2-c')) - tokensPerCall(named(on, 'lreply-L1-a'));
  assert.ok(post >= Math.ceil((W5.length + 2) / 4) - 1, `a post call carries W5 (${post} more tokens than layer 1's)`);
  assert.ok(reply >= Math.ceil((W5.length + W14.length + 4) / 4) - 1, `an answer call carries W5 and W14 (${reply} more tokens than layer 1's)`);
});

test('Q8: a layer with one judge has no exchange to price, and a layer-1-only or flat chain gets no upper row', () => {
  const single = { ...overseer, seats: { ...base.seats, critics: [seat('a', 1), seat('b', 1), seat('c', 2), seat('d', 2), seat('e', 3)] } };
  const rows = rowsOf(single, { ...DEMAND, ...PAIR });
  assert.deepEqual(upper(rows).map(r => r.label).filter(l => /-L3-/.test(l)), [], 'layer 3 has one judge: no row');
  assert.ok(upper(rows).some(r => /-L2-/.test(r.label)), 'layer 2 still has its rows');
  const flat = { name: 'flat', signoff: 'unanimous', maxRounds: 2, estimate: base.estimate, seats: { ...base.seats, critics: [{ ...seat('c', undefined), layer: undefined }, { ...seat('d', undefined), layer: undefined }] } };
  assert.deepEqual(upper(rowsOf(flat, { ...DEMAND, ...PAIR })), [], 'a chain with no layers: no upper row');
});

test('every shipped layered chain: with the pair recorded the maximum prices the shortened exchange wherever a layer above the lowest has two judges', () => {
  const dir = new URL('../chains/', import.meta.url);
  const layered = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))])
    .filter(([, c]) => c.signoff === 'unanimous' && Array.isArray(c.seats?.critics) && c.seats.critics.length > 0 && c.seats.critics.every(x => x.layer !== undefined));
  assert.ok(layered.length >= 8, `the premise: the shipped layered chains were found (${layered.length})`);   // CHANGED (0.8.4 seats unit, Muad 10 Nov 2026 01:10): was >= 10; three layered chains moved to chains/outdated/
  for (const [file, raw] of layered) {
    setHeldForTest({ ...DEMAND, ...PAIR });
    const config = resolveChainSeats(raw);
    const rows = estimateChainRows(config, { maximum: true });
    const lows = Math.min(...config.seats.critics.map(c => c.layer));
    const wanted = [...new Set(config.seats.critics.map(c => c.layer))].filter(l => l > lows && config.seats.critics.filter(c => c.layer === l).length >= 2);
    const seatOf = r => /^(?:ldebate|lreply)-(?:L\d+|\d+)-(.+)$/.exec(r.label)?.[1];   // the seat lab of an exchange row, exactly (a lab that ends with another lab does not match it)
    // CHANGED (box run of 08 Nov 2026: plan-china-high-council and plan-claude-council seat one lab on layers 1 and 2, so matching a row to a layer by the lab counted layer-1 rows as layer 2): a row of the overseer shape names its layer (`ldebate-L<n>-<lab>`), read from the label; only a row without it (the per-pass shape) is matched by the lab.
    const layerOfRow = r => { const m = /^(?:ldebate|lreply)-L(\d+)-/.exec(r.label); return m ? Number(m[1]) : null; };
    const atLayer = (rows_, l) => rows_.filter(r => /^(ldebate|lreply)-/.test(r.label) && !r.label.includes('-end-') && (layerOfRow(r) !== null ? layerOfRow(r) === l : config.seats.critics.some(c => c.layer === l && (c.lab || c.provider) === seatOf(r))));
    for (const l of wanted) assert.ok(atLayer(rows, l).length >= 2 * config.seats.critics.filter(c => c.layer === l).length, `${file}: layer ${l} is priced (a post and an answer row per judge)`);
    // REMOVED HALF (0.8.4 apply, K7, job 16): 'no exchange row while the pair is held' (the rows with the pair not recorded: not buildable without a held-off map, banned for 0.8.4 names; job 16: 'mock-layered.json: layer 2 has no exchange row while the pair is held'). Sibling: the priced-layer assertion above, on the recorded rows.
  }
});

// G7 (Q8): the ONE extra verdict call of a top-layer judge whose reply ended with "sign-off: no" and left nothing standing (src/chain.js refusedSignoffs, label ending -reask3): in the MAXIMUM only, at the review's expected cost (a repeat), plus the tokens of the held note.
const NOTE_WORD = { signoffRefusedReaskNote: HB084.signoffRefusedReaskNote };
const perCall = r => r.usd / (r.times ?? 1);
test('Q8 (G7): the maximum prices the top-layer sign-off re-ask for each top-layer judge when the pair and the note are recorded: at the expected cost of the review it repeats (not below the in-pass re-ask row), on the layer\'s pass count; not in the expected figure', () => {
  // REMOVED HALVES (0.8.4 apply, K7, job 16): 'the note held: no row' and 'and no other row moves' against the rows with the note NOT recorded (the note is recorded; not buildable without a held-off map, banned for 0.8.4 names). Siblings: the row-per-top-layer-judge, priced-at-least-the-in-pass-re-ask, not-in-the-expected-figure and flat-chain assertions below.
  const on = rowsOf(overseer, { ...DEMAND, ...PAIR, ...NOTE_WORD });
  assert.deepEqual(on.filter(r => /-reask3$/.test(r.label)).map(r => r.label).sort(), ['panel-L3-e-reask3', 'panel-L3-f-reask3'], 'one row per top-layer judge, none for the lower layers');
  for (const lab of ['e', 'f']) assert.ok(perCall(named(on, `panel-L3-${lab}-reask3`)) >= perCall(named(on, `panel-L3-${lab}-reask`)), `${lab}: priced at least as the in-pass re-ask it repeats (same review, plus the note)`);
  assert.deepEqual(rowsOf(overseer, { ...DEMAND, ...PAIR, ...NOTE_WORD }, false).filter(r => /-reask3$/.test(r.label)), [], 'the expected figure has no re-ask rows');
  const flat = rowsOf(plain, { ...DEMAND, ...PAIR, ...NOTE_WORD });
  assert.deepEqual(flat.filter(r => /-reask3$/.test(r.label)).map(r => r.label).sort(), ['panel-1-e-reask3', 'panel-1-f-reask3', 'panel-2-e-reask3', 'panel-2-f-reask3'], 'without overseer rounds: per pass');
  const single = { ...overseer, seats: { ...base.seats, critics: [seat('a', 1), seat('b', 1), seat('c', 2), seat('d', 2), seat('e', 3)] } };
  assert.deepEqual(rowsOf(single, { ...DEMAND, ...PAIR, ...NOTE_WORD }).filter(r => /-reask3$/.test(r.label)), [], 'a top layer with one judge has no exchange, so no sign-off line to refuse');
});
