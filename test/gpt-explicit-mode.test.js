// 0.8.5 (C&C's rulings 5 and 6 on the GPT prompt cache, 23 Nov 2026): on a MARKED call of a selected GPT seat, OpenAI's breakpoint at H with the explicit mode, both or neither (src/gpt-explicit-mode.js,
// src/cache-order-gate.js gptHeadMarkOf, src/providers.js callOpenAICompat / openaiBreakpointMessages, src/cost.js costOf).
// PINNED: the lists (five selected ids; gpt-6-luna alone priced by its counts); the selector's refusals (pre-5.6, unreadable, a seat's own field, a fallback list, a Claude seat); the group
// rule equal to markTtlOf's; the request of a marked call (two text blocks cut at H, the native breakpoint, the root mode, no lifetime, the join byte for byte) and of an unmarked one (byte for
// byte the request with no id selected: no field); every GPT body of the shipped chains' mock runs, one form or the other; the prompt hash and a replayed stage unchanged; the reservation
// unchanged; the price of the two measured usage objects of a marked call (counts and costs of one paid test, no ids) at THC's row arithmetic, through the adapter, on gpt-6-luna and on an
// untested id; the record of a marked call (one field) and of an unmarked one (nothing new); the token line; the record guard; the test seam. Offline, $0: a local stub host or a fetch stub.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import * as C from '../src/cost.js';
import * as chainNs from '../src/chain.js';
import * as SR from '../src/spend-reservations.js';
import * as Gate from '../src/cache-order-gate.js';
import * as P from '../src/providers.js';

const EM = await import('../src/gpt-explicit-mode.js').catch(() => null);
const need = () => assert.ok(EM && typeof EM.explicitModeOf === 'function' && typeof EM.setGptCacheIdsForTest === 'function' && typeof Gate.gptHeadMarkOf === 'function' && typeof P.openaiBreakpointMessages === 'function', 'the selector, the group rule and the cut exist');
afterEach(() => { EM?.setGptCacheIdsForTest?.(null); chainNs.setBudget(null); chainNs.setCache(null); chainNs.setReservationSink(null); chainNs.setPromptSpy(null); });
const near = (a, b, eps = 1e-12) => typeof a === 'number' && Math.abs(a - b) < eps;
const LUNA = 'openai/gpt-6-luna', SOL62 = 'openai/gpt-6.2-sol';
const FIVE = ['openai/gpt-6-luna', 'openai/gpt-6.1-sol', 'openai/gpt-6.2-sol', 'openai/gpt-6.1-terra', 'openai/gpt-6.2-astra'];
const seatOf = (model, extra) => ({ provider: 'openrouter', model, maxTokens: 500, lab: 'probe-seat', ...(extra ? { extra } : {}) });
// The two measured usage objects of the paid test that a marked call matches (counts and costs only): the write of the head, and the read of it.
const MEASURED = {
  write: { prompt_tokens: 5736, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 4704 }, cost: 0.0006937 },
  read: { prompt_tokens: 5701, completion_tokens: 23, prompt_tokens_details: { cached_tokens: 4704, cache_write_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 16 }, cost: 0.00015824 },
};
const PLAIN = { prompt_tokens: 1000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } };   // a hand-built reply, for the tests that read no price
async function withServer(usage, fn) {
  const bodies = [], raw = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { raw.push(b); bodies.push(JSON.parse(b)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: `gen-${bodies.length}`, provider: 'Azure', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: typeof usage === 'function' ? usage(bodies.length) : usage })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'b'.repeat(40);
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, bodies, raw); }
  finally { srv.close(); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
}
const SYSTEM = 'nonce1 A careful reviewer.';
const HEAD = `nonce1 ${'a plan states what it assumes. '.repeat(600)}\n`;
const USER = `${HEAD}${'and what it leaves out. '.repeat(160)}\nReply with one word: OK.`;
const ask = (baseUrl, model, label, marked) => chainNs.runSingleStage({ ...seatOf(model), baseUrl }, { system: SYSTEM, user: USER, label, log: () => {}, cacheHead: HEAD, ...(marked ? { promptCacheBreakpoint: true } : {}) });
const everyKey = (o, out = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); everyKey(v, out); } return out; };

