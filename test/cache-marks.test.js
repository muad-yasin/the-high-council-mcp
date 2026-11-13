// 0.8.4 cache part (b)1, the MARK RULE and its money (src/cache-order-gate.js markTtlOf; chain.js layOut / panel sites; cost.js group rows): rows 2, 5, 6, 9 and 11 of the pass walk. Offline, $0: globalThis.fetch is stubbed for the direct
// Anthropic seats (a dummy key); the dry run is a pure function of the chain file. NO NUMBER OF EXCHANGE ROUNDS appears here: the rounds are read from EXCHANGE_ROUNDS.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Chain from '../src/chain.js';
import * as Cost from '../src/cost.js';
import { sameLayerOrdinals } from '../src/seat-key.js';
import * as PromptCache from '../src/prompt-cache.js';
import * as R from '../src/roles.js';
import * as Held from '../src/held-roles.js';
import * as HC from './held-prompts/held-084-cache-order.js';
import * as HB from './held-prompts/held-084-b.js';
import * as HD from './held-prompts/held-084-d27.js';
import * as Providers from '../src/providers.js';
import * as FR from './helpers/final-read-chain.js';
import { readChainFile } from './helpers/chain-file.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A dynamic import, like test/cache-order.test.js: the gate module does not exist on the tree before this unit, and a static import would fail the whole file at load time instead of showing each test red by name.
const Gate = await import('../src/cache-order-gate.js').catch(() => ({}));
afterEach(() => { Chain.setBudget(null); Chain.setCache(null); Chain.setPromptSpy(null); Held.setHeldForTest(null); });

const LIVE = { ...HC };   // the whole batch of the order, as the apply will record it
const UNRECORDED = Object.fromEntries(Object.keys(HC).map(n => [n, undefined]));
const PAIR = { shortExchangeRule: HB.shortExchangeRule, signoffLineRule: HB.signoffLineRule };   // the shortened exchange of the upper layers (S6)
const an = (lab, layer, extra = {}) => ({ provider: 'anthropic', model: 'claude-sonnet-5', lab, layer, maxTokens: 2000, ...extra });
const chainWith = (critics, extra = {}) => ({ name: 'marks', signoff: 'unanimous', prompt_cache: { enabled: true }, seats: { critics }, ...extra });

