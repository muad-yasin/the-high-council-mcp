// 0.8.3 (Muad 21 Okt 2026): a price refusal with a person at the terminal asks to raise the price and continue, instead of only stopping. All $0, no network (the host list, the terminal and the resume are injected). Rows:
// PR-1 the cheapest SINGLE host that can serve the seat (a down host, a host without reasoning and a host with too small an output allowance are skipped; the two minimums of different hosts are never combined); PR-2 a failed lookup says why;
// PR-3 yes writes the rows into pricing.user.json and no writes nothing; PR-4 no offer when the cheapest host is not above the limit or the lookup fails; PR-5 who is asked at all (mayOffer); PR-6 the resume starts at exit with the exit code of the resumed run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { askLine, cheapestHost, offerPriceRaise, offerWords, mayOffer, resumeAtExit } from '../src/price-raise.js';

const host = (name, prompt, completion, extra = {}) => ({ provider_name: name, pricing: { prompt: String(prompt / 1e6), completion: String(completion / 1e6) }, status: 0, max_completion_tokens: 100000, supported_parameters: ['reasoning', 'max_tokens'], ...extra });
const listOf = hosts => async () => ({ ok: true, status: 200, json: async () => ({ data: { endpoints: hosts } }) });

test('PR-1 the cheapest SINGLE host that can serve the seat: skips a down host, one without reasoning and one with too small an output allowance; never mixes the two minimums', { timeout: 60_000 }, async () => {
  const hosts = [host('Down', 0.1, 0.1, { status: -1 }), host('NoReasoning', 0.2, 0.2, { supported_parameters: ['max_tokens'] }), host('Small', 0.3, 0.3, { max_completion_tokens: 1000 }), host('Mixed-A', 1, 5), host('Mixed-B', 2, 2)];
  const r = await cheapestHost('vendor/model', { fetchImpl: listOf(hosts), needs: { maxTokens: 64000, reasoning: true } });
  assert.deepEqual(r, { ok: true, host: { name: 'Mixed-B', in: 2, out: 2 } });
  const free = await cheapestHost('vendor/model', { fetchImpl: listOf(hosts), needs: {} });
  assert.equal(free.host.in + free.host.out, 0.4, 'with no needs the down host is still skipped and the cheapest usable one wins');
});

test('PR-2 a failed lookup says why: an HTTP error, a thrown error, no host listed, no host that can serve the seat', { timeout: 60_000 }, async () => {
  assert.match((await cheapestHost('v/m', { fetchImpl: async () => ({ ok: false, status: 500 }) })).why, /HTTP 500/);
  assert.match((await cheapestHost('v/m', { fetchImpl: async () => { throw new Error('offline'); } })).why, /could not be read \(offline\)/);
  assert.match((await cheapestHost('v/m', { fetchImpl: listOf([]) })).why, /lists no host/);
  assert.match((await cheapestHost('v/m', { fetchImpl: listOf([host('A', 1, 1, { max_completion_tokens: 10 })]), needs: { maxTokens: 64000 } })).why, /none of the listed hosts can serve this seat/);
});

const refused = (seat, pin) => ({ seat, pin, recognised: true, ownPin: false });

test('PR-3 yes writes the rows into pricing.user.json (never below the host price) and no writes nothing', { timeout: 60_000 }, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'price-raise-'));
  const set = [refused('openrouter/test/vendor-model', { prompt: 0.5, completion: 1.5 })];
  const said = [];
  const no = await offerPriceRaise({ set, folder, capUsd: 7, fetchImpl: listOf([host('Pricey', 1, 3)]), ask: async () => 'n', say: m => said.push(m) });
  assert.deepEqual(no, { offered: true, raised: false }); assert.equal(existsSync(join(folder, 'pricing.user.json')), false);
  const yes = await offerPriceRaise({ set, folder, capUsd: 7, fetchImpl: listOf([host('Pricey', 1, 3)]), ask: async () => 'Yes', say: m => said.push(m) });
  assert.equal(yes.raised, true);
  const file = JSON.parse(readFileSync(join(folder, 'pricing.user.json'), 'utf8'));
  assert.equal(file['openrouter/test/vendor-model'].in, 1); assert.equal(file['openrouter/test/vendor-model'].out, 3);
  assert.match(said[0], /OpenRouter's cheapest host that can serve this seat costs more than the price limit the call carried/);
  assert.match(said[0], /limit \$0\.5 in \/ \$1\.5 out, cheapest host Pricey at \$1 in \/ \$3 out/);
  assert.match(said[0], /\(the limit you typed, \$7, is not changed by this\), so a tight limit may stop the run sooner/);
});

