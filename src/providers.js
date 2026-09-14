// Provider adapters. One shape in, one shape out.
//
//   call({ model, system, messages, maxTokens, temperature })
//     -> { text, usage: { input, output }, provider, model }
//
// Anthropic uses its own Messages API. Everything else here speaks the
// OpenAI chat-completions shape, which is why they share one adapter.

const OPENAI_COMPAT = {
  openai:   { base: 'https://api.openai.com/v1',                 key: 'OPENAI_API_KEY' },
  google:   { base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'GOOGLE_API_KEY' },
  xai:      { base: 'https://api.x.ai/v1',                       key: 'XAI_API_KEY' },
  mistral:  { base: 'https://api.mistral.ai/v1',                 key: 'MISTRAL_API_KEY' },
  deepseek: { base: 'https://api.deepseek.com/v1',               key: 'DEEPSEEK_API_KEY' },
  groq:     { base: 'https://api.groq.com/openai/v1',            key: 'GROQ_API_KEY' },
  cohere:   { base: 'https://api.cohere.ai/compatibility/v1',    key: 'COHERE_API_KEY' },
  openrouter: { base: 'https://openrouter.ai/api/v1',            key: 'OPENROUTER_API_KEY' },
  together: { base: 'https://api.together.xyz/v1',               key: 'TOGETHER_API_KEY' },
  zai:      { base: 'https://api.z.ai/api/paas/v4',               key: 'ZAI_API_KEY' },
};

const ANTHROPIC = { base: 'https://api.anthropic.com/v1', key: 'ANTHROPIC_API_KEY' };