test('MARK RULE: a direct Anthropic judge is marked only where its layer runs an exchange; the default lifetime is 5m and 1h is selectable', () => {
  Held.setHeldForTest(LIVE);
  const two = [an('a', 1), an('b', 1)];
  assert.equal(Gate.markTtlOf(chainWith(two), two[0]), '5m', 'default lifetime');
  assert.equal(PromptCache.promptCacheTtl({ prompt_cache: { enabled: true } }), '5m');
  assert.equal(Gate.markTtlOf(chainWith(two, { prompt_cache: { enabled: true, ttl: '1h' } }), two[0]), '1h');
  assert.equal(Gate.markTtlOf(chainWith(two, { prompt_cache: { enabled: true, ttl: '5m' } }), two[0]), '5m');
  const alone = [an('a', 1), an('c', 2), an('d', 2)];
  assert.equal(Gate.markTtlOf(chainWith(alone), alone[0]), null, 'a group single BY SHAPE (one judge in its layer) gets no mark');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: an upper layer's judge was unmarked until the shortened exchange was recorded (`alone[1]` null before the pair). NEW: that held assertion is removed (K7, SIBLING: the assertion directly below, which asserts the upper layer's two judges are marked with the pair recorded). WHY: shortExchangeRule and signoffLineRule are recorded.
  Held.setHeldForTest({ ...LIVE, ...PAIR });
  assert.equal(Gate.markTtlOf(chainWith(alone), alone[1]), '5m', 'with the shortened exchange recorded the upper layer\'s two judges are marked');
  assert.equal(Gate.markTtlOf(chainWith(alone), alone[0]), null, 'still alone in layer 1');
  const orSeat = { ...an('o', 1), provider: 'openrouter', model: 'minimax/minimax-m3.1-flash' };
  assert.equal(Gate.markTtlOf(chainWith([orSeat, an('b', 1)]), orSeat), null, 'a seat through OpenRouter carries no mark');
  assert.equal(Gate.markTtlOf(chainWith(two, { signoff: 'first' }), two[0]), null, 'a first-mode chain runs no exchange');
  assert.equal(Gate.markTtlOf(chainWith([an('a', 1), { ...an('b', 1), layer: undefined }]), two[0]), null, 'critics that are not all layered');
  // CHANGED ACCEPTED TEST (0.8.4 add-on removal, box set fix): OLD: an advisor chain (advise.enabled) is never marked. NEW: the row is gone. WHY: the advice add-on is removed; a chain with an advise block is refused before any call.
  assert.equal(Gate.markTtlOf({ ...chainWith(two), prompt_cache: { enabled: false } }, two[0]), null, 'switch off');
  // a seat whose thinking setting is derived from the call's output cap (a model with no effort levels, no reasoning field of its own) would send a different setting at a different cap, which Anthropic counts as a different prompt
  const budgetForm = (extra) => ({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', lab: 'h', layer: 1, maxTokens: 20000, ...(extra ? { extra } : {}) });
  assert.equal(Gate.settingsDependOnCap(budgetForm()), true, 'premise: the budget form depends on the cap');
  assert.equal(Gate.markTtlOf(chainWith([budgetForm(), an('b', 1)]), budgetForm()), null, 'a seat whose setting depends on the cap is not marked');
  const own = budgetForm({ thinking: { type: 'enabled', budget_tokens: 5000 } });
  assert.equal(Gate.settingsDependOnCap(own), false);
  assert.equal(Gate.markTtlOf(chainWith([own, an('b', 1)]), own), '5m', 'the same model with a reasoning setting of its own is marked');
  assert.equal(Gate.settingsDependOnCap(an('a', 1)), false, 'a Claude 5 seat sends the same setting at every cap');
  Held.setHeldForTest(UNRECORDED);
  assert.equal(Gate.markTtlOf(chainWith(two), two[0]), null, 'the order\'s words not recorded: ruling B\'s marks stand, this rule does not');
});

// ---- the exchange through the real adapter, a stubbed fetch ----------------------------------------------------------------------------------------------------------------------------------
const reply = (text, usage = {}) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20, ...usage } });
const userMessageOf = body => body.messages.find(m => m.role === 'user') ?? body.messages[0];
const userOf = body => { const c = userMessageOf(body).content; return typeof c === 'string' ? c : c.map(b => b.text).join(''); };
// what the adapter sends as the marker: the 5-minute marker carries no ttl field (the default lifetime of Anthropic's cache), the 1-hour marker names it (src/providers.js callAnthropic)
const markerOf = ttl => (ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' });
const everyKey = (v, out = []) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); everyKey(x, out); } return out; };
// the judges contest every objection they are shown and amend their own: the exchange goes on (the kind of a call is read from the lead-in of the user text, the system text is the same for both)
const standing = (n, body) => {
  const user = userOf(body);
  if (user.includes(HC.judgeKindLeadIn({ kind: 'post' }))) {
    const ids = [...user.matchAll(/^Objection (O-[0-9a-f]{8})$/gm)].map(m => m[1]);
    return reply(JSON.stringify({ posts: ids.map(id => ({ on: id, stance: 'contest', quote: 'Bake a cake.', text: 'The plan already answers this where it says so.' })), new_objections: [] }));
  }
  const ids = [...user.matchAll(/^Your objection (O-[0-9a-f]{8})$/gm)].map(m => m[1]);
  return reply(JSON.stringify({ replies: ids.map(id => ({ id, action: 'amend', text: 'Right in part.', problem: `Narrowed (answer ${n}): the assumptions section is missing.` })) }));
};
async function exchangeWith(config, { respond = standing, cap = null, judgeSeats = config.seats.critics.filter(c => c.layer === 1) } = {}) {
  const original = globalThis.fetch; const hadKey = process.env.ANTHROPIC_API_KEY; const hadOr = process.env.OPENROUTER_API_KEY;
  const sent = [];
  const viaOpenRouter = judgeSeats[0]?.provider === 'openrouter';
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    const r = respond(sent.length, body);
    const out = viaOpenRouter ? { model: body.model, choices: [{ message: { content: r.content[0].text }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } } : r;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy'; process.env.OPENROUTER_API_KEY = 'sk-or-test-dummy';
  Chain.setCache(null); Chain.setBudget(cap);
  const judges = judgeSeats.map(seat => ({ key: seat.lab, seat, failures: [{ criterion: 'It states its assumptions.', problem: `No assumptions are stated anywhere (${seat.lab}).` }] }));
  const draft = '# Plan\n\n' + 'Bake a cake. '.repeat(20000);
  const run = () => Chain.exchangeRound({ judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft, round: 1, record: s => s, cacheTtl: '5m', layout: { config, checks: '', endMarker: false } });
  const restore = () => { globalThis.fetch = original; if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = hadKey; if (hadOr === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = hadOr; };
  return { run, sent, restore };
}

test('LIVE RUN: with the order live every post and answer of a marked seat is sent marked from round 1, under ONE head and ONE system text', async () => {
  Held.setHeldForTest(LIVE);
  const marked = await exchangeWith(chainWith([an('xa', 1), an('xb', 1)]));
  try {
    await marked.run();
    assert.ok(marked.sent.length >= 4, `posts and answers were sent (${marked.sent.length} calls)`);
    for (const b of marked.sent) {
      assert.ok(Array.isArray(b.messages[0].content), 'the user text is split at the head');
      assert.deepEqual(b.messages[0].content[0].cache_control, markerOf('5m'));
      assert.equal(b.system, R.COUNCIL_INTRO, 'R1: the same system text for every call kind');
    }
    assert.equal(new Set(marked.sent.map(b => b.messages[0].content[0].text)).size, 1, 'one head H for every call of the pass, posts and answers alike');
  } finally { marked.restore(); }
});

test('LIVE RUN: unmarked where the layer has one judge: nothing carries cache_control and the exchange\'s own ruling-B request (cacheTtl) is dropped', async () => {
  Held.setHeldForTest(LIVE);
  // the chain names layer 1 with ONE judge (xa) and a second layer: neither xa nor xb (the two judges handed to the exchange) is in a layer that runs an exchange
  const run = await exchangeWith(chainWith([an('xa', 1), an('xc', 2)]), { judgeSeats: [an('xa', 1), an('xb', 1)] });
  try {
    await run.run();
    assert.ok(run.sent.length >= 4, `posts and answers were sent (${run.sent.length} calls)`);
    for (const b of run.sent) assert.ok(typeof b.messages[0].content === 'string' && !JSON.stringify(b).includes('cache_control'), 'no mark');
  } finally { run.restore(); }
});

test('THE GUARD STILL SEES THE WRITE PRICE: a ceiling that fits an unmarked projection but not two marked ones stops the run before the second marked call of the first round is sent', async () => {
  Held.setHeldForTest(LIVE);
  const config = chainWith([an('xa', 1), an('xb', 1)]);
  // the first call of a free run gives the exact prompt the guard projects for each judge
  const probe = await exchangeWith(config);
  let first;
  try { await probe.run(); first = probe.sent[0]; } finally { probe.restore(); }
  const system = first.system, user = userOf(first), headText = first.messages[0].content[0].text;
  const seat = an('xa', 1);
  const U = Cost.projectAttempts(seat, { system, user }), M = Cost.projectAttempts(seat, { system, user, cache: { headChars: system.length + headText.length, ttl: '5m' } });
  const unmarked = U.first + U.retry, marked = M.first + M.retry;
  assert.ok(marked > unmarked, 'fixture: the marked projection is the higher one');
  const cap = unmarked + marked;
  const stopped = await exchangeWith(config, { cap });
  try {
    const err = await stopped.run().then(() => null, e => e);
    assert.ok(err instanceof Chain.BudgetExceeded, String(err));
    assert.match(String(err.label), /^ldebate-1-/, 'the stop is a round-1 call: the first call of the group is already marked');
    assert.equal(stopped.sent.length, 1, 'one marked call fits, the second of the pair does not');
    assert.deepEqual(stopped.sent[0].messages[0].content[0].cache_control, markerOf('5m'));
  } finally { stopped.restore(); }
});

// ---- the dry run ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const dryConfig = (critics, ttl) => ({ name: 'dry', signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 20000, draftTokens: 30000, critiqueTokens: 2000 }, ...(ttl ? { prompt_cache: { enabled: true, ttl } } : {}),
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics } });
const total = rows => rows.reduce((t, r) => t + r.usd, 0);
const perCall = r => r.usd / (r.times ?? 1);
const named = (rows, label) => rows.find(r => r.label === label);