test('GPC1 the lists: five selected ids, each a readable GPT-5.6+ OpenRouter id; gpt-6-luna alone is priced by its counts', () => {
  need();
  assert.deepEqual([...EM.SELECTED_IDS], FIVE);
  assert.deepEqual([...EM.PRICED_IDS], [LUNA]);
  for (const id of EM.SELECTED_IDS) { const g = EM.gptGenerationOf(id); assert.ok(g && (g.major > 5 || (g.major === 5 && g.minor >= 6)), id); }
});

test('GPC2 the selector: every selected id; never a pre-5.6 or unreadable id even when listed, an unlisted id, a direct provider, a seat with its own prompt_cache_options or a fallback list, or a Claude seat', () => {
  need();
  for (const id of FIVE) assert.equal(EM.explicitModeOf(seatOf(id)), 'explicit', id);
  EM.setGptCacheIdsForTest({ selected: [...FIVE, 'openai/gpt-5', 'openai/gpt-5-mini', 'openai/gpt-5.5', 'openai/o3', 'openai/gpt-oss-120b', 'anthropic/claude-haiku-5.5'] });
  for (const id of ['openai/gpt-5', 'openai/gpt-5-mini', 'openai/gpt-5.5']) assert.equal(EM.explicitModeOf(seatOf(id)), null, `${id}: before GPT-5.6 (Azure answers the fields with a 400)`);
  for (const id of ['openai/o3', 'openai/gpt-oss-120b']) assert.equal(EM.explicitModeOf(seatOf(id)), null, `${id}: no readable generation`);
  assert.equal(EM.explicitModeOf({ ...seatOf('anthropic/claude-haiku-5.5'), originalProvider: 'anthropic' }), null, 'a Claude seat the route sent through OpenRouter, even listed');
  EM.setGptCacheIdsForTest(null);
  assert.equal(EM.explicitModeOf(seatOf('openai/gpt-5.6-luna')), null, 'an id outside the list carries no field');
  assert.equal(EM.explicitModeOf({ ...seatOf(LUNA), provider: 'openai' }), null, 'a direct provider');
  assert.equal(EM.explicitModeOf(seatOf(LUNA, { prompt_cache_options: { mode: 'implicit' } })), null, "a seat's own prompt_cache_options is sent as it is");
  assert.equal(EM.explicitModeOf(seatOf(LUNA, { models: ['openai/gpt-5'] })), null, 'a fallback list: another model could answer');
  assert.equal(EM.isPricedGptId('openrouter', LUNA), true);
  for (const id of FIVE.slice(1)) assert.equal(EM.isPricedGptId('openrouter', id), false, `${id}: untested, today's price rule`);
});

test("GPC3 the group rule equals markTtlOf's: in every shipped chain a selected GPT judge is marked exactly where a direct Claude judge in its place would be; never with the switch off, alone in its layer, or as a proposer", () => {
  need();
  const root = new URL('../chains/', import.meta.url).pathname;
  let compared = 0;
  for (const f of readdirSync(root).filter(n => n.endsWith('.json'))) {
    const cfg = JSON.parse(readFileSync(join(root, f), 'utf8'));
    const critics = Array.isArray(cfg.seats?.critics) ? cfg.seats.critics : [];
    critics.forEach((s, i) => {
      if (EM.explicitModeOf(s) !== 'explicit') return;
      const claude = { ...s, provider: 'anthropic', model: 'claude-haiku-5-5', extra: { output_config: { effort: 'high' } } };
      const twin = { ...cfg, seats: { ...cfg.seats, critics: critics.map((c, k) => (k === i ? claude : c)) } };
      assert.equal(Gate.gptHeadMarkOf(cfg, s), Gate.markTtlOf(twin, claude) !== null, `${f} critics[${i}] ${s.model}`);
      assert.equal(Gate.gptHeadMarkOf({ ...cfg, prompt_cache: undefined }, s), false, `${f} critics[${i}]: the switch off`);
      compared++;
    });
    for (const p of Array.isArray(cfg.seats?.proposers) ? cfg.seats.proposers : []) if (EM.explicitModeOf(p) === 'explicit') assert.equal(Gate.gptHeadMarkOf(cfg, p), false, `${f}: a proposer is never marked`);
  }
  assert.ok(compared >= 6, `compared ${compared} GPT judges`);
  const alone = { name: 'x', signoff: 'unanimous', prompt_cache: { enabled: true, ttl: '5m' }, seats: { critics: [{ ...seatOf(LUNA), layer: 1 }, { ...seatOf(SOL62), lab: 'b', layer: 2 }] } };
  assert.equal(Gate.gptHeadMarkOf(alone, alone.seats.critics[1]), false, 'alone in its layer: no reuse to buy');
});

