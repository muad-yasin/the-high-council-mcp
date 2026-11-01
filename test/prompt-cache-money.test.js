// CACHE lane unit 2, the money path (src/cache-prices.js, cost.js, invoke() in chain.js): what a marked call is projected at, charged at and recorded as. Offline: globalThis.fetch is stubbed for the
// direct Anthropic seats ($0, a dummy key); the exchange is driven through exchangeRound with replies that leave every objection standing, so rounds 2 and 3 happen.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exchangeRound, setBudget, setCapBudgets, setCache, budgetState, BudgetExceeded } from '../src/chain.js';
import { costOf, readUsage, worstCaseOf, projectAttempts, priceOf, estimateChainRows } from '../src/cost.js';
import { cacheReadMultiplierOf, cacheWriteMultiplierOf } from '../src/cache-prices.js';
import { setUserPrices, resetUserPrices } from '../src/price-table.js';
import * as COST from '../src/cost.js';
import { cases } from './helpers/cost-switch-off-cases.js';
import { forecastCost } from '../src/cost-forecast.js';
import { readFileSync, mkdirSync } from 'node:fs';

afterEach(() => { setBudget(null); setCache(null); resetUserPrices(); });
const IN = priceOf('anthropic', 'claude-sonnet-5').in, OUT = priceOf('anthropic', 'claude-sonnet-5').out;

test('cache price multipliers: reads 0.05x for direct Opus/Sonnet 5.5 and 0.1x for the rest; writes 1.25x (5m) and 2x (1h); an unknown lifetime is priced as the dearer one', () => {
  assert.equal(cacheReadMultiplierOf('anthropic/claude-opus-5-5'), 0.05);
  assert.equal(cacheReadMultiplierOf('anthropic/claude-sonnet-5-5'), 0.05);
  assert.equal(cacheReadMultiplierOf('anthropic/claude-haiku-5-5'), 0.1);
  assert.equal(cacheReadMultiplierOf('anthropic/claude-sonnet-5'), 0.1);
  assert.equal(cacheWriteMultiplierOf('5m'), 1.25);
  assert.equal(cacheWriteMultiplierOf('1h'), 2);
  assert.equal(cacheWriteMultiplierOf('2h'), 2);
});

test('costOf: a call WITHOUT a marker is priced exactly as before; a marked call prices reads, 5m writes and 1h writes apart; counts absent on a marked call are UNKNOWN and charged as a full write', () => {
  const m = x => x / 1e6;
  const plain = { input: 1000, output: 200 };
  assert.equal(costOf('anthropic', 'claude-sonnet-5', plain).usd, m(1000) * IN + m(200) * OUT);
  assert.equal(costOf('anthropic', 'claude-sonnet-5', { ...plain, cacheRead: 99999 }).usd, m(1000) * IN + m(200) * OUT, 'counts without cacheAsked are not priced: a call that carried no marker is unchanged');
  const read = costOf('anthropic', 'claude-sonnet-5', { ...plain, cacheAsked: '1h', cacheRead: 50000, cacheWrite: 0 });
  assert.ok(Math.abs(read.usd - (m(1000) * IN + m(50000) * IN * 0.1 + m(200) * OUT)) < 1e-12);
  const write1h = costOf('anthropic', 'claude-sonnet-5', { ...plain, cacheAsked: '1h', cacheRead: 0, cacheWrite: 40000, cacheWrite1h: 40000 });
  assert.ok(Math.abs(write1h.usd - (m(1000) * IN + m(40000) * IN * 2 + m(200) * OUT)) < 1e-12);
  const write5m = costOf('anthropic', 'claude-sonnet-5', { ...plain, cacheAsked: '5m', cacheRead: 0, cacheWrite: 40000, cacheWrite1h: 0 });
  assert.ok(Math.abs(write5m.usd - (m(1000) * IN + m(40000) * IN * 1.25 + m(200) * OUT)) < 1e-12);
  const noSplit = costOf('anthropic', 'claude-sonnet-5', { ...plain, cacheAsked: '1h', cacheWrite: 40000 });
  assert.ok(Math.abs(noSplit.usd - write1h.usd) < 1e-12, 'a write with no split is charged at the asked lifetime');
  const unknown = costOf('anthropic', 'claude-sonnet-5', { ...plain, cacheAsked: '1h' });
  assert.equal(unknown.cacheUnknown, true);
  assert.ok(Math.abs(unknown.usd - (m(1000) * IN * 2 + m(200) * OUT)) < 1e-12, 'unknown counts: the whole input as a 1h write (errs high)');
});

