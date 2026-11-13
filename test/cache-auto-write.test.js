// 0.8.4 cache part a, 3b (C&C 09 Nov 2026): a call to an `openai/` GPT model of generation 5.6 or later on OpenRouter is BILLED A WRITE on its prompt although no marker was sent (OpenRouter's Prompt Caching page: "GPT-5.6 and later
// charge cache writes at 1.25x the price of the original input pricing, even with automatic caching - no opt-in required"). Until a measured run shows reads, every call of such a seat is priced as a write in the dry run's two figures,
// the per-call guard, the reservation and the settled figure (0.8.4, the add-on removal, wave 2: the advise quote, priceOfChain of src/send-path-refusals.js, is gone with the add-on, and so are its readers below: P1, the quote of M1 and the quote half of M5). Offline, $0 (a local stub server for the stage). Namespace imports, so every file loads on the parent and an absent export is a failing value check.
// READERS pinned here: isAutoCacheWriteModel (the selector), worstCaseOf / projectStage (the guard and the reservation), estimateChainRows (the dry run), costOf (the settled figure) and the
// chain.js settle (the flag in the usage file). cacheModeOf is the ONE reader of what a call carries; setCacheModeForTest forces it (M1..M3).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { setUserPrices, resetUserPrices } from '../src/price-table.js';
import * as C from '../src/cost.js';
import * as chainNs from '../src/chain.js';
import * as SR from '../src/spend-reservations.js';

afterEach(() => { C.setCacheModeForTest?.(null); chainNs.setBudget?.(null); chainNs.setCache?.(null); chainNs.setReservationSink?.(null); });
const near = (a, b, eps = 1e-9) => typeof a === 'number' && Math.abs(a - b) < eps;
const SHIPPED = JSON.parse(readFileSync(new URL('../src/pricing.json', import.meta.url), 'utf8'));
const chainFile = f => JSON.parse(readFileSync(new URL(`../chains/${f}`, import.meta.url), 'utf8'));
const OR = id => ['openrouter', id];
const SELECTED6 = ['openai/gpt-5.6-luna', 'openai/gpt-5.6-sol', 'openai/gpt-6-astra', 'openai/gpt-6-luna', 'openai/gpt-6.1-sol', 'openai/gpt-6.1-terra'];
// the write multiple of a shipped row, read from the table independently of the code under test (cache_write over the base the figures were taken at); 1.25 when the row names none (the page's figure)
const writeMultOfRow = id => { const r = SHIPPED[`openrouter/${id}`]; return typeof r.cache_write === 'number' ? r.cache_write / Math.min(r.cache_basis_in ?? r.in, r.in) : 1.25; };
// CHANGED ACCEPTED TEST (0.8.4 release chores, 11 Nov 2026; Mini-C&C's ruling on the re-pin). OLD: the 1.25 default for a SELECTED row that names no write price was pinned by the shipped row openrouter/openai/gpt-5.6-sol (G1, T1, T2). NEW: it is pinned by a USER price row, openrouter/openai/gpt-5.6-nowrite-test (selected: generation 5.6; absent from the shipped table; a user row names no cache price, so autoWriteMultOf falls back to 1.25); the shipped Sol row is read through writeMultOfRow like every other shipped row. WHY: the refresh of 11 Nov 2026 gives the Sol row cache_write 5.5 over a base of 4.4, exactly 1.25, so the old asserts would stay green while their claim ("the row names no write price") was false, and the default (AUTO_CACHE_WRITE_MULT, src/cost.js) would be pinned by no row at all at the next refresh.
const NOWRITE = 'openai/gpt-5.6-nowrite-test';
function withNoWriteRow(fn) {
  assert.equal(SHIPPED[`openrouter/${NOWRITE}`], undefined, 'premise: the shipped table does not price this id');
  const dir = mkdtempSync(join(tmpdir(), 'cache-nowrite-'));
  try { writeFileSync(join(dir, 'pricing.user.json'), JSON.stringify({ [`openrouter/${NOWRITE}`]: { in: 2, out: 10 } })); setUserPrices(dir); fn(NOWRITE); }
  finally { resetUserPrices(); rmSync(dir, { recursive: true, force: true }); }
}

