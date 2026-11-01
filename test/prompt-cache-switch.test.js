// CACHE lane unit 2, the parts that hold whatever the final call-site policy is (src/prompt-cache.js): the chain switch `prompt_cache`, its lint, and the head check in invoke(). Offline, mock only, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { runChain, setCache, setBudget, setPromptSpy, exchangeRound } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';
import { promptCacheTtl, lintPromptCache, cacheKnobPaths, isDirectAnthropicSeat, exchangeCallCarriesHead } from '../src/prompt-cache.js';
import { critic, chainOf } from './helpers/final-read-chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); });
const go = async config => {
  const spied = [];
  setPromptSpy(p => spied.push(p));
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-prompt-cache', config });
  return { r, spied };
};
// a three-layer mock chain with the layer-1 exchange (two judges that contest and support), so exchange calls exist
const exchangeChain = (tag, extra = {}) => chainOf([
  critic('mock-exch-contest-keep', 'j1a', 1), critic('mock-exch-support-withdraw', 'j1b', 1),
  critic('mock-exch-support-keep', 'j2', 2), critic('mock-exch-support-keep', 'j3', 3),
], { maxRounds: 2, answer_back: { enabled: true }, layer_debate: { enabled: true, rounds: 3 }, ...extra });

test('promptCacheTtl: off unless enabled is true; the default lifetime is 1h; only 5m or 1h are read', () => {
  assert.equal(promptCacheTtl({}), null);
  assert.equal(promptCacheTtl({ prompt_cache: { enabled: false } }), null);
  assert.equal(promptCacheTtl({ prompt_cache: { enabled: true } }), '1h');
  assert.equal(promptCacheTtl({ prompt_cache: { enabled: true, ttl: '5m' } }), '5m');
  assert.equal(promptCacheTtl({ prompt_cache: { enabled: true, ttl: '1h' } }), '1h');
});

test('lint: a direct Anthropic seat\'s extra may not carry cache_control (any depth), with or without the switch; a seat reached through OpenRouter is not a direct Anthropic seat', () => {
  const anth = (extra) => ({ provider: 'anthropic', model: 'claude-opus-5-5', lab: 'opus5.5', layer: 1, extra });
  assert.deepEqual(cacheKnobPaths({ a: { cache_control: { type: 'ephemeral' } }, cache_control: 1 }), ['extra.a.cache_control', 'extra.cache_control']);
  for (const sw of [{}, { prompt_cache: { enabled: true } }]) {
    const found = lintPromptCache({ ...sw, seats: { critics: [anth({ cache_control: { type: 'ephemeral' } })] } });
    assert.deepEqual(found.map(f => f.kind), ['anthropic-cache-knob-in-extra']);
  }
  assert.deepEqual(lintPromptCache({ seats: { critics: [anth({ output_config: { effort: 'high' } })] } }), []);
  assert.deepEqual(lintPromptCache({ seats: { critics: [{ provider: 'openrouter', model: 'anthropic/claude-opus-5.5', extra: { cache_control: { type: 'ephemeral' } } }] } }), [], 'not a direct Anthropic seat: the adapter is not in play');
  assert.equal(isDirectAnthropicSeat({ provider: 'openrouter', originalProvider: 'anthropic' }), false);
});

test('lint: the switch with no direct Anthropic seat would do nothing and is refused; with one it is accepted; a bad ttl or an unknown key is refused by chain-lint', () => {
  const base = chainOf([critic('mock-critic-script-o-pcl1', 'a', 1), critic('mock-critic-script-o-pcl2', 'b', 2)]);
  assert.ok(lintChain({ ...base, prompt_cache: { enabled: true } }).some(f => f.kind === 'prompt-cache-needs-anthropic'));
  const withAnth = { ...base, seats: { ...base.seats, critics: [{ provider: 'anthropic', model: 'claude-haiku-5-5', lab: 'haiku5.5', layer: 1 }, base.seats.critics[1]] } };
  assert.deepEqual(lintChain({ ...withAnth, prompt_cache: { enabled: true, ttl: '1h' } }).filter(f => /prompt-cache|prompt_cache/.test(JSON.stringify(f))), []);
  assert.ok(lintChain({ ...withAnth, prompt_cache: { enabled: true, ttl: '2h' } }).some(f => /prompt_cache/.test(JSON.stringify(f))), 'a ttl other than 5m or 1h is refused');
  assert.ok(lintChain({ ...withAnth, prompt_cache: { enabled: true, rounds: 2 } }).some(f => /prompt_cache/.test(JSON.stringify(f))), 'an unknown key is refused');
});

test('chain-schema lists prompt_cache (enabled, ttl 5m|1h) and refuses another ttl or key', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-layered.json'), 'utf8'));
  assert.ok(validate({ ...base, prompt_cache: { enabled: true, ttl: '5m' } }), JSON.stringify(validate.errors));
  assert.ok(!validate({ ...base, prompt_cache: { enabled: true, ttl: '2h' } }));
  assert.ok(!validate({ ...base, prompt_cache: { enabled: true, extra: 1 } }));
});

test('switch OFF: no call carries a cacheHead (the spy payload has no such key), so nothing a seat is sent can differ', async () => {
  const { r, spied } = await go(exchangeChain('off'));
  assert.ok(spied.length > 0 && r.stages.some(s => s.label.startsWith('ldebate-')), 'the exchange ran, so the check below is not vacuous');
  assert.ok(spied.every(p => !('cacheHead' in p)));
});