test('costOf: Opus 5.5 reads at 0.05x (a user price row stands in for the shipped one)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-money-'));
  try {
    writeFileSync(join(dir, 'pricing.user.json'), JSON.stringify({ 'anthropic/claude-opus-5-5': { in: 4, out: 20 } }));
    setUserPrices(dir);
    const c = costOf('anthropic', 'claude-opus-5-5', { input: 0, output: 0, cacheAsked: '1h', cacheRead: 1_000_000, cacheWrite: 0 });
    assert.ok(Math.abs(c.usd - 0.2) < 1e-9, 'Opus 5.5: $0.20 per million cached input');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readUsage: whole non-negative cache counts pass through; a malformed count is DROPPED (never zeroed) and the usage is unreadable, so the cap charges the worst case', () => {
  const ok = readUsage({ input: 10, output: 5, cacheAsked: '1h', cacheRead: 7, cacheWrite: 0, cacheWrite1h: 0 });
  assert.equal(ok.unreadable, null);
  assert.deepEqual([ok.usage.cacheAsked, ok.usage.cacheRead, ok.usage.cacheWrite, ok.usage.cacheWrite1h], ['1h', 7, 0, 0]);
  for (const bad of [-1, 1.5, 'x']) {
    const r = readUsage({ input: 10, output: 5, cacheAsked: '1h', cacheRead: bad });
    assert.match(r.unreadable, /unreadable cacheRead/, String(bad));
    assert.ok(!('cacheRead' in r.usage), 'dropped, not zeroed');
  }
  assert.match(readUsage({ input: 1, output: 1, cacheAsked: '9h' }).unreadable, /cacheAsked/);
  assert.ok(!('cacheRead' in readUsage({ input: 1, output: 1 }).usage), 'absent stays absent');
});

test('projection: a marked call is projected with its head at the WRITE price (never the read price), the tail at the input price; no marker = the old figure; the head never lowers the projection', () => {
  const promptChars = 400_000; // 100k tokens
  const base = worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars, maxTokens: 1000 }).usd;
  const marked = worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars, maxTokens: 1000, cache: { headTokens: 80_000, ttl: '1h' } }).usd;
  assert.ok(Math.abs(marked - (base + (80_000 / 1e6) * IN)) < 1e-9, 'the head costs one more input price (2x instead of 1x)');
  const m5 = worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars, maxTokens: 1000, cache: { headTokens: 80_000, ttl: '5m' } }).usd;
  assert.ok(m5 > base && m5 < marked, '5m writes are dearer than the plain input and cheaper than 1h');
  const seat = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 1000 };
  const a = projectAttempts(seat, { system: 'S'.repeat(4000), user: 'U'.repeat(396_000) });
  const b = projectAttempts(seat, { system: 'S'.repeat(4000), user: 'U'.repeat(396_000), cache: { headChars: 320_000, ttl: '1h' } });
  assert.ok(b.first > a.first && b.retry > a.retry, 'both attempts rise (the retry re-sends the same head)');
  assert.equal(worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars, maxTokens: 1000, cache: { headTokens: 10_000_000, ttl: '1h' } }).usd, base + (100_000 / 1e6) * IN, 'a head larger than the prompt is clamped to the prompt');
});

