// 0.8.4 cache part a (record honesty): an OpenAI-compatible call that reports cache counts is recorded the way a direct Anthropic call always was (input = the part of the prompt that was not read from a cache, the counts beside it),
// priced from them (src/cost.js costOf), summed into the run totals (summarise) and shown on the token line (tokensLine). Offline, $0. Namespace imports, so each assertion fails on its own on a tree without the behaviour. Written without a run (no tests on the laptop).
// CHANGED ACCEPTED (record meaning). OLD: `usage.input` of an OpenAI-compatible call was prompt_tokens, the whole prompt, and no cache count was recorded. NEW: when the host reports cached_tokens, input = prompt_tokens less cached_tokens, with cacheRead / cacheWrite
// beside it; cache_write_tokens is recorded as reported and not subtracted (the host's page does not say whether it is inside prompt_tokens; for a selected seat that sent no marker costOf counts it inside usage.input and it sets no price (commit 5); on any other row costOf prices it on top, which errs high). total stays input + output. WHY: a read costs the read price, and one field
// FIX 6 (10 Nov 2026, found by the paid cache test): for a call that SENT A CACHE MARKER (a Claude seat the route sent through OpenRouter) the write count IS subtracted too, because it was measured inside prompt_tokens (CR-30, CR-31); everything above holds for an unmarked call (CR-1 and the rows after it are unchanged).
// should mean one thing for both adapters. READERS: the stage log's tokensIn (cli.js), audit.js tokensIn, the two chain.js log lines (`N in`), src/ui/app.js (the `in` column), report.json totals.input, the token line (WORDING_0.8.4.md CACHE-A5).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/providers.js';
import * as C from '../src/cost.js';
import http from 'node:http';
import * as chainNs from '../src/chain.js';
import * as Held from '../src/held-roles.js';
import * as HC from './held-prompts/held-084-cache-order.js';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

afterEach(() => { chainNs.setBudget?.(null); chainNs.setCache?.(null); Held.setHeldForTest(null); });
const usageOf = u => P.usageOfOpenAICompat(u);
const close = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-12;
// Whether the SHIPPED row names a cache read price. Read from the table, not typed: the refresh script fills these fields, so a premise typed here ("no row names one") goes stale at the next fill (it did, at the first fill).
const root = new URL('..', import.meta.url).pathname;   // the repo root, for the spawned CLI of CR-18
const SHIPPED_ROWS = JSON.parse(readFileSync(new URL('../src/pricing.json', import.meta.url), 'utf8'));
const namesReadPrice = (provider, model) => typeof SHIPPED_ROWS[`${provider}/${model}`]?.cache_read === 'number';

test('CR-1: the READ count is split out of prompt_tokens: input is the part not read from the cache, cacheRead / cacheWrite sit beside it; the write count is recorded as reported and NOT subtracted (the host does not say whether it is inside prompt_tokens)', () => {
  const u = usageOf({ prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 100 } });
  assert.deepEqual(u, { input: 400, output: 50, thinking: 0, cacheRead: 600, cacheWrite: 100 });
});

test('CR-2: a count the host does not carry stays ABSENT; a zero it does carry is recorded as zero; a count that is not a whole number >= 0 counts as not carried', () => {
  assert.deepEqual(usageOf({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: {} }), { input: 1000, output: 50, thinking: 0 });
  assert.deepEqual(usageOf({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } }), { input: 1000, output: 50, thinking: 0, cacheRead: 0 });
  for (const bad of [-1, '5', 1.5, null, NaN]) assert.deepEqual(usageOf({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: bad, cache_write_tokens: bad } }), { input: 1000, output: 50, thinking: 0 }, String(bad));
});

test('CR-3: a read count that is MORE than the prompt is not used: the usage keeps the whole prompt as input, carries no cache count, and is marked unreadable; a write count above the prompt on its own is recorded as reported (it is not subtracted, so it cannot be impossible)', () => {
  const u = usageOf({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 150, cache_write_tokens: 30 } });
  assert.equal(u.input, 100);
  assert.equal('cacheRead' in u || 'cacheWrite' in u, false);
  assert.match(String(u.unreadable), /more than the prompt/);
  const w = usageOf({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cache_write_tokens: 150 } });
  assert.deepEqual([w.input, w.cacheWrite, 'unreadable' in w], [100, 150, false]);
});

test('CR-4: the thinking tokens the host leaves out of completion_tokens are still found from total_tokens (the whole prompt is subtracted there, not the uncached part)', () => {
  const u = usageOf({ prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1250, prompt_tokens_details: { cached_tokens: 600 } });
  assert.deepEqual([u.input, u.output, u.thinking, u.cacheRead], [400, 250, 200, 600]);
});

test('CR-5 (NAMED PIN: passes on the parent; FAIL CONDITION: a usage object with no prompt_tokens_details changes shape or value): a host that reports no cache details is recorded exactly as before', () => {
  assert.deepEqual(usageOf({ prompt_tokens: 100, completion_tokens: 77, total_tokens: 4177 }), { input: 100, output: 4077, thinking: 4000 });
  assert.deepEqual(usageOf({ prompt_tokens: 100, completion_tokens: 50 }), { input: 100, output: 50, thinking: 0 });
  assert.deepEqual(usageOf(undefined), { input: 0, output: 0, thinking: 0 });
});

test('CR-6: the input side of a call with cache counts: reads at the read multiple of the call\'s input price, writes at the write multiple; a read multiple above 1 counts as 1', () => {
  const f = (usage, p, pIn) => (typeof C.openAiCacheInputUsd === 'function' ? C.openAiCacheInputUsd(usage, p, pIn) : NaN);
  const usage = { input: 300, cacheRead: 600, cacheWrite: 100 };
  assert.ok(close(f(usage, { cacheReadMult: 0.1, cacheWriteMult: 1.25 }, 2), 300 * 2e-6 + 600 * 0.2e-6 + 100 * 2.5e-6));
  assert.ok(close(f(usage, { cacheReadMult: 3, cacheWriteMult: 1.25 }, 2), 300 * 2e-6 + 600 * 2e-6 + 100 * 2.5e-6), 'a read is never dearer than the input price');
  assert.ok(close(f(usage, { cacheReadMult: 0.1, cacheWriteMult: 0 }, 2), 300 * 2e-6 + 600 * 0.2e-6), 'an explicit cache_write of 0 is a free write');
});