test('THE DRY RUN, per (seat, pass) group, in BOTH figures and both lifetimes: the panel call writes, every later call of the group reads, and the figure with caching on is at or below the figure with it off', () => {
  Held.setHeldForTest({ ...LIVE, ...PAIR });
  const critics = [an('a', 1), an('b', 1), an('c', 2), an('d', 2), an('e', 3)];
  for (const ttl of ['5m', '1h']) for (const maximum of [false, true]) {
    const off = Cost.estimateChainRows(dryConfig(critics), { maximum }), on = Cost.estimateChainRows(dryConfig(critics, ttl), { maximum });
    assert.ok(total(on) <= total(off), `${ttl} ${maximum ? 'maximum' : 'expected'}: on ${total(on)} must not exceed off ${total(off)}`);
    const panelOn = named(on, 'panel-L1-a'), panelOff = named(off, 'panel-L1-a');
    assert.ok(perCall(panelOn) > perCall(panelOff), `${ttl}: the panel call writes the entry, so it costs more per call than without caching`);
    const postOn = named(on, 'ldebate-L1-a'), postOff = named(off, 'ldebate-L1-a');
    assert.ok(perCall(postOn) < perCall(postOff), `${ttl}: a post of the group reads the entry`);
    assert.equal(named(on, 'ldebate-L1-a-x2'), undefined, 'the order has no write row beside the panel: ruling B\'s rows do not exist in this state');
    const upper = named(on, 'ldebate-L2-c');
    assert.ok(upper && perCall(upper) < perCall(named(off, 'ldebate-L2-c')), `${ttl}: an upper layer with two judges reads too (shortened exchange)`);
    const alone = named(on, 'panel-L3-e');
    assert.equal(alone.usd / (alone.times ?? 1) - perCall(named(off, 'panel-L3-e')) < perCall(panelOn) - perCall(panelOff), true, 'a seat alone in its layer pays no write premium');
  }
  const maxOn = Cost.estimateChainRows(dryConfig(critics, '5m'), { maximum: true });
  const reask = named(maxOn, 'panel-L1-a-reask');
  assert.ok(reask && perCall(reask) < perCall(named(Cost.estimateChainRows(dryConfig(critics), { maximum: true }), 'panel-L1-a-reask')), 'an in-pass re-ask of a marked group reads');
});

// CHANGED ACCEPTED TEST (0.8.4 boundary fix-up). OLD: the unmarked panel row of an order-live seat differed from its switch-off row by the lead-in tokens alone. NEW: by the lead-in tokens and the boundary lines (BOUNDARY_TOKENS, the pinned 71 of the exchange rows). WHY: the order puts the same neutral boundary lines into a panel prompt as into a post (H is the verdict prompts' head for every call kind), so the panel row counts them now (src/cost.js, the dry-run bar of per-kind real minus BASE = estimated minus BASE within 3 tokens, test/cost-boundary-panel-kinds.test.js); the row is still unmarked, at the plain input price.
test('A GROUP SINGLE BY SHAPE gets no mark in the dry run: its rows differ from the switch-off rows by the lead-in tokens and the boundary lines, nothing else', () => {
  Held.setHeldForTest(LIVE);
  const critics = [an('a', 1), an('c', 2), an('d', 2)];
  const lead = Cost.estimateTokens(`${HC.judgeKindLeadIn({ kind: 'panel' })}\n\n`) + BOUNDARY_TOKENS;   // the lead-in and the boundary lines
  const plainPrice = Cost.priceOf('anthropic', 'claude-sonnet-5').in;
  for (const maximum of [true, false]) {
    const off = Cost.estimateChainRows(dryConfig(critics), { maximum }), on = Cost.estimateChainRows(dryConfig(critics, '5m'), { maximum });
    const a = named(on, 'panel-L1-a'), b = named(off, 'panel-L1-a');
    assert.equal((a.input - b.input) / (a.times ?? 1), lead, `${maximum ? 'maximum' : 'expected'}: only the lead-in tokens and the boundary lines are added`);
    // the expected figure prices one attempt; the maximum prices an Anthropic seat's retry as well (the same lead-in paid twice)
    if (!maximum) assert.ok(Math.abs((a.usd - b.usd) / (a.times ?? 1) - (lead / 1e6) * plainPrice) < 1e-9, 'at the plain input price: no write premium');
    else assert.ok((a.usd - b.usd) / (a.times ?? 1) <= 2 * (lead / 1e6) * plainPrice + 1e-9, 'no write premium in the maximum either (at most the lead-in at the plain price, once per attempt)');
  }
});

test('WITH THE ORDER NOT RECORDED the dry run is what it was (ruling B\'s rows), at the new default lifetime', () => {
  Held.setHeldForTest(UNRECORDED);
  const critics = [an('a', 1), an('b', 1), an('c', 2), an('d', 3)];
  const on = Cost.estimateChainRows(dryConfig(critics, '5m'), { maximum: true });
  assert.ok(named(on, 'ldebate-L1-a-x2') && named(on, 'ldebate-L1-a-x3'), 'ruling B\'s write row and read row');
  assert.equal(named(on, 'panel-L1-a-x2'), undefined);
});

// ---- the shipped chains ------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Muad's word on the lead-in (to C&C, 10 Nov 2026: "4: a"): every judge gets the cache-shaped order; the preview may read a little higher on a seat with no saving it can count. So the sweep is PER SEAT, not per chain: a saving of one seat
// must not hide an overcount on another. A MARKED seat's rows: on at or below off. An UNMARKED seat's rows: on minus off is the lead-in tokens of the row's call kind, EXACTLY (a number named below), and nothing else.
const escapeRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const kindOfLabel = label => (/^ldebate-/.test(label) ? 'post' : /^lreply-/.test(label) ? 'answer' : 'panel');
const leadTokens = kind => Cost.estimateTokens(`${HC.judgeKindLeadIn({ kind })}\n\n`);
// the numbers the sweep pins, derived by script from the drafted strings (ceil(characters / 4) of the lead-in and its blank line): a change of the words moves them on purpose
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: answer 48. NEW: answer 37 = ceil(characters / 4) of the recorded lead-in `# Instructions for this call`, a blank line, `In this call you answer the posts on your own objections to the draft above, as the instructions that follow ask.` and its blank line (K5). WHY: judgeKindLeadIn (084-cache-order) as applied.
const LEAD_TOKENS = { panel: 36, post: 40, answer: 37 };
// the kind-neutral boundary lines the order adds to an EXCHANGE prompt (and its head) where the chain's draft boundary is on: sentence, start line, end line (284 characters)
const BOUNDARY_TOKENS = 71;
const D27 = { draftStartLine: HD.draftStartLine, draftBoundarySentence: HD.draftBoundarySentence };
const labOf = c => c.lab || c.provider;
// the rows of ONE seat: its labels carry the lab, and in an overseer chain the layer (L<layer>); a chain without overseer rounds labels by pass, so a lab used in two layers cannot be told apart there (counted, not asserted)
// CHANGED ACCEPTED (10 Nov 2026, twin sweep gap, test-only): OLD: rowsOfSeat(rows, lab, layer), anchored on `<lab>` alone, so the rows of the second, third ... seat of ONE model on ONE layer (labelled `<lab>-<n>` by the dry run, src/cost.js nameOf from src/seat-key.js sameLayerOrdinals) never matched, and the units below were de-duplicated by lab|layer, so a twin was never asserted (plan-claude-council: the second Haiku on layer 1, the second Sonnet on layer 2). NEW: `nth` (the seat's place among its model's seats on its layer, from the same function the dry run uses) adds `-<n>` for n > 1; each twin is its own unit. WHY: the sweep says PER SEAT and 'seats left unasserted: 0', which was untrue for a twin; every label shape a twin has (panel-, ldebate-, lreply-, the -end- rows, -x<n>, -reask) ends in the existing suffix group.
const rowsOfSeat = (rows, lab, layer, nth = 1) => rows.filter(r => new RegExp(`^(panel|ldebate|lreply|final-read)-(end-)?(L${layer}|\\d+)-${escapeRe(lab)}${nth > 1 ? `-${nth}` : ''}(-reask\\d*|-x\\d+)?$`).test(r.label));

