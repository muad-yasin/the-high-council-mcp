// BUG-C-032 (Register_C): an adapter's own parsing of a 200 reply can throw (a body of `null`, `content` that is not an array, a 200 that carries an `error`).
// post() had already returned, so the provider billed the call; the error must carry `maybeBilled` like post()'s own post-200 failures, so invoke() charges one attempt's worst case.
// Offline, $0: globalThis.fetch is stubbed (the same guard test/providers-retry.test.js uses); nothing waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, setRetrySleep } from '../src/providers.js';
import { runChain, setBudget, setCache, budgetState } from '../src/chain.js';

const reply200 = body => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });

async function withStub(responder, fn) {
  const original = globalThis.fetch;
  const had = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  let n = 0;
  globalThis.fetch = async () => responder(++n);
  process.env.OPENROUTER_API_KEY = 'sk-test';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-key';
  setRetrySleep(async () => {});
  try { return await fn({ calls: () => n }); }
  finally {
    globalThis.fetch = original; setRetrySleep(null);
    for (const [k, v] of Object.entries(had)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const opts = model => ({ model, system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 100 });

// Each body is valid JSON with HTTP 200 and makes the adapter throw after post() returned.
const CASES = [
  ['anthropic', 'claude-opus-5', 'null', 'a body of null'],
  ['anthropic', 'claude-opus-5', '{"content":"hello"}', 'content that is a string, not an array'],
  ['anthropic', 'claude-opus-5', '{"content":[null]}', 'a null content block'],
  ['openrouter', 'x/y', 'null', 'a body of null'],
  ['openrouter', 'x/y', '{"error":{"message":"upstream failed","code":502}}', 'a 200 carrying an error and no choices'],
];

for (const [provider, model, body, what] of CASES) {
  test(`${provider}: ${what} (HTTP 200) throws marked maybeBilled, and is sent once`, async () => {
    await withStub(() => reply200(body), async ({ calls }) => {
      await assert.rejects(() => call(provider, opts(model)), err => err instanceof Error && err.maybeBilled === true);
      assert.equal(calls(), 1, 'a paid generation must not be requested again');
    });
  });
}

test('invoke charges a call whose 200 reply the adapter cannot parse, so the spend and the cap count it', async () => {
  await withStub(() => reply200('null'), async () => {
    setCache(null); setBudget(1000);
    try {
      const seat = { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 1000 };
      await assert.rejects(() => runChain({ request: 'Req.', config: { name: 'x', maxRounds: 1, seats: { criteria: seat, builder: seat, critics: [seat] } }, log: () => {} }));
      assert.ok(budgetState().spent > 0, 'the probably-billed attempt must count toward the cap');
      assert.equal(budgetState().reserved, 0);
    } finally { setBudget(null); }
  });
});
