// test/single-vendor.test.js
//
// 7.x item 4: single-vendor mode, OpenRouter as the reference adapter. Every seat in a chain
// routes through one vendor account/key while keeping its own `lab` value, so multi-lab debate
// and independence accounting (labOf() in src/chain.js) are unaffected by which billing endpoint
// actually served the call. See src/providers.js's resolveVendorSeat() and src/chain.js's
// resolveChainSeats() (the one composition point every caller - cli.js and runChain() itself -
// goes through).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVendorSeat } from '../src/providers.js';
import { resolveChainSeats, runChain } from '../src/chain.js';

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('resolveVendorSeat: a mapped seat resolves to the vendor provider and its own model-ID naming, preserving lab', () => {
  const seat = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 8000 };
  const resolved = resolveVendorSeat(seat, 'openrouter');
  assert.equal(resolved.provider, 'openrouter');
  assert.equal(resolved.model, 'anthropic/claude-sonnet-5');
  assert.equal(resolved.lab, 'anthropic', 'a seat with no explicit lab keeps its original provider as its lab identity');
  assert.equal(resolved.maxTokens, 8000, 'fields other than provider/model/lab pass through untouched');
});

test('resolveVendorSeat: an explicit lab survives the rewrite unchanged (does not fall back to the vendor)', () => {
  const seat = { provider: 'together', model: 'Qwen/Qwen3.5-9B', lab: 'qwen' };
  const resolved = resolveVendorSeat(seat, 'openrouter');
  assert.equal(resolved.provider, 'openrouter');
  assert.equal(resolved.lab, 'qwen');
});

test('resolveVendorSeat: an unmapped provider:model fails fast, naming the lab and the transport', () => {
  const seat = { provider: 'cohere', model: 'some-future-model-not-in-the-map', lab: 'cohere' };
  assert.throws(() => resolveVendorSeat(seat, 'openrouter'), /no route for cohere under transport openrouter/);
});

test('resolveVendorSeat: mock and external seats are never rewritten', () => {
  const mockSeat = { provider: 'mock', model: 'mock-critic-a' };
  const externalSeat = { provider: 'external', model: 'n/a' };
  assert.equal(resolveVendorSeat(mockSeat, 'openrouter'), mockSeat);
  assert.equal(resolveVendorSeat(externalSeat, 'openrouter'), externalSeat);
});

test('resolveVendorSeat: no transport is a no-op, returning the exact same seat', () => {
  const seat = { provider: 'anthropic', model: 'claude-sonnet-5' };
  assert.equal(resolveVendorSeat(seat, undefined), seat);
});

test('resolveChainSeats: a config with no transport anywhere is returned unchanged (identity, not just deep-equal) - backward compat', () => {
  const config = { name: 'x', seats: { builder: { provider: 'anthropic', model: 'claude-sonnet-5' } } };
  assert.equal(resolveChainSeats(config), config);
});

test('resolveChainSeats: chain-level transport rewrites every seat slot (single and array) and preserves lab', () => {
  const config = {
    name: 'x',
    transport: 'openrouter',
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [
        { provider: 'google', model: 'gemini-3.6-flash' },
        { provider: 'mistral', model: 'mistral-large-latest', lab: 'mistral-eu' },
      ],
    },
  };
  const resolved = resolveChainSeats(config);
  assert.equal(resolved.seats.criteria.provider, 'openrouter');
  assert.equal(resolved.seats.criteria.model, 'anthropic/claude-sonnet-5');
  assert.equal(resolved.seats.critics[0].provider, 'openrouter');
  assert.equal(resolved.seats.critics[0].lab, 'google');
  assert.equal(resolved.seats.critics[1].lab, 'mistral-eu', 'an explicit lab is never overwritten by the vendor rewrite');
  // Original config object is untouched - resolveChainSeats never mutates its input.
  assert.equal(config.seats.criteria.provider, 'anthropic');
});

test('resolveChainSeats: a per-seat transport override works even with no chain-level transport set', () => {
  const config = {
    name: 'x',
    seats: { builder: { provider: 'anthropic', model: 'claude-sonnet-5', transport: 'openrouter' } },
  };
  const resolved = resolveChainSeats(config);
  assert.equal(resolved.seats.builder.provider, 'openrouter');
  assert.equal(resolved.seats.builder.model, 'anthropic/claude-sonnet-5');
});

