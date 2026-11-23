// 0.8.4 the optional "zero-retention only" setting, the parts that need no wording and no entry point (his answer 11 of 10 Nov 2026; C&C accepted the defaults: coverage = OpenRouter seats only; on|off on every channel; exit 5; run.json keeps it; and ruled that
// "zero-retention only" means the REQUEST reaches no host that may keep a prompt: provider.only names the allowed hosts from the dated table, so a host that appears later is never used).
// WHAT IS PINNED, by test (on a tree without the new modules each test fails at its first assertion, not at an import): ZR-1 the table maker (src/zdr-table.js zdrTableOf): the Open Inference host is not counted, hosts with safety retention are counted apart and are
// never allowed, a slug that is a prefix of a host that is not allowed is left out (OpenRouter matches a slug as a prefix), a provider that has any safety-retention endpoint is not allowed for any model, prices are USD per million tokens, a model with no endpoint is absent, a bad input is refused.
// ZR-2 the pure decision (src/zero-retention.js): a seat the setting cannot serve is named once per model with its count and a reason that is true however it is reached (not listed, none of its hosts used, its own only leaves none, none under its price limit), a seat whose allowed hosts all cost more than its price limit is named with the limit,
// a seat's own provider.only narrows the hosts, a model in the table is not named, direct seats are counted as not covered, mock/external/ollama seats as neither, a `:variant` suffix reads the base id; zdrAllowedHosts. ZR-3 the setting's reader.
// ZR-4 the call: with the run switch on, an OpenRouter call carries provider.zdr = true and provider.only = the allowed hosts next to the Open Inference block and the price pin, and nothing else changes; the seat and its extra are never written; off is what it was;
// a seat of another provider is untouched; a seat's own only is narrowed, never widened; with no allowed host left nothing is sent. ZR-5 the shipped table: shape, and the models of the shipped chains the decision names. ZR-6 the table is not older than its limit. ZR-7 the setting decision (typed value, environment, record), the refusals and the line.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CHAIN from '../src/chain.js';       // the 0.8.4 export is read off the namespace, and the new modules are imported inside each test, so a tree without them fails each test at an assertion and not the whole file at its imports
import * as PIN from '../src/price-pin.js';
const setZeroRetention = (on, table) => { assert.equal(typeof CHAIN.setZeroRetention, 'function', 'src/chain.js exports setZeroRetention'); CHAIN.setZeroRetention(on, table); };
const loadTable = async () => { const m = await import('../src/zdr-table.js').catch(() => null); assert.ok(m, 'src/zdr-table.js exists'); return m.zdrTableOf; };
const loadZR = async () => { const m = await import('../src/zero-retention.js').catch(() => null); assert.ok(m, 'src/zero-retention.js exists'); return m; };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { if (typeof CHAIN.setZeroRetention === 'function') CHAIN.setZeroRetention(false); });

const price = (p, c) => ({ prompt: String(p / 1e6), completion: String(c / 1e6) });
const rows = [
  { model_id: 'a/one', tag: 'hostx/us', safety_retention: false, pricing: price(1, 2) },
  { model_id: 'a/one', tag: 'hosty', safety_retention: false, pricing: price(0.5, 1) },
  { model_id: 'a/one', tag: 'open-inference/fp4', safety_retention: false, pricing: price(0.1, 0.2) },
  { model_id: 'b/two', tag: 'google-vertex/us', safety_retention: true, pricing: price(1, 1) },
  { model_id: 'b/two', tag: 'google-vertex/global', safety_retention: true, pricing: price(1, 1) },
  { model_id: 'c/only-oi', tag: 'open-inference/fp8', safety_retention: false, pricing: price(1, 1) },
  { model_id: 'a/mixed', tag: 'h1', safety_retention: false, pricing: price(3, 6) },
  { model_id: 'a/mixed', tag: 'h2', safety_retention: true, pricing: price(1, 1) },
  { model_id: 'a/prefix', tag: 'p', safety_retention: false, pricing: price(1, 1) },
  { model_id: 'a/prefix', tag: 'p/safe', safety_retention: true, pricing: price(1, 1) },
  { model_id: 'a/prefix', tag: 'q/us', safety_retention: false, pricing: price(1, 1) },
  { model_id: 'a/prefix', tag: 'q/eu', safety_retention: false, pricing: price(1, 1) },
  { model_id: 'a/prefix', tag: 'open-inference/q', safety_retention: false, pricing: price(1, 1) },
  { model_id: 'a/vertex', tag: 'google-vertex/us', safety_retention: false, pricing: price(1, 1) },
  { model_id: 'a/vertex', tag: 'deepinfra', safety_retention: false, pricing: price(1, 1) },
];

