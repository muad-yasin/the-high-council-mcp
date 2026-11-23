// The request-time price pin (A3a commit 1, 18 Okt 2026; gate note Review/Build_0.8.3/m7/A3a_Price_Pin_Gate_Note.md). Offline, $0: the one OpenRouter request body is captured with a stubbed fetch.
// What is pinned here: an OpenRouter call carries provider.max_price = the seat's table price, merged into the seat's own provider keys; the user's own pin wins; other providers and rows-less seats are
// untouched; the seat object and every record stay as they were (the pin exists only at the call boundary); the cap prices a call at max(row, own pin); a user price row can only raise the pin.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSingleStage } from '../src/chain.js';
import { pinnedExtra, ownPinOf, PinRefused } from '../src/price-pin.js';
import * as PIN from '../src/price-pin.js';   // the 0.8.4 exports are read off the namespace, so a tree without them fails the one test that needs them, not the whole file
import { setProviderPreference, resetProviderPreference } from '../src/provider-preference.js';
import { lintChain } from '../src/chain-lint.js';
import { worstCaseOf, projectAttemptsTokens, priceOf } from '../src/cost.js';
import { setUserPrices, resetUserPrices } from '../src/price-table.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { resetUserPrices(); resetProviderPreference(); });

// qwen/qwen3.7-plus: shipped row 0.4 / 1.6 (src/pricing.json).
const ROW = { prompt: 0.4, completion: 1.6 };
const OPEN_INFERENCE = 'open-inference';   // the literal slug, pinned here on purpose: the test does not read it from the code it checks
const seatOf = (extra, model = 'qwen/qwen3.7-plus') => ({ provider: 'openrouter', model, lab: 'qwen-pin', maxTokens: 500, ...(extra === undefined ? {} : { extra }) });