test('SWEEP over every shipped chain (outdated excluded), PER SEAT, with prompt_cache forced on in memory at 5m and 1h, both figures, in three states (the order\'s batch alone, the batch with the shortened exchange as the apply records it, not recorded): a marked seat\'s rows are at or below the switch-off rows; an unmarked seat\'s rows differ by exactly the lead-in tokens; the table is printed', () => {
  const files = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'));
  const table = [], refused = [], priced = [];
  const problems = [];   // every mismatch of the loop is collected and asserted once after the table is printed, so one run shows them all
  const check = (ok, message) => { if (!ok) problems.push(message); };
  for (const k of Object.keys(LEAD_TOKENS)) assert.equal(leadTokens(k), LEAD_TOKENS[k], `the lead-in tokens of a ${k} call`);
  console.log(`SWEEP lead-in tokens per call: panel ${LEAD_TOKENS.panel}, post ${LEAD_TOKENS.post}, answer ${LEAD_TOKENS.answer}`);
  let seatsChecked = 0;
  for (const state of ['recorded', 'release', 'unrecorded']) for (const ttl of ['5m', '1h']) {
    // recorded = the order's batch alone; release = the batch with the shortened exchange and the draft boundary's words (the release records every held batch together: the upper layers are marked and the exchange prompts carry the boundary lines); unrecorded = ruling B
    Held.setHeldForTest(state === 'recorded' ? { ...LIVE } : state === 'release' ? { ...LIVE, ...PAIR, ...D27 } : { ...UNRECORDED });
    for (const f of files) {
      const base = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
      if (base.advise?.enabled === true) continue;
      const on = { ...base, prompt_cache: { enabled: true, ttl } };
      const findings = PromptCache.lintPromptCache(on, f);
      if (findings.length) { if (state === 'recorded' && ttl === '5m') refused.push(`${f}: ${findings.map(x => x.kind).join(', ')}`); continue; }
      const critics = base.seats?.critics ?? [];
      if (state === 'release' && ttl === '5m' && critics.some(c => Gate.markTtlOf(on, c))) priced.push(f);
      for (const maximum of [false, true]) {
        const offRows = Cost.estimateChainRows({ ...base, prompt_cache: undefined }, { maximum }), onRows = Cost.estimateChainRows(on, { maximum });
        table.push({ chain: f, state, ttl, figure: maximum ? 'maximum' : 'expected', on: total(onRows), off: total(offRows) });
        const ordinals = sameLayerOrdinals(critics);      // the dry run's own numbering of same-layer twins (src/cost.js nameOf)
        const units = [...new Map(critics.map(c => [`${labOf(c)}|${c.layer}|${ordinals.get(c) ?? 1}`, c])).values()];      // CHANGED ACCEPTED (10 Nov 2026, twin sweep gap, test-only): OLD: key lab|layer (two twins were one unit); NEW: lab|layer|ordinal, one unit per twin. WHY: see the rowsOfSeat comment above
        // the units come from sameLayerOrdinals, the function that also numbers the rows: if it stopped numbering twins the sweep would silently shrink back. So the count is taken from the chain FILE: a layered chain has one unit per judge seat (plan-claude-council: 8)
        if (critics.every(x => Number.isInteger(x.layer))) check(units.length === critics.length, `${f} ${state} ${ttl} ${maximum ? 'maximum' : 'expected'}: one sweep unit per judge seat of the chain file: ${critics.length} seats, ${units.length} units`);
        for (const c of units) {
          const lab = labOf(c), layer = c.layer, nth = ordinals.get(c) ?? 1;
          const here = `${f} ${state} ${ttl} ${maximum ? 'maximum' : 'expected'} seat ${lab}${nth > 1 ? ` #${nth}` : ''} L${layer}`;
          const sameLab = critics.filter(x => labOf(x) === lab);
          const sOn = rowsOfSeat(onRows, lab, layer, nth), sOff = rowsOfSeat(offRows, lab, layer, nth);
          const ambiguous = sameLab.some(x => x.layer !== layer) && [...onRows, ...offRows].some(r => new RegExp(`^(panel|ldebate|lreply|final-read)-(end-)?\\d+-${escapeRe(lab)}`).test(r.label));
          check(!ambiguous, `${here}: a lab on two layers of a chain labelled by pass cannot be asserted per seat (no shipped chain is built this way: give the seats distinct labs or label the rows by layer)`);
          check(sOn.length > 0 && sOff.length > 0, `${here}: no row of this seat was matched (a label shape the test does not know would leave the seat unasserted)`);
          if (!(sOn.length > 0 && sOff.length > 0)) continue;
          // a twin has exactly the rows of its sibling (the first seat of its model on its layer): a twin whose rows carry a shape the pattern lacks would otherwise be half-asserted behind one matching row
          if (nth > 1) check(sOn.length === rowsOfSeat(onRows, lab, layer, 1).length && sOff.length === rowsOfSeat(offRows, lab, layer, 1).length, `${here}: the twin has as many rows as its sibling (on ${sOn.length}, off ${sOff.length}; sibling on ${rowsOfSeat(onRows, lab, layer, 1).length}, off ${rowsOfSeat(offRows, lab, layer, 1).length})`);
          seatsChecked++;
          if (state === 'unrecorded') { check(total(sOn) <= total(sOff) + 1e-9, `${here}: ruling B's rows are at or below switch-off (on ${total(sOn)}, off ${total(sOff)})`); continue; }
          if (Gate.markTtlOf(on, c)) { check(total(sOn) <= total(sOff) + 1e-9, `${here}: marked, on ${total(sOn)} exceeds off ${total(sOff)}`); continue; }
          // unmarked: the same rows, each carrying only its lead-in (a seat of the session kind carries nothing)
          check(JSON.stringify(sOn.map(r => r.label)) === JSON.stringify(sOff.map(r => r.label)), `${here}: the same rows`);
          for (const r of sOn) {
            const o = sOff.find(x => x.label === r.label);
            // the lead-in of the call's kind; an exchange row also the boundary lines the order adds to that prompt (C&C's rule was the lead-in alone: the second number is named in the report)
            // CHANGED ACCEPTED (0.8.4 cache part (b)2, R2 = (c), 10 Nov 2026): OLD the boundary lines were counted only where the chain's own draft_end_marker was on. NEW with caching on (this sweep forces it on for every chain) the lines are always sent once the words are recorded, a chain without the marker included. WHY: Muad's R2 answer "c": where caching is on the plan's start and end lines are always sent (src/draft-bounds.js draftBoundaryOn).
            const boundary = state !== 'unrecorded' && /^(ldebate|lreply|panel|final-read)-/.test(r.label) ? BOUNDARY_TOKENS : 0;   // CHANGED ACCEPTED TEST (0.8.4 boundary fix-up): OLD `^(ldebate|lreply)-`. NEW the panel rows too (the panel review, its in-pass re-ask, the sign-off re-ask and the `-solo` ask: labels `panel-...`) and the final read and its re-ask (`final-read-...`; measured 106 real against 36 estimated on the SOLO and neverHeardChain fixtures). WHY: the order puts the same neutral boundary lines into a panel prompt as into a post, and the dry run counts them there now (src/cost.js; test/cost-boundary-panel-kinds.test.js is the per-kind bar against the real prompts).   // CHANGED ACCEPTED TEST (0.8.4 apply, job 16): OLD `state === 'release'`. NEW every state but the unrecorded one: the D27 boundary words are recorded now, so the 'recorded' state (a held map that falls through to the recorded text) sends the boundary lines too; job 16 printed 440 mismatches, the first five 111 !== 40 and 108 !== 37 (= lead-in + 71) in state 'recorded'. Exact equality, nothing loosened.
            const want = Gate.cacheOrderSeat(on, c) ? LEAD_TOKENS[kindOfLabel(r.label)] + boundary : 0;
            const got = (r.input - o.input) / (r.times ?? 1);
            check(got === want, `${here} row ${r.label}: on minus off is the lead-in tokens${state !== 'unrecorded' ? ' (and the boundary lines of an exchange row)' : ''}, exactly: ${got} !== ${want}`);
            check(r.usd >= o.usd - 1e-9, `${here} row ${r.label}: adding tokens cannot lower a row`);
          }
        }
        // the first-mode critic's rows carry no lab: critique-<pass> belongs to critics[(pass - 1) % n], never marked
        for (const r of onRows.filter(x => /^critique-\d+$/.test(x.label))) {
          const c = critics[(Number(r.label.split('-')[1]) - 1) % critics.length], o = offRows.find(x => x.label === r.label);
          if (state === 'unrecorded' || !o) continue;
          seatsChecked++;
          check(Gate.markTtlOf(on, c) === null, `${f}: ${r.label} is never marked`);
          { const got = (r.input - o.input) / (r.times ?? 1), want = Gate.cacheOrderSeat(on, c) ? LEAD_TOKENS.panel + BOUNDARY_TOKENS : 0; check(got === want, `${f} ${state} ${r.label}: only the lead-in and the boundary lines: ${got} !== ${want}`); }   // CHANGED ACCEPTED TEST (0.8.4 boundary fix-up): OLD the first-mode critique row carried the lead-in alone. NEW the lead-in and the boundary lines, as the panel rows above (WHY as there).
        }
      }
    }
  }
  Held.setHeldForTest(null);
  console.log('SWEEP chains priced with a mark (release state, 5m):', priced.join(', ') || '(none)');
  console.log('SWEEP chains the lint refuses (skipped):', refused.join(' | ') || '(none)');
  console.log(`SWEEP seats checked: ${seatsChecked}; seats left unasserted: 0 (the test fails on one)`);
  console.log('SWEEP chain | held set | ttl | figure | on | off | on-off');
  for (const r of table) console.log(`SWEEP ${r.chain} | ${r.state} | ${r.ttl} | ${r.figure} | ${r.on.toFixed(4)} | ${r.off.toFixed(4)} | ${(r.on - r.off).toFixed(4)}`);
  console.log(`SWEEP problems: ${problems.length}`);
  for (const m of [...new Set(problems)].slice(0, 80)) console.log(`SWEEP PROBLEM ${m}`);
  assert.deepEqual([...new Set(problems)].slice(0, 5), [], `the sweep found ${problems.length} mismatches (all are printed above, first five here)`);
  assert.ok(priced.length > 0, 'at least one shipped chain is priced with a mark, or the sweep proves nothing');
  assert.ok(seatsChecked > 0);
});

