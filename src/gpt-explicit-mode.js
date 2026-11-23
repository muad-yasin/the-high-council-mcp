// 0.8.5 (C&C's rulings 5 and 6 on the GPT prompt cache, 23 Nov 2026): on the MARKED calls of the selected GPT seats, OpenAI's explicit breakpoint at the end of the shared head H, with the explicit cache mode.
//
// WHY: from GPT-5.6 on, OpenAI and Azure write a prompt into the cache only at the end of its LAST message, and a later request reads only where an earlier one wrote. A Council judge
// call sent two plain strings (system, user), and the start the calls of a pass share (the system text and H) ends in the middle of the user string, so every call was billed a cache
// write of its whole prompt at 1.25x the input price and nothing was ever read back.
// WHAT IS SENT (src/providers.js callOpenAICompat, after the spend gate, which still projects the call on the one string): on a call that a later call of the same seat in the pass can
// reuse (src/cache-order-gate.js gptHeadMarkOf: markTtlOf's group rule), BOTH of OpenAI's fields, from one condition: the user message as two text blocks cut at H, the first carrying
// `prompt_cache_breakpoint: { "mode": "explicit" }` (joined, the two blocks are the string, byte for byte), and `prompt_cache_options: { "mode": "explicit" }` at the root, with no
// lifetime. Every other call of a selected seat sends neither: its request is byte for byte what it was before 0.8.5. The shapes are those of OpenAI's prompt caching guide and
// OpenRouter's chat completion reference (PromptCacheOptions, PromptCacheBreakpoint), read 23 Nov 2026.
// MEASURED: one paid test, 23 Nov 2026, gpt-6-luna on Azure through OpenRouter, with OpenRouter's zero-retention routing and a neutral mock prompt of about 5,700 tokens. The first call
// wrote the 4,704-token head; a call with the same head and a new tail read those 4,704 tokens and wrote none; the same text sent as one string (a form of the test only) counted the
// same prompt_tokens as the two blocks; every bill equalled the listed prices on the reported counts. The other four ids are UNTESTED: their first real run is their test.
//
// WHICH SEATS: an OpenRouter seat whose model is on SELECTED_IDS. Never a model before GPT-5.6 (Azure answers these fields with a 400: gpt-5, gpt-5-mini), never an id whose generation
// cannot be read, even if it were listed; never a seat whose own `extra` sets `prompt_cache_options` (it is sent as the seat set it); never a seat with an `extra.models` fallback list
// (another model, perhaps one that refuses the fields, could answer it). The price after the call (src/cost.js costOf): only PRICED_IDS, the id the test measured, take the price of the
// reported counts, and only on a marked call (usage.promptCacheBreakpoint); every other call keeps the selected-seat rule (every uncached prompt token as a write), which errs high.
//
// Contract (pure, no I/O):
//   SELECTED_IDS, PRICED_IDS                 the OpenRouter model ids above.
//   gptGenerationOf(model)                   -> { major, minor } for an `openai/gpt-<major>[.<minor>]` id, else null.
//   explicitModeOf(seat)                     -> 'explicit' when a marked call of this seat carries OpenAI's two fields, else null.
//   isPricedGptId(provider, model)           -> true for an id whose marked calls are priced by their reported counts.
//   setGptCacheIdsForTest({ selected, priced })  TEST SEAM (like held-roles.js setHeldForTest): replaces the lists; null puts the shipped ones back. No code under src/ may call it.

export const SELECTED_IDS = Object.freeze(['openai/gpt-6-luna', 'openai/gpt-6.1-sol', 'openai/gpt-6.2-sol', 'openai/gpt-6.1-terra', 'openai/gpt-6.2-astra']);
export const PRICED_IDS = Object.freeze(['openai/gpt-6-luna']);

let override = null;
export function setGptCacheIdsForTest(lists) {
  override = lists && typeof lists === 'object' ? { selected: Object.freeze([...(lists.selected ?? SELECTED_IDS)]), priced: Object.freeze([...(lists.priced ?? PRICED_IDS)]) } : null;
}
const selectedIds = () => override?.selected ?? SELECTED_IDS;
const pricedIds = () => override?.priced ?? PRICED_IDS;

export function gptGenerationOf(model) {
  const m = typeof model === 'string' ? /^openai\/gpt-(\d+)(?:\.(\d+))?(?!\d)/.exec(model) : null;
  return m ? { major: Number(m[1]), minor: m[2] === undefined ? 0 : Number(m[2]) } : null;
}
const fromGpt56 = model => { const g = gptGenerationOf(model); return !!g && (g.major > 5 || (g.major === 5 && g.minor >= 6)); };

export function explicitModeOf(seat) {
  if (!seat || seat.provider !== 'openrouter') return null;
  if (!selectedIds().includes(seat.model) || !fromGpt56(seat.model)) return null;   // a Claude seat the route moved to OpenRouter has an `anthropic/` id: never selected
  const extra = seat.extra && typeof seat.extra === 'object' ? seat.extra : {};
  if ('prompt_cache_options' in extra) return null;   // the seat's own setting is sent as it is
  if ('models' in extra) return null;                 // a fallback list: another model could answer the request
  return 'explicit';
}

export const isPricedGptId = (provider, model) => provider === 'openrouter' && pricedIds().includes(model) && fromGpt56(model);
