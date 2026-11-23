// 0.8.4 cache part (b)2, step (a): the switch is ON in the shipped planning chains (Muad, 09 Nov 2026 18:21: "CACHING IS ON IN EVERY SHIPPED PAID CHAIN THAT RUNS A PANEL AND AN EXCHANGE"; "of course all", so the China pair too; 10 Nov 2026 03:35 and 16:23: the lifetime is 5 minutes everywhere except plan-claude-council, which uses 1 hour). Offline, $0: the dry run is a pure function of the chain file.
// WHAT IS PINNED: (1) every shipped planning chain (chains/plan-*.json, the folder outdated/ excluded) carries `prompt_cache.enabled: true` with its lifetime, and the list of them is the seven the heading names (a new plan-* chain is a new decision, so it fails here until someone decides). (2) The chain lint raises nothing on the switch for any of them (a seat that
// can use it exists). (3) THE DRY RUN WITH CACHING ON NEVER READS HIGHER THAN WITH IT OFF, for each of the seven chains, in both figures (expected and maximum), in the state the program ships in today (the order's new words are not recorded in src/roles.js: the held state). WHY THAT STATE: once the batch of words is recorded, each call
// carries its lead-in and a chain with no saving it can count reads a few cents higher (his 10 Nov 2026 02:00 amendment, point (4)); that difference is pinned per seat, in every state, by the sweep in test/cache-marks.test.js, and is deliberately not asserted away here. (4) The two China chains hold no seat that calls Anthropic directly, so no mark is sent for them: caching there is the order only (a host that caches by itself).
// On the tree before this step (a) and (b) fail at "carries the switch" (the chain files have none); (c) PASSES there (it pins what held: NO RED OF ITS OWN).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cost from '../src/cost.js';
import * as PromptCache from '../src/prompt-cache.js';
import * as Held from '../src/held-roles.js';
import * as HC from './held-prompts/held-084-cache-order.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEVEN = ['plan-china-high-council', 'plan-china-medium-council', 'plan-claude-council', 'plan-high-council', 'plan-medium-council', 'plan-mini-council', 'plan-the-high-council'];
const TTL = name => (name === 'plan-claude-council' ? '1h' : '5m');
const UNRECORDED = Object.fromEntries(Object.keys(HC).map(n => [n, undefined]));
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const total = rows => rows.reduce((t, r) => t + r.usd, 0);
afterEach(() => Held.setHeldForTest(null));

test('SHIPPED CHAINS (a): the shipped planning chains are the seven the heading names, each with prompt_cache on at its lifetime (5 minutes; plan-claude-council 1 hour), and the lint finds nothing on the switch', () => {
  const shipped = readdirSync(join(root, 'chains')).filter(f => /^plan-.*\.json$/.test(f)).map(f => f.replace(/\.json$/, '')).sort();
  assert.deepEqual(shipped, [...SEVEN].sort(), 'the shipped planning chains are the seven of his 09 Nov 2026 18:21 heading (a new one is a new decision about its switch)');
  for (const name of SEVEN) {
    const c = chain(name);
    assert.deepEqual(c.prompt_cache, { enabled: true, ttl: TTL(name) }, `${name} carries the switch with its lifetime`);
    assert.deepEqual(PromptCache.lintPromptCache(c, `chains/${name}.json`), [], `${name}: the lint finds nothing on the switch`);
  }
});

test('SHIPPED CHAINS (b): for each of the seven chains the dry run with caching on never reads higher than with it off, in both figures, in the state the program ships in (the order\'s words not recorded)', () => {
  Held.setHeldForTest({ ...UNRECORDED });
  const table = [];
  for (const name of SEVEN) {
    const on = chain(name), off = { ...on, prompt_cache: undefined };
    assert.equal(on.prompt_cache?.enabled, true, `${name} carries the switch (the file is the "on" side of the comparison)`);
    for (const maximum of [false, true]) {
      const a = total(Cost.estimateChainRows(on, { maximum })), b = total(Cost.estimateChainRows(off, { maximum }));
      table.push(`${name} ${maximum ? 'maximum' : 'expected'}: on ${a.toFixed(4)} off ${b.toFixed(4)}`);
      assert.ok(a <= b + 1e-9, `${name} ${maximum ? 'maximum' : 'expected'}: caching on reads ${a} and off reads ${b}`);
    }
  }
  console.log(table.join('\n'));
});

test('SHIPPED CHAINS (c): the two China chains hold no seat that calls Anthropic directly, so no cache mark is sent for them: caching there is the order alone', () => {
  for (const name of ['plan-china-high-council', 'plan-china-medium-council']) {
    const seats = Object.values(chain(name).seats).flatMap(s => (Array.isArray(s) ? s : [s])).filter(s => s && typeof s === 'object');
    assert.deepEqual(seats.filter(PromptCache.isDirectAnthropicSeat).map(s => s.model), [], `${name}: no direct Anthropic seat`);
  }
});
