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

// Bug-audit fix, 2026-09-16: resolveChainSeats()'s rewrite loop (and allSeatsOf()'s own
// "does anything need rewriting" check) used to name only the 8 original seat slots, missing 5
// real ones added by later items: challenger, coldRead, claims (all singular), ambiguity (an
// array, like critics/proposers), and descending (a stageName -> seat map, unlike every other
// slot). Each left unrewritten meant that seat silently called its direct-lab provider even
// under a chain-level `transport`, defeating single-vendor mode for exactly that seat with no
// error - the failure mode named in tonight's audit.
test('resolveChainSeats: chain-level transport rewrites challenger, coldRead, and claims (bug-audit finding)', () => {
  const config = {
    name: 'x',
    transport: 'openrouter',
    seats: {
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      challenger: { provider: 'google', model: 'gemini-3.6-flash', lab: 'google' },
      coldRead: { provider: 'mistral', model: 'mistral-large-latest', lab: 'mistral' },
      claims: { provider: 'deepseek', model: 'deepseek-chat', lab: 'deepseek' },
    },
  };
  const resolved = resolveChainSeats(config);
  assert.equal(resolved.seats.challenger.provider, 'openrouter');
  assert.equal(resolved.seats.challenger.lab, 'google');
  assert.equal(resolved.seats.coldRead.provider, 'openrouter');
  assert.equal(resolved.seats.coldRead.lab, 'mistral');
  assert.equal(resolved.seats.claims.provider, 'openrouter');
  assert.equal(resolved.seats.claims.lab, 'deepseek');
});

test('resolveChainSeats: chain-level transport rewrites every seat in the ambiguity array (bug-audit finding)', () => {
  const config = {
    name: 'x',
    transport: 'openrouter',
    seats: {
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      ambiguity: [
        { provider: 'google', model: 'gemini-3.6-flash', lab: 'google' },
        { provider: 'mistral', model: 'mistral-large-latest', lab: 'mistral' },
      ],
    },
  };
  const resolved = resolveChainSeats(config);
  assert.equal(resolved.seats.ambiguity[0].provider, 'openrouter');
  assert.equal(resolved.seats.ambiguity[0].lab, 'google');
  assert.equal(resolved.seats.ambiguity[1].provider, 'openrouter');
  assert.equal(resolved.seats.ambiguity[1].lab, 'mistral');
});

test('resolveChainSeats: chain-level transport rewrites every seat inside the descending stage-name map (bug-audit finding)', () => {
  const config = {
    name: 'x',
    transport: 'openrouter',
    seats: {
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      descending: {
        'stage-a': { provider: 'google', model: 'gemini-3.6-flash', lab: 'google' },
        'stage-b': { provider: 'mistral', model: 'mistral-large-latest', lab: 'mistral' },
      },
    },
  };
  const resolved = resolveChainSeats(config);
  assert.equal(resolved.seats.descending['stage-a'].provider, 'openrouter');
  assert.equal(resolved.seats.descending['stage-a'].lab, 'google');
  assert.equal(resolved.seats.descending['stage-b'].provider, 'openrouter');
  assert.equal(resolved.seats.descending['stage-b'].lab, 'mistral');
  // Original config's nested descending object is untouched, same no-mutation guarantee as
  // every other slot.
  assert.equal(config.seats.descending['stage-a'].provider, 'google');
});