test('PR-4 no offer when the cheapest host is not above the limit (the price is not what stopped it) or when the lookup fails; nothing is asked and nothing written', { timeout: 60_000 }, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'price-raise-'));
  const set = [refused('openrouter/test/vendor-model', { prompt: 2, completion: 4 })];
  const ask = async () => { throw new Error('must not be asked'); };
  const under = await offerPriceRaise({ set, folder, capUsd: 7, fetchImpl: listOf([host('Cheap', 1, 3)]), ask, say: () => {} });
  assert.equal(under.offered, false); assert.match(under.why, /gives no higher price to offer/);
  const down = await offerPriceRaise({ set, folder, capUsd: 7, fetchImpl: async () => { throw new Error('offline'); }, ask, say: () => {} });
  assert.equal(down.offered, false); assert.match(down.why, /could not be read/);
  assert.equal(existsSync(join(folder, 'pricing.user.json')), false);
});

test('PR-5 who is asked at all: a terminal, a plain run, only recognised price refusals, no own-pin seat, only OpenRouter', { timeout: 60_000 }, () => {
  const ok = { set: [refused('openrouter/a/b', { prompt: 1, completion: 1 })], tty: true, adviceOn: false, member: false };
  assert.equal(mayOffer(ok).ok, true);
  assert.equal(mayOffer({ ...ok, tty: false }).ok, false);
  assert.equal(mayOffer({ ...ok, adviceOn: true }).ok, false);
  assert.equal(mayOffer({ ...ok, member: true }).ok, false);
  assert.equal(mayOffer({ ...ok, set: [{ ...ok.set[0], recognised: false }] }).ok, false);
  assert.equal(mayOffer({ ...ok, set: [{ ...ok.set[0], ownPin: true }] }).ok, false);
  assert.equal(mayOffer({ ...ok, set: [{ ...ok.set[0], seat: 'anthropic/x' }] }).ok, false);
});

test('PR-6 the resume starts when the process has exited, with the run folder, and the exit code is the resumed run\'s', { timeout: 60_000 }, () => {
  const listeners = []; const proc = { execPath: '/node', on: (ev, fn) => listeners.push([ev, fn]), exitCode: undefined };
  const calls = [];
  resumeAtExit({ runPath: 'runs/R1', entry: '/cli.js', cwd: '/proj', proc, spawn: (...a) => { calls.push(a); return { status: 3 }; } });
  assert.equal(calls.length, 0, 'nothing starts before the process exits');
  listeners.find(([ev]) => ev === 'exit')[1]();
  assert.deepEqual(calls[0], ['/node', ['/cli.js', '--resume', 'runs/R1'], { stdio: 'inherit', cwd: '/proj' }]);
  assert.equal(proc.exitCode, 3);
  assert.match(offerWords({ rows: [{ seat: 's', pin: { prompt: 1, completion: 1 }, host: { name: 'H', in: 2, out: 2 } }], capUsd: null }), /writes a row into pricing\.user\.json in your project folder, which every later run there reads/);
});