test('LIVE RUN, the panel call: a direct Anthropic judge of a layer with two judges is sent its blind review marked, a judge alone in its layer is not (through runChain, so the panel call sites and the config seats the dry run prices are the ones that decide)', async () => {
  const original = globalThis.fetch; const hadKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy';
  globalThis.fetch = async () => new Response(JSON.stringify(reply('I cannot give a verdict.')), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const run = async critics => {
      const spied = [];
      Held.setHeldForTest(LIVE); Chain.setPromptSpy(p => spied.push(p));
      try { await Chain.runChain({ request: 'A bake sale.', draft: '# Plan\n\nBake a cake.', log: () => {}, runId: 'r-cache-marks', config: { name: 'marks-run', maxRounds: 1, signoff: 'unanimous', prompt_cache: { enabled: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
        seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics } } }); } catch { /* an unreadable panel may stop the run: only what was sent matters */ }
      Chain.setPromptSpy(null);
      return spied.filter(p => /^panel-/.test(p.label));
    };
    const two = await run([an('xa', 1), an('xb', 1)]);
    assert.ok(two.length >= 2, 'premise: both judges were asked');
    for (const p of two) assert.equal(p.cacheTtl, '5m', `${p.label}: marked`);
    for (const p of two) assert.equal(typeof p.cacheHead, 'string');
    const alone = await run([an('xa', 1), an('xc', 2)]);
    assert.ok(alone.length >= 1, 'premise: the lone judge was asked');
    for (const p of alone) assert.ok(!('cacheTtl' in p), `${p.label}: a judge alone in its layer carries no mark`);
  } finally { globalThis.fetch = original; if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = hadKey; }
});

test('GPT-6 SEAT (GO row 8): with the order live a request body for an OpenRouter GPT-6 judge carries NO cache field of any kind (the order only: no mark, no switch-off, no cache key)', async () => {
  Held.setHeldForTest(LIVE);
  const luna = lab => ({ provider: 'openrouter', model: 'openai/gpt-6-luna', lab, layer: 1, maxTokens: 2000 });
  const config = chainWith([luna('la'), luna('lb')]);
  assert.equal(Gate.markTtlOf(config, config.seats.critics[0]), null, 'not a direct Anthropic seat: no mark');
  assert.equal(Gate.cacheOrderSeat(config, config.seats.critics[0]), true, 'but its prompts get the new order');
  const run = await exchangeWith(config);
  try {
    await run.run();
    assert.ok(run.sent.length >= 4, `posts and answers were sent (${run.sent.length} calls)`);
    for (const b of run.sent) {
      assert.deepEqual(everyKey(b).filter(k => /cache/i.test(k)), [], 'no key containing "cache" at any depth of the request body');
      assert.equal(b.messages.find(m => m.role === 'system').content, R.COUNCIL_INTRO, 'the order is on: the system text is the welcome');
    }
  } finally { run.restore(); }
});