test('resolveChainSeats: a transport set ONLY on challenger (no chain-level transport) is still enough to trigger rewriting - allSeatsOf() must see it', () => {
  const config = {
    name: 'x',
    seats: {
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      challenger: { provider: 'google', model: 'gemini-3.6-flash', transport: 'openrouter' },
    },
  };
  const resolved = resolveChainSeats(config);
  assert.equal(resolved.seats.challenger.provider, 'openrouter');
  assert.equal(resolved.seats.challenger.model, 'google/gemini-3.6-flash');
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

// Bug-audit fix, 2026-09-16: src/chain.js's thinking-disabled retry and its matching budget
// projection both used to check the literal `seat.provider === 'anthropic'`, which
// resolveVendorSeat() overwrites to the vendor's own name (e.g. "openrouter") under single-vendor
// mode. An Anthropic seat routed that way answers via callOpenAICompat(), which also reports a
// token-limit stop as `finish_reason: "length"` (OpenAI-compatible vocabulary), never the literal
// `"max_tokens"` string Anthropic's own native API uses - a second, compounding gap the retry
// check never accounted for even before single-vendor mode existed at this call site. Both are
// fixed together: `originalProvider` (set by resolveVendorSeat) survives the rewrite, and the
// retry trigger now accepts either stop-reason spelling.
test('runChain: an Anthropic seat routed through single-vendor mode still gets the thinking-disabled retry (bug-audit finding)', async () => {
  const hadOpenRouter = process.env.OPENROUTER_API_KEY;
  const hadAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-test-openrouter-key';
  delete process.env.ANTHROPIC_API_KEY;

  let callCount = 0;
  const requests = [];
  const restore = stubFetch(async (url, opts) => {
    callCount += 1;
    const body = JSON.parse(opts.body);
    requests.push({ extra: body.thinking ?? null });
    if (callCount === 1) {
      // First attempt: burned the whole budget on thinking, cut off mid-generation - the OpenAI-
      // compatible shape for this (finish_reason "length", not Anthropic's native "max_tokens").
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 20, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 500 } },
        }),
      };
    }
    // Retry (thinking disabled): a normal, complete reply.
    const text = JSON.stringify({ criteria: ['A real criterion, produced on the retry.'] });
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 0 } },
      }),
    };
  });

  try {
    const config = {
      name: 'single-vendor-thinking-retry-test',
      transport: 'openrouter',
      maxRounds: 1,
      seats: {
        criteria: { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'anthropic' },
        builder: { provider: 'mock', model: 'mock-builder' },
        reviser: { provider: 'mock', model: 'mock-builder' },
        critics: [{ provider: 'mock', model: 'mock-critic-a' }, { provider: 'mock', model: 'mock-critic-b' }],
      },
    };

    const result = await runChain({ request: 'A test request.', config, log: () => {} });

    assert.equal(callCount, 2, 'the criteria stage must be retried exactly once after the thinking-truncated first attempt');
    assert.equal(requests[0].extra, null, 'the first attempt has no thinking override');
    assert.deepEqual(requests[1].extra, { type: 'disabled' }, 'the retry explicitly disables thinking');
    assert.deepEqual(result.criteria, ['A real criterion, produced on the retry.'], 'the retried reply is what the run actually used, not the truncated first attempt');
  } finally {
    restore();
    if (hadOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = hadOpenRouter;
    if (hadAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = hadAnthropic;
  }
});

test('resolveVendorSeat: preserves the seat\'s real identity in originalProvider, independent of the rewritten provider field', () => {
  const seat = { provider: 'anthropic', model: 'claude-sonnet-5' };
  const resolved = resolveVendorSeat(seat, 'openrouter');
  assert.equal(resolved.provider, 'openrouter');
  assert.equal(resolved.originalProvider, 'anthropic');
});

// Security-review fix (Fable 5.1 review of c915eba, MEDIUM 3): resolveChainSeats missed
// `security_reviewer`, and even after adding it to the rewrite loop, a chain that names no
// explicit security_reviewer at all still fell through to security-review.js's own raw
// DEFAULT_SECURITY_REVIEWER_SEAT constant (hardcoded direct-Anthropic) at stage-run time,
// bypassing single-vendor mode for the one stage that runs last.
test('resolveChainSeats: an explicit security_reviewer seat is rewritten under chain-level transport (bug-audit finding)', () => {
  const config = {
    name: 'x',
    transport: 'openrouter',
    seats: {
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      security_reviewer: { provider: 'google', model: 'gemini-3.6-flash', lab: 'google' },
    },
  };
  const resolved = resolveChainSeats(config);
  assert.equal(resolved.seats.security_reviewer.provider, 'openrouter');
  assert.equal(resolved.seats.security_reviewer.lab, 'google');
});

test('resolveChainSeats: with security_review.enabled and no explicit security_reviewer, the DEFAULT seat is materialized and routed (bug-audit finding)', () => {
  const config = {
    name: 'x',
    transport: 'openrouter',
    security_review: { enabled: true },
    seats: {
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      // no security_reviewer named - the config falls back to DEFAULT_SECURITY_REVIEWER_SEAT,
      // whose model (claude-fable-5-1) has no vendor route today, so this must throw rather than
      // silently keep using the raw direct-Anthropic default under single-vendor mode.
    },
  };
  assert.throws(() => resolveChainSeats(config), /no route for anthropic-security under transport openrouter/,
    'no silent fallback to direct-Anthropic under single-vendor mode - fails loud instead, same as any other unrouted seat');
});

test('resolveChainSeats: security_review NOT enabled - the default reviewer seat is never touched, never causes a spurious throw', () => {
  const config = {
    name: 'x',
    transport: 'openrouter',
    seats: { builder: { provider: 'anthropic', model: 'claude-sonnet-5' } },
    // security_review.enabled is absent/false - the vast majority of chains, must not throw.
  };
  assert.doesNotThrow(() => resolveChainSeats(config));
  const resolved = resolveChainSeats(config);
  assert.equal(resolved.seats.security_reviewer, undefined, 'no security_reviewer materialized when the stage never runs');
});
