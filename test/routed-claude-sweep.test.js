// 0.8.4 cache part (b)2, FIX 2 (Mini-C&C, Helper B's condition 1c(5): "the per-seat sweep on a routed chain"). Offline, $0: the dry run is a pure function of the chain; nothing is sent.
// WHAT IT PINS, for every shipped chain that has Claude seats, in the RELEASE state (every held batch recorded together) and with the switch on in memory at both lifetimes (so the test does not depend on the chain files carrying it):
//   RCS-1 THE MARKS EXIST: the chain routed by resolveRun with only an OpenRouter key marks exactly the seats its direct copy marks, every one of them at 5 minutes whatever the chain's lifetime is (plan-claude-council's 1 hour is for its direct seats).
//         At least one routed seat is marked (else every "marked seat" check below would hold for nothing).
//   RCS-2 THE PREVIEW, PER SEAT, BOTH FIGURES: a marked routed seat's rows with caching on are at or below its rows with it off; an unmarked seat (a Qwen seat, a GPT seat) keeps the same rows and may read higher by what the order adds
//         (his 10 Nov 2026 "4: a": the lead-in on every judge). That is the direct sweep's rule (test/cache-marks.test.js); it is NOT "every seat at or below": a seat that is not marked has no saving to offset the lead-in.
//         The number of marked units is the direct copy's number.
//   RCS-3 THE PRICE OF A MARKED ROUTED CALL: for each Claude model a routed shipped chain seats, the cap's projection (Cost.worstCaseOf, the function the maximum figure and invoke() both use) puts the cached head at the
//         write multiple (row cache_write / cache_basis_in, never below 1.25) and, for a read, at the read multiple (row cache_read / cache_basis_in) of ITS OWN pricing row. These multiples are derived here from the raw rows
//         (not from `in`: Haiku 5.5's counted `in` is 0.55 and its basis 0.11). THIS PINS THE MAXIMUM FIGURE'S PROJECTION; the expected figure splits a marked row's input in src/cost.js inputUsdOf, which this file reaches only through RCS-2's per-seat comparison.
// RED RUN: against 2e2462ab (the integration tip, no (b)2 at all) plus this file. RCS-1 fails (routed seats are unmarked there); RCS-2 fails at the marked-unit count; RCS-3's write rows pass (1.25 both ways) and its read rows fail for the models whose
// read multiple is not the default 0.1 (Sonnet 5.5 and Opus 5.5 at 0.05, Fable 5.2 at 0.025).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cost from '../src/cost.js';
import * as Held from '../src/held-roles.js';
import * as PromptCache from '../src/prompt-cache.js';
import { sameLayerOrdinals, registerSeatKeys } from '../src/seat-key.js';
import * as HC from './held-prompts/held-084-cache-order.js';
import * as HB from './held-prompts/held-084-b.js';
import * as HD from './held-prompts/held-084-d27.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Dynamic imports (like test/cache-marks.test.js): a module missing on an older tree shows each test red by name instead of killing the file at load.
const Gate = await import('../src/cache-order-gate.js').catch(() => ({}));
const RR = await import('../src/resolve-run.js').catch(() => ({}));
afterEach(() => Held.setHeldForTest(null));

const RELEASE = { ...HC, shortExchangeRule: HB.shortExchangeRule, signoffLineRule: HB.signoffLineRule, draftStartLine: HD.draftStartLine, draftBoundarySentence: HD.draftBoundarySentence };
const PRICES = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));
const OPENROUTER_ONLY = { OPENROUTER_API_KEY: 'sk-test-dummy-key' };
const total = rows => rows.reduce((t, r) => t + r.usd, 0);
const labOf = c => c.lab || c.provider;
const escapeRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the rows of ONE seat (the label shapes of the dry run; the same pattern as the direct sweep in test/cache-marks.test.js)
const rowsOfSeat = (rows, lab, layer, nth = 1) => rows.filter(r => new RegExp(`^(panel|ldebate|lreply|final-read)-(end-)?(L${layer}|\\d+)-${escapeRe(lab)}${nth > 1 ? `-${nth}` : ''}(-reask\\d*|-x\\d+)?$`).test(r.label));
const unitsOf = critics => { const ordinals = sameLayerOrdinals(critics); return [...new Map(critics.map(c => [`${labOf(c)}|${c.layer}|${ordinals.get(c) ?? 1}`, c])).values()].map(c => ({ c, lab: labOf(c), layer: c.layer, nth: ordinals.get(c) ?? 1 })); };

