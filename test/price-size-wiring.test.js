// DUALCAP unit 4d (1 Nov 2026): the size of a call's prompt reaches EVERY rate lookup on the money path. Offline, $0. The tiered row is read from the shipped table (tiersOf / effectiveRow), never typed here:
// a prompt below the step's `from` is priced at the base row, one at or above it at the step, and a fractional size is ceiled first. Sites: worstCaseOf, projectAttempts, projectAttemptsTokens, expectedCallUsd, costOf
// (size = input + cacheRead + cacheWrite as reported), and the price limit invoke() sends (pinnedExtra's { promptTokens }), which must name the same step as the projection of the same call.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/cost.js';
import { runSingleStage } from '../src/chain.js';
import { readFileSync } from 'node:fs';
import { tiersOf, effectiveRow, resetUserPrices } from '../src/price-table.js';

afterEach(() => resetUserPrices());

const P = 'openrouter', M = 'google/gemini-3.1-pro-preview';
const STEP = tiersOf(P, M)[0]; const FROM = STEP.from; const BASE = effectiveRow(P, M);
const UNTIERED = ['z-ai/glm-5.3-flash', 'openai/gpt-6.1-terra'].find(m => tiersOf(P, m).length === 0 && effectiveRow(P, m));
const seat = { provider: P, model: M, lab: 'g', maxTokens: 1000 };
const usd = (tokens, row, out = 0) => (tokens / 1e6) * row.in + (out / 1e6) * row.out;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('PSW-0 fixture: the shipped row has a step above its base, an untiered row exists, and the rule helper is exported', () => {
  assert.ok(STEP.in > BASE.in && STEP.out >= BASE.out, 'the step is dearer than the base');
  assert.ok(UNTIERED, 'an untiered shipped row exists for the guard');
  assert.equal(typeof C.priceAt, 'function', 'cost.js exports the sized price read');
});

test('PSW-1 worstCaseOf: below the step the base row, at or above it the step; a fractional size is ceiled; an untiered row is the base at any size', () => {
  const at = tokens => C.worstCaseOf(P, M, { promptChars: tokens * 4, maxTokens: 1000 }).usd;
  near(at(FROM - 1), usd(FROM - 1, BASE, 1000), 'below the step');
  near(at(FROM), usd(FROM, STEP, 1000), 'at the step');
  near(C.worstCaseOf(P, M, { promptChars: (FROM - 1) * 4 + 1, maxTokens: 1000 }).usd, usd(FROM, STEP, 1000), 'one character over (ceiled to the step)');
  near(C.worstCaseOf(P, UNTIERED, { promptChars: FROM * 8, maxTokens: 1000 }).usd, usd(FROM * 2, effectiveRow(P, UNTIERED), 1000), 'an untiered row at twice the size');
});

test('PSW-2 projectAttempts: the prompt it projects (system + user characters) lands on the step it reaches', () => {
  const first = n => C.projectAttempts(seat, { system: 's'.repeat(10), user: 'u'.repeat(n * 4 - 10) }).first;
  near(first(FROM - 1), usd(FROM - 1, BASE, 1000), 'below the step');
  near(first(FROM), usd(FROM, STEP, 1000), 'at the step');
});

test('PSW-3 projectAttemptsTokens: its inputTokens IS the size (never divided by four): a fractional size is ceiled', () => {
  const first = t => C.projectAttemptsTokens(seat, { inputTokens: t, maxTokens: 1000 }).first;
  near(first(FROM - 1), usd(FROM - 1, BASE, 1000), 'below the step');
  near(first(FROM - 0.5), usd(FROM, STEP, 1000), 'half a token under the step ceils to it');
  near(first(FROM), usd(FROM, STEP, 1000), 'at the step');
});

test('PSW-4 expectedCallUsd: the gate decides on the step the call\'s real prompt reaches', () => {
  const run = n => C.expectedCallUsd(seat, { system: '', user: 'x'.repeat(n * 4), label: 'criteria' });
  const out = Math.round(run(0) / (BASE.out / 1e6));   // the expected output size, read back from the empty prompt
  assert.ok(out > 0, 'the label has an expected output size');
  near(run(FROM - 1), usd(FROM - 1, BASE) + (out / 1e6) * BASE.out, 'below the step');
  near(run(FROM), usd(FROM, STEP) + (out / 1e6) * STEP.out, 'at the step');
});