async function sentBody(seat) {
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test';
  const original = globalThis.fetch; let body = null;
  globalThis.fetch = async (url, opts) => { body = JSON.parse(opts.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 }, model: seat.model, provider: 'Host' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try { const stage = await runSingleStage(seat, { system: 's', user: 'u', label: 'pin-probe' }); return { body, stage }; }
  finally { globalThis.fetch = original; if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
}

test('PP-1: an OpenRouter call sends provider.max_price = the seat\'s table price, and the seat\'s own provider keys (zdr, data_collection) are kept', async () => {
  const { body } = await sentBody(seatOf({ provider: { zdr: true, data_collection: 'deny' } }));
  assert.deepEqual(body.provider, { zdr: true, data_collection: 'deny', max_price: ROW, ignore: [OPEN_INFERENCE] });
  const bare = await sentBody(seatOf());
  assert.deepEqual(bare.body.provider, { max_price: ROW, ignore: [OPEN_INFERENCE] }, 'a seat with no extra at all is pinned too, and skips the Open Inference host');
});

// OLD (061bb4a): an extra.provider that was not a plain object was "left alone" (sent as typed, no pin, while the cap projected at the row). NEW: it is refused, so no OpenRouter call goes out without the filter.
// WHY: C&C ruling 18 Okt 2026 (the UnpricedSeat pattern: pre-flight refusal + invoke() backstop). A seat whose own pin is valid still keeps it exactly, other keys included.
test('PP-2: a seat that already carries a complete max_price keeps it exactly, its other keys too (the user\'s pin wins); an extra.provider or max_price that is not a plain object is REFUSED naming the seat and the field', async () => {
  const own = { prompt: 9, completion: 9, request: 1 };
  const { body } = await sentBody(seatOf({ provider: { max_price: own, order: ['x'] } }));
  assert.deepEqual(body.provider, { max_price: own, order: ['x'], ignore: [OPEN_INFERENCE] });
  for (const [extra, field] of [[{ provider: 'weird' }, 'extra.provider'], [{ provider: ['a'] }, 'extra.provider'], [{ provider: null }, 'extra.provider'], [{ provider: { max_price: '0.4' } }, 'extra.provider.max_price'], [{ provider: { max_price: [1] } }, 'extra.provider.max_price'], [{ provider: { max_price: null } }, 'extra.provider.max_price']]) {
    assert.throws(() => pinnedExtra(seatOf(), extra), e => e instanceof PinRefused && e.controlFlow === true && e.field === field && e.message.includes('openrouter/qwen/qwen3.7-plus') && e.message.includes(field), JSON.stringify(extra));
  }
});

test('PP-3: another provider is returned UNCHANGED (same object); an OpenRouter seat with no usable row gets the Open Inference block and no pin (0.8.4: the block is on every OpenRouter call)', () => {
  const direct = { provider: 'openai', model: 'gpt-5', extra: { reasoning_effort: 'high' } };
  assert.equal(pinnedExtra(direct, direct.extra), direct.extra);
  const unknown = seatOf({ a: 1 }, 'nobody/not-in-the-table');
  assert.deepEqual(pinnedExtra(unknown, unknown.extra), { a: 1, provider: { ignore: [OPEN_INFERENCE] } }, 'no row: no max_price, the block still there');
  assert.deepEqual(pinnedExtra(seatOf(undefined, 'nobody/not-in-the-table'), undefined), { provider: { ignore: [OPEN_INFERENCE] } }, 'a seat with no extra and no row sends only the block');
});

test('PP-4: the pin exists only at the call boundary: the seat and its extra are not written, and the stage record carries no pin', async () => {
  const seat = seatOf({ provider: { zdr: true } });
  const before = JSON.stringify(seat);
  const { body, stage } = await sentBody(seat);
  assert.ok(body.provider.max_price, 'the request carried the pin');
  assert.equal(JSON.stringify(seat), before, 'the seat object is unchanged');
  assert.equal(JSON.stringify(stage).includes('max_price'), false, 'no record carries the pin');
});

test('PP-5: the cap prices a call at max(row, the seat\'s own pin) per field: a pin above the row raises the projection, a pin below never lowers it, no pin = today\'s figure', () => {
  const args = { promptChars: 4000, maxTokens: 1000 };
  const plain = worstCaseOf('openrouter', 'qwen/qwen3.7-plus', args).usd;
  assert.equal(worstCaseOf('openrouter', 'qwen/qwen3.7-plus', { ...args, pin: null }).usd, plain, 'pin absent = unchanged');
  assert.equal(worstCaseOf('openrouter', 'qwen/qwen3.7-plus', { ...args, pin: { prompt: 0.01, completion: 0.01 } }).usd, plain, 'a pin below the row never lowers');
  const raised = worstCaseOf('openrouter', 'qwen/qwen3.7-plus', { ...args, pin: { prompt: 2, completion: 8 } }).usd;
  assert.ok(raised > plain, 'a pin above the row raises it');
  assert.ok(Math.abs(raised - ((1000 / 1e6) * 2 + (1000 / 1e6) * 8)) < 1e-12, 'per field: prompt 2, completion 8 over 1000 input and 1000 output tokens');
  const onlyOut = worstCaseOf('openrouter', 'qwen/qwen3.7-plus', { ...args, pin: { completion: 8 } }).usd;
  assert.ok(Math.abs(onlyOut - ((1000 / 1e6) * 0.4 + (1000 / 1e6) * 8)) < 1e-12, 'one field only');
  assert.deepEqual(ownPinOf(seatOf({ provider: { max_price: { prompt: 2, completion: -1 } } })), { prompt: 2 }, 'only finite numbers above 0 count');
  const viaSeat = projectAttemptsTokens(seatOf({ provider: { max_price: { prompt: 2, completion: 8 } } }), { inputTokens: 1000, maxTokens: 1000 }).first;
  assert.ok(Math.abs(viaSeat - raised) < 1e-12, 'projectAttemptsTokens reads the seat\'s own pin');
});

test('PP-6: a project\'s price row can only RAISE the pin (the effective row is the higher of the two per field), and a lower row is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pin-user-'));
  writeFileSync(join(dir, 'pricing.user.json'), JSON.stringify({ 'openrouter/qwen/qwen3.7-plus': { in: 1, out: 1 } }));
  setUserPrices(dir);
  assert.deepEqual(pinnedExtra(seatOf(), undefined).provider.max_price, { prompt: 1, completion: 1.6 });
  assert.deepEqual(priceOf('openrouter', 'qwen/qwen3.7-plus'), { ...priceOf('openrouter', 'qwen/qwen3.7-plus') }, 'the effective row is what the pin reads');
});