test('GPC4 the request of a marked call: two text blocks cut at H, the native breakpoint on the first, the root mode, no lifetime anywhere; the join is the string byte for byte. An unmarked call sends no field: byte for byte the request with no id selected, which is the marked one without its two fields', async () => {
  need();
  const [markedRaw, unmarkedRaw, noneRaw] = await withServer(PLAIN, async (baseUrl, bodies, raw) => {
    await ask(baseUrl, LUNA, 'gpc4-a', true); await ask(baseUrl, LUNA, 'gpc4-b', false);
    EM.setGptCacheIdsForTest({ selected: [] });
    await ask(baseUrl, LUNA, 'gpc4-c', true);   // no id selected: the path of every call before 0.8.5, the mark asked or not
    return raw;
  });
  const marked = JSON.parse(markedRaw), unmarked = JSON.parse(unmarkedRaw);
  const blocks = marked.messages[1].content;
  assert.deepEqual(blocks, [{ type: 'text', text: HEAD, prompt_cache_breakpoint: { mode: 'explicit' } }, { type: 'text', text: USER.slice(HEAD.length) }]);
  assert.equal(blocks.map(b => b.text).join(''), USER, 'the join is the string, byte for byte');
  assert.deepEqual(marked.messages[0], { role: 'system', content: SYSTEM });
  assert.deepEqual(marked.prompt_cache_options, { mode: 'explicit' });
  assert.ok(!everyKey(marked).includes('ttl') && !everyKey(marked).includes('cache_control'), 'no lifetime and no Claude marker');
  assert.deepEqual(unmarked.messages, [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }], 'an unmarked call: the one string');
  assert.deepEqual(everyKey(unmarked).filter(k => /cache/i.test(k)), [], 'an unmarked call: no key containing "cache" at any depth (never the mode alone)');
  assert.equal(unmarkedRaw, noneRaw, 'an unmarked call is byte for byte the request with no id selected');
  delete marked.prompt_cache_options; marked.messages[1].content = USER;
  assert.equal(JSON.stringify(marked), unmarkedRaw, 'the marked call without its two fields is byte for byte the unmarked one');
});

test('GPC5 the cut: the adapter cuts exactly at the head; an empty rest leaves the head block alone; a head that does not start the text is refused before anything is sent', () => {
  need();
  for (const [u, h] of [[USER, HEAD], ['abcdef', 'abc'], ['x\n\ny', 'x\n']]) {
    const m = P.openaiBreakpointMessages([{ role: 'user', content: u }], h);
    assert.equal(m[0].content.map(b => b.text).join(''), u, JSON.stringify(h));
  }
  assert.equal(P.openaiBreakpointMessages([{ role: 'user', content: 'abc' }], 'abc')[0].content.length, 1);
  assert.throws(() => P.openaiBreakpointMessages([{ role: 'user', content: 'abc' }], 'xyz'), /nothing was sent/);
});