test('CR-7: a price the row does not name is UNKNOWN, not free: with no cache multiples the three parts cost the input price each; a row that names a read price and no write price still prices the written tokens at the input price', () => {
  const usage = { input: 300, cacheRead: 600, cacheWrite: 100 };
  const f = typeof C.openAiCacheInputUsd === 'function' ? C.openAiCacheInputUsd(usage, {}, 2) : NaN;
  assert.ok(close(f, 1000 * 2e-6), String(f));
  const readOnly = typeof C.openAiCacheInputUsd === 'function' ? C.openAiCacheInputUsd(usage, { cacheReadMult: 0.1 }, 2) : NaN;
  assert.ok(close(readOnly, 300 * 2e-6 + 600 * 0.2e-6 + 100 * 2e-6), 'the written tokens cost the input price');
});

test('CR-8: costOf on real rows never prices a call with cache counts above the same call priced as a whole prompt, and never below it unless the row names a cache read price: equal when only reads are reported on a row that names none (an OpenRouter row, a direct openai row), strictly lower on a row that names one (also past its 272000 tier), and never below the reads-only figure when writes are reported on top', () => {
  for (const [provider, model, input, read] of [['openrouter', 'mistralai/mistral-medium-3-5', 400, 600], ['openrouter', 'mistralai/mistral-medium-3-5', 100000, 200000], ['openrouter', 'openai/gpt-6-luna', 400, 600], ['openrouter', 'openai/gpt-6-luna', 100000, 200000], ['openai', 'gpt-5', 400, 600]]) {
    const split = C.costOf(provider, model, { input, output: 50, cacheRead: read });
    const whole = C.costOf(provider, model, { input: input + read, output: 50 });
    assert.equal(split.priced, true);
    if (namesReadPrice(provider, model)) assert.ok(split.usd < whole.usd - 1e-12, `${provider}/${model} ${input}+${read}: the row names a read price, so the split call is cheaper: ${split.usd} vs ${whole.usd}`);
    else assert.ok(Math.abs(split.usd - whole.usd) < 1e-12, `${provider}/${model} ${input}+${read}: ${split.usd} vs ${whole.usd}`);
    const withWrite = C.costOf(provider, model, { input, output: 50, cacheRead: read, cacheWrite: 100 });
    // CHANGED (0.8.4 cache part a, 3b, 09 Nov 2026, C&C's per-field ruling). OLD: with a write count reported on top, the call is never below the reads-only figure. NEW: that holds for a seat that is not selected; on a SELECTED seat (OpenRouter, openai/ GPT 5.6 or later) the reads-only shape charges the uncached part as a write, so a REPORTED write of 100 tokens (a measurement) can sit below it, and the figure is checked against the formula instead. WHY: a write the host does not report is inferred at the page's 1.25x, a write it reports is priced as reported.
    // CHANGED AGAIN (commit 5, C&C 09 Nov 2026). OLD (3b): the selected-seat figure with a reported write of 100 was input x in + read x in x rm + 100 x in x wm. NEW: input x in x wm + read x in x rm, the write term gone: a reported write is inside usage.input and sets no price. WHY: see T2 in cache-auto-write.test.js.
    if (C.isAutoCacheWriteModel?.(provider, model)) {
      const rate = C.priceAt(provider, model, input + read), id = model, row = SHIPPED_ROWS[`${provider}/${id}`];
      const wm = row.cache_write / Math.min(row.cache_basis_in ?? row.in, row.in), rm = Math.min(1, row.cache_read / Math.min(row.cache_basis_in ?? row.in, row.in));
      assert.ok(Math.abs(withWrite.usd - ((input / 1e6) * rate.in * wm + (read / 1e6) * rate.in * rm + (50 / 1e6) * rate.out)) < 1e-9, `${provider}/${model} with a reported write: ${withWrite.usd}`);
    } else assert.ok(withWrite.usd >= split.usd - 1e-12, `${provider}/${model} with a write count: ${withWrite.usd} vs ${split.usd}`);
  }
  assert.equal(namesReadPrice('openrouter', 'mistralai/mistral-medium-3-5'), false, 'the premise row names no cache price (if the refresh ever fills one, swap the row)');
});

test('CR-9 (NAMED PIN: passes on the parent; FAIL CONDITION: a marked direct-Anthropic call is priced differently from the Anthropic formula): the Anthropic branch is untouched', () => {
  const u = { input: 1000, output: 100, cacheAsked: '1h', cacheRead: 5000, cacheWrite: 2000, cacheWrite1h: 2000 };
  const got = C.costOf('anthropic', 'claude-haiku-5-5', u);
  const rate = C.priceAt('anthropic', 'claude-haiku-5-5', 8000);
  const want = (1000 / 1e6) * rate.in + (5000 / 1e6) * rate.in * 0.1 + (2000 / 1e6) * rate.in * 2 + (100 / 1e6) * rate.out;
  assert.ok(Math.abs(got.usd - want) < 1e-12, `${got.usd} vs ${want}`);
});

// CHANGED (commit 4, C&C's second ruling 09 Nov 2026), TITLE ONLY. OLD: "summarise adds totals.cacheRead / cacheWrite only when a call used a cache (the sum is above zero)". NEW: "... only when a call that used a cache carried the count (a zero included; an unmarked call with only zeros used none)". WHY: the totals now keep a zero a cache-using call carried. The assertions are unchanged: they hold under both rules (the zeros in `none` are on an unmarked call).
test('CR-10: summarise adds totals.cacheRead / cacheWrite only when a call that used a cache carried the count (a zero included; an unmarked call with only zeros used none); total stays input + output; a run without a cache keeps the totals it always had, key for key', () => {
  const st = (usage) => ({ provider: 'openrouter', model: 'openai/gpt-6-luna', usage, usd: 0.01 });
  const none = C.summarise([st({ input: 100, output: 10 }), st({ input: 50, output: 5, cacheRead: 0, cacheWrite: 0 })]);
  assert.deepEqual(Object.keys(none).sort(), ['input', 'output', 'total', 'unpriced', 'usd']);
  const some = C.summarise([st({ input: 100, output: 10, cacheRead: 600, cacheWrite: 100 }), st({ input: 50, output: 5, cacheRead: 400 })]);
  assert.deepEqual([some.input, some.output, some.total, some.cacheRead, some.cacheWrite], [150, 15, 165, 1000, 100]);
});