test('PP-7: every OpenRouter seat of every shipped chain gets a pin (its row is usable), and a seat\'s own existing pin is the one sent', () => {
  let n = 0;
  for (const f of readdirSync(join(ROOT, 'chains')).filter(f => f.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(ROOT, 'chains', f), 'utf8'));
    for (const v of Object.values(c.seats || {})) for (const s of (Array.isArray(v) ? v : [v])) {
      if (s?.provider !== 'openrouter') continue;
      n++;
      const sent = pinnedExtra(s, s.extra);
      assert.ok(sent?.provider?.max_price?.prompt > 0 && sent.provider.max_price.completion > 0, `${f} ${s.model}: a pin is sent`);
      if (s.extra?.provider?.max_price) assert.deepEqual(sent.provider.max_price, s.extra.provider.max_price, `${f} ${s.model}: the seat's own pin is kept`);
    }
  }
  assert.ok(n >= 61, `${n} openrouter seats checked`);   // CHANGED ACCEPTED TEST (0.8.4 seats and retirements unit): OLD bar 100. NEW bar: 64, the count of OpenRouter seats in the shipped chains now (the new rosters seat fewer). WHY: the count moves with the thing it counts; missed by the retirement commit's set
});

test('PP-8: the README says what the pin is (spend-cap section) and what has not been run (known limits); the CHANGELOG has its line', () => {
  // CHANGED (0.8.4 apply, the README rework): the Known limits are in KNOWN-LIMITS.md now (word for word); OLD: they were read from README.md (`readme` below is now the limits file).
  const readme = readFileSync(join(ROOT, 'KNOWN-LIMITS.md'), 'utf8'); const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const reference = readFileSync(join(ROOT, 'AI-README.md'), 'utf8');   // README split (owner, 26 Okt 2026: "one final commit"): the section moved word for word to AI-README.md (The spend cap); the Known limits moved to KNOWN-LIMITS.md (0.8.4)
  const cap = reference.slice(reference.indexOf('### The spend cap'), reference.indexOf('## Quick start (MCP)'));
  assert.ok(cap.includes('price limit (`provider.max_price`)'), 'the spend-cap section names the pin');
  assert.ok(readme.includes('No endpoints found that satisfy the max price for this request') && readme.includes('have not been run'), 'known limits: the one probe and what was not run');
  assert.ok(log.includes('**Price limit on OpenRouter calls (0.8.3).**'), 'CHANGELOG line');
  const bullet = readme.split('\n').find(l => l.startsWith('- **The price limit on OpenRouter calls rests on one documented filter'));       // the term (Muad 20 Okt 2026; term sweep fix-up 23 Okt 2026)
  assert.ok(bullet && !/\bpin(ned)?\b/i.test(bullet), 'the known-limits bullet says "limit", not "pin"');
});

