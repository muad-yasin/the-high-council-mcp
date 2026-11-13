// 0.8.4 cache part (b)2, step (b): the ROUTED-CLAUDE MARK (Muad, 10 Nov 2026 04:05: "Claude seats reached through OpenRouter ARE cached, 5 minutes where possible"; his 09 Nov 21:30 heading: a paid GPT-6 cache test is owed only if a cache mark or a switch-off reaches the OpenAI seats). Offline, $0: fetch is stubbed; the keys are dummies.
// WHAT IS PINNED: RM-1 the mark rule (src/cache-order-gate.js markTtlOf): a seat the Claude route sent through OpenRouter (provider openrouter, originalProvider anthropic) is marked on the same rule as a direct one, always at 5 minutes (a chain's 1-hour lifetime is for its direct seats); a seat a person seated on OpenRouter
// themselves, a GPT-6 seat and a Qwen seat are not; with the order's words unrecorded nothing is marked. RM-2 the request: a marked routed call carries the marker on the text part that ends the head H (type ephemeral, no ttl field: 5 minutes is OpenRouter's default), one head and one system text for every call of the group; the
// reply's cache counts are read and the stage records the marker as asked. RM-3 the request of a GPT-6 seat and of a Qwen seat in the same state carries a string user message and no key with "cache" in it at any depth (FIX 2, C&C and Mini-C&C, 10 Nov 2026: this is NOT a byte comparison with a captured body; it meets the owner's 09 Nov 21:30 heading, which turns on a cache mark or a switch-off reaching those seats, and `cache` reaches callOpenAICompat only for a Claude seat). RM-4 the cap sees the write price: a ceiling that fits the unmarked projection but not the
// marked ones stops the run before the second marked call is sent. RM-5 with the order's words not recorded a routed seat is sent no marker (ruling B's older mark never reaches it).
// On the tree before this step RM-1 fails at the first markTtlOf (null, not '5m'), RM-2 at the split user text and RM-4 at the guard before its projection; RM-3 and RM-5 PASS there (they pin what held: NO RED OF THEIR OWN).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Chain from '../src/chain.js';
import * as Cost from '../src/cost.js';
import * as Gate from '../src/cache-order-gate.js';
import * as R from '../src/roles.js';
import * as Held from '../src/held-roles.js';
import * as HC from './held-prompts/held-084-cache-order.js';

afterEach(() => { Chain.setBudget(null); Chain.setCache(null); Chain.setPromptSpy(null); Held.setHeldForTest(null); });
const LIVE = { ...HC };
const UNRECORDED = Object.fromEntries(Object.keys(HC).map(n => [n, undefined]));
const routed = (lab, layer, extra = {}) => ({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', originalProvider: 'anthropic', lab, layer, maxTokens: 2000, ...extra });
const chainWith = (critics, extra = {}) => ({ name: 'routed-marks', signoff: 'unanimous', prompt_cache: { enabled: true }, seats: { critics }, ...extra });
const userOf = body => { const m = body.messages.find(x => x.role === 'user'); return typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join(''); };
const everyKey = (v, out = []) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); everyKey(x, out); } return out; };
const standing = (n, body) => {
  const user = userOf(body);
  if (/^Objection O-[0-9a-f]{8}$/m.test(user)) {      // a post shows the objections; an answer shows "Your objection ..." (read from the text, not from the lead-in: the lead-in exists only in the new order)
    const ids = [...user.matchAll(/^Objection (O-[0-9a-f]{8})$/gm)].map(m => m[1]);
    return JSON.stringify({ posts: ids.map(id => ({ on: id, stance: 'contest', quote: 'Bake a cake.', text: 'The plan already answers this where it says so.' })), new_objections: [] });
  }
  const ids = [...user.matchAll(/^Your objection (O-[0-9a-f]{8})$/gm)].map(m => m[1]);
  return JSON.stringify({ replies: ids.map(id => ({ id, action: 'amend', text: 'Right in part.', problem: `Narrowed (answer ${n}): the assumptions section is missing.` })) });
};
async function exchangeWith(config, { cap = null, usage = { prompt_tokens: 100, completion_tokens: 20 }, judgeSeats = config.seats.critics.filter(c => c.layer === 1) } = {}) {
  const original = globalThis.fetch, hadOr = process.env.OPENROUTER_API_KEY, sent = [], stages = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: standing(sent.length, body) }, finish_reason: 'stop' }], usage }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  process.env.OPENROUTER_API_KEY = 'sk-or-test-dummy';
  Chain.setCache(null); Chain.setBudget(cap);
  const judges = judgeSeats.map(seat => ({ key: seat.lab, seat, failures: [{ criterion: 'It states its assumptions.', problem: `No assumptions are stated anywhere (${seat.lab}).` }] }));
  const draft = '# Plan\n\n' + 'Bake a cake. '.repeat(20000);
  const run = () => Chain.exchangeRound({ judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft, round: 1, record: s => { stages.push(s); return s; }, cacheTtl: '5m', layout: { config, checks: '', endMarker: false } });
  const restore = () => { globalThis.fetch = original; if (hadOr === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = hadOr; };
  return { run, sent, stages, restore };
}