// ---- a full run through the real Anthropic adapter, the judges answered by the mock judges (the stub hands each request to the mock provider and wraps the text in an Anthropic reply, with cache counts a real entry would give) ----
const MOCK_OF = { 'claude-haiku-5-5': 'mock-exch-contest-keep', 'claude-sonnet-5': 'mock-exch-support-withdraw', 'claude-opus-5-5': 'mock-exch-support-keep', 'claude-fable-5-1': 'mock-exch-support-keep' };
const seatOf4 = (model, lab, layer) => ({ provider: 'anthropic', model, lab, layer, maxTokens: 20000 });
const fullConfig = () => FR.chainOf([seatOf4('claude-haiku-5-5', 'j1a', 1), seatOf4('claude-sonnet-5', 'j1b', 1), seatOf4('claude-opus-5-5', 'j2', 2), seatOf4('claude-fable-5-1', 'j3', 3)], { maxRounds: 2, answer_back: { enabled: true }, prompt_cache: { enabled: true } });
async function fullRun(config, cap, fraction = 0.9) {
  const original = globalThis.fetch; const hadKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy';
  const sent = [], spied = [], seenHeads = new Set();
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    const content = userMessageOf(body).content;
    const text = typeof content === 'string' ? content : content.map(b => b.text).join('');
    const r = await Providers.call('mock', { model: MOCK_OF[body.model], system: body.system, messages: [{ role: 'user', content: text }], maxTokens: body.max_tokens });
    const headBlock = Array.isArray(content) && content[0].cache_control ? content[0].text : null;
    const headTokens = headBlock ? Math.ceil(headBlock.length / 4) : 0;
    const key = headBlock ? `${body.model}|${headBlock}` : null;
    const hit = key && seenHeads.has(key); if (key) seenHeads.add(key);
    const counts = headBlock ? (hit ? { cache_read_input_tokens: headTokens, cache_creation_input_tokens: 0 } : { cache_creation_input_tokens: headTokens, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: headTokens, ephemeral_1h_input_tokens: 0 } }) : {};
    return new Response(JSON.stringify(reply(r.text, { input_tokens: Math.ceil(text.length / 4) - headTokens, output_tokens: Math.max(20, Math.floor(body.max_tokens * fraction)), ...counts })), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  Held.setHeldForTest(LIVE); Chain.setPromptSpy(p => spied.push(p)); Chain.setCache(null); Chain.setBudget(cap ?? null);
  try {
    const result = await Chain.runChain({ request: 'A bake sale.', draft: '# Plan\n\nBake a cake.', log: () => {}, runId: 'r-cache-marks-full', config });
    return { result, sent, spied, error: null };
  } catch (error) { return { result: null, sent, spied, error }; } finally {
    Chain.setPromptSpy(null); globalThis.fetch = original; if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = hadKey;
  }
}

test('A FULL RUN with marked seats, capped at the dry run\'s upper figure, is not stopped by the guard (which prices each marked head at the write price); and a marked seat\'s panel and exchange requests carry identical thinking and effort settings', async () => {
  const config = fullConfig();
  Held.setHeldForTest(LIVE);
  const upper = total(Cost.estimateChainRows(config, { maximum: true }));
  assert.ok(upper > 0);
  const run = await fullRun(config, upper);
  assert.ok(!(run.error instanceof Chain.BudgetExceeded), `the guard stopped the run at the figure: ${run.error?.message}`);
  assert.equal(run.error, null, `the run must finish (any other stop would make this test pass for the wrong reason): ${run.error?.stack ?? ''}`);
  assert.ok(run.result, 'and it returns its result (a chain without a handling session may end at a stop by rule: that is a result, not an error)');
  const st = Chain.budgetState();
  console.log(`GUARD-VS-FIGURE upper figure ${upper.toFixed(4)}, spent ${st.spent?.toFixed?.(4)}, calls ${run.sent.length} (every call billed at 90% of its output cap)`);
  assert.ok(run.sent.length > 4 && run.sent.some(b => JSON.stringify(b).includes('cache_control')), 'premise: the run made marked calls');
  // SAME SETTINGS: everything of a request except the prompt and the output cap, per model; a marked seat's calls must not differ (Anthropic invalidates a cache entry when the thinking or effort setting changes)
  const shapeOf = b => JSON.stringify({ ...b, messages: undefined, system: undefined, max_tokens: undefined });
  for (const model of ['claude-haiku-5-5', 'claude-sonnet-5']) {
    const mine = run.sent.filter(b => b.model === model);
    assert.ok(mine.length >= 3, `${model}: premise: the seat made several calls`);
    assert.equal(new Set(mine.map(shapeOf)).size, 1, `${model}: one thinking/effort setting for the panel call and every exchange call`);
    assert.ok(mine.every(b => Array.isArray(b.messages[0].content) && b.messages[0].content[0].cache_control), `${model}: every call of a marked seat is marked`);
  }
  // the upper layers: the lone seats (layer 2 and 3 have one judge each) carry no mark
  for (const model of ['claude-opus-5-5', 'claude-fable-5-1']) for (const b of run.sent.filter(x => x.model === model)) assert.ok(!JSON.stringify(b).includes('cache_control'), `${model}: alone in its layer, so unmarked`);
});

test('A FULL RUN billed at 100% of every call\'s output cap, capped exactly at the upper figure: recorded, not asserted to fit (the per-call guard prices every marked head at the write price, so such a run CAN be stopped on its last marked calls); the stop, if any, is the guard\'s and says where and by how much', async () => {
  const config = fullConfig();
  Held.setHeldForTest(LIVE);
  const upper = total(Cost.estimateChainRows(config, { maximum: true }));
  const run = await fullRun(config, upper, 1);
  const st = Chain.budgetState();
  console.log(`GUARD-VS-FIGURE at 100%: upper figure ${upper.toFixed(4)}, spent ${st.spent?.toFixed?.(4)}, calls sent ${run.sent.length}, end: ${run.error ? `${run.error.constructor.name} at ${run.error.label ?? '?'}: ${String(run.error.message).slice(0, 200)}; the guard had ${(upper - (run.error.spent ?? st.spent)).toFixed(4)} left of the figure and projected ${Number(run.error.projected).toFixed(4)} for that call, a shortfall of ${(Number(run.error.projected) - (upper - (run.error.spent ?? st.spent))).toFixed(4)}` : 'finished'}`);
  assert.ok(run.error === null || run.error instanceof Chain.BudgetExceeded, `any stop other than the guard's is a defect: ${run.error?.stack ?? ''}`);
});

const leadKindOf = user => ['panel', 'post', 'answer'].filter(k => user.includes(HC.judgeKindLeadIn({ kind: k })));