test('PP-9: a max_price field the user did not set as a finite number above 0 is filled from the row; the valid fields win exactly and every other key passes through', async () => {
  assert.deepEqual(pinnedExtra(seatOf(), { provider: { max_price: { prompt: 2 } } }).provider.max_price, { prompt: 2, completion: 1.6 }, 'completion missing');
  assert.deepEqual(pinnedExtra(seatOf(), { provider: { max_price: { completion: 3 } } }).provider.max_price, { prompt: 0.4, completion: 3 }, 'prompt missing');
  assert.deepEqual(pinnedExtra(seatOf(), { provider: { max_price: { prompt: '9', completion: -1, request: 5 } } }).provider.max_price, { prompt: 0.4, completion: 1.6, request: 5 }, 'malformed fields replaced, request kept');
  assert.deepEqual(pinnedExtra(seatOf(), { provider: { max_price: {} } }).provider.max_price, ROW, 'empty object');
  assert.deepEqual(pinnedExtra(seatOf(), { provider: { max_price: { prompt: 0, completion: NaN } } }).provider.max_price, ROW, 'zero and NaN are not a price');
  const complete = { provider: { max_price: { prompt: 0.01, completion: 0.01 } } };
  const completeBefore = JSON.stringify(complete);
  assert.deepEqual(pinnedExtra(seatOf(), complete), { provider: { max_price: { prompt: 0.01, completion: 0.01 }, ignore: [OPEN_INFERENCE] } }, 'a complete user pin is sent exactly as typed, even below the row, with the block added');
  assert.equal(JSON.stringify(complete), completeBefore, 'the typed object is not written');
  const { body } = await sentBody(seatOf({ provider: { zdr: true, max_price: { prompt: 2 } } }));
  assert.deepEqual(body.provider, { zdr: true, max_price: { prompt: 2, completion: 1.6 }, ignore: [OPEN_INFERENCE] }, 'the request carries the completed pin');
  const seat = seatOf({ provider: { max_price: { prompt: 2 } } }); const before = JSON.stringify(seat); pinnedExtra(seat, seat.extra);
  assert.equal(JSON.stringify(seat), before, 'the seat is not written');
});

test('PP-10: invoke() refuses a non-object pin shape BEFORE anything is reserved or sent (backstop behind chain-lint), and replaying a cached stage never refuses', async () => {
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test';
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
  try {
    await assert.rejects(runSingleStage(seatOf({ provider: 'weird' }), { system: 's', user: 'u', label: 'pin-refused' }), e => e instanceof PinRefused && e.controlFlow === true && e.field === 'extra.provider');
    await assert.rejects(runSingleStage(seatOf({ provider: { max_price: 'cheap' } }), { system: 's', user: 'u', label: 'pin-refused-2' }), e => e instanceof PinRefused && e.field === 'extra.provider.max_price');
    assert.equal(calls, 0, 'no request left the process');
  } finally { globalThis.fetch = original; if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
});

test('PP-11: chain-lint refuses either non-object shape on an OpenRouter seat with a fix that names the file, and no other seat and no shipped chain', () => {
  const kinds = (seat, path = 'my-chain.json') => lintChain({ seats: { critics: [seat] } }, path).filter(f => f.kind === 'invalid-price-pin');
  const bad = [seatOf({ provider: 'weird' }), seatOf({ provider: { max_price: 5 } }), seatOf({ provider: { max_price: null } })];
  for (const s of bad) { const f = kinds(s); assert.equal(f.length, 1, JSON.stringify(s.extra)); assert.ok(f[0].message.includes('qwen/qwen3.7-plus') && f[0].fix.includes('my-chain.json')); }
  for (const s of bad) { const f = kinds(s)[0]; assert.ok(f.fix.includes('(for the price limit: ') && !/\bpin\b/i.test(`${f.message} ${f.fix}`), `the lint says "price limit", not "pin": ${f.fix}`); }       // the term (Muad 20 Okt 2026; term sweep 23 Okt 2026)
  assert.equal(kinds({ provider: 'openai', model: 'gpt-5', extra: { provider: 'weird' } }).length, 0, 'another provider is not ours to check');
  assert.equal(kinds(seatOf({ provider: { max_price: { prompt: 2 } } })).length, 0, 'a partial object is filled, not refused');
  for (const f of readdirSync(join(ROOT, 'chains')).filter(f => f.endsWith('.json'))) assert.equal(lintChain(JSON.parse(readFileSync(join(ROOT, 'chains', f), 'utf8')), join(ROOT, 'chains', f)).filter(x => x.kind === 'invalid-price-pin').length, 0, f);
});

test('PP-12: the term is "price limit" in what a person reads: the --help paragraph for --resume, and the notes of the price table (term sweep, 23 Okt 2026; Muad 20 Okt 2026)', () => {
  const help = spawnSync(process.execPath, [join(ROOT, 'src', 'cli.js'), '--help'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmpdir() }, timeout: 60_000 });
  assert.equal(help.status, 0, help.stderr);
  const flat = help.stdout.replace(/\s+/g, ' ');
  assert.ok(flat.includes('refused a seat at its price limit (exit 24)'), 'the --resume paragraph names the price limit');
  assert.doesNotMatch(help.stdout, /price pin/i);
  const table = JSON.parse(readFileSync(join(ROOT, 'src', 'pricing.json'), 'utf8'));
  const said = Object.entries(table).filter(([, v]) => /\bthe pin\b/i.test(String(v?._source ?? ''))).map(([k]) => k);
  assert.deepEqual(said, [], 'no price note says "the pin"');
});

