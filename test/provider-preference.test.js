// 0.8.4 PRICES unit 3 (C&C ruling 1 Nov 2026): the project's host preference. provider-preference.json names, per OpenRouter model, the endpoint tags to try FIRST. It is read like pricing.user.json (once, fails closed), changes only the ORDER
// OpenRouter tries hosts in (never a price, never the price limit), and joins the start scope as ONE additive part that is absent when the file names nothing for the chain's seats. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fingerprintInputs } from '../src/cache-integrity.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePreference, setProviderPreference, resetProviderPreference, preferenceOf, preferenceRows, orderFor, PreferenceFileError, PREFERENCE_FILE } from '../src/provider-preference.js';
import { pinnedExtra } from '../src/price-pin.js';
import { buildStartScope, changedParts } from '../src/start-scope.js';
import { effectiveRow } from '../src/price-table.js';
import { buildCapScreen } from '../src/cap-screen.js';

afterEach(() => resetProviderPreference());
const folderWith = obj => { const d = mkdtempSync(join(tmpdir(), 'thc-pref-')); if (obj !== undefined) writeFileSync(join(d, PREFERENCE_FILE), typeof obj === 'string' ? obj : JSON.stringify(obj)); return d; };
const MODEL = 'qwen/qwen3.7-plus';   // a shipped OpenRouter row
const seat = (extra, model = MODEL) => ({ provider: 'openrouter', model, lab: 'pref', maxTokens: 500, ...(extra === undefined ? {} : { extra }) });
const row = () => effectiveRow('openrouter', MODEL);

test('PF-1: a good file is read as typed, in order; no file means no preference; a model without a row has none', () => {
  assert.deepEqual(setProviderPreference(folderWith()), { file: null, rows: 0 });
  assert.equal(preferenceOf('openrouter', MODEL), null);
  const f = folderWith({ [`openrouter/${MODEL}`]: { prefer: ['azure/us', 'wafer/mxfp4', 'openai'] } });
  assert.equal(setProviderPreference(f).rows, 1);
  assert.deepEqual(preferenceOf('openrouter', MODEL), ['azure/us', 'wafer/mxfp4', 'openai']);
  assert.equal(preferenceOf('openrouter', 'qwen/other'), null);
  assert.equal(preferenceOf('anthropic', MODEL), null, 'only OpenRouter routes by host');
});

