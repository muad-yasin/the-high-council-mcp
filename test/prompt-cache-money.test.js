// CACHE lane unit 2, the money path (src/cache-prices.js, cost.js, invoke() in chain.js): what a marked call is projected at, charged at and recorded as. Offline: globalThis.fetch is stubbed for the
// direct Anthropic seats ($0, a dummy key); the exchange is driven through exchangeRound with replies that leave every objection standing, so rounds 2 and 3 happen.
import { exchangeCallCarriesHead } from '../src/prompt-cache.js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exchangeRound, setBudget, setCapBudgets, setCache, budgetState, BudgetExceeded, setReservationSink } from '../src/chain.js';
import { openReservations, reservationLinesOf } from '../src/spend-reservations.js';
import { COUNCIL_INTRO } from '../src/roles.js';
import { costOf, readUsage, worstCaseOf, projectAttempts, priceOf, estimateChainRows } from '../src/cost.js';
import { cacheReadMultiplierOf, cacheWriteMultiplierOf } from '../src/cache-prices.js';
import { setUserPrices, resetUserPrices } from '../src/price-table.js';
import * as COST from '../src/cost.js';
import { cases } from './helpers/cost-switch-off-cases.js';
import { forecastCost } from '../src/cost-forecast.js';
import { readFileSync, mkdirSync } from 'node:fs';
// CHANGED ACCEPTED (0.8.4 N9, C&C's ruling 4: `layer_debate.rounds` is removed): its dry-run chain set `layer_debate: { enabled: true, rounds: 4 }`; it now sets no `layer_debate` block (the key and the switch are removed; the maximum is seven rounds). The two-round assertion is re-asked of the rule itself, see its own block.

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
    const run = () => exchangeRound({ judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft, round: 1, record: s => { stages.push(s); return s; }, rounds: 4, cacheTtl });   // FINDING (not on the owed list of the ladder unit; 10 Nov 2026): a 1-hour marker needs a budget of 4 rounds now (C&C's ruling B number), so these rows run 4; and an exchange goes on only after a withdrawal or a new objection (exchange idea 1), so the posts below name one in every call
    return { run, sent, stages };
  } finally { /* restored by the caller */ globalThis.__restore = () => { globalThis.fetch = original; if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = hadKey; }; }
};
const reply = (text, usage) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20, ...usage } });
// the judges contest every objection they are shown and keep their own: every objection stays standing, so rounds 2 and 3 happen (the ids are read out of the prompt, as the mock exchange judges do)
const standing = (n, body) => {
  const text = JSON.stringify(body.messages);
  const user = typeof body.messages[0].content === 'string' ? body.messages[0].content : body.messages[0].content.map(b => b.text).join('');
  if (body.system.startsWith(`${COUNCIL_INTRO}\n\nYou are one reviewer on a panel. You and the other reviewers`)) {   // the post prompt now opens with the Council introduction, a blank line, then this sentence
    const ids = [...user.matchAll(/^Objection (O-[0-9a-f]{8})$/gm)].map(m => m[1]);
    const first = (((user.split('# Draft under review\n\n')[1] || '').split('\n').find(l => l.trim().length >= 8)) || '').trim().slice(0, 40);
    return reply(JSON.stringify({ posts: ids.map(id => ({ on: id, stance: 'contest', quote: first, text: 'The plan already answers this where it says so.' })), new_objections: [{ criterion: 'It states its assumptions.', problem: `A defect named in call ${n}.`, quote: `Defect quote number ${n}.` }] }), {});
  }
  const ids = [...user.matchAll(/^Your objection (O-[0-9a-f]{8})$/gm)].map(m => m[1]);
  void text;
  // an amendment that differs every time keeps the exchange going: it ends a round only when nothing changed in it
  return reply(JSON.stringify({ replies: ids.map(id => ({ id, action: 'amend', text: 'Right in part.', problem: `Narrowed (answer ${n}): the assumptions section is missing.` })) }), {});
};