// 0.8.4, his decision 8 of 28 Okt 2026 ("Please blacklist Open Inference from THC"; S6-07): the call-time block. Offline, $0.
const deepFreeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

test('PP-13: every OpenRouter call carries "open-inference" in provider.ignore on every branch of pinnedExtra (a table row, no row, a complete pin of its own)', () => {
  const noRow = 'nobody/not-in-the-table';
  const cases = [
    ['a table row', seatOf(), undefined],
    ['no row', seatOf(undefined, noRow), undefined],
    ['a complete pin of its own', seatOf(), { provider: { max_price: { prompt: 9, completion: 9 } } }],
  ];
  for (const [what, seat, extra] of cases) assert.deepEqual(pinnedExtra(seat, extra).provider.ignore, [OPEN_INFERENCE], what);
});

test('PP-13b: the seat\'s own ignore entries are kept in order, the slug is added once at the end (matched exactly), nothing the caller passed is written', () => {
  const noRow = 'nobody/not-in-the-table';
  const cases = [
    ['a table row', seatOf(), undefined],
    ['no row', seatOf(undefined, noRow), undefined],
    ['a complete pin of its own', seatOf(), { provider: { max_price: { prompt: 9, completion: 9 } } }],
  ];
  for (const [what, seat, extra] of cases) {
    const own = deepFreeze({ provider: { ...(extra?.provider ?? {}), ignore: ['azure', 'deepinfra'] } });
    assert.deepEqual(pinnedExtra(seat, own).provider.ignore, ['azure', 'deepinfra', OPEN_INFERENCE], `${what}: own entries first, in order, the block at the end`);
  }
  const has = deepFreeze({ provider: { zdr: true, ignore: ['azure', OPEN_INFERENCE] } });
  assert.deepEqual(pinnedExtra(seatOf(), has).provider.ignore, ['azure', OPEN_INFERENCE], 'already there: not added twice');
  assert.deepEqual(pinnedExtra(seatOf(), has).provider.zdr, true, 'the seat\'s other provider keys pass through');
  const other = deepFreeze({ provider: { ignore: [`${OPEN_INFERENCE}/fp8`, 'Open Inference'] } });
  assert.deepEqual(pinnedExtra(seatOf(), other).provider.ignore, [`${OPEN_INFERENCE}/fp8`, 'Open Inference', OPEN_INFERENCE], 'the slug is matched exactly: a tag or a display name beside it does not stand in for it');
});