test('S1: the selector reads the FAMILY from the id: every openrouter openai/ GPT of generation 5.6 or later is selected, with or without cache_write; pre-5.6 ids are not; an id whose generation cannot be read IS selected (errs high); a row of another lab that names cache_write is not', () => {
  const sel = (p, m) => C.isAutoCacheWriteModel?.(p, m);
  for (const id of SELECTED6) assert.equal(sel(...OR(id)), true, `${id} is selected`);
  const NOT_SELECTED = ['openai/gpt-5.5', 'openai/gpt-5-mini', 'openai/gpt-5', 'openai/gpt-4o', 'openai/gpt-5-2026-08-07'];
  for (const id of NOT_SELECTED) assert.equal(sel(...OR(id)), false, `${id} is not selected (generation below 5.6, a dated id reads as 5.0)`);
  for (const id of ['openai/gpt-oss-120b', 'openai/o3']) assert.equal(sel(...OR(id)), true, `${id}: no readable generation, selected on purpose (errs high)`);
  for (const id of ['anthropic/claude-opus-5.5', 'qwen/qwen3.7-plus', 'google/gemini-3.1-pro-preview', 'minimax/minimax-m3', 'deepseek/deepseek-v4-pro']) assert.equal(sel(...OR(id)), false, `${id} is not selected, whatever its row names`);
  assert.equal(sel('openai', 'gpt-6-luna'), false, 'a direct OpenAI call is not an OpenRouter call');
  assert.equal(sel('anthropic', 'claude-opus-5'), false);
  // the shipped table: exactly the rows the page's family covers
  const rows = Object.keys(SHIPPED).filter(k => k.startsWith('openrouter/openai/')).map(k => k.slice('openrouter/'.length));
  assert.deepEqual(rows.filter(id => sel(...OR(id))).sort(), ['openai/gpt-5.6-luna', 'openai/gpt-5.6-sol', 'openai/gpt-6-astra', 'openai/gpt-6-luna', 'openai/gpt-6.1-sol', 'openai/gpt-6.1-terra']);
});

test('G1: the per-call guard (worstCaseOf, projectStage) prices a selected seat\'s whole prompt as a write with no marker and with prompt_cache off: a row that names cache_write at the row (gpt-5.6-sol included), a selected row with no write price (a user row) at exactly 1.25 x input; a non-selected row at the input price', () => {
  const chars = 400000, tokens = 100000, out = 1000;
  for (const id of ['openai/gpt-6-luna', 'openai/gpt-6.1-sol', 'openai/gpt-6-astra', 'openai/gpt-5.6-sol']) {
    const p = C.priceAt?.('openrouter', id, tokens);
    const w = writeMultOfRow(id);
    const got = C.worstCaseOf('openrouter', id, { promptChars: chars, maxTokens: out });
    assert.ok(near(got.usd, (tokens / 1e6) * p.in * w + (out / 1e6) * p.out), `${id}: ${got.usd} vs write multiple ${w}`);
    const seat = { provider: 'openrouter', model: id, maxTokens: out };
    const stage = C.projectStage(seat, { system: 'x'.repeat(chars - 4), user: 'yyyy' });
    assert.ok(near(stage, (tokens / 1e6) * p.in * w + (out / 1e6) * p.out), `${id}: projectStage ${stage}`);
  }
  withNoWriteRow(id => {
    const p = C.priceAt('openrouter', id, tokens);
    assert.ok(near(p.in, 2) && near(p.out, 10), `fixture: the user row prices ${id} at 2 / 10 and names no write price`);
    const got = C.worstCaseOf('openrouter', id, { promptChars: chars, maxTokens: out });
    assert.ok(near(got.usd, (tokens / 1e6) * p.in * 1.25 + (out / 1e6) * p.out), `${id}: a selected row with no write price is priced at 1.25 x input: ${got.usd}`);
    const stage = C.projectStage({ provider: 'openrouter', model: id, maxTokens: out }, { system: 'x'.repeat(chars - 4), user: 'yyyy' });
    assert.ok(near(stage, (tokens / 1e6) * p.in * 1.25 + (out / 1e6) * p.out), `${id}: projectStage ${stage}`);
  });
  const plain = C.worstCaseOf('openrouter', 'openai/gpt-5.5', { promptChars: chars, maxTokens: out });
  const p5 = C.priceAt('openrouter', 'openai/gpt-5.5', tokens);
  assert.ok(near(plain.usd, (tokens / 1e6) * p5.in + (out / 1e6) * p5.out), 'gpt-5.5 (below 5.6) stays at the input price');
});