test('CR-11: the token line is the one it always was in a run without a cache, and states the cache counts, with the sentence that the total leaves them out, in a run that used one', () => {
  const line = t => (typeof C.tokensLine === 'function' ? C.tokensLine(t) : undefined);
  assert.equal(line({ input: 5, output: 3, total: 8 }), '5 in, 3 out, 8 total');
  // CHANGED (commit 4, C&C's second ruling 09 Nov 2026). OLD: a hand-made totals object `{ cacheRead: 0 }` -> '5 in, 3 out, 8 total'. NEW: the totals carry a count whenever a call that used a cache carried it, a zero included, so `{ cacheRead: 0 }` is now a count and the line says so; the unchanged case is a call that used NO cache (an unmarked call with only zeros), asserted through summarise below. WHY: the line follows the totals, and the totals now tell a measured zero from no caching.
  const unmarkedZeros = C.summarise([{ provider: 'openrouter', model: 'mistralai/mistral-medium-3-5', usage: { input: 5, output: 3, cacheRead: 0 }, usd: 0.01 }]);
  assert.equal(line(unmarkedZeros), '5 in, 3 out, 8 total');
  assert.equal(line({ input: 5, output: 3, total: 8, cacheRead: 40, cacheWrite: 7 }), '5 in, 40 read from the cache, 7 written to the cache, 3 out, 8 total (the total leaves out the cache counts)');
  // CHANGED (0.8.4 cache part a, commit 4, C&C's ruling 09 Nov 2026). OLD: `{ cacheRead: 40 }` -> '... 40 read from the cache, 0 written to the cache ...' for a run whose calls reported NO write count. NEW: that run's totals carry cacheNotReported ['write'] (summarise) and the line says 'write count not reported'; the 0 is printed only when every call that used a cache reported the write count (a reported zero). WHY: the line must never print a count the reply did not carry; summarise leaves a zero total out, so the totals field is what tells a reported zero from an absent count.
  const st = (usage) => ({ provider: 'openrouter', model: 'mistralai/mistral-medium-3-5', usage: { input: 5, output: 3, ...usage }, usd: 0.01 });
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the token line said '<field> count not reported' (read or write). NEW: 'cache <field> count not reported'. WHY: the reviewed text of src/cost.js:308 (RESOLVED_LIST: `cache ${field} count not reported`), applied in commit 1; every assertion of this file that prints a not-reported count moves with it.
  assert.equal(line(C.summarise([st({ cacheRead: 40 })])), '5 in, 40 read from the cache, cache write count not reported, 3 out, 8 total (the total leaves out the cache counts)');
  assert.equal(line(C.summarise([st({ cacheRead: 40, cacheWrite: 0 })])), '5 in, 40 read from the cache, 0 written to the cache, 3 out, 8 total (the total leaves out the cache counts)');
});

// ---- through the real adapter and invoke() with a local stub server (the pattern of test/provider-reported.test.js): an OpenRouter seat whose reply carries cache counts ----
function stub(handler) {
  const seen = []; const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { seen.push(1); handler(seen.length, req, res); }); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}
const PRICED = { provider: 'openrouter', model: 'openai/gpt-6-luna', maxTokens: 500 };
const stageWithUsage = async usage => {
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'c'.repeat(40);
  const s = await stub((n, req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'gen-x', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage })); });
  try {
    chainNs.setCache(null); chainNs.setBudget(50);
    return await chainNs.runSingleStage({ ...PRICED, baseUrl: s.url }, { system: 's', user: 'u', label: 'cache-record', log: () => {} });
  } finally { chainNs.setBudget(null); s.srv.close(); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
};

test('CR-12: usage the cap cannot read is carried to the stage: a read count above the prompt makes readUsage report it, and a settled line through invoke() is one attempt\'s worst case (basis worst_case), not a figure built on the count', async () => {
  const bad = usageOf({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 150 } });
  assert.ok(C.readUsage(bad).unreadable, 'readUsage carries the mark');
  const st = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 150 } });
  assert.equal(st.basis, 'worst_case');
  assert.ok(st.usd > C.costOf('openrouter', 'openai/gpt-6-luna', { input: 100, output: 20 }).usd, 'one attempt\'s worst case is more than the measured figure');
});

test('CR-13: a settled line with cache-read tokens is priced from the counts: the stage records input, cacheRead and cacheWrite, and its dollars equal costOf of that usage (a row that names a cache read price: below the whole prompt; one that names none: the same)', async () => {
  const st = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 0 } });
  assert.deepEqual([st.usage.input, st.usage.cacheRead, st.usage.cacheWrite], [20, 80, 0]);
  assert.equal(st.basis, 'token_priced');
  const want = C.costOf('openrouter', 'openai/gpt-6-luna', st.usage).usd;
  assert.ok(Math.abs(st.usd - want) < 1e-12, `${st.usd} vs ${want}`);
  const whole = C.costOf('openrouter', 'openai/gpt-6-luna', { input: 100, output: 20 }).usd;
  if (namesReadPrice('openrouter', 'openai/gpt-6-luna')) assert.ok(want < whole - 1e-12, 'the row names a cache read price: below the whole prompt');
  else assert.ok(Math.abs(want - whole) < 1e-12, 'no cache price on the row: the same as the whole prompt');
});