test('GPC6 resume: the prompt hash of a marked call equals the unmarked one, and a stage recorded before the fields replays under them with no request sent', async () => {
  need();
  const sent = await withServer(PLAIN, async (baseUrl, bodies) => {
    EM.setGptCacheIdsForTest({ selected: [] });
    const before = await ask(baseUrl, LUNA, 'gpc6', false);
    EM.setGptCacheIdsForTest(null);
    const after = await ask(baseUrl, LUNA, 'gpc6-x', true);
    assert.equal(after.promptHash, before.promptHash, 'the prompt hash reads the one string: a marked call hashes as the call with no id selected');
    chainNs.setCache({ invalidate: () => {}, get: label => (label === 'gpc6' ? { text: 'OK', provider: 'openrouter', model: LUNA, usage: before.usage, usd: before.usd, promptHash: before.promptHash } : null) });
    const n = bodies.length;
    const replay = await ask(baseUrl, LUNA, 'gpc6', true);
    assert.equal(bodies.length, n, 'the replay sent nothing');
    assert.equal(replay.text, 'OK');
    return bodies;
  });
  assert.equal(sent.length, 2);
});

test('GPC7 the reservation: a marked call, an unmarked call and a call with no id selected are reserved at the same figure, the write-priced worst case', async () => {
  need();
  const reserved = await withServer(PLAIN, async baseUrl => {
    const out = [];
    for (const [list, marked] of [[null, true], [null, false], [{ selected: [] }, false]]) {
      const dir = mkdtempSync(join(tmpdir(), 'gpc7-'));
      try {
        EM.setGptCacheIdsForTest(list);
        chainNs.setCache(null); chainNs.setBudget(50); chainNs.setReservationSink(SR.openReservations(dir));
        await ask(baseUrl, LUNA, 'gpc7', marked);
        out.push(SR.reservationLinesOf(dir).filter(l => l.event === 'reserved').map(l => l.usd)[0]);
      } finally { chainNs.setReservationSink(null); chainNs.setBudget(null); rmSync(dir, { recursive: true, force: true }); }
    }
    return out;
  });
  const p = C.priceAt('openrouter', LUNA, C.promptTokensOfChars(SYSTEM.length + USER.length));
  const want = (C.promptTokensOfChars(SYSTEM.length + USER.length) / 1e6) * p.in * C.autoWriteMultOf(p) + (500 / 1e6) * p.out;
  for (const r of reserved) assert.ok(near(r, want), `reserved ${r}, the write-priced worst case ${want}`);
});

test("GPC8 the price of the two measured replies of a marked call through the adapter: on gpt-6-luna at THC's row arithmetic of the counts (1.10 times the bill, THC's row being 10% over the listed price); on an untested id by today's selected-seat rule", async () => {
  need();
  const row = id => { const p = C.priceAt('openrouter', id, 5000); return { in: p.in, out: p.out, rm: Math.min(1, p.cacheReadMult ?? 1), wm: C.autoWriteMultOf(p) }; };
  const priced = (u, r) => ((u.prompt_tokens - u.prompt_tokens_details.cached_tokens - u.prompt_tokens_details.cache_write_tokens) * r.in + u.prompt_tokens_details.cache_write_tokens * r.in * r.wm + u.prompt_tokens_details.cached_tokens * r.in * r.rm + u.completion_tokens * r.out) / 1e6;
  const today = (u, r) => ((u.prompt_tokens - u.prompt_tokens_details.cached_tokens) * r.in * r.wm + u.prompt_tokens_details.cached_tokens * r.in * r.rm + u.completion_tokens * r.out) / 1e6;
  for (const [name, u] of Object.entries(MEASURED)) {
    const [luna, sol] = await withServer(u, async baseUrl => [await ask(baseUrl, LUNA, `gpc8-${name}`, true), await ask(baseUrl, SOL62, `gpc8-s-${name}`, true)]);
    assert.ok(near(luna.usd, priced(u, row(LUNA))), `${name}: gpt-6-luna ${luna.usd} vs the row arithmetic ${priced(u, row(LUNA))}`);
    assert.ok(Math.abs(luna.usd / u.cost - 1.1) < 1e-9, `${name}: THC's figure is 1.10 times the bill (${luna.usd / u.cost})`);
    assert.equal(luna.usage.cacheCounts, undefined, `${name}: priced by its counts, no cacheCounts`);
    assert.ok(near(sol.usd, today(u, row(SOL62))), `${name}: gpt-6.2-sol keeps today's rule: ${sol.usd} vs ${today(u, row(SOL62))}`);
    assert.equal(sol.usage.cacheCounts, 'write-in-input', `${name}: gpt-6.2-sol, today's record`);
  }
});