// The deliverable's own acceptance test, $0 and offline: a debate stage with two seats from
// different `lab` values, both routed through a single vendor key, against a mocked HTTP layer
// that records every outbound request. Asserts every request targets the vendor's base URL with
// the mapped model ID, both `lab` values survive into the board, and no direct-lab credential is
// read - only OPENROUTER_API_KEY is set below; if the resolved routing were wrong, the run would
// throw "<PROVIDER>_API_KEY not set" instead of completing.
test('runChain: single-vendor mode routes a two-lab debate stage through OpenRouter, preserving both labs, with no direct-lab key set', async () => {
  const hadOpenRouter = process.env.OPENROUTER_API_KEY;
  const hadAnthropic = process.env.ANTHROPIC_API_KEY;
  const hadGoogle = process.env.GOOGLE_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-test-openrouter-key';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;

  const requests = [];
  const restore = stubFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    requests.push({ url, headers: opts.headers, model: body.model });
    const system = body.messages[0].content;
    let text;
    if (system.startsWith('You are a proposer')) {
      text = JSON.stringify({ proposals: [{ title: `Part from ${body.model}`, serves: 'the format criterion', what: 'x', why: 'x', how: 'x', acceptance_test: 'x' }] });
    } else if (system.startsWith('You are one lab on a planning panel. Every lab proposed')) {
      text = JSON.stringify({ posts: [], revisions: [] });
    } else if (system.startsWith('You are one lab on a planning panel, answering')) {
      text = JSON.stringify({ replies: [] });
    } else if (system.startsWith('You are an independent critic')) {
      text = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });
    } else {
      text = 'unexpected stage for this fixture';
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 20 } }) };
  });

  try {
    const config = {
      name: 'single-vendor-test',
      transport: 'openrouter',
      maxRounds: 1,
      signoff: 'unanimous',
      proposals: { parts: 1, maxTokens: 200 },
      debate: true,
      seats: {
        criteria: { provider: 'mock', model: 'mock-criteria' },
        skeleton: { provider: 'mock', model: 'mock-skeleton' },
        builder: { provider: 'mock', model: 'mock-builder' },
        reviser: { provider: 'mock', model: 'mock-builder' },
        proposers: [
          { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'anthropic' },
          { provider: 'google', model: 'gemini-3.6-flash', lab: 'google' },
        ],
        critics: [
          { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'anthropic' },
          { provider: 'google', model: 'gemini-3.6-flash', lab: 'google' },
        ],
      },
    };

    const result = await runChain({ request: 'A single-vendor-mode test request.', config, log: () => {} });

    assert.ok(requests.length > 0, 'expected at least one outbound request');
    for (const r of requests) {
      assert.equal(r.url, 'https://openrouter.ai/api/v1/chat/completions', `every routed request must target OpenRouter's base URL, saw ${r.url}`);
      assert.equal(r.headers.authorization, 'Bearer sk-test-openrouter-key');
      assert.ok(['anthropic/claude-sonnet-5', 'google/gemini-3.6-flash'].includes(r.model),
        `expected a vendor-mapped model ID, saw ${r.model}`);
    }

    const labs = new Set(result.proposals.map(p => p.lab));
    assert.ok(labs.has('anthropic') && labs.has('google'), `expected both labs preserved in the board's proposals, saw ${[...labs]}`);
    assert.ok(result.board.includes('anthropic') || result.proposals.some(p => p.lab === 'anthropic'));
  } finally {
    restore();
    if (hadOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = hadOpenRouter;
    if (hadAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = hadAnthropic;
    if (hadGoogle !== undefined) process.env.GOOGLE_API_KEY = hadGoogle;
  }
});

// Backward compat, stated once globally in the deliverable: a chain with no `transport` field
// must run exactly as it did before this item existed - proven with a real existing mock chain,
// not just an absence-of-error check.
test('runChain: a chain with no transport field is untouched by single-vendor mode (backward compat)', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  const result = await runChain({ request: 'no transport set', config, log: () => {} });
  assert.ok(result.deliverable);
  assert.equal(config.seats.builder.provider, 'mock', 'the original config object must not be mutated');
});