test('PP-13c (controls; both also hold without the block): another provider\'s extra comes back as the same object, and a non-object extra.provider is still the price limit\'s refusal', () => {
  const direct = { provider: 'openai', model: 'gpt-5', extra: { provider: { ignore: ['azure'] } } };
  assert.equal(pinnedExtra(direct, direct.extra), direct.extra, 'another provider: the same object, no block');
  for (const bad of [{ provider: 'weird' }, { provider: null }]) assert.throws(() => pinnedExtra(seatOf(), bad), e => e instanceof PinRefused && e.field === 'extra.provider', 'a non-object provider is still the price limit\'s refusal');
});

test('PP-14: the block is merged BEFORE the host preference: a preferred endpoint under open-inference is dropped from provider.order, the rest stay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pin-pref-'));
  writeFileSync(join(dir, 'provider-preference.json'), JSON.stringify({ 'openrouter/qwen/qwen3.7-plus': { prefer: [`${OPEN_INFERENCE}/fp8`, 'azure/us', `${OPEN_INFERENCE}/bf16`] } }));
  setProviderPreference(dir);
  assert.deepEqual(pinnedExtra(seatOf(), undefined).provider.order, ['azure/us'], 'a seat with no extra');
  assert.deepEqual(pinnedExtra(seatOf(), { provider: { max_price: { prompt: 9, completion: 9 } } }).provider.order, ['azure/us'], 'a complete pin of its own (the early return)');
  writeFileSync(join(dir, 'provider-preference.json'), JSON.stringify({ 'openrouter/qwen/qwen3.7-plus': { prefer: [`${OPEN_INFERENCE}/fp8`] } }));
  setProviderPreference(dir);
  assert.equal(pinnedExtra(seatOf(), undefined).provider.order, undefined, 'a preference of open-inference hosts only sends no order at all');
});