test("GPC9 the record is one field: a marked call records promptCacheBreakpoint 'head' and nothing else new; an unmarked call records nothing new, the record of the call with no id selected; never cacheAsked (Anthropic's branch)", async () => {
  need();
  const [a, b, c] = await withServer(MEASURED.write, async baseUrl => {
    const x = await ask(baseUrl, LUNA, 'gpc9-a', true), y = await ask(baseUrl, LUNA, 'gpc9-b', false);
    EM.setGptCacheIdsForTest({ selected: [] });
    return [x, y, await ask(baseUrl, LUNA, 'gpc9-c', true)];
  });
  assert.equal(a.usage.promptCacheBreakpoint, 'head');
  assert.deepEqual(Object.keys(a.usage).filter(k => !(k in c.usage)), ['promptCacheBreakpoint'], 'a marked call: the one new field');
  assert.deepEqual(b.usage, c.usage, 'an unmarked call: the record of the call with no id selected');
  for (const s of [a, b, c]) { assert.equal('promptCacheMode' in s.usage, false, 'no mode field'); assert.equal('cacheAsked' in s.usage, false); }
});

test('GPC10 the token line counts a write once, and the record guard refuses a value THC never sends', () => {
  need();
  const s = C.summarise([{ provider: 'openrouter', model: LUNA, usage: { input: 5736, output: 5, cacheRead: 0, cacheWrite: 4704, promptCacheBreakpoint: 'head' }, usd: 0.001 }]);
  assert.equal(s.input, 1032); assert.equal(s.cacheWrite, 4704);
  const r = C.readUsage({ input: 10, output: 1, promptCacheBreakpoint: 'tail' });
  assert.equal('promptCacheBreakpoint' in r.usage, false); assert.match(String(r.unreadable), /promptCacheBreakpoint/);
});

test('GPC11 no field in a real request for an id before GPT-5.6, an unreadable id, an unlisted id or a seat with a fallback list, even when listed or marked, nor for an unmarked call of any of the five selected ids', async () => {
  need();
  const sent = await withServer(PLAIN, async (baseUrl, bodies) => {
    EM.setGptCacheIdsForTest({ selected: [...FIVE, 'openai/gpt-5-mini', 'openai/gpt-5', 'openai/o3'] });
    for (const id of ['openai/gpt-5-mini', 'openai/gpt-5', 'openai/o3', 'openai/gpt-5.6-luna']) await ask(baseUrl, id, `gpc11-${id.split('/')[1]}`, true);
    await chainNs.runSingleStage({ ...seatOf(LUNA, { models: ['openai/gpt-5'] }), baseUrl }, { system: SYSTEM, user: USER, label: 'gpc11-models', log: () => {}, cacheHead: HEAD, promptCacheBreakpoint: true });
    EM.setGptCacheIdsForTest(null);
    for (const id of FIVE) await ask(baseUrl, id, `gpc11-u-${id.split('/')[1]}`, false);
    return bodies;
  });
  assert.equal(sent.length, 10);
  for (const b of sent) { assert.deepEqual(everyKey(b).filter(k => /cache/i.test(k)), [], `${b.model}: no key containing "cache" at any depth`); assert.equal(typeof b.messages[1].content, 'string', `${b.model}: one string`); }
});

test('GPC12 the test seam is not called from src/', () => {
  need();
  const root = new URL('../src/', import.meta.url).pathname;
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []));
  assert.deepEqual(walk(root).filter(f => !f.endsWith('gpt-explicit-mode.js') && readFileSync(f, 'utf8').includes('setGptCacheIdsForTest')), []);
});