test('PF-2: a file that cannot be read in full installs NOTHING (fail closed): bad JSON, a non-object, a wrong key, an unknown field, an empty or malformed list, a repeated tag', () => {
  setProviderPreference(folderWith({ [`openrouter/${MODEL}`]: { prefer: ['good'] } }));
  const bad = [
    ['{ nope', /not valid JSON/], [[1], /one JSON object/], [{ 'anthropic/x': { prefer: ['a'] } }, /must be "openrouter\/<model id>"/], [{ 'openrouter/': { prefer: ['a'] } }, /must be "openrouter/],
    [{ [`openrouter/${MODEL}`]: { prefer: ['a'], only: ['b'] } }, /unknown field "only"/], [{ [`openrouter/${MODEL}`]: { prefer: [] } }, /1 to 200 endpoint tags/], [{ [`openrouter/${MODEL}`]: { prefer: 'a' } }, /1 to 200 endpoint tags/],
    [{ [`openrouter/${MODEL}`]: { prefer: ['Azure/US'] } }, /is not an endpoint tag/], [{ [`openrouter/${MODEL}`]: { prefer: ['a b'] } }, /is not an endpoint tag/], [{ [`openrouter/${MODEL}`]: { prefer: [7] } }, /is not an endpoint tag/],
    [{ [`openrouter/${MODEL}`]: { prefer: ['a', 'a'] } }, /names a tag twice/], [{ [`openrouter/${MODEL}`]: ['a'] }, /must be \{ "prefer"/],
  ];
  for (const [content, why] of bad) {
    assert.throws(() => setProviderPreference(folderWith(content)), e => e instanceof PreferenceFileError && why.test(e.message) && /not used at all, so nothing was started/.test(e.message), JSON.stringify(content));
    assert.deepEqual(preferenceOf('openrouter', MODEL), ['good'], 'a refused file leaves the earlier state untouched');
  }
});

test('PF-3: orderFor drops a host the seat\'s own ignore bans (a base slug removes every endpoint under it) and keeps the rest in order; an empty result is no preference', () => {
  setProviderPreference(folderWith({ [`openrouter/${MODEL}`]: { prefer: ['open-inference/fp4', 'azure/us', 'azure/eu', 'wafer/mxfp4'] } }));
  assert.deepEqual(orderFor(seat()), ['open-inference/fp4', 'azure/us', 'azure/eu', 'wafer/mxfp4']);
  assert.deepEqual(orderFor(seat({ provider: { ignore: ['open-inference'] } })), ['azure/us', 'azure/eu', 'wafer/mxfp4']);
  assert.deepEqual(orderFor(seat({ provider: { ignore: ['azure/us', 'wafer'] } })), ['open-inference/fp4', 'azure/eu']);
  assert.equal(orderFor(seat({ provider: { ignore: ['open-inference', 'azure', 'wafer'] } })), null);
});

test('PF-4: pinnedExtra fills provider.order from the file BEFORE its early returns (also for a seat with a complete pin of its own), a seat\'s own order wins, allow_fallbacks and only are never written, and with no file the request is unchanged', () => {
  const plain = seat(); const before = JSON.stringify(pinnedExtra(plain, undefined));
  setProviderPreference(folderWith({ [`openrouter/${MODEL}`]: { prefer: ['azure/us', 'wafer/mxfp4'] } }));
  const got = pinnedExtra(plain, undefined);
  assert.deepEqual(got.provider.order, ['azure/us', 'wafer/mxfp4']);
  assert.deepEqual(got.provider.max_price, { prompt: row().in, completion: row().out }, 'the price limit is the row\'s, untouched');
  assert.equal('allow_fallbacks' in got.provider, false); assert.equal('only' in got.provider, false);
  // a seat with a COMPLETE pin of its own returns early inside pinnedExtra: the order is still filled
  const own = { provider: { max_price: { prompt: 9, completion: 9 }, zdr: true } };
  const ownGot = pinnedExtra(seat(own), own);
  assert.deepEqual(ownGot.provider.max_price, { prompt: 9, completion: 9 }); assert.deepEqual(ownGot.provider.order, ['azure/us', 'wafer/mxfp4']); assert.equal(ownGot.provider.zdr, true);
  // the seat's own order wins
  const mine = { provider: { order: ['deepinfra/fp8'] } };
  assert.deepEqual(pinnedExtra(seat(mine), mine).provider.order, ['deepinfra/fp8']);
  // the caller's object is never written
  assert.equal(own.provider.order, undefined);
  resetProviderPreference();
  assert.equal(JSON.stringify(pinnedExtra(plain, undefined)), before, 'with no file the request is the one it always was, byte for byte');
});

test('PF-5: the start scope carries ONE additive part: absent when the project names nothing for the chain\'s seats, present and sorted when it does, named by changedParts; a malformed part is refused', () => {
  const H = 'a'.repeat(64);
  const base = { taskSha256: H, contextSha256: null, chainSha256: H, seats: [{ role: 'critic', provider: 'openrouter', model: MODEL }], policySha256: null, sensitivityFloor: null, piiMode: null, userPrices: [] };
  const without = buildStartScope(base);
  assert.equal('provider_preference' in without, false, 'omitted when empty: every digest without the file stays what it was');
  assert.equal(JSON.stringify(buildStartScope({ ...base, providerPreference: [] })), JSON.stringify(without));
  setProviderPreference(folderWith({ [`openrouter/${MODEL}`]: { prefer: ['azure/us', 'wafer/mxfp4'] }, 'openrouter/zzz/other': { prefer: ['x'] } }));
  const rows = preferenceRows([{ provider: 'openrouter', model: MODEL }, { provider: 'openrouter', model: MODEL }, { provider: 'mock', model: 'm' }]);
  assert.deepEqual(rows, [{ key: `openrouter/${MODEL}`, prefer: ['azure/us', 'wafer/mxfp4'] }], 'only the chain\'s own models, each once');
  const withPref = buildStartScope({ ...base, providerPreference: rows });
  assert.deepEqual(withPref.provider_preference, rows);
  assert.deepEqual(changedParts(without, withPref), ['the project\'s host preferences (provider-preference.json)']);
  const edited = buildStartScope({ ...base, providerPreference: [{ key: `openrouter/${MODEL}`, prefer: ['wafer/mxfp4', 'azure/us'] }] });
  assert.deepEqual(changedParts(withPref, edited), ['the project\'s host preferences (provider-preference.json)'], 'an edited order is a changed screen');
  assert.throws(() => buildStartScope({ ...base, providerPreference: [{ key: 'anthropic/x', prefer: ['a'] }] }), /start scope: providerPreference must be/);
  assert.throws(() => buildStartScope({ ...base, providerPreference: [{ key: `openrouter/${MODEL}`, prefer: [] }] }), /start scope: providerPreference must be/);
});

test('PF-6: parsePreference is pure and exact: a valid object comes back as a Map of copies', () => {
  const m = parsePreference({ [`openrouter/${MODEL}`]: { prefer: ['a/b'] } });
  assert.deepEqual([...m], [[`openrouter/${MODEL}`, ['a/b']]]);
});

test('PF-7: a preference file never makes finished stages stale: the stage-cache fingerprint (task + chain config, src/cache-integrity.js fingerprintInputs) is the same with a preference loaded and without; the order is added at send time inside pinnedExtra, never to the config', () => {
  const config = { name: 'x', seats: { critics: [seat({ provider: { zdr: true } })] } };
  const without = fingerprintInputs('task text', config);
  setProviderPreference(folderWith({ [`openrouter/${MODEL}`]: { prefer: ['azure/us'] } }));
  assert.equal(fingerprintInputs('task text', config), without);
  assert.deepEqual(config.seats.critics[0].extra, { provider: { zdr: true } }, 'the seat in the config is never written');
  pinnedExtra(config.seats.critics[0], config.seats.critics[0].extra);
  assert.deepEqual(config.seats.critics[0].extra, { provider: { zdr: true } }, 'neither is it written by building the request');
});

test('PF-8: a preference file that cannot be read is its OWN problem: every command that prices refuses with the file named (exit 2), the doctor warns about it, and the project\'s price rows are NOT discarded', () => {
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const dir = folderWith({ 'openrouter/a/b': { prefer: ['Bad Tag'] } });
  writeFileSync(join(dir, 'pricing.user.json'), JSON.stringify({ 'openrouter/qwen/qwen3.7-plus': { in: 9, out: 9 } }));
  writeFileSync(join(dir, 't.md'), 'Plan a thing.\n');
  const env = { PATH: process.env.PATH, HOME: dir };
  const dry = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 't.md', '--dry-run'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(dry.status, 2, dry.stdout + dry.stderr);
  assert.match(dry.stderr, /provider-preference\.json: openrouter\/a\/b: "Bad Tag" is not an endpoint tag.*nothing was started/s);
  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { cwd: dir, env, encoding: 'utf8' });
  assert.match(doctor.stdout, /WARNING: provider-preference\.json cannot be read in full, so it is not used at all\. The reason: /);
  assert.doesNotMatch(doctor.stdout, /WARNING: pricing\.user\.json is not used at all/, 'the price rows are still read');
});

test('PF-9: the cap screen shows the hosts a person approves: one printed line per chain model with a preference row (the hosts tried first, in order), beside the pricing.user.json line, and no line - nothing else changes - without a file', () => {
  const base = { kind: 'run', subject: { chain: 'c', task: 't.md' }, estimate: { usd: 1 }, maximum: { usd: 2 } };
  const plain = buildCapScreen(base);
  assert.equal(buildCapScreen({ ...base, preferences: [] }).text, plain.text, 'without a file the screen is byte for byte what it was');
  assert.equal(plain.fields.preferences, null);
  const shown = buildCapScreen({ ...base, userPrices: [{ key: 'openrouter/x/y', in: 1, out: 2 }], preferences: [{ key: `openrouter/${MODEL}`, prefer: ['azure/us', 'wafer/mxfp4'] }, { key: 'openrouter/z/w', prefer: ['openai'] }] });
  assert.match(shown.text, /Host preference \(provider-preference\.json in your project folder\): openrouter\/qwen\/qwen3\.7-plus: azure\/us, wafer\/mxfp4; openrouter\/z\/w: openai\. OpenRouter is asked to try these hosts first, in this order, and any other host only if none of them can serve the call\. A bare tag also covers that provider's regional endpoints, and a host the chain ignores is skipped\. The preference changes only the order hosts are tried in; each host keeps its own listed price\./);
  assert.ok(shown.text.indexOf('Priced from pricing.user.json') < shown.text.indexOf('Host preference ('), 'beside the price-row line, after it');
});