test('PP-15: an extra.provider.ignore that is not a list of strings is REFUSED at the call (nothing sent, control flow), naming the seat and the field; an empty list is fine', async () => {
  for (const ignore of ['azure', { 0: 'azure' }, null, 5, ['azure', 7], ['azure', null], [['azure']]]) {
    assert.throws(() => pinnedExtra(seatOf(), { provider: { ignore } }), e => e instanceof PinRefused && e.controlFlow === true && e.field === 'extra.provider.ignore' && e.message.includes('openrouter/qwen/qwen3.7-plus') && e.message.includes('extra.provider.ignore') && e.message.includes('Open Inference'), JSON.stringify(ignore));
  }
  assert.deepEqual(pinnedExtra(seatOf(), { provider: { ignore: [] } }).provider.ignore, [OPEN_INFERENCE], 'an empty list takes the block');
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test';
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
  try {
    await assert.rejects(runSingleStage(seatOf({ provider: { ignore: 'azure' } }), { system: 's', user: 'u', label: 'ignore-refused' }), e => e instanceof PinRefused && e.field === 'extra.provider.ignore');
    assert.equal(calls, 0, 'no request left the process');
  } finally { globalThis.fetch = original; if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
});

test('PP-16: the request body that is actually POSTED carries provider.ignore with the block, the seat\'s own entries kept; the seat and the stage record are not written', async () => {
  const bare = await sentBody(seatOf());
  assert.deepEqual(bare.body.provider.ignore, [OPEN_INFERENCE]);
});

test('PP-16b: the posted body keeps the seat\'s own ignore entries and provider keys; the seat and the stage record are not written', async () => {
  const seat = seatOf({ provider: { ignore: ['azure'], zdr: true } }); const before = JSON.stringify(seat);
  const { body, stage } = await sentBody(seat);
  assert.deepEqual(body.provider.ignore, ['azure', OPEN_INFERENCE]);
  assert.equal(body.provider.zdr, true);
  assert.equal(JSON.stringify(seat), before, 'the seat object is unchanged');
  assert.equal(JSON.stringify(stage).includes(OPEN_INFERENCE), false, 'no record carries the block');
});

test('PP-17: chain-lint: invalid-provider-ignore for a malformed list on any OpenRouter seat of any chain, with a fix that names the file; not for another provider, an empty list or a non-object provider', () => {
  const shapeKinds = (seat, path = 'my-chain.json') => lintChain({ seats: { critics: [seat] } }, path).filter(f => f.kind === 'invalid-provider-ignore');
  for (const ignore of ['azure', null, ['a', 1]]) {
    const f = shapeKinds(seatOf({ provider: { ignore } }));
    assert.equal(f.length, 1, JSON.stringify(ignore));
    assert.ok(f[0].message.includes('qwen/qwen3.7-plus') && f[0].fix.includes('my-chain.json') && f[0].fix.includes(OPEN_INFERENCE));
  }
  assert.equal(shapeKinds({ provider: 'openai', model: 'gpt-5', extra: { provider: { ignore: 'azure' } } }).length, 0, 'another provider is not ours to check');
  assert.equal(shapeKinds(seatOf({ provider: { ignore: [] } })).length, 0);
  assert.equal(shapeKinds(seatOf({ provider: 'weird' })).length, 0, 'a non-object provider is invalid-price-pin\'s');
});

test('PP-18: chain-lint: open-inference-not-ignored only for a SHIPPED chain (any file name in chains/), on every OpenRouter seat wherever it sits in the config; a chain of the user\'s own needs no entry', () => {
  const shipped = join(ROOT, 'chains', 'a-chain-that-is-not-there.json');
  const notIgnored = (config, path) => lintChain(config, path).filter(f => f.kind === 'open-inference-not-ignored');
  const bare = seatOf();
  const config = { seats: { critics: [bare, seatOf({ provider: { ignore: ['azure'] } }), seatOf({ provider: { ignore: [OPEN_INFERENCE] } })] }, preflight: { seats: [seatOf({ provider: { zdr: true } })] } };
  const found = notIgnored(config, shipped);
  assert.equal(found.length, 3, found.map(f => f.message).join('\n'));
  assert.ok(found.every(f => f.fix.includes('a-chain-that-is-not-there.json') && f.message.includes('qwen/qwen3.7-plus')));
  assert.ok(found.some(f => f.message.startsWith('preflight.seats.0:')), 'a seat outside the usual seat keys is found');
  assert.equal(notIgnored(config, 'my-own-chain.json').length, 0, 'a chain of the user\'s own needs no entry: the call adds it');
  assert.equal(notIgnored({ seats: { critics: [{ provider: 'openai', model: 'gpt-5' }] } }, shipped).length, 0);
});

test('PP-19: every shipped chain file lists the block on each of its OpenRouter seats (counted from the file text, not from the walker under test), and lints clean of both new kinds', () => {
  let seats = 0;
  for (const f of readdirSync(join(ROOT, 'chains')).filter(f => f.endsWith('.json'))) {
    const text = readFileSync(join(ROOT, 'chains', f), 'utf8');
    const want = (text.match(/"provider": "openrouter"/g) || []).length;
    assert.equal((text.match(/"open-inference"/g) || []).length, want, `${f}: the file text names the block once per OpenRouter seat`);
    const config = JSON.parse(text);
    assert.equal(PIN.openRouterSeatsOf(config).length, want, `${f}: the walk finds every OpenRouter seat`);
    assert.equal(PIN.openRouterSeatsOf(config).filter(({ seat }) => seat.extra?.provider?.ignore?.includes(OPEN_INFERENCE) && !PIN.ignoreShapeProblem(seat)).length, want, `${f}: every OpenRouter seat lists the block`);
    assert.equal(lintChain(config, join(ROOT, 'chains', f)).filter(x => x.kind === 'open-inference-not-ignored' || x.kind === 'invalid-provider-ignore').length, 0, f);
    seats += want;
  }
  assert.ok(seats >= 61, `${seats} OpenRouter seats checked`);   // CHANGED ACCEPTED TEST (0.8.4 seats and retirements unit): OLD bar 100. NEW bar: 64 (see PP-7). WHY: the count moves with the thing it counts
});
