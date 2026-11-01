// 0.8.4 PRICES unit 3: scripts/refresh-openrouter-prices.mjs --propose / --for-chain PROPOSES a provider-preference.json into the fetch folder (never the operator's project file). Hosts: eligible (the host picture's filters),
// at or below the median of the eligible hosts' BASE prices on both sides (the picture's stored median is tier-priced), cheapest first, minus hosts whose context or output limit cannot serve the chain and hosts it ignores.
// The script derives its root from its own path, so each test runs a COPY in a temp tree with fixture answers (offline, $0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join('scripts', 'refresh-openrouter-prices.mjs');
const ep = (provider, tag, i, o, maxc, extra = {}) => ({ provider_name: provider, tag, quantization: 'fp8', pricing: { prompt: String(i / 1e6), completion: String(o / 1e6) }, max_completion_tokens: maxc, context_length: 1_000_000, service_tier: null, ...extra });
const tiered = (provider, tag, i, o) => ep(provider, tag, i, o, 400000, { pricing: { prompt: String(i / 1e6), completion: String(o / 1e6), overrides: [{ min_prompt_tokens: 100000, prompt: String((i * 10) / 1e6), completion: String((o * 10) / 1e6) }] } });
const HOSTS = [
  ep('Aaa', 'aaa/fp8', 0.10, 0.40, 400000), ep('Bbb', 'bbb', 0.20, 0.80, 400000), ep('Ccc', 'ccc', 0.30, 1.20, 400000), ep('Ddd', 'ddd', 0.50, 2.00, 400000),
  ep('Eee', 'eee', 0.15, 0.60, 100000),                        // cheap but cannot return the chain's maxTokens
  ep('Fff', 'fff', 0.12, 0.50, 400000, { context_length: 100000 }),   // cheap but its context cannot hold the largest call
  ep('Ban', 'banned/fp4', 0.11, 0.45, 400000),                // cheap but the chain ignores it
  tiered('Ttt', 'ttt', 0.13, 0.55),                            // base price cheap, dearest tier ten times dearer: judged by its BASE price
];
function tree({ chain } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rfp-prop-'));
  mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'ep'));
  copyFileSync(join(root, SCRIPT), join(dir, SCRIPT));
  writeFileSync(join(dir, 'src', 'pricing.json'), `${JSON.stringify({ asOf: '2026-10-23', _openrouterCheckedAt: '2026-10-25', _openrouterStaleDays: 45, 'openrouter/vendor/alpha': { in: 0.3, out: 1.2, _source: 'fixture' } }, null, 2)}\n`);
  writeFileSync(join(dir, 'chains', 'fixture.json'), JSON.stringify({ seats: { critics: [{ provider: 'openrouter', model: 'vendor/alpha', maxTokens: 360000 }] } }));
  writeFileSync(join(dir, 'ep', 'vendor__alpha.json'), JSON.stringify({ data: { endpoints: HOSTS } }));
  writeFileSync(join(dir, 'ep', '_fetch.json'), JSON.stringify({ fetchedAt: new Date().toISOString() }));
  writeFileSync(join(dir, 'models.json'), JSON.stringify({ data: [{ id: 'vendor/alpha', pricing: { prompt: String(0.3 / 1e6), completion: String(1.2 / 1e6) } }] }));
  if (chain) writeFileSync(join(dir, 'b3.json'), JSON.stringify(chain));
  return dir;
}
const run = (dir, extra) => spawnSync(process.execPath, [SCRIPT, 'models.json', '--endpoints', 'ep', ...extra], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '' }, encoding: 'utf8' });

test('PR-1: --propose lists the eligible hosts at or below the BASE median on both sides, cheapest output first, with precision and context beside each, both median counts printed, and writes the proposal into the fetch folder only', () => {
  const dir = tree();
  const r = run(dir, ['--propose', 'vendor/alpha']);
  assert.equal(r.status, 0, r.stderr);
  // eligible (output limit >= the shipped 360000): aaa, bbb, ccc, ddd, fff, banned, ttt (eee is out: 100000). Base out prices .4 .8 1.2 2 .5 .45 .55 -> sorted .4 .45 .5 .55 .8 1.2 2 -> median .55; base in: .1 .2 .3 .5 .12 .11 .13 -> median .13
  const f = JSON.parse(readFileSync(join(dir, 'ep', 'proposed-provider-preference.json'), 'utf8'));
  assert.deepEqual(f, { 'openrouter/vendor/alpha': { prefer: ['aaa/fp8', 'banned/fp4', 'fff', 'ttt'] } }, 'at or below the base median 0.13/0.55 on both sides, cheapest output first (ttt judged by its base price 0.13/0.55)');
  assert.match(r.stdout, /base median 0\.13\/0\.55; effective row 0\.3\/1\.2; 7 eligible hosts \(at or below the median: 4 usable, strictly below: 3 usable\)/);
  assert.match(r.stdout, /aaa\/fp8 +fp8 +ctx 1000000 +base 0\.1\/0\.4/);
  assert.equal(existsSync(join(dir, 'provider-preference.json')), false, 'the operator\'s project file is never written');
});