// ---- the exchange end to end, through the real adapter with a stubbed fetch ----
const SONNET = lab => ({ provider: 'anthropic', model: 'claude-sonnet-5', lab, layer: 1, maxTokens: 2000 });
const exchangeWith = async (respond, { cap = null, caps = null, cacheTtl = '1h' } = {}) => {
  const original = globalThis.fetch; const hadKey = process.env.ANTHROPIC_API_KEY;
  const sent = []; const stages = [];
  globalThis.fetch = async (url, init) => { const body = JSON.parse(init.body); sent.push(body); return new Response(JSON.stringify(respond(sent.length, body)), { status: 200, headers: { 'content-type': 'application/json' } }); };
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy';
  setCache(null); setBudget(caps ? null : cap);
  if (caps) setCapBudgets(caps);   // DUALCAP 4a: per-provider buckets instead of one run total
  try {
    const judges = [
      { key: 'xa', seat: SONNET('xa'), failures: [{ criterion: 'It states its assumptions.', problem: 'No assumptions are stated anywhere.' }] },
      { key: 'xb', seat: SONNET('xb'), failures: [{ criterion: 'It adds no scope.', problem: 'It adds a billing system.' }] },
    ];
    const draft = '# Plan\n\n' + 'Bake a cake. '.repeat(2000);
    const run = () => exchangeRound({ judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft, round: 1, record: s => { stages.push(s); return s; }, rounds: 3, cacheTtl });
    return { run, sent, stages };
  } finally { /* restored by the caller */ globalThis.__restore = () => { globalThis.fetch = original; if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = hadKey; }; }
};
const reply = (text, usage) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20, ...usage } });
// the judges contest every objection they are shown and keep their own: every objection stays standing, so rounds 2 and 3 happen (the ids are read out of the prompt, as the mock exchange judges do)
const standing = (n, body) => {
  const text = JSON.stringify(body.messages);
  const user = typeof body.messages[0].content === 'string' ? body.messages[0].content : body.messages[0].content.map(b => b.text).join('');
  if (body.system.startsWith('You are one reviewer on a panel. You and the other reviewers')) {
    const ids = [...user.matchAll(/^Objection (O-[0-9a-f]{8})$/gm)].map(m => m[1]);
    const first = (((user.split('# Draft under review\n\n')[1] || '').split('\n').find(l => l.trim().length >= 8)) || '').trim().slice(0, 40);
    return reply(JSON.stringify({ posts: ids.map(id => ({ on: id, stance: 'contest', quote: first, text: 'The plan already answers this where it says so.' })), new_objections: [] }), {});
  }
  const ids = [...user.matchAll(/^Your objection (O-[0-9a-f]{8})$/gm)].map(m => m[1]);
  void text;
  // an amendment that differs every time keeps the exchange going: it ends a round only when nothing changed in it
  return reply(JSON.stringify({ replies: ids.map(id => ({ id, action: 'amend', text: 'Right in part.', problem: `Narrowed (answer ${n}): the assumptions section is missing.` })) }), {});
};

test('exchange through the adapter: round 1 is sent unmarked; rounds 2 and 3 carry the marker on the first block (the plan), 1h, system text unchanged; the stage usage records the counts', async () => {
  const counts = n => (n <= 4 ? {} : n <= 8 ? { cache_creation_input_tokens: 9000, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 9000 } } : { cache_creation_input_tokens: 0, cache_read_input_tokens: 9000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } });
  const { run, sent, stages } = await exchangeWith((n, body) => ({ ...standing(n, body), usage: { input_tokens: 100, output_tokens: 20, ...counts(n) } }));
  try {
    await run();
    assert.ok(sent.length >= 12, `three rounds of two judges, posts and answers (${sent.length} calls)`);
    sent.slice(0, 4).forEach((b, i) => assert.ok(typeof b.messages[0].content === 'string' && !JSON.stringify(b).includes('cache_control'), `call ${i + 1} (round 1) is unmarked`));
    for (const b of sent.slice(4)) {
      const [head, tail] = b.messages[0].content;
      assert.deepEqual(head.cache_control, { type: 'ephemeral', ttl: '1h' });
      assert.ok(!tail || !('cache_control' in tail));
      assert.equal(typeof b.system, 'string');
    }
    const marked = stages.slice(4);
    assert.ok(marked.every(s => s.usage.cacheAsked === '1h'));
    assert.deepEqual(stages.slice(0, 4).map(s => 'cacheAsked' in s.usage), [false, false, false, false]);
    const writes = marked.filter(s => s.usage.cacheWrite === 9000), reads = marked.filter(s => s.usage.cacheRead === 9000);
    assert.ok(writes.length === 4 && reads.length === 4, `4 writes (round 2) and 4 reads (round 3), got ${writes.length}/${reads.length}`);
    // the charged figure follows the counts: a write costs 2x the input price on its 9000 tokens, a read 0.1x
    const m = x => x / 1e6;
    assert.ok(Math.abs(writes[0].usd - (m(100) * IN + m(9000) * IN * 2 + m(20) * OUT)) < 1e-12);
    assert.ok(Math.abs(reads[0].usd - (m(100) * IN + m(9000) * IN * 0.1 + m(20) * OUT)) < 1e-12);
  } finally { globalThis.__restore(); }
});

test('exchange through the adapter: counts missing on a marked call are UNKNOWN - charged as a full write, recorded as such, never as zero cached', async () => {
  const { run, stages } = await exchangeWith((n, body) => standing(n, body));
  try {
    await run();
    const marked = stages.filter(s => s.usage.cacheAsked);
    assert.ok(marked.length > 0);
    for (const s of marked) {
      assert.equal(s.usage.cacheCounts, 'unknown');
      // Anthropic's input_tokens excludes the cached part, so the 100 reported tokens may be only the tail: the WHOLE prompt (system text included) is charged as a 1h write, the reply at its reported size
      const whole = worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars: s.promptBytes, maxTokens: 20, cache: { headTokens: Math.ceil(s.promptBytes / 4), ttl: '1h' } }).usd;
      assert.ok(Math.abs(s.usd - whole) < 1e-12, `charged ${s.usd}, whole-prompt write ${whole}`);
      assert.ok(s.usd > (100 / 1e6) * IN * 2 + (20 / 1e6) * OUT, 'more than the tail-only figure');
    }
  } finally { globalThis.__restore(); }
});