test('PSW-5 costOf: the size is input + cacheRead + cacheWrite as reported (the provider bills the whole prompt); cacheWrite1h is part of cacheWrite, not added again', () => {
  const cost = u => C.costOf(P, M, { output: 0, ...u }).usd;
  near(cost({ input: FROM - 1 }), usd(FROM - 1, BASE), 'input below the step');
  near(cost({ input: FROM }), usd(FROM, STEP), 'input at the step');
  near(cost({ input: 1000, cacheRead: FROM }), usd(1000, STEP), 'a size reached only through cacheRead');
  near(cost({ input: 1000, cacheWrite: FROM }), usd(1000, STEP), 'a size reached only through cacheWrite');
  near(cost({ input: FROM - 2000, cacheWrite: 1000, cacheWrite1h: 1000 }), usd(FROM - 2000, BASE), 'cacheWrite1h is a part of cacheWrite: the size is FROM - 1000, still under the step');
});

test('PSW-6 priceAt: no size = the base; a size asked for and broken = the dearest step; a fractional size is ceiled; priceOf stays the base row', () => {
  assert.equal(C.priceAt(P, M, undefined).in, BASE.in, 'undefined = the base');
  for (const bad of [NaN, null, Infinity]) assert.equal(C.priceAt(P, M, bad).in, STEP.in, `${bad} = the dearest step`);
  assert.equal(C.priceAt(P, M, FROM - 0.5).in, STEP.in, 'a fractional size under the step ceils to it');
  assert.equal(C.priceOf(P, M).in, BASE.in, 'priceOf is the base row whatever the size');
});

async function sentMaxPrice(user) {
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test';
  const original = globalThis.fetch; let body = null;
  globalThis.fetch = async (url, opts) => { body = JSON.parse(opts.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 }, model: M, provider: 'Host' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try { await runSingleStage(seat, { system: 's', user, label: 'size-probe' }); return body.provider?.max_price; }
  finally { globalThis.fetch = original; if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
}

test('PSW-7 invoke(): the price limit sent names the same step as the projection of the same call, for a short and for a long prompt', async () => {
  const short = 'u'.repeat(400), long = 'u'.repeat(FROM * 4);
  assert.deepEqual(await sentMaxPrice(short), { prompt: BASE.in, completion: BASE.out }, 'a short prompt is limited at the base row');
  assert.deepEqual(await sentMaxPrice(long), { prompt: STEP.in, completion: STEP.out }, 'a long prompt is limited at the step');
  const projected = C.projectAttempts(seat, { system: 's', user: long }).first;   // the same call, projected
  near(projected, usd(Math.ceil(('s'.length + long.length) / 4), STEP, 1000), 'the projection of that call is priced at the same step');
});

test('PSW-8 one characters expression: cost.js and chain.js read the prompt\'s size from promptCharsOf, never a second hand-written system + user sum (the sites cannot drift)', () => {
  assert.equal(typeof C.promptCharsOf, 'function');
  assert.equal(C.promptCharsOf({ system: 'abc', user: 'de' }), 5);
  assert.equal(C.promptCharsOf({ user: 'de' }), 2, 'a missing system counts 0');
  const hand = /\(system \|\| ''\)\.length \+ \(user \|\| ''\)\.length/g;
  const cost = readFileSync(new URL('../src/cost.js', import.meta.url), 'utf8'), chain = readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8');
  assert.equal((cost.match(hand) || []).length, 1, 'cost.js writes the sum once: inside promptCharsOf');
  assert.equal((chain.match(hand) || []).length, 0, 'chain.js writes no sum of its own');
  assert.ok(/promptCharsOf\(\{ system, user \}\)/.test(chain), 'invoke() reads promptCharsOf');
  const bodyOf = fn => { const at = cost.indexOf(`export function ${fn}(`); assert.ok(at >= 0, `${fn} exists`); const next = cost.indexOf('\nexport ', at + 1); return cost.slice(at, next < 0 ? undefined : next); };   // the signature up to the next export: only this function's own body
  for (const fn of ['projectAttempts', 'expectedCallUsd']) assert.ok(bodyOf(fn).includes('promptCharsOf('), `${fn} reads promptCharsOf in its own body`);
});