test('exchange through the adapter: round 1 is sent unmarked; rounds 2 to 4 carry the marker on the first block (the plan), 1h, system text unchanged; the stage usage records the counts', async () => {
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
    // CHANGED ACCEPTED (0.8.4 ladder unit, the layer-1 exchange runs 3 rounds and a 1h marker needs a budget of 4: ruling B; found by the box set, 10 Nov 2026). OLD bar: 4 writes (round 2) and 4 reads (round 3) on a three-round exchange. NEW bar: the fixture runs 4 rounds (16 calls), so round 2 writes (4 calls) and rounds 3 and 4 read (8 calls).
    assert.ok(writes.length === 4 && reads.length === 8, `4 writes (round 2) and 8 reads (rounds 3 and 4), got ${writes.length}/${reads.length}`);
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

// CHANGED ACCEPTED (0.8.4 cache part a, C&C's correction of 09 Nov 2026) and CHANGED ACCEPTED TEST (0.8.4 apply, the order is live; the shape change C&C ruled for ending-exchange-cost on 11 Nov 2026, applied here (C&C's walk confirms the extension): the pin moves to the order-live shape). OLD (cache part a): the first marked round (2) at the write price (`-x2`) and rounds 3..R at the read price (`-x3`); the expected figure with the switch on equalled the switch-off figure ("one exchange round, never marked"). NEW: with the order live ruling B's rows do not exist (its marks are not sent, src/cost.js pushExchangeRows). A direct Anthropic layer-1 seat that the order marks has ONE row per call kind on each pass, every call at the read price (the panel before the exchange wrote the group's entry), so the exchange rows cost less per call than the switch-off rows, the expected figure with the switch on is at or below the switch-off figure, and the maximum is at or below it too. WHY: the box probe of job 18 printed this config's rows (ldebate-L1-a: 9 calls, $0.77 cached against $2.39 uncached; expected $0.033 against $0.123; no -x2/-x3 row); the money direction is the one this test always asserted. The rule at its source (exchangeCallCarriesHead) is unchanged.
test('the dry run: with the order live the exchange rows of a marked direct Anthropic layer-1 seat read the entry the panel wrote (one row per kind, no ruling-B rows), and both figures are at or below the switch-off figure', () => {
  const seat = (lab, layer) => ({ provider: 'anthropic', model: 'claude-sonnet-5', lab, layer, maxTokens: 2000 });
  const config = { name: 'dry', signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 20000, draftTokens: 30000, critiqueTokens: 2000 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [seat('a', 1), seat('b', 1), seat('c', 2), seat('d', 3)] } };
  const on = { ...config, prompt_cache: { enabled: true } };
  const sum = (cfg, maximum) => estimateChainRows(cfg, { maximum }).reduce((t, r) => t + r.usd, 0);
  assert.ok(sum(on, false) <= sum(config, false), 'the expected figure with the switch on is at or below the switch-off figure');
  assert.ok(sum(on, true) <= sum(config, true), 'the maximum with the switch on is at or below the maximum with it off');
  // CHANGED ACCEPTED TEST (0.8.4 boundary fix-up; C&C's ruling of 11 Nov 2026). OLD (before 62ea42bd): the expected figure with the switch on EQUALLED the switch-off figure; 62ea42bd loosened both sums to `<=` because the live order makes the on-figure lower, so a dollar move of the marked rows
  // (a few cents against the exchange's read savings) showed nowhere. NEW: the four sums of this config are pinned as constants (taken from the box output of the edit tree, whose src is the committed tree's: probe_sums): they guard against DRIFT only; that they are right is shown by the per-kind gap table
  // (test/cost-boundary-panel-kinds.test.js) and by the by-label dump of the move, which was every panel, re-ask, `-solo`, sign-off re-ask and final-read row and no exchange row. The two switch-OFF sums did not move with the fix-up (state M is untouched); the two switch-ON sums did (the boundary lines in the input
  // and in the marked head of the panel at the write price and the re-ask, `-solo` and sign-off re-ask at the read price). WHY: the `<=` rows cannot see a money move of a few cents; the constants can. Collected, so one drifting sum does not hide another.
  const PINNED = { 'expected, switch on': 0.6776195999999999, 'expected, switch off': 0.987016, 'maximum, switch on': 11.4526458, 'maximum, switch off': 23.763490000000008 };
  const GOT = { 'expected, switch on': sum(on, false), 'expected, switch off': sum(config, false), 'maximum, switch on': sum(on, true), 'maximum, switch off': sum(config, true) };
  assert.deepEqual(Object.entries(PINNED).filter(([k, v]) => !(Math.abs(GOT[k] - v) < 1e-9)).map(([k, v]) => `${k}: ${GOT[k]} !== ${v}`), [], 'the four sums of the dry run of this config are the recorded ones');
  const rows = estimateChainRows(on, { maximum: true }), offRows = estimateChainRows(config, { maximum: true });
  const post = rows.find(r => r.label === 'ldebate-L1-a'), offPost = offRows.find(r => r.label === 'ldebate-L1-a');
  assert.ok(post && offPost, 'the ordinary exchange has one row per kind');
  assert.ok(!rows.some(r => /^(ldebate|lreply)-L\d-.*-x[23]$/.test(r.label)), 'ruling B\'s rows (-x2, -x3) do not exist with the order live');
  assert.ok((post.usd / (post.times ?? 1)) < (offPost.usd / (offPost.times ?? 1)), 'a call of the marked seat reads the entry: it costs less per call than the switch-off call');
  assert.ok(!rows.some(r => /panel-L\d-.*-x2/.test(r.label)), 'no panel row is marked');
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: the dry run of a chain with `layer_debate.rounds` 2 has no marked row. NEW: the rule at its source: an exchange of two rounds has no call that carries the head (no chain can set two rounds any more; the maximum is seven). WHY: the number of rounds is not a setting.
  assert.equal(exchangeCallCarriesHead({ ttl: '1h', k: 2, rounds: 2 }), false, 'a two-round exchange has nothing to read, so nothing is marked');
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

// ---- 0.8.4 cache part a, the cap as RESULTS (C&C 09 Nov 2026): R1 the dry run with the switch on is at or below the same chain with it off, both figures; R2 the per-call guard still errs high; R3 the settled line follows the counts. ----
const chainFile = f => JSON.parse(readFileSync(new URL(`../chains/${f}`, import.meta.url), 'utf8'));
test('R1: the dry run of a shipped chain with prompt_cache ON is at or below the same chain with it OFF, for the expected AND the maximum figure, at both lifetimes; the maximum is not "every cache call misses" (EXCHANGE_ROUNDS is fixed at 7, so a round budget of 3 cannot occur in the dry run)', () => {
  const off = { ...chainFile('plan-the-high-council.json'), prompt_cache: undefined };      // CHANGED ACCEPTED (0.8.4 cache part (b)2 step (a), 10 Nov 2026; found by the box set): OLD the shipped chain file had no prompt_cache switch, so the file as it stands was the switch-OFF side of this comparison. NEW the seven shipped planning chains carry the switch on, so the OFF side is the file with the switch taken out. WHY: the comparison is on-versus-off; with the file as the off side it compared two lifetimes (the 1-hour maximum read higher than the 5-minute figure the file now carries).
  const sum = (cfg, maximum) => estimateChainRows(cfg, { maximum }).reduce((t, r) => t + r.usd, 0);
  for (const ttl of ['1h', '5m']) {
    const on = { ...off, prompt_cache: { enabled: true, ttl } };
    assert.ok(sum(on, false) <= sum(off, false) + 1e-9, `expected figure, ${ttl}: ${sum(on, false)} vs ${sum(off, false)}`);
    assert.ok(sum(on, true) <= sum(off, true) + 1e-9, `maximum figure, ${ttl}: ${sum(on, true)} vs ${sum(off, true)}`);
    const rows = estimateChainRows(on, { maximum: true });
    // CHANGED ACCEPTED TEST (0.8.4 apply, the order is live; the shape change C&C ruled for ending-exchange-cost, applied here). OLD: at 5 minutes the layer-1 exchange carried ruling B's marked rows (-x2, -x3), at 1 hour none. NEW: with the order live ruling B's rows do not exist at either lifetime (src/cost.js pushExchangeRows); the on-versus-off comparison above is what this row guards. WHY: job 16 showed the 1h half red ('no marked row at a three-round budget, 1h'): its `-x[23]$` pattern also matches the ending exchange's `ldebate-end-L1-<lab>-x2` read row, which is built with the order live (src/cost.js pushExchangeRows, the ending exchange's first post writes and the rest read); the 5m half never ran, because the loop reaches 1h first. The new pattern names the ordinary exchange (`-L<n>-`) only.
    assert.ok(!rows.some(r => /^(ldebate|lreply)-L\d-.*-x[23]$/.test(r.label)), `no ruling-B row in an ordinary exchange with the order live, ${ttl}`);
  }
});

test('R2 (NAMED PIN: the parent already reserves this; FAIL CONDITION: a marked call\'s reservation line is below the projection of its prompt with the head at the write price): the reservation line of a marked call prices its head at the WRITE price: every `reserved` line of the exchange equals the projection of the prompt that was sent (marked calls with the head at the write price, round 1 unmarked), and each marked one is dearer than the same prompt unmarked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-r2-'));
  setReservationSink(openReservations(dir));
  const { run, sent } = await exchangeWith((n, body) => standing(n, body));
  try {
    await run();
    const lines = reservationLinesOf(dir).filter(l => l.event === 'reserved').map(l => l.usd).sort((x, y) => x - y);
    const seat = SONNET('xa');
    const expected = sent.map(b => {
      const marked = Array.isArray(b.messages[0].content);
      const user = marked ? b.messages[0].content.map(x => x.text).join('') : b.messages[0].content;
      const plain = projectAttempts(seat, { system: b.system, user });
      const withHead = marked ? projectAttempts(seat, { system: b.system, user, cache: { headChars: b.system.length + b.messages[0].content[0].text.length, ttl: '1h' } }) : plain;
      if (marked) assert.ok(withHead.first + withHead.retry > plain.first + plain.retry, 'the marked projection is dearer than the same prompt unmarked');
      return withHead.first + withHead.retry;
    }).sort((x, y) => x - y);
    assert.equal(lines.length, expected.length, 'one reservation per call sent');
    lines.forEach((u, i) => assert.ok(Math.abs(u - expected[i]) < 1e-9, `reservation ${i}: ${u} vs projection ${expected[i]}`));
  } finally { setReservationSink(null); globalThis.__restore(); rmSync(dir, { recursive: true, force: true }); }
});