test('where a marker goes (ruling B): only an exchange call with k >= 2 at a layer whose round budget is 3 or more, and only with the switch on', () => {
  for (const k of [1, 2, 3, 7]) for (const rounds of [1, 2, 3, 7]) {
    assert.equal(exchangeCallCarriesHead({ ttl: '1h', k, rounds }), k >= 2 && rounds >= 3, `k=${k} rounds=${rounds}`);
    assert.equal(exchangeCallCarriesHead({ ttl: null, k, rounds }), false, 'switch off: never');
  }
  assert.equal(exchangeCallCarriesHead({ ttl: '1h', k: undefined, rounds: 7 }), false);
});

test('switch ON (ruling B): only the layer-1 exchange calls k>=2 carry a head, and each head is the START of the prompt it sends; no panel call and no k=1 call does', async () => {
  const { r, spied } = await go(exchangeChain('on', { prompt_cache: { enabled: true } }));
  const exchange = spied.filter(p => /^(ldebate|lreply)-/.test(p.label));
  assert.ok(exchange.some(p => /-x[2-9]-/.test(p.label)), 'the mock exchange ran past round 1, so the check below is not vacuous');
  const headed = spied.filter(p => 'cacheHead' in p);
  assert.ok(headed.length > 0);
  for (const p of headed) {
    assert.match(p.label, /^(ldebate|lreply)-\d+-x[2-9]-/, `${p.label}: only an exchange call of round 2 or later is marked`);
    assert.ok(p.cacheHead.length > 0 && p.user.startsWith(p.cacheHead), `${p.label}: the head must be the start of the prompt`);
  }
  assert.ok(exchange.filter(p => /-x[2-9]-/.test(p.label)).every(p => typeof p.cacheHead === 'string'), 'every k>=2 exchange call names its head');
  assert.ok(spied.filter(p => /^panel-/.test(p.label)).every(p => !('cacheHead' in p)), 'no panel call is marked');
  assert.ok(exchange.filter(p => !/-x[2-9]-/.test(p.label)).every(p => !('cacheHead' in p)), 'no k=1 exchange call is marked');
  assert.ok(typeof r.passed === 'boolean');
});

test('switch ON but the layer\'s round budget is 2: nothing is marked (a k=2 write would never be read)', async () => {
  const { spied } = await go(exchangeChain('two', { prompt_cache: { enabled: true }, layer_debate: { enabled: true, rounds: 2 } }));
  assert.ok(spied.some(p => /^ldebate-/.test(p.label)));
  assert.ok(spied.every(p => !('cacheHead' in p)));
});

test('exchange variants, exact string: with the rulings appended, every k>=2 post and answer prompt starts with the head built from the same arguments (the head is the plan part; what follows may differ per call)', async () => {
  const spied = [];
  setPromptSpy(p => spied.push(p));
  const seatA = { provider: 'mock', model: 'mock-exch-contest-keep', lab: 'xa', layer: 1 }, seatB = { provider: 'mock', model: 'mock-exch-support-withdraw', lab: 'xb', layer: 1 };
  const judges = [{ key: 'xa', seat: seatA, failures: [{ criterion: 'It states its assumptions.', problem: 'No assumptions are stated anywhere.' }] }, { key: 'xb', seat: seatB, failures: [{ criterion: 'It adds no scope.', problem: 'It adds a billing system.' }] }];
  const draft = '# Plan\n\nBake a cake.\n\n# Draft under review\n\nthis line quotes the header and must not move the head';
  const common = { judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft, round: 1, record: s => s, rounds: 3, rulingsText: '\n\n# Rulings\n\n1. The date is fixed.' };
  await exchangeRound({ ...common, cacheTtl: '1h' });
  const headed = spied.filter(p => 'cacheHead' in p);
  assert.ok(headed.length >= 2 && headed.every(p => /-x[2-9]-/.test(p.label)), headed.map(p => p.label).join(','));
  for (const p of headed) {
    assert.ok(p.user.startsWith(p.cacheHead), `${p.label}: head is a prefix`);
    assert.ok(p.user.includes('# Rulings'), `${p.label}: the rulings are appended after the head`);
    assert.ok(p.cacheHead.endsWith('must not move the head'), `${p.label}: the head ends at the end of the plan, even though the plan quotes the header`);
    assert.ok(!p.cacheHead.includes('# Rulings'));
  }
  spied.length = 0;
  await exchangeRound({ ...common, cacheTtl: null });
  assert.ok(spied.length > 0 && spied.every(p => !('cacheHead' in p)), 'switch off: no head');
});

test('exchange variant with the severity switch on: the head is still the start of every k>=2 prompt (the severity plumbing adds nothing before the end of the plan), so the head check never stops the run', async () => {
  const sev = (model) => `${model}-sev5`;
  const config = chainOf([
    critic(sev('mock-exch-contest-keep'), 'j1a', 1), critic(sev('mock-exch-support-withdraw'), 'j1b', 1),
    critic('mock-exch-support-keep', 'j2', 2), critic('mock-exch-support-keep', 'j3', 3),
  ], { maxRounds: 2, answer_back: { enabled: true }, layer_debate: { enabled: true, rounds: 3 }, severity: { enabled: true }, prompt_cache: { enabled: true } });
  const { spied } = await go(config);
  const headed = spied.filter(p => 'cacheHead' in p);
  assert.ok(headed.length > 0, 'the exchange ran past round 1 with the severity switch on');
  for (const p of headed) assert.ok(p.user.startsWith(p.cacheHead), `${p.label}: the head is the start of the prompt`);
});