test('the cap sees the write price: a ceiling that fits the unmarked projections but not the marked ones stops the run BEFORE the first marked call is sent, and the same ceiling lets the run through when nothing is marked', async () => {
  const draft = '# Plan\n\n' + 'Bake a cake. '.repeat(2000);
  const seat = SONNET('xa');
  // sizes as the exchange builds them (system + plan + a short tail); close enough for a ceiling between the two figures
  const system = 'x'.repeat(2400), user = draft + '\n\n# Objections\n\n' + 'y'.repeat(600);
  const U = projectAttempts(seat, { system, user }), M = projectAttempts(seat, { system, user, cache: { headChars: system.length + draft.length, ttl: '1h' } });
  const unmarked = U.first + U.retry, marked = M.first + M.retry;
  assert.ok(marked > unmarked, 'fixture: the marked projection is higher');
  const cap = unmarked + marked;   // two parallel calls: 2 x unmarked fits, 2 x marked does not
  assert.ok(2 * unmarked < cap && cap < 2 * marked);
  const stopped = await exchangeWith((n, body) => standing(n, body), { cap });
  try {
    const err = await stopped.run().then(() => null, e => e);
    assert.ok(err instanceof BudgetExceeded, String(err));
    assert.match(String(err.label), /^(ldebate|lreply)-1-x2-/, 'the stop is a round-2 call, the first round that is marked');
    // the ceiling holds one marked call (unmarked + marked fits) but not the second of the pair that two UNMARKED calls fit: the pair of round 2 is cut at its second call, before it is sent
    assert.equal(stopped.sent.length, 5, 'the four unmarked round-1 calls and the first marked call were sent, no more');
    assert.ok(!stopped.sent.slice(0, 4).some(b => JSON.stringify(b).includes('cache_control')));
    assert.ok(JSON.stringify(stopped.sent[4]).includes('cache_control'));
  } finally { globalThis.__restore(); }
  const through = await exchangeWith((n, body) => standing(n, body), { cap, cacheTtl: null });
  try {
    await through.run();
    assert.ok(through.sent.length >= 12 && !through.sent.some(b => JSON.stringify(b).includes('cache_control')), 'the same ceiling carries all three rounds when nothing is marked');
  } finally { globalThis.__restore(); }
  void budgetState;
});

test('the cap gate of a per-provider bucket sees the write price: with the Anthropic bucket armed, a marked direct-Anthropic call is refused by THAT bucket before it is sent, the other bucket is untouched, and the same bucket lets the unmarked run through', async () => {
  const draft = '# Plan\n\n' + 'Bake a cake. '.repeat(2000);
  const seat = SONNET('xa');
  const system = 'x'.repeat(2400), user = draft + '\n\n# Objections\n\n' + 'y'.repeat(600);
  const U = projectAttempts(seat, { system, user }), M = projectAttempts(seat, { system, user, cache: { headChars: system.length + draft.length, ttl: '1h' } });
  const unmarked = U.first + U.retry, marked = M.first + M.retry;
  const cap = unmarked + marked;   // the figure of money test 8, now as the Anthropic bucket: two unmarked calls fit, two marked do not
  assert.ok(2 * unmarked < cap && cap < 2 * marked);
  const stopped = await exchangeWith((n, body) => standing(n, body), { caps: { anthropic: cap, openrouter: 1000 } });
  try {
    const err = await stopped.run().then(() => null, e => e);
    assert.ok(err instanceof BudgetExceeded, String(err));
    assert.equal(err.capName, 'anthropic', 'the Anthropic bucket stopped the run, not a run total');
    assert.match(String(err.label), /^(ldebate|lreply)-1-x2-/, 'the stop is a round-2 call, the first round that is marked');
    assert.equal(stopped.sent.length, 5, 'the four unmarked round-1 calls and the first marked call were sent, no more');
    assert.equal(budgetState().caps.openrouter.spent + budgetState().caps.openrouter.reserved, 0, 'the other bucket was not touched');
  } finally { globalThis.__restore(); }
  const through = await exchangeWith((n, body) => standing(n, body), { caps: { anthropic: cap, openrouter: 1000 }, cacheTtl: null });
  try {
    await through.run();
    assert.ok(through.sent.length >= 12 && !through.sent.some(b => JSON.stringify(b).includes('cache_control')), 'the same bucket carries all three rounds when nothing is marked');
    assert.ok(budgetState().caps.anthropic.spent > 0 && budgetState().caps.anthropic.spent <= cap);
  } finally { globalThis.__restore(); }
});