test('ZR-1: the table maker allows hosts without safety retention only, never counts Open Inference, drops a slug that is a prefix of a host that is not allowed, writes USD per million tokens, drops a model with no endpoint, refuses a bad input', async () => {
  const zdrTableOf = await loadTable();
  const t = zdrTableOf(rows, '2026-11-10');
  assert.equal(t.asOf, '2026-11-10');
  assert.deepEqual(t.models['a/one'], { hosts: { 'hostx/us': { in: 1, out: 2 }, hosty: { in: 0.5, out: 1 } }, safety_retention: 0 }, 'Open Inference is not counted');
  assert.deepEqual(t.models['b/two'], { hosts: {}, safety_retention: 2 }, 'a model with only safety-retention hosts has none allowed (its stop says none of its hosts is one this setting uses)');
  assert.deepEqual(t.models['a/mixed'], { hosts: { h1: { in: 3, out: 6 } }, safety_retention: 1 }, 'a host with safety retention is never allowed');
  assert.deepEqual(t.models['a/prefix'], { hosts: { 'q/eu': { in: 1, out: 1 }, 'q/us': { in: 1, out: 1 } }, safety_retention: 1 }, 'p has an endpoint with safety retention (p/safe), so the provider p is not allowed and its slug is left out (this also covers a slug that is a prefix of that endpoint); q/us and q/eu stay');
  assert.deepEqual(t.models['a/vertex'], { hosts: { deepinfra: { in: 1, out: 1 } }, safety_retention: 0 }, 'google-vertex has endpoints with safety retention (b/two), so no google-vertex slug is allowed for any model');
  assert.equal('c/only-oi' in t.models, false, 'a model whose only host is Open Inference has none');
  // the invariant the table rests on: no allowed slug matches an endpoint that is not allowed (the script checks it on every table it makes); the check can fail
  const { allowedSlugsThatMatchOthers } = await import('../src/zdr-table.js');
  assert.deepEqual(allowedSlugsThatMatchOthers(rows, t), [], 'the table holds it');
  assert.deepEqual(allowedSlugsThatMatchOthers(rows, { models: { 'a/prefix': { hosts: { p: { in: 1, out: 1 }, q: { in: 1, out: 1 } } } } }), [{ model: 'a/prefix', slug: 'p', other: 'p/safe' }], 'a table that allowed p would match p/safe; q matches only q/us and q/eu, which are allowed');
  assert.deepEqual(allowedSlugsThatMatchOthers(rows, { models: { 'a/one': { hosts: { 'open-inference': { in: 1, out: 1 } } } } }), [{ model: 'a/one', slug: 'open-inference', other: 'open-inference/fp4' }], 'nor may an allowed slug match an Open Inference endpoint');
  assert.deepEqual(Object.keys(t.models), ['a/mixed', 'a/one', 'a/prefix', 'a/vertex', 'b/two'], 'sorted');
  assert.throws(() => zdrTableOf({ data: [] }, '2026-11-10'), TypeError); assert.throws(() => zdrTableOf(rows, '10 Nov'), TypeError);
  assert.deepEqual(zdrTableOf([null, {}, { model_id: '' }, { model_id: 'x/y' }], '2026-11-10').models, {}, 'rows with no model id or no slug are skipped');
});