test('G2: the reservation of a selected seat\'s call equals the guard\'s projection with the write price (the reserved line is on disk before the send), through invoke() with a local stub server and prompt_cache off', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-auto-'));
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'd'.repeat(40);
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'g', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100000, completion_tokens: 10, total_tokens: 100010, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 100000 } } })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    chainNs.setCache(null); chainNs.setBudget(50); chainNs.setReservationSink(SR.openReservations(dir));
    const seat = { provider: 'openrouter', model: 'openai/gpt-6-luna', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` };
    const system = 's'.repeat(399996), user = 'uuuu';
    await chainNs.runSingleStage(seat, { system, user, label: 'cache-auto', log: () => {} });
    const lines = SR.reservationLinesOf(dir).filter(l => l.event === 'reserved');
    assert.equal(lines.length, 1);
    const want = C.projectStage(seat, { system, user });
    const p = C.priceAt('openrouter', 'openai/gpt-6-luna', 100000);
    assert.ok(near(want, (100000 / 1e6) * p.in * writeMultOfRow('openai/gpt-6-luna') + (500 / 1e6) * p.out), `the projection carries the write: ${want}`);
    assert.ok(near(lines[0].usd, want), `the reservation ${lines[0].usd} equals the projection ${want}`);
  } finally { chainNs.setReservationSink(null); chainNs.setBudget(null); srv.close(); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; rmSync(dir, { recursive: true, force: true }); }
});

test('D1: the dry run keeps ONE row per call group for an unmarked selected seat (no -x2 / -x3 rows) and prices its input as a write in BOTH figures, in every shipped chain that seats one, with prompt_cache off', () => {
  const names = ['plan-high-council', 'plan-medium-council', 'plan-mini-council', 'plan-the-high-council'];   // 0.8.4 seats unit: plan-default-opro-council and plan-mini-council-sol-session retire (Muad 10 Nov 2026 01:10)
  let seen = 0;
  for (const name of names) {
    const cfg = chainFile(`${name}.json`);
    for (const maximum of [false, true]) {
      const rows = C.estimateChainRows(cfg, { maximum });
      // CHANGED ACCEPTED (0.8.4 cache part (b)2 step (a), 10 Nov 2026; found by the box set). OLD no row of the chain had a cache-group suffix, because no shipped chain carried the switch. NEW the assertion is about the rows of the SELECTED seats (the seats this test is about: GPT 5.6 and later on OpenRouter): none has a `-x2` / `-x3` row. WHY: the seven shipped planning chains carry the switch, and while the order's words are not recorded a direct Anthropic seat of the chain has those rows legitimately (the round-2 write and the reading rounds); a selected seat is never marked.
      assert.ok(!rows.some(r => /-x[23]$/.test(r.label) && SELECTED6.includes(r.seat.slice('openrouter/'.length))), `${name}: no cache-group rows for a selected seat`);
      if (maximum) continue;
      for (const r of rows.filter(r => SELECTED6.includes(r.seat.slice('openrouter/'.length)) && r.label !== 'network-retries')) {   // network-retries is 3 x another row's per-call figure, which carries the premium already
        const id = r.seat.slice('openrouter/'.length), p = C.priceOf('openrouter', id);
        assert.ok(near(r.usd, (r.input / 1e6) * p.in * writeMultOfRow(id) + (r.output / 1e6) * p.out, 1e-7), `${name} ${r.label} (${id}): ${r.usd}`);
        seen++;
      }
    }
  }
  assert.ok(seen > 5, `selected-seat rows were checked (${seen})`);
});

test('D2: the maximum figure of a selected seat\'s row is the guard\'s projection of one call times its repeats: the call\'s input as a write (tier by the call\'s own size) plus its output cap, no retry for an OpenRouter seat', () => {
  const cfg = chainFile('plan-mini-council.json');
  let seen = 0;
  for (const r of C.estimateChainRows(cfg, { maximum: true })) {
    const id = r.seat.slice('openrouter/'.length);
    if (!SELECTED6.includes(id) || /-reask\d*$/.test(r.label) || r.label === 'network-retries') continue;   // the maximum figure prices a re-ask and the network retries at the EXPECTED cost of the call they repeat (pushExpected), not at the cap
    const times = r.times ?? 1, inPer = r.input / times, outPer = r.output / times, p = C.priceAt('openrouter', id, inPer);
    assert.ok(near(r.usd, times * ((inPer / 1e6) * p.in * writeMultOfRow(id) + (outPer / 1e6) * p.out), 1e-7), `${r.label} (${id}): maximum row ${r.usd}`);
    seen++;
  }
  assert.ok(seen > 0, 'a selected seat has a maximum row');
});

test('R1-shipped: for every shipped planning chain, the dry run with prompt_cache ON is at or below the same chain with it OFF (expected and maximum, 5m and 1h) once selected seats are priced as writes in both: a selected seat is priced the same in ON and OFF', () => {
  const names = ['plan-high-council', 'plan-medium-council', 'plan-mini-council', 'plan-the-high-council'];   // 0.8.4 seats unit: plan-default-opro-council and plan-mini-council-sol-session retire (Muad 10 Nov 2026 01:10)
  const sum = (cfg, maximum) => C.estimateChainRows(cfg, { maximum }).reduce((t, r) => t + r.usd, 0);
  for (const name of names) {
    const off = { ...chainFile(`${name}.json`), prompt_cache: undefined };      // CHANGED ACCEPTED (0.8.4 cache part (b)2 step (a), 10 Nov 2026; found by the box set): OLD the shipped chain file had no prompt_cache switch, so the file as it stands was the switch-OFF side of this comparison. NEW the seven shipped planning chains carry the switch on, so the OFF side is the file with the switch taken out. WHY: the comparison is on-versus-off; with the file as the off side it compared two lifetimes (the 1-hour maximum read higher than the 5-minute figure the file now carries).
    for (const ttl of ['5m', '1h']) {
      const on = { ...off, prompt_cache: { enabled: true, ttl } };
      for (const maximum of [false, true]) assert.ok(sum(on, maximum) <= sum(off, maximum) + 1e-9, `${name} ${ttl} ${maximum ? 'maximum' : 'expected'}: ${sum(on, maximum)} vs ${sum(off, maximum)}`);
    }
  }
});

// ---- the settled figure (C&C: (ii)). Absent is not zero: only the absence of BOTH cache fields charges the whole input as a write and flags it; a reported count, a zero included, is priced as reported. ----
test('T1: costOf of a selected seat that reports NO cache fields charges its whole input as a write and flags it (cacheUnknown); a seat that is not selected stays at the input price', () => {
  const luna = C.costOf('openrouter', 'openai/gpt-6-luna', { input: 100000, output: 50 });
  const p = C.priceAt('openrouter', 'openai/gpt-6-luna', 100000);
  assert.ok(near(luna.usd, (100000 / 1e6) * p.in * writeMultOfRow('openai/gpt-6-luna') + (50 / 1e6) * p.out), `luna ${luna.usd}`);
  assert.equal(luna.cacheUnknown, true, 'the answer says the write is an estimate');
  const sol = C.costOf('openrouter', 'openai/gpt-5.6-sol', { input: 100000, output: 50 });
  const ps = C.priceAt('openrouter', 'openai/gpt-5.6-sol', 100000);
  assert.ok(near(sol.usd, (100000 / 1e6) * ps.in * writeMultOfRow('openai/gpt-5.6-sol') + (50 / 1e6) * ps.out), 'a row that names a write price: that price over its base');
  withNoWriteRow(id => {
    const r = C.costOf('openrouter', id, { input: 100000, output: 50 });
    const pr = C.priceAt('openrouter', id, 100000);
    assert.ok(near(r.usd, (100000 / 1e6) * pr.in * 1.25 + (50 / 1e6) * pr.out), 'a row with no write price: 1.25 x input');
  });
  const old = C.costOf('openrouter', 'openai/gpt-5.5', { input: 100000, output: 50 });
  const po = C.priceAt('openrouter', 'openai/gpt-5.5', 100000);
  assert.ok(near(old.usd, (100000 / 1e6) * po.in + (50 / 1e6) * po.out) && old.cacheUnknown === undefined, 'a pre-5.6 row stays at the input price, unflagged');
});

// CHANGED (0.8.4 cache part a, commit 5, C&C's ruling 09 Nov 2026). OLD: a count a selected seat REPORTS is priced as reported: a write of 0 stayed at the input price, a write on a row with no write price was 1.25 x input ON TOP of the input. NEW: on a selected seat that sent no marker a reported write sets no price: the written tokens are inside usage.input, which is charged at the write multiple (a reported zero included), and a pre-5.6 row is unchanged. WHY: THC now counts the whole uncached part of the prompt as a write and the read part at the read multiple, a reported write counted as lying inside prompt_tokens (THC's counting rule, not yet checked against a real reply; the page says GPT-5.6 and later charge a cache write on every call); pricing a reported write on top of input charged a reported 0 too little and a write equal to the uncached part twice.
test('T2: a write count a selected seat REPORTS sets no price (the written tokens are inside the input, which is charged as a write): a write of 0 costs the same as no count, a write on a row with no write price costs 1.25 x input and is not added on top; a pre-5.6 row\'s write with no price stays at the input price', () => {
  const zero = C.costOf('openrouter', 'openai/gpt-6-luna', { input: 100000, output: 50, cacheRead: 0, cacheWrite: 0 });
  const p = C.priceAt('openrouter', 'openai/gpt-6-luna', 100000);
  assert.ok(near(zero.usd, (100000 / 1e6) * p.in * writeMultOfRow('openai/gpt-6-luna') + (50 / 1e6) * p.out) && zero.cacheUnknown === undefined && zero.cacheWriteUnreported === undefined, `a reported zero is charged the uncached part as a write: ${zero.usd}`);
  withNoWriteRow(id => {
    const w = C.costOf('openrouter', id, { input: 1000, output: 10, cacheRead: 0, cacheWrite: 100 });
    const ps = C.priceAt('openrouter', id, 1000);
    assert.ok(near(w.usd, (1000 / 1e6) * ps.in * 1.25 + (10 / 1e6) * ps.out), `a write on a row with no write price: 1.25 x input, the write not added on top: ${w.usd}`);
  });
  const old = C.costOf('openrouter', 'openai/gpt-5.5', { input: 1000, output: 10, cacheRead: 0, cacheWrite: 100 });
  const po = C.priceAt('openrouter', 'openai/gpt-5.5', 1100);
  assert.ok(near(old.usd, (1100 / 1e6) * po.in + (10 / 1e6) * po.out), 'a pre-5.6 row with no write price keeps the input price (today\'s rule)');
});

test('T3: the settle through invoke(): a selected seat whose reply carries no cache counts is recorded cacheCounts "unknown" and charged at least the whole prompt as a write; a reply that carries counts (a zero included) is recorded "write-in-input" and charged the uncached part as a write', async () => {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'e'.repeat(40);
  const run = async usage => {
    const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'g', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage })); }); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    try { chainNs.setCache(null); chainNs.setBudget(50); return await chainNs.runSingleStage({ provider: 'openrouter', model: 'openai/gpt-6-luna', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` }, { system: 's', user: 'u', label: 'cache-auto-t3', log: () => {} }); } finally { chainNs.setBudget(null); srv.close(); }
  };
  try {
    const unknown = await run({ prompt_tokens: 100000, completion_tokens: 20, total_tokens: 100020 });
    assert.equal(unknown.usage.cacheCounts, 'unknown');
    const p = C.priceAt('openrouter', 'openai/gpt-6-luna', 100000);
    assert.ok(unknown.usd >= (100000 / 1e6) * p.in * writeMultOfRow('openai/gpt-6-luna') - 1e-9, `charged as a write: ${unknown.usd}`);
    const counted = await run({ prompt_tokens: 100000, completion_tokens: 20, total_tokens: 100020, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } });
    assert.equal(counted.usage.cacheCounts, 'write-in-input', 'a reported zero did not set the price: the record says so (OLD: undefined, no flag)');
    // CHANGED (commit 5, see T2). OLD: a reported zero was priced at the input price. NEW: at the write multiple (see T2).
    assert.ok(near(counted.usd, (100000 / 1e6) * p.in * writeMultOfRow('openai/gpt-6-luna') + (20 / 1e6) * p.out, 1e-9), `a reported zero is charged the uncached part as a write: ${counted.usd}`);
  } finally { if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
});