test("GPC13 the money branch's hinge on gpt-6-luna through the adapter: on a marked call, no counts at all keeps today's price and is recorded unknown, a write of the whole prompt is priced by its counts with no flag, and a read count with no write count keeps today's rule; an unmarked call keeps today's rule in all three", async () => {
  need();
  const p = C.priceAt('openrouter', LUNA, 5000), wm = C.autoWriteMultOf(p), rm = Math.min(1, p.cacheReadMult ?? 1);
  const N = 5736, out = 5;
  const cases = [
    ['no counts', { prompt_tokens: N, completion_tokens: out }],
    ['whole-prompt write', { prompt_tokens: N, completion_tokens: out, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: N - 3 } }],
    ['read count only', { prompt_tokens: N, completion_tokens: out, prompt_tokens_details: { cached_tokens: 4704 } }],
  ];
  for (const marked of [true, false]) {
    for (const [name, u] of cases) {
      const st = await withServer(u, baseUrl => ask(baseUrl, LUNA, `gpc13-${marked ? 'a' : 'b'}-${name.replace(/ /g, '-')}`, marked));
      assert.equal(st.usage.promptCacheBreakpoint, marked ? 'head' : undefined, `${name}: the breakpoint recorded on a marked call only`);
      if (name === 'no counts') {
        const whole = C.worstCaseOf('openrouter', LUNA, { promptChars: SYSTEM.length + USER.length, maxTokens: out }).usd;
        assert.equal(st.usage.cacheCounts, 'unknown', `${name}: recorded unknown`);
        assert.ok(st.usd >= Math.max(N / 1e6 * p.in * wm + out / 1e6 * p.out, whole) - 1e-12, `${name}: at least the whole prompt as a write (${st.usd})`);
      } else if (name === 'whole-prompt write' && marked) {
        assert.ok(near(st.usd, (3 * p.in + (N - 3) * p.in * wm + out * p.out) / 1e6), `${name}: priced by its counts (${st.usd})`);
        assert.equal(st.usage.cacheCounts, undefined, `${name}: no flag`);
      } else if (name === 'whole-prompt write') {
        assert.ok(near(st.usd, (N * p.in * wm + out * p.out) / 1e6), `${name}, unmarked: today's rule, every uncached prompt token as a write (${st.usd})`);
        assert.equal(st.usage.cacheCounts, 'write-in-input', `${name}, unmarked: recorded as today`);
      } else {
        assert.ok(near(st.usd, ((N - 4704) * p.in * wm + 4704 * p.in * rm + out * p.out) / 1e6), `${name}: today's rule (${st.usd})`);
        assert.equal(st.usage.cacheCounts, 'write-not-reported', `${name}: recorded as today`);
      }
    }
  }
});

