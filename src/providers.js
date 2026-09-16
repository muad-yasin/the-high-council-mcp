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
  // v7.1: a locally-run model (Ollama, LM Studio, ...) as a seat - "BYO-hardware" rather than
  // BYOK, since the whole point is that no key or API spend is involved. Ollama's own docs
  // (docs.ollama.com/openai, checked 2026-09-14) confirm its /v1 endpoint speaks the exact same
  // chat-completions request/response shape callOpenAICompat already parses - `choices[].message.
  // content`, `choices[].finish_reason`, `usage.prompt_tokens`/`completion_tokens` - and that
  // "an API key is required, but unused" (any value, including none, works). `optional: true`
  // is what makes that true here: keyFor() stops reporting a missing key as an error for this
  // provider, and callOpenAICompat only sends an Authorization header when a real key exists.
  // `free: true` is read by src/cost.js so a local seat prices at exactly $0 - explicit, not
  // silently "unpriced" (the existing pricing.json is keyed by exact model name, which cannot
  // enumerate every locally-pulled model name; the base URL default below is also always
  // overridable per seat via `baseUrl`, since LM Studio and other local runners use other ports).
  ollama: { base: 'http://localhost:11434/v1', key: 'OLLAMA_API_KEY', optional: true, free: true },
};

const ANTHROPIC = { base: 'https://api.anthropic.com/v1', key: 'ANTHROPIC_API_KEY' };

// 7.x single-vendor mode: maps a seat's own `provider:model` to a vendor's own model-ID
// naming, so an operator can route every seat's traffic through one billing account/key
// (OpenRouter is the reference vendor this slice ships; Bedrock/Vertex/Azure are documented
// follow-ups in the same shape - see docs/single-vendor-mode.md). Configuration is data, not
// code: add a lab here to route it, nothing else changes. Deliberately NOT auto-derived from
// `provider` (e.g. "together" -> "together") because the vendor's own naming frequently
// disagrees with ours (z.ai's GLM ships on OpenRouter as "z-ai/...", not "zai/...", and
// "openrouter" itself needs an identity entry since a seat already seated there has nothing to
// translate).
const VENDOR_MODEL_MAPS = {
  openrouter: {
    'anthropic:claude-opus-5': 'anthropic/claude-opus-5',
    'anthropic:claude-sonnet-5': 'anthropic/claude-sonnet-5',
    'anthropic:claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4.5',
    'openai:gpt-5': 'openai/gpt-5',
    'openai:gpt-5-mini': 'openai/gpt-5-mini',
    'openai:gpt-5-nano': 'openai/gpt-5-nano',
    'google:gemini-3.6-flash': 'google/gemini-3.6-flash',
    'xai:grok-4': 'x-ai/grok-4',
    'mistral:mistral-large-latest': 'mistralai/mistral-large',
    'mistral:mistral-small-latest': 'mistralai/mistral-small',
    'deepseek:deepseek-chat': 'deepseek/deepseek-chat',
    'groq:llama-3.3-70b-versatile': 'meta-llama/llama-3.3-70b-instruct',
    'together:Qwen/Qwen3.5-9B': 'qwen/qwen3.5-9b',
    'together:meta-llama/Llama-3.3-70B-Instruct-Turbo': 'meta-llama/llama-3.3-70b-instruct',
    'zai:glm-4.7-flash': 'z-ai/glm-4.7-flash',
    'cohere:command-r7b-12-2024': 'cohere/command-r7b-12-2024',
    // Already on OpenRouter under its own name - an identity route, not a translation, so a
    // chain that mixes a direct OpenRouter seat with single-vendor mode doesn't hit a false
    // "no route" for the one seat that needed no rewriting at all.
    'openrouter:meta-llama/llama-3.3-70b-instruct': 'meta-llama/llama-3.3-70b-instruct',
  },
};