// CHANGED (commit 5), TITLE ONLY. OLD: "... (a write the host REPORTS stays a measurement at the row as it is)". NEW: "... (a write the host reports sets no price on a selected seat that sent no marker: see T2)". WHY: the parenthesis described the rule commit 5 replaces; the assertions are unchanged.
test('T4: an INFERRED write is never priced below the input price: the multiple is the row\'s write multiple, or the page\'s 1.25 when the row names none, floored at 1 (a write the host reports sets no price on a selected seat that sent no marker: see T2)', () => {
  assert.equal(C.autoWriteMultOf?.({ cacheWriteMult: 0.5 }), 1, 'a row whose write price fell under its input price: not below the input price');
  assert.equal(C.autoWriteMultOf?.({}), 1.25, 'a row that names no write price: the page\'s figure');
  assert.equal(C.autoWriteMultOf?.(undefined), 1.25);
  assert.equal(C.autoWriteMultOf?.({ cacheWriteMult: 2.5 }), 2.5, 'a dearer write (the 12-hour lifetime\'s) is kept');
  assert.equal(C.AUTO_CACHE_WRITE_MULT, 1.25);
});

test('T5: PER FIELD - a reply that reports the read count and NO write count on a selected seat: the uncached part of the prompt is charged as a write (at the row\'s write multiple), the read count stays as reported, and the answer says the write was not reported; the same shape on a seat that is not selected keeps today\'s price', () => {
  const SEL = 'openai/gpt-6-luna', NON = 'openai/gpt-5.5';
  const u = { input: 1000, output: 10, cacheRead: 99000 };
  const readMult = id => { const r = SHIPPED[`openrouter/${id}`]; return Math.min(1, r.cache_read / Math.min(r.cache_basis_in ?? r.in, r.in)); };
  const p = C.priceAt('openrouter', SEL, 100000), q = C.priceAt('openrouter', NON, 100000);
  const sel = C.costOf('openrouter', SEL, u);
  assert.ok(near(sel.usd, (1000 / 1e6) * p.in * writeMultOfRow(SEL) + (99000 / 1e6) * p.in * readMult(SEL) + (10 / 1e6) * p.out), `selected: ${sel.usd}`);
  assert.equal(sel.cacheWriteUnreported, true, 'the answer says the write count was not reported');
  const non = C.costOf('openrouter', NON, u);
  assert.ok(near(non.usd, (1000 / 1e6) * q.in + (99000 / 1e6) * q.in * readMult(NON) + (10 / 1e6) * q.out) && non.cacheWriteUnreported === undefined, `not selected: ${non.usd}`);
  // CHANGED (commit 5, see T2). OLD: a reported write of 0 left the fresh input at the input price. NEW: the same figure as the unreported shape, without the flag.
  const reported = C.costOf('openrouter', SEL, { ...u, cacheWrite: 0 });
  assert.ok(near(reported.usd, sel.usd) && reported.cacheWriteUnreported === undefined, 'a reported write of 0 is charged like an unreported one (the uncached part as a write), and carries no flag');
});