// every shipped chain (outdated/ is a sub-folder and is not listed) that seats a Claude model directly, as { name, on (direct, switch on in memory), routed (resolveRun with an OpenRouter key only) }
const claudeChains = ttl => {
  const out = [];
  for (const f of readdirSync(join(root, 'chains')).filter(x => x.endsWith('.json')).sort()) {
    const base = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    if (base.advise?.enabled === true) continue;
    const critics = base.seats?.critics ?? [];
    if (!critics.some(c => c.provider === 'anthropic')) continue;
    const on = { ...base, prompt_cache: { enabled: true, ttl } };
    if (PromptCache.lintPromptCache(on, f).length) continue;
    const routed = RR.resolveRun(structuredClone(on), { flag: 'openrouter', env: OPENROUTER_ONLY }).config;
    registerSeatKeys(routed);
    out.push({ name: f, on, routed });
  }
  return out;
};

test('RCS-1 THE MARKS EXIST: a chain routed through OpenRouter marks exactly the seats its direct copy marks, each at 5 minutes, and at least one seat is marked (release state, both lifetimes)', () => {
  assert.equal(typeof RR.resolveRun, 'function');
  Held.setHeldForTest({ ...RELEASE });
  let markedRouted = 0, compared = 0;
  for (const ttl of ['5m', '1h']) for (const { name, on, routed } of claudeChains(ttl)) {
    const direct = on.seats.critics, via = routed.seats.critics;
    assert.equal(via.length, direct.length, `${name} ${ttl}: the routed roster has the direct roster's seats`);
    compared++;
    direct.forEach((d, i) => {
      const r = via[i];
      const want = d.provider === 'anthropic' ? (Gate.markTtlOf(on, d) ? '5m' : null) : Gate.markTtlOf(on, d);
      assert.equal(r.provider === 'openrouter' || d.provider !== 'anthropic', true, `${name} ${ttl}: seat ${i} of a Claude direct seat goes through OpenRouter`);
      assert.equal(Gate.markTtlOf(routed, r), want, `${name} ${ttl}: seat ${labOf(d)} L${d.layer} is marked ${want === null ? 'not at all' : 'at 5 minutes'} (direct copy: ${Gate.markTtlOf(on, d)})`);
      if (d.provider === 'anthropic' && want) markedRouted++;
    });
  }
  assert.ok(compared >= 10, `five shipped chains with Claude seats at two lifetimes were compared (${compared})`);
  assert.ok(markedRouted > 0, 'at least one routed seat is marked');
});