// ---- 0.8.4 cache part a, commit 4 (C&C 09 Nov 2026): the direction of CR-8 on a selected seat, and the token line that never prints a count the reply did not carry ----
const tl = t => (typeof C.tokensLine === 'function' ? C.tokensLine(t) : undefined);   // tokensLine does not exist on the parent: a missing export is a value (undefined) the assertions fail on, not a throw
const SELECTED_ROWS = [['openrouter', 'openai/gpt-6-luna'], ['openrouter', 'openai/gpt-6.1-terra']];   // typed on purpose, not read through isAutoCacheWriteModel: on the parent that function does not exist and a guard on it would make the test pass for nothing
const READ_MULT = { 'openai/gpt-6-luna': 0.1, 'openai/gpt-6.1-terra': 0.05 };   // the read multiples of the two shipped rows (luna 0.1 x, terra 0.05 x); the premise check at the end of CR-14 fails visibly if a refresh changes them
const PROMPT_UNCACHED = 10000, PROMPT_READ = 2000;   // both prompts below stay far from the 272000 tier, so net and stacked shapes sit in the same tier

// CHANGED (commit 5, C&C's ruling 09 Nov 2026). OLD CR-14: on the NET shape (input = prompt - read - write) the reads-only figure is never below the figure with a reported write, strictly above a reported zero, equal at the whole uncached part. NEW: the shape the adapter records (input = prompt - read, the write inside it) is priced by one rule for EVERY write count the reply could report, a zero included: the uncached part at the write multiple, the read part at the read multiple, so never below that figure and equal to the figure with the read count alone. WHY: THC counts every uncached prompt token as a write whatever the reply reports; the old strict assertion (an absent write prices above a reported zero) now fails by design.
test('CR-14: on a selected seat that sent no marker the settled figure of a call is the write-multiple shape for every write count its reply could report, up to the whole uncached part and a reported zero included: the uncached part at the row\'s write multiple plus the read part at its read multiple, never below it, and equal to the figure with the read count alone', () => {
  for (const [provider, model] of SELECTED_ROWS) {
    const wm = 1.25, rm = READ_MULT[model];   // typed from the table; the premise check at the end of this test makes a refresh that changes them fail visibly
    const rate = C.priceAt(provider, model, PROMPT_UNCACHED + PROMPT_READ);
    const expected = (PROMPT_UNCACHED / 1e6) * rate.in * wm + (PROMPT_READ / 1e6) * rate.in * rm + (50 / 1e6) * rate.out;
    const readsOnly = C.costOf(provider, model, { input: PROMPT_UNCACHED, output: 50, cacheRead: PROMPT_READ });
    for (const w of [0, 500, 2000, 5000, PROMPT_UNCACHED]) {
      const reported = C.costOf(provider, model, { input: PROMPT_UNCACHED, output: 50, cacheRead: PROMPT_READ, cacheWrite: w });
      assert.ok(close(reported.usd, expected), `${model}: a reported write of ${w} settled away from the rule\'s figure: ${reported.usd} vs ${expected}`);
      assert.ok(close(reported.usd, readsOnly.usd), `${model}: a reported write of ${w} moved the figure: ${reported.usd} vs ${readsOnly.usd}`);
    }
    const row = SHIPPED_ROWS[`${provider}/${model}`], basis = Math.min(row.cache_basis_in ?? row.in, row.in);
    assert.ok(close(row.cache_write / basis, wm) && close(Math.min(1, row.cache_read / basis), rm), `premise: the ${model} row names a write at ${wm} x and a read at ${rm} x its input price`);
  }
});

// CHANGED (commit 5). OLD CR-15 (named pin): the stacked shape costs exactly write x the input price more than the net shape. NEW: the pin is the independence itself: a write count reported on top of the same input and read does not move the figure. WHY: see CR-14. On the parent the pin passes for another reason (the parent ignores every cache count).
test('CR-15 (NAMED PIN: passes on the parent; FAIL CONDITION: a write count the reply reports moves the figure of a selected seat that sent no marker, that is the write is priced again on top of the input; LIMIT: on the parent it passes because the parent ignores all cache counts, so only the tip tests the rule): the same input and read with a reported write of any size cost exactly the same as with none', () => {
  for (const [provider, model] of SELECTED_ROWS) {
    const base = C.costOf(provider, model, { input: PROMPT_UNCACHED, output: 50, cacheRead: PROMPT_READ, cacheWrite: 0 });
    for (const w of [500, 2000, 5000, PROMPT_UNCACHED]) assert.ok(close(C.costOf(provider, model, { input: PROMPT_UNCACHED, output: 50, cacheRead: PROMPT_READ, cacheWrite: w }).usd, base.usd), `${model} write ${w}`);
  }
});

test('CR-16: a stage the way the real path records it feeds the totals and the token line: a selected seat whose reply carried no cache counts is "unknown" (neither count reported), one that carried a read count only is "write-not-reported"; the line prints "not reported" for the missing count, never 0, and says "(where reported)" next to a total that adds up only some calls', async () => {
  const unknown = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
  assert.equal(unknown.usage.cacheCounts, 'unknown');
  const readOnly = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 } });
  assert.equal(readOnly.usage.cacheCounts, 'write-not-reported');
  const both = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 } });
  assert.equal(both.usage.cacheCounts, 'write-in-input');   // CHANGED (commit 5): OLD undefined (a reported count carried no flag); NEW the record says the reported write did not set the price (see CR-26)
  const st = x => ({ provider: PRICED.provider, model: PRICED.model, ...x });
  const one = C.summarise([st(unknown)]);
  assert.deepEqual(one.cacheNotReported, ['read', 'write']);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the token line said '<field> count not reported' (read or write). NEW: 'cache <field> count not reported'. WHY: the reviewed text of src/cost.js:308 (RESOLVED_LIST: `cache ${field} count not reported`), applied in commit 1; every assertion of this file that prints a not-reported count moves with it.
  assert.equal(tl(one), `${one.input} in, cache read count not reported, cache write count not reported, ${one.output} out, ${one.total} total (the total leaves out the cache counts)`);
  const two = C.summarise([st(readOnly)]);
  assert.deepEqual(two.cacheNotReported, ['write']);
  assert.equal(tl(two), `${two.input} in, 40 read from the cache, cache write count not reported, ${two.output} out, ${two.total} total (the total leaves out the cache counts)`);
  const mixed = C.summarise([st(readOnly), st(both)]);
  assert.deepEqual(mixed.cacheNotReported, ['write']);
  assert.equal(tl(mixed), `${mixed.input} in, 80 read from the cache, 10 written to the cache (where reported), ${mixed.output} out, ${mixed.total} total (the total leaves out the cache counts)`);
  const allReported = C.summarise([st(both)]);
  assert.equal(allReported.cacheNotReported, undefined);
  assert.equal(tl(allReported), `${allReported.input} in, 40 read from the cache, 10 written to the cache, ${allReported.output} out, ${allReported.total} total (the total leaves out the cache counts)`);
});

