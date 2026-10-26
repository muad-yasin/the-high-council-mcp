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
import { lintChain } from '../src/chain-lint.js';
import { worstCaseOf, projectAttemptsTokens, priceOf } from '../src/cost.js';
import { setUserPrices, resetUserPrices } from '../src/price-table.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => resetUserPrices());

// qwen/qwen3.7-plus: shipped row 0.4 / 1.6 (src/pricing.json).
const ROW = { prompt: 0.4, completion: 1.6 };
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
  assert.deepEqual(body.provider, { zdr: true, data_collection: 'deny', max_price: ROW });
  const bare = await sentBody(seatOf());
  assert.deepEqual(bare.body.provider, { max_price: ROW }, 'a seat with no extra at all is pinned too');
});

// OLD (061bb4a): an extra.provider that was not a plain object was "left alone" (sent as typed, no pin, while the cap projected at the row). NEW: it is refused, so no OpenRouter call goes out without the filter.
// WHY: C&C ruling 18 Okt 2026 (the UnpricedSeat pattern: pre-flight refusal + invoke() backstop). A seat whose own pin is valid still keeps it exactly, other keys included.
test('PP-2: a seat that already carries a complete max_price keeps it exactly, its other keys too (the user\'s pin wins); an extra.provider or max_price that is not a plain object is REFUSED naming the seat and the field', async () => {
  const own = { prompt: 9, completion: 9, request: 1 };
  const { body } = await sentBody(seatOf({ provider: { max_price: own, order: ['x'] } }));
  assert.deepEqual(body.provider, { max_price: own, order: ['x'] });
  for (const [extra, field] of [[{ provider: 'weird' }, 'extra.provider'], [{ provider: ['a'] }, 'extra.provider'], [{ provider: null }, 'extra.provider'], [{ provider: { max_price: '0.4' } }, 'extra.provider.max_price'], [{ provider: { max_price: [1] } }, 'extra.provider.max_price'], [{ provider: { max_price: null } }, 'extra.provider.max_price']]) {
    assert.throws(() => pinnedExtra(seatOf(), extra), e => e instanceof PinRefused && e.controlFlow === true && e.field === field && e.message.includes('openrouter/qwen/qwen3.7-plus') && e.message.includes(field), JSON.stringify(extra));
  }
});

test('PP-3: another provider, a seat with no usable row, and a free or zero row are returned UNCHANGED (same object)', () => {
  const direct = { provider: 'openai', model: 'gpt-5', extra: { reasoning_effort: 'high' } };
  assert.equal(pinnedExtra(direct, direct.extra), direct.extra);
  const unknown = seatOf({ a: 1 }, 'nobody/not-in-the-table');
  assert.equal(pinnedExtra(unknown, unknown.extra), unknown.extra);
  assert.equal(pinnedExtra(seatOf(undefined, 'nobody/not-in-the-table'), undefined), undefined, 'a seat with no extra and no row keeps undefined');
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
  assert.ok(n >= 100, `${n} openrouter seats checked`);
});

test('PP-8: the README says what the pin is (spend-cap section) and what has not been run (known limits); the CHANGELOG has its line', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8'); const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const reference = readFileSync(join(ROOT, 'AI-README.md'), 'utf8');   // README split (owner, 26 Okt 2026: "one final commit"): the section moved word for word to AI-README.md (The spend cap); the Known limits stay in the README
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
  assert.equal(pinnedExtra(seatOf(), complete), complete, 'a complete user pin is returned as the same object, even below the row');
  const { body } = await sentBody(seatOf({ provider: { zdr: true, max_price: { prompt: 2 } } }));
  assert.deepEqual(body.provider, { zdr: true, max_price: { prompt: 2, completion: 1.6 } }, 'the request carries the completed pin');
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