test('PR-2: --for-chain takes each seat\'s maxTokens and its own ignore from the chain, and --largest-call-tokens drops a host whose context cannot hold the largest call; an unpublished limit counts as unable', () => {
  const chain = { seats: { critics: [{ provider: 'openrouter', model: 'vendor/alpha', maxTokens: 400000, extra: { provider: { ignore: ['banned'] } } }] } };
  const dir = tree({ chain });
  const r = run(dir, ['--for-chain', 'b3.json', '--largest-call-tokens', '150000']);
  assert.equal(r.status, 0, r.stderr);
  const f = JSON.parse(readFileSync(join(dir, 'ep', 'proposed-provider-preference.json'), 'utf8'));
  assert.deepEqual(f['openrouter/vendor/alpha'].prefer, ['aaa/fp8', 'ttt'], 'banned/fp4 is ignored by the chain, fff\'s context (100000) is shorter than the largest call');
  const left = /left off \(context shorter than 150000, output limit below 400000, or ignored\): (.*)/.exec(r.stdout);
  assert.ok(left, r.stdout); assert.deepEqual(left[1].split(', ').sort(), ['banned/fp4', 'fff']);
});

test('PR-3: --strict-below keeps only hosts strictly below the median on both sides', () => {
  const dir = tree();
  const r = run(dir, ['--propose', 'vendor/alpha', '--strict-below']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'ep', 'proposed-provider-preference.json'), 'utf8'))['openrouter/vendor/alpha'].prefer, ['aaa/fp8', 'banned/fp4', 'fff']);
});

test('PR-4: a proposal folder inside the repository is refused (exit 2), like --fetch; nothing is written there', () => {
  const dir = tree();
  const r = run(dir, ['--propose', 'vendor/alpha', '--propose-out', join(dir, 'proposals')]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /refused: the proposal folder .* is inside the repository/);
  assert.equal(existsSync(join(dir, 'proposals')), false);
  const ok = run(dir, ['--propose', 'vendor/alpha', '--propose-out', mkdtempSync(join(tmpdir(), 'rfp-prop-out-'))]);
  assert.equal(ok.status, 0, ok.stderr);
});

// ---- C&C's rulings of 1 Nov 2026: order inside the pool, bare tags, the effective row, speed as a floor ----
const q = (provider, tag, i, o, quant, extra = {}) => ep(provider, tag, i, o, 400000, { quantization: quant, ...extra });
function tree2(hosts, { page = '', userRows } = {}) {
  const dir = tree();
  writeFileSync(join(dir, 'ep', 'vendor__alpha.json'), JSON.stringify({ data: { endpoints: hosts } }));
  if (page) writeFileSync(join(dir, 'ep', 'vendor__alpha.html'), page);
  if (userRows) writeFileSync(join(dir, 'user.json'), JSON.stringify(userRows));
  return dir;
}
const prow = (name, i, o, tps) => `<tr class="or-table__row"><th scope="row"><button aria-label="Open ${name} details"></button></th><td><span>$${i}<span>000</span></span></td><td><span>$${o}<span>00</span></span></td><td>0.62<span class="text-muted-foreground">s</span></td><td class="x">${tps}<span class="text-muted-foreground"> tps</span></td></tr>`;

test('PR-5: the order inside the pool is native endpoints first (native = relative to the MODEL: openai/* on openai and azure), then quantization high to low (bf16/fp16, fp8, fp4, not stated), then price; an open-weight model on azure with no stated quantization is NOT native', () => {
  const fillers = ['t1', 't2', 't3', 't4', 't5'].map(n => q(n, `${n}/fp8`, 0.5, 2, 'fp8'));   // five dear fillers keep the median at 0.14/0.5, so the six cheaper hosts are all in the pool
  const hosts = [q('Cheap4', 'cheap/fp4', 0.10, 0.30, 'fp4'), q('Mid8', 'mid/fp8', 0.12, 0.40, 'fp8'), q('Dear16', 'dear/bf16', 0.14, 0.50, 'bf16'), q('Nostated', 'nostated', 0.11, 0.35, 'unknown'), q('Azure', 'azure', 0.13, 0.45, 'unknown'), q('Mid8b', 'mid2/fp8', 0.12, 0.39, 'fp8'), ...fillers];
  const dir = tree2(hosts);
  // the same hosts under an OpenAI model id (openai/beta) and under an open-weight id (vendor/alpha)
  writeFileSync(join(dir, 'ep', 'openai__beta.json'), JSON.stringify({ data: { endpoints: hosts } }));
  writeFileSync(join(dir, 'b3.json'), JSON.stringify({ seats: { critics: [{ provider: 'openrouter', model: 'openai/beta', maxTokens: 100000 }, { provider: 'openrouter', model: 'vendor/alpha', maxTokens: 100000 }] } }));
  const r = run(dir, ['--for-chain', 'b3.json']);
  assert.equal(r.status, 0, r.stderr);
  const f = JSON.parse(readFileSync(join(dir, 'ep', 'proposed-provider-preference.json'), 'utf8'));
  assert.deepEqual(f['openrouter/openai/beta'].prefer, ['azure', 'dear/bf16', 'mid2/fp8', 'mid/fp8', 'cheap/fp4', 'nostated'], 'azure is native for an OpenAI model');
  assert.deepEqual(f['openrouter/vendor/alpha'].prefer, ['dear/bf16', 'mid2/fp8', 'mid/fp8', 'cheap/fp4', 'nostated', 'azure'], 'for an open-weight model azure with no stated quantization sorts with "not stated", by price: after nostated (0.35) is dearer azure (0.45)');
});