test('CR-17: a call that used a prompt cache (a count above zero, a marker, or a recorded inferred write) and left a cache count out is "not reported" for that count; a call that carried no cache field, or only zeros and no marker, used none and is never a miss; a count reported as zero is a measurement', () => {
  const m = (usage, model = 'claude-haiku-5-5') => ({ provider: 'anthropic', model, usage: { input: 10, output: 5, ...usage }, usd: 0.001 });
  assert.deepEqual(C.summarise([m({ cacheAsked: '5m', cacheRead: 30 })]).cacheNotReported, ['write']);
  assert.deepEqual(C.summarise([m({ cacheAsked: '1h', cacheWrite: 30 })]).cacheNotReported, ['read']);
  assert.deepEqual(C.summarise([m({ cacheAsked: '1h' })]).cacheNotReported, ['read', 'write'], 'a marked call with no counts at all');
  assert.deepEqual(C.summarise([m({ cacheRead: 30 })]).cacheNotReported, ['write'], 'an unmarked call that read from a cache and reported no write count');
  assert.equal(C.summarise([m({ cacheAsked: '5m', cacheRead: 30, cacheWrite: 0 })]).cacheNotReported, undefined, 'a reported zero is a measurement');
  assert.equal(C.summarise([m({})]).cacheNotReported, undefined);
  assert.equal(C.summarise([m({ cacheRead: 0 })]).cacheNotReported, undefined, 'a zero read count alone used no cache');
  assert.equal(C.summarise([m({ cacheRead: 0, cacheWrite: 0 })]).cacheNotReported, undefined);
});

