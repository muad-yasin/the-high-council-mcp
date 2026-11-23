// Prompt caching for the direct Anthropic seats (B3 prep, CACHE lane unit 2). Opt-in chain switch `prompt_cache: { enabled: true, ttl: '5m' | '1h' }` (default ttl '5m').
// With the switch off (absent, or enabled false) nothing in this file changes any byte a seat is sent. The adapter side is providers.js callAnthropic (`cache: { head, ttl }`);
// the head of each call is built by src/roles.js (criticUserHead, layerDebateUserHead, layerReplyUserHead), never found by searching the finished prompt.
// This file holds the switch's reading and its chain lint. Every sentence a person reads here is A-DRAFT.

/** The switch, read once per run: false (off) or the ttl text. */
export function promptCacheTtl(config) {
  if (config?.prompt_cache?.enabled !== true) return null;
  return config.prompt_cache.ttl === '1h' ? '1h' : '5m';   // his 09 Nov 2026 18:29: the default lifetime is 5 minutes; '1h' is selectable
}

/** Only a seat that calls Anthropic directly can carry a cache marker (a Claude model reached through OpenRouter is not one). */
export const isDirectAnthropicSeat = seat => seat?.provider === 'anthropic';

/** A Claude seat the Claude route sent through OpenRouter (src/claude-route.js): provider openrouter and originalProvider anthropic. It carries a 5-minute cache mark at the end of the head H (his 10 Nov 2026 04:05 heading: Claude seats reached through OpenRouter ARE cached, 5 minutes where possible). A seat a person seated on OpenRouter themselves, even with a Claude model, has no originalProvider and is not one; a GPT-6 or Qwen seat never is (its request body is byte for byte what it was). */
export const isRoutedClaudeSeat = seat => seat?.provider === 'openrouter' && seat?.originalProvider === 'anthropic';

/** A judge seat that can use the switch (0.8.4 cache part (b)1): a seat that calls Anthropic directly (a cache mark goes on its calls) or goes through OpenRouter (the order of a judge's prompt gives a host that caches by itself a shared beginning). A builder, reviser or criteria seat makes no judge call, so it does not count. */
export const cacheUsableSeat = seat => seat?.provider === 'anthropic' || seat?.provider === 'openrouter';

/** Every path inside an object at which a key named `cache_control` sits (a caching knob smuggled through a seat's `extra`). */
export function cacheKnobPaths(value, path = 'extra', out = []) {
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value)) {
    if (k === 'cache_control') out.push(`${path}.${k}`);
    cacheKnobPaths(v, `${path}.${k}`, out);
  }
  return out;
}

/**
 * Chain lint. (1) Always, switch or no switch: a direct Anthropic seat whose `extra` carries a caching knob is refused. The adapter spreads `extra` into the request first, so such a seat
 * would be cached without the harness counting the cache's cost (the cap would project the base price and the record would ignore the counts): fail closed. (2) The switch with no judge seat
 * that can use it (cacheUsableSeat) would silently do nothing, so it is refused too.
 */
export function lintPromptCache(config, filePath = 'the chain file') {
  const findings = [];
  const seats = [...Object.values(config?.seats ?? {}).flatMap(s => (Array.isArray(s) ? s : [s]))].filter(s => s && typeof s === 'object');
  for (const seat of seats) {
    if (!isDirectAnthropicSeat(seat)) continue;
    const paths = cacheKnobPaths(seat.extra);
    if (paths.length) findings.push({ kind: 'anthropic-cache-knob-in-extra', message: `the seat ${seat.lab || seat.model} sets ${paths.join(', ')} in its "extra": a caching setting there would change what the seat is billed without the spend cap counting it.`, fix: `Remove it from "extra" in ${filePath}; caching is switched on for the chain with "prompt_cache": { "enabled": true }.` });
  }
  if (config?.prompt_cache?.enabled === true && !(Array.isArray(config?.seats?.critics) ? config.seats.critics : []).some(cacheUsableSeat)) {
    findings.push({ kind: 'prompt-cache-no-seat-can-use-it', message: 'prompt_cache.enabled is true but no judge seat of this chain (seats.critics) calls Anthropic directly (provider "anthropic") or goes through OpenRouter (provider "openrouter"): only such a seat can use the switch (a cache mark, or the shared beginning of a prompt that a host caches by itself), so here the switch would do nothing.', fix: `Remove "prompt_cache" from ${filePath}, or seat a judge with provider "anthropic" or "openrouter".` });
  }
  return findings;
}

/**
 * WHERE a marker goes (C&C's ruling B, 1 Nov 2026, after the hit-location analysis in Review/084/cache/Unit2_Plan_2026-11-01.md): only on a call that can be READ by a later call. In B3 that is the
 * layer-1 exchange: the k=2 call of a round budget writes the entry, the calls k=3..R read it (the system text for k>1 is one string, k=1 another, and a draft change moves the head, so nothing
 * else in a run ever repeats). So: an exchange call with k >= 2, at a layer whose round budget repays the write (at least 3 rounds at 5 minutes, 4 at 1 hour: a shorter budget writes at k=2 and does not read enough to pay for it). No panel call, no k=1 call and no
 * call of a layer with a smaller budget carries a marker, switch on or off.
 */
// The breakeven (C&C, 10 Nov 2026, after the layer-1 exchange was cut to 3 rounds): round 2 pays the write premium and each later round saves 0.9 of the head's input at the read price. A 5-minute entry writes at 1.25x (premium 0.25), so one read repays it (a budget of 3 rounds); a 1-hour entry writes at 2x (premium 1.0), so one read (0.9) does not and two do (a budget of 4 rounds). Estimate (src/cost.js) and send (src/chain.js) both read it here, so priced = sent and switching the cache on never costs more than leaving it off.
export const exchangeCallCarriesHead = ({ ttl, k, rounds }) => !!ttl && Number.isInteger(k) && Number.isInteger(rounds) && rounds >= (ttl === '1h' ? 4 : 3) && k >= 2;