// An offline provider used to test the chain's plumbing without spending
// anything. It fakes a builder and a critic well enough to exercise every
// branch, including the early stop.
async function callMock({ model, system, messages, maxTokens }) {
  const user = messages.map(m => m.content).join('\n');
  // A critic whose reply can't be parsed - stands in for a real reply cut
  // off at the token cap. Exercises the abstention path offline.
  if (model === 'mock-unreadable') {
    await new Promise(r => setTimeout(r, 10));
    return { text: 'Looks fine to me. (no JSON)', usage: { input: 10, output: 8 }, provider: 'mock', model };
  }
  // A critic whose provider errored out mid-generation with no content at all - stands in for
  // GLM 5.3 Flash burning its whole token budget on thinking (usage.thinking === usage.output)
  // and returning finish_reason: "error" (GP judging run 2026-09-10T20-01-59-545Z). Exercises the
  // classifyUnreadable "stop: error" branch offline, distinct from the truncation/malformed-JSON
  // cases mock-unreadable covers.
  if (model === 'mock-provider-error') {
    await new Promise(r => setTimeout(r, 10));
    return { text: '', usage: { input: 10, output: 20, thinking: 20, stop: 'error' }, provider: 'mock', model };
  }
  // A provider that is down outright - network failure, 5xx after retries exhausted, etc. -
  // stands in for the crash a real provider outage caused in a paid run (v7 item 2). Unlike
  // mock-provider-error above (a reply that came back but was empty), this throws before any
  // reply exists at all, exercising the code path where invoke() itself rejects.
  if (model === 'mock-network-error') {
    await new Promise(r => setTimeout(r, 10));
    throw new Error('mock: provider unreachable (simulated network failure)');
  }
  if (system.startsWith('You are a proposer')) {
    await new Promise(r => setTimeout(r, 10));
    const text = model === 'mock-proposer-empty'
      ? 'I have nothing to add.'
      // v5 §1 candidate 10: a seat that returns more proposals than a
      // chain's opt-in max_proposals_per_seat cap, to exercise the fold-down
      // path offline. Four proposals, distinct titles so a merge test can
      // tell which ones survived.
      : model === 'mock-proposer-quad'
      ? JSON.stringify({ proposals: [1, 2, 3, 4].map(n => (
          { title: `Part ${n} from ${model}`, serves: 'the format criterion', what: 'A mock part.', why: 'Exercises the ledger.', how: 'mock.js', acceptance_test: 'It appears in the ledger.' }))})
      : JSON.stringify({ proposals: [
          { title: `Part from ${model}`, serves: 'the format criterion', what: 'A mock part.', why: 'Exercises the ledger.', how: 'mock.js', acceptance_test: 'It appears in the ledger.' },
        ]});
    return { text, usage: { input: 20, output: 30 }, provider: 'mock', model };
  }
  // v5 §1 candidate 10: the fold-down prompt itself. Keeps the first `cap`
  // of the seat's own numbered proposals - enough to exercise the wiring
  // offline without needing real judgement.
  if (system.startsWith('You are folding your own proposals down')) {
    await new Promise(r => setTimeout(r, 10));
    const capMatch = user.match(/cap of (\d+)/);
    const cap = capMatch ? Number(capMatch[1]) : 1;
    const n = (user.match(/^## \d+$/gm) || []).length;
    const kept = Array.from({ length: Math.min(cap, n) }, (_, i) => i + 1);
    return { text: JSON.stringify({ kept, merged_because: 'mock: folded to the cap' }), usage: { input: 20, output: 10 }, provider: 'mock', model };
  }
  if (system.startsWith('You are one lab on a planning panel. Every lab proposed')) {
    await new Promise(r => setTimeout(r, 10));
    const others = [...user.matchAll(/^## ([A-Z]-\d+) \(by Lab [A-Z]\)/gm)].map(m => m[1]);
    const mineIdx = user.indexOf('# The other labs');
    const theirs = others.filter(id => user.indexOf(`## ${id} `) > mineIdx);
    const posts = theirs.map((id, i) => ({ on: id, stance: i % 2 ? 'support' : 'object', text: i % 2 ? 'Fine as written.' : 'Quote: "mock.js" - no such file exists.' }));
    return { text: JSON.stringify({ posts, revisions: [] }), usage: { input: 30, output: 30 }, provider: 'mock', model };
  }
  if (system.startsWith('You are one lab on a planning panel, answering')) {
    await new Promise(r => setTimeout(r, 10));
    const ids = [...user.matchAll(/^## ([A-Z]-\d+) \(by/gm)].map(m => m[1]);
    const replies = ids.map((id, i) => i === 0 ? { id, action: 'amend', text: 'Fair.', how: 'mock.js (amended)' } : { id, action: 'keep', text: 'The file is created by the plan.' });
    return { text: JSON.stringify({ replies }), usage: { input: 30, output: 20 }, provider: 'mock', model };
  }
  if (system.startsWith('You write the handoff file')) {
    await new Promise(r => setTimeout(r, 10));
    return { text: 'MOCK HANDOFF\n\nRead the plan. Start with "begin".', usage: { input: 30, output: 10 }, provider: 'mock', model };
  }
  if (system.startsWith('You read a request and ask the questions')) {
    await new Promise(r => setTimeout(r, 10));
    return { text: JSON.stringify({ questions: [
      { question: 'Is the artifact for humans or machines?', why: 'Changes the format entirely.', default: 'Humans.' },
      { question: 'One page or several?', why: 'Changes the structure.', default: 'One page.' },
    ]}), usage: { input: 20, output: 40 }, provider: 'mock', model };
  }
  if (system.startsWith('You are the judge')) {
    await new Promise(r => setTimeout(r, 10));
    const n = (user.match(/^## \d+$/gm) || []).length;
    return { text: JSON.stringify({ picks: n ? [1] : [], dropped_because: 'mock: duplicates' }), usage: { input: 20, output: 10 }, provider: 'mock', model };
  }
  if (system.startsWith('You write the skeleton')) {
    await new Promise(r => setTimeout(r, 10));
    return { text: 'MOCK SKELETON\n- system A\n- system B', usage: { input: 20, output: 10 }, provider: 'mock', model };
  }
  const isReviser = system.startsWith('You are the builder in a multi-model review chain,\nrevising');
  const isCritic = !isReviser && system.startsWith('You are an independent critic');
  const isCriteria = system.includes('turn a request into acceptance criteria');
  let text;
  if (isCriteria) {
    text = JSON.stringify({ criteria: [
      'The deliverable is the artifact itself, not a plan for one.',
      'It states the assumptions it was written under.',
      'It adds no scope the request did not ask for.',
    ]});
  } else if (isCritic) {
    // The scripted critic fails the first draft and passes the revision, so a
    // test run exercises the revise path and then the early stop.
    // `mock-critic-holdout` never passes, so a panel seated with it always ends
    // on a real holdout - the branch where a run ships with an objection on the
    // record rather than a unanimous sign-off.
    const revised = model !== 'mock-critic-holdout' && user.includes('REVISED MOCK DELIVERABLE');
    text = JSON.stringify(revised
      ? { meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' }
      : { meets: false, criteria: [], failures: [{ criterion: 'It states the assumptions it was written under.', problem: 'No assumptions section.', fix: 'Add one.' }], verdict_line: 'One criterion failed.' });
  } else {
    const ids = [...user.matchAll(/^## ([A-Z0-9-]+-\d+) \((?:from|[a-z0-9-]+\))/gm)].map(m => m[1]);
    const ledger = ids.length ? `\n\n## Scope ledger\n${ids.map((id, i) => `${id} - ${i === 0 ? 'accepted - section 1' : 'cut - duplicate of the first'}`).join('\n')}` : '';
    // test/chain.test.js's §5 dispute-record fixture: a reviser reply ending in one or more
    // "DECLINED: <reason>" trailer lines, as src/roles.js's reviser system prompt now instructs
    // for an objection the reviser judges not to be a real defect. Gated on a marker in the
    // request text so every other mock-provider test (which never sets it) is unaffected.
    const declineTrailer = isReviser && user.includes('TRIGGER_DECLINED_TEST')
      ? '\n\nDECLINED: the critic quoted no evidence for this claim.\nDECLINED: this is a matter of taste, not a defect.'
      : '';
    text = `${isReviser ? 'REVISED ' : ''}MOCK DELIVERABLE for model ${model}\n\nBody text.${isReviser ? '\n\nAssumptions: none.' : ''}${ledger}${declineTrailer}`;
  }
  await new Promise(r => setTimeout(r, 10));
  return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
}

export function keyFor(provider) {
  if (provider === 'mock' || provider === 'external') return provider;
  const spec = provider === 'anthropic' ? ANTHROPIC : OPENAI_COMPAT[provider];
  if (!spec) throw new Error(`Unknown provider: ${provider}`);
  return process.env[spec.key] || null;
}

export function providerNames() {
  return ['anthropic', ...Object.keys(OPENAI_COMPAT)];
}

// The env var NAME a provider's key lives in - never the value. `council
// doctor` uses this to report which keys are present without ever reading
// (or printing) what they contain.
export function envKeyName(provider) {
  if (provider === 'mock' || provider === 'external') return null;
  const spec = provider === 'anthropic' ? ANTHROPIC : OPENAI_COMPAT[provider];
  if (!spec) throw new Error(`Unknown provider: ${provider}`);
  return spec.key;
}

async function withRetry(fn, { tries = 3, label = '' } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (err) {
      last = err;
      // Do not burn retries on a request that will never succeed.
      if (err.status && err.status !== 429 && err.status < 500) throw err;
      const wait = 1500 * Math.pow(2, i);
      process.stderr.write(`  retry ${i + 1}/${tries} ${label}: ${err.message} (waiting ${wait}ms)\n`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw last;
}

async function post(url, headers, body, label) {
  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 600);
      const err = new Error(`HTTP ${res.status} ${detail}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }, { label });
}

async function callAnthropic({ model, system, messages, maxTokens, temperature, extra }) {
  const key = keyFor('anthropic');
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const json = await post(
    `${ANTHROPIC.base}/messages`,
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    {
      model,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      // e.g. { thinking: { type: 'disabled' } } - Claude 5's thinking is
      // adaptive by default, counts against max_tokens, and is not text.
      ...(extra || {}),
    },
    `anthropic/${model}`
  );
  const text = (json.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  return {
    text,
    usage: {
      input: json.usage?.input_tokens ?? 0,
      output: json.usage?.output_tokens ?? 0,
      thinking: json.usage?.output_tokens_details?.thinking_tokens ?? 0,
      stop: json.stop_reason ?? null,
    },
    provider: 'anthropic',
    model,
  };
}

async function callOpenAICompat(provider, { model, system, messages, maxTokens, temperature, extra }) {
  const spec = OPENAI_COMPAT[provider];
  const key = keyFor(provider);
  if (!key) throw new Error(`${spec.key} not set`);
  const json = await post(
    `${spec.base}/chat/completions`,
    { authorization: `Bearer ${key}` },
    {
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      max_completion_tokens: maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      // Per-seat escape hatch for a provider's own non-standard fields (e.g.
      // Qwen3.5's chat_template_kwargs.enable_thinking on Together). Kept
      // generic rather than provider-specific branching in this adapter.
      ...(extra || {}),
    },
    `${provider}/${model}`
  );
  return {
    text: json.choices?.[0]?.message?.content ?? '',
    usage: {
      input: json.usage?.prompt_tokens ?? 0,
      output: json.usage?.completion_tokens ?? 0,
      thinking: json.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      stop: json.choices?.[0]?.finish_reason ?? null,
    },
    provider,
    model,
  };
}

export async function call(provider, opts) {
  if (provider === 'mock') return callMock(opts);
  if (provider === 'external') throw new Error('external seats are answered by writing <label>.md into the run folder, never called');
  if (provider === 'anthropic') return callAnthropic(opts);
  if (OPENAI_COMPAT[provider]) return callOpenAICompat(provider, opts);
  throw new Error(`Unknown provider: ${provider}`);
}