const or = (model, extra) => ({ provider: 'openrouter', model, ...(extra ? { extra } : {}) });
test('ZR-2: the decision names a seat with no allowed host once per model, says when a model only has hosts that may keep prompts, names a seat whose hosts all cost more than its price limit, honours a seat\'s own only, counts direct seats as not covered', async () => {
  const ZR = await loadZR(), TABLE = (await loadTable())(rows, '2026-11-10');
  const seats = [or('a/one'), or('x/none'), or('x/none'), or('b/two'), or('a/mixed'), or('a/one:nitro'), or('x/none:thinking'), { provider: 'anthropic', model: 'claude-opus-5-5' }, { provider: 'openai', model: 'gpt-6' }, { provider: 'mock', model: 'm' }, { provider: 'external', model: 'e' }, { provider: 'ollama', model: 'o' }];
  const r = ZR.zeroRetentionStops(seats, { table: TABLE });
  assert.deepEqual(r.stops, [{ model: 'x/none', why: 'not_listed', count: 2 }, { model: 'b/two', why: 'none_used', count: 1 }, { model: 'x/none:thinking', why: 'not_listed', count: 1 }]);
  assert.equal(r.covered, 7, 'every OpenRouter seat is covered by the setting'); assert.equal(r.notCovered, 2, 'a direct seat is not; mock, external and ollama seats are neither');
  assert.deepEqual(ZR.zeroRetentionStops([], { table: TABLE }), { stops: [], covered: 0, notCovered: 0 }); assert.deepEqual(ZR.zeroRetentionStops(undefined, { table: TABLE }).stops, []);
  assert.deepEqual(ZR.zeroRetentionStops([or('a/one:nitro')], { table: TABLE }).stops, [], 'a :variant suffix reads the base id');
  // the price limit: a seat's own complete pin (USD per million tokens); the cheapest allowed host of a/one is 0.5 / 1
  const pinned = (p, c) => or('a/one', { provider: { max_price: { prompt: p, completion: c } } });
  assert.deepEqual(ZR.zeroRetentionStops([pinned(0.1, 0.1), pinned(0.1, 0.1)], { table: TABLE }).stops, [{ model: 'a/one', why: 'none_under_pin', count: 2, pin: { prompt: 0.1, completion: 0.1 } }], 'no host at or under the limit: named once, with the limit');
  assert.deepEqual(ZR.zeroRetentionStops([pinned(0.5, 1)], { table: TABLE }).stops, [], 'a host exactly at the limit is under it');
  assert.equal(ZR.zeroRetentionStops([pinned(9, 0.9)], { table: TABLE }).stops.length, 1, 'both sides must fit: a host cheap in input and dear in output does not');
  // a seat's own provider.only narrows the hosts (a slug, or a prefix of one)
  assert.deepEqual(ZR.zeroRetentionStops([or('a/prefix', { provider: { only: ['q'] } })], { table: TABLE }).stops, [], 'only: q keeps q/eu and q/us');
  assert.deepEqual(ZR.zeroRetentionStops([or('a/prefix', { provider: { only: ['zzz'] } })], { table: TABLE }).stops, [{ model: 'a/prefix', why: 'own_only', count: 1 }], 'an only that names none of the allowed hosts leaves none');
  assert.deepEqual(ZR.zdrAllowedHosts('a/prefix', { table: TABLE }), ['q/eu', 'q/us']); assert.deepEqual(ZR.zdrAllowedHosts('a/prefix', { table: TABLE, own: ['q/us', 'x'] }), ['q/us']);
  assert.deepEqual(ZR.zdrAllowedHosts('x/none', { table: TABLE }), []); assert.deepEqual(ZR.zdrAllowedHosts('b/two', { table: TABLE }), [], 'only safety-retention hosts: none allowed');
});

test('ZR-3: the setting reader takes on and off (any case), nothing as not typed, and refuses the rest naming where it came from', async () => {
  const ZR = await loadZR();
  for (const [v, want] of [['on', 'on'], [' OFF ', 'off'], ['On', 'on'], [true, 'on'], [false, 'off'], [undefined, null], ['', null], ['  ', null], [null, null]]) assert.deepEqual(ZR.readZeroRetentionSetting(v), { ok: true, setting: want }, String(v));
  const bad = ZR.readZeroRetentionSetting('yes', '--zero-retention');
  assert.equal(bad.ok, false); assert.match(bad.message, /^--zero-retention: "yes" is not a zero-retention setting\. Use on or off\.$/);
  assert.match(ZR.readZeroRetentionSetting('a\nb').message, /^COUNCIL_ZERO_RETENTION: "a b" is not/, 'a value with a line break is shown on one line');
  assert.equal(ZR.ZERO_RETENTION_ENV, 'COUNCIL_ZERO_RETENTION');
});