test('RM-1 THE MARK RULE: a routed Claude seat is marked on the direct seat\'s rule, always at 5 minutes; a person\'s own OpenRouter seat, a GPT-6 seat and a Qwen seat are not; with the words unrecorded nothing is', () => {
  Held.setHeldForTest(LIVE);
  const two = [routed('a', 1), routed('b', 1)];
  assert.equal(Gate.markTtlOf(chainWith(two), two[0]), '5m');
  assert.equal(Gate.markTtlOf(chainWith(two, { prompt_cache: { enabled: true, ttl: '1h' } }), two[0]), '5m', 'the chain\'s 1-hour lifetime is for its direct seats: a routed seat is marked at 5 minutes');
  const direct = { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'd', layer: 1, maxTokens: 2000 };
  assert.equal(Gate.markTtlOf(chainWith([direct, { ...direct, lab: 'e' }], { prompt_cache: { enabled: true, ttl: '1h' } }), direct), '1h', 'a direct seat keeps the chain\'s lifetime');
  const own = { ...routed('o', 1), originalProvider: undefined };
  assert.equal(Gate.markTtlOf(chainWith([own, routed('b', 1)]), own), null, 'a seat the person seated on OpenRouter themselves (no originalProvider) is not a routed Claude seat');
  const gpt = { provider: 'openrouter', model: 'openai/gpt-6-luna', lab: 'g', layer: 1, maxTokens: 2000 }, qwen = { provider: 'openrouter', model: 'qwen/qwen3.8-flash', lab: 'q', layer: 1, maxTokens: 2000 };
  for (const s of [gpt, qwen]) assert.equal(Gate.markTtlOf(chainWith([s, routed('b', 1)]), s), null, `${s.model}: no mark`);
  const alone = [routed('a', 1), routed('c', 2)];
  assert.equal(Gate.markTtlOf(chainWith(alone), alone[0]), null, 'alone in its layer: single by shape, no mark');
  Held.setHeldForTest(UNRECORDED);
  assert.equal(Gate.markTtlOf(chainWith(two), two[0]), null, 'the order\'s words not recorded: no mark');
});

test('RM-2 THE REQUEST: a marked routed call carries the marker on the text part that ends the head, 5 minutes with no ttl field, one head and one system text for every call of the group; the reply\'s cache counts are read and the marker is recorded as asked', async () => {
  Held.setHeldForTest(LIVE);
  const run = await exchangeWith(chainWith([routed('xa', 1), routed('xb', 1)]), { usage: { prompt_tokens: 9100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 9000 } } });
  try {
    await run.run();
    assert.ok(run.sent.length >= 4, `posts and answers were sent (${run.sent.length} calls)`);
    for (const b of run.sent) {
      const user = b.messages.find(m => m.role === 'user');
      assert.ok(Array.isArray(user.content), 'the user text is split at the head');
      assert.deepEqual(user.content[0].cache_control, { type: 'ephemeral' }, 'a 5-minute marker, no ttl field');
      assert.equal(b.messages.find(m => m.role === 'system').content, R.COUNCIL_INTRO, 'the same system text for every call kind');
      assert.ok(user.content.slice(1).every(p => !('cache_control' in p)), 'one marker per request');
    }
    assert.equal(new Set(run.sent.map(b => b.messages.find(m => m.role === 'user').content[0].text)).size, 1, 'one head H for every call of the pass');
    assert.ok(run.stages.length > 0 && run.stages.every(s => s.usage.cacheAsked === '5m' && s.usage.cacheWrite === 9000), 'the stage records the marker as asked and the write count as reported');
    // CHANGED ACCEPTED TEST (FIX 6, 10 Nov 2026, from the paid cache test). OLD: the write count was charged ON TOP of the reported prompt: usd = m(9100) * in + m(9000) * in * 1.25 + m(20) * out (providers.js recorded a write count without subtracting it, so the figure erred high by one input price on the written head). NEW: the written tokens are inside prompt_tokens (measured), so a marked call's `input` leaves them out and the write is charged once: usd = m(100) * in + m(9000) * in * 1.25 + m(20) * out.
    // The charged figure follows the row of the routed model (OpenRouter's own page, in src/pricing.json): the part neither read nor written at the input price, the written head at the row's write multiple.
    const P = Cost.priceOf('openrouter', 'anthropic/claude-sonnet-5.5'), m = x => x / 1e6;
    for (const s of run.stages) assert.ok(Math.abs(s.usd - (m(100) * P.in + m(9000) * P.in * 1.25 + m(20) * P.out)) < 1e-9, `charged ${s.usd}`);
  } finally { run.restore(); }
});