test('T6: the settle through invoke(): a selected seat\'s reply with cached_tokens and no cache_write_tokens is recorded cacheCounts "write-not-reported", the read count as reported, and charged as costOf prices that shape', async () => {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'f'.repeat(40);
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'g', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100000, completion_tokens: 20, total_tokens: 100020, prompt_tokens_details: { cached_tokens: 60000 } } })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    chainNs.setCache(null); chainNs.setBudget(50);
    const st = await chainNs.runSingleStage({ provider: 'openrouter', model: 'openai/gpt-6-luna', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` }, { system: 's', user: 'u', label: 'cache-auto-t6', log: () => {} });
    assert.equal(st.usage.cacheRead, 60000);
    assert.equal(st.usage.cacheCounts, 'write-not-reported');
    assert.ok(near(st.usd, C.costOf('openrouter', 'openai/gpt-6-luna', st.usage).usd, 1e-9), `the stage is charged as costOf prices that shape: ${st.usd}`);
  } finally { chainNs.setBudget(null); srv.close(); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
});

// T7 (commit 8, C&C's review of the unit): T3 runs the settle path only with a reported write of 0, so a write priced on top of the input would not show in the settled usd or in the cap's running total. This one runs the real settle path with a reported write ABOVE zero and checks the figure against the table's own multiples, not against costOf.
test('T7: the settle through invoke() with a reported write ABOVE zero: the stage is charged the uncached part at the write multiple plus the read at the read multiple, the written tokens are not charged again, and the cap\'s running total moves by exactly that figure', async () => {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'a'.repeat(40);
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'g', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100000, completion_tokens: 20, total_tokens: 100020, prompt_tokens_details: { cached_tokens: 20000, cache_write_tokens: 30000 } } })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    chainNs.setCache(null); chainNs.setBudget(50);
    const before = chainNs.budgetState().spent;
    const st = await chainNs.runSingleStage({ provider: 'openrouter', model: 'openai/gpt-6-luna', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` }, { system: 's', user: 'u', label: 'cache-auto-t7', log: () => {} });
    assert.deepEqual([st.usage.input, st.usage.cacheRead, st.usage.cacheWrite, st.usage.cacheCounts], [80000, 20000, 30000, 'write-in-input'], 'the record: the read is taken off the prompt, the reported write is kept as reported and recorded as inside it');
    const r = SHIPPED['openrouter/openai/gpt-6-luna'], p = C.priceAt('openrouter', 'openai/gpt-6-luna', 100000);
    const readMult = Math.min(1, r.cache_read / Math.min(r.cache_basis_in ?? r.in, r.in));
    const want = (80000 / 1e6) * p.in * writeMultOfRow('openai/gpt-6-luna') + (20000 / 1e6) * p.in * readMult + (20 / 1e6) * p.out;
    assert.ok(near(st.usd, want, 1e-9), `the settled figure is the uncached part as a write plus the read: ${st.usd} vs ${want}`);
    assert.ok(!near(st.usd, want + (30000 / 1e6) * p.in * writeMultOfRow('openai/gpt-6-luna'), 1e-9), 'the reported write is not charged again on top');
    assert.ok(near(chainNs.budgetState().spent - before, st.usd, 1e-9), `the cap's running total moved by the stage's figure: ${chainNs.budgetState().spent - before} vs ${st.usd}`);
  } finally { chainNs.setBudget(null); srv.close(); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
});