test('PR-6: a bare tag is printed with the siblings it would also match (regions and variants, not service tiers) and their OUT reasons; the effective row (the project\'s price file counted) sits beside the median and a host above it is marked', () => {
  const hosts = [q('Azure', 'azure', 0.10, 0.40, 'unknown'), q('Azure', 'azure/us', 0.11, 0.45, 'unknown'), q('Azure', 'azure/flex', 0.05, 0.2, 'unknown', { service_tier: 'flex' }), q('Wafer', 'wafer/fp4', 0.2, 0.9, 'fp4')];
  const dir = tree2(hosts, { userRows: { 'openrouter/vendor/alpha': { in: 0.15, out: 0.8 } } });
  const r = run(dir, ['--propose', 'vendor/alpha', '--user-prices', 'user.json']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BARE TAG azure also matches: azure\/us \(base 0\.11\/0\.45\)/);
  assert.doesNotMatch(r.stdout, /azure\/flex \(base/, 'a service-tier endpoint is not matched by a base slug (OpenRouter docs, read 2026-11-01)');
  assert.match(r.stdout, /effective row 0\.3\/1\.2/, 'the shipped row 0.3/1.2 is higher than the file\'s 0.15/0.8: the cap counts the higher');
  const dir2 = tree2(hosts, { userRows: { 'openrouter/vendor/alpha': { in: 0.105, out: 0.42 } } });
  writeFileSync(join(dir2, 'src', 'pricing.json'), `${JSON.stringify({ asOf: '2026-10-23', _openrouterCheckedAt: '2026-10-25', _openrouterStaleDays: 45 }, null, 2)}\n`);
  writeFileSync(join(dir2, 'b3.json'), JSON.stringify({ seats: { critics: [{ provider: 'openrouter', model: 'vendor/alpha', maxTokens: 100000 }] } }));
  const r2 = run(dir2, ['--for-chain', 'b3.json', '--user-prices', 'user.json']);
  assert.match(r2.stdout, /effective row 0\.105\/0\.42; /, 'with no shipped row the file\'s row is the effective one');
  assert.match(r2.stdout, /azure\/us .*ABOVE THE ROW/, 'a pool host dearer than the effective row (0.11/0.45 against 0.105/0.42) is dead under the price limit');
});

test('PR-7: speed is a floor, not a sort key: a host too slow for the model\'s largest call inside 80% of the wall goes last; a host with no published speed is not penalised; nobody is dropped', () => {
  const hosts = [q('Slow', 'slow/fp8', 0.10, 0.40, 'fp8'), q('Fast', 'fast/fp8', 0.12, 0.50, 'fp8'), q('Unk', 'unk/fp8', 0.11, 0.45, 'fp8'), ...['t1', 't2', 't3'].map(n => q(n, `${n}/fp8`, 0.5, 2, 'fp8'))];
  const page = `<html><table><tbody>${prow('Slow', '0.1', '0.4', 50)}${prow('Fast', '0.12', '0.5', 400)}</tbody></table></html>`;
  const dir = tree2(hosts, { page });
  const r = run(dir, ['--propose', 'vendor/alpha', '--pages', 'ep', '--largest-output-tokens', 'vendor/alpha=60000', '--wall-seconds', '300']);
  assert.equal(r.status, 0, r.stderr);
  // 60000 tokens at 50 tok/s = 1200 s (too slow); at 400 tok/s = 150 s (within 240 s); unknown speed: no penalty
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'ep', 'proposed-provider-preference.json'), 'utf8'))['openrouter/vendor/alpha'].prefer, ['unk/fp8', 'fast/fp8', 'slow/fp8']);
  assert.match(r.stdout, /slow\/fp8.*50 tok\/s \(TOO SLOW, last\)/);
});