test('RM-3 A GPT-6 SEAT AND A QWEN SEAT: with the order live the request carries a plain string user message and no key with "cache" in it at any depth (not a comparison with a captured body)', async () => {
  Held.setHeldForTest(LIVE);
  for (const model of ['openai/gpt-6-luna', 'qwen/qwen3.8-flash']) {
    const seat = lab => ({ provider: 'openrouter', model, lab, layer: 1, maxTokens: 2000 });
    const run = await exchangeWith(chainWith([seat('la'), seat('lb')]));
    try {
      await run.run();
      assert.ok(run.sent.length >= 4, `${model}: posts and answers were sent`);
      for (const b of run.sent) {
        assert.deepEqual(everyKey(b).filter(k => /cache/i.test(k)), [], `${model}: no key containing "cache" at any depth`);
        assert.equal(typeof b.messages.find(m => m.role === 'user').content, 'string', `${model}: the user message is the plain string`);
      }
    } finally { run.restore(); }
  }
});

test('RM-4 THE CAP SEES THE WRITE PRICE: a ceiling that fits the unmarked projection but not two marked ones stops the run before the second marked call is sent', async () => {
  Held.setHeldForTest(LIVE);
  const config = chainWith([routed('xa', 1), routed('xb', 1)]);
  const probe = await exchangeWith(config); let first;
  try { await probe.run(); first = probe.sent[0]; } finally { probe.restore(); }
  const firstUser = first.messages.find(m => m.role === 'user');
  assert.ok(Array.isArray(firstUser.content), 'the first call of a marked routed pair is split at the head (a plain string here means nothing was marked)');
  const system = first.messages.find(m => m.role === 'system').content, user = userOf(first), headText = firstUser.content[0].text;
  const seat = routed('xa', 1);
  const U = Cost.projectAttempts(seat, { system, user }), M = Cost.projectAttempts(seat, { system, user, cache: { headChars: system.length + headText.length, ttl: '5m' } });
  assert.ok(M.first + M.retry > U.first + U.retry, 'fixture: the marked projection of a routed seat is the higher one (the head at 1.25 times the input price)');
  const stopped = await exchangeWith(config, { cap: (U.first + U.retry) + (M.first + M.retry) });
  try {
    const err = await stopped.run().then(() => null, e => e);
    assert.ok(err instanceof Chain.BudgetExceeded, String(err));
    assert.equal(stopped.sent.length, 1, 'one marked call fits, the second of the pair does not');
    assert.deepEqual(stopped.sent[0].messages.find(m => m.role === 'user').content[0].cache_control, { type: 'ephemeral' });
  } finally { stopped.restore(); }
});

test('RM-5 WITH THE ORDER\'S WORDS NOT RECORDED a routed seat is sent no marker: ruling B\'s older mark reaches a direct seat only', async () => {
  Held.setHeldForTest(UNRECORDED);
  const run = await exchangeWith(chainWith([routed('xa', 1), routed('xb', 1)]));
  try {
    await run.run();
    assert.ok(run.sent.length >= 4);
    for (const b of run.sent) assert.deepEqual(everyKey(b).filter(k => /cache/i.test(k)), [], 'no marker');
  } finally { run.restore(); }
});
