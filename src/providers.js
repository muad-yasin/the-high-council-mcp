// Provider adapters. One shape in, one shape out.
//
//   call({ model, system, messages, maxTokens, temperature })
//     -> { text, usage: { input, output }, provider, model }
//
// Anthropic uses its own Messages API. Everything else here speaks the
// OpenAI chat-completions shape, which is why they share one adapter.

import { billedFactsOf } from './billed-facts.js';
import { existsSync } from 'node:fs'; // only for the COUNCIL_MOCK_HOLD_FILE test seam (holdMockCall)
import { objectionId } from './objection-ids.js';
import { idsFromPrompt } from './verdict-envelope.js';
import { maskUrlUserinfo } from './secret-patterns.js';
import { demoReply } from './mock-demo.js';

const OPENAI_COMPAT = {
  openai:   { base: 'https://api.openai.com/v1',                 key: 'OPENAI_API_KEY' },
  google:   { base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'GOOGLE_API_KEY' },
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
import { withoutNativeHigh, hasOwnNativeReasoning } from './reasoning.js';
import { keyEnvValue, keySource, keyProblem, MALFORMED_KEY_HINT } from './key-env.js';

export const VENDOR_MODEL_MAPS = {
  openrouter: {
    'anthropic:claude-opus-5': 'anthropic/claude-opus-5',
    'anthropic:claude-sonnet-5': 'anthropic/claude-sonnet-5',
    'anthropic:claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4.5',
    // 0.8.4 the Claude route (src/claude-route.js): the Claude models the shipped chains and the default security reviewer seat, under OpenRouter's own ids (dots where Anthropic's ids have hyphens). Each target has a price row, a reasoning row and,
    // but for the default reviewer's Fable 5.1, a window row (src/context-window.js falls back to the direct model's row for that one).
    'anthropic:claude-opus-5-5': 'anthropic/claude-opus-5.5',
    'anthropic:claude-sonnet-5-5': 'anthropic/claude-sonnet-5.5',
    'anthropic:claude-haiku-5-5': 'anthropic/claude-haiku-5.5',
    'anthropic:claude-fable-5-1': 'anthropic/claude-fable-5.1',
    'anthropic:claude-fable-5-2': 'anthropic/claude-fable-5.2',
    'openai:gpt-5': 'openai/gpt-5',
    'openai:gpt-5-mini': 'openai/gpt-5-mini',
    'openai:gpt-5-nano': 'openai/gpt-5-nano',
    'google:gemini-3.6-flash': 'google/gemini-3.6-flash',
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
  // IDEMPOTENT (0.8.4, the Claude route): a seat this function has already rewritten (it carries `originalProvider`, which only this function writes) and that now sits on the transport comes back as it is. The config is resolved once by the
  // command line and again by runChain; a seat-level `transport` stays on the seat, so without this the second pass looked up "openrouter:anthropic/..." and threw "no route". The marker is required, not just provider === transport: a seat the person
  // seated on OpenRouter themselves has no originalProvider and still goes through its identity row (extraWithoutNativeHigh, originalProvider) exactly as before.
  if (seat.originalProvider !== undefined && seat.provider === transport) return seat;
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
  // 0.8.1 milestone R: a shipped chain says "high" in its seat's own provider's words (Anthropic: output_config.effort; OpenAI: reasoning_effort).
  // Those words mean nothing on the vendor's wire, so they are dropped here and the harness default writes the vendor's own form
  // (OpenRouter: reasoning.effort) after this rewrite, in invoke(). Only a field equal to the table's own "high" is dropped; a seat's other
  // fields, and any setting of its own that is not that exact high (even a lower one), go through as they always did.
  // A seat's own reasoning field that is not the table's exact high (a lower setting, or a higher one) is kept, and no vendor default is added beside it.
  return { ...seat, provider: transport, model: vendorModel, lab, originalProvider: seat.provider, ...extraWithoutNativeHigh(seat), ...(hasOwnNativeReasoning(seat) ? { keepOwnReasoning: true } : {}) };
}

// An offline provider used to test the chain's plumbing without spending
// anything. It fakes a builder and a critic well enough to exercise every
// branch, including the early stop.
// mock-draft-error-once: prompts it has already failed once (M4 tests).
const MOCK_DRAFT_ERROR_SEEN = new Set();

// 0.8.3 M6 S5b (C&C ruling 3, 12 Oct; test/mock-plan-placeholder.test.js): TEST-ONLY seats whose builder AND reviser text carries a placeholder an input scan reads, under the `## Overview` heading the shared split fixture's provider_refs name, so a
// provider child's plan can reach a consumer's bundle and the registration pre-check of a tree can be shown the same text a run's input scan reads. `-url`: a password in a URL on a real-looking host (refused); `-url-localhost`: the same on a
// reserved placeholder host (registers); `-url-lookalike`: on a look-alike of one (refused); `-email`: an address on a real-looking domain (the PII gate). The text is ASSEMBLED HERE FROM PARTS and never held as one literal: this repo is public and its
// own scanners read it (the test scans this file). Only a chain that names one of these models gets the section; every other mock reply is unchanged.
const PLACEHOLDER_URL = host => ['postgres', '://user:', 'pass', '@', host, '/db'].join('');
const PLACEHOLDER_PLAN = Object.freeze({
  'mock-plan-placeholder-url': `The service reads its settings from ${PLACEHOLDER_URL(['db', 'internal'].join('.'))}.`,
  'mock-plan-placeholder-url-localhost': `The service reads its settings from ${PLACEHOLDER_URL(['local', 'host'].join(''))}.`,
  'mock-plan-placeholder-url-lookalike': `The service reads its settings from ${PLACEHOLDER_URL(['local', 'host', 'evil', 'com'].join('.'))}.`,
  'mock-plan-placeholder-email': `Questions about this plan go to ${['jane.doe', '@', 'mail-corp', '.de'].join('')}.`,
});

// B3 prep (JUDGE lane, unit 2; test-only): the severity a `mock-exch-*` judge writes on its objection, from a `-sev<value>` suffix of its model string: `-sev6p5` = 6.5, `-sev9` = 9, `-sevnone` = no severity field, `-sevword` = the word "high".
// The value comes from the model string and never from the prompt's wording. No suffix, no field: every other mock judge is unchanged.
// M1 (S19) - the G1 EXCEPTION (the judge-state table's point G1: the rating demand and the strict refusal travel together, so the mock must rate once the prompt demands it; the mock route is the builder's pick, named in the S19 report) to the rule above, and the only one: once the prompt carries the rating demand (the held word `ratingDemand` recorded or injected: the critic and final-read system text says "carries a severity: a number from 1 to 10", the exchange post system text says "Give each new objection a severity from 1 to 10"), a mock judge with NO `-sev` suffix writes a rating of 5 on each objection it writes, as a judge told to rate would. While the demand is held, no prompt carries the sentence, so no existing test moves. A `-sev` suffix still wins (and `-sevnone` still writes none).
const mockDemandIn = system => /carries a severity: a number from 1 to 10|Give each new objection a severity from 1 to 10/.test(String(system ?? ''));
const mockSeverityOf = (model, ask = 0, system = '') => {
  const m = /-sev((?:none|word|\d+(?:p\d+)?)(?:then(?:none|word|\d+(?:p\d+)?))*)(?:-|$)/.exec(model); if (!m) return mockDemandIn(system) ? { severity: 5 } : {};
  const steps = m[1].split('then'); const v = steps[Math.min(ask, steps.length - 1)];   // `-sev9then3`, `-sevnonethen6then2` (unit 3, test-only): the Nth ask of this model string in the process uses the Nth step, the last step for every later ask; give each test its own model string, the counter lives in the process
  return v === 'none' ? {} : { severity: v === 'word' ? 'high' : Number(v.replace('p', '.')) };
};
// Asks so far per scripted-judge model string (`mock-critic-script-<pattern>[-suffix]`, below), in this process only.
const scriptedAsks = new Map();
const envelopeLastIds = new Map(); // the ids a scripted envelope judge saw on its previous ask (mode `p`), per model string
// The mock provider tells a judge's call from other calls by the judge prompt's own opening sentence. Since the Council introduction (JUDGE, B3 prep) opens the prompt, the sentence is no longer the first line: look for it at the start or at the start of any line.
// MOCK-ONLY: its only readers are the mock provider's role detection in callMock (the three checks below that name 'You are an independent critic') and echoEnvelopeIds, which wraps ONLY the mock provider's call (`echoEnvelopeIds(await callMock(opts), opts)`); no real-provider path reads it.
const isCriticSystem = system => /(^|\n)You are an independent critic/.test(String(system));
/**
 * E3b unit three, commit 1 (C&C ruling, 14 Oct 2026): once the "Reply identity" sentence is live, every critic prompt of a CLI run carries a review_id and a draft_id and a reply without them is unreadable. A mock
 * critic returns fixed JSON, so without this every offline mock chain (the shipped ones, `council init`, rematch/replay of them, the CLI tests) would read as unheard at M7. So a critic's reply that is ONE whole JSON
 * object gets the two ids added when its prompt carries them (idsFromPrompt, unit one's last-match rule: the only reader of the ids). INERT today: prompts carry no ids until the sentence is live, so every reply is
 * byte-identical. NOT touched: a reply that is not one whole object (the cut-off families), one the provider ended with an error or the cap (`stop` error / length), the other roles, and the scripted envelope seats
 * (mock-critic-envelope-*), which decide for themselves and stay the ONLY way to drive "no ids" through the real path.
 */
function echoEnvelopeIds(res, { model, system, messages }) {
  if (!res || typeof res.text !== 'string' || !isCriticSystem(mockSystemSeeingInstructions(system, messages.map(m => m.content).join('\n')))) return res;   // the instructions stand in the user text under the cache-shaped order (prompt_cache): read them where callMock reads them
  if (model.startsWith('mock-critic-envelope-') || res.usage?.stop === 'length' || res.usage?.stop === 'error') return res;
  const ids = idsFromPrompt(messages.map(m => m.content).join('\n'));
  if (!ids) return res;
  let obj;
  try { obj = JSON.parse(res.text); } catch { return res; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return res;
  return { ...res, text: JSON.stringify({ ...ids, ...obj }) };
}

// The text of the draft under review in a prompt a mock seat was sent: what follows the "# Draft under review" heading, and, in the cache-shaped order (0.8.4 prompt cache), what follows the start line that frames the draft (DRAFT_START_LINE: the recorded start line of roles.js draftStartLine, copied here because this file must not import roles.js, test/no-digest-in-prompt-paths.test.js walks its imports; a change of that sentence turns the cache-order rows red by name), so a mock quote or first line is the plan's and never the framing sentence (test-only: the real seats read the prompt themselves).
const DRAFT_START_LINE = '[Start of the draft under review.]';
const draftBodyOf = user => { const after = String(user ?? '').split('# Draft under review\n\n')[1] || ''; const mark = DRAFT_START_LINE; const i = after.indexOf(mark); return i < 0 ? after : after.slice(i + mark.length).replace(/^\n+/, ''); };
/**
 * 0.8.4 S2 (W6, D18; the same pattern as echoEnvelopeIds): once the relation wording is recorded, every failure a judge writes must declare its `relation` and a reply whose failure has none is unreadable (src/chain.js, the
 * `held('relationRule')` gate). A mock critic returns fixed JSON, so without this every unanimous mock chain (mock-open, mock-debate, mock-unanimous and the rest) would read as unheard and could not pass offline. So a critic's
 * reply that is ONE whole JSON object with a `failures` list gets a relation on each failure that has none (`continues <id>` when the judge's own standing objection in its prompt says what the failure says, else `new`), when the prompt (its system text, or the user text where the cache-shaped order puts the instructions) carries
 * the relation sentence. INERT before the wording is recorded: no prompt carries the sentence, so every reply is byte-identical. NOT touched: a model whose name contains `-norelation` (the ONE mock that keeps omitting it, so
 * the refusal stays exercised offline: test/mock-relation.test.js), the scripted envelope seats (mock-critic-envelope-*), a reply that is not one whole object, one the provider ended with an error, and the other roles.
 */
const mockRelationIn = text => /set "relation" to one of/.test(String(text ?? ''));
// The id a mock judge's failure continues: the judge's OWN standing objections are listed in its prompt under "Your objections from the last round, and what happened" (one line each, `- <id>: <criterion> - <problem>`, the section the answer-back
// readers above parse too). A failure that says what one of those lines says is the same defect in a standing objection of this judge: `continues <id>`. Anything else is a first raise: `new`. Never another seat's id (only this section is read).
const mockOwnStanding = user => {
  const section = (String(user ?? '').split('# Your objections from the last round, and what happened')[1] || '').split('These passages of the draft changed')[0];
  return [...section.matchAll(/^- (O-[0-9a-f]{8}(?:#r?[0-9]+)?): (.*)$/gm)].map(m => ({ id: m[1], text: m[2].replace(/\s+/g, ' ').trim() }));
};
const mockRelationOf = (f, own) => {
  const want = `${String(f.criterion ?? '').replace(/\s+/g, ' ').trim()} - ${String(f.problem ?? '').replace(/\s+/g, ' ').trim()}`;
  const hit = own.find(o => o.text === want || o.text.startsWith(`${want} (you quoted: `));
  return hit ? `continues ${hit.id}` : 'new';
};
// The end (exclusive) of the JSON object a text STARTS with, -1 when it does not start with a whole one (string-aware brace count; nothing but white space may come before it).
function mockLeadingObjectEnd(text) {
  let depth = 0; let inStr = false; let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { if (depth === 0) return -1; inStr = true; } else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return i + 1; if (depth < 0) return -1; } else if (depth === 0 && !/\s/.test(c)) return -1;
  }
  return -1;
}
function echoRelation(res, { model, system, messages }) {
  const user = messages.map(m => m.content).join('\n');
  if (!res || typeof res.text !== 'string' || !isCriticSystem(mockSystemSeeingInstructions(system, user))) return res;   // as echoEnvelopeIds: the cache-shaped order puts the instructions in the user text
  if (/-norelation(-|$)/.test(model) || model.startsWith('mock-critic-envelope-') || res.usage?.stop === 'error') return res;   // a reply the cap cut that still parses is one a model wrote to the prompt: it carries its relations like any other (the cut test reads the stop reason, not the relation)
  if (!mockRelationIn(`${system}\n${user}`)) return res;
  let obj; let tail = '';
  try { obj = JSON.parse(res.text); } catch {
    // a reply the cap cut after a whole JSON object (the cut-off family: the object, then text the cap cut) still parses for the chain: the leading object gets its relations, the cut text is kept as it was
    const end = mockLeadingObjectEnd(res.text); if (end < 0) return res;
    try { obj = JSON.parse(res.text.slice(0, end)); } catch { return res; }
    tail = res.text.slice(end);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !Array.isArray(obj.failures)) return res;
  const bare = f => f && typeof f === 'object' && !Array.isArray(f) && (f.relation === undefined || f.relation === null || f.relation === '');
  if (!obj.failures.some(bare)) return res;
  const own = mockOwnStanding(user);
  return { ...res, text: JSON.stringify({ ...obj, failures: obj.failures.map(f => (bare(f) ? { ...f, relation: mockRelationOf(f, own) } : f)) }) + tail };
}

// 0.8.4 cache part (b)1 (src/cache-order.js): in the cache-shaped prompt order a judge's instructions stand in the USER text, under the lead-in, and the system text is the welcome alone. The mock decides what kind of call it is from those
// instructions, so it reads them from there too: the instructions are appended to the system text it looks at. MOCK ONLY. src/cache-order.js registers the finder (this file imports nothing of the prompt words: a test pins that the
// import graph of src/dissent-digest.js never reaches src/roles.js). No finder, or none in the user text: the system text, unchanged.
let mockInstructionsAt = null;
export function setMockInstructionsFinder(fn) { mockInstructionsAt = typeof fn === 'function' ? fn : null; }
function mockSystemSeeingInstructions(system, user) {
  const at = mockInstructionsAt ? mockInstructionsAt(user) : -1;
  return at >= 0 ? `${system}\n\n${user.slice(at)}` : system;
}

async function callMock({ model, system: sentSystem, messages, maxTokens }) {
  const user = messages.map(m => m.content).join('\n');
  const system = mockSystemSeeingInstructions(sentSystem, user);
  // `council demo`'s scripted scenario (src/mock-demo.js): realistic text for every stage the
  // demo chain runs. Returns null for a stage it has no script for, which falls through below.
  if (model.startsWith('mock-demo-')) {
    const demo = demoReply({ model, system, user });
    if (demo) {
      await new Promise(r => setTimeout(r, 10));
      return demo;
    }
  }
  // 0.8.2 item 6d (test/contract-draft.test.js): a handoff seat that drafts a contract from the criteria its prompt lists as `C1.` lines, one obligation per line, so a test proves the criteria reached the seat
  // (no criteria lines, no obligations, and the lint refuses the empty draft). `-bad` adds a field named like an identity field, which the lint must refuse. Only that test names them, so no pinned mock chain changes.
  // 0.8.2 (test/contract-draft.test.js): a draft that names a criterion no matter what it was shown - what a model that invents a label would write.
  if (model === 'mock-contract-draft-invented') {
    await new Promise(r => setTimeout(r, 10));
    const text = JSON.stringify({ obligations: [{ id: 'O1', text: 'Build the whole plan.', criterion: 'C1' }] });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  if (model === 'mock-contract-draft' || model === 'mock-contract-draft-bad') {
    await new Promise(r => setTimeout(r, 10));
    const seenNo = new Set(); // the recorded prompt's handoff section can repeat the criteria (its lock block): one obligation per criterion number
    const lines = [...user.matchAll(/^C(\d+)\. (.+)$/gm)].filter(m => !seenNo.has(m[1]) && seenNo.add(m[1]));
    const obligations = lines.map(m => ({ id: `O${m[1]}`, text: `Satisfy: ${m[2]}`, criterion: `C${m[1]}`, check: `a person reads the plan against criterion C${m[1]}` }));
    const text = JSON.stringify(model === 'mock-contract-draft-bad' ? { obligations, version: 7 } : { obligations });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // A critic whose reply can't be parsed - stands in for a real reply cut
  // off at the token cap. Exercises the abstention path offline.
  if (model === 'mock-unreadable' || model === 'mock-critic-silent') {   // 0.8.4 (ladder unit): `mock-critic-silent` is a judge that never answers (the same reply as mock-unreadable, named for the silent-judge rows)
    await new Promise(r => setTimeout(r, 10));
    return { text: 'Looks fine to me. (no JSON)', usage: { input: 10, output: 8 }, provider: 'mock', model };
  }
  // 2 Nov 2026 (near-JSON pause, src/near-json.js; C&C's ruling: no pause ships untested): a judge whose reply is a verdict that is ALMOST JSON - its `failures` array is opened and never closed, so a `}` arrives while a `[` is open
  // deeper and nothing repairs it - and that is NOT cut off (no stop reason, a few tokens). It carries the two ids when its prompt shows them (idsFromPrompt), as an echoing judge does. Exercises the pause for a repair offline.
  if (model === 'mock-near-json') {
    const ids = idsFromPrompt(user);
    const text = `{${ids ? `"review_id": "${ids.review_id}", "draft_id": "${ids.draft_id}", ` : ''}"meets": true, "criteria": [], "failures": [ "verdict_line": "All criteria met."}`;
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // 3 Nov 2026 (the dropped-key rule, src/chain.js KEY_DIRECTLY_AFTER; B3 run 5, pass 24, Haiku 5.5): a judge whose verdict is closed one `}` too early, after its criteria list, so its "failures" key and the
  // rest follow OUTSIDE the object (the shape a span reader once took as a sign-off, failures lost). Not cut off (no stop reason, a few tokens). It carries the two ids when its prompt shows them (idsFromPrompt).
  if (model === 'mock-early-closer') {
    const ids = idsFromPrompt(user);
    const text = `{${ids ? `"review_id": "${ids.review_id}", "draft_id": "${ids.draft_id}", ` : ''}"meets": true, "criteria": []}, "failures": [{"criterion": "It exists.", "problem": "The draft stops in the middle of a step.", "fix": "Finish the step."}], "verdict_line": "One criterion is not met."}`;
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // 3 Nov 2026 (row matching by position, src/criteria-ledger.js): a judge that signs off with a COMPLETE table in list order whose criterion texts are retyped: the first word of each criterion is replaced (a
  // substitution, which today's text match refuses: it takes a contained text or up to two dropped words, not a changed one). Its rows are read from the prompt's numbered "# Acceptance criteria" list. One whole
  // JSON object, so the ids are added when the prompt carries them (echoEnvelopeIds).
  if (model === 'mock-retyped-table') {
    const listed = (/# Acceptance criteria\n\n([\s\S]*?)(?:\n\n|$)/.exec(user)?.[1] ?? '').split('\n').map(l => /^\d+\. (.+)$/.exec(l)?.[1]).filter(Boolean);
    const criteria = listed.map(c => ({ criterion: c.replace(/^\S+/, 'Restated'), verdict: 'MET', evidence: 'The draft covers it.' }));
    const text = JSON.stringify({ meets: true, criteria, failures: [], verdict_line: 'All criteria met.' });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
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
  // 0.8.4 S16 (H3): `mock-size-refusal-<N>` is a judge whose provider refuses a prompt longer than N characters (system plus user) with the documented size refusal (HTTP 400, error_type context_length_exceeded, before any generation: nothing is billed),
  // and signs off on a shorter one. Exercises the final read's halving offline.
  { const m = /^mock-size-refusal-(\d+)$/.exec(model);
    if (m) {
      await new Promise(r => setTimeout(r, 10));
      if (sentSystem.length + user.length > Number(m[1])) throw Object.assign(new Error('HTTP 400 {"error":{"code":400,"message":"mock: the prompt is longer than the context window","metadata":{"error_type":"context_length_exceeded"}}}'), { status: 400, errorType: 'context_length_exceeded', failureHost: 'mock' });
      const text = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.', sorting: [] });
      return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
    } }
  if (model === 'mock-network-error') {
    await new Promise(r => setTimeout(r, 10));
    throw new Error('mock: provider unreachable (simulated network failure)');
  }
  // Whole alternative architectures (the `alternatives` stage). `mock-alt-empty` never produces a
  // readable alternative (exercises the retry and the dropout record); `mock-alt-withdraw`
  // withdraws its own architecture in the reply round in favour of the first one it was told
  // about. Every other model writes one architecture named after itself, objects to the first
  // other alternative it reads and supports the rest, and amends when objected to.
  if (system.startsWith('You are an architect on a planning panel.')) {
    await new Promise(r => setTimeout(r, 10));
    // Pre-release audit 2026-09-23 (Alternatives #1): a reasoning seat whose alternative is cut
    // off at the token cap. `mock-alt-cut` is cut off at any cap; `mock-alt-cut-then-fits` is cut
    // off only at a cap of 3000 or less - the old fixed stage cap - so a seat keeping its own
    // bigger cap, or the bigger-cap retry, gets the architecture through.
    if (model === 'mock-alt-cut' || (model === 'mock-alt-cut-then-fits' && maxTokens <= 3000)) {
      return { text: '{"name": "Event-sourced core", "shape": "one append-only log feeding', usage: { input: 20, output: maxTokens ?? 8000, stop: 'length' }, provider: 'mock', model };
    }
    const text = model === 'mock-alt-empty'
      ? 'I would rather not pick one.'
      : JSON.stringify({ name: `Architecture from ${model}`, shape: `mock shape: one service per concern (${model})`, key_tradeoffs: 'mock: simple to build, slow to change.', bad_at: 'mock: high write volume.' });
    return { text, usage: { input: 20, output: 30 }, provider: 'mock', model };
  }
  if (system.startsWith('You are one lab on an architecture panel. Every lab proposed')) {
    await new Promise(r => setTimeout(r, 10));
    const mineIdx = user.indexOf("# The other labs' alternatives");
    const theirs = [...user.matchAll(/^## ([A-Z]-ALT) \(by Lab [A-Z]\)/gm)].filter(m => m.index > mineIdx).map(m => m[1]);
    const posts = theirs.map((id, i) => ({ on: id, stance: i === 0 ? 'object' : 'support', text: i === 0 ? (model === 'mock-alt-unquoting' ? 'It cannot meet the latency bar.' : 'Quote: "one service per concern" - it cannot meet the latency bar.') : 'Sound for this request.' }));
    return { text: JSON.stringify({ posts }), usage: { input: 30, output: 30 }, provider: 'mock', model };
  }
  if (system.startsWith('You are one lab on an architecture panel, answering')) {
    await new Promise(r => setTimeout(r, 10));
    const id = (user.match(/^## ([A-Z]-ALT) \(by/m) || [])[1];
    const replies = !id ? [] : model === 'mock-alt-withdraw'
      ? [{ id, action: 'withdraw', text: 'The objection is right.' }]
      : [{ id, action: 'amend', text: 'Fair on latency.', shape: 'mock shape (amended): one service per concern, with a read cache' }];
    return { text: JSON.stringify({ replies }), usage: { input: 30, output: 20 }, provider: 'mock', model };
  }
  if (system.startsWith('You are a proposer')) {
    await new Promise(r => setTimeout(r, 10));
    // Bug audit 2026-09-28 (area 2 #1): a reasoning proposer that fills a small cap with thinking.
    // Cut off (all output reasoning, empty text) at a cap of 2000 or less, a normal proposal above it.
    if (model === 'mock-proposer-cut-then-fits' && (maxTokens ?? 8000) <= 2000) {
      return { text: '', usage: { input: 20, output: maxTokens, thinking: maxTokens, stop: 'length' }, provider: 'mock', model };
    }
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
  // Bug audit 2026-09-28 (area 2 #2): a lab whose debate post and reply round the provider ends
  // with stop "error". `mock-proposer-error` always; `mock-proposer-error-once` only the first time
  // it sees a given prompt, so the one retry gets a normal reply. Proposals are ordinary.
  if ((model === 'mock-proposer-error' || model === 'mock-proposer-error-once')
      && (system.startsWith('You are one lab on a planning panel. Every lab proposed') || system.startsWith('You are one lab on a planning panel, answering'))
      && (model === 'mock-proposer-error' || !MOCK_DRAFT_ERROR_SEEN.has(`${model}:${user}`))) {
    MOCK_DRAFT_ERROR_SEEN.add(`${model}:${user}`);
    await new Promise(r => setTimeout(r, 10));
    return { text: '', usage: { input: 0, output: 0, stop: 'error' }, provider: 'mock', model };
  }
  if (system.startsWith('You are one lab on a planning panel. Every lab proposed')) {
    await new Promise(r => setTimeout(r, 10));
    const others = [...user.matchAll(/^## ([A-Z]-\d+) \(by Lab [A-Z]\)/gm)].map(m => m[1]);
    const mineIdx = user.indexOf('# The other labs');
    const theirs = others.filter(id => user.indexOf(`## ${id} `) > mineIdx);
    // 0.8.2: `mock-proposer-xref` (test/debate-order.test.js) cites ANOTHER proposal and its lab by the anonymised names in its own prompt, at the START of its objections - the cross-reference
    // a shuffled debate must re-letter for every reader. Only that test uses it, so the pinned mock chains are unchanged. `mock-proposer-unquoted` (audit fix cnc-prompts F1, test/held-door-4a.test.js) objects with no quote at all.
    const labOfId = Object.fromEntries([...user.matchAll(/^## ([A-Z]-\d+) \(by (Lab [A-Z])\)/gm)].map(m => [m[1], m[2]]));
    const cited = theirs[theirs.length - 1];
    const posts = theirs.map((id, i) => ({ on: id, stance: i % 2 ? 'support' : 'object', text: i % 2 ? 'Fine as written.' : model === 'mock-proposer-xref' ? `${cited} (${labOfId[cited]}) is cited here: \"mock.js\" - no such file exists.` : model === 'mock-proposer-unquoted' ? 'It will not scale.' : 'Quote: "mock.js" - no such file exists.' }));
    // 0.7.8 debate.dropped fixtures (test/debate-dropped.test.js): a seat whose posts the stage's
    // filter must reject, one of each kind, next to its valid ones; and a seat whose reply is not JSON.
    if (model === 'mock-proposer-garbled') return { text: 'Several thoughts on these proposals, and no JSON at all.', usage: { input: 30, output: 10 }, provider: 'mock', model };
    if (model === 'mock-proposer-sloppy') {
      const mine = others.filter(id => user.indexOf(`## ${id} `) < mineIdx);
      posts.push({ on: 'Z-99', stance: 'object', text: 'No such proposal.' },
        ...(mine.length ? [{ on: mine[0], stance: 'support', text: 'Praising my own.' }] : []),
        ...(theirs.length ? [{ on: theirs[0], stance: 'maybe', text: 'Not a stance.' }] : []));
    }
    // v7.x item 3 test fixture: a debate seat that asks for bounded, allowlisted tool calls in
    // the same reply - one allowed request and one disallowed one, to exercise both branches of
    // runSeatToolRequests offline (test/seat-tool-calls.test.js).
    const tool_requests = model === 'mock-debate-tool-request'
      ? [{ tool: 'check_versions', args: {} }, { tool: 'exec_shell', args: { cmd: 'rm -rf /' } }]
      : undefined;
    // 0.8.4 D18 (test seam; test/text-requests-path.test.js): `mock-proposer-requests` also asks for text of the project in its debate reply.
    const text_requests = model.includes('mock-proposer-requests') ? [{ path: 'src/b.js', lines: '1-2', why: 'To see what the second file already says.' }] : undefined;
    return { text: JSON.stringify({ posts, revisions: [], tool_requests, text_requests }), usage: { input: 30, output: 30 }, provider: 'mock', model };
  }
  if (system.startsWith('You are one lab on a planning panel, answering')) {
    await new Promise(r => setTimeout(r, 10));
    const ids = [...user.matchAll(/^## ([A-Z]-\d+) \(by/gm)].map(m => m[1]);
    // Tiered councils (the majority guard): `mock-yield-unargued` withdraws everything without
    // naming the argument it concedes to, `mock-yield-argued` withdraws quoting the first objection
    // it was shown - so a guarded mock run records one withdrawal the guard keeps and one it honours.
    if (model === 'mock-yield-unargued' || model === 'mock-yield-argued' || model === 'mock-proposer-xref') {
      const objection = (user.match(/^- (?:Lab [A-Z] - )?object: (.+)$/m) || [])[1] || '';
      const replies = ids.map(id => ({ id, action: 'withdraw', text: 'The objection is right.', ...(model !== 'mock-yield-unargued' ? { conceded_to: objection.slice(0, 40) } : {}) }));
      // mock-proposer-xref also echoes the prompt it was given (a field the chain ignores), so a test can read what a reader was shown.
      return { text: JSON.stringify({ replies, ...(model === 'mock-proposer-xref' ? { _receivedUser: user } : {}) }), usage: { input: 30, output: 20 }, provider: 'mock', model };
    }
    const replies = ids.map((id, i) => i === 0 ? { id, action: 'amend', text: 'Fair.', how: 'mock.js (amended)' } : { id, action: 'keep', text: 'The file is created by the plan.' });
    if (model === 'mock-proposer-garbled') return { text: 'I stand by everything, but not in JSON.', usage: { input: 30, output: 10 }, provider: 'mock', model };
    if (model === 'mock-proposer-sloppy') replies.push({ id: 'Z-99', action: 'keep', text: 'No such proposal.' }, ...(ids.length ? [{ id: ids[0], action: 'shrug', text: 'Not an action.' }] : []));
    return { text: JSON.stringify({ replies }), usage: { input: 30, output: 20 }, provider: 'mock', model };
  }
  // Tiered councils: the deep-dive seat. One finding per call, quoting the plan's first line
  // exactly (so the quote check marks it verified) and naming the excerpt it read, so a mock run
  // shows one finding per chunk and focus. Usage scales with the prompt, so a priced mock seat
  // (mock-priced) reaches its own dollar cap offline.
  if (system.startsWith('You are the deep-dive reviewer')) {
    await new Promise(r => setTimeout(r, 10));
    const plan = (user.split('# The plan\n\n')[1] || '').split('\n').find(l => l.trim()) || '';
    const excerpt = (user.match(/# Source excerpt (\d+) of (\d+)/) || []).slice(1).join(' of ');
    const focus = ((user.split('# Focus\n\n')[1] || '').split('\n')[0] || '').slice(0, 60);
    const text = JSON.stringify({ findings: [{ criterion: `source excerpt ${excerpt}`, quote: plan.trim().slice(0, 30), source_quote: '', problem: `mock: excerpt ${excerpt} is not reflected in the plan (focus: ${focus}).`, fix: 'mock: add one line for it.' }] });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // The council advisor (src/advise.js). Blind opinions: the model name sets the verdict
  // (`mock-advisor-proceed|change|stop|need-info`; `mock-advisor-fakequote` is "change" with a risk
  // quote that is not in the brief; every other model, mock-priced included, says "proceed"), and each
  // risk quotes the brief's first line, so the quote check marks it verified. Usage scales with the
  // prompt so a priced mock seat reaches the advise ceiling offline.
  if (system.startsWith('You are one advisor on a council. Someone')) {
    await new Promise(r => setTimeout(r, 10));
    // A brief carrying TRIGGER_ADVISOR_UNREADABLE gets prose back from every model, priced ones too,
    // so the retry and its share of the ceiling can be exercised at $0 on mock-priced.
    if (user.includes('TRIGGER_ADVISOR_UNREADABLE')) {
      const text = 'I would go ahead, but this is not JSON.';
      return { text, usage: { input: Math.ceil(user.length / 4), output: 10 }, provider: 'mock', model };
    }
    const verdict = { 'mock-advisor-change': 'change', 'mock-advisor-fakequote': 'change', 'mock-advisor-stop': 'stop', 'mock-advisor-need-info': 'need_information' }[model] || 'proceed';
    const first = ((user.split('# The brief\n\n')[1] || '').split('\n').find(l => l.trim()) || '').trim().slice(0, 30);
    const text = JSON.stringify({
      restated_question: 'Should the asker go ahead?', verdict, confidence: model === 'mock-advisor-stop' ? 'high' : 'medium',
      answer: `Mock answer from ${model}: ${verdict}.${(user.match(/\[(?:EMAIL|IP|PATH|HOST)_\d+\]/) || [''])[0] ? ` Contact ${(user.match(/\[(?:EMAIL|IP|PATH|HOST)_\d+\]/) || [''])[0]}.` : ''}`,
      risks: [{ risk: `Mock risk from ${model}.`, quote: model === 'mock-advisor-fakequote' ? 'words that appear nowhere in the brief' : first }],
      would_change_if: `A fact that contradicts ${model}.`, missing_from_brief: verdict === 'need_information' ? ['mock: the deadline'] : [],
    });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // The advise debate. Every model keeps its verdict except the two yielders, which (while they still
  // say "proceed") switch to the first position that differs from theirs: `mock-advisor-yield-argued` quotes that position's
  // answer, `mock-advisor-yield-unargued` quotes nothing (so the quote rule keeps its first verdict).
  if (system.startsWith('You are one advisor on a council, reading')) {
    await new Promise(r => setTimeout(r, 10));
    const own = (user.match(/Verdict: (\w+) \(confidence/) || [])[1] || 'proceed';
    const positions = [...user.matchAll(/## Position: (\w+)\n\n<advisor-claim>\nAnswer: (.+)/g)].map(m => ({ verdict: m[1], answer: m[2] }));
    const other = positions.find(p => p.verdict !== own);
    const yields = (model === 'mock-advisor-yield-argued' || model === 'mock-advisor-yield-unargued') && own === 'proceed' && other;
    const text = JSON.stringify({
      final_verdict: yields ? other.verdict : own, confidence: 'medium',
      answer: yields ? `Mock: persuaded, ${other.verdict}.` : `Mock: I keep ${own}.`,
      changed_because: yields && model === 'mock-advisor-yield-argued' ? other.answer.slice(0, 40) : '',
      still_contested: yields ? '' : 'mock: the other positions do not answer my risk.', would_change_if: 'mock: new evidence.',
    });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // The advise synthesis: takes the first verdict the advisors hold. `mock-advise-synth-invents`
  // names a headline no seat holds, and `mock-advise-synth-split` calls a unanimous panel split; the
  // harness must flag both and replace them with its own roll-up.
  if (system.startsWith("You write the council's verdict")) {
    await new Promise(r => setTimeout(r, 10));
    const held = (((user.split('# Verdicts held by the advisors\n\n')[1] || '').split('\n')[0]) || 'proceed').split(', ');
    const text = JSON.stringify({ headline_verdict: model === 'mock-advise-synth-invents' ? 'abolish' : model === 'mock-advise-synth-split' ? 'split' : held[0], verdict_text: 'Mock verdict text.', next_step: 'Mock next step.' });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
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
  // B2 (debate-084/b2; test/layer-debate.test.js): the exchange inside layer 1. `mock-exch-<post>-<reply>` is a judge that objects like the default scripted critic and, in the exchange, posts <post> on every objection it is
  // shown (`support`, `contest` quoting the first line of the draft with a reason, `doubt` = insufficient_evidence, `new` = support plus one new objection, `garbled` = no JSON) and answers its own posts with <reply> (`keep`, `withdraw`
  // with a reason, `amend`). Every other model supports and keeps. The objection ids are read out of the prompt, never built here.
  if (/(^|\n)You are one reviewer on a panel\. You and the other reviewers/.test(system)) {   // MOCK ONLY: the Council introduction can stand in front of the exchange prompt, so the opening is found at the start of any line
    await new Promise(r => setTimeout(r, 10));
    const post = /^mock-exch-(support|contest|doubt|new|newlater|new7|newevery|garbled|cut|long|flip|slip|contestbad|alt|cg|cnl|nvlate|nvearly|noview|nvgap|cnvlate|ownq|altp)-/.exec(model)?.[1] || (model === 'mock-critic-passer-new' ? 'new' : 'support');
    // `cut`: the first ask of a prompt ends with a provider error (stop error, the kind draftIncomplete reads), the retry of it answers; `long`: a post whose reason and quote run far past any field cap.
    if (post === 'cut' && !MOCK_DRAFT_ERROR_SEEN.has(`${model}:${user}`)) { MOCK_DRAFT_ERROR_SEEN.add(`${model}:${user}`); return { text: '', usage: { input: 30, output: 0, stop: 'error' }, provider: 'mock', model }; }
    // `cg`: contests on its first ask (per objection set), then answers in prose that cannot be read (a post omitted in a later round)
    if (post === 'cg') { const key = `${model}:cg:${[...user.matchAll(/^Objection (O-[0-9a-f]{8}(?:#r?[0-9]+)?)$/gm)].map(m => m[1]).join(',')}`; const n = scriptedAsks.get(key) ?? 0; scriptedAsks.set(key, n + 1); if (n > 0) return { text: 'I still agree with what I said, in prose.', usage: { input: 30, output: 10 }, provider: 'mock', model }; }
    if (post === 'garbled') return { text: 'I agree with most of it, but not in JSON.', usage: { input: 30, output: 10 }, provider: 'mock', model };
    const ids = [...user.matchAll(/^Objection (O-[0-9a-f]{8}(?:#r?[0-9]+)?)$/gm)].map(m => m[1]);
    const first = ((draftBodyOf(user).split('\n').find(l => l.trim().length >= 8)) || '').trim();
    const later = user.includes('Earlier in this exchange');   // a later round of the exchange: the prompt carries the earlier posts
    // `slip` (4 Nov 2026, the id-slip pause): support on every shown id, each written one character off, at the last position and character that keep it two or more characters from every OTHER shown id (so exactly one
    // shown id is one character away, whatever the ids are).
    const apart = (a, b) => [...a].filter((ch, i) => ch !== b[i]).length + Math.abs(a.length - b.length);
    const slipOf = id => { for (let i = id.length - 1; i >= 2; i--) for (const ch of '0123456789abcdef') { if (ch === id[i]) continue; const s = id.slice(0, i) + ch + id.slice(i + 1); if (ids.every(o => o === id || apart(s, o) >= 2)) return s; } return id; };
    if (post === 'slip') return { text: JSON.stringify({ posts: ids.map(id => ({ on: slipOf(id), stance: 'support', text: 'It holds against the criteria.' })), new_objections: [] }), usage: { input: 30, output: 30 }, provider: 'mock', model };
    // 0.8.4 S3 (test-only): `alt` alternates contest / support on every ask (a stance that flips in every round); `contestbad` contests with a quote the plan does not contain (a refused post); `new7` names a new defect on its 2nd ask (round 2: the progress that lets a layer-1 exchange run its last allowed round, 0.8.4 idea 1) and another, with no quote, on its 3rd (the last round the layer-1 exchange is allowed, idea 2); the two differ by their quote because an objection's id hashes judge, criterion and quote
    const isAlt = post === 'alt' || post === 'altp'; const altN = isAlt ? (scriptedAsks.get(`${model}:alt:${ids[0]}`) ?? 0) : 0; if (isAlt) scriptedAsks.set(`${model}:alt:${ids[0]}`, altN + 1);   // `altp` (0.8.4, test-only): `alt` that also names a new defect (with a quote, so its id is its own) on its 2nd ask: the round-2 progress that lets the layer-1 exchange run its last allowed round
    const nEvery = post === 'newevery' ? (scriptedAsks.get(`${model}:postevery`) ?? 0) : 0; if (post === 'newevery') scriptedAsks.set(`${model}:postevery`, nEvery + 1);   // 0.8.4 (exchange idea 2, test-only): `newevery` supports every objection it is shown and names a NEW defect on every ask (a different problem each time, each quoting a longer start of the plan: an objection's id hashes the judge, the resolved criterion and the quote, and every "(variant N)" criterion resolves to list criterion 3, so only the quote tells the asks apart), so every round of an exchange makes progress
    const n7 = post === 'new7' ? (scriptedAsks.get(`${model}:post7`) ?? 0) : 0; if (post === 'new7') scriptedAsks.set(`${model}:post7`, n7 + 1);
    // M0 FIX-UP 2 (item 6, test-only): `cnvlate` contests, then posts an explicit no_view from the second round on (a contest the judge then withdraws by having no view). M0 FIX 2 (Q4(a), test-only): `noview` posts an explicit no_view on every objection; `nvlate` supports, then posts an explicit no_view from the second round on; `nvearly` posts no_view in round 1 and supports later; `nvgap` see below (a stance <-> explicit no_view move is a change of position)
    // `nvgap`: an explicit no_view on its first ask (per objection set), prose that cannot be read on its second (an omitted post after an explicit no_view: it carries nothing), a support from its third on
    const nvgapKey = `${model}:nvgap`;   // per model (0.8.4: a later round shows other ids, so the count must not depend on the shown set)
     const nvgapN = post === 'nvgap' ? (scriptedAsks.get(nvgapKey) ?? 0) : 0; if (post === 'nvgap') scriptedAsks.set(nvgapKey, nvgapN + 1);
    if (post === 'nvgap' && nvgapN === 1) return { text: 'I still have no view, in prose.', usage: { input: 30, output: 10 }, provider: 'mock', model };
    const explicitNoView = post === 'noview' || (post === 'cnvlate' && later) || (post === 'nvlate' && later) || (post === 'nvearly' && !later) || (post === 'nvgap' && nvgapN === 0);
    const posts = ids.map(id => explicitNoView ? { on: id, stance: 'no_view', text: '' } : post === 'contestbad' ? { on: id, stance: 'contest', quote: 'A sentence that the plan never contains anywhere at all.', text: 'The plan already answers this where it says so.' } : post === 'long' ? { on: id, stance: 'support', text: 'y'.repeat(300000) } : (post === 'contest' || post === 'cg' || post === 'cnl' || post === 'cnvlate' || (post === 'flip' && !later) || (isAlt && altN % 2 === 0)) ? { on: id, stance: 'contest', quote: first, text: 'The plan already answers this where it says so.' }
      : post === 'doubt' ? { on: id, stance: 'insufficient_evidence', text: 'What is shown does not establish it.' } : { on: id, stance: 'support', text: 'It holds against the criteria.' });
    // `newlater`: support on every ask, and a new defect named from its second exchange call on (the counter lives in the process: give each test its own model suffix)
    const postCalls = post === 'newlater' || post === 'cnl' ? (scriptedAsks.get(`${model}:post`) ?? 0) : 0; if (post === 'newlater' || post === 'cnl') scriptedAsks.set(`${model}:post`, postCalls + 1);   // `cnl` (0.8.4 S3, test-only): `newlater` that CONTESTS (so the objections it posts on are contested and their raisers are asked)
    const new_objections = (post === 'new' || ((post === 'newlater' || post === 'cnl') && postCalls >= 1) || (post === 'new7' && (n7 === 1 || n7 === 2)) || (post === 'altp' && altN === 1) || post === 'newevery') ? [{ criterion: post === 'newevery' ? `It adds no scope the request did not ask for (variant ${nEvery + 2}).` : 'It adds no scope the request did not ask for.', problem: post === 'newevery' ? `The plan names deliverable number ${nEvery + 2} nobody asked for.` : 'The plan names a second deliverable nobody asked for.', ...(post === 'newevery' ? { quote: first.slice(0, 10 + nEvery) } : (post === 'new7' && n7 === 1) || post === 'altp' ? { quote: first.slice(0, 12) } : {}), ...(mockDemandIn(system) && !/-sev/.test(model) ? { severity: 5 } : {}) }] : [];   // M1: a defect named in a post carries a rating once the post prompt demands one (see mockDemandIn); a model with a `-sev` suffix keeps writing none on its posts, as before (the tests of an untagged post defect rest on it)
    // 0.8.4 S14 (test-only): `ownq` supports every objection it is shown and, for each of its OWN failures the post lists (the held block "- <id>: <criterion>" under "Your own failures that quote nothing:"), gives the first line of the plan as its own_quote
    const own_quote = post === 'ownq' ? [...user.matchAll(/^- (O-[0-9a-f]{8}(?:#r?[0-9]+)?): /gm)].map(m => ({ id: m[1], quote: first })) : null;
    return { text: JSON.stringify({ posts, new_objections, ...(own_quote?.length ? { own_quote } : {}) }), usage: { input: 30, output: 30 }, provider: 'mock', model };
  }
  if (/(^|\n)You are a reviewer on a panel\. Earlier you objected to a plan\./.test(system)) {   // MOCK ONLY: same as above
    await new Promise(r => setTimeout(r, 10));
    const reply = /^mock-exch-[a-z0-9]+-(keepthenwithdraw|amendonce|keep-noreason|keep-varying|keep-attachlate|keep-attach|keepwd[1-9]|keepamend2|keep|withdrawthenkeep|withdraw-unargued|withdraw-bare|withdraw-badpassage|withdraw-postlast|withdraw-post|withdraw|amend-attach|amend-notext|amend-badpassage|amend-othercrit|amend|garbled)(?:-short)?(?:-always)?(?:-noanswers)?(?:-late-[a-z0-9]+|-id-[a-z0-9]+)?(?:-sev[a-z0-9]+)?(?:-selfname-[A-Za-z]+)?(?:-repoclaim)?(?:-quoted)?(?:-clean)?(?:-signoff(?:yes|no|junk|fieldyes|fieldno|yesfieldno|nofieldyes))?$/.exec(model)?.[1] || 'keep';
    if (reply === 'garbled') return { text: 'My answers, in prose and not in JSON.', usage: { input: 30, output: 10 }, provider: 'mock', model };   // 0.8.4 S3 (test-only): a reply that cannot be read at all (not near-JSON)
    const ids = [...user.matchAll(/^Your objection (O-[0-9a-f]{8}(?:#r?[0-9]+)?)$/gm)].map(m => m[1]);
    const later2 = user.includes('Earlier in this exchange');
    const wdAt = /^keepwd([1-9])$/.exec(reply)?.[1]; const keep3N = wdAt ? (scriptedAsks.get(`${model}:k3`) ?? 0) + 1 : 0; if (wdAt) scriptedAsks.set(`${model}:k3`, keep3N);   // 0.8.4 (test-only; was `keep3withdraw`, the fourth reply): `keepwdN` keeps on its first N-1 asks and withdraws (quoting the plan) on the Nth: with the poster `alt` or `altp` (contests on asks 1 and 3) the second reply is the third round's, the last the layer-1 exchange runs
    const keep3aN = reply === 'keepamend2' ? (scriptedAsks.get(`${model}:k3a`) ?? 0) + 1 : 0; if (reply === 'keepamend2') scriptedAsks.set(`${model}:k3a`, keep3aN);   // 0.8.4 (test-only; was `keep3amend`, which amended on the fourth reply): keeps on every ask except the second, which amends: with the poster `altp` (contests on asks 1 and 3) the second reply is the third round's, so the objection is amended in the last round the layer-1 exchange runs
    const wkN = reply === 'withdrawthenkeep' ? (scriptedAsks.get(`${model}:wk`) ?? 0) + 1 : 0; if (reply === 'withdrawthenkeep') scriptedAsks.set(`${model}:wk`, wkN);   // 0.8.4 (test-only): withdraws (quoting the plan) on its first reply, keeps on every later one
    const keepVaryN = reply === 'keep-varying' ? (scriptedAsks.get(`${model}:kv`) ?? 0) + 1 : 0; if (reply === 'keep-varying') scriptedAsks.set(`${model}:kv`, keepVaryN);
    // 0.8.4 S3 (test-only): a withdrawal names a passage of the draft (its first line), as Q1(b) asks; `withdraw-bare` gives a reason and names nothing, `withdraw-badpassage` and `amend-badpassage` quote a passage the plan does not contain,
    // `keep-noreason` keeps with no reason, `amend-notext` amends with no new text, `amend-othercrit` names another criterion.
    const firstLine = ((draftBodyOf(user).split('\n').find(l => l.trim().length >= 8)) || '').trim();
    const NOT_IN_PLAN = 'A passage that the plan does not contain at all.';
    const replies = ids.map(id => (reply === 'keepthenwithdraw' && later2) ? { id, action: 'withdraw', text: 'The later posts settled it.', quote: firstLine }
      : (reply === 'amendonce' && !later2) ? { id, action: 'amend', text: 'Right in part.', problem: 'Narrowed once: the assumptions section is missing.' }
      : reply === 'withdraw' ? { id, action: 'withdraw', text: 'The quoted passage settles it.', quote: firstLine }
      : reply === 'withdraw-bare' ? { id, action: 'withdraw', text: 'I was wrong about this.' }
      : reply === 'withdraw-post' ? { id, action: 'withdraw', text: 'Post 1 settles it.', post: 1 }   // M0 FIX 5 (T1c, test-only): a withdrawal that names a POST (the first one listed under the objection) and no passage
      : reply === 'withdraw-postlast' ? (() => { const n = (user.match(/<critic-claim>\nPost \(/g) || []).length; return { id, action: 'withdraw', text: `Post ${n} settles it.`, post: n }; })()   // ... and the LAST one listed (the boundary of the post number)
      : reply === 'withdraw-badpassage' ? { id, action: 'withdraw', text: 'The quoted passage settles it.', quote: NOT_IN_PLAN }
      : reply === 'withdraw-unargued' ? { id, action: 'withdraw', text: '' }
      : reply === 'keep-noreason' ? { id, action: 'keep', text: '' }
      : reply === 'withdrawthenkeep' ? (wkN === 1 ? { id, action: 'withdraw', text: 'The quoted passage settles it.', quote: firstLine } : { id, action: 'keep', text: 'The posts do not change it.' })
      : reply === 'keepamend2' ? (keep3aN === 2 ? { id, action: 'amend', text: 'Right in part.', problem: 'Narrowed: the assumptions section is missing.' } : { id, action: 'keep', text: 'The posts do not change it.' })
      : wdAt ? (keep3N < Number(wdAt) ? { id, action: 'keep', text: 'The posts do not change it.' } : { id, action: 'withdraw', text: 'The quoted passage settles it.', quote: firstLine })
      : reply === 'keep-varying' ? { id, action: 'keep', text: `Still my view, said in other words (ask ${keepVaryN}).` }   // 0.8.4 S3 (test-only): the same kind of reply with different words every ask (RU-S3-60)
      : reply === 'keep-attachlate' ? (user.includes('REVISED MOCK DELIVERABLE') ? { id, action: 'keep', text: 'The posts do not change it.', quote: firstLine } : { id, action: 'keep', text: 'The posts do not change it.' })   // 0.8.4 S14 (test-only): keeps, and gives a passage of the plan only once the draft under review is the revised one (a later pass), so a passage is attached in a LATER pass than the one that raised the objection
      : reply === 'keep-attach' ? { id, action: 'keep', text: 'The posts do not change it.', quote: firstLine }   // 0.8.4 S14 (test-only): keeps and gives a passage of the plan beside the reply (W24), which the harness attaches to the objection when it had none
      : reply === 'amend-attach' ? { id, action: 'amend', text: 'Right in part.', problem: 'Narrowed: the assumptions section is missing.', quote: firstLine }   // 0.8.4 S14 (test-only): the same beside an amend
      : reply === 'amend-notext' ? { id, action: 'amend', text: 'Right in part.' }
      : reply === 'amend-badpassage' ? { id, action: 'amend', text: 'Right in part.', problem: 'Narrowed: the assumptions section is missing.', quote: NOT_IN_PLAN }
      : reply === 'amend-othercrit' ? { id, action: 'amend', text: 'Right in part.', problem: 'Narrowed: the assumptions section is missing.', criterion: 'It names a deliverable nobody asked for.' }
      : reply === 'amend' ? { id, action: 'amend', text: 'Right in part.', problem: 'Narrowed: the assumptions section is missing.' } : { id, action: 'keep', text: 'The posts do not change it.' });
    // 0.8.4 S6 (test-only; the sign-off line of W14, G7): a `-signoff<kind>` suffix makes the reply END with the line `sign-off: yes` / `sign-off: no` (kinds `yes`, `no`), a line whose answer is neither (`junk`), or carry the JSON field `sign_off` (`fieldyes`, `fieldno`) alone or beside a line that says the other (`yesfieldno`, `nofieldyes`). The prompt is never read for it: the model string decides, as for every mock here.
    const signoff = /-signoff(yes|no|junk|fieldyes|fieldno|yesfieldno|nofieldyes)$/.exec(model)?.[1];
    const signoffField = signoff && /field(yes|no)$/.exec(signoff)?.[1];
    const signoffLine = signoff === 'yes' || signoff === 'yesfieldno' ? 'sign-off: yes' : signoff === 'no' || signoff === 'nofieldyes' ? 'sign-off: no' : signoff === 'junk' ? 'sign-off: maybe' : null;
    return { text: JSON.stringify({ replies, ...(signoffField ? { sign_off: signoffField } : {}) }) + (signoffLine ? `\n${signoffLine}` : ''), usage: { input: 30, output: 20 }, provider: 'mock', model };
  }
  // Dispute review (2026-09-23): the seat that raised an open objection checks the reviser's last
  // pass. Scripted by a marker in the request, like TRIGGER_DECLINED_TEST, because the seat is a
  // holdout critic whose model name already fixes its panel behaviour. Default: "accepted",
  // quoting a line the mock dispute pass really writes. MISREP / DROPPED / FAKEQUOTE / UNREADABLE
  // exercise the other branches.
  if (system.startsWith('You raised one or more objections during a review that ended')) {
    await new Promise(r => setTimeout(r, 10));
    const n = (user.match(/<critic-claim>/g) || []).length;
    const pick = user.includes('TRIGGER_REVIEW_MISREP') ? { verdict: 'misrepresented', quote: 'Body text.', note: 'mock: my objection was answered as a different one.' }
      : user.includes('TRIGGER_REVIEW_DROPPED') ? { verdict: 'silently_dropped', quote: '', note: 'mock: nothing in the draft deals with it.' }
      : user.includes('TRIGGER_REVIEW_FAKEQUOTE') ? { verdict: 'accepted', quote: 'This sentence is not in the draft.', note: 'mock: fine.' }
      : { verdict: 'accepted', quote: 'Body text.', note: 'mock: handled.' };
    const text = user.includes('TRIGGER_REVIEW_UNREADABLE')
      ? 'Looks fine to me. (no JSON)'
      : JSON.stringify({ reviews: Array.from({ length: n }, (_, i) => ({ objection: i + 1, ...pick })) });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
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
  // "How this plan was argued" (src/argued.js). Written deterministically from the fact pack in the
  // prompt, so the mock example in maintainers/examples/ shows the real shape and cites only real
  // ids. mock-argued-inventor adds one sentence about a debate that never happened (an id and a lab
  // the run never had), which the harness's reference check must flag.
  if (system.startsWith('You write "How this plan was argued"')) {
    await new Promise(r => setTimeout(r, 10));
    const m = user.match(/# Fact pack\n\n```json\n([\s\S]*?)\n```/);
    const f = m ? JSON.parse(m[1]) : { labs: [], counts: {}, top_objections: [] };
    const c = f.counts || {};
    const tick = x => `\`${x}\``;
    const out = ['# How this plan was argued', '',
      `This page explains how ${c.labs || 0} AI labs argued over the plan: ${c.alternatives || 0} whole architecture(s) (overall designs) and ${c.proposals || 0} proposed part(s) were on the table, and ${c.objections || 0} objection(s) were raised.`, '',
      '## The big options', ''];
    const alts = f.alternatives?.items || [];
    if (alts.length) {
      for (const a of alts) out.push(`- ${a.name} ${a.status === 'withdrawn' ? `was withdrawn by its author${a.replaced_by ? ` in favour of ${tick(a.replaced_by)}` : ''}` : a.status === 'amended' ? 'was amended by its author' : 'stood as written'} (${tick(a.id)}). Its weak spot, in its own words: ${a.bad_at}`);
      if (f.decisions) out.push('', `The plan records its choice and why the other options lost in its "Decisions" section (${tick(f.decisions.ref)}).`);
    } else out.push(f.decisions ? `The plan's "Decisions" section records the options it weighed (${tick(f.decisions.ref)}).` : 'Nothing recorded.');
    out.push('', '## The objections and how the authors answered', '');
    const objs = (f.objected_proposals || []).slice(0, 5);
    const said = { withdraw: 'withdrew the part', amend: 'amended the part', keep: 'kept the part as it was' };
    if (objs.length) {
      for (const o of objs) {
        const who = o.objections.map(x => `${tick(x.by)} ${x.stance === 'merge' ? 'asked to merge it' : 'objected'} ("${x.text}")`).join('; ');
        const ans = o.author_replies.length ? `The author then ${o.author_replies.map(r => `${said[r.action] || r.action} ("${r.text}")`).join('; then ')}.` : 'The author did not answer.';
        out.push(`- ${tick(o.on)}: ${who}. ${ans} In the plan: ${o.in_plan || 'unaccounted'}.`);
      }
    } else out.push('Nothing recorded.');
    out.push('', '## What is still disputed', '');
    const open = f.unresolved?.open_objections || [];
    const declined = f.declined_objections || [];
    if (!open.length && !declined.length) out.push('Nothing recorded.');
    const stop = t => /[.!?]$/.test(String(t)) ? t : `${t}.`;
    for (const o of open) out.push(`- ${tick(o.lab)} still objects on "${o.criterion}": ${stop(o.problem)}`);
    for (const d of declined) out.push(`- The plan's author declined one objection in round ${d.round}: ${stop(d.reason)}`);
    out.push('', '## Where each lab stood', '');
    for (const l of f.labs || []) out.push(`- ${tick(l.lab)}: proposed ${l.proposed} part(s), ${l.accepted} accepted in the plan; raised ${l.objections_raised} objection(s); final verdict: ${l.final_verdict}.`);
    if (model === 'mock-argued-inventor') out.push('', `A fourth option, a serverless design, was argued down by ${tick('phantom-lab')} (${tick('PHANTOM-9')}).`);
    const text = out.join('\n') + '\n';
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  if (system.startsWith('You write the handoff file')) {
    await new Promise(r => setTimeout(r, 10));
    // 0.8.2 item 6c (test/milestones.test.js): a handoff seat that writes the milestone format against the mock criteria (C1-C3); only that test names it, so no pinned mock chain changes.
    // 0.8.2 (test/held-door-10.test.js, 10h): the same good milestones, but the seat says the plan cannot be built as written.
    if (model === 'mock-handoff-blocked') return { text: 'Status: blocked\n\n## What this is\nThe plan names a service that does not exist.\n\n## Milestones\n### M0 - walking skeleton\nEntry: the repo exists.\nWork: 1. build the plan (plan section 1).\nExit:\n- check: C1, C2, C3 | run the plan by hand => it works\n\n## Final checklist\n- [ ] every criterion is discharged\n', usage: { input: 30, output: 60 }, provider: 'mock', model };
    if (model === 'mock-handoff-milestones') return { text: 'Status: ready_for_build\n\n## Milestones\n### M0 - walking skeleton\nEntry: the repo exists.\nWork: 1. build the plan (plan section 1).\nExit:\n- check: C1, C2, C3 | run the plan by hand => it works\n\n## Final checklist\n- [ ] every criterion is discharged\n', usage: { input: 30, output: 60 }, provider: 'mock', model };
    // 0.8.2 (test/held-door-10.test.js): a handoff seat that writes milestones FROM ITS PROMPT: only when the system prompt asks for the milestone format and the user prompt lists the criteria as `C<n>.`
    // lines, and then discharging exactly the criteria it was shown; otherwise the old free-form handoff (which the milestone lint reports as having no milestones).
    if (model === 'mock-handoff-reads-prompt' && system.includes('## Milestones') && /^C\d+\. /m.test(user)) {
      const ids = [...user.matchAll(/^(C\d+)\. /gm)].map(m => m[1]);
      return { text: `Status: ready_for_build\n\n## What this is\nA fixture plan.\n\n## Milestones\n### M0 - walking skeleton\nEntry: the repo exists.\nWork: 1. build the plan (plan section 1).\nExit:\n- check: ${ids.join(', ')} | run the plan by hand => it works\n\n## Final checklist\n- [ ] every criterion is discharged\n`, usage: { input: 30, output: 60 }, provider: 'mock', model };
    }
    // 0.8.3 M3 (test/tree-split.test.js, PLAN 5.5 item 3): handoff seats that reproduce the plan's split block. `mock-handoff-split` copies the marked fence out of the plan in its prompt, byte for byte;
    // `mock-handoff-split-drift` copies it with one child's scope reworded. Only that test names them (through chains of its own); the default reply below is unchanged.
    // 0.8.3 M5e (test/tree-detect.test.js): `mock-handoff-needs-decision` is `mock-handoff-split` with Status needs_decision (a node that ends needs_decision, PLAN 8.4); like mock-priced it carries a fixture price row.
    // 0.8.3 M6 (the mock for S2, PLAN M6 exit 1 and 2 end to end): `mock-handoff-split-milestones` writes a Status, a `## Milestones` section that discharges every criterion it was shown, AND the plan's split block, when the
    // system prompt asks for the milestone format (a chain with handoff_contract.milestones); a prompt that does not ask is answered exactly as `mock-handoff-split` does below, so a chain without the flag behaves as before.
    // Like the other named handoff mocks it carries a fixture price row (the same as mock-priced), so a chain with it has a dry-run figure.
    // 0.8.3 M6 fixtures: `mock-handoff-milestones-nofence` (C&C, 12 Oct) takes it as well: the same reply WITHOUT the plan's split block (a handoff that writes its milestones and forgets the fence: PLAN 5.5 item 3, the real case);
    // asked for nothing it answers the default reply below. `mock-handoff-needs-decision` (C&C, 11 Oct) takes this branch too, ONLY when the prompt asks for milestones (a chain with handoff_contract.milestones): the same reply with Status needs_decision, so a needs-decision
    // fixture child records a lint like a real one (the real lint then finds `status_not_ready` alone, the one finding statusPolicyOk allows for that Status). A chain without the flag is answered exactly as before.
    if ((model === 'mock-handoff-split-milestones' || model === 'mock-handoff-needs-decision' || model === 'mock-handoff-milestones-nofence') && system.includes('## Milestones') && /^C\d+\. /m.test(user)) {
      // the criteria are the `# Acceptance criteria` list at the END of the prompt (handoffUserMilestones): a tree child's request can itself hold `C<n>.` lines (its inherited obligations, numbered by the parent), and a check that
      // names a criterion the run does not have is an `unknown_criterion` finding (found by the end-to-end tree of M6 S2: R/M2 and R/M3 had two criteria and the check named C1-C3)
      const tail = user.lastIndexOf('\n# Acceptance criteria\n');
      const ids = [...new Set([...(tail >= 0 ? user.slice(tail) : user).matchAll(/^(C\d+)\. /gm)].map(m => m[1]))];
      const fence = user.match(/^```the-high-council:tree-split\n[\s\S]*?\n```$/m)?.[0] ?? '(the plan holds no split block)';
      const text = `Status: ${model === 'mock-handoff-needs-decision' ? 'needs_decision' : 'ready_for_build'}\n\n## What this is\nA fixture handoff.\n\n## Milestones\n### M0 - walking skeleton\nEntry: the repo exists.\nWork: 1. build the plan (plan section 1).\nExit:\n- check: ${ids.join(', ')} | run the plan by hand => it works\n\n## Final checklist\n- [ ] every criterion is discharged${model === 'mock-handoff-milestones-nofence' ? '' : `\n\n## The split\n\n${fence}`}\n`;
      return { text, usage: { input: 30, output: 10 }, provider: 'mock', model };      // the SAME usage as mock-priced's default reply: swapping a fixture chain's handoff seat for this model moves no spent figure (measured: a length-based usage cost $0.109 against $0.04 per priced-debate child)
    }
    if (model === 'mock-handoff-split' || model === 'mock-handoff-split-drift' || model === 'mock-handoff-needs-decision' || model === 'mock-handoff-split-milestones') {
      const fence = user.match(/^```the-high-council:tree-split\n[\s\S]*?\n```$/m)?.[0];
      let copy = fence ?? '(the plan holds no split block)';
      if (fence && model === 'mock-handoff-split-drift') {
        const b = JSON.parse(fence.split('\n').slice(1, -1).join('\n'));
        const i = b.children.length > 1 ? 1 : 0;
        b.children[i].scope += ' (reworded by the handoff)';
        copy = `\`\`\`the-high-council:tree-split\n${JSON.stringify(b, null, 1)}\n\`\`\``;
      }
      const text = `Status: ${model === 'mock-handoff-needs-decision' ? 'needs_decision' : 'ready_for_build'}\n\n## What this is\nA fixture handoff.\n\n## The split\n\n${copy}\n`;
      return { text, usage: model === 'mock-handoff-split-milestones' ? { input: 30, output: 10 } : { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
    }
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
    // 0.8.2: `mock-cold-read-garbled` answers in prose with no verdict - the reply the chain must record as NOT JUDGED, never as "no contradictions".
    const text = model === 'mock-cold-read-garbled'
      ? 'I read it, but I am not sure what to say about it.'
      : model === 'mock-cold-read-yes'
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
  // Bug audit 2026-09-27 M4: a draft-producing seat whose provider ends the reply with a stop that
  // is neither finished nor the cap. `mock-draft-error` does it every time; `mock-draft-error-once`
  // only the first time it sees a given prompt, so draftStage's same-cap retry gets a normal draft.
  if ((model === 'mock-draft-error' || (model === 'mock-draft-error-once' && !MOCK_DRAFT_ERROR_SEEN.has(user)))
      && !isCriticSystem(system) && !system.includes('turn a request into acceptance criteria')) {
    if (model === 'mock-draft-error-once') MOCK_DRAFT_ERROR_SEEN.add(user);
    await new Promise(r => setTimeout(r, 10));
    return { text: '# Plan\n\n## Decisions\n\nWe chose', usage: { input: 10, output: 12, stop: 'error' }, provider: 'mock', model };
  }
  // A draft-producing seat (builder, reviser, finalist, handoff) cut off at its token cap - the
  // pre-release audit's truncated-deliverable case. `mock-draft-cut` is cut off at any cap;
  // `mock-draft-cut-then-fits` only at a cap of 1000 or less, so the chain's one bigger-cap retry
  // rescues it and the retried reply is the ordinary mock draft below.
  if ((model === 'mock-draft-cut' || (model === 'mock-draft-cut-then-fits' && maxTokens <= 1000))
      && !isCriticSystem(system) && !system.includes('turn a request into acceptance criteria')) {
    await new Promise(r => setTimeout(r, 10));
    return { text: '# Plan\n\n## Decisions\n\nWe chose approach A because it re', usage: { input: 10, output: maxTokens ?? 8000, stop: 'length' }, provider: 'mock', model };
  }
  const isReviser = system.startsWith('You are the builder in a multi-model review chain,\nrevising');
  const isCritic = !isReviser && isCriticSystem(system);
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
  // A critic whose reply is cut off at the token cap - stands in for the pilot's gemini/glm/kimi
  // seats (2026-09-17: 14 of 58 lost votes were `stop: "length"` at 8000 tokens, several with a
  // `"meets"` field already written). `mock-critic-cut` is cut off at any cap; `mock-critic-cut-
  // then-fits` is cut off only at a cap of 1000 or less, so the chain's one bigger-cap retry
  // rescues it, and the retried reply is the scripted critic's normal verdict.
  if (isCritic && (model === 'mock-critic-cut' || (model === 'mock-critic-cut-then-fits' && maxTokens <= 1000))) {
    await new Promise(r => setTimeout(r, 10));
    return { text: '{"meets": false, "criteria": [], "failures": [{"criterion": "It states the assum', usage: { input: 10, output: maxTokens ?? 8000, stop: 'length' }, provider: 'mock', model };
  }
  // Bug audit 2026-09-27 M3: a reply the provider cut off at the cap that still PARSES - a complete
  // verdict followed by trailing text the cap cut. `mock-critic-cut-signoff` signs off (every
  // criterion MET), `mock-critic-cut-objection` objects; both are cut at any cap.
  // `mock-critic-cut-signoff-then-fits` is cut only at a cap of 1000 or less, so the bigger-cap
  // retry gets a complete sign-off.
  // `mock-critic-error-signoff` signs off in a reply the provider ended with stop "error" (M4's panel side).
  if (isCritic && (model === 'mock-critic-cut-signoff' || model === 'mock-critic-cut-objection' || model === 'mock-critic-cut-signoff-then-fits' || model === 'mock-critic-error-signoff')) {
    await new Promise(r => setTimeout(r, 10));
    const listed = (user.match(/# Acceptance criteria\n\n([\s\S]*?)\n\n#/) || [])[1] || '';
    const names = listed.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
    const objects = model === 'mock-critic-cut-objection';
    const rows = names.map((criterion, i) => ({ criterion, verdict: objects && i === 0 ? 'NOT MET' : 'MET', evidence: 'Section 1 states it.' }));
    const verdict = JSON.stringify({ meets: !objects, criteria: rows, failures: objects ? [{ criterion: names[0] || 'first', problem: 'Not addressed.' }] : [], verdict_line: objects ? 'One criterion fails.' : 'All criteria met.' });
    const cut = model !== 'mock-critic-cut-signoff-then-fits' || (maxTokens ?? 8000) <= 1000;
    if (model === 'mock-critic-error-signoff') return { text: verdict, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(verdict.length / 4), stop: 'error' }, provider: 'mock', model };
    if (!cut) return { text: verdict, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(verdict.length / 4), stop: 'stop' }, provider: 'mock', model };
    return { text: `${verdict}\n\nNotes on the remaining sections: the rollout order in sect`, usage: { input: 10, output: maxTokens ?? 8000, stop: 'length' }, provider: 'mock', model };
  }
  // B2 (test/layer-debate.test.js): the judge family `mock-exch-*` as a critic: it objects to the first draft under the second default criterion WITH a full table (FAILED on that criterion, MET on the others, evidence on every row), and
  // once the draft is revised it signs off with a full MET table. With answer_back on it answers each earlier objection id its prompt lists, withdrawing with a quote of the revised draft.
  if (isCritic && model.startsWith('mock-exch-')) {
    await new Promise(r => setTimeout(r, 10));
    // `-cutreask` (unit V fix, test-only): the SECOND ask of this model string in the process (a re-ask) is cut off at the cap, so the bigger-cap retry of a re-ask can be driven; every other ask answers as the mode says. Give each test its own suffix, the counter lives in the process.
    if (model.includes('-cutreask')) { const asked = scriptedAsks.get(model) ?? 0; scriptedAsks.set(model, asked + 1); if (asked === 1) return { text: '{"meets": false, "failures": [{"criterion": "It states', usage: { input: 30, output: maxTokens ?? 8000, stop: 'length' }, provider: 'mock', model }; }
    const listed = (user.match(/# Acceptance criteria\n\n([\s\S]*?)\n\n#/) || [])[1] || '';
    const names = listed.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
    const bad = 'It states the assumptions it was written under.';
    const revised = user.includes('REVISED MOCK DELIVERABLE') && !model.includes('-always');   // `-always`: objects to every draft, revised or not (a judge that raises the same point again)
    // `-late-<id>`: the first ask of this model string in the process is unreadable (an unheard judge), later asks answer as the mode says; give each test its own id, the counter lives in the process
    if (model.includes('-late-')) { const asked = scriptedAsks.get(model) ?? 0; scriptedAsks.set(model, asked + 1); if (asked === 0) return { text: 'I could not finish my review.', usage: { input: 30, output: 10 }, provider: 'mock', model }; }
    const sevAsk = /-sev[^-]*then/.test(model) ? (scriptedAsks.get(`${model}:sev`) ?? 0) : 0; if (/-sev[^-]*then/.test(model)) scriptedAsks.set(`${model}:sev`, sevAsk + 1);
    const clean = model.includes('-clean');   // 0.8.4 S3 (test-only): `-clean` signs off blind (every criterion MET, no objection) and still posts in the exchange
    const full = names.map(criterion => ({ criterion, verdict: !revised && !clean && criterion === bad ? 'FAILED' : 'MET', evidence: 'Section 1 states it.' }));
    const rows = model.includes('-short') ? full.slice(0, -1) : full;   // `-short`: the table skips the last criterion
    const section = user.split('# Your objections from the last round, and what happened')[1] || '';
    const answers = revised && !model.includes('-noanswers') ? [...section.matchAll(/^- (O-[0-9a-f]{8}(?:#r?[0-9]+)?):/gm)].map(m => ({ id: m[1], status: 'withdrawn', evidence: 'It now reads "REVISED MOCK DELIVERABLE" at the top.' })) : [];
    const body = revised || clean ? { meets: true, criteria: rows, failures: [], ...(answers.length ? { answers } : {}), verdict_line: 'All criteria met.' }
      : { meets: false, criteria: rows, failures: [{ criterion: bad, problem: model.includes('-selfname-') ? `${model.split('-selfname-')[1]} reports: No assumptions section.` : model.includes('-repoclaim') ? 'The retry step in src/retry.js never states its assumptions.' : 'No assumptions section.', fix: 'Add one.', ...(model.includes('-quoted') ? { quote: ((draftBodyOf(user).split('\n').find(l => l.trim().length >= 8)) || '').trim() } : {}), ...mockSeverityOf(model, sevAsk, system) }], verdict_line: 'One criterion failed.' };   // `-repoclaim` (0.8.4 S14, test-only): the objection reads as a claim about the repository (it names src/retry.js), so a fenced run's quote check marks it 'unquoted' when it carries no quote. `-selfname-<Name>` (unit P, test-only): the judge writes the name it was given into its own objection, so the detector and the anonymity path can be exercised; the name comes from the model string, never from the prompt wording
    const text = JSON.stringify(body);
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // Criterion kinds (src/criteria-kinds.js): a critic that signs off with every criterion MET and
  // no evidence at all - the "met on trust" reply the chain must record on a checkable criterion.
  if (isCritic && model === 'mock-critic-bare-met') {
    await new Promise(r => setTimeout(r, 10));
    const listed = (user.match(/# Acceptance criteria\n\n([\s\S]*?)\n\n#/) || [])[1] || '';
    const rows = listed.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean)
      .map(criterion => ({ criterion, verdict: 'MET', evidence: '' }));
    const text = JSON.stringify({ meets: true, criteria: rows, failures: [], verdict_line: 'All criteria met.' });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // Criterion ids (src/criteria-ledger.js): a critic that signs off but whose criteria table skips the
  // LAST criterion - the "short table" sign-off the chain must record, not act on.
  if (isCritic && model === 'mock-critic-short-table') {
    await new Promise(r => setTimeout(r, 10));
    const listed = (user.match(/# Acceptance criteria\n\n([\s\S]*?)\n\n#/) || [])[1] || '';
    const names = listed.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
    const rows = names.slice(0, -1).map(criterion => ({ criterion, verdict: 'MET', evidence: 'Section 1 states it.' }));
    const text = JSON.stringify({ meets: true, criteria: rows, failures: [], verdict_line: 'All criteria met.' });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // 0.8.2 (test/verdict-words.test.js): a critic that signs off with a full table, evidence on every row, but says UNCHECKED instead of MET on the LAST criterion - a third verdict word.
  if (isCritic && model === 'mock-critic-unchecked-row') {
    await new Promise(r => setTimeout(r, 10));
    const listed = (user.match(/# Acceptance criteria\n\n([\s\S]*?)\n\n#/) || [])[1] || '';
    const names = listed.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
    const rows = names.map((criterion, i) => ({ criterion, verdict: i === names.length - 1 ? 'UNCHECKED' : 'MET', evidence: 'Section 1 states it.' }));
    const text = JSON.stringify({ meets: true, criteria: rows, failures: [], verdict_line: 'All criteria met.' });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  // 0.8.2 (test/held-prompts/*.test.js): a critic that signs off with a table missing the LAST criterion, until its prompt carries the re-ask note "# Your previous reply could not be counted",
  // after which it writes the full table with evidence. Proves both that the note reaches an API seat and that the reply to it is accepted.
  if (isCritic && model === 'mock-critic-table-after-note') {
    await new Promise(r => setTimeout(r, 10));
    const listed = (user.match(/# Acceptance criteria\n\n([\s\S]*?)\n\n#/) || [])[1] || '';
    const names = listed.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
    const told = user.includes('# Your previous reply could not be counted');
    const rows = (told ? names : names.slice(0, -1)).map(criterion => ({ criterion, verdict: 'MET', evidence: 'Section 1 states it.' }));
    const text = JSON.stringify({ meets: true, criteria: rows, failures: [], verdict_line: 'All criteria met.' });
    return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
  }
  if (isCritic && (model === 'mock-critic-passer' || model === 'mock-critic-passer-new')) {   // `-new` (0.8.4 S3, test-only): the same stated pass, and in the exchange it names a new defect in its post
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
  if (isCriteria && system.includes('Give every criterion a kind.')) {
    // Criterion kinds (src/criteria-kinds.js): the same three criteria plus one checkable on the
    // build and one checkable on the plan, and one "checkable" with no check - which the chain
    // must downgrade to judgement rather than count.
    text = JSON.stringify({ criteria: [
      { criterion: 'The deliverable is the artifact itself, not a plan for one.', kind: 'judgement' },
      { criterion: 'It states the assumptions it was written under.', kind: 'checkable', check: 'the deliverable has a heading named "Assumptions"', on: 'plan' },
      { criterion: 'It adds no scope the request did not ask for.', kind: 'judgement' },
      { criterion: 'It commits to the test suite passing and names the command that runs it.', kind: 'checkable', check: 'npm test exits 0', on: 'build' },
      { criterion: 'It is scalable.', kind: 'checkable' },
    ]});
  } else if (isCriteria && model === 'mock-criteria-spec-mirror') {
    // 0.8.2 (test/held-door-6a.test.js): criteria about the criteria list on the first answer; on the retry they are good criteria ONLY when the retry prompt carries the sentence about a request's own
    // list ("check whether your previous criteria repeat it"), otherwise the same meta criteria again (the gate then stops the run).
    const told = user.includes('check whether your previous criteria repeat it');
    text = JSON.stringify({ criteria: user.includes('Your previous answer') && told
      ? ['The deliverable is the artifact itself, not a plan for one.', 'It states the assumptions it was written under.', 'It adds no scope the request did not ask for.']
      : ['Is a JSON object with a "criteria" key containing a list of strings.', 'It states the assumptions it was written under.'] });
  } else if (isCriteria) {
    text = JSON.stringify({ criteria: [
      'The deliverable is the artifact itself, not a plan for one.',
      'It states the assumptions it was written under.',
      'It adds no scope the request did not ask for.',
    ]});
  } else if (isCritic) {
    // 0.8.3 (layered review panel; test/layered-panel.test.js): `mock-critic-script-<pattern>[-suffix]` is a judge scripted by how many times it has been ASKED in this process, not by its prompt: the pattern is
    // a string of `x` (objects) and `o` (signs off), one character per ask of this exact model string, the last character repeating. A carried verdict or a replayed stage makes no ask, so only a real call
    // advances it. The counter lives in the process (the tests and the real-verb probe are single-process); give each test its own suffix so counters never mix. Its objection is the default mock's.
    // E3b (gate page section 11.4): `mock-critic-envelope-<pattern>[-suffix]` is a judge that signs off every ask and answers the Reply-identity section, one character per ask of this exact model string, the last
    // repeating: `e` echoes the ids it finds in its prompt, `m` leaves them out (missing), `w` echoes a wrong review_id, `q` echoes AND quotes a clean sign-off without ids first (an example), `c` echoes but is
    // CUT OFF at the cap (stop length; the chain's one bigger-cap retry follows), `p` echoes the PREVIOUS ask's pair (a retry reply that carries the first attempt's ids), `b` echoes and asks a blocking question, `t` is cut off at the cap right after a complete object that has NO ids. The ids are found
    // with idsFromPrompt (src/verdict-envelope.js), never by reading the held sentence, so the mock does not depend on its wording. Counters live in the process; give each test its own suffix.
    const envelopeScript = /^mock-critic-envelope-([emwqcpbt]+)(?:-.+)?$/.exec(model)?.[1];
    if (envelopeScript) {
      const asked = scriptedAsks.get(model) ?? 0;
      scriptedAsks.set(model, asked + 1);
      const mode = envelopeScript[Math.min(asked, envelopeScript.length - 1)];
      const ids = idsFromPrompt(user);
      const before = envelopeLastIds.get(model); // the pair of this model's PREVIOUS ask (for `p`)
      if (ids) envelopeLastIds.set(model, ids);
      const body = { meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' };
      const wire = o => ({ text: o, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(o.length / 4) }, provider: 'mock', model });
      if (mode === 'm' || !ids) return wire(JSON.stringify(body));
      if (mode === 'w') return wire(JSON.stringify({ review_id: 'ffffffffffff', draft_id: ids.draft_id, ...body }));
      if (mode === 'q') return wire(`Example from the draft: {"meets": true, "failures": []}\n${JSON.stringify({ ...ids, ...body })}`);
      if (mode === 'c') { const t = `${JSON.stringify({ ...ids, ...body })}\n\nNotes on the remaining sections: the rollout order in sect`; return { text: t, usage: { input: 10, output: maxTokens ?? 8000, stop: 'length' }, provider: 'mock', model }; }
      if (mode === 'b') return wire(JSON.stringify({ ...ids, blocking_question: 'Which region does this cover?' })); // echoes the ids and asks a blocking question (the proposer answers it; that call is not a critic call)
      if (mode === 't') { const t = `${JSON.stringify(body)}\n\nNotes on the remaining sections: the rollout order in sect`; return { text: t, usage: { input: 10, output: maxTokens ?? 8000, stop: 'length' }, provider: 'mock', model }; } // a complete object WITHOUT the ids, then cut off at the cap: the truncation is the reason, not the envelope
      if (mode === 'p') return wire(JSON.stringify({ ...(before ?? ids), ...body })); // echoes the PREVIOUS ask's pair: right for no one but that ask
      return wire(JSON.stringify({ ...ids, ...body }));
    }
    // 0.8.4 D18 (test seam; test/text-requests-path.test.js): `mock-critic-requests[-suffix]` (with `-bad` in the suffix: two requests that cannot be read) objects to a draft that does not carry REVISED MOCK DELIVERABLE and ASKS FOR TEXT of the project (a text_requests entry for src/b.js, lines 1-2), and signs off a draft that does. By CONTENT, not by a counter: every resume is a new process, so a per-process count cannot drive a spawned multi-resume test.
    if (/^mock-critic-requests(?:-.+)?$/.test(model)) {
      const text = JSON.stringify(!user.includes('REVISED MOCK DELIVERABLE')
        ? { meets: false, criteria: [], failures: [{ criterion: 'It states the assumptions it was written under.', problem: 'No assumptions section, and src/b.js may already say so.', fix: 'Add one.' }], text_requests: model.includes('-bad') ? [{ why: 'A request with no path.' }, 'src/b.js'] : [{ path: 'src/b.js', lines: '1-2', why: 'To see what the second file already says.' }], verdict_line: 'One criterion failed.' }
        : { meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });
      return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
    }
    // 0.8.4 (the ladder, test seam; test/ladder-newwords.test.js): `mock-critic-restless-<N>[-suffix]` objects at each of its first N asks with a DIFFERENT criterion every time, so its objection id is new at every ask (the stall rule keys on an unchanged
    // id and never fires on it), and signs off from ask N+1 on. N is the fixture's own bound: the judge cannot object past it. The counter lives in the process (one per exact model string): give each test its own suffix.
    const restless = /^mock-critic-restless-([0-9]+)(?:-.+)?$/.exec(model)?.[1];
    if (restless) {
      const asked = scriptedAsks.get(model) ?? 0;
      scriptedAsks.set(model, asked + 1);
      const text = JSON.stringify(asked < Number(restless)
        ? { meets: false, criteria: [], failures: [{ criterion: `It covers case number ${asked + 1}.`, problem: `Case number ${asked + 1} is not covered.`, fix: 'Cover it.', ...mockSeverityOf(model, 0, system) }], verdict_line: 'One criterion failed.' }
        : { meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });
      return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
    }
    const script = /^mock-critic-script-([xo]+)(?:-.+)?$/.exec(model)?.[1];
    if (script) {
      const asked = scriptedAsks.get(model) ?? 0;
      scriptedAsks.set(model, asked + 1);
      const objects = script[Math.min(asked, script.length - 1)] === 'x';
      const text = JSON.stringify(objects
        ? { meets: false, criteria: [], failures: [{ criterion: 'It states the assumptions it was written under.', problem: 'No assumptions section.', fix: 'Add one.', ...mockSeverityOf(model, 0, system) }], verdict_line: 'One criterion failed.' }
        : { meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });   // `-sev<N>` in the suffix (test-only) tags the objection, as for the mock-exch judges
      return { text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model };
    }
    // The scripted critic fails the first draft and passes the revision, so a
    // test run exercises the revise path and then the early stop.
    // `mock-critic-holdout` never passes, so a panel seated with it always ends
    // on a real holdout - the branch where a run ships with an objection on the
    // record rather than a unanimous sign-off.
    const revised = model !== 'mock-critic-holdout' && model !== 'mock-critic-holdout-marker' && user.includes('REVISED MOCK DELIVERABLE');   // `mock-critic-holdout-marker` (test-only, test/lane-a-wiring.test.js) is a holdout whose objection text carries an UNVERIFIED marker (below)
    // 0.8.2 (test/answer-back.test.js): a judge that, once the draft is revised, answers its own earlier objection in an `answers` array: `-withdraw-quoted` withdraws it quoting the
    // draft, `-withdraw-unquoted` withdraws it with no quote, `-sustain` sustains it without listing it again, `-fixed` answers with a word that is neither sustained nor withdrawn. The test seats it under lab 'la', which the objection id depends on.
    // `-omit` (Astra's 0.8.2 review, 7 Oct 2026, F1; test/held-door-27.test.js) signs off clean with no `answers` at all, on every ask; `-after-note` does the same until its prompt carries the
    // re-ask sentence about unanswered objections, then withdraws quoting the draft (proves the sentence reaches the seat and the reply it asks for is accepted).
    const answersMode = /^mock-critic-answers-(withdraw-quoted|withdraw-unquoted|sustain|fixed|omit|after-note)$/.exec(model)?.[1];
    if (answersMode === 'after-note' && revised && user.includes('it gave no answer for your objection')) {
      const answers = [{ id: objectionId('la', { criterion: 'It states the assumptions it was written under.' }), status: 'withdrawn', evidence: 'It now reads "REVISED MOCK DELIVERABLE" at the top.' }];
      return { text: JSON.stringify({ meets: true, criteria: [], failures: [], answers, verdict_line: 'All criteria met.' }), usage: { input: Math.ceil(user.length / 4), output: 60 }, provider: 'mock', model };
    }
    if ((answersMode === 'omit' || answersMode === 'after-note') && revised) {
      return { text: JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' }), usage: { input: Math.ceil(user.length / 4), output: 60 }, provider: 'mock', model };
    }
    if (answersMode && revised) {
      const answers = [{ id: objectionId('la', { criterion: 'It states the assumptions it was written under.' }), status: answersMode === 'sustain' ? 'sustained' : answersMode === 'fixed' ? 'fixed' : 'withdrawn',
        evidence: answersMode === 'withdraw-quoted' ? 'It now reads "REVISED MOCK DELIVERABLE" at the top.' : answersMode === 'sustain' ? 'Still no assumptions section.' : 'It is fixed now.' }];
      return { text: JSON.stringify({ meets: true, criteria: [], failures: [], answers, verdict_line: 'All criteria met.' }), usage: { input: Math.ceil(user.length / 4), output: 60 }, provider: 'mock', model };
    }
    // 0.8.2 morning item 4 (test/audit-morning-items.test.js): a judge for PATCH-mode revision. Round 1 objects. Once its prompt carries the "Changed since your last review" section it withdraws,
    // quoting `-was` the text of the first "Was:" block (text that is NOT in the draft any more) or `-draft` the text of the first "Now:" block (which IS in the draft). Lab 'la', like the answers family.
    const patchMode = /^mock-critic-patch-withdraws-(was|draft)$/.exec(model)?.[1];
    if (patchMode) {
      const criterion = 'It states the assumptions it was written under.';
      if (!user.includes('## Changed since your last review')) {
        return { text: JSON.stringify({ meets: false, criteria: [], failures: [{ criterion, problem: 'No assumptions section.', fix: 'Add one.' }], verdict_line: 'One criterion failed.' }), usage: { input: Math.ceil(user.length / 4), output: 60 }, provider: 'mock', model };
      }
      const block = which => (user.split(`\n${which}:\n`)[1] || '').split('\n')[1] || '';
      const quoted = block(patchMode === 'was' ? 'Was' : 'Now').trim();
      return { text: JSON.stringify({ meets: true, criteria: [], failures: [], answers: [{ id: objectionId('la', { criterion }), status: 'withdrawn', evidence: `It now reads \`${quoted}\`.` }], verdict_line: 'All criteria met.' }), usage: { input: Math.ceil(user.length / 4), output: 60 }, provider: 'mock', model };
    }
    // 0.8.2 (test/held-door-3c.test.js): a judge that answers from what its PROMPT says: once the draft is revised it reads the objection id and the first changed passage out of the answer-back section
    // and withdraws with that passage in backticks; with no such section in its prompt it objects again. Proves the section (and its words) reach the seat and that the reply it asks for is accepted.
    if (model === 'mock-critic-reads-answerback' && revised) {
      const section = user.split('# Your objections from the last round, and what happened')[1] || '';
      const id = (section.match(/^- (O-[0-9a-f]{8}(?:#r?[0-9]+)?):/m) || [])[1];
      const passage = ((section.match(/<changed-passage>\n([^\n]{12,})/) || [])[1] || '').trim();
      if (id && passage) {
        return { text: JSON.stringify({ meets: true, criteria: [], failures: [], answers: [{ id, status: 'withdrawn', evidence: `It now reads \`${passage}\`.` }], verdict_line: 'All criteria met.' }), usage: { input: Math.ceil(user.length / 4), output: 60 }, provider: 'mock', model };
      }
      return { text: JSON.stringify({ meets: false, criteria: [], failures: [{ criterion: 'It states the assumptions it was written under.', problem: 'No assumptions section.', fix: 'Add one.' }], verdict_line: 'One criterion failed.' }), usage: { input: Math.ceil(user.length / 4), output: 60 }, provider: 'mock', model };
    }
    text = JSON.stringify(revised
      ? { meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' }
      : { meets: false, criteria: [], failures: [{ criterion: 'It states the assumptions it was written under.', problem: model.endsWith('-marker') ? 'No assumptions section [UNVERIFIED: read src/queue.js to settle it].' : 'No assumptions section.', fix: 'Add one.', ...mockSeverityOf(model, 0, system) }], verdict_line: 'One criterion failed.' });   // M1 (S19): the plain mock critic of the shipped mock chains rates its objection once the prompt demands a rating
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
    // 0.8.2 (test/held-door-4.test.js, P13): a reviser that answers FROM its prompt: it declines the first failure and, when its prompt lists the failures' ids (the "# Ids of the failures above"
    // section), puts that id on the DECLINED line as the prompt's rule asks; with no such section it writes the old id-less line.
    // M0 FIX 1 (W44, test-only): `TRIGGER_DECLINED_ID_ONCE_<tag>` in the request declines the first listed failure in the FIRST revise of that tag only (the counter lives in the process: give each test its own tag); every later revise is silent about it
    const onceTag = isReviser ? (user.match(/TRIGGER_DECLINED_ID_ONCE_[A-Za-z0-9]+/) || [])[0] : undefined; const onceN = onceTag ? (scriptedAsks.get(onceTag) ?? 0) : 0; if (onceTag) scriptedAsks.set(onceTag, onceN + 1);
    // M0 FIX-UP 2 (item 4, test-only): `TRIGGER_DECLINED_REASON_LONG_<n>` in the request makes the DECLINED reason a single line of n numbered words ("reasonword0 reasonword1 ..."), built HERE and not in the request, so a test can tell the whole reason from a cut one in the exchange prompts (the request is shown to every judge).
    const longN = isReviser ? Number((user.match(/TRIGGER_DECLINED_REASON_LONG_([0-9]{1,4})/) || [])[1] || 0) : 0;
    const reasonOf = longN ? Array.from({ length: longN }, (_, i) => `reasonword${i}`).join(' ') : 'the critic quoted no evidence for this claim.';
    const declineWithId = isReviser && (user.includes('TRIGGER_DECLINED_ID_TEST') || (onceTag && onceN === 0))
      ? (() => { const id = ((user.split('# Ids of the failures above')[1] || '').match(/^\d+\. (O-[0-9a-f]{8}(?:#r?[0-9]+)?)/m) || [])[1]; return `\n\nDECLINED: ${id ? `${id}: ` : ''}${reasonOf}`; })()
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
    // Patch-mode fixtures (src/patch-revise.js): `mock-reviser-patch` returns a search/replace
    // block that applies cleanly against the mock draft; `mock-reviser-patch-bad` returns one
    // whose SEARCH text is not in the draft, exercising the fallback to a full rewrite. The
    // system prompt carries the patch rule only in patch mode, so these never fire otherwise.
    if (isReviser && system.includes('<<<<<<< SEARCH')) {
      if (model === 'mock-reviser-patch-bad') {
        text = '<<<<<<< SEARCH\nthis text is nowhere in the draft\n=======\nreplacement\n>>>>>>> REPLACE';
        return { text, usage: { input: 10, output: 10 }, provider: 'mock', model };
      }
      if (model === 'mock-reviser-patch') {
        text = '<<<<<<< SEARCH\nBody text.\n=======\nBody text, with the assumptions stated.\n>>>>>>> REPLACE';
        return { text, usage: { input: 10, output: 10 }, provider: 'mock', model };
      }
    }
    // M0 FIX 1 (test-only): with a TRIGGER_DECLINED_ID_ONCE tag the revised draft differs on every revise (a marker line), so a later pass judges a NEW draft and its exchange is not skipped as 'settled on this draft'
    const onceMarker = isReviser && typeof onceTag === 'string' ? `\n\nRevision ${onceN + 1} of this run.` : '';
    text = `${isReviser ? 'REVISED ' : ''}MOCK DELIVERABLE for model ${model}\n\nBody text.${isReviser ? '\n\nAssumptions: none.' : ''}${onceMarker}${ledger}${declineTrailer}${declineWithId}${allocatorFix}${Object.hasOwn(PLACEHOLDER_PLAN, model) ? `\n\n## Overview\n${PLACEHOLDER_PLAN[model]}` : ''}`;
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
  return keyEnvValue(spec.key) || (spec.optional ? NO_KEY_REQUIRED : null);
}

// The host of every provider's own base URL. src/denied-models.js checks a seat's `baseUrl`
// against these (pre-release audit 2026-09-23, guards/lint HIGH: a baseUrl could point an
// ordinary-looking seat at a denied lab's API).
export function knownProviderHosts() {
  return new Set([...Object.values(OPENAI_COMPAT), ANTHROPIC].map(p => new URL(p.base).hostname.toLowerCase()));
}

// The providers whose own API host is `host` (any case): ['openrouter'] for openrouter.ai. Used to name the right provider when a free, key-less seat is pointed at a paid provider's host (src/denied-models.js baseUrlReasons).
export function providersAtHost(host) {
  const h = String(host ?? '').toLowerCase();
  return [...Object.entries(OPENAI_COMPAT), ['anthropic', ANTHROPIC]].filter(([, p]) => new URL(p.base).hostname.toLowerCase() === h).map(([name]) => name);
}

// Where a seat's API key may go (security scan 2026-09-26, THC #6). callOpenAICompat sends the
// provider's key to the seat's `baseUrl` when one is set, and the denied-model check (which only
// asks whether an endpoint can be shown to avoid a denied model) accepts a loopback host or any
// known provider's host for every seat. So an OpenRouter key could be sent to a local listener or to
// another lab's API. A keyed provider's baseUrl must now be that provider's own API host, over
// https. A provider whose key is optional (ollama: local and self-hosted servers) is exempt, and so
// is Anthropic, whose adapter never reads baseUrl. Enforced by chain-lint (`key-host`), which the
// CLI runs before every run and every resume.
//
// One opt-in, from the environment only (a chain file or an MCP client cannot set it):
// COUNCIL_ALLOW_LOOPBACK_KEY_HOST=1 also accepts a loopback address (plain http allowed) for a keyed
// seat - a local proxy in front of the provider, and the offline tests' stub servers. Any other
// host is still refused.
const isLoopbackHost = h => h === 'localhost' || h.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(h) || h === '[::1]' || h === '::1';
export function keyDestinationReasons(seat, env = process.env) {
  if (!seat || typeof seat !== 'object' || seat.baseUrl === undefined || seat.baseUrl === null) return [];
  const spec = OPENAI_COMPAT[seat.provider];
  if (!spec || spec.optional) return [];
  const own = new URL(spec.base);
  let url;
  try { url = new URL(String(seat.baseUrl)); } catch { return [`baseUrl "${seat.baseUrl}" is not a valid URL, so where ${spec.key} would be sent cannot be checked`]; }
  const host = url.hostname.toLowerCase();
  if (env?.COUNCIL_ALLOW_LOOPBACK_KEY_HOST === '1' && isLoopbackHost(host)) return [];
  if (host !== own.hostname.toLowerCase()) {
    return [`baseUrl host "${host}" is not ${seat.provider}'s own API host (${own.hostname}), and this seat would send it ${spec.key}`];
  }
  if (url.protocol !== 'https:') return [`baseUrl "${url.origin}" is not https, and this seat would send ${spec.key} over it in clear`];
  return [];
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

// Bug-audit fix, 2026-09-23 (Review/BugAudit_Providers_2026-09-23.md #1, #4). withRetry used to
// retry every error that had no HTTP status - including a connection that dropped while the body
// of a 200 was being read, a truncated or HTML 200, and Node's 300 s headers timeout. Each of those
// happens AFTER the request reached the provider, so a retry re-sent a paid generation (up to 3)
// and only the last attempt was ever priced. Now:
// - a failure before anything was sent (refused, DNS, unreachable, connect timeout) and a 429
//   status are retried, as before (0.8.4 unit 0b: a 5xx is thrown at once, because the request reached
//   the provider; invoke() in chain.js sends it again, reserved and counted);
// - a failure after the request went out is thrown at once, marked `maybeBilled` - invoke() in
//   chain.js charges it to the run's spend at its projected cost, because its usage is unreadable;
// - a 429/5xx `Retry-After` header is honoured (capped; a 5xx's by invoke()'s re-send wait), and there is no sleep after the last try.
// S6-10 (0.8.4): "nothing was sent" is decided by WHAT FAILED, not by a list of error codes. A failure of the name lookup (`getaddrinfo`) or of the connect (`connect`) cannot have put the request on the wire, whatever its code
// (EADDRNOTAVAIL was observed and was on no list, so it was charged as a possibly billed send). Undici's connect timeout carries no syscall, so it stays by name. A dual-stack name fails as an AggregateError (one error per address
// tried) whose own `.code` is only the FIRST member's: it counts only if EVERY member qualifies. Everything else - a read, a reset, a headers or body timeout, an error with no syscall and a code we do not know, a getter that
// throws - is not proven pre-send, so it is post-send: marked `maybeBilled`, never re-sent. `explainFetchFailure` wraps the fetch error, so the walk goes down `.cause` to the first level that says what failed.
const PRE_SEND_SYSCALLS = new Set(['getaddrinfo', 'connect']);
const connectStage = e => PRE_SEND_SYSCALLS.has(e?.syscall) || e?.code === 'UND_ERR_CONNECT_TIMEOUT';
function failedBeforeSend(err) {
  try {
    const seen = new Set();
    for (let node = err, depth = 0; node && typeof node === 'object' && !seen.has(node) && depth < 8; node = node.cause, depth++) {
      seen.add(node);
      if (Array.isArray(node.errors)) return node.errors.length > 0 && node.errors.every(m => m && typeof m === 'object' && connectStage(m));
      if (node.syscall !== undefined || node.code === 'UND_ERR_CONNECT_TIMEOUT') return connectStage(node);
    }
  } catch { /* a throwing getter: unknown, so not proven pre-send */ }
  return false;
}
const RETRY_AFTER_MAX_MS = 120_000;
export function isRetryable(err) {
  if (err.status) return err.status === 429 || err.status >= 500;
  if (err.maybeBilled) return false;
  return failedBeforeSend(err);
}

// Test seam, same setter style as chain.js's setBudget/setCache: lets the retry tests run without
// real multi-second backoff waits. Unset, it is a plain setTimeout.
let retrySleep = ms => new Promise(r => setTimeout(r, ms));
export function setRetrySleep(fn) { retrySleep = fn || (ms => new Promise(r => setTimeout(r, ms))); }

function retryAfterMs(value) {
  if (!value) return null;
  const secs = Number(value);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, RETRY_AFTER_MAX_MS) : null;
}

// Providers audit #3 (2026-09-23): a request had no deadline of its own, so a body that kept
// trickling in never ended. Every request now carries one. The default sits above the longest
// completed call on disk (OpenRouter, 1886 s; kept as history) so it never cuts a call that would have finished.
// 0.8.2 (owner, 6 Oct 2026: "2h is OK"; was 45 minutes): two hours. Derivation: in the GP 2-judge run of 6 Oct the slower GLM-5.3 Flash call produced 74,362 tokens (36,000 answer + 38,362
// thinking) in 554 s, about 134 tokens/s. At that rate a 360,000-token answer plus about 40,000 thinking is about 50 minutes, a 720,000-token retry about 90, so two hours leaves margin for
// both. DeepSeek V4.1 Flash's speed at 360,000 tokens is not measured. The deadline is per request, for every provider and chain, planning chains included: a hung call can hold any run for it.
// Node's own 300 s headers timeout ends a non-streaming call that takes longer than that to start
// answering; it says so instead of "fetch failed". A direct Anthropic call is streamed since 0.8.4
// (see readMessageStream below), so its headers arrive at once; the other providers are not.
export const REQUEST_DEADLINE_MS = 120 * 60 * 1000;
let requestDeadlineMs = REQUEST_DEADLINE_MS;
export function setRequestDeadline(ms) { requestDeadlineMs = ms || REQUEST_DEADLINE_MS; }
// Brief 29 (review finding 4): an absolute deadline for a whole advice call. Every request then gets what is LEFT of it, not a fresh
// full allowance, so a call started just before the deadline cannot run for another whole period. Unset: requests use requestDeadlineMs.
let requestDeadlineAt = null;
export function setRequestDeadlineAt(epochMs) { requestDeadlineAt = Number.isFinite(epochMs) ? epochMs : null; }
/** The timeout, in ms, a request starting now gets. */
export function requestTimeoutNow(now = Date.now()) {
  return requestDeadlineAt === null ? requestDeadlineMs : Math.max(1, Math.min(requestDeadlineMs, requestDeadlineAt - now));
}

// Providers audit #6: Node's fetch quotes the whole URL in its errors, and withRetry prints each
// error, so a baseUrl with user:pass@ in it went to stderr and the run log in clear.
export const redactUrlCredentials = maskUrlUserinfo;   // the one rule lives in src/secret-patterns.js (0.8.3 key-scan unit: the copy here stopped at the first "@" and knew no "/" in a password)

// The HTTP statuses that mean "your account", not "the model": said in words, with the env var the
// key came from, because a raw `HTTP 401 {"error":...}` was all a first-time user saw (walked
// 2026-09-25). Returns null for every other status.
export function accountHint(status, label) {
  const provider = String(label || '').split('/')[0];
  let envName = null;
  try { envName = envKeyName(provider); } catch { /* unknown provider: name no variable */ }
  // 0.8.1 M9: a key typed into the Claude Code plugin's settings dialog is read before the standard variable, so the fix is there, not in .env.
  const fromDialog = envName && keySource(envName) === 'dialog';
  const key = fromDialog ? `the key in the plugin's settings dialog` : envName ? `the key in ${envName}` : 'the API key';
  const where = fromDialog ? "in the plugin's settings dialog (`/plugin`)" : 'in .env';
  if (status === 401) return `${provider} did not accept ${key}. Check it was copied whole, is still active, and was made on ${provider}'s own site; fix it ${where}, then resume the run.`;
  if (status === 402) return `${provider} would not bill this call: the account has no credit left or hit its own spend limit. Add credit on ${provider}'s site, then resume the run.`;
  if (status === 403) return `${provider} refused ${key} for this request: a disabled key, a model your account cannot use, or a provider-side block. Check the key and the model on ${provider}'s site.`;
  return null;
}

// 0.8.4 unit 0b: what the adapter asks again for itself, free: a failure before anything was sent, and a 429 (the provider refused before it worked). A 5xx is NOT in this set any more: it means the request reached the provider, so
// invoke() (src/chain.js) sends it again, with a reservation, a settlement and a count of its own. `isRetryable` above is unchanged: it still answers "may asking again work" (STOPPED-error.json `transient`).
function retriedFreeInsideAdapter(err) {
  if (err.status) return err.status === 429;
  if (err.maybeBilled) return false;
  return failedBeforeSend(err);
}
/** The error a provider's non-2xx answer becomes: the ONE constructor of it, used by the real adapter and, for the mock-http-* models, by the mock, so a mock 5xx has exactly the fields a real one has (`status`, `failureHost`, `retryAfterMs`) and isRetryable / isHttp5xx read it the same way. */
/**
 * 0.8.4 S16 (H3; Muad 09 Nov 2026): the typed error code of a refusal, read from the FULL body (the message keeps only its first 600 characters, so the code can fall past the cut). OpenRouter documents `error.metadata.error_type` ("Typed error codes",
 * https://openrouter.ai/docs/api-reference/errors.md, read 2026-11-09, saved under the builder's raw/ folder); the request-error shape (HTTP status = error.code) is documented there, the typed code on a pre-generation 400 is NOT shown on that page, so a body that names none is no size refusal (fail closed: it is read as any other error).
 */
export function errorTypeOf(fullBody) {
  const text = String(fullBody ?? '').slice(0, 20000);
  try { const j = JSON.parse(text); const t = j?.error?.metadata?.error_type ?? (typeof j?.error?.code === 'string' ? j.error.code : undefined); return typeof t === 'string' ? t : undefined; } catch { /* a cut or non-JSON body: look for the key */ }
  return /"error_type"\s*:\s*"([a-z_]+)"/.exec(text)?.[1];
}
/** The input-side size codes of the documented "Token and length limits" table: the prompt is longer than the model's window (context_length_exceeded, HTTP 400) or the request body is too large (payload_too_large, HTTP 413). Output-side codes (max_tokens_exceeded, token_limit_exceeded, string_too_long) are not size refusals of the prompt. */
export const SIZE_REFUSAL_TYPES = Object.freeze(['context_length_exceeded', 'payload_too_large']);
/** Only an OpenRouter seat (and `mock`, the named test stand-in) halves a part on a size refusal (C&C 09 Nov: the class is OpenRouter-only; a direct seat that is refused for size did not read). */
export const halvesOnSizeRefusal = seat => seat?.provider === 'openrouter' || seat?.provider === 'mock';
export const isSizeRefusal = err => SIZE_REFUSAL_TYPES.includes(err?.errorType) && (err.status === 400 || err.status === 413);
function httpStatusError({ status, detail = '', hint = '', host, retryAfter = null, fullBody = null }) {
  const err = new Error(`HTTP ${status} ${detail}${hint ? `\n  what to do: ${hint}` : ''}`);
  err.status = status; err.failureHost = host;
  { const t = errorTypeOf(fullBody ?? detail); if (t) err.errorType = t; }
  err.retryAfterMs = retryAfterMs(retryAfter);
  return err;
}
/** A bare HTTP error status that means the request reached the provider (5xx): invoke() asks it again, counted. */
export const isHttp5xx = err => Number.isInteger(err?.status) && err.status >= 500;
/** The wait before the n-th (0-based) re-send of a 5xx: the provider's Retry-After (capped) when it sent one, else withRetry's schedule, through the same sleep seam. */
export function resendWait(n, err) { return retrySleep(err?.retryAfterMs ?? 1500 * Math.pow(2, n)); }

async function withRetry(fn, { tries = 3, label = '' } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (err) {
      // Do not burn retries on a request that will never succeed, or that may already be paid for.
      if (!retriedFreeInsideAdapter(err) || i >= tries - 1) throw err;
      const wait = err.retryAfterMs ?? 1500 * Math.pow(2, i);
      process.stderr.write(`  retry ${i + 1}/${tries} ${label}: ${redactUrlCredentials(err.message)} (waiting ${wait}ms)\n`);
      await retrySleep(wait);
    }
  }
}

// 0.8.4 (long direct Claude calls): a direct Anthropic call is STREAMED (`stream: true` in its body, callAnthropic below), so the answer's headers arrive at once and Node's 300 s wait for response headers
// (undici's headersTimeout, which ended a long non-streaming call that had not started answering) never runs. `readMessageStream` rebuilds the events into the very object a non-streaming call returns, so
// the usage, the stop reason and the cut-off reading downstream are untouched. `sse` asks post() to read the 200 that way; a 200 that is not an event stream (an older stub, a proxy) is read as JSON as before.
// Nothing moves in the money rules: past the 200 the generation is billed whatever happens (a stream that ends early, an `error` event in the middle, a body that cannot be read).
// The error code anywhere in an error's cause chain (flags only, never message text; a getter that throws ends the walk).
function causeHasCode(err, code) {
  const seen = new Set();
  for (let x = err, depth = 0; x && typeof x === 'object' && !seen.has(x) && depth < 6; depth++) {
    seen.add(x);
    try { if (x.code === code) return true; x = x.cause; } catch { return false; }
  }
  return false;
}
export async function readMessageStream(res) {
  const decoder = new TextDecoder();
  let buffer = '';
  let message = null;
  const blocks = [];
  let done = false;
  const handle = (type, data) => {
    if (type === 'ping' || !data) return;
    let ev; try { ev = JSON.parse(data); } catch (e) { throw Object.assign(new SyntaxError(`a stream event is not JSON (${e.message})`), { cause: e }); }
    switch (ev?.type) {
      case 'message_start': message = { ...(ev.message || {}), content: [], usage: { ...(ev.message?.usage || {}) } }; break;
      case 'content_block_start': blocks[ev.index] = { ...(ev.content_block || {}) }; break;
      case 'content_block_delta': {
        const b = blocks[ev.index]; const d = ev.delta || {};
        if (!b) break;
        if (d.type === 'text_delta') b.text = (b.text ?? '') + (d.text ?? '');
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking ?? '') + (d.thinking ?? '');
        else if (d.type === 'signature_delta') b.signature = d.signature;
        else if (d.type === 'input_json_delta') b.partial_json = (b.partial_json ?? '') + (d.partial_json ?? '');
        break;
      }
      case 'message_delta':
        if (!message) break;
        if (ev.delta?.stop_reason !== undefined) message.stop_reason = ev.delta.stop_reason;
        if (ev.delta?.stop_sequence !== undefined) message.stop_sequence = ev.delta.stop_sequence;
        message.usage = { ...message.usage, ...(ev.usage || {}) };
        break;
      case 'message_stop': done = true; break;
      case 'error': throw Object.assign(new Error('the provider sent an error event in the middle of its answer'), { streamError: ev.error?.type ?? 'error' });
      default: break;
    }
  };
  const drain = (final) => {
    let i;
    while ((i = buffer.search(/\r?\n\r?\n/)) !== -1 || (final && buffer.trim())) {
      const raw = i === -1 ? buffer : buffer.slice(0, i);
      buffer = i === -1 ? '' : buffer.slice(i).replace(/^\r?\n\r?\n/, '');
      let type = ''; const data = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      handle(type, data.join('\n'));
      if (i === -1) break;
    }
  };
  for await (const chunk of res.body) { buffer += decoder.decode(chunk, { stream: true }); drain(false); }
  buffer += decoder.decode(); drain(true);
  if (!done || !message) throw new TypeError('terminated: the stream ended before the answer was complete');
  message.content = blocks.filter(Boolean);
  // The stream documents no thinking count (see allThinkingOf): a reply that is ALL thinking carries the count the retry of chain.js reads.
  const thought = allThinkingOf(message);
  if (message.usage?.output_tokens_details?.thinking_tokens === undefined && thought > 0) message.usage = { ...message.usage, output_tokens_details: { ...(message.usage.output_tokens_details || {}), thinking_tokens: thought } };
  return message;
}

async function post(url, headers, body, label, { sse = false } = {}) {
  // Credentials never belong in the URL: the key goes in the provider's env var. Refused before
  // anything is sent, with a message that doesn't repeat them.
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`${label}: provider URL is not a valid URL`); }
  if (parsed.username || parsed.password) {
    throw new Error(`${label}: the provider URL (baseUrl) carries credentials (user:pass@host) - refused before sending. Put the key in the provider's API-key env var instead.`);
  }
  return withRetry(async () => {
    let res;
    const signal = AbortSignal.timeout(requestTimeoutNow());
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // No response. Only a failure to connect proves the request never reached the provider;
      // anything else (reset mid-request, headers timeout) may have started a billed generation.
      const billed = !failedBeforeSend(err);   // never throws
      let thrown;
      try {
        if (billed) err.maybeBilled = true;
        const explained = explainFetchFailure(err, label, parsed);
        explained.message = scrubSecrets(explained.message, headers);   // audit A2-1: the fetch layer can echo a rejected header value, i.e. the key
        explained.causeText = causeTextOf(err); explained.failureHost = parsed.hostname; explained.causeClass = 'transport';   // S6-01: tokens only, no message text
        thrown = explained;
      } catch {
        // S6-10: reading the error (a getter that throws on its name or message) must never replace it with the getter's error, which would carry no `maybeBilled`: the call would be lost from the cap. The fallback says the label
        // only (no text from the error, so nothing to scrub), and keeps the flag decided above.
        thrown = Object.assign(new Error(`${label}: the request failed (the error itself could not be read)`), { causeClass: 'transport', failureHost: parsed.hostname, ...(billed ? { maybeBilled: true } : {}) });
      }
      throw thrown;
    }
    if (!res.ok) {
      const fullBody = await res.text().catch(() => '');
      const detail = fullBody.slice(0, 600);
      const hint = accountHint(res.status, label);
      throw httpStatusError({ status: res.status, detail, hint, host: parsed.hostname, retryAfter: res.headers?.get?.('retry-after'), fullBody });
    }
    // Past this line the provider has answered 200, so the generation was billed whatever happens
    // next. A dropped body (TypeError) and a non-JSON body (SyntaxError) are both thrown, never retried.
    try { return await (sse && /text\/event-stream/i.test(res.headers?.get?.('content-type') ?? '') ? readMessageStream(res) : res.json()); }
    catch (cause) {
      if (cause?.streamError) {
        // 0.8.4: an `error` event after the 200 (overloaded_error, api_error ...): the generation was billed up to it. Flags only, no text of the event (providerCode = its type).
        const err = new Error(`${label}: the provider stopped its answer with an error (${cause.streamError}) after it had started - not retried, the generation was probably already billed`);
        err.cause = cause; err.maybeBilled = true; err.providerCode = cause.streamError; err.causeText = causeTextOf(cause); err.failureHost = parsed.hostname; err.causeClass = 'provider_body';
        throw err;
      }
      if (cause?.name === 'TimeoutError' || signal.aborted) {
        const err = new Error(`${label}: no complete response within ${Math.round(requestDeadlineMs / 1000)} s (request deadline) - not retried, the generation was probably already billed`);
        err.cause = cause; err.maybeBilled = true; err.timedOut = true; err.causeText = causeTextOf(cause); err.failureHost = parsed.hostname; err.causeClass = 'transport';
        throw err;
      }
      const what = cause?.name === 'SyntaxError' ? `HTTP 200 but the body is not JSON (${cause.message})` : `the connection dropped while reading a 200 response (${cause?.message})`;
      const err = new Error(`${label}: ${what} - ${cause?.name === 'SyntaxError' ? 'not retried, ' : ''}the generation was probably already billed`);   // 0.8.4: a dropped body is asked again by invoke(), a body that is not JSON is not
      if (sse && causeHasCode(cause, 'UND_ERR_BODY_TIMEOUT')) err.timedOut = true;   // 0.8.4: Node's 300 s wait between two pieces of a streamed answer ran out: the same request would be silent as long again, so invoke() does not ask again (isAutoResumable)
      err.cause = cause; err.maybeBilled = true; err.causeText = causeTextOf(cause); err.failureHost = parsed.hostname; err.causeClass = cause?.name === 'SyntaxError' ? 'unreadable_reply' : 'transport';
      throw err;
    }
  }, { label });
}

// Audit A2-1 (0.8.1): remove every request header value (and each whitespace-separated piece of it of 8+ characters) from an error text, so a key the fetch layer
// echoes back ("Headers.append: \"Bearer sk-...\" is an invalid header value") never reaches run.log, report.json or an MCP result.
function scrubSecrets(message, headers) {
  let out = String(message);
  // Only the headers that can carry a credential: content-type and the API version are not secrets and stay readable in an error.
  for (const [name, v] of Object.entries(headers || {})) {
    if (/^(content-type|anthropic-version|accept)$/i.test(name)) continue;
    for (const piece of [String(v), ...String(v).split(/\s+/)]) if (piece.length >= 8) out = out.split(piece).join('[redacted]');
  }
  return out;
}

// S6-01 (0.8.4): the facts of a failed call, said once. Node's fetch hides the real cause one or two levels down ("fetch failed" is a TypeError whose `cause` is the error that says what happened, or an
// AggregateError of one per address tried), and a run's stop line, STOPPED-error.json and a charge file all printed only the top message. causeTextOf walks the cause chain and says each level as tokens
// (error name, code, syscall) and, for an AggregateError, its members. It is built from those tokens ONLY, never from a `message`: a message can echo a header value (the key) or a URL, and that is the one thing
// this text must not do. A token that is not plain letters, digits and `_ . -` is dropped. Everything the CLI and the charge file print comes through failureFactsOf, so the rule lives here.
const FACT_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;
const factToken = v => { try { return typeof v === 'string' && FACT_TOKEN.test(v) ? v : null; } catch { return null; } };
const levelText = x => [factToken(x?.name), factToken(x?.code), factToken(x?.syscall)].filter(Boolean).join(' ');
export function causeTextOf(err) {
  const levels = [];
  const seen = new Set();
  for (let x = err, depth = 0; x && typeof x === 'object' && !seen.has(x) && depth < 6; depth++) {
    seen.add(x);
    try {   // S6-10: a getter that throws (on name, code, syscall or errors) ends the text; it must never replace the error being explained, which is the one carrying `maybeBilled`
      let text = levelText(x);
      if (Array.isArray(x.errors) && x.errors.length) text += ` [${x.errors.slice(0, 6).map(levelText).filter(Boolean).join(', ')}]`;
      if (text && text !== levels.at(-1)) levels.push(text);
      x = x.cause;
    } catch { break; }
  }
  return levels.join(' > ').slice(0, 300);
}
// S6-02 (0.8.4): what KIND of failure a thrown provider error is, for STOPPED-error.json's `causeClass`, from flags only, never from message text. `transport`: no answer came back, or the connection dropped or timed out while one was read
// (set where post() throws). `http_status`: the provider answered with a non-2xx status. `provider_body`: the provider answered 200 and the body is an error. `unreadable_reply`: the provider answered 200 and the reply could not be read (a body that is not JSON, or one the adapter's own parsing threw on: the marked-billed path). `other`: no flag reached this throw (a guard, a lint, a mock, a crash).
// `transient` keeps its meaning (the same call may pass if asked again, and never for a call that may have been billed); this says what happened, so a person or an agent can tell a dropped connection from a refusal.
export const CAUSE_CLASSES = Object.freeze(['transport', 'http_status', 'provider_body', 'unreadable_reply', 'other']);
export function causeClassOf(err) {
  if (CAUSE_CLASSES.includes(err?.causeClass)) return err.causeClass;
  if (Number.isInteger(err?.status)) return 'http_status';
  if (err?.errorBody || err?.providerCode !== undefined) return 'provider_body';
  return 'other';
}
// 0.8.4 (network-error resume, his decision 9 of 28 Okt 2026): which failures invoke() may ask again. A connection that failed AFTER the request went out (a reset, a dropped body: `maybeBilled`, class `transport`), and not one that ran into a
// timeout (`timedOut`: the request deadline, or Node's 300 s headers limit): the same request would run as long again. Flags only, never message text. A failure before anything was sent is not in this set: withRetry already asked again for it, free.
export function isAutoResumable(err) {
  try { return err?.maybeBilled === true && causeClassOf(err) === 'transport' && err.timedOut !== true; } catch { return false; }
}
/** The wait before the n-th (0-based) automatic resume: withRetry's own schedule (1.5 s, 3 s, 6 s) through the same sleep seam (setRetrySleep). */
export function networkResumeWait(n) { return retrySleep(1500 * Math.pow(2, n)); }
// The ONE rule for a serving-endpoint name (OpenRouter's `provider` field): router-written text, so only a plain short name passes: letters, digits, space and . _ - / ( ) : +, 1-64 characters, at least one letter or digit,
// no space at either end. Anything else is left out, never cleaned. The usage file, the audit line, the advice report's `served_by`, a charge file and the stop record all take the name from here.
export const endpointNameOf = v => (typeof v === 'string' && /^[A-Za-z0-9 ._\-/():+]{1,64}$/.test(v) && /[A-Za-z0-9]/.test(v) && v === v.trim() ? v : null);
export const hostOfUrl = url => { try { return new URL(url).hostname || null; } catch { return null; } };
/** What a thrown provider error says about itself, for the stop line, STOPPED-error.json and a charge file: `cause` (causeTextOf), `host` (the request URL's hostname: never userinfo, path or query) and `providerCode` (a 200 body's error code: a number or a plain token). Empty when none is known. */
export function failureFactsOf(err) {
  const out = {};
  if (typeof err?.causeText === 'string' && /^[A-Za-z0-9_.\-\s>\[\],]{1,300}$/.test(err.causeText)) out.cause = err.causeText;
  if (typeof err?.failureHost === 'string' && /^[A-Za-z0-9.\-:\[\]]{1,255}$/.test(err.failureHost)) out.host = err.failureHost;
  const code = err?.providerCode;
  if (Number.isFinite(code) || factToken(code)) out.providerCode = code;
  const served = endpointNameOf(err?.failureEndpoint); if (served) out.endpoint = served;
  return out;
}

// Turns the two opaque no-response failures into something an operator can act on, and keeps
// any URL credentials out of the message. The error object (flags, cause) is preserved.
//
// Pre-release audit, providers #1 (Review/PreRelease_Audit_providers_2026-09-23.md): this used to
// assign `err.message` in place. The deadline's own error is a DOMException whose `message` is a
// getter, so in strict mode the assignment threw a TypeError that replaced the real error - losing
// `maybeBilled`, so a possibly-billed stalled call went uncounted by the cap. It now returns a new
// Error that carries the original as `cause`, plus the flags and codes the retry logic reads.
function explainFetchFailure(err, label, url = null) {
  let code; try { code = err.cause?.code ?? err.code; } catch { /* a throwing getter: no code, and the error still gets explained (S6-10) */ }
  let message = err.message;
  if (code === 'ECONNREFUSED' && url) {
    // "fetch failed" was all a first-time user saw when Ollama was not running (walked 2026-09-25).
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
    message = `${label}: nothing is listening at ${url.origin}${local ? ' - is the local model server running? For Ollama: start it (the app, or `ollama serve`) and pull the chain\'s models (`ollama pull <model>`).' : ''}`;
  } else if (err.name === 'TimeoutError') {
    message = `${label}: no response within ${Math.round(requestDeadlineMs / 1000)} s (request deadline) - not retried, the generation may already be billed`;
  } else if (code === 'UND_ERR_HEADERS_TIMEOUT') {
    message = `${label}: the provider sent no response headers within Node's 300 s limit, so the call was ended here. Not retried: it may already be billed.`;
  }
  const out = new Error(redactUrlCredentials(message), { cause: err });
  out.name = err.name;
  if (code !== undefined) out.code = code;
  if (err.maybeBilled) out.maybeBilled = true;
  if (err.name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT') out.timedOut = true;   // 0.8.4: a call that ran out of time is not asked again (isAutoResumable)
  return out;
}

// BUG-C-032: the mark post() puts on a failure after a 200 (see there), for an adapter's own parsing of that 200. Never throws itself: a thrown non-object is returned as it is.
function markBilled(err) {
  if (err !== null && typeof err === 'object') { try { err.maybeBilled = true; err.causeClass ??= 'unreadable_reply'; } catch { /* a frozen error object keeps its own flags */ } }   // S6-02: a 200 the adapter could not read
  return err;
}

// Prompt caching, off unless a caller passes `cache` (nothing in production does yet, 0.8.4 B3 prep unit 1).
// Shape read from https://platform.claude.com/docs/en/build-with-claude/prompt-caching on 2026-11-01: a content block carries
// cache_control { type: 'ephemeral' } (5-minute lifetime, the default) or { type: 'ephemeral', ttl: '1h' } (no beta header);
// the breakpoint caches system + messages up to and including that block; Anthropic's usage.input_tokens then counts only the
// tokens AFTER the last breakpoint, so a cached call's input is no longer the whole prompt (the cost side prices the three
// counts below; until it does, a caller must not turn this on for a paid call - cost.js costOf still prices input/output only).
// `cache` = { head, ttl }: `head` is the leading text of the LAST user message that the cache covers (the caller knows where
// its stable part ends; this adapter never searches the prompt for a heading); `ttl` is '5m' or '1h' (default '1h').
export const CACHE_TTLS = ['5m', '1h'];
export function anthropicMessages(messages, cache) {
  const plain = messages.map(m => ({ role: m.role, content: m.content }));
  if (cache === undefined || cache === null) return plain;
  const { head, ttl = '1h' } = cache;
  if (typeof head !== 'string' || head === '') throw new Error('cache: "head" must be the non-empty leading text of the user message to cache (nothing was sent)');
  if (!CACHE_TTLS.includes(ttl)) throw new Error(`cache: ttl must be one of ${CACHE_TTLS.join(', ')}, got ${JSON.stringify(ttl)} (nothing was sent)`);
  const at = plain.length - 1;
  const last = plain[at];
  if (!last || last.role !== 'user' || typeof last.content !== 'string' || !last.content.startsWith(head)) {
    throw new Error('cache: the last message is not a user message that starts with "head", so no breakpoint can be placed (nothing was sent)');
  }
  const marker = { type: 'ephemeral', ...(ttl === '1h' ? { ttl: '1h' } : {}) };
  const rest = last.content.slice(head.length);
  // The API refuses an empty text block, so a head that is the whole message carries the marker alone.
  plain[at] = { role: 'user', content: [{ type: 'text', text: head, cache_control: marker }, ...(rest === '' ? [] : [{ type: 'text', text: rest }])] };
  return plain;
}

// The cache counts of an Anthropic usage object, named apart from readUsage's `cached` key. A count the response does not carry is
// ABSENT, never 0 (brief 48 R3: unknown is not zero); a value that is not a whole non-negative number is treated as not carried.
// cacheRead = cache_read_input_tokens; cacheWrite = cache_creation_input_tokens (all lifetimes); cacheWrite1h = the 1-hour part of
// cache_creation, present only when the response splits by lifetime (the 5-minute part is cacheWrite - cacheWrite1h).
export function cacheCountsOfAnthropic(u) {
  const count = v => (Number.isInteger(v) && v >= 0 ? v : undefined);
  const out = {};
  const read = count(u?.cache_read_input_tokens), write = count(u?.cache_creation_input_tokens), h1 = count(u?.cache_creation?.ephemeral_1h_input_tokens);
  if (read !== undefined) out.cacheRead = read;
  if (write !== undefined) out.cacheWrite = write;
  if (h1 !== undefined) out.cacheWrite1h = h1;
  return out;
}

// 0.8.4: the streamed events document only `output_tokens` in a message_delta; whether they carry `output_tokens_details.thinking_tokens` as a whole reply does is not documented (neither page names that field). The retry of a reply that
// spent its whole cap on thinking (chain.js) reads `usage.thinking`. When a stream gives no count, a reply that holds a thinking block and NO text has spent every output token on thinking, so that is the figure; with any text the count stays missing (0).
function allThinkingOf(json) {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const thought = blocks.some(b => b?.type === 'thinking' || b?.type === 'redacted_thinking');
  const text = blocks.some(b => b?.type === 'text' && String(b.text ?? '').trim() !== '');
  return thought && !text && Number.isInteger(json?.usage?.output_tokens) ? json.usage.output_tokens : 0;
}
async function callAnthropic({ model, system, messages, maxTokens, temperature, extra, cache }) {
  const key = keyFor('anthropic');
  if (!key) throw new Error(keyProblem('ANTHROPIC_API_KEY') ? `ANTHROPIC_API_KEY is set but not usable: ${MALFORMED_KEY_HINT}` : 'ANTHROPIC_API_KEY not set');
  const json = await post(
    `${ANTHROPIC.base}/messages`,
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    {
      // e.g. { output_config: { effort: 'high' } } - Claude 5's thinking is
      // adaptive by default, counts against max_tokens, and is not text.
      // Spread FIRST, so the fields below always win: pre-release audit 2026-09-23 (GuardLayer #2,
      // HIGH) - spread last, a seat's extra.model replaced the model the denied-model check had
      // approved (a seat whose extra.model named a denied model called that model).
      ...(extra || {}),
      model,
      system,
      messages: anthropicMessages(messages, cache),
      max_tokens: maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      stream: true,   // 0.8.4: streamed, so a long answer is not ended by the 300 s wait for headers; rebuilt into the same object by readMessageStream
    },
    `anthropic/${model}`,
    { sse: true }
  );
  // BUG-C-032: post() returned a 200, so the generation was billed whatever this parsing does. A throw here (a body of `null`, `content` that is not an array) is marked like post()'s own post-200 failures.
  try {
    const text = (json.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    return {
      text,
      usage: {
        ...usageGap(json.usage, 'input_tokens', 'output_tokens'),
        input: json.usage?.input_tokens ?? 0,
        output: json.usage?.output_tokens ?? 0,
        thinking: json.usage?.output_tokens_details?.thinking_tokens ?? 0,
        // Only for a call that asked for caching: a call without `cache` keeps the usage object it always had (no new keys in <label>.usage.json).
        ...(cache ? { cacheAsked: cache.ttl ?? '1h', ...cacheCountsOfAnthropic(json.usage) } : {}),   // cacheAsked: the call carried a marker (its lifetime), so a response without counts is UNKNOWN to costOf, not zero
        stop: normaliseStop(json.stop_reason),
      },
      provider: 'anthropic',
      model,
    };
  } catch (err) { throw markBilled(err); }
}

/**
 * 0.8.4 S16 (H; Muad 09 Nov 2026): every OpenRouter request switches the router's prompt shortening OFF. Left on, a prompt over the model's window is cut from the middle before it reaches the judge, and an endpoint of 8k or less defaults to it. The switch is the one the
 * documentation names today: a `plugins` entry `{ "id": "context-compression", "enabled": false }` (https://openrouter.ai/docs/features/message-transforms.md, read 2026-11-09, saved under the builder's raw/ folder; the older `transforms: []` form is not on that page and is not sent).
 * A seat's own `extra.plugins` stays (the entry is appended); a seat that already names context-compression keeps its own choice.
 */
export const COMPRESSION_OFF = Object.freeze({ id: 'context-compression', enabled: false });
export const withCompressionOff = plugins => { const list = Array.isArray(plugins) ? plugins : []; return list.some(p => p && p.id === 'context-compression') ? list : [...list, { ...COMPRESSION_OFF }]; };
async function callOpenAICompat(provider, { model, system, messages, maxTokens, temperature, extra, baseUrl, cache }) {
  // 0.8.4 cache part (b)2: `cache` = { head, ttl } is passed only for a Claude seat the route sent through OpenRouter (src/chain.js invokeCall). OpenRouter takes the same content-block marker as Anthropic's own API on a message part (shape read on its prompt-caching page, 10 Nov 2026: a text part carrying cache_control { type: 'ephemeral' }, 5 minutes by default, ttl '1h' for an hour). Any other call has no `cache`, and its body is byte for byte what it was.
  const sentMessages = provider === 'openrouter' && cache ? anthropicMessages(messages, { head: cache.head, ttl: cache.ttl ?? '5m' }) : messages;
  const spec = OPENAI_COMPAT[provider];
  // The real env var, not keyFor()'s sentinel - a provider marked `optional` (ollama) is called
  // with no Authorization header at all when no key is set, rather than sending the sentinel
  // string as a fake bearer token.
  const realKey = keyEnvValue(spec.key);
  if (!realKey && !spec.optional) throw new Error(keyProblem(spec.key) ? `${spec.key} is set but not usable: ${MALFORMED_KEY_HINT}` : `${spec.key} not set`);
  // `baseUrl` is a per-seat override (chain.js's invoke() forwards seat.baseUrl here), never part
  // of the request body - LM Studio, a remote Ollama box, or any other OpenAI-compatible local
  // runner listens on a different host/port than the provider's own default.
  const base = baseUrl || spec.base;
  const json = await post(
    `${base}/chat/completions`,
    realKey ? { authorization: `Bearer ${realKey}` } : {},
    {
      // Per-seat escape hatch for a provider's own non-standard fields (e.g.
      // Qwen3.5's chat_template_kwargs.enable_thinking on Together). Kept
      // generic rather than provider-specific branching in this adapter.
      // Spread FIRST so it can never replace model/messages/max tokens (pre-release audit
      // 2026-09-23, GuardLayer #2: extra.model overrode the model the denied-model check approved).
      ...(extra || {}),
      model,
      messages: [{ role: 'system', content: system }, ...sentMessages],
      max_completion_tokens: maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      ...(provider === 'openrouter' && openRouterSessionId && !('session_id' in (extra || {})) ? { session_id: openRouterSessionId } : {}),   // FIX 7: every OpenRouter call of the run carries the run's one id (nothing else of the request changes)
      ...(provider === 'openrouter' ? { plugins: withCompressionOff(extra?.plugins) } : {}),   // S16 (H): the router never shortens a prompt on its own (last, so a body that gains response_format keeps the key order the exchange transform produces)
    },
    `${provider}/${model}`
  );
  // BUG-C-032: post() returned a 200, so the generation was billed whatever this parsing does; every throw below is marked like post()'s own post-200 failures.
  try {
    // Pre-release audit, providers #2: a 200 whose body is `{ "error": ... }` and no choices (seen from
    // routers and some self-hosted servers) read as an empty, $0 reply and was diagnosed downstream as
    // malformed JSON. It is the provider's own error, and says so.
    if (json && json.error && !Array.isArray(json.choices)) {
      const detail = typeof json.error === 'string' ? json.error : (json.error.message || JSON.stringify(json.error));
      const err = new Error(redactUrlCredentials(`${provider}/${model}: HTTP 200 carrying an error instead of a reply - ${String(detail).slice(0, 600)}`));
      if (json.error.code !== undefined) err.providerCode = json.error.code;
      err.failureHost = hostOfUrl(base);
      { const served = endpointNameOf(json.provider); if (served) err.failureEndpoint = served; }   // the name the error reply gave for the host that answered, when it gave a plain one
      // S5-03 (owner's pick, 28 Okt 2026): this reply is the provider SAYING what happened, so it is not marked maybeBilled (the catch below leaves it alone) and is not charged one attempt's worst case. It carries the usage the body
      // reported (null when it reported none or one that cannot be read); invoke() charges that figure, else a typical cost for the call. Every other throw after a 200 stays marked (BUG-C-032).
      const u = json.usage;
      const readable = u && typeof u === 'object' && !usageGap(u, 'prompt_tokens', 'completion_tokens').unreadable && [u.prompt_tokens, u.completion_tokens].every(n => Number.isFinite(n) && n >= 0);
      err.errorBody = { usage: readable ? usageOfOpenAICompat(u, { marked: provider === 'openrouter' && !!cache }) : null, ...billedFactsOf(provider, json) };   // D12: the billed figure and the generation id ride on the error reply too (record only)
      throw err;
    }
    const servedBy = endpointNameOf(json.provider);   // the checked value is what is spread below, so the check and the field cannot drift apart
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      usage: { ...usageOfOpenAICompat(json.usage, { marked: provider === 'openrouter' && !!cache }), stop: normaliseStop(json.choices?.[0]?.finish_reason), ...usageGap(json.usage, 'prompt_tokens', 'completion_tokens'), ...(provider === 'openrouter' && cache ? { cacheAsked: cache.ttl ?? '5m' } : {}) },   // cacheAsked: the call carried a marker, so a reply without cache counts is UNKNOWN to costOf, never zero
      provider,
      // v3 §Item 3: a provider-array fallback (`extra.models`) can answer with a model other
      // than the one requested - `json.model` is the response's own record of which model
      // actually answered, and takes priority. Falls back to the requested `model` only when
      // the response carries none, so a response shape lacking `model` is byte-identical to
      // today.
      model: json.model ?? model,
      // OpenRouter names the host that served the call in the response's `provider` field (brief 29: the audit
      // line and the run record say where a brief went). Absent on every other OpenAI-compatible API.
      ...(servedBy ? { endpoint: servedBy } : {}),
      ...billedFactsOf(provider, json),   // D12 part 1: `providerReportedCost` and `generationId`, OpenRouter only, beside the token figures
    };
  } catch (err) { throw err?.errorBody ? err : markBilled(err); }
}

// Providers audit #5: the chain recognises only `length`/`max_tokens` as "cut off", so a cut
// reply reported under another name got no bigger-cap retry and its vote was lost. These are
// the names seen for the same event: Mistral's `model_length`, Anthropic's
// `model_context_window_exceeded`. Everything else passes through unchanged. A null
// finish_reason is left null here: providers.js can't tell "not reported" from "cut"; the
// chain's near-cap output check still catches a cut reply that used most of its cap.
const CUT_OFF_ALIASES = new Set(['model_length', 'model_context_window_exceeded']);
export function normaliseStop(stop) {
  if (stop == null) return null;
  return CUT_OFF_ALIASES.has(stop) ? 'length' : stop;
}

// OpenAI-compatible usage -> ours. Bug-audit fix, 2026-09-23 (Review/BugAudit_Providers_2026-09-23.md
// #2): Google's OpenAI-compatible endpoint leaves `completion_tokens_details.reasoning_tokens` out
// and does NOT include its thinking in `completion_tokens` - only in `total_tokens`. So every
// direct Google seat recorded thinking 0 and output = visible text only (on disk: 209 records, none
// with thinking; replies stopped at a 4000-8000 cap recording 76-1639 output tokens). Cost and the
// spend cap were under-counted and the near-cap truncation check could never fire. When the
// reasoning field is absent, the hidden remainder of total_tokens is thinking, billed as output.
// Where total = prompt + completion (every provider that reports reasoning, or has none) this is 0.
// A reply with no usage, or no input or output count in it, is marked rather than read as zero
// tokens: chain.js charges such a stage its projected worst case (security scan 2026-09-26, THC #3;
// the value checks themselves are cost.js readUsage()).
function usageGap(u, inKey, outKey) {
  if (!u || typeof u !== 'object') return { unreadable: 'no usage reported' };
  if (u[inKey] == null || u[outKey] == null) return { unreadable: 'usage without token counts' };
  return {};
}

// The cache counts of an OpenAI-compatible usage object (0.8.4 cache part a). OpenRouter reports them in `usage.prompt_tokens_details`: `cached_tokens` (read from the cache) and `cache_write_tokens` (written to it)
// (openrouter.ai/docs/features/prompt-caching, read 09 Nov 2026). The page's example shows cached_tokens INSIDE prompt_tokens (prompt_tokens 10339, cached_tokens 10318) and none for cache_write_tokens (its example shows 0). MEASURED 10 Nov 2026 (the paid cache test: Claude Haiku 5.5 through OpenRouter,
// marked calls, hosts Google and Amazon Bedrock): the written tokens are ALSO inside prompt_tokens (the write call and the read call of a pair report the same prompt_tokens; cached_tokens of the read equals cache_write_tokens of the write). The counts are recorded as reported here; usageOfOpenAICompat decides what `input` leaves out.
// A count the response does not carry is ABSENT, never 0, and one that is not a whole number >= 0 counts as not carried.
export function cacheCountsOfOpenAICompat(u) {
  const count = v => (Number.isInteger(v) && v >= 0 ? v : undefined);
  const out = {};
  const read = count(u?.prompt_tokens_details?.cached_tokens), write = count(u?.prompt_tokens_details?.cache_write_tokens);
  if (read !== undefined) out.cacheRead = read;
  if (write !== undefined) out.cacheWrite = write;
  return out;
}
// `input` is the part of the prompt NOT read from the cache, with `cacheRead` / `cacheWrite` beside it, so costOf prices the reads at the read price and the rest at the input price. A call that reports no cache counts keeps `input` = prompt_tokens, as before.
// FIX 6 (C&C 10 Nov 2026, from the paid cache test): on a call that SENT A CACHE MARKER (`marked`: only a Claude seat the route sent through OpenRouter) the written tokens are inside prompt_tokens too, so they leave `input` as well: `input` then means what a direct Anthropic call's input means (the part
// neither read nor written), and costOf, the totals and the token line count the write once. An UNMARKED call keeps the write inside `input` as before (the selected OpenAI seats: costOf counts a reported write inside `usage.input` for them). A read count above the prompt, or a read plus a write above it, cannot be right: they are not used,
// and the usage is marked `unreadable`, which readUsage() carries to the response (chain.js readRes), so invoke() charges the call at one attempt's projected worst case and the stage's basis is 'worst_case' (the cap errs high; unknown is not zero).
export function usageOfOpenAICompat(u = {}, { marked = false } = {}) {
  const input = u?.prompt_tokens ?? 0;
  const completion = u?.completion_tokens ?? 0;
  const reported = u?.completion_tokens_details?.reasoning_tokens;
  const hidden = reported == null && Number.isFinite(u?.total_tokens) ? Math.max(0, u.total_tokens - input - completion) : 0;
  const base = { output: completion + hidden, thinking: reported ?? hidden };
  const cache = cacheCountsOfOpenAICompat(u);
  const cached = cache.cacheRead ?? 0;
  if (cached > input) return { input, ...base, unreadable: 'the cache read count is more than the prompt' };
  const written = marked ? (cache.cacheWrite ?? 0) : 0;
  if (cached + written > input) return { input, ...base, unreadable: 'the cache read and write counts are more than the prompt' };
  return { input: input - cached - written, ...base, ...cache };
}

// FIX 7 (C&C 10 Nov 2026, the owner's yes after the paid cache test and again for every OpenRouter call): the OpenRouter session id of ONE RUN. OpenRouter's caching page (the raw page, read 10 Nov 2026) says that with a `session_id` in the body it is the sticky routing key (the host that wrote a cache entry answers the next call;
// without it, sticky routing starts only after a first cache hit), and that it also groups the run's requests in the Sessions view of the account's logs (and, for Z.AI, the host gets an affinity key derived from the account and the id). The paid test: three of three pairs with an id read the cache on one host, two of three without one (the miss: the
// second call answered by another host). The id is made once per run by the CLI (src/cli.js stampSitting, kept in run.json so a resume carries the same one), random, and holds nothing of the run, the task or the person. Not set (null): no OpenRouter request changes. A seat's own `extra.session_id` wins.
let openRouterSessionId = null;
export function setOpenRouterSessionId(id) { openRouterSessionId = typeof id === 'string' && /^thc-[0-9a-f]{24}$/.test(id) ? id : null; }

// COUNCIL_MOCK_DELAY_MS: extra wait before every `mock` call, so a mock chain can stand in for a real
// one's wall-clock shape (the fixed ~10 ms inside callMock is too short to see a stage). Unset or 0
// changes nothing. Never applies to a real provider.
const mockDelayMs = () => { const v = Number(process.env.COUNCIL_MOCK_DELAY_MS); return Number.isFinite(v) && v > 0 ? Math.min(v, 60_000) : 0; };

// COUNCIL_MOCK_HOLD_FILE=<path> (13 Oct 2026, the load-dependent tests): the same seam as a CONDITION instead of a duration. A `mock` call waits, after any
// COUNCIL_MOCK_DELAY_MS, until that file exists (polled every 50 ms), so a test that must stop or inspect a call while it is in flight holds it there and releases
// it by creating the file: the order no longer depends on how fast the machine is. Never applies to a real provider; unset it changes nothing. The 60 s is a hang guard like
// the delay cap above (nothing in a test waits that long): when it is reached the call says so on stderr and goes on, so a hold that timed out is never mistaken for the old
// race. That ceiling line is not exercised by a test (it would cost 60 s). The hold writes no file and ignores the request deadline (a test that sets both waits at most 60 s).
const mockHoldFile = () => { const v = process.env.COUNCIL_MOCK_HOLD_FILE; return typeof v === 'string' && v ? v : null; };
async function holdMockCall(path) {
  const from = Date.now();
  while (!existsSync(path) && Date.now() - from < 60_000) await new Promise(r => setTimeout(r, 50));
  if (!existsSync(path)) process.stderr.write(`mock hold: ceiling reached after 60000 ms without ${path}; going on\n`);
}

// COUNCIL_MOCK_NETFAIL=<n>:<tag> (0.8.4, network-error resume; test/network-resume.test.js): the first <n> mock calls after this value is set fail the way a connection that dropped AFTER the request went out fails
// (the flags post() puts on it: a transport failure, possibly billed); a value ending in `:plain` fails with an error that carries no flags at all. A different value restarts the count, so give each test its own tag.
// Never applies to a real provider; unset it changes nothing.
let mockNetFailSeen = null, mockNetFailLeft = 0;
function mockNetFailTakes() {
  const v = process.env.COUNCIL_MOCK_NETFAIL;
  if (typeof v !== 'string' || !v) return false;
  if (v !== mockNetFailSeen) { mockNetFailSeen = v; const n = Math.floor(Number(v.split(':')[0])); mockNetFailLeft = Number.isFinite(n) && n > 0 ? n : 0; }
  if (mockNetFailLeft <= 0) return false;
  mockNetFailLeft--;
  return true;
}
// `mock-http-<status>-<n|all>` (0.8.4, the 5xx typical-cost fix-up; MOCK ONLY, test/http5xx-resend.test.js and a CLI probe): a mock seat whose first <n> asks in this process (every ask for `all`) fail the way a provider's HTTP error answer fails (the SAME
// error httpStatusError builds for the real adapter: HTTP <status> in the text, `status`, `failureHost`, no `maybeBilled`), and whose later asks are answered as an unnamed mock model is. Asks are counted per model string, in this process only, so
// `mock-http-503-1` is "a 503, then an answer for the re-send". A dropped connection is the other shape, COUNCIL_MOCK_NETFAIL above (a transport failure, no status). Never applies to a real provider.
const mockHttpAsks = new Map();
function mockHttpFailure(model) {
  const m = /^mock-http-(\d{3})-(all|\d+)$/.exec(String(model));
  if (!m) return null;
  const asked = mockHttpAsks.get(model) ?? 0; mockHttpAsks.set(model, asked + 1);
  if (m[2] !== 'all' && asked >= Number(m[2])) return null;
  return httpStatusError({ status: Number(m[1]), detail: 'mock: the provider answered an error (simulated)', host: 'mock.invalid' });
}
const mockTransportError = plain => plain ? new Error('mock: a failure with no flags (simulated)')
  : Object.assign(new Error('mock: the connection was reset after the request was sent (simulated network failure)'), { causeClass: 'transport', maybeBilled: true, causeText: 'TypeError > Error ECONNRESET read', failureHost: 'mock.invalid' });

export async function call(provider, opts) {
  if (provider === 'mock') {
    const d = mockDelayMs();
    if (d) {
      // The request deadline applies to a mock call as AbortSignal.timeout applies to a real one (0.8.1 M6 review): a call still
      // waiting when an advice call's wall clock passes is cut off, not answered. A timeout may have been billed, as for a real call.
      const left = requestTimeoutNow();
      if (d > left) {
        await new Promise(r => setTimeout(r, left));
        throw Object.assign(new Error(`mock: the request deadline passed after ${left} ms (The operation was aborted due to timeout)`), { name: 'TimeoutError', maybeBilled: true });
      }
      await new Promise(r => setTimeout(r, d));
    }
    const hold = mockHoldFile();
    if (hold) await holdMockCall(hold);
    if (mockNetFailTakes()) throw mockTransportError(process.env.COUNCIL_MOCK_NETFAIL.endsWith(':plain'));
    { const e = mockHttpFailure(opts.model); if (e) throw e; }
    return echoRelation(echoEnvelopeIds(await callMock(opts), opts), opts);
  }
  if (provider === 'external') throw new Error('external seats are answered by writing <label>.md into the run folder, never called');
  if (provider === 'anthropic') return callAnthropic(opts);
  if (OPENAI_COMPAT[provider]) return callOpenAICompat(provider, opts);
  throw new Error(`Unknown provider: ${provider}`);
}

// The `extra` of a seat after the native "high" field is dropped for a vendor reroute ({} when nothing changes, so the seat object keeps its keys). Leaf by leaf (src/reasoning.js).
const extraWithoutNativeHigh = seat => withoutNativeHigh(seat);
