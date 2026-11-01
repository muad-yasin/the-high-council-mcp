// Prompt caching for the direct Anthropic seats (B3 prep, CACHE lane unit 2). Opt-in chain switch `prompt_cache: { enabled: true, ttl: '5m' | '1h' }` (default ttl '1h').
// With the switch off (absent, or enabled false) nothing in this file changes any byte a seat is sent. The adapter side is providers.js callAnthropic (`cache: { head, ttl }`);
// the head of each call is built by src/roles.js (criticUserHead, layerDebateUserHead, layerReplyUserHead), never found by searching the finished prompt.
// This file holds the switch's reading and its chain lint. Every sentence a person reads here is A-DRAFT.

/** The switch, read once per run: false (off) or the ttl text. */
export function promptCacheTtl(config) {
  if (config?.prompt_cache?.enabled !== true) return null;
  return config.prompt_cache.ttl === '5m' ? '5m' : '1h';
}

/** Only a seat that calls Anthropic directly can carry a cache marker (a Claude model reached through OpenRouter is not one). */
export const isDirectAnthropicSeat = seat => seat?.provider === 'anthropic';

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
 * would be cached without the harness counting the cache's cost (the cap would project the base price and the record would ignore the counts): fail closed. (2) The switch with no direct
 * Anthropic seat would silently do nothing, so it is refused too.
 */
export function lintPromptCache(config, filePath = 'the chain file') {
  const findings = [];
  const seats = [...Object.values(config?.seats ?? {}).flatMap(s => (Array.isArray(s) ? s : [s]))].filter(s => s && typeof s === 'object');
  for (const seat of seats) {
    if (!isDirectAnthropicSeat(seat)) continue;
    const paths = cacheKnobPaths(seat.extra);
    if (paths.length) findings.push({ kind: 'anthropic-cache-knob-in-extra', message: `the seat ${seat.lab || seat.model} sets ${paths.join(', ')} in its "extra": a caching setting there would change what the seat is billed without the spend cap counting it.`, fix: `Remove it from "extra" in ${filePath}; caching is switched on for the chain with "prompt_cache": { "enabled": true }.` });
  }
  if (config?.prompt_cache?.enabled === true && !seats.some(isDirectAnthropicSeat)) {
    findings.push({ kind: 'prompt-cache-needs-anthropic', message: 'prompt_cache.enabled is true but no seat of this chain calls Anthropic directly (provider "anthropic"): only a direct Anthropic seat can carry a cache marker, so here the switch would do nothing.', fix: `Remove "prompt_cache" from ${filePath}, or seat a model with provider "anthropic".` });
  }
  return findings;
}

/**
 * WHERE a marker goes (C&C's ruling B, 1 Nov 2026, after the hit-location analysis in Review/084/cache/Unit2_Plan_2026-11-01.md): only on a call that can be READ by a later call. In B3 that is the
 * layer-1 exchange: the k=2 call of a round budget writes the entry, the calls k=3..R read it (the system text for k>1 is one string, k=1 another, and a draft change moves the head, so nothing
 * else in a run ever repeats). So: an exchange call with k >= 2, at a layer whose round budget is at least 3 (a two-round budget would write at k=2 and never read). No panel call, no k=1 call and no
 * call of a layer with a smaller budget carries a marker, switch on or off.
 */
export const exchangeCallCarriesHead = ({ ttl, k, rounds }) => !!ttl && Number.isInteger(k) && Number.isInteger(rounds) && rounds >= 3 && k >= 2;