test('CR-18 (NAMED PIN: passes on the parent; FAIL CONDITION: a run without caching gets a cache key in its totals or a different token line): a real mock stage, summarised, keeps the totals keys and the token line it always had', async () => {
  chainNs.setCache(null);
  const st = await chainNs.runSingleStage({ provider: 'mock', model: 'mock-priced', maxTokens: 500 }, { system: 's', user: 'u', label: 'cache-record-mock', log: () => {} });
  const t = C.summarise([{ provider: 'mock', model: 'mock-priced', ...st }]);
  assert.deepEqual(Object.keys(t).sort(), ['input', 'output', 'total', 'unpriced', 'usd']);
  if (typeof C.tokensLine === 'function') assert.equal(C.tokensLine(t), `${t.input} in, ${t.output} out, ${t.total} total`);   // tokensLine exists only from d75e3fb8: on the parent the real CLI half below checks the same line
  // CHANGED (commit 4, C&C's second ruling 09 Nov 2026). OLD: a totals object `{ cacheRead: 0, cacheWrite: 0 }` gives the base line. NEW: that object is a count a cache-using call carried; the unchanged case is an UNMARKED call that carries only zeros (it used no cache), through summarise. WHY: the totals now keep a measured zero.
  const zeros = C.summarise([{ provider: 'anthropic', model: 'claude-haiku-5-5', usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0 }, usd: 0.01 }]);
  assert.deepEqual(Object.keys(zeros).sort(), ['input', 'output', 'total', 'unpriced', 'usd']);
  if (typeof C.tokensLine === 'function') assert.equal(C.tokensLine(zeros), '5 in, 3 out, 8 total');
  // The real CLI on the shipped offline chain: the `tokens:` line both trees print has no cache part. $0, no keys; the run folder is a temp directory.
  const dir = mkdtempSync(join(tmpdir(), 'cr18-'));
  try {
    mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const run = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'mock', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.match(run.stdout + run.stderr, /^tokens: +\d+ in, \d+ out, \d+ total$/m, `exit ${run.status}: ${(run.stdout + run.stderr).slice(-400)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CR-19 (NAMED PIN: passes on the parent for the keys it knows; FAIL CONDITION: readUsage drops cacheAsked or cacheCounts, so a resumed run\'s totals and token line differ from the first sitting): the usage a replayed stage is read back with keeps cacheAsked and cacheCounts', () => {
  const u = C.readUsage({ input: 10, output: 5, cacheAsked: '5m', cacheRead: 3, cacheCounts: 'write-not-reported' }).usage;
  assert.equal(u.cacheAsked, '5m');
  assert.equal(u.cacheCounts, 'write-not-reported');
  assert.equal(C.readUsage({ input: 10, output: 5, cacheCounts: 'unknown' }).usage.cacheCounts, 'unknown');
  assert.equal(C.readUsage({ input: 10, output: 5, cacheRead: 3, cacheWrite: 2, cacheCounts: 'write-in-input' }).usage.cacheCounts, 'write-in-input');   // the third value passes through unvalidated (commit 5)
  // A count the saved usage does not hold stays absent (never 0) through the replay, so a resumed run's cacheNotReported is the first sitting's (a reported 0 staying 0 is pinned by the readUsage test of prompt-cache-money.test.js).
  const absent = C.readUsage({ input: 10, output: 5, cacheAsked: '5m' }).usage;
  assert.equal('cacheRead' in absent, false);
  assert.equal('cacheWrite' in absent, false);
});

  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the token line said '<field> count not reported' (read or write). NEW: 'cache <field> count not reported'. WHY: the reviewed text of src/cost.js:308 (RESOLVED_LIST: `cache ${field} count not reported`), applied in commit 1; every assertion of this file that prints a not-reported count moves with it.
test('CR-20: the token line states a count no cache-using call carried as "<field> count not reported", never as 0; a count some of them left out prints its sum with "(where reported)", a zero sum included; a count every one carried prints as it is, a zero included', () => {
  const line = t => tl(t);
  assert.equal(line({ input: 5, output: 3, total: 8, cacheRead: 40, cacheNotReported: ['write'] }), '5 in, 40 read from the cache, cache write count not reported, 3 out, 8 total (the total leaves out the cache counts)');
  assert.equal(line({ input: 5, output: 3, total: 8, cacheNotReported: ['read', 'write'] }), '5 in, cache read count not reported, cache write count not reported, 3 out, 8 total (the total leaves out the cache counts)');
  assert.equal(line({ input: 5, output: 3, total: 8, cacheRead: 40, cacheWrite: 7, cacheNotReported: ['write'] }), '5 in, 40 read from the cache, 7 written to the cache (where reported), 3 out, 8 total (the total leaves out the cache counts)');
  // CHANGED (commit 4, C&C's second ruling 09 Nov 2026). OLD: `{ cacheRead: 40 }` with no cacheNotReported -> '... 0 written to the cache ...'. NEW: a count the totals do not hold is never printed as 0: '... write count not reported ...'; the 0 is printed when the totals hold it. WHY: the same line rule as CR-11.
  assert.equal(line({ input: 5, output: 3, total: 8, cacheRead: 40 }), '5 in, 40 read from the cache, cache write count not reported, 3 out, 8 total (the total leaves out the cache counts)');
  assert.equal(line({ input: 5, output: 3, total: 8, cacheRead: 40, cacheWrite: 0 }), '5 in, 40 read from the cache, 0 written to the cache, 3 out, 8 total (the total leaves out the cache counts)');
  assert.equal(line({ input: 5, output: 3, total: 8, cacheRead: 0, cacheWrite: 0, cacheNotReported: ['read'] }), '5 in, 0 read from the cache (where reported), 0 written to the cache, 3 out, 8 total (the total leaves out the cache counts)');
});

test('CR-21: a run whose cache-using calls all report cacheWrite 0 prints "0 written to the cache"; a run whose calls report no write count prints no write figure (C&C 09 Nov 2026)', () => {
  const st = (usage) => ({ provider: 'openrouter', model: 'mistralai/mistral-medium-3-5', usage: { input: 5, output: 3, ...usage }, usd: 0.01 });
  const reportedZero = C.summarise([st({ cacheRead: 40, cacheWrite: 0 }), st({ cacheRead: 10, cacheWrite: 0 })]);
  assert.equal(reportedZero.cacheNotReported, undefined);
  assert.match(tl(reportedZero), /50 read from the cache, 0 written to the cache,/);
  const absent = C.summarise([st({ cacheRead: 40 }), st({ cacheRead: 10 })]);
  assert.deepEqual(absent.cacheNotReported, ['write']);
  assert.match(tl(absent), /50 read from the cache, cache write count not reported,/);
  assert.doesNotMatch(tl(absent), /written to the cache/);
});

test('CR-22 (C&C 09 Nov 2026, second ruling): among the calls that USED a cache, a count every one carried prints, a zero included: a marked call whose reply reads 0 and 0 gives totals that hold both zeros and a line that says "0 read from the cache, 0 written to the cache"; a marked call with no counts at all is "not reported" for both', () => {
  const m = (usage) => ({ provider: 'anthropic', model: 'claude-haiku-5-5', usage: { input: 10, output: 5, ...usage }, usd: 0.001 });
  const t = C.summarise([m({ cacheAsked: '5m', cacheRead: 0, cacheWrite: 0 })]);
  assert.equal(t.cacheRead, 0);
  assert.equal(t.cacheWrite, 0);
  assert.equal(t.cacheNotReported, undefined);
  assert.equal(tl(t), '10 in, 0 read from the cache, 0 written to the cache, 5 out, 15 total (the total leaves out the cache counts)');
  const none = C.summarise([m({ cacheAsked: '5m' })]);
  assert.equal('cacheRead' in none || 'cacheWrite' in none, false);
  assert.equal(tl(none), '10 in, cache read count not reported, cache write count not reported, 5 out, 15 total (the total leaves out the cache counts)');
});

test('CR-23 (C&C 09 Nov 2026, second ruling): when only SOME cache-using calls carried a count, the sum prints with "(where reported)", a zero sum included; the mixed case of one call that reported 0 and one that did not', () => {
  const m = (usage) => ({ provider: 'anthropic', model: 'claude-haiku-5-5', usage: { input: 10, output: 5, ...usage }, usd: 0.001 });
  const t = C.summarise([m({ cacheAsked: '5m', cacheRead: 0, cacheWrite: 0 }), m({ cacheAsked: '5m', cacheWrite: 20 })]);
  assert.deepEqual(t.cacheNotReported, ['read']);
  assert.equal(t.cacheRead, 0);
  assert.equal(t.cacheWrite, 20);
  assert.equal(tl(t), '20 in, 0 read from the cache (where reported), 20 written to the cache, 10 out, 30 total (the total leaves out the cache counts)');
});

test('CR-24 (NAMED PIN: passes on the parent; FAIL CONDITION: a call that used no cache, an unmarked call whose reply carries only zeros, changes the totals keys or the token line): an unmarked call reading 0 and 0, on a selected OpenRouter seat and on an Anthropic seat, stays silent', () => {
  for (const [provider, model] of [['openrouter', 'openai/gpt-6-luna'], ['anthropic', 'claude-haiku-5-5']]) {
    const t = C.summarise([{ provider, model, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, usd: 0.001 }]);
    assert.deepEqual(Object.keys(t).sort(), ['input', 'output', 'total', 'unpriced', 'usd'], model);
    if (typeof C.tokensLine === 'function') assert.equal(C.tokensLine(t), '10 in, 5 out, 15 total', model);   // tokensLine does not exist on the parent: there the keys above are the whole pin
  }
});

test('CR-25: the price tier follows the prompt\'s real size: a selected seat that sent no marker, with a prompt just under luna\'s 272000 step and the whole uncached part reported as written, is priced at the base row (a write that lies inside the prompt adds nothing to the size)', () => {
  const READ = 100000, INPUT = 170000, STEP = 272000;   // prompt = 270000, under the step; input + read + write would be 440000
  const base = C.priceAt('openrouter', 'openai/gpt-6-luna', READ + INPUT), past = C.priceAt('openrouter', 'openai/gpt-6-luna', READ + INPUT + INPUT);
  assert.ok(READ + INPUT < STEP && past.in > base.in, 'premise: the write counted twice would cross the step and cost more');
  for (const w of [0, 50000, INPUT]) {
    const got = C.costOf('openrouter', 'openai/gpt-6-luna', { input: INPUT, output: 0, cacheRead: READ, cacheWrite: w });
    const want = (INPUT / 1e6) * base.in * 1.25 + (READ / 1e6) * base.in * 0.1;
    assert.ok(close(got.usd, want), `write ${w}: ${got.usd} vs the base-row figure ${want}`);
  }
});

test('CR-26: the record shows when a reported write count did not set the price: a selected seat that sent no marker and reported a write count (a zero included) is recorded cacheCounts "write-in-input", with cacheWrite as reported; the totals and the token line treat such a call by its counts alone (a reported 0 and 0 stays silent), and a seat that is not selected carries no such value', async () => {
  const withZero = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } });
  assert.equal(withZero.usage.cacheCounts, 'write-in-input');
  assert.equal(withZero.usage.cacheWrite, 0);
  const withWrite = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 30 } });
  assert.equal(withWrite.usage.cacheCounts, 'write-in-input');
  assert.equal(withWrite.usage.cacheWrite, 30);
  const st = x => ({ provider: PRICED.provider, model: PRICED.model, ...x });
  const silent = C.summarise([st(withZero)]);
  assert.deepEqual(Object.keys(silent).sort(), ['input', 'output', 'total', 'unpriced', 'usd'], 'a reported 0 and 0 on a call that used no cache stays silent');
  const counted = C.summarise([st(withWrite)]);
  assert.equal(counted.cacheNotReported, undefined);
  assert.equal(counted.cacheWrite, 30);
  // The line is true for such a call: the written tokens sit inside usage.input, so the total leaves them out of `input` (60 - 30 = 30) and "in", "read" and "written" do not overlap.
  assert.equal(counted.input, 30);
  assert.equal(counted.total, 50);
  assert.equal(tl(counted), '30 in, 40 read from the cache, 30 written to the cache, 20 out, 50 total (the total leaves out the cache counts)');
  assert.equal(C.costOf('openrouter', 'openai/gpt-5.5', { input: 60, output: 20, cacheRead: 40, cacheWrite: 30 }).cacheWriteInInput, undefined, 'a seat that is not selected prices a reported write as before and carries no flag');
});

test('CR-27: the relation between the stages and the totals is pinned: totals.input is the sum of the stages\' usage.input less the cacheWrite of the calls recorded "write-in-input" (typed here: 60 + 100 + 60 + 60 - 30 - 0 = 250), and a call to another OpenAI-compatible model that reports a write keeps it inside input', async () => {
  const ordinary = { provider: 'openrouter', model: 'openai/gpt-5.5', usage: { input: 100, output: 5 }, usd: 0.01 };
  const withWrite = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 30 } });
  const withZero = await stageWithUsage({ prompt_tokens: 60, completion_tokens: 20, total_tokens: 80, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } });
  const other = { provider: 'openrouter', model: 'openai/gpt-5.5', usage: { input: 60, output: 20, cacheRead: 40, cacheWrite: 30 }, usd: 0.01 };   // not a selected seat: no cacheCounts, the write stays inside input
  const st = x => ({ provider: PRICED.provider, model: PRICED.model, ...x });
  const stages = [ordinary, st(withWrite), st(withZero), other];
  assert.deepEqual([withWrite.usage.input, withWrite.usage.cacheCounts, withZero.usage.input, withZero.usage.cacheCounts], [60, 'write-in-input', 60, 'write-in-input']);
  const t = C.summarise(stages);
  assert.equal(t.input, 250);
  const sum = stages.reduce((n, s) => n + s.usage.input, 0), written = stages.filter(s => s.usage.cacheCounts === 'write-in-input').reduce((n, s) => n + (s.usage.cacheWrite ?? 0), 0);
  assert.equal(t.input, sum - written, 'totals.input = the sum of the stages minus the written tokens of the write-in-input calls');
  assert.equal(t.total, t.input + t.output);
});

test('CR-28 (NAMED PIN: passes on the parent, which records no cache field, so both sittings agree trivially; FAIL CONDITION: readUsage drops cacheCounts, cacheWrite or cacheRead, so a resumed run\'s totals or token line differ from the first sitting\'s; LIMIT: on the parent only the equality of two cache-free summaries is checked): totals summarised from stages read back from disk equal the first sitting\'s: cacheCounts and cacheWrite survive readUsage, so a resumed run reports the same input, cache counts and line', async () => {
  const withWrite = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 30 } });
  const readOnly = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 } });
  const unknown = await stageWithUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
  const st = x => ({ provider: PRICED.provider, model: PRICED.model, ...x });
  const first = [st(withWrite), st(readOnly), st(unknown)];
  const replayed = first.map(s => ({ ...s, usage: C.readUsage(JSON.parse(JSON.stringify(s.usage))).usage }));
  assert.deepEqual(C.summarise(replayed), C.summarise(first));
  assert.equal(tl(C.summarise(replayed)), tl(C.summarise(first)));
});

// CR-29 (commit 8, C&C's review of the unit): the clamp. The relation "totals.input = the sum of the stages' usage.input less the written tokens of the write-in-input calls" is stated in the report schema, docs/report-format.md and the CHANGELOG with the clause "each such call taking off at most its own usage.input"; no test reached the clause (CR-27 types a write smaller than the input).
test('CR-29: a write-in-input call that reports a write LARGER than its own usage.input takes off at most its own input: totals.input never goes negative, no other call gives up tokens for it, and the written count is still reported as it was', () => {
  const mk = (input, extra) => ({ provider: 'openrouter', model: 'openai/gpt-6-luna', usage: { input, output: 5, ...extra }, usd: 0.01 });
  const big = mk(40, { cacheRead: 10, cacheWrite: 70, cacheCounts: 'write-in-input' });
  const small = mk(60, { cacheRead: 0, cacheWrite: 10, cacheCounts: 'write-in-input' });
  const plain = mk(100, {});
  assert.equal(C.summarise([big]).input, 0, 'a write of 70 on an input of 40 takes off 40, not 70');
  const t = C.summarise([big, small, plain]);
  assert.equal(t.input, 0 + 50 + 100, 'each call takes off at most its own input: 0 + (60 - 10) + 100');
  assert.ok(t.input >= 0);
  assert.equal(t.total, t.input + t.output, 'total is input plus output');
  assert.equal(t.cacheWrite, 80, 'the written tokens are summed as reported (70 + 10), not clamped');
  assert.equal(C.summarise([plain, big]).input, 100, 'the larger write takes nothing off the other call');
});

// ---- FIX 6 (C&C 10 Nov 2026): a routed Claude WRITE call's written tokens are charged once. The fixtures are the raw usage objects of the paid cache test (Claude Haiku 5.5 through OpenRouter, host Google / Amazon Bedrock, 10 Nov 2026), copied unchanged. ----
const WRITE_CALL = { prompt_tokens: 7677, completion_tokens: 62, total_tokens: 7739, cost: 0.000990275, is_byok: false, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 7663, audio_tokens: 0, video_tokens: 0 }, cost_details: { upstream_inference_cost: 0.000990275, upstream_inference_prompt_cost: 0.000959275, upstream_inference_completions_cost: 3.1e-05 }, completion_tokens_details: { reasoning_tokens: 58, image_tokens: 0, audio_tokens: 0 } };
const READ_CALL = { prompt_tokens: 7677, completion_tokens: 81, total_tokens: 7758, cost: 0.00011853, is_byok: false, prompt_tokens_details: { cached_tokens: 7663, cache_write_tokens: 0, audio_tokens: 0, video_tokens: 0 }, cost_details: { upstream_inference_cost: 0.00011853, upstream_inference_prompt_cost: 7.803e-05, upstream_inference_completions_cost: 4.05e-05 }, completion_tokens_details: { reasoning_tokens: 77, image_tokens: 0, audio_tokens: 0 } };
const HAIKU = 'anthropic/claude-haiku-5.5';
// what the row prices a call of the write pair at when the write is counted ONCE: the 14 uncached tokens at the input price, the 7,663 written tokens at the write multiple (cache_write / min(basis, in), never below 1.25) and the 62 output tokens (derived from the shipped row, not typed)
const ONCE = (() => { const r = SHIPPED_ROWS[`openrouter/${HAIKU}`]; const w = Math.max(1.25, r.cache_write / Math.min(r.cache_basis_in, r.in)); return (14 * r.in + 7663 * r.in * w + 62 * r.out) / 1e6; })();

test('CR-30 FIX 6: on a call that sent a marker the written tokens leave `input` (measured inside prompt_tokens), so the write is charged once; the read call, the unmarked call and an impossible count are as before', () => {
  const marked = P.usageOfOpenAICompat(WRITE_CALL, { marked: true });
  assert.deepEqual(marked, { input: 14, output: 62, thinking: 58, cacheRead: 0, cacheWrite: 7663 }, 'the write call: 14 uncached tokens, 7,663 written, counted once');
  assert.equal(marked.input + marked.cacheRead + marked.cacheWrite, WRITE_CALL.prompt_tokens, 'input + read + write is the prompt, as for a direct Anthropic call');
  const usd = C.costOf('openrouter', HAIKU, { ...marked, cacheAsked: '5m' }).usd;
  assert.ok(close(usd, ONCE), `the marked write call is priced once: ${usd} against ${ONCE} (the real call, as THC counted it before the fix, was 0.0096611625)`);
  assert.deepEqual(P.usageOfOpenAICompat(READ_CALL, { marked: true }), { input: 14, output: 81, thinking: 77, cacheRead: 7663, cacheWrite: 0 }, 'the read call is the same marked or not');
  assert.deepEqual(P.usageOfOpenAICompat(READ_CALL), { input: 14, output: 81, thinking: 77, cacheRead: 7663, cacheWrite: 0 });
  assert.equal(P.usageOfOpenAICompat(WRITE_CALL).input, 7677, 'an UNMARKED call keeps the write inside input, as before (the selected OpenAI seats count a reported write inside it)');
  const impossible = P.usageOfOpenAICompat({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 60 } }, { marked: true });
  assert.match(String(impossible.unreadable), /read and write counts are more than the prompt/, 'a read plus a write above the prompt is unreadable, not a negative input');
  assert.equal(impossible.input, 100);
});

test('CR-31 FIX 6: through the real path (a routed Claude seat, a marked call, the cap armed) a reply with the paid test\'s write usage is recorded and priced with the write counted once', async () => {
  Held.setHeldForTest({ ...HC });
  const real = globalThis.fetch, key = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-test-dummy-key';
  globalThis.fetch = async () => new Response(JSON.stringify({ model: HAIKU, provider: 'Google', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: WRITE_CALL }), { status: 200 });
  try {
    chainNs.setCache(null); chainNs.setBudget(5);
    const HEAD = 'A generic shared beginning for the record test.\n';
    const stage = await chainNs.runSingleStage({ provider: 'openrouter', originalProvider: 'anthropic', model: HAIKU, lab: 'rec', maxTokens: 1000 }, { system: 'You are a probe.', user: `${HEAD}Answer with the single word OK.`, label: 'cr31', log: () => {}, cacheHead: HEAD, cacheTtl: '5m' });
    assert.equal(stage.usage.cacheAsked, '5m', 'premise: the call was marked');
    assert.equal(stage.usage.input, 14);
    assert.equal(stage.usage.cacheWrite, 7663);
    assert.ok(close(stage.usd, ONCE), `the stage's dollars are the write counted once: ${stage.usd} against ${ONCE}`);
  } finally { globalThis.fetch = real; if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key; }
});