test('the dry run: the MAXIMUM figure carries the write premium of the marked exchange calls (rounds 2..R of a direct Anthropic layer-1 seat) and nothing else; the expected figure and a switch-off chain are unchanged', () => {
  const seat = (lab, layer) => ({ provider: 'anthropic', model: 'claude-sonnet-5', lab, layer, maxTokens: 2000 });
  const config = { name: 'dry', signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, layer_debate: { enabled: true, rounds: 4 }, estimate: { promptTokens: 20000, draftTokens: 30000, critiqueTokens: 2000 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [seat('a', 1), seat('b', 1), seat('c', 2), seat('d', 3)] } };
  const on = { ...config, prompt_cache: { enabled: true } };
  const sum = (cfg, maximum) => estimateChainRows(cfg, { maximum }).reduce((t, r) => t + r.usd, 0);
  assert.equal(sum(on, false), sum(config, false), 'the expected figure has one exchange round, never marked');
  assert.ok(sum(on, true) > sum(config, true), 'the maximum rises: three marked rounds per post and answer at the write price');
  const rows = estimateChainRows(on, { maximum: true });
  assert.ok(rows.some(r => /^ldebate-L1-a-x2$/.test(r.label)) && rows.some(r => /^lreply-L1-b-x2$/.test(r.label)), 'the marked rounds are their own rows');
  assert.ok(!rows.some(r => /panel-L\d-.*-x2/.test(r.label)), 'no panel row is marked');
  assert.deepEqual(estimateChainRows({ ...on, layer_debate: { enabled: true, rounds: 2 } }, { maximum: true }).map(r => r.label).filter(l => /-x2$/.test(l)), [], 'a two-round exchange has nothing to read, so nothing is marked');
});

test('SWITCH-OFF PIN: with no marker (prompt_cache off, or an unmarked call with it on) costOf, readUsage, worstCaseOf, projectAttempts and expectedCallUsd return exactly what the tree before the money commit returned (28 cases captured from d4bffc45)', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/cost-switch-off-d4bffc45.json', import.meta.url), 'utf8'));
  assert.equal(fixture.length, cases.length);
  const now = cases.map(c => ({ name: c.name, value: c.run(COST) }));
  assert.deepEqual(JSON.parse(JSON.stringify(now)), fixture);
  // an unmarked call under the switch is the same call: no cache argument, no cacheAsked
  assert.deepEqual(worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars: 400000, maxTokens: 4000, cache: null }), worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars: 400000, maxTokens: 4000 }));
});

test('cost-forecast: a stage with UNKNOWN cache counts keeps its recorded figure (the whole-prompt write) instead of being repriced from its tail-only input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-forecast-'));
  try {
    const runs = join(dir, 'runs'); mkdirSync(runs); mkdirSync(join(runs, '2026-09-11T10-00-00-000Z'));
    const stage = { provider: 'anthropic', model: 'claude-sonnet-5', usage: { input: 100, output: 20, cacheAsked: '1h', cacheCounts: 'unknown' }, usd: 0.5 };
    writeFileSync(join(runs, '2026-09-11T10-00-00-000Z', 'report.json'), JSON.stringify({ chain: 'c', stages: [stage] }));
    const f = forecastCost('c', runs, { days: 90, now: Date.parse('2026-09-12T00:00:00Z') });
    assert.equal(f.low, 0.5);
    // a stage with counts is still repriced from them
    writeFileSync(join(runs, '2026-09-11T10-00-00-000Z', 'report.json'), JSON.stringify({ chain: 'c', stages: [{ ...stage, usage: { input: 100, output: 20, cacheAsked: '1h', cacheRead: 9000, cacheWrite: 0 }, usd: 99 }] }));
    const g = forecastCost('c', runs, { days: 90, now: Date.parse('2026-09-12T00:00:00Z') });
    assert.ok(Math.abs(g.low - costOf('anthropic', 'claude-sonnet-5', { input: 100, output: 20, cacheAsked: '1h', cacheRead: 9000, cacheWrite: 0 }).usd) < 1e-12);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