// A laid call -> ITS dry-run row (not a family): the run label is parsed here from how chain.js builds it, and the row must exist; the lead-in the call carries is read from the spied user text and the row's on-minus-off input per call must be
// exactly its tokens (ceil(characters / 4) of the lead-in and its blank line), a number computed here from the held text, not by src/cost.js.
const stripSuffix = label => label.replace(/(-(retry|answered|question))+$/, '');
const rowLabelOf = (label, critics) => {
  const base = stripSuffix(label), reask = /-reask\d+$/.test(base), root = base.replace(/-reask\d+$/, '');
  let m;
  if ((m = /^panel-(\d+)-(.+)$/.exec(root))) return `panel-${m[1]}-${m[2]}${reask ? '-reask' : ''}`;
  if ((m = /^(ldebate|lreply)-(\d+)-(?:x\d+-)?(.+)$/.exec(root))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^critique-(\d+)$/.exec(root))) return `critique-${m[1]}`;
  if (root.startsWith('final-read-')) { const c = critics.find(x => root.includes(`-${labOf(x)}`)); return c ? `final-read-L${c.layer}-${labOf(c)}${reask ? '-reask' : ''}` : null; }
  return null;
};

test('LEAD-IN COVERAGE: every call the order lays out maps to its own cost row, and that row counts exactly the tokens of the lead-in the call carries (the re-ask labels included); the calls the dry run does not plan are listed', async () => {
  const layered = FR.chainOf([FR.critic('mock-exch-contest-keep', 'j1a', 1), FR.critic('mock-exch-support-withdraw', 'j1b', 1), FR.critic('mock-exch-support-keep', 'j2', 2), FR.critic('mock-exch-support-keep', 'j3', 3)], { maxRounds: 2, answer_back: { enabled: true }, prompt_cache: { enabled: true } });
  const first = FR.chainOf([FR.critic('mock-critic-a', 'j1a', undefined), FR.critic('mock-critic-bare-met', 'j1b', undefined)], { signoff: 'first', maxRounds: 2, prompt_cache: { enabled: true } });
  for (const c of first.seats.critics) delete c.layer;
  const reasks = readChainFile(root, 'mock-unanimous');
  const reaskChain = { ...reasks, maxRounds: 2, signoff_table: { required: true }, prompt_cache: { enabled: true }, seats: { ...reasks.seats, critics: [{ provider: 'mock', model: 'mock-critic-table-after-note', lab: 'la' }, { provider: 'mock', model: 'mock-critic-cut-signoff-then-fits', lab: 'lb' }] } };
  const reached = new Set(), unplanned = new Set(); let laid = 0;
  for (const config of [layered, first, reaskChain]) {
    Held.setHeldForTest(LIVE);
    const spied = [];
    Chain.setPromptSpy(p => spied.push(p));
    try { await Chain.runChain({ request: 'A mock task.', log: () => {}, runId: 'r-cache-marks-lead', config }); } finally { Chain.setPromptSpy(null); }
    const critics = config.seats.critics;
    const onRows = Cost.estimateChainRows(config, { maximum: true }), offRows = Cost.estimateChainRows({ ...config, prompt_cache: undefined }, { maximum: true });
    for (const p of spied.filter(q => leadKindOf(q.user).length)) {
      laid++;
      const kinds = leadKindOf(p.user);
      assert.equal(kinds.length, 1, `${p.label}: one lead-in`);
      const rowLabel = rowLabelOf(p.label, critics);
      if (/-(retry|answered|question)$/.test(p.label) || !rowLabel) { unplanned.add(`${p.label}`); continue; }   // the dry run does not plan a cut-off retry, an answered question or a question (src/cost.js baseLabelOf): no row to count
      const on = onRows.find(r => r.label === rowLabel), off = offRows.find(r => r.label === rowLabel);
      assert.ok(on && off, `${p.label}: the dry run has the row ${rowLabel}`);
      const leadText = HC.judgeKindLeadIn({ kind: kinds[0] });
      // CHANGED ACCEPTED TEST (0.8.4 apply, R2 = (c) of 10 Nov 2026: with caching on the draft boundary lines are always sent once recorded; the sweep above and the boundary test below already count them). OLD: an exchange row counted the lead-in alone. NEW: an exchange row (ldebate, lreply) counts the lead-in and the boundary lines (BOUNDARY_TOKENS, 71, the same pinned number as the boundary test); every other row the lead-in alone. WHY: job 12 showed every order-live exchange row 71 above the lead-in, which is what the prompt really grows by (the boundary test checks it to the rounding of a token). Exact equality, nothing loosened.
      const boundaryTokens = /^(ldebate|lreply|panel|critique|final-read)-/.test(rowLabel) ? BOUNDARY_TOKENS : 0;   // CHANGED ACCEPTED TEST (0.8.4 boundary fix-up): OLD `^(ldebate|lreply)-`. NEW every row of a laid call counts the boundary lines: the panel review, its re-asks, the `-solo` ask, the first-mode critique and the final read too (measured short by 70 on the SOLO and neverHeardChain fixtures). WHY as in the sweep above.
      assert.equal((on.input - off.input) / (on.times ?? 1), Math.ceil(`${leadText}\n\n`.length / 4) + boundaryTokens, `${p.label} -> ${rowLabel}: the row counts the lead-in of the call${boundaryTokens ? ' and the boundary lines of an exchange' : ''}`);
      reached.add(/-reask\d+/.test(p.label) ? 'reask' : p.label.split('-')[0] + (p.label.startsWith('final-read') ? '' : ''));
    }
  }
  console.log(`LEAD-IN COVERAGE laid calls ${laid}; reached ${[...reached].join(', ')}; laid calls with no row of their own (not planned by the dry run): ${[...unplanned].join(', ') || '(none)'}`);
  for (const k of ['panel', 'ldebate', 'lreply', 'critique', 'reask']) assert.ok(reached.has(k), `premise: a laid ${k} call was made and checked against its own row`);
});