// Resolves one seat to the vendor's own model-ID naming under `transport` (e.g.
// `"openrouter"`), preserving `lab` explicitly so debate/independence accounting
// (`labOf()` in chain.js: `seat.lab || seat.provider`) reads the seat's real identity rather
// than the vendor it happens to be billed through - see chain.js's resolveChainSeats(), the
// one composition point that calls this before any seat is invoked. `mock`/`external` seats
// are never rewritten: they carry no real provider to translate and a mock chain's own
// fixtures assert on the literal `provider`/`model` it was given.
export function resolveVendorSeat(seat, transport) {
  if (!transport || !seat || seat.provider === 'mock' || seat.provider === 'external') return seat;
  const map = VENDOR_MODEL_MAPS[transport];
  if (!map) throw new Error(`unknown transport: ${transport}`);
  const lab = seat.lab || seat.provider;
  const vendorModel = map[`${seat.provider}:${seat.model}`];
  if (!vendorModel) throw new Error(`no route for ${lab} under transport ${transport}`);
  // Bug-audit fix, 2026-09-16: `lab` already survives rewriting so cross-lab identity/debate
  // logic keeps working under single-vendor mode - `originalProvider` does the same job for
  // src/chain.js's two Anthropic-specific behaviors (the thinking-disabled retry and its matching
  // budget projection at 2 attempts instead of 1), which both used to check the literal
  // `seat.provider` field. Once that field became the vendor's own name (e.g. "openrouter"),
  // those checks silently went false forever for an Anthropic model routed through single-vendor
  // mode - even though the same Claude "thinking counts against max_tokens" behavior still
  // applies underneath, and the same stage can still cost double what a 1-attempt projection
  // assumes. `originalProvider` is the seat's real underlying identity, independent of which
  // vendor endpoint actually serves the call.
  return { ...seat, provider: transport, model: vendorModel, lab, originalProvider: seat.provider };
}

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
    // v7.x item 3 test fixture: a debate seat that asks for bounded, allowlisted tool calls in
    // the same reply - one allowed request and one disallowed one, to exercise both branches of
    // runSeatToolRequests offline (test/seat-tool-calls.test.js).
    const tool_requests = model === 'mock-debate-tool-request'
      ? [{ tool: 'check_versions', args: {} }, { tool: 'exec_shell', args: { cmd: 'rm -rf /' } }]
      : undefined;
    return { text: JSON.stringify({ posts, revisions: [], tool_requests }), usage: { input: 30, output: 30 }, provider: 'mock', model };
  }
  if (system.startsWith('You are one lab on a planning panel, answering')) {
    await new Promise(r => setTimeout(r, 10));
    const ids = [...user.matchAll(/^## ([A-Z]-\d+) \(by/gm)].map(m => m[1]);
    const replies = ids.map((id, i) => i === 0 ? { id, action: 'amend', text: 'Fair.', how: 'mock.js (amended)' } : { id, action: 'keep', text: 'The file is created by the plan.' });
    return { text: JSON.stringify({ replies }), usage: { input: 30, output: 20 }, provider: 'mock', model };
  }
  // v4 item 2: the preflight stage's mock seats. `mock-preflight-object` always objects (one
  // fixed objection); every other model on this prompt passes with no objections - so a test
  // only has to name the seat that should object, not every seat.
  // The final security-review gate's mock seats (src/security-review.js). `mock-security-block`
  // reports one high finding (blocks), `mock-security-low` says "fail" with one low finding (does
  // not block), `mock-security-cannot-judge` returns the non-verdict; every other model passes
  // clean. Unreadable and unreachable reviewers reuse mock-unreadable / mock-network-error above.
  if (system.startsWith('You are the final security reviewer of a finished build')) {
    await new Promise(r => setTimeout(r, 10));
    const finding = (severity, category) => ({ severity, category, file: 'src/db.js', line: 42, evidence: 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)', problem: 'mock: user input is interpolated into SQL.' });
    const reply = model === 'mock-security-block' ? { verdict: 'fail', findings: [finding('high', 'injection')] }
      : model === 'mock-security-low' ? { verdict: 'fail', findings: [finding('low', 'other')] }
      : model === 'mock-security-cannot-judge' ? { verdict: 'could_not_judge', reason: 'mock: the deliverable contains no diff to review.', findings: [] }
      : { verdict: 'pass', findings: [] };
    return { text: JSON.stringify(reply), usage: { input: 20, output: 15 }, provider: 'mock', model };
  }
  if (system.startsWith('You review a task description before any code change is proposed against it')) {
    await new Promise(r => setTimeout(r, 10));
    const text = model === 'mock-preflight-object'
      ? JSON.stringify({ verdict: 'object', objections: ['mock: the task description contradicts itself'] })
      : JSON.stringify({ verdict: 'pass', objections: [] });
    return { text, usage: { input: 15, output: 10 }, provider: 'mock', model };
  }
  if (system.startsWith('You are the proposer, answering one question')) {
    await new Promise(r => setTimeout(r, 10));
    const text = '"The artifact" refers to the deliverable itself, as stated in the draft.';
    return { text, usage: { input: 20, output: 15 }, provider: 'mock', model };
  }
  if (system.startsWith('You write the handoff file')) {
    await new Promise(r => setTimeout(r, 10));
    return { text: 'MOCK HANDOFF\n\nRead the plan. Start with "begin".', usage: { input: 30, output: 10 }, provider: 'mock', model };
  }
  // Item 5's ambiguity-union stage. Three fixed model names, each returning two
  // ambiguities with exactly one pairwise overlap, so a test wiring all three
  // into one mock chain gets a known union: three unique entries after dedup.
  // Any other mock model name on this prompt returns an empty list rather than
  // failing, so a chain that only seats one or two of these still runs.
  if (system.startsWith('You read a raw request, before anything has been proposed')) {
    await new Promise(r => setTimeout(r, 10));
    const table = {
      'mock-ambiguity-a': ['Is the deliverable code or prose?', 'Should assumption X default to A?'],
      'mock-ambiguity-b': ['Is the deliverable code or prose?', 'What audience is this for?'],
      'mock-ambiguity-c': ['Should assumption X default to A?', 'What audience is this for?'],
    };
    return { text: JSON.stringify({ ambiguities: table[model] || [] }), usage: { input: 20, output: 20 }, provider: 'mock', model };
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
  // The post-signoff challenge stage (v7 item 5). `mock-challenge-yes` raises
  // the one challenge the mechanism allows; every other model declines, so a
  // scripted test can exercise both branches offline.
  if (system.startsWith('You are the challenger in a multi-model review chain')) {
    await new Promise(r => setTimeout(r, 10));
    const text = model === 'mock-challenge-yes'
      ? JSON.stringify({
          challenge: true,
          decision: 'The deliverable states the assumptions it was written under.',
          evidence: 'Re-read the draft\'s "Assumptions" section and check it names a concrete reading, not a placeholder.',
        })
      : JSON.stringify({ challenge: false });
    return { text, usage: { input: 20, output: 15 }, provider: 'mock', model };
  }
  // Cold-reader coherence check (harness features v6 item A/6). `mock-cold-read-yes`
  // reports one contradiction; every other model reports none, so a scripted test can
  // exercise both branches offline.
  if (system.startsWith('You are a cold reader.')) {
    await new Promise(r => setTimeout(r, 10));
    // mock-cold-read-echo reports the exact user prompt it received back inside the reply
    // (a field the chain-side normalizer ignores), letting a test assert on the actual
    // invocation payload rather than inferring isolation from code shape alone.
    const text = model === 'mock-cold-read-yes'
      ? JSON.stringify({ raised: true, contradictions: [{ sections: ['A'], note: 'x' }] })
      : model === 'mock-cold-read-echo'
      ? JSON.stringify({ raised: false, contradictions: [], _receivedUser: user })
      : JSON.stringify({ raised: false, contradictions: [] });
    return { text, usage: { input: 20, output: 15 }, provider: 'mock', model };
  }
  // v7.x: claim extraction (src/claims.js). `mock-claims-bad-quote` always returns a quote that
  // is not actually in the draft, exercising validateEvidence's drop-and-warn path offline;
  // every other model returns one honest "reasoning" claim per objection it was handed.
  if (system.startsWith('You restate a list of objections as typed claims')) {
    await new Promise(r => setTimeout(r, 10));
    const problems = [...user.matchAll(/^\d+\. Criterion: (.*)$/gm)].map(m => m[1]);
    const claims = model === 'mock-claims-bad-quote'
      ? problems.map(c => ({ claim: `The draft fails "${c}".`, evidence: { kind: 'quote', quote: 'this exact phrase is not in the draft, guaranteed' } }))
      : problems.map(c => ({ claim: `The draft fails "${c}".`, evidence: { kind: 'reasoning' } }));
    return { text: JSON.stringify({ claims }), usage: { input: 20, output: 20 }, provider: 'mock', model };
  }
  // v7 §3, descending rounds: the builder for one frozen stage.
  if (system.startsWith('You are building one frozen stage')) {
    await new Promise(r => setTimeout(r, 10));
    const stageMatch = user.match(/# Stage to build now: (\S+)/);
    const stage = stageMatch ? stageMatch[1] : 'stage';
    return { text: `MOCK ${stage.toUpperCase()} STAGE for model ${model}.`, usage: { input: 20, output: 20 }, provider: 'mock', model };
  }
  // v7 §3, descending rounds: a critic reviewing the current (unfrozen) stage.
  // `mock-descending-amend-frozen` always tries to amend "plan" regardless of
  // which stage is actually open - the scripted misbehaviour the offline test
  // uses to exercise the executor-level rejection of amendments to a frozen
  // stage (src/chain.js's descending executor, not this prompt).
  if (system.startsWith('You are reviewing one stage in a descending-rounds plan')) {
    await new Promise(r => setTimeout(r, 10));
    const text = model === 'mock-descending-amend-frozen'
      ? JSON.stringify({ amend: { target: 'plan', text: 'Rewrite the frozen plan to add a new system.' } })
      : JSON.stringify({ amend: null });
    return { text, usage: { input: 20, output: 10 }, provider: 'mock', model };
  }
  const isReviser = system.startsWith('You are the builder in a multi-model review chain,\nrevising');
  const isCritic = !isReviser && system.startsWith('You are an independent critic');
  const isCriteria = system.includes('turn a request into acceptance criteria');
  // v7 item 4 (debate freedoms, scoped): `mock-critic-blocking` asks one blocking question on
  // its first reply, then signs off once the prompt carries the proposer's answer back to it -
  // exercises the pause/resume round trip offline. `mock-critic-passer` always passes with a
  // stated reason instead of judging, exercising the pass path. Both are only ever seated in
  // chains/tests that opt into `freedoms`; the mock does not gate on the flag itself, since the
  // chain-side gating (whether these fields are even read) is what the tests are pinning.
  if (isCritic && model === 'mock-critic-blocking') {
    await new Promise(r => setTimeout(r, 10));
    const answered = user.includes('# Answer to your blocking question');
    const text = answered
      ? JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'Answered; all criteria met.' })
      : JSON.stringify({ blocking_question: 'What does "the artifact" refer to in criterion 1?' });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  if (isCritic && model === 'mock-critic-passer') {
    await new Promise(r => setTimeout(r, 10));
    const text = JSON.stringify({ pass: true, pass_reason: 'Outside my domain expertise; deferring to the rest of the panel.' });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // MLLM Coder v1, IN-3 (relay/runs/2026-09-14T16-14-10-757Z/deliverable.md): unlike the other
  // scripted critics above, this one actually reads the rendered ground-truth block in its own
  // prompt (config.verify.enabled splices it into `request`, which flows into every stage's
  // prompt - see renderGroundTruth in chain.js) and fails when it sees a failing run_tests
  // result, passes when it sees a passing one. Needed because every other mock critic is
  // scripted purely by model name and ignores prompt content entirely, which can't prove the
  // verify-stage wiring's acceptance test: that a REAL failing test's output reaching
  // ground_truth is what blocks signoff, not an unrelated always-fail fixture.
  if (isCritic && model === 'mock-critic-verify-aware') {
    await new Promise(r => setTimeout(r, 10));
    const groundTruthBlock = (user.match(/# Ground truth \(tool output, verbatim\)\n([\s\S]*)/) || [])[1] || '';
    const failed = /"ok":\s*false/.test(groundTruthBlock);
    const text = JSON.stringify(failed
      ? { meets: false, criteria: [], failures: [{ criterion: 'The named test_command passes against the applied diff.', problem: 'ground_truth shows run_tests exited non-zero.', fix: 'Fix the diff so the named test passes.' }], verdict_line: 'run_tests failed in ground_truth.' }
      : { meets: true, criteria: [], failures: [], verdict_line: 'run_tests passed in ground_truth.' });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
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
    // v7.3: the allocator's own targeted-round prompt (src/chain.js) always names the split
    // explicitly ("The panel split on this criterion..."), a marker no other reviser call ever
    // sends - lets a scripted reviser distinguish an allocator round from the uniform union
    // revise it follows, so a test can assert the draft actually changed (engaged) rather than
    // the mock always returning identical text regardless of input.
    // `mock-reviser-stubborn` deliberately never applies the fix, even on an
    // allocator round - stands in for a reviser that rubber-stamps a
    // targeted round rather than actually engaging with it.
    const allocatorFix = isReviser && model !== 'mock-reviser-stubborn' && user.includes('The panel split on this criterion this round')
      ? '\n\nAllocator fix applied to the contested criterion.'
      : '';
    text = `${isReviser ? 'REVISED ' : ''}MOCK DELIVERABLE for model ${model}\n\nBody text.${isReviser ? '\n\nAssumptions: none.' : ''}${ledger}${declineTrailer}${allocatorFix}`;
  }
  await new Promise(r => setTimeout(r, 10));
  return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
}

// A sentinel, not a real credential - never sent as a header value (callOpenAICompat checks the
// real env var itself before deciding whether to send Authorization at all). This only exists so
// checkSeats()/cli.js's own truthy checks stop reading "no key needed" as "key missing" for a
// provider marked `optional` (currently just ollama).
const NO_KEY_REQUIRED = 'not-required (local)';

export function keyFor(provider) {
  if (provider === 'mock' || provider === 'external') return provider;
  const spec = provider === 'anthropic' ? ANTHROPIC : OPENAI_COMPAT[provider];
  if (!spec) throw new Error(`Unknown provider: ${provider}`);
  return process.env[spec.key] || (spec.optional ? NO_KEY_REQUIRED : null);
}

export function providerNames() {
  return ['anthropic', ...Object.keys(OPENAI_COMPAT)];
}

// Local-model providers (currently just ollama) price at $0 by construction, not by a
// per-model pricing.json entry - see the ollama spec's comment for why an entry can't work here.
export function isFreeProvider(provider) {
  return OPENAI_COMPAT[provider]?.free === true;
}

// A provider that runs with no key at all (currently just ollama) - `council doctor`/`init` use
// this to print "not required" instead of a scary "not set" for a seat that was never going to
// need one.
export function isKeyOptional(provider) {
  return OPENAI_COMPAT[provider]?.optional === true;
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

async function callOpenAICompat(provider, { model, system, messages, maxTokens, temperature, extra, baseUrl }) {
  const spec = OPENAI_COMPAT[provider];
  // The real env var, not keyFor()'s sentinel - a provider marked `optional` (ollama) is called
  // with no Authorization header at all when no key is set, rather than sending the sentinel
  // string as a fake bearer token.
  const realKey = process.env[spec.key] || null;
  if (!realKey && !spec.optional) throw new Error(`${spec.key} not set`);
  // `baseUrl` is a per-seat override (chain.js's invoke() forwards seat.baseUrl here), never part
  // of the request body - LM Studio, a remote Ollama box, or any other OpenAI-compatible local
  // runner listens on a different host/port than the provider's own default.
  const base = baseUrl || spec.base;
  const json = await post(
    `${base}/chat/completions`,
    realKey ? { authorization: `Bearer ${realKey}` } : {},
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
    // v3 §Item 3: a provider-array fallback (`extra.models`) can answer with a model other
    // than the one requested - `json.model` is the response's own record of which model
    // actually answered, and takes priority. Falls back to the requested `model` only when
    // the response carries none, so a response shape lacking `model` is byte-identical to
    // today.
    model: json.model ?? model,
  };
}

export async function call(provider, opts) {
  if (provider === 'mock') return callMock(opts);
  if (provider === 'external') throw new Error('external seats are answered by writing <label>.md into the run folder, never called');
  if (provider === 'anthropic') return callAnthropic(opts);
  if (OPENAI_COMPAT[provider]) return callOpenAICompat(provider, opts);
  throw new Error(`Unknown provider: ${provider}`);
}