// ---- M1..M3: the mode every reader sees is the ONE function's answer. Forced modes drive the readers, not the request (3b sends nothing new; whether a provider honours "off" is part (b)'s probe). ----
const readers = () => {
  const cfg = chainFile('plan-mini-council.json');
  const sum = maximum => C.estimateChainRows(cfg, { maximum }).reduce((t, r) => t + r.usd, 0);
  return { guard: C.worstCaseOf('openrouter', 'openai/gpt-6-luna', { promptChars: 400000, maxTokens: 1000 }).usd, stage: C.projectStage({ provider: 'openrouter', model: 'openai/gpt-6-luna', maxTokens: 1000 }, { system: 'x'.repeat(399996), user: 'yyyy' }),
    expected: sum(false), maximum: sum(true) };
};
const plainFigures = () => {
  const p = C.priceAt('openrouter', 'openai/gpt-6-luna', 100000);
  return (100000 / 1e6) * p.in + (1000 / 1e6) * p.out;
};
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the readers also included the advise quote (priceOfChain of the fixture advise-standard), and the test asserted "the advise quote: off equals none". NEW: the quote is not a reader. WHY: priceOfChain is removed with the add-on; the other four readers are unchanged.
test('M1 (NAMED PIN: passes on the parent, which has no auto premium; FAIL CONDITION: any reader of the mode - the guard, the stage projection, the dry run\'s two figures - prices an auto write premium when the mode says "off"): with caching OFF every reader returns the plain-input figure', () => {
  const FORCED = 'off';
  C.setCacheModeForTest?.(FORCED);
  const r = readers();
  assert.ok(near(r.guard, plainFigures()) && near(r.stage, plainFigures()), 'the guard and the stage projection are at the input price');
  C.setCacheModeForTest?.('none');
  const none = readers();
  for (const k of ['expected', 'maximum']) assert.ok(near(r[k], none[k], 1e-7), `${k}: off equals none`);
  C.setCacheModeForTest?.(FORCED);
  for (const row of C.estimateChainRows(chainFile('plan-mini-council.json'), { maximum: false }).filter(x => SELECTED6.includes(x.seat.slice('openrouter/'.length)))) {
    const id = row.seat.slice('openrouter/'.length), p = C.priceOf('openrouter', id);
    assert.ok(near(row.usd, (row.input / 1e6) * p.in + (row.output / 1e6) * p.out, 1e-7), `${row.label}: with caching off the row is at the input price`);
  }
});
test('M3 (NAMED PIN: passes on the parent; FAIL CONDITION: a reader prices an auto premium when the mode says "none"): the mode none is the plain input price in the guard and the stage projection', () => {
  C.setCacheModeForTest?.('none');
  const r = readers();
  assert.ok(near(r.guard, plainFigures()) && near(r.stage, plainFigures()));
});
test('M2: with the mode "explicit" on a selected OpenRouter seat the named head is priced at the ROW\'s write multiple (not Anthropic\'s lifetime table) and a read row at min(1, the row\'s read multiple); the tail at the input price', () => {
  C.setCacheModeForTest?.('explicit');
  const tokens = 100000, head = 60000, out = 1000;
  const p = C.priceAt('openrouter', 'openai/gpt-6-luna', tokens);
  const w = writeMultOfRow('openai/gpt-6-luna'), rd = Math.min(1, SHIPPED['openrouter/openai/gpt-6-luna'].cache_read / SHIPPED['openrouter/openai/gpt-6-luna'].cache_basis_in);
  const wr = C.worstCaseOf('openrouter', 'openai/gpt-6-luna', { promptChars: 400000, maxTokens: out, cache: { headTokens: head, ttl: '1h' } }).usd;
  assert.ok(near(wr, ((tokens - head) / 1e6) * p.in + (head / 1e6) * p.in * w + (out / 1e6) * p.out), `a write: ${wr}`);
  const rr = C.worstCaseOf('openrouter', 'openai/gpt-6-luna', { promptChars: 400000, maxTokens: out, cache: { headTokens: head, ttl: '1h', read: true } }).usd;
  assert.ok(near(rr, ((tokens - head) / 1e6) * p.in + (head / 1e6) * p.in * rd + (out / 1e6) * p.out), `a read: ${rr}`);
});
test('M4: with no override the mode of a selected seat is "auto" and the guard carries the premium (the default the three forced modes are measured against)', () => {
  assert.equal(C.cacheModeOf?.('openrouter', 'openai/gpt-6-luna'), 'auto');
  assert.equal(C.cacheModeOf?.('openrouter', 'openai/gpt-5.5'), 'none');
  assert.equal(C.cacheModeOf?.('openrouter', 'openai/gpt-6-luna', { cache: { headTokens: 1, ttl: '5m' } }), 'explicit');
  assert.equal(C.cacheModeOf?.('anthropic', 'claude-opus-5', { cache: { headTokens: 1, ttl: '5m' } }), 'explicit', 'the direct-Anthropic marker goes through the same function');
  assert.equal(C.cacheModeOf?.('anthropic', 'claude-opus-5'), 'none');
  assert.ok(C.worstCaseOf('openrouter', 'openai/gpt-6-luna', { promptChars: 400000, maxTokens: 1000 }).usd > plainFigures() + 1e-9);
});
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the last block priced the fixture advise-standard through priceOfChain with the mode auto and none, and asserted the difference equals the write share of every openrouter row. NEW: removed. WHY: priceOfChain is removed with the add-on; the guard and the dry run's rows, asserted above it, are the readers that stay.
test('M5: forcing the mode "auto" makes EVERY reader carry the write multiple of every priced seat\'s own row (1.25 where the row names none): the guard and the dry run\'s expected rows read the mode, not the selector (a reader that asks isAutoCacheWriteModel instead would add the premium for the six selected ids only)', () => {
  const wOf = id => Math.max(1, typeof SHIPPED[`openrouter/${id}`]?.cache_write === 'number' ? writeMultOfRow(id) : 1.25);   // an inferred write is never priced below the input price (cost.js autoWriteMultOf)
  C.setCacheModeForTest?.('auto');
  const glm = 'z-ai/glm-5.3-flash';
  const g = C.worstCaseOf('openrouter', glm, { promptChars: 400000, maxTokens: 1000 }).usd, pg = C.priceAt('openrouter', glm, 100000);
  assert.ok(near(g, (100000 / 1e6) * pg.in * wOf(glm) + (1000 / 1e6) * pg.out), `the guard carries the write for a non-selected seat when the mode says auto: ${g}`);
  for (const row of C.estimateChainRows(chainFile('plan-mini-council.json'), { maximum: false }).filter(x => x.seat.startsWith('openrouter/'))) {
    const id = row.seat.slice('openrouter/'.length), p = C.priceOf('openrouter', id);
    assert.ok(near(row.usd, (row.input / 1e6) * p.in * wOf(id) + (row.output / 1e6) * p.out, 1e-7), `${row.label} (${id}): the dry-run row follows the mode`);
  }
});