test('THE DRAFT BOUNDARY IN THE EXCHANGE (criteria_kinds is OFF in this chain, so the checks block is not compared): with the order live the exchange prompts carry the boundary lines, and an exchange row counts them: the row\'s on-minus-off input per call is the lead-in plus the boundary lines, and it agrees with what the prompts really grew by (to the rounding of one token)', async () => {
  const bounds = { draftStartLine: HD.draftStartLine, draftBoundarySentence: HD.draftBoundarySentence };
  const held = { ...LIVE, ...bounds };
  const base = () => FR.chainOf([FR.critic('mock-exch-contest-keep', 'j1a', 1), FR.critic('mock-exch-support-withdraw', 'j1b', 1), FR.critic('mock-exch-support-keep', 'j2', 2), FR.critic('mock-exch-support-keep', 'j3', 3)], { maxRounds: 2, answer_back: { enabled: true }, draft_end_marker: { enabled: true } });
  const runWith = async config => { Held.setHeldForTest(held); const spied = []; Chain.setPromptSpy(p => spied.push(p)); try { await Chain.runChain({ request: 'A mock task.', log: () => {}, runId: 'r-cache-marks-bounds', config }); } finally { Chain.setPromptSpy(null); } return spied; };
  const offSpied = await runWith(base()), onSpied = await runWith({ ...base(), prompt_cache: { enabled: true } });
  Held.setHeldForTest(held);
  const offRows = Cost.estimateChainRows(base(), { maximum: true }), onRows = Cost.estimateChainRows({ ...base(), prompt_cache: { enabled: true } }, { maximum: true });
  const boundary = Math.ceil(`${HC.draftBoundarySentenceNeutral()}\n\n${HD.draftStartLine()}\n\n\n\n${HC.draftEndLineNeutral()}`.length / 4);
  assert.equal(boundary, BOUNDARY_TOKENS, 'the pinned number of the boundary lines');
  let compared = 0;
  for (const p of onSpied.filter(q => /^(ldebate|lreply)-\d+-(x\d+-)?j1[ab]$/.test(q.label))) {
    const before = offSpied.find(q => q.label === p.label);
    if (!before) continue;
    const grew = Math.ceil((p.system.length + p.user.length) / 4) - Math.ceil((before.system.length + before.user.length) / 4);
    const [, kind, pass, lab] = /^(ldebate|lreply)-(\d+)-(?:x\d+-)?(j1[ab])$/.exec(p.label);
    const on = onRows.find(r => r.label === `${kind}-${pass}-${lab}`), off = offRows.find(r => r.label === `${kind}-${pass}-${lab}`);
    assert.ok(on && off, `${p.label}: has its rows`);
    const rowGrew = (on.input - off.input) / (on.times ?? 1);
    assert.equal(rowGrew, LEAD_TOKENS[kind === 'ldebate' ? 'post' : 'answer'] + boundary, `${p.label}: the row counts the lead-in and the boundary lines`);
    assert.ok(Math.abs(grew - rowGrew) <= 2, `${p.label}: the prompt grew by ${grew} tokens, the row counts ${rowGrew}`);
    compared++;
  }
  assert.ok(compared >= 2, 'premise: exchange calls of both runs were compared');
});

// The ending exchange's maximum rows [label, calls, input, output], copied from a printed run of this test's own configuration (UNRECORDED, four Sonnet critics, 5m and 1h alike): the switch-off rows count 7 calls each, the cache-on rows split them 1 + 1 + 5.
const END_OFF = [['ldebate-end-L1-a', 7, 359597, 14000], ['lreply-end-L1-a', 7, 358358, 14000], ['ldebate-end-L1-b', 7, 359597, 14000], ['lreply-end-L1-b', 7, 358358, 14000]];
const END_ON = [['ldebate-end-L1-a', 1, 51371, 2000], ['ldebate-end-L1-a-x2', 1, 51371, 2000], ['ldebate-end-L1-a-x3', 5, 256855, 10000], ['lreply-end-L1-a', 1, 51194, 2000], ['lreply-end-L1-a-x2', 1, 51194, 2000], ['lreply-end-L1-a-x3', 5, 255970, 10000],
  ['ldebate-end-L1-b', 1, 51371, 2000], ['ldebate-end-L1-b-x2', 1, 51371, 2000], ['ldebate-end-L1-b-x3', 5, 256855, 10000], ['lreply-end-L1-b', 1, 51194, 2000], ['lreply-end-L1-b-x2', 1, 51194, 2000], ['lreply-end-L1-b-x3', 5, 255970, 10000]];
test('THE UNRECORDED STATE IS UNCHANGED: with the order\'s words not recorded and an explicit lifetime, the expected figure is the switch-off figure and the maximum differs only by ruling B\'s exchange rows and the ending exchange\'s split rows', () => {
  Held.setHeldForTest(UNRECORDED);
  const critics = [an('a', 1), an('b', 1), an('c', 2), an('d', 3)];
  for (const ttl of ['5m', '1h']) {
    const offExp = Cost.estimateChainRows(dryConfig(critics), { maximum: false }), onExp = Cost.estimateChainRows(dryConfig(critics, ttl), { maximum: false });
    assert.deepEqual(onExp, offExp, `${ttl}: the expected figure is exactly the switch-off figure`);
    const offMax = Cost.estimateChainRows(dryConfig(critics), { maximum: true }), onMax = Cost.estimateChainRows(dryConfig(critics, ttl), { maximum: true });
    // CHANGED ACCEPTED TEST (0.8.4, the twelve unowned tip reds, row R09; a money row). OLD: the rows left out of the equality were the layer-1 exchange's (^(ldebate|lreply)-L1-). NEW: the ending exchange's rows (ldebate-end-L1-*, lreply-end-L1-*) are left out too, and are PINNED on their own just below, off and on, to the figures of a printed run. WHY: lateFindingRule (W26) is recorded since dc60423a, so the dry run's maximum carries the ending exchange's rows (src/cost.js, endingExchangeOn()); with the cache on each is split like the ordinary exchange's: a base call, one write call (-x2) and the reads (-x3). The printed split adds up to the switch-off row's calls, input and output (7 calls, 14000 output); only the dollars differ, by the cache discount.
    const notExchange = r => !/^(ldebate|lreply)-(end-)?L1-/.test(r.label);
    assert.deepEqual(onMax.filter(notExchange), offMax.filter(notExchange), `${ttl}: every row outside layer 1's exchange and the ending exchange is the switch-off row`);
    const endRows = rows => rows.filter(r => /^(ldebate|lreply)-end-L1-/.test(r.label)).map(r => [r.label, r.times ?? 1, r.input, r.output]);
    assert.deepEqual(endRows(offMax), END_OFF, `${ttl}: the ending exchange's switch-off rows: 7 calls each`);
    assert.deepEqual(endRows(onMax), END_ON, `${ttl}: the ending exchange's cache-on rows: the base call, the write call and the five reads`);
    for (const [label, times, input, output] of END_OFF) {
      const parts = endRows(onMax).filter(([l]) => l === label || l.startsWith(`${label}-x`));
      assert.deepEqual([parts.reduce((t, p) => t + p[1], 0), parts.reduce((t, p) => t + p[2], 0), parts.reduce((t, p) => t + p[3], 0)], [times, input, output], `${ttl}: ${label}: the cache-on rows count the calls, the input and the output of the switch-off row (only the dollars differ)`);
    }
    // FINDING (not on the owed list of the ladder unit; C&C's ruling B number of 10 Nov 2026). OLD: both lifetimes carried ruling B's write row and read row. NEW: the layer-1 exchange has a budget of 3 rounds; at 5 minutes one read repays the 1.25x write, so the rows exist; at 1 hour a 2x write needs a budget of 4, so nothing is marked and the maximum is the switch-off figure.
    if (ttl === '5m') assert.ok(onMax.some(r => /^ldebate-L1-a-x2$/.test(r.label)) && onMax.some(r => /^ldebate-L1-a-x3$/.test(r.label)), `${ttl}: ruling B's write row and read row`);
    else assert.deepEqual(onMax.filter(r => !/^(ldebate|lreply)-end-L1-/.test(r.label)), offMax.filter(r => !/^(ldebate|lreply)-end-L1-/.test(r.label)), `${ttl}: a three-round budget does not repay a 1-hour write: no marked rows, the maximum is the switch-off figure (but for the ending exchange's rows, pinned above)`);
  }
});
