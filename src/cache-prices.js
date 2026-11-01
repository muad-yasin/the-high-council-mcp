// The prompt-cache price multipliers, ONE place (B3 prep, CACHE lane unit 2). No imports, so the cost module and the roster estimator can both read it.
// Source, read raw with curl on 2026-11-01: https://platform.claude.com/docs/en/about-claude/pricing, the line "Cache read (hit) 0.1x base input price (0.025x on
// Claude Fable 5.1 and Claude Mythos 5.1; 0.05x on Claude Opus 5.5 and Claude Sonnet 5.5)" and "5-minute cache write 1.25x base input price", "1-hour cache write 2x
// base input price". Haiku 5.5 reads at 0.1x. Direct Anthropic keys only: no other host or lab is claimed to match. A model not named here reads at 0.1x, and the
// 0.025x of Fable 5.1 is NOT applied (no B3 seat is Fable on a marked call; the cap errs high).
export const CACHE_READ_MULTIPLIER_DEFAULT = 0.1;
const CACHE_READ_MULTIPLIER_BY_KEY = Object.freeze({ 'anthropic/claude-opus-5-5': 0.05, 'anthropic/claude-sonnet-5-5': 0.05 });
export const cacheReadMultiplierOf = key => CACHE_READ_MULTIPLIER_BY_KEY[key] ?? CACHE_READ_MULTIPLIER_DEFAULT;
export const CACHE_WRITE_MULTIPLIER = Object.freeze({ '5m': 1.25, '1h': 2 });
/** The write multiplier of a lifetime; an unknown lifetime is priced as the dearer one (the cap errs high). */
export const cacheWriteMultiplierOf = ttl => CACHE_WRITE_MULTIPLIER[ttl] ?? CACHE_WRITE_MULTIPLIER['1h'];
