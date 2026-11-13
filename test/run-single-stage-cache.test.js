// 0.8.4 cache part (b)2, FIX 3: runSingleStage (src/chain.js), the exported single call through invoke() ("never a way round the cap"), forwards an optional cache head and lifetime, so a marked call can go through it under the spend cap. It exists for the paid cache probe (a script outside src/), which needs a marked call with the cap armed. Offline, $0: fetch is stubbed, the key is a dummy.
//   FS-1 a routed Claude seat, the order's words recorded, a head and the 5-minute lifetime: the request carries the cache marker on the text part that ends the head, and the stage records the marker as asked.
//   FS-2 the same call with neither argument: the user message is the plain string and no key of the body contains "cache" (what every caller that passes neither sends). NO RED OF ITS OWN: it pins what held (it passes on the tree before this change).
// Red run: against the tree before the change (0e055bfe) plus this file FS-1 fails at the marker (the head and lifetime are dropped, the user message stays a plain string).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runSingleStage, setBudget, setCache } from '../src/chain.js';
import * as Held from '../src/held-roles.js';
import * as HC from './held-prompts/held-084-cache-order.js';

afterEach(() => { setBudget(null); setCache(null); Held.setHeldForTest(null); });
const SEAT = { provider: 'openrouter', originalProvider: 'anthropic', model: 'anthropic/claude-haiku-5.5', lab: 'probe', maxTokens: 1000 };
const HEAD = 'A generic shared beginning for the probe.\n';
const everyKey = o => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => [k, ...everyKey(v)]) : []);
// runs fn with fetch stubbed (one reply in OpenRouter's shape) and returns the request bodies it saw
const sentBodies = async fn => {
  const real = globalThis.fetch, key = process.env.OPENROUTER_API_KEY, bodies = [];
  process.env.OPENROUTER_API_KEY = 'sk-test-dummy-key';
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ model: 'anthropic/claude-haiku-5.5', provider: 'Amazon Bedrock', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 1100 } } }), { status: 200 });
  };
  try { return { bodies, stage: await fn() }; } finally { globalThis.fetch = real; if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key; }
};

test('FS-1 a marked call goes through runSingleStage: the marker ends the head, 5 minutes, and the stage records it as asked', async () => {
  Held.setHeldForTest({ ...HC });
  setCache(null); setBudget(5);
  const { bodies, stage } = await sentBodies(() => runSingleStage(SEAT, { system: 'You are a probe.', user: `${HEAD}Answer with the single word OK.`, label: 'fs1', cacheHead: HEAD, cacheTtl: '5m' }));
  assert.equal(bodies.length, 1);
  const user = bodies[0].messages.find(m => m.role === 'user');
  assert.ok(Array.isArray(user.content), 'the user message is split at the head (a plain string here means nothing was marked)');
  assert.equal(user.content[0].text, HEAD);
  assert.deepEqual(user.content[0].cache_control, { type: 'ephemeral' });
  assert.equal(stage.usage.cacheAsked, '5m');
});

test('FS-2 with neither argument the request is what it always was: a plain string user message and no key containing "cache" (NO RED OF ITS OWN)', async () => {
  Held.setHeldForTest({ ...HC });
  setCache(null); setBudget(5);
  const { bodies } = await sentBodies(() => runSingleStage(SEAT, { system: 'You are a probe.', user: `${HEAD}Answer with the single word OK.`, label: 'fs2' }));
  assert.equal(typeof bodies[0].messages.find(m => m.role === 'user').content, 'string');
  assert.deepEqual(everyKey(bodies[0]).filter(k => /cache/i.test(k)), []);
});
