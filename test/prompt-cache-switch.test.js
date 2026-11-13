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
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';
// CHANGED ACCEPTED (0.8.4 N9, C&C's ruling 4: `layer_debate.rounds` is removed): its exchange chains set `layer_debate: { enabled: true, rounds: 2 or 3 }`; they now set no `layer_debate` block (the key and the switch are removed). The round-budget-2 test is re-asked of the exchange itself, see its own block.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
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
], { maxRounds: 2, answer_back: { enabled: true }, ...extra });

// CHANGED ACCEPTED (0.8.4 cache part (b)1, his 09 Nov 2026 18:29: "the default cache lifetime for Anthropic seats is 5 minutes"). OLD: the default lifetime was 1h and the title said so. NEW: the default is 5m, 1h is selectable. WHY: his decision; nothing else in this test moves.
test('promptCacheTtl: off unless enabled is true; the default lifetime is 5m; only 5m or 1h are read', () => {
  assert.equal(promptCacheTtl({}), null);
  assert.equal(promptCacheTtl({ prompt_cache: { enabled: false } }), null);
  assert.equal(promptCacheTtl({ prompt_cache: { enabled: true } }), '5m');
  assert.equal(promptCacheTtl({ prompt_cache: { enabled: true, ttl: 'forever' } }), '5m', 'an unknown lifetime reads as the default');
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

// CHANGED ACCEPTED (0.8.4 cache part (b)1, row 13). OLD: the switch was refused on a chain with no direct Anthropic seat anywhere (rule id prompt-cache-needs-anthropic). NEW: it is refused only on a chain with no JUDGE seat that can use it, a direct Anthropic one (a mark) or an OpenRouter one (the
// shared beginning of the new prompt order); the rule id is prompt-cache-no-seat-can-use-it. WHY: the new order also helps hosts that cache by themselves, so an OpenRouter-only chain is no longer a chain where the switch does nothing. This mock chain still has no such seat, so it is refused as before.
test('lint: the switch with no seat that can use it would do nothing and is refused; with one it is accepted; a bad ttl or an unknown key is refused by chain-lint', () => {
  const base = chainOf([critic('mock-critic-script-o-pcl1', 'a', 1), critic('mock-critic-script-o-pcl2', 'b', 2)]);
  assert.ok(lintChain({ ...base, prompt_cache: { enabled: true } }).some(f => f.kind === 'prompt-cache-no-seat-can-use-it'));
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

// FINDING (not on the owed list of the ladder unit; C&C's ruling B number, 10 Nov 2026, after the layer-1 exchange was cut to 3 rounds). OLD: a marker at any ttl needed a round budget of 3 or more. NEW: 3 at 5 minutes (a 1.25x write is repaid by one read) and 4 at 1 hour (a 2x write is not repaid by one read, so a three-round budget would cost more with the cache on than off).
test('where a marker goes (ruling B): only an exchange call with k >= 2 at a layer whose round budget repays the write (3 rounds at 5 minutes, 4 at 1 hour), and only with the switch on', () => {
  for (const k of [1, 2, 3, 7]) for (const rounds of [1, 2, 3, 4, 7]) {
    assert.equal(exchangeCallCarriesHead({ ttl: '1h', k, rounds }), k >= 2 && rounds >= 4, `1h k=${k} rounds=${rounds}`);
    assert.equal(exchangeCallCarriesHead({ ttl: '5m', k, rounds }), k >= 2 && rounds >= 3, `5m k=${k} rounds=${rounds}`);
    assert.equal(exchangeCallCarriesHead({ ttl: null, k, rounds }), false, 'switch off: never');
  }
  assert.equal(exchangeCallCarriesHead({ ttl: '1h', k: undefined, rounds: 7 }), false);
});

// CHANGED ACCEPTED TEST (0.8.4 apply, the order is live; the shape change C&C ruled for ending-exchange-cost on 11 Nov 2026, applied here (C&C's walk confirms the extension): the pin moves to the order-live shape). OLD (ruling B): only the layer-1 exchange calls of round 2 or later carry a head; no panel call and no round-1 call does. NEW: with the order live every judge call of a seat the order covers (panel, post, answer) names its head, and the head is the START of the prompt it sends (the shape test/cache-order.test.js R2/R4 asserts: one head per seat and pass, the lead-in of the call's kind after it). WHY: job 16 showed `panel-1-j1a` carrying a head; ruling B's rule for where a MARK goes stays pinned by the test above (exchangeCallCarriesHead) and by the dry-run rows (src/cost.js); what changed is which calls name a head.
test('switch ON, the order live: every judge call (panel, post, answer) names a head, and each head is the START of the prompt it sends; the exchange ran past round 1', async () => {
  const { r, spied } = await go(exchangeChain('on', { prompt_cache: { enabled: true } }));
  const exchange = spied.filter(p => /^(ldebate|lreply)-/.test(p.label));
  assert.ok(exchange.some(p => /-x[2-9]-/.test(p.label)), 'the mock exchange ran past round 1, so the check below is not vacuous');
  const judgeCalls = spied.filter(p => /^(panel|ldebate|lreply)-/.test(p.label));
  assert.ok(judgeCalls.length > 0);
  for (const p of judgeCalls) {
    assert.equal(typeof p.cacheHead, 'string', `${p.label}: names its head`);
    assert.ok(p.cacheHead.length > 0 && p.user.startsWith(p.cacheHead), `${p.label}: the head must be the start of the prompt`);
  }
  assert.ok(spied.filter(p => /^panel-/.test(p.label)).every(p => 'cacheHead' in p), 'a panel call is headed with the order live');
  assert.ok(typeof r.passed === 'boolean');
});

// CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: a chain with `layer_debate.rounds` 2 and the switch on: nothing marked. NEW: the same rule, asked of the exchange itself with a budget of two rounds (the `rounds` argument of exchangeRound, which the ladder still passes for layers 2 and 3): nothing is marked. WHY: no chain can set a budget of two any more; the rule (a k=2 write would never be read) is a property of the call.
test('switch ON but the exchange\'s round budget is 2: nothing is marked (a k=2 write would never be read)', async () => {
  const spied = [];
  setPromptSpy(p => spied.push(p));
  const seatA = { provider: 'mock', model: 'mock-exch-contest-keep', lab: 'xa', layer: 1 }, seatB = { provider: 'mock', model: 'mock-exch-support-withdraw', lab: 'xb', layer: 1 };
  const judges = [{ key: 'xa', seat: seatA, failures: [{ criterion: 'It states its assumptions.', problem: 'No assumptions are stated anywhere.' }] }, { key: 'xb', seat: seatB, failures: [{ criterion: 'It adds no scope.', problem: 'It adds a billing system.' }] }];
  await exchangeRound({ judges, request: 'A bake sale.', criteria: ['It states its assumptions.'], draft: '# Plan\n\nBake a cake.\n\n# Draft under review\n\nthe plan', round: 1, record: s => s, rounds: 2, cacheTtl: '1h' });
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
  // FINDING (not on the owed list of the ladder unit; C&C's ruling B number, 10 Nov 2026): a 1-hour marker needs a 4-round budget now, a 5-minute one 3; this row runs a budget of 3.
  await exchangeRound({ ...common, cacheTtl: '5m' });
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

// CHANGED ACCEPTED (0.8.4 S19): OLD: the chain carried the severity switch key. NEW: no key (the chain was already layered, so it records ratings); the rating demand is injected, so the exchange prompts carry the rating sentences exactly as the old switch made them; assertions unchanged. WHY: switch removed; the point (the rating plumbing adds nothing before the end of the plan) needs the demand in force. RED ON OLD SRC: none (the head property holds without ratings; the test guards the demanded state). RED INPUT FOR THE BUILDER: drop `prompt_cache` from this chain and `headed.length > 0` fails.
test('exchange variant with the rating demand in force: the head is still the start of every k>=2 prompt (the severity plumbing adds nothing before the end of the plan), so the head check never stops the run', async () => {
  setHeldForTest(DEMAND);   // the rating demand in force: the exchange prompts carry the rating sentences
  const sev = (model) => `${model}-sev5`;
  const config = chainOf([
    critic(sev('mock-exch-contest-keep'), 'j1a', 1), critic(sev('mock-exch-support-withdraw'), 'j1b', 1),
    critic('mock-exch-support-keep', 'j2', 2), critic('mock-exch-support-keep', 'j3', 3),
  ], { maxRounds: 2, answer_back: { enabled: true }, prompt_cache: { enabled: true } });
  const { spied } = await go(config);
  const headed = spied.filter(p => 'cacheHead' in p);
  assert.ok(headed.length > 0, 'the exchange ran past round 1 with the rating demand in force');
  for (const p of headed) assert.ok(p.user.startsWith(p.cacheHead), `${p.label}: the head is the start of the prompt`);
});

test('lint (cache part (b)1): the switch is refused only where no JUDGE seat can use it: a direct Anthropic judge or an OpenRouter judge accepts it, a mock or Google judge does not, and an Anthropic seat that makes no judge call (the writer, the criteria seat) does not count', () => {
  const on = { prompt_cache: { enabled: true } };
  const kinds = seats => lintPromptCache({ ...on, seats }).map(f => f.kind);
  const or = { provider: 'openrouter', model: 'minimax/minimax-m3.1-flash', lab: 'minimax', layer: 1 };
  const an = { provider: 'anthropic', model: 'claude-haiku-5-5', lab: 'haiku5.5', layer: 1 };
  const go = { provider: 'google', model: 'gemini-3.1-pro', lab: 'google' };
  assert.deepEqual(kinds({ critics: [or] }), [], 'an OpenRouter judge can use it');
  assert.deepEqual(kinds({ critics: [an] }), [], 'a direct Anthropic judge can use it');
  assert.deepEqual(kinds({ critics: [go, { provider: 'mock', model: 'm', lab: 'm' }] }), ['prompt-cache-no-seat-can-use-it']);
  assert.deepEqual(kinds({ critics: [go], builder: { provider: 'anthropic', model: 'claude-opus-5', lab: 'opus' }, reviser: { provider: 'anthropic', model: 'claude-opus-5', lab: 'opus' }, criteria: { provider: 'anthropic', model: 'claude-opus-5', lab: 'opus' } }), ['prompt-cache-no-seat-can-use-it'], 'a chain like verify: its Anthropic seats make no judge call');
  assert.deepEqual(kinds({}), ['prompt-cache-no-seat-can-use-it'], 'no judges at all');
  assert.deepEqual(lintPromptCache({ seats: { critics: [go] } }), [], 'switch off: nothing to say');
    // CHANGED ACCEPTED TEST (0.8.4 add-on removal, box set fix): OLD: an advisor chain (advise.enabled) gets the finding prompt-cache-not-for-this-chain. NEW: the row is gone. WHY: the advice add-on is removed.
  assert.deepEqual(lintPromptCache({ ...on, descending: true, seats: { critics: [an] } }), [], 'a descending chain runs an ordinary panel in its second sub-run, so the switch can act there');
  assert.deepEqual(lintPromptCache({ advise: { enabled: true }, seats: { critics: [or] } }), [], 'switch off: nothing to say');
});