test('PR-7 the prompt always answers: a typed line is returned, and the input ending or Ctrl-C counts as an empty answer (no yes), so exit 24 is kept', { timeout: 60_000 }, async () => {
  const mk = act => { const rl = new EventEmitter(); rl.question = (q, cb) => act(rl, cb); return rl; };
  assert.equal(await askLine(mk((rl, cb) => cb('y')), 'q'), 'y');
  assert.equal(await askLine(mk(rl => setImmediate(() => rl.emit('close'))), 'q'), '');
  assert.equal(await askLine(mk(rl => setImmediate(() => rl.emit('SIGINT'))), 'q'), '');
});

test('PR-8 a host name is network text: escape, control and bidi characters never reach a screen, and it is cut at 60 characters', { timeout: 60_000 }, async () => {
  const r = await cheapestHost('v/m', { fetchImpl: listOf([host('Evil\u001b[31m‮Name' + 'x'.repeat(100), 1, 1)]) });
  assert.equal(r.host.name, ('Evil [31m Name' + 'x'.repeat(100)).slice(0, 60));
  assert.doesNotMatch(r.host.name, /[\u0000-\u001f‮]/);
});

// HIGH unit fix-up (C&C thcmcp-cd, 24 Okt 2026; Muad 23 Okt 2026: "High should be *our* default setting. Some models are so cheap that *their* default is Max effort, and we can go with that"). A seat on a model whose own default is above
// high (the table's defaultAboveHigh: GLM-5.3, GLM-5.3 Flash, Qwen 3.8 Max) states no effort, so the call carries no reasoning field and the old test (a composed reasoning field) said "does not reason": the offer could name a host that does
// not list `reasoning` for a model that thinks by default. needsOfSeat is the one place that answers it, for the terminal path (src/cli.js) and the MCP path (src/mcp/price-raise.js).
test('PR-9 a seat on a model whose own default is above high reasons for the price-stop offer although it states no effort: the offer skips a host without `reasoning`; the two callers use the one function', async () => {
  const { needsOfSeat } = await import('../src/price-raise.js');
  const flash = { provider: 'openrouter', model: 'z-ai/glm-5.3-flash', maxTokens: 131072 };
  assert.deepEqual(needsOfSeat(flash, 64000), { maxTokens: 131072, reasoning: true }, 'defaultAboveHigh and no extra');
  assert.deepEqual(needsOfSeat({ provider: 'openrouter', model: 'qwen/qwen3.8-max-0902' }, 64000), { maxTokens: 64000, reasoning: true }, 'the default cap when the seat names none');
  assert.equal(needsOfSeat({ provider: 'openrouter', model: 'xiaomi/mimo-v2.6-pro', maxTokens: 131072, extra: { reasoning: { effort: 'high' } } }, 64000).reasoning, true, 'a stated high effort still counts');
  assert.equal(needsOfSeat({ provider: 'openrouter', model: 'vendor/not-in-the-table', maxTokens: 1000 }, 64000).reasoning, false, 'a model the table does not know, with no field, needs nothing');
  // both hosts can return the seat's whole 131,072-token cap (the helper's default allowance is smaller), so the only reason to skip one is `reasoning`
  const hosts = [host('NoReasoning', 0.2, 0.2, { supported_parameters: ['max_tokens'], max_completion_tokens: 200000 }), host('Reasoner', 0.5, 0.5, { supported_parameters: ['max_tokens', 'reasoning'], max_completion_tokens: 200000 })];
  const found = await cheapestHost('z-ai/glm-5.3-flash', { fetchImpl: listOf(hosts), needs: needsOfSeat(flash, 64000) });
  assert.deepEqual(found, { ok: true, host: { name: 'Reasoner', in: 0.5, out: 0.5 } }, 'the cheaper host that does not list reasoning is skipped');
  for (const f of ['src/cli.js', 'src/mcp/price-raise.js']) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(text.includes('needsOfSeat('), `${f} asks needsOfSeat`);
    assert.equal(/reasoning:\s*reasoningFieldPaths\(/.test(text), false, `${f} does not compute its own reasoning flag`);
  }
});