test('RCS-2 THE PREVIEW PER SEAT, BOTH FIGURES: a marked routed seat\'s rows with caching on are at or below its rows with it off; an unmarked seat keeps its rows and may read higher; the marked units are the direct copy\'s (release state)', () => {
  Held.setHeldForTest({ ...RELEASE });
  const problems = [], table = [];
  const check = (ok, message) => { if (!ok) problems.push(message); };
  let seats = 0, markedUnits = 0;
  for (const ttl of ['5m', '1h']) for (const { name, on, routed } of claudeChains(ttl)) {
    const critics = routed.seats.critics;
    const units = unitsOf(critics), directMarked = unitsOf(on.seats.critics).filter(u => Gate.markTtlOf(on, u.c)).length;
    const routedMarked = units.filter(u => Gate.markTtlOf(routed, u.c)).length; markedUnits += routedMarked;
    check(routedMarked === directMarked, `${name} ${ttl}: the routed chain has the direct copy's ${directMarked} marked units (found ${routedMarked})`);
    for (const maximum of [false, true]) {
      const onRows = Cost.estimateChainRows(routed, { maximum }), offRows = Cost.estimateChainRows({ ...routed, prompt_cache: undefined }, { maximum });
      table.push(`${name} ${ttl} ${maximum ? 'maximum' : 'expected'}: on ${total(onRows).toFixed(4)} off ${total(offRows).toFixed(4)}`);
      for (const { c, lab, layer, nth } of units) {
        const here = `${name} ${ttl} ${maximum ? 'maximum' : 'expected'} seat ${lab}${nth > 1 ? ` #${nth}` : ''} L${layer}`;
        const sOn = rowsOfSeat(onRows, lab, layer, nth), sOff = rowsOfSeat(offRows, lab, layer, nth);
        check(sOn.length > 0 && sOff.length > 0, `${here}: no row of this seat was matched`);
        if (!(sOn.length > 0 && sOff.length > 0)) continue;
        seats++;
        if (Gate.markTtlOf(routed, c)) check(total(sOn) <= total(sOff) + 1e-9, `${here}: marked, on ${total(sOn)} exceeds off ${total(sOff)}`);
        else {
          check(JSON.stringify(sOn.map(r => r.label)) === JSON.stringify(sOff.map(r => r.label)), `${here}: unmarked, the same rows`);
          check(total(sOn) >= total(sOff) - 1e-9, `${here}: unmarked, adding the order's words cannot lower the rows`);
        }
      }
    }
  }
  console.log(`ROUTED SWEEP seats checked: ${seats}\n${table.join('\n')}`);
  assert.ok(seats > 0, 'seats were checked');
  assert.ok(markedUnits > 0, 'at least one routed unit is marked (else the marked-seat check above held for nothing)');
  assert.deepEqual(problems, []);
});

test('RCS-3 THE PRICE OF A MARKED ROUTED CALL: the cap projects the cached head at the write multiple and the read multiple of the model\'s OWN routed row (the maximum figure\'s projection)', () => {
  Held.setHeldForTest({ ...RELEASE });
  const models = new Set();
  for (const { routed } of claudeChains('5m')) for (const c of routed.seats.critics) if (c.provider === 'openrouter' && c.originalProvider === 'anthropic') models.add(c.model);
  assert.ok(models.size >= 3, `the routed shipped chains seat several Claude models (${[...models].join(', ')})`);
  const chars = 40000, head = 8000;   // 10,000 prompt tokens (under every price tier), 8,000 of them the head
  for (const model of models) {
    const row = PRICES[`openrouter/${model}`];
    assert.ok(row && [row.in, row.cache_write, row.cache_read, row.cache_basis_in].every(n => typeof n === 'number' && n > 0), `${model}: the routed row names a write, a read and the basis they are quoted against`);
    const basis = Math.min(row.cache_basis_in, row.in), write = Math.max(1.25, row.cache_write / basis), read = Math.min(1, row.cache_read / basis);   // src/price-table.js cacheMultsOf: the basis is the row's cache_basis_in, never above `in`
    const at = cache => Cost.worstCaseOf('openrouter', model, { promptChars: chars, maxTokens: 1000, cache }).usd;
    const plain = at(null);
    assert.ok(Math.abs((at({ headTokens: head, ttl: '5m' }) - plain) - (head / 1e6) * row.in * (write - 1)) < 1e-9, `${model}: the head is projected at the write multiple ${write} of its row`);
    assert.ok(Math.abs((at({ headTokens: head, ttl: '5m', read: true }) - plain) - (head / 1e6) * row.in * (read - 1)) < 1e-9, `${model}: a read is projected at the read multiple ${read} of its row`);
  }
});