// GPC14 (ruling 6, point 2a: both fields or neither). A mock run of each shipped chain that seats a selected GPT id: every seat on another id becomes a mock seat (lab, layer, persona and maxTokens kept), the
// GPT seats stay as shipped, and a fetch stub answers them with THC's own mock provider on the joined text (nothing leaves the process). A repo test cannot hold the code from before 0.8.5, so the baseline is the SAME run
// on this tree with no id selected: every new path sits behind the selector, so that run takes the path of every GPT call before 0.8.5 (the message of the commit that adds this test records the same bodies compared, byte for byte, with those the tree before it sent).
const selectedSeat = s => !!s && s.provider === 'openrouter' && EM?.SELECTED_IDS.includes(s.model);
async function gptBodiesOf(chain, lists) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const MODEL_OF = { criteria: 'mock-criteria', skeleton: 'mock-skeleton', builder: 'mock-builder', reviser: 'mock-builder', handoff: 'mock-builder', decider: 'mock-builder' };
  const toSeat = (role, s, i) => {
    if (selectedSeat(s)) return s;
    const out = { provider: 'mock', model: role === 'proposers' ? `mock-proposer-${letters[i]}` : role === 'critics' ? `mock-critic-${letters[i]}` : (MODEL_OF[role] ?? 'mock-builder') };
    for (const k of ['lab', 'layer', 'persona', 'maxTokens']) if (s[k] !== undefined) out[k] = s[k];
    return out;
  };
  const seats = Object.fromEntries(Object.entries(chain.seats).map(([role, v]) => [role, Array.isArray(v) ? v.map((s, i) => toSeat(role, s, i)) : toSeat(role, v, 0)]));
  const raw = [], original = globalThis.fetch, env0 = process.env.OPENROUTER_API_KEY;
  const textOf = c => (typeof c === 'string' ? c : c.map(b => b.text).join(''));
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith('https://openrouter.ai/'), `only the GPT seats call out (${url})`);
    raw.push(init.body);
    const body = JSON.parse(init.body), system = body.messages[0].content, user = textOf(body.messages[body.messages.length - 1].content);
    const r = await P.call('mock', { model: /proposer|planning panel|one lab on/i.test(String(system).slice(0, 400)) ? 'mock-proposer-a' : 'mock-critic-a', system, messages: [{ role: 'user', content: user }], maxTokens: body.max_completion_tokens });
    return new Response(JSON.stringify({ id: 'gen-gpc14', provider: 'Azure', model: body.model, choices: [{ message: { content: r.text }, finish_reason: 'stop' }], usage: PLAIN }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'd'.repeat(40);
  EM.setGptCacheIdsForTest(lists);
  try { await chainNs.runChain({ request: 'A mock task.', config: { ...chain, seats }, runId: 'r-gpc14', log: () => {} }); }
  finally { EM.setGptCacheIdsForTest(null); globalThis.fetch = original; if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; }
  return raw;
}
test("GPC14 both fields or neither: every GPT body of a mock run of each shipped chain with a selected GPT seat either equals, byte for byte, the body of the same run with no id selected, or carries both of OpenAI's fields and, without them, equals it byte for byte", async () => {
  need();
  const root = new URL('../chains/', import.meta.url).pathname;
  const chains = readdirSync(root).filter(n => n.endsWith('.json')).map(n => [n, JSON.parse(readFileSync(join(root, n), 'utf8'))]).filter(([, c]) => Object.values(c.seats ?? {}).flat().some(selectedSeat));
  assert.ok(chains.length >= 4, `the shipped chains with a selected GPT seat: ${chains.map(([n]) => n).join(', ')}`);
  const cacheKeys = b => [...new Set(everyKey(b).filter(k => /cache/i.test(k)))].sort();
  let marked = 0, unmarked = 0;
  for (const [name, chain] of chains) {
    const base = await gptBodiesOf(chain, { selected: [] }), now = await gptBodiesOf(chain, null);
    assert.ok(base.length > 0, `${name}: GPT calls were sent`);
    for (const r of base) { const b = JSON.parse(r); assert.deepEqual(cacheKeys(b), [], `${name} ${b.model}: no id selected, no cache key`); }
    const normal = now.map(r => {
      const b = JSON.parse(r), u = b.messages[b.messages.length - 1].content;
      if (typeof u === 'string') { assert.deepEqual(cacheKeys(b), [], `${name} ${b.model}: a call sent as the one string carries no cache key at any depth (never the mode alone)`); unmarked++; return r; }
      assert.deepEqual(b.prompt_cache_options, { mode: 'explicit' }, `${name} ${b.model}: blocks never without the root mode`);
      assert.ok(u.every(p => p.type === 'text' && typeof p.text === 'string') && JSON.stringify(u[0].prompt_cache_breakpoint) === '{"mode":"explicit"}' && u.slice(1).every(p => !('prompt_cache_breakpoint' in p)), `${name} ${b.model}: the breakpoint on the first block only`);
      assert.deepEqual(cacheKeys(b), ['prompt_cache_breakpoint', 'prompt_cache_options'], `${name} ${b.model}: no other cache key`);
      marked++;
      delete b.prompt_cache_options; b.messages[b.messages.length - 1].content = u.map(p => p.text).join('');
      return JSON.stringify(b);
    });
    const a = [...base].sort(), n = [...normal].sort();
    assert.ok(a.length === n.length && a.every((x, i) => x === n[i]), `${name}: beyond the two fields, the bodies are those of the run with no id selected, byte for byte`);
  }
  assert.ok(marked > 0 && unmarked > 0, `both kinds were seen (${marked} marked, ${unmarked} unmarked)`);
});
