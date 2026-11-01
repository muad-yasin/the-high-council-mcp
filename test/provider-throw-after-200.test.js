// BUG-C-032 (Register_C): an adapter's own parsing of a 200 reply can throw (a body of `null`, `content` that is not an array, a 200 that carries an `error`).
// post() had already returned, so the provider billed the call; the error must carry `maybeBilled` like post()'s own post-200 failures, so invoke() charges one attempt's worst case.
// CHANGED (S5-03, 28 Okt 2026; owner's pick: "a typical cost" for an error reply with no figure, its own figure when it has one). OLD: a 200 that carries an error and no choices was marked maybeBilled like every other throw after a 200, so
// invoke() charged one attempt's WORST case for it (seven pilot calls were charged $10.18 for replies that each cost cents or nothing). NEW: that one class carries `errorBody` (the usage the provider reported, or null) and is NOT marked
// maybeBilled: invoke() charges its reported usage, else the call's expected cost. WHY: the error reply is the provider saying what happened, and a worst case is not a measurement. The other throws (a body of null, content that is not
// an array, a dropped or non-JSON body, a timeout) stay marked and stay charged at the worst case; the two tests of the error body are below the loop.
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

test('openrouter: a 200 carrying an error and no choices throws an error-body error that is NOT marked maybeBilled, carries no usage when the body has none, and is sent once', async () => {
  await withStub(() => reply200('{"error":{"message":"upstream failed","code":502}}'), async ({ calls }) => {
    await assert.rejects(() => call('openrouter', opts('x/y')), err => err instanceof Error && err.maybeBilled !== true && err.errorBody && err.errorBody.usage === null && err.providerCode === 502);
    assert.equal(calls(), 1, 'a paid generation must not be requested again');
  });
});

test('openrouter: a 200 carrying an error AND a usage figure carries that usage on the error', async () => {
  await withStub(() => reply200('{"error":{"message":"upstream failed"},"usage":{"prompt_tokens":120,"completion_tokens":0}}'), async () => {
    await assert.rejects(() => call('openrouter', opts('x/y')), err => err.maybeBilled !== true && err.errorBody?.usage?.input === 120 && err.errorBody.usage.output === 0);
  });
});