const seatOf = (extra, model = 'z-ai/glm-5.3') => ({ provider: 'openrouter', model, lab: 'zr-lab', maxTokens: 500, ...(extra === undefined ? {} : { extra }) });
async function sentBody(seat) {
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test';
  const original = globalThis.fetch; let body = null;
  globalThis.fetch = async (url, opts) => { body = JSON.parse(opts.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 }, model: seat.model, provider: 'Host' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try { await CHAIN.runSingleStage(seat, { system: 's', user: 'u', label: 'zr-probe' }); return body; }
  finally { globalThis.fetch = original; if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
}

test('ZR-4: with the run switch on an OpenRouter call carries provider.zdr and provider.only = the allowed hosts and nothing else moves; off is what it was; the seat is never written; another provider is untouched; a seat\'s own only is narrowed, never widened; with no host left nothing is sent', async () => {
  const ZR = await loadZR(), allowed = Object.keys(ZR.ZDR_TABLE.models['z-ai/glm-5.3'].hosts);
  assert.ok(allowed.length > 5, 'the shipped table lists hosts for GLM 5.3');
  const off = await sentBody(seatOf());
  setZeroRetention(true);
  const on = await sentBody(seatOf());
  assert.equal(off.provider.zdr, undefined); assert.equal(off.provider.only, undefined, 'off: no zdr, no only');
  assert.deepEqual(on.provider, { ...off.provider, zdr: true, only: allowed }, 'on: the same request with zdr and the allowed hosts, the price pin and the Open Inference block kept (the block is in ignore, beside only)');
  assert.ok(on.provider.ignore.includes('open-inference'), 'the Open Inference ban is kept');
  const { provider: _p, ...restOff } = off, { provider: _q, ...restOn } = on; assert.deepEqual(restOn, restOff, 'nothing outside provider moves');
  // a seat's own only is narrowed to the hosts it names, never widened; its other provider keys are kept
  const fw = allowed.filter(h => h === 'fireworks' || h.startsWith('fireworks/'));
  assert.ok(fw.length > 0 && fw.length < allowed.length, 'GLM 5.3 has several fireworks hosts and other hosts too');
  const own = await sentBody(seatOf({ provider: { only: ['fireworks', 'not-in-the-table'], data_collection: 'deny', order: ['x'] } }));
  assert.deepEqual([own.provider.only, own.provider.data_collection, own.provider.order, own.provider.zdr], [fw, 'deny', ['x'], true]);
  // a seat whose own only names none of the allowed hosts: nothing is sent
  const original = globalThis.fetch; let called = 0; globalThis.fetch = async () => { called += 1; return new Response('{}', { status: 200 }); };
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test';
  try {
    await assert.rejects(CHAIN.runSingleStage(seatOf({ provider: { only: ['not-in-the-table'] } }), { system: 's', user: 'u', label: 'zr-probe' }), err => err instanceof PIN.ZeroRetentionNoHost && err.controlFlow === true && /zero retention is on/.test(err.message));
    await assert.rejects(CHAIN.runSingleStage(seatOf(undefined, 'qwen/qwen3.8-flash'), { system: 's', user: 'u', label: 'zr-probe' }), err => err instanceof PIN.ZeroRetentionNoHost, 'a model the table has no host for is not sent either');
  } finally { globalThis.fetch = original; if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
  assert.equal(called, 0, 'no call went out');
  // the list the run was armed with is the list of the call: a refreshed one narrows the hosts, and switching off clears it
  setZeroRetention(true, { asOf: '2026-12-20', models: { 'z-ai/glm-5.3': { hosts: { fireworks: { in: 0.1, out: 0.1 } }, safety_retention: 0 } } });
  assert.deepEqual((await sentBody(seatOf())).provider.only, ['fireworks'], 'the armed list, not the shipped one');
  setZeroRetention(false);
  assert.equal((await sentBody(seatOf())).provider.only, undefined, 'switched off: no only');
  assert.equal((await sentBody(seatOf({ provider: { zdr: true } }))).provider.zdr, true, 'off keeps the seat\'s own true, as it always did');
  // pure level: never written into the seat or its extra; false and a non-list are off
  const seat = seatOf({ provider: { zdr: false } }), before = JSON.stringify(seat);
  const sent = PIN.pinnedExtra(seat, seat.extra, { promptTokens: 10, zeroRetention: ['h1', 'h2'] });
  assert.deepEqual([sent.provider.zdr, sent.provider.only], [true, ['h1', 'h2']]); assert.equal(JSON.stringify(seat), before, 'the seat is as it was'); assert.equal(seat.extra.provider.zdr, false);
  assert.deepEqual(PIN.pinnedExtra(seat, seat.extra, { promptTokens: 10, zeroRetention: true }), PIN.pinnedExtra(seat, seat.extra, { promptTokens: 10 }), 'only a list of hosts arms it');
  assert.deepEqual(PIN.pinnedExtra(seatOf({ provider: { only: ['h1'] } }), { provider: { only: ['h1'] } }, { zeroRetention: ['h1', 'h2'] }).provider.only, ['h1']);
  assert.throws(() => PIN.pinnedExtra(seat, seat.extra, { zeroRetention: [] }), err => err instanceof PIN.ZeroRetentionNoHost);
  const direct = { provider: 'anthropic', model: 'claude-opus-5-5' };
  assert.equal(PIN.pinnedExtra(direct, undefined, { zeroRetention: ['h1'] }), undefined, 'a seat of another provider is returned as it was');
  assert.deepEqual(PIN.pinnedExtra(direct, { x: 1 }, { zeroRetention: ['h1'] }), { x: 1 });
});

// NEW TEST (0.8.4 release chores, 11 Nov 2026: Muad, "blacklist PrimaLabs for Mimo"; C&C ruling: the request side subtracts the seat's own ignore from provider.only, as orderFor does for order, and the start check's counts agree with it).
test('ZR-9: the zero-retention request carries none of the hosts the seat\'s own provider.ignore bans (the shipped MiMo seat: no PrimaLabs in provider.only); a seat that bans every listed host sends nothing; the start check counts without the banned hosts and names no stop for that case', async () => {
  const ZR = await loadZR();
  const chain = JSON.parse(readFileSync(join(root, 'chains', 'plan-china-medium-council.json'), 'utf8'));
  const mimo = Object.values(chain.seats).flatMap(v => (Array.isArray(v) ? v : [v])).find(s => s?.provider === 'openrouter' && s.model === 'xiaomi/mimo-v2.6-pro');
  const listed = ZR.zdrAllowedHosts(mimo.model);
  const prima = t => /^primalabs(\/|$)/.test(t);
  assert.ok(listed.some(prima) && listed.some(t => !prima(t)), 'fixture: the shipped table lists a PrimaLabs host and another host for MiMo (the request would carry PrimaLabs without the ban)');
  const sent = PIN.pinnedExtra(mimo, mimo.extra, { promptTokens: 10, zeroRetention: listed });
  assert.deepEqual(sent.provider.only, listed.filter(t => !prima(t)), 'the shipped MiMo seat: provider.only holds the listed hosts without PrimaLabs');
  assert.ok(sent.provider.ignore.includes('primalabs') && sent.provider.ignore.includes('open-inference'), 'the ignore list is kept as it was');
  // a base slug bans every endpoint under it; a seat that bans every listed host has none left (the call is not sent)
  const own = { provider: { ignore: ['h1'] } };
  assert.deepEqual(PIN.pinnedExtra(seatOf(own, 'a/one'), own, { promptTokens: 10, zeroRetention: ['h1/x', 'h1', 'h2'] }).provider.only, ['h2']);
  assert.throws(() => PIN.pinnedExtra(seatOf(own, 'a/one'), own, { promptTokens: 10, zeroRetention: ['h1/x', 'h1'] }), err => err instanceof PIN.ZeroRetentionNoHost);
  // the start check: the same subtraction; "every listed host is banned" is not one of its reasons, so it names no stop (the call says it)
  const H = (i, o) => ({ in: i, out: o });
  const table = { asOf: '2026-11-10', models: { 'a/one': { hosts: { 'h1/x': H(1, 1), h2: H(1, 1) }, safety_retention: 0 } } };
  const stopsOf = ignore => ZR.zeroRetentionStops([seatOf(ignore ? { provider: { ignore } } : undefined, 'a/one')], { table });
  assert.deepEqual(stopsOf(null), { stops: [], covered: 1, notCovered: 0 });
  assert.deepEqual(stopsOf(['h1']), { stops: [], covered: 1, notCovered: 0 }, 'one host is banned, one is left');
  assert.deepEqual(stopsOf(['h1', 'h2']), { stops: [], covered: 1, notCovered: 0 }, 'every listed host is banned: no stop is named at the start');
  // the counts agree with the ban: the one host under the seat's own price limit is banned, so the host left is over it
  const priced = { asOf: '2026-11-10', models: { 'a/one': { hosts: { 'h1/x': H(0.5, 0.5), h2: H(5, 5) }, safety_retention: 0 } } };
  const pinSeat = ignore => seatOf({ provider: { max_price: { prompt: 1, completion: 1 }, ...(ignore ? { ignore } : {}) } }, 'a/one');
  assert.deepEqual(ZR.zeroRetentionStops([pinSeat(null)], { table: priced }).stops, [], 'h1 is under the limit');
  assert.deepEqual(ZR.zeroRetentionStops([pinSeat(['h1'])], { table: priced }).stops, [{ model: 'a/one', why: 'none_under_pin', count: 1, pin: { prompt: 1, completion: 1 } }], 'h1 is banned: the only host left is over the limit');
});

test('ZR-5: the shipped table has the stated shape and the decision names exactly the OpenRouter models of the shipped chains that cannot be served in it', async () => {
  const ZR = await loadZR(), t = ZR.ZDR_TABLE;
  assert.match(t.asOf, /^\d{4}-\d{2}-\d{2}$/); assert.deepEqual(Object.keys(t), ['asOf', 'models']);
  for (const [id, r] of Object.entries(t.models)) {
    assert.match(id, /^[^/]+\/[^/]+$/); assert.deepEqual(Object.keys(r), ['hosts', 'safety_retention'], id); assert.ok(Number.isInteger(r.safety_retention) && r.safety_retention >= 0, id);
    for (const [slug, h] of Object.entries(r.hosts)) { assert.ok(slug.length > 0 && !slug.startsWith('open-inference'), `${id}: ${slug}`); assert.ok(typeof h.in === 'number' && typeof h.out === 'number' && h.in >= 0 && h.out >= 0, `${id}: ${slug} has prices`); }
  }
  const seats = [];
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) for (const { seat } of PIN.openRouterSeatsOf(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')))) seats.push(seat);      // the whole config, preflight seats included
  assert.ok(seats.length > 30, `shipped OpenRouter seats were found (${seats.length})`);
  const named = ZR.zeroRetentionStops(seats).stops.map(s => `${s.model}:${s.why}`).sort();
  // CHANGE THIS LIST ONLY WITH A REFRESHED TABLE: the shipped models that cannot be served on the table's date (10 Nov 2026): the two Qwen models of the China chains are not on the list; none has hosts that all cost more than its price limit
  // CHANGED ACCEPTED (0.8.4, the merge of the add-on removal, C&C 10 Nov 2026). OLD: the list also named 'google/gemini-3.8-flash:none_used' (Gemini 3.8 Flash, the model of advise-standard, which has only hosts the setting does not use). NEW: that row is gone. WHY: the advice add-on and its chain left the package in the removal, so no shipped chain seats that model any more; the other two rows are unchanged.
  assert.deepEqual(named, ['qwen/qwen3.8-flash:not_listed', 'qwen/qwen3.8-max-0902:not_listed']);
  const routed = ['anthropic/claude-fable-5.2', 'anthropic/claude-fable-5.1', 'anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5'].map(m => or(m));
  assert.deepEqual(ZR.zeroRetentionStops(routed).stops.map(s => s.model), ['anthropic/claude-fable-5.2', 'anthropic/claude-fable-5.1'], 'the routed Fable seats have none, Opus, Sonnet and Haiku have');
  assert.equal(Object.keys(t.models).length > 100, true);
});

// A dated table expires on purpose (like src/pricing.json's OpenRouter rows): a release-week chore. Its own test, so a stale table reds this one alone.
test('ZR-6: the shipped table was read from OpenRouter\'s list recently', async () => {
  const ZR = await loadZR(), t = ZR.ZDR_TABLE;
  const age = Math.floor((Date.now() - Date.parse(`${t.asOf}T00:00:00Z`)) / 86_400_000);
  assert.ok(age <= ZR.ZDR_STALE_DAYS, `src/zdr-hosts.json was read from OpenRouter's list ${age} days ago (limit ${ZR.ZDR_STALE_DAYS}): run node scripts/refresh-zdr-table.mjs --fetch <a file outside the repository>, then --from-file <it> --as-of <the day> --write`);
});

test('ZR-7: the setting decision: a typed value beats the environment, which beats the run\'s record; a record only keeps the setting on; a bad value stops; a start is refused (not a dry-run line) with every way on named; a stale table refuses; the line says what is covered', async () => {
  const ZR = await loadZR(), TABLE = (await loadTable())(rows, '2026-11-10'), now = Date.parse('2026-11-12T00:00:00Z');
  const seats = [or('a/one'), or('x/none'), or('x/none'), { provider: 'anthropic', model: 'claude-opus-5-5' }];
  const decide = (o = {}) => ZR.resolveZeroRetention(seats, { table: TABLE, now, ...o });
  assert.deepEqual([decide().on, decide().changed, decide().refusal], [false, false, null], 'nothing typed, nothing recorded: off');
  const envOn = decide({ env: { COUNCIL_ZERO_RETENTION: 'on' } });
  assert.deepEqual([envOn.on, envOn.changed, envOn.covered, envOn.notCovered], [true, true, 3, 1]);
  assert.equal(envOn.refusal, "Zero retention is on, but this program has no host it may send x/none (2 seats, not on that list) to (OpenRouter's list of 2026-11-10). Nothing was started and nothing was spent. To run anyway, switch it off with --zero-retention off.");
  assert.deepEqual([decide({ flag: 'off', env: { COUNCIL_ZERO_RETENTION: 'on' }, recorded: true }).on, decide({ flag: 'off', recorded: true }).changed], [false, true], 'a typed off beats the environment and the record');
  assert.deepEqual([decide({ env: { COUNCIL_ZERO_RETENTION: 'on' }, recorded: false }).on, decide({ recorded: true }).on, decide({ recorded: true, env: { COUNCIL_ZERO_RETENTION: 'on' } }).changed], [true, true, false], 'the environment is on whatever the record says; a record keeps it on; the same value is no change');
  assert.deepEqual([decide({ env: { COUNCIL_ZERO_RETENTION: 'off' }, recorded: true }).on], [false], 'the environment may switch a recorded run off: it is the person\'s own channel (a project file never sets it: src/env-file.js)');
  const bad = decide({ flag: 'maybe', flagSource: 'the zero_retention argument' });
  assert.equal(bad.stop, true); assert.equal(bad.code, 'unknown_value'); assert.match(bad.message, /^the zero_retention argument: "maybe" is not a zero-retention setting\. Use on or off\. Nothing was started and nothing was spent\.$/);
  // a Claude seat routed through OpenRouter with no host: the Anthropic way on is named too, with its limit said plainly
  const fable = ZR.resolveZeroRetention([or('anthropic/claude-fable-5.2')], { table: TABLE, now, flag: 'on', offWay: 'COUNCIL_ZERO_RETENTION=off' });
  assert.match(fable.refusal, /no host it may send anthropic\/claude-fable-5\.2 \(1 seat, not on that list\) to \(OpenRouter's list of 2026-11-10\)\. Nothing was started and nothing was spent\. To run anyway, switch it off with COUNCIL_ZERO_RETENTION=off, or send the Claude seats straight to Anthropic with --claude-route anthropic \(that needs ANTHROPIC_API_KEY, and seats called straight to a lab are not covered by this setting\)\.$/);
  assert.doesNotMatch(envOn.refusal, /claude-route/, 'the Anthropic way on is named only for a Claude seat');
  const pinned = ZR.resolveZeroRetention([or('a/one', { provider: { max_price: { prompt: 0.1, completion: 0.1 } } }), or('b/two')], { table: TABLE, now, flag: 'on' });
  assert.match(pinned.refusal, /a\/one \(1 seat, none at or under its price limit of \$0\.1 and \$0\.1 per million tokens\), b\/two \(1 seat, none of its hosts on that list is one this setting uses\)/);
  assert.equal(ZR.resolveZeroRetention([or('a/one')], { table: TABLE, now, flag: 'on' }).refusal, null, 'every seat has an allowed host: no refusal');
  const stale = ZR.resolveZeroRetention([or('a/one')], { table: TABLE, now: Date.parse('2026-12-31T00:00:00Z'), flag: 'on' });
  assert.match(stale.refusal, /^Zero retention is on, but the list of zero-retention hosts this program holds is from 2026-11-10 and is older than 45 days, so it cannot say which seats a host serves\. Nothing was started and nothing was spent\. To refresh it, run: council refresh-zdr-list\. To run anyway, switch it off with --zero-retention off\.$/);
  assert.equal(ZR.resolveZeroRetention([or('a/one')], { table: TABLE, now: Date.parse('2026-12-25T00:00:00Z'), flag: 'off' }).refusal, null, 'off is never refused, however old the table');
  // the line: nothing when off; says what is reached and what is not, and no claim about what a host does
  assert.deepEqual(ZR.zeroRetentionLines({ on: false, covered: 3, notCovered: 1 }), []);
  assert.deepEqual(ZR.zeroRetentionLines({ on: true, covered: 3, notCovered: 1, asOf: '2026-11-10' }), ["Zero retention is on: 3 seats go through OpenRouter, and each call names only the hosts that OpenRouter's list of 2026-11-10 gives for its model as zero-retention hosts. 1 seat is called straight to the lab, and this setting does not reach it. What a request cannot rule out is ruled out by the setting \"zero-data-retention only\" in your OpenRouter privacy settings."]);
  assert.deepEqual(ZR.zeroRetentionLines({ on: true, covered: 1, notCovered: 0, asOf: '2026-11-10' }), ["Zero retention is on: 1 seat goes through OpenRouter, and each call names only the hosts that OpenRouter's list of 2026-11-10 gives for its model as zero-retention hosts. What a request cannot rule out is ruled out by the setting \"zero-data-retention only\" in your OpenRouter privacy settings."]);
});

test('ZR-9: a tree that began with the setting on keeps it for every run it starts later; the environment of the command wins when it says on or off', async () => {
  const ZR = await loadZR();
  const E = v => (v === undefined ? {} : { COUNCIL_ZERO_RETENTION: v });
  assert.equal(ZR.treeZeroRetentionOption({ zeroRetention: true }, E()), 'on', 'a new terminal without the variable does not switch the tree off');
  assert.equal(ZR.treeZeroRetentionOption({ zeroRetention: true }, E('off')), 'off', 'a typed off is the person\'s choice');
  assert.equal(ZR.treeZeroRetentionOption({ zeroRetention: true }, E('on')), 'on');
  assert.equal(ZR.treeZeroRetentionOption({}, E()), undefined, 'a tree that began without it passes nothing'); assert.equal(ZR.treeZeroRetentionOption({}, E('on')), 'on', 'the variable switches it on for the runs started now');
  assert.equal(ZR.treeZeroRetentionOption(undefined, E()), undefined); assert.equal(ZR.treeZeroRetentionOption({ zeroRetention: true }, E('maybe')), undefined, 'a variable that is not on or off passes nothing, so the run\'s own start reads it and refuses it (exit 2, as ZE-1), whatever the tree began with');
  assert.equal(ZR.treeZeroRetentionOption({}, E('maybe')), undefined);
});
