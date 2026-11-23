import { isFreeProvider } from './providers.js';
import { cacheReadMultiplierOf, cacheWriteMultiplierOf } from './cache-prices.js';
import { promptCacheTtl, exchangeCallCarriesHead, isDirectAnthropicSeat } from './prompt-cache.js';
import { notesConfigOf, reviewNotesActive } from './review-notes-lane.js';
import { SHIPPED_PRICES as PRICES, effectiveRow, rateFor } from './price-table.js';
import * as R from './roles.js';
import { retryCapFor, retryCeilingOf } from './reasoning.js';
import { ownPinOf } from './price-pin.js';
import { billingAccountOf } from './caps.js';   // DUALCAP milestone 2: the per-cap figure of the limit screen (caps.js imports nothing of this file)
import { roundLimitsOf } from './overseer-rounds.js';
import { deciderActive, deciderSeatOf } from './conflict-decider.js';
import { systemTextsFor, settingsOf, climbSortingFor, judgeSystemR1 } from './stage-system.js';
import { cacheOrderSeat, markTtlOf } from './cache-order-gate.js';
import { draftBoundaryOn } from './draft-bounds.js';
import { sortingOn } from './sorting.js';
import { EXCHANGE_ROUNDS, LAYER_ONE_EXCHANGE_ROUNDS, exchangeJudgeCount } from './layer-debate.js';
import { endingExchangeOn, lastRoundPostSystem, lastRoundReplySystem } from './ending-exchange-prompts.js';
import { shortExchangeOn, signoffRefusalOn } from './short-exchange.js';
import { held } from './held-roles.js';
import { finalReadWordsOn } from './final-read-words.js';
import { goUpRulingActive, layerOneRulingActive, rulingActive } from './escalation.js';
import { ratingsDemanded } from './ratings-demand.js';
import { finalReadOn, proposerReturnOn, proposerSeatsOf } from './call-gates.js';
import { seatKeyOf, sameLayerOrdinals, repeatedLabsOf } from './seat-key.js';
import { withoutNotes } from './persona-record.js';

// A seat's default maxTokens when its config sets none. Defined here (not in chain.js, which
// re-exports it as DEFAULT_MAX_TOKENS) because chain.js imports this module, so the dry-run can
// price a stage at the same cap runChain uses without a circular import.
export const SEAT_DEFAULT_MAX_TOKENS = 36000;
import { DEFAULT_SECURITY_REVIEWER_SEAT, SECURITY_REVIEW_LABEL } from './security-review.js';
import { ARGUED_LABEL } from './argued.js';

// PRICES is the SHIPPED table (src/price-table.js, the one price source): the "as of" line, the expiry checks and the unusable-row report stay about the package's own table; a project's rows (pricing.user.json) enter only through priceOf below.

// v7.1: a local-model provider (ollama) prices at exactly $0 for any model name - pricing.json
// is keyed by exact "provider/model" and cannot enumerate every locally-pulled model, so this is
// checked before the lookup rather than requiring one entry per local model. `priced: true` is
// what matters here: it is what keeps a local seat out of summarise()'s and dry_run's "unpriced"
// warning list, which otherwise reads identically to "uncapped" - a worse user experience for a
// seat that is genuinely, structurally free.
// The price table's as-of date (pricing.json `asOf`, 0.7.8): the oldest date every entry was last
// checked. A row whose provider has retired the model or no longer lists a price counts as checked on the
// read date but keeps the figure the table already had (its `_source` says so): the date records the read, not that figure.
// `council doctor` and `--dry-run` print the date, and warn once it is older than
// PRICE_TABLE_STALE_DAYS, because the spend cap is only as good as the table it projects with and
// the table is static between releases (thc-research briefs 09/11: the dry-run never said how old
// its prices were). `now` is injectable for tests. Returns null fields when the table has no date.
export const PRICE_TABLE_STALE_DAYS = 60;
export function priceTableAge(now = new Date(), table = PRICES) {
  const asOf = typeof table?.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(table.asOf) ? table.asOf : null;
  if (!asOf) return { asOf: null, days: null, stale: true };
  const days = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
  return { asOf, days, stale: days > PRICE_TABLE_STALE_DAYS };
}

// The lines doctor and --dry-run print: one always, a WARNING line too when the table is stale.
export function priceTableLines(now = new Date(), table = PRICES) {
  const { asOf, days, stale } = priceTableAge(now, table);
  // Computed first, so a table with no as-of date still warns about its expired rows (M7 review).
  const unusable = unusablePriceRows(table).map(r => `WARNING: price row ${r.key} has a price that cannot be used (${r.why}); a seat on it is refused like an unpriced one under a spend cap. Fix src/pricing.json.`);
  const expired = expiredPriceRows(now.getTime(), table).map(r => (r.malformed ? `WARNING: price row ${r.key} has an expiry date that cannot be read (${JSON.stringify(r.expires)}); its price is used as written. Check it.` : `WARNING: price row ${r.key} expired on ${r.expires} (a promotional or announced price change); what it bills now may be higher than this projects, and the spend cap projects with the old price. Update the-high-council.`));
  if (!asOf) return ['Prices: src/pricing.json carries no as-of date.', 'WARNING: the price table has no date, so its age is unknown. Check each lab\'s pricing page before trusting this estimate or the spend cap.', ...expired, ...unusable];
  const age = days < 0 ? 'dated in the future' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  const lines = [`Prices: src/pricing.json as of ${asOf} (${age}). List prices change; treat every figure as an estimate.`];
  if (stale) lines.push(`WARNING: the price table is ${days} days old (more than ${PRICE_TABLE_STALE_DAYS}). Estimates and the spend cap project with these prices, so they may be off. Update the-high-council, or check each lab's pricing page.`);
  return [...lines, ...expired, ...unusable];
}

/**
 * Price rows past their `expires` date (0.8.1 plan M7, P13): [{ key, expires, malformed? }]. A row may carry "expires": "YYYY-MM-DD"
 * when its price is known to change (a promotional price, an announced rise). priceOf keeps using the row's price after the date: a
 * silent switch would change quoted prices with no release, and "at least through" a date is not an end date. The release test
 * fails on an expired row (test/pricing-expiry.test.js) and the dry run and `council doctor` print a warning instead. An expiry that
 * is not a date is reported as malformed, never skipped.
 */
export function expiredPriceRows(now = Date.now(), table = PRICES) {
  const out = [];
  for (const [key, row] of Object.entries(table || {})) {
    if (!row || typeof row !== 'object' || !('expires' in row)) continue;
    // A real calendar date: "2026-02-30" parses (rolled over to March) but is not one, so it must round-trip (M7 review).
    const t = typeof row.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.expires) ? Date.parse(`${row.expires}T00:00:00Z`) : NaN;
    const ok = Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === row.expires;
    if (!ok) out.push({ key, expires: row.expires, malformed: true });
    else if (now >= Date.parse(`${row.expires}T00:00:00Z`)) out.push({ key, expires: row.expires });
  }
  return out;
}

/**
 * A price is usable only as two finite numbers >= 0 (cost-unit gate page U1, 14 Oct 2026; audit item 2). Before, a row missing `in` or `out` made worstCaseOf NaN and a NaN projection was admitted. A row that fails is UNUSABLE: priceOf answers null, so the seat reads as unpriced and a
 * spend cap refuses it before anything is sent (needsPrice, src/unpriced.js), and the doctor and the dry run name the row (priceTableLines). Never skipped, never read as 0.
 */
const usablePrice = row => !!row && typeof row === 'object' && Number.isFinite(row.in) && row.in >= 0 && Number.isFinite(row.out) && row.out >= 0;
/** [{ key, why }] for every row of the table that is an object but not a usable price (the keys that are not rows, such as the as-of date, are not rows). */
export function unusablePriceRows(table = PRICES) {
  const out = [];
  for (const [key, row] of Object.entries(table || {})) {
    if (!key.includes('/') || !row || typeof row !== 'object' || usablePrice(row)) continue;
    out.push({ key, why: `in: ${JSON.stringify(row.in)}, out: ${JSON.stringify(row.out)}` });
  }
  return out;
}
export function priceOf(provider, model) {
  if (isFreeProvider(provider)) return { in: 0, out: 0 };
  const row = effectiveRow(provider, model);   // the shipped row merged with the project's own (never lower than shipped): src/price-table.js
  return usablePrice(row) ? row : null;
}
/**
 * The price of ONE CALL at the size of its prompt (DUALCAP 4d): the row as the project sees it (shipped merged with the project's own), at the tier the call's prompt reaches (src/price-table.js rateFor).
 * `promptTokens` undefined = the caller has no figure: the base row. A size that was asked for and is not finite (NaN, null, Infinity) = the dearest tier. A finite size is ceiled, then tested against each tier.
 * A caller with no figure passes undefined on purpose; it never turns "no figure" into NaN or null (that would land on the dearest tier by accident). priceOf stays the base row: the readers that ask "is this seat priced" do not need a size.
 */
export function priceAt(provider, model, promptTokens) {
  if (isFreeProvider(provider)) return { in: 0, out: 0 };
  const row = rateFor(provider, model, promptTokens);
  return usablePrice(row) ? row : null;
}
// 0.8.4 cache part a, 3b (C&C 09 Nov 2026): WHAT A CALL TO A SELECTED SEAT BILLS THAT NOBODY ASKED FOR.
// OpenRouter's Prompt Caching page (the page titled "Prompt Caching" under openrouter.ai/docs, read and saved 2026-11-09) says: "GPT-5.6 and later charge cache writes at 1.25x the price of the original input pricing, even with
// automatic caching - no opt-in required." So a call to an `openai/` GPT model of generation 5.6 or later on OpenRouter is billed a WRITE on its prompt although no marker was sent. The page speaks of the family, not of a price row,
// so the SELECTOR reads the family from the model id: provider openrouter, id `openai/gpt-<major>[.<minor>]...`, generation 5.6 or later. A pre-5.6 id (`gpt-5`, `gpt-5.5`, `gpt-5-mini`, a dated `gpt-4o`) is NOT selected. An `openai/`
// id whose generation cannot be read (`openai/gpt-oss-120b`, `openai/o3`) IS selected: that is a design choice, taken to err high (pinned by test/cache-auto-write.test.js). A selected row that names `cache_write` is priced at the row
// (cacheMultsOf); an absent write is priced at the page's figure below. Whether such an unmarked call later READS the entry is not known (B3 recorded no OpenRouter cache counts; the endpoints API says supports_implicit_caching false
// for luna and terra while the page says OpenAI caching is automatic), so every call of a selected seat is priced as a write until a measured run shows reads: unknown is never priced as a saving.
export const AUTO_CACHE_WRITE_MULT = 1.25;
// What an INFERRED write costs, as a multiple of the input price: the row's write multiple, or the page's figure when the row names none, and NEVER below the input price (a later refresh may list a write price under the input price;
// the page says the family bills a write at 1.25x, so an inferred write is never cheaper than a plain input token). On a selected seat that sent no marker a write the reply REPORTS does not set the price (costOf: it is inside usage.input); on any other row a reported write is priced at the row as it is.
export const autoWriteMultOf = p => Math.max(1, p?.cacheWriteMult ?? AUTO_CACHE_WRITE_MULT);
// 0.8.4 cache part (b)2: a call to an Anthropic model through OpenRouter that carries a marker (only a routed Claude seat is ever marked: a person's own OpenRouter seat never is). Its cache multiples come from the SHIPPED ROW of that model (`p.cacheReadMult` / `p.cacheWriteMult`, the OpenRouter page's dated figures: src/price-table.js cacheMultsOf), never below the Anthropic table's own write multiple for the lifetime (the cap never projects less than OpenRouter can bill), and a read never above the input price. Any other seat keeps the Anthropic table.
const isRoutedClaudeModel = (provider, model) => provider === 'openrouter' && typeof model === 'string' && model.startsWith('anthropic/');
const cacheMultsOfCall = (provider, model, p, ttl) => (isRoutedClaudeModel(provider, model)
  ? { read: Math.min(1, p?.cacheReadMult ?? cacheReadMultiplierOf(`${provider}/${model}`)), write: Math.max(cacheWriteMultiplierOf(ttl), p?.cacheWriteMult ?? 0) }
  : { read: cacheReadMultiplierOf(`${provider}/${model}`), write: cacheWriteMultiplierOf(ttl) });
export function isAutoCacheWriteModel(provider, model) {
  if (provider !== 'openrouter' || typeof model !== 'string' || !model.startsWith('openai/')) return false;
  const m = /^openai\/gpt-(\d+)(?:\.(\d+))?(?!\d)/.exec(model);
  if (!m) return true;   // no readable GPT generation (`gpt-oss-120b`, `o3`): selected, it errs high
  const major = Number(m[1]), minor = m[2] === undefined ? 0 : Number(m[2]);
  return major > 5 || (major === 5 && minor >= 6);
}
// THE ONE READER of "what does this call carry": every site that prices a call's input asks here. Modes: 'explicit' (a cache marker is sent: the head at its write price), 'auto' (a selected seat, nothing sent: the whole prompt
// is billed as a write), 'off' (caching switched off in the request: the plain input price) and 'none' (everything else: the plain input price). Part (b) chooses explicit / off / nothing per seat and changes ONE place that decides what
// a request carries; this function and its override are where the cap and the dry run read that choice. `cache` is the call's cache argument (a head and a lifetime) when the caller names one.
let cacheModeOverride = null;
/** TEST SEAM (like chain.js setReservationSink): force the mode every reader sees ('explicit' | 'auto' | 'off' | 'none'); null in production. */
export function setCacheModeForTest(mode) { cacheModeOverride = mode ?? null; }
export function cacheModeOf(provider, model, { cache = null } = {}) {
  if (cacheModeOverride) return cacheModeOverride;
  if (cache) return 'explicit';
  return isAutoCacheWriteModel(provider, model) ? 'auto' : 'none';
}
// The multiple the INPUT of a call to this seat is billed at beyond the plain price: the write multiple of the row (or the page's figure when the row names none) for an 'auto' call, else 1. `promptTokens` picks the tier as everywhere.
export function cacheInputMultOf(provider, model, promptTokens) {
  if (cacheModeOf(provider, model) !== 'auto') return 1;
  return autoWriteMultOf(priceAt(provider, model, promptTokens));
}
/** Why a seat has no usable price: 'missing' (no row) or 'unusable' (a row that is not two finite numbers >= 0); null when it is priced or free. Pure. */
export function priceProblemOf(provider, model) {
  if (isFreeProvider(provider) || priceOf(provider, model)) return null;
  return PRICES[`${provider}/${model}`] ? 'unusable' : 'missing';
}

/**
 * Does a call to this seat need a price row before a spend cap can hold it (0.8.2 item 8a; ChatGPT review 1 #4a; owner 7 Oct 2026)? An unpriced seat projects $0, so a cap cannot see it: under a cap the harness
 * refuses it. Exempt by construction: `mock` (the offline chains run free under any ceiling; mock-priced and mock-budget carry fixture prices), `external` (a person or another session answers; nothing is billed)
 * and a free local provider (ollama), which priceOf already prices at an explicit $0.
 */
export const needsPrice = seat => !!seat && seat.provider !== 'mock' && seat.provider !== 'external' && !priceOf(seat.provider, seat.model);

// Security scan 2026-09-26 (THC #3): a provider's usage numbers went straight into costOf() and
// the spend cap. A NaN, a negative count or a string there made the stage's cost NaN or negative,
// and `spent + NaN` is NaN, which no ceiling comparison ever breaches: one odd reply switched the cap
// off. readUsage() accepts a token count only as a finite number >= 0 (a plain digit string is read
// as its number). Anything else, or no usage at all, is reported as unreadable, with every count
// zeroed so the stage record and the log stay sane; invoke() then charges the stage's projected
// worst case instead of a measured cost.
function tokenCount(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function readUsage(usage) {
  if (!usage || typeof usage !== 'object') return { usage: { input: 0, output: 0, thinking: 0 }, unreadable: 'no usage reported' };
  const clean = { ...usage };
  delete clean.unreadable;
  const bad = [];
  for (const k of ['input', 'output', 'thinking', 'cached']) {
    const required = k === 'input' || k === 'output';
    if (!required && usage[k] == null) continue;
    const n = tokenCount(usage[k]);
    if (n === null) { bad.push(k); clean[k] = 0; } else clean[k] = n;
  }
  // Prompt caching (src/prompt-cache.js): the cache counts are whole numbers >= 0 or ABSENT. A malformed count is not zeroed (that would understate a call that was cached): it is dropped and
  // the usage is reported unreadable, so the cap charges the call's worst case. `cacheAsked` ('5m' | '1h') says the call carried a marker; costOf reads it.
  for (const k of ['cacheRead', 'cacheWrite', 'cacheWrite1h']) {
    if (usage[k] == null) { delete clean[k]; continue; }
    if (!Number.isInteger(usage[k]) || usage[k] < 0) { bad.push(k); delete clean[k]; }
  }
  if (usage.cacheAsked != null && usage.cacheAsked !== '5m' && usage.cacheAsked !== '1h') { bad.push('cacheAsked'); delete clean.cacheAsked; }
  const why = [...(usage.unreadable ? [String(usage.unreadable)] : []), ...(bad.length ? [`unreadable ${bad.join(', ')}`] : [])];
  return { usage: clean, unreadable: why.length ? why.join('; ') : null };
}
// A dollar figure read back from disk (<label>.usage.json on replay). Absent is $0, as it always
// was (an external stage, a cache entry from before costs were recorded); present, it must be a
// finite number >= 0, else null, which the caller charges as the stage's worst case.
export function readUsd(v) {
  if (v === undefined || v === null) return 0;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** The input side of a call to an OpenAI-compatible host that reported cache counts (0.8.4 cache part a). `p` is the rate of the call (priceAt: it carries the shipped row's cacheReadMult / cacheWriteMult when the row names cache prices), `pIn` the input price the call is
 * priced at (the tier's, raised by the seat's own pin). Pure. */
export function openAiCacheInputUsd(usage, p, pIn) {
  const rm = Math.min(1, p.cacheReadMult ?? 1), wm = p.cacheWriteMult ?? 1;
  return (usage.input / 1e6) * pIn + ((usage.cacheRead ?? 0) / 1e6) * pIn * rm + ((usage.cacheWrite ?? 0) / 1e6) * pIn * wm;
}

// CR-1F-001: `pin` is the seat's OWN provider.max_price (ownPinOf), and the recorded cost uses the same per-field max(row, own pin) as worstCaseOf's projection: OpenRouter may route a pinned call to any host up to the pin,
// so a call recorded at the lower row could be billed more than the cap was told (budget.spent, the usage file, report totals and --spend all read this figure). A pin below the row never lowers it.
export function costOf(provider, model, usage, pin = null) {
  // The size the provider billed as the prompt: input + cacheRead + cacheWrite as reported. Anthropic's input_tokens excludes the cached part; the OpenAI-compatible adapter subtracts the READ count from prompt_tokens (providers.js usageOfOpenAICompat) and
  // leaves a write count inside `input` for an UNMARKED call (the selected seats below) and takes it out for a call that sent a marker (FIX 6: measured, the written tokens are inside prompt_tokens), so for a marked call input + read + write is the prompt. A field not reported counts 0; no input figure at all = no size (undefined: the base row).
  // EXCEPT a call to a selected seat (OpenRouter openai/ GPT 5.6 or later) that sent no marker: THC counts a reported write as lying inside `usage.input` (see the rule in costOf below), so it does not add to the size.
  const selectedUnmarked = !usage.cacheAsked && isAutoCacheWriteModel(provider, model);
  const size = usage.input == null ? undefined : usage.input + (usage.cacheRead ?? 0) + (selectedUnmarked ? 0 : (usage.cacheWrite ?? 0));
  const p = priceAt(provider, model, size);
  if (!p) return { usd: 0, priced: false };
  const pIn = Math.max(p.in, pin?.prompt ?? 0), pOut = Math.max(p.out, pin?.completion ?? 0);
  const outUsd = (usage.output / 1e6) * pOut;
  const asked = usage.cacheAsked;
  if (!asked) {
    // An OpenAI-compatible host (OpenRouter, or a direct provider) that reported cache counts although no marker was asked (the host caches by itself, or a marker part (b) will send): reads at the row's read multiple of THIS call's input price, writes
    // at its write multiple (src/price-table.js cacheMultsOf: the multiples of the shipped row, so a tier and the seat's own pin raise the cache prices with `pIn`). A price the row does not name is UNKNOWN, not free: a read then costs the input price
    // and so does a write, which is exactly what the whole prompt cost before the counts were read; only a row that says `cache_write: 0` writes for free. A read is never above the input price.
    if (provider !== 'anthropic') {
      // A SELECTED seat (isAutoCacheWriteModel: openai/ GPT 5.6 or later on OpenRouter) that sent no marker is charged by THC as a write on every prompt token that was not read from the cache, whatever its reply reports, because OpenRouter's Prompt Caching page says
      // GPT-5.6 and later charge cache writes at 1.25 x the input price even with automatic caching, so THC counts every uncached prompt token as a write and the read tokens at the row's read multiple. THC's counting rule (C&C 09 Nov 2026; checked against the replies of one paid test: 24 calls to GPT-6 Luna on one Azure endpoint, 10 Nov 2026, and against no other model or host): a reported write count lies inside prompt_tokens, and
      // `usage.input` is prompt - read (providers.js usageOfOpenAICompat), so the count is inside it and sets NO price: the settled figure is input x the inferred write multiple (never below the input price)
      // plus the read at the row's multiple, for any write count, a reported zero included, and a write equal to the whole uncached part is not counted twice (nor in the tier size above). The flags say what the reply left out
      // (cacheUnknown: no cache count at all; cacheWriteUnreported: a read count and no write count; cacheWriteInInput: a reply that reported a write count, which sets no price). The marked direct-Anthropic path below is untouched.
      // Every other seat keeps the input price for a write it has no price for.
      if (selectedUnmarked) {
        const rm = Math.min(1, p.cacheReadMult ?? 1);
        const usd = (usage.input / 1e6) * pIn * autoWriteMultOf(p) + ((usage.cacheRead ?? 0) / 1e6) * pIn * rm + outUsd;
        if (usage.cacheRead === undefined && usage.cacheWrite === undefined) return { usd, priced: true, cacheUnknown: true };
        if (usage.cacheWrite === undefined) return { usd, priced: true, cacheWriteUnreported: true };
        return { usd, priced: true, cacheWriteInInput: true };   // a reported write (a zero included) did not set the price: the record says so (chain.js costOfRes: cacheCounts 'write-in-input')
      }
      if (usage.cacheRead !== undefined || usage.cacheWrite !== undefined) return { usd: openAiCacheInputUsd(usage, p, pIn) + outUsd, priced: true };
    }
    return { usd: (usage.input / 1e6) * pIn + outUsd, priced: true };
  }
  // A call that carried a cache marker (src/prompt-cache.js). Anthropic's input_tokens EXCLUDES the cached part: read tokens at the model's read multiplier, written tokens at 1.25x (5m) or 2x (1h)
  // of the input price. A response that carried NO cache counts at all is UNKNOWN, not zero: the whole input is charged as a write of the asked lifetime (the cap errs high) and the caller records it.
  const known = usage.cacheRead !== undefined || usage.cacheWrite !== undefined;
  if (!known) return { usd: (usage.input / 1e6) * pIn * cacheMultsOfCall(provider, model, p, asked).write + outUsd, priced: true, cacheUnknown: true };
  const read = usage.cacheRead ?? 0, written = usage.cacheWrite ?? 0;
  const written1h = usage.cacheWrite1h === undefined ? (asked === '1h' ? written : 0) : Math.min(usage.cacheWrite1h, written);   // no split reported: all writes at the asked lifetime
  const written5m = written - written1h;
  const m5 = cacheMultsOfCall(provider, model, p, '5m'), m1h = cacheMultsOfCall(provider, model, p, '1h');
  const usd = (usage.input / 1e6) * pIn + (read / 1e6) * pIn * m5.read + (written5m / 1e6) * pIn * m5.write + (written1h / 1e6) * pIn * m1h.write + outUsd;
  return { usd, priced: true };
}

/** A zero-cost record the harness writes beside the stages (today: `handoff-notes`, the collected answer lines; provider 'harness'). It is not a call: nothing prices it and it is never `unpriced`. */
export const isHarnessRecord = s => s?.provider === 'harness';

export function summarise(stages) {
  let input = 0, output = 0, usd = 0, cacheRead = 0, cacheWrite = 0;
  const unpriced = new Set();
  const notReported = new Set();   // 'read' / 'write': a cache count that a call which used a prompt cache did not carry (see below)
  let carriedRead = false, carriedWrite = false;   // some call that used a prompt cache carried the count (a zero included)
  for (const s of stages) {
    if (!s.usage || isHarnessRecord(s)) continue;
    // A call recorded 'write-in-input' counted its written tokens as lying inside usage.input (costOf): the total leaves them out of `input` so the token line's "in", "read" and "written" do not overlap.
    input += s.usage.input - (s.usage.cacheCounts === 'write-in-input' ? Math.min(s.usage.input, Number.isFinite(s.usage.cacheWrite) ? s.usage.cacheWrite : 0) : 0);
    output += s.usage.output;
    cacheRead += Number.isFinite(s.usage.cacheRead) ? s.usage.cacheRead : 0;
    cacheWrite += Number.isFinite(s.usage.cacheWrite) ? s.usage.cacheWrite : 0;
    // A cache count is NOT REPORTED when a call that used a prompt cache left it out. A call used a cache when it carried a count above zero, carried a marker (usage.cacheAsked) or was recorded as billed a write its response did not state
    // (usage.cacheCounts, src/chain.js). A call that carried no marker and no cache field above zero used none (an unmarked call with only zeros included): it is not a miss, so a run without caching keeps its totals and its token line exactly as they were. A count a call that used a cache REPORTED as zero is a
    // measurement, not a miss.
    const u = s.usage, hasRead = Number.isFinite(u.cacheRead), hasWrite = Number.isFinite(u.cacheWrite);
    if ((hasRead && u.cacheRead > 0) || (hasWrite && u.cacheWrite > 0) || u.cacheAsked || (u.cacheCounts && u.cacheCounts !== 'write-in-input')) {   // 'write-in-input' says the charge departed from a write count the reply carried: it does not make a call a cache user by itself
      if (hasRead) carriedRead = true; else notReported.add('read');
      if (hasWrite) carriedWrite = true; else notReported.add('write');
    }
    const c = costOf(s.provider, s.model, s.usage);
    // Money path #3 (Review/PreRelease_Audit_moneypath_2026-09-23.md): a stage's own `usd` is what it
    // really cost, including an Anthropic attempt thrown away when thinking ate the whole budget
    // (chain.js invoke(): usd = cost + wasted). Recomputing from the kept attempt's usage dropped
    // that attempt from report.totals.usd, the CLI's cost line, --spend and MCP.
    usd += Number.isFinite(s.usd) ? s.usd : c.usd;
    if (!c.priced) unpriced.add(`${s.provider}/${s.model}`);
  }
  // `input` is the part of the prompts that was NOT read from a cache and, for a direct Anthropic call and for a call recorded 'write-in-input', not written to one either (for an unmarked call that reports a write count the adapter does not subtract it, a marked call has it taken out, providers.js usageOfOpenAICompat); the cache counts are beside it, present only when a call used a cache (a run without caching keeps the totals it always had). `total` stays input + output.
  return { input, output, total: input + output, usd, unpriced: [...unpriced], ...(carriedRead ? { cacheRead } : {}), ...(carriedWrite ? { cacheWrite } : {}), ...(notReported.size ? { cacheNotReported: ['read', 'write'].filter(f => notReported.has(f)) } : {}) };
}

/** The run summary's token line (A-DRAFT, WORDING_0.8.4.md CACHE-A1): as it always was, and with the cache counts added only when a call used a cache. */
export function tokensLine(t) {
  const base = `${t.input} in, ${t.output} out, ${t.total} total`;
  const missing = Array.isArray(t.cacheNotReported) ? t.cacheNotReported : [];
  const has = n => Number.isFinite(n);
  if (!has(t.cacheRead) && !has(t.cacheWrite) && missing.length === 0) return base;
  // A count some cache-using call's response did not carry (totals.cacheNotReported, A-DRAFT CACHE-A11) is never printed as 0: a total that adds up only some of the calls says so, and a count no cache-using call carried says it was not reported.
  // A count every cache-using call carried is printed, a reported zero included; the totals hold a count whenever a cache-using call carried it.
  const part = (field, n, words) => (!has(n) ? `cache ${field} count not reported` : missing.includes(field) ? `${n} ${words} (where reported)` : `${n} ${words}`);
  return `${t.input} in, ${part('read', t.cacheRead, 'read from the cache')}, ${part('write', t.cacheWrite, 'written to the cache')}, ${t.output} out, ${t.total} total (the total leaves out the cache counts)`;
}

export function formatUsd(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'an unknown amount';   // never "$NaN" and never a throw: a figure that cannot be computed is said so (cost-unit gate page U1)
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Per-chain worst-case estimate, from the config's own declared token
// assumptions. Calls nothing, so it costs nothing. This is the one place that
// walks a chain's stage shape (questions/criteria/skeleton/proposals/debate/
// panel rounds/handoff) to price it - `--dry-run` and `council doctor` both
// call this rather than each re-deriving the shape themselves.
// The typical output of one review by this seat, for the estimate only (0.7.8). The chain's flat
// estimate.critiqueTokens (5000 in plan-premium-7) was one number for every reviewer, but reasoning
// models spend most of a review thinking: premium-7's Fable seat was projected at ~$0.45 a round and
// really cost ~$1.04 (thc-research brief 08), and its GLM seat ran to its 36000 cap. Now, in order:
//   1. the seat's own `estimate.critiqueTokens`, when its chain sets one (configurable per seat);
//   2. otherwise the larger of the chain's figure and the model's measured typical review output
//      (pricing.json `critiqueTokens`, from real runs) - it can raise the chain's figure, never
//      lower it;
// and never more than the seat's review cap (panelMaxTokens, else maxTokens), which it cannot
// exceed. Since 27 Okt 2026 the spend cap's pre-call gate decides on this size too (expectedOutputTokensOf); the worst case a call reserves still projects the full maxTokens.
export function critiqueTokensFor(seat, chainCritiqueTokens) {
  const cap = seat?.panelMaxTokens ?? seat?.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
  const own = seat?.estimate?.critiqueTokens;
  if (Number.isInteger(own) && own >= 0) return Math.min(own, cap);
  const measured = seat && seat.provider !== 'external' ? priceOf(seat.provider, seat.model)?.critiqueTokens : null;
  return Math.min(Math.max(chainCritiqueTokens, Number.isInteger(measured) ? measured : 0), cap);
}

// The token sizes a chain with no `estimate` block is priced at. One definition: the dry run's reprice with the task reads it too
// (0.8.1 FX-3: it spread an empty estimate instead and summed NaN).
export const DEFAULT_ESTIMATE = Object.freeze({ promptTokens: 4000, draftTokens: 6000, critiqueTokens: 1200 });

/** Does this dry-run row count in one cap's figure? With no cap, every row; with a cap, the rows that bill through it (`account`) and the rows that belong to every cap (`allCaps`: the network retries, bounded per run). */
export function rowBillsThroughCap(row, capName) { return !capName || row.account === capName || row.allCaps === true; }

// 0.8.4 unit 4: two bounds the dry run's MAXIMUM figure prices repeats with, defined once so the figure and the run cannot drift (test/dry-run-repeats.test.js pins both against src/chain.js).
// NETWORK_RESUMES_PER_RUN: a dropped connection is asked again at most this many times in a RUN, whichever calls they fall on (his decision 9 of 28 Okt: "up to 3, counted and bounded"). It is the bound; chain.js's
// NETWORK_RESUME_GUARD (2) is a different thing, a stop for a call that keeps failing, not a retry count. IN_PASS_REASKS_PER_SEAT: a judge that was not heard is asked again at most this many times in a pass (chain.js `reask <= 2`).
export const NETWORK_RESUMES_PER_RUN = 3;
export const IN_PASS_REASKS_PER_SEAT = 2;
/** 0.8.4 (ladder unit, silent judges): the ONE solo call a judge that is still silent after its re-asks gets, on its own, inside the pass (label `-solo`). Priced at the re-ask price in the maximum figure; the layer waits for it. */
export const SOLO_ASKS_PER_SEAT = 1;

/** 0.8.4 (ladder unit, commit 7; Muad 10 Nov 2026, "7 reads upper figure, 3 expected ... we can update once we have more runs"): the price preview of a LADDER chain, one number for every ladder chain. A ladder run has no overseer-round count, so both figures need a basis; it is stated in READS (one read = one top-layer visit; the read that signs off counts).
 *  UPPER: PREVIEW_READS_UPPER reads, each climb with the full ladder below it (layer 1 in blocks of `block`, `visits` layer-2 visits) - an ASSUMPTION, not a limit; a number the person types with --rounds (the run's own limit on top-layer reads) replaces it.
 *  EXPECTED: PREVIEW_READS_EXPECTED reads (or the typed number when lower), each climb at PREVIEW_EXPECTED_CLIMB: the average of the one measured run (B3 run 5: 45 layer-1 and 8 layer-2 passes over its 6 climbs = 7.5 and 1.3), rounded. Only one run was measured; the figures are updated once there are more. */
export const PREVIEW_READS_UPPER = 7;
export const PREVIEW_READS_EXPECTED = 3;
export const PREVIEW_EXPECTED_CLIMB = Object.freeze({ 1: 8, 2: 1 });
/** A-DRAFT (WORDING LAD-R38): what the EXPECTED figure of a ladder chain counts, for the dry run's sentence. '' for a chain that is not a ladder chain. */
export const ladderExpectedWords = (limits, typedReads = null) => { const p = previewOfLadder(limits, false, typedReads); return p ? `${p.reads} top-layer read${p.reads === 1 ? '' : 's'} (the read that signs off counts), each after a climb of about ${p.climb[1]} layer-1 passes and ${p.climb[2]} layer-2 pass with one exchange round each (the average of one measured run, a typical shape and not a promise; a clean first climb stops early and costs less)` : ''; };
/** A-DRAFT (WORDING LAD-R38): what the UPPER figure of a ladder chain assumes, for the dry run's sentence. '' for a chain that is not a ladder chain. */
export const ladderUpperWords = (limits, typedReads = null) => { const p = previewOfLadder(limits, true, typedReads); return p ? `${p.reads} top-layer read${p.reads === 1 ? '' : 's'}${p.assumed ? ' (an assumption, not a limit: a number you type with --rounds replaces it)' : ' (the number you typed with --rounds)'}, each with the full ladder below it (layer 1 in blocks of ${limits.ladder.block}, ${limits.ladder.visits} layer-2 visits), every allowed layer-1 exchange round, and the in-pass re-asks and the solo ask at the review's expected cost` : ''; };
/** { reads, climb: { 1, 2 }, assumed } for a ladder chain (`limits` from roundLimitsOf), or null when the chain is not one. `assumed`: the upper figure's number of reads is the assumption (not typed).
 *  `typedReads` (0.8.4, the --rounds fix-up, C&C ruling 11 Nov 2026): the number of top-layer reads the RUN is bound by, when a person typed one (`--rounds N` on a ladder run is his own bound: the run stops after N top-layer reads and asks; src/ladder-resume.js ladderBoundOf, read through src/cli.js ladderTypedReads) or a resumed run saved one. The caller that prices that run passes it; null = none. Precedence: typedReads, else the chain's own `maxRounds` (limits.passes, as before), else the assumption (7 upper, 3 expected). */
export function previewOfLadder(limits, maximum, typedReads = null) {
  const key = limits?.ladder; if (!key) return null;
  const typed = Number.isInteger(typedReads) && typedReads >= 1 ? typedReads : Number.isInteger(limits.passes) && limits.passes >= 1 ? limits.passes : null;
  return {
    reads: maximum ? (typed ?? PREVIEW_READS_UPPER) : Math.min(PREVIEW_READS_EXPECTED, typed ?? PREVIEW_READS_EXPECTED),
    // the expected climb never counts more passes per read than the chain's own ladder allows (the upper climb), so on any accepted ladder (block and visits >= 1) the expected figure is never above the upper one
    climb: maximum ? { 1: key.block * (key.visits + 1), 2: key.visits } : { 1: Math.min(PREVIEW_EXPECTED_CLIMB[1], key.block * (key.visits + 1)), 2: Math.min(PREVIEW_EXPECTED_CLIMB[2], key.visits) },
    assumed: maximum && typed === null,
  };
}

// The typical output of the planned calls whose size is a fixed number (tokens), where the chain's `estimate` block has no key for them. One table for the two readers:
// the dry run's expected figure (estimateChainRows below) and invoke()'s pre-call spend gate (src/chain.js, through expectedOutputTokensOf; owner, 27 Okt 2026), so the
// two cannot drift. The values are the literals estimateChainRows priced with before 27 Okt 2026, unchanged (debate/reply/alt-debate/alt-reply: the 7 Oct 2026 derivation, see stageOutOf).
export const TYPICAL_OUTPUT_TOKENS = Object.freeze({ ambiguity: 800, preflight: 800, questions: 800, criteria: 400, skeleton: 1200, judge: 300, debate: 1500, reply: 800, altDebate: 1500, altReply: 800, canaryReply: 800, handoff: 1200, argued: 1500 });

// The seven `estimate` keys that size one kind of call's typical output (0.8.3 estimator unit, 15 Oct 2026): a key counts when it is a finite number above 0. Shared by the expected figure and the gate.
const estimateKeyOf = (estimate, key) => (Number.isFinite(estimate?.[key]) && estimate[key] > 0 ? estimate[key] : null);
// alternativeOutTokens, proposalOutTokens, deepDiveOutTokens, notesAnswerOutTokens: absent = the call's own cap; set = min(key, cap).
function typicalOutOf(estimate, key, cap) { const k = estimateKeyOf(estimate, key); return k === null ? cap : Math.min(k, cap); }
// debateOutTokens, replyOutTokens, altDebateOutTokens, altReplyOutTokens: absent = the constant the expected figure always used; set = min(key, the seat's cap).
function stageOutOf(estimate, key, seat, constant) { const k = estimateKeyOf(estimate, key); return k === null ? constant : Math.min(k, seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS); }

/**
 * The output one call is EXPECTED to write, in tokens: the size the dry run's expected figure (estimateChainRows, not `maximum`) gives the planned call of that kind - the
 * same table, the same `estimate` keys and fallbacks, critiqueTokensFor for a review - looked up by the call's stage label, and never above the call's own cap (a call
 * cannot write more than its cap; the estimator's fixed sizes are not clamped, e.g. criteria's 400 on a 100-token seat). `seat` is the seat as the call is asked: its
 * maxTokens is already the stage's cap (a proposal's, an alternative's, a panel review's panelMaxTokens), as chain.js passes it to invoke().
 * null for a call the dry run does not plan - a cut-off or unreadable retry (`-retry`), a re-ask (`-reask<n>`, `-answered`, `-question`), a merge, a `-full` revise, the
 * conflict decider, the allocator, a descending stage, any label not named here: the estimator has no expected size for those (its own rule: "Calls the plan does not
 * list are not in it either way. The cap stops those."), so the gate keeps their worst case. Also null for a size that is not a number >= 0 (a malformed estimate block).
 */
export function expectedOutputTokensOf(label, seat, estimate = {}) {
  if (typeof label !== 'string' || !seat) return null;
  if (/-(retry|merge|full|question|answered)$/.test(label) || /-(reask\d+|solo)(-|$)/.test(label)) return null;
  const a = { ...DEFAULT_ESTIMATE, ...(estimate || {}) };
  const cap = seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
  const T = TYPICAL_OUTPUT_TOKENS;
  const exact = {
    questions: T.questions, criteria: T.criteria, skeleton: T.skeleton, handoff: T.handoff, [ARGUED_LABEL]: T.argued,
    build: a.draftTokens, final: a.draftTokens, dispute: a.draftTokens, 'challenge-revise': a.draftTokens, 'deep-dive-revise': a.draftTokens,
    claims: a.critiqueTokens, challenge: a.critiqueTokens, 'cold-read': a.critiqueTokens, [SECURITY_REVIEW_LABEL]: a.critiqueTokens,
    'notes-answer': typicalOutOf(estimate, 'notesAnswerOutTokens', cap),
  };
  let out;
  if (Object.hasOwn(exact, label)) out = exact[label];
  else if (/^revise-(\d+|all)$/.test(label)) out = a.draftTokens;
  else if (/^(panel|dispute-review|final-read)-./.test(label) || /^critique-\d+$/.test(label)) out = critiqueTokensFor(seat, a.critiqueTokens);
  else if (/^rule-\d+-./.test(label)) out = critiqueTokensFor(seat, a.critiqueTokens);   // stall escalation: a floor-layer seat's ruling on the passed-up objections is a judge's short JSON verdict, sized like its review (the dry run does not list it: it is conditional, like the decider)
  else if (/^(ldebate|lreply)-(\d+|end)(-x\d+)?-./.test(label)) out = critiqueTokensFor(seat, a.critiqueTokens);   // a layer exchange's post and answer (0.8.4), the ending exchange's too (round "end": ldebate-end-...): the figure the dry run prices these rows at (pushExchangeRows: reviewOut). The size was not measured on an ending exchange: it is the review size of the seat, as for the exchange of a pass.
  else if (label.startsWith('ambiguity-')) out = T.ambiguity;
  else if (label.startsWith('preflight-')) out = T.preflight;
  else if (label.startsWith('alternative-')) out = typicalOutOf(estimate, 'alternativeOutTokens', cap);
  else if (label.startsWith('alt-debate-')) out = stageOutOf(estimate, 'altDebateOutTokens', seat, T.altDebate);
  else if (label.startsWith('alt-reply-')) out = stageOutOf(estimate, 'altReplyOutTokens', seat, T.altReply);
  else if (label.startsWith('propose-')) out = typicalOutOf(estimate, 'proposalOutTokens', cap);
  else if (label.startsWith('judge-')) out = T.judge;
  else if (label.startsWith('debate-')) out = stageOutOf(estimate, 'debateOutTokens', seat, T.debate);
  else if (label.startsWith('reply-')) out = stageOutOf(estimate, 'replyOutTokens', seat, T.reply);
  else if (label.startsWith('canary-reply-')) out = T.canaryReply;
  else if (/^deep-dive-.+-\d+$/.test(label)) out = typicalOutOf(estimate, 'deepDiveOutTokens', cap);
  else return null;
  if (!(typeof out === 'number' && Number.isFinite(out) && out >= 0)) return null;
  return Math.min(out, cap);
}

/**
 * The EXPECTED cost of one call in dollars, the figure invoke()'s pre-call spend gate decides on (owner, 27 Okt 2026): the call's real prompt as input (four characters a
 * token, as the worst case counts it) and expectedOutputTokensOf as output, ONE attempt (the dry run's expected figure prices no Anthropic retry), at the price the worst
 * case uses (worstCaseOf: the table row, raised per field by the seat's own pin, never lowered). null when the call has no expected size: the caller uses the worst case.
 * Never above projectStage for the same call (the same input and price, an output no bigger than the cap, one attempt of at most two).
 */
export function expectedCallUsd(seat, { system = '', user = '', label, estimate = {}, cache = null } = {}) {
  const out = expectedOutputTokensOf(label, seat, estimate);
  if (out === null) return null;
  return usdAtOutput(seat, { system, user, cache }, out);
}
// The price of ONE attempt of this call's prompt with `out` tokens written: the one place the expected figure and the typical charge below are priced, so they cannot drift.
function usdAtOutput(seat, { system, user, cache }, out) {
  const promptChars = promptCharsOf({ system, user });
  return worstCaseOf(seat.provider, seat.model, { promptChars, maxTokens: out, pin: ownPinOf(seat), cache: cache ? { headTokens: Math.ceil(cache.headChars / CHARS_PER_TOKEN), ttl: cache.ttl } : null }).usd;
}

/**
 * 0.8.4 unit 3 (D43; his decision 2 of 28 Okt 2026, heading "TWO COST PICKS ...": an error reply that carries none is "charged at a typical cost for that call"). A call's label without its
 * attempt endings: `panel-1-opus-reask1-retry` -> `panel-1-opus`, `build-retry` -> `build`. The same strip src/spans.js baseSeatLabel makes (test/typical-charge.test.js pins that the two agree).
 */
export function baseLabelOf(label) { return String(label).replace(/(-(retry|answered|question|reask\d+|solo))+$/, ''); }

/**
 * 0.8.4 unit 4 (his pick OWNER 6, 03 Nov 2026: "Re-asks and retries are checked at the expected size of the call they repeat"): the gate's expected cost of a REPEAT of a call - a re-ask (`-reask<n>`) or a
 * `-retry` - is the expected cost of the call it repeats, priced on the repeat's own prompt. null for a label that is not a repeat, and for a repeat of a call that has
 * no expected size either (a merge, a full revise, the conflict decider, the allocator, an unnamed label): those stay gated at their worst case, as before. This is the gate's figure only: the
 * reservation on disk stays the worst case, and the after-call charge is typicalCallUsd's.
 */
export function repeatExpectedCallUsd(seat, opts = {}) {
  // Only the endings the upper estimate prices too: a re-ask (`-reask<n>`) and a `-retry`. An `-answered` or `-question` call (an answer-back) is not a re-ask and keeps its worst case at the gate.
  const base = typeof opts.label === 'string' ? opts.label.replace(/(-(retry|reask\d+|solo))+$/, '') : null;
  if (base === null || base === opts.label) return null;
  return expectedCallUsd(seat, { ...opts, label: base });
}

/**
 * The output one call is TYPICALLY charged for when its reply was an error with no usage figure, in tokens (D43 option A, plan A l.1411): the expected size of the call's BASE label
 * (the dry run's own figure, expectedOutputTokensOf, so a re-ask or a thinking retry is charged like the call it repeats); where the base label has no expected size either (a merge, a
 * full revise, the conflict decider, the allocator, a label the table does not name) a typical size for what the call writes - the draft size (`draftTokens`) for a merge or a full revise,
 * which write a whole draft, and the critique size (`critiqueTokens`, the size the table gives `claims` and `challenge`) for the rest (that these calls write those kinds of reply is
 * an inference from their names). Never above the call's own cap. Used for the CHARGE only: the gate keeps its figure and the dry run's table is unchanged. null only for a seat or
 * a label that is not a string.
 */
export function typicalOutputTokensOf(label, seat, estimate = {}) {
  if (typeof label !== 'string' || !seat) return null;
  const base = baseLabelOf(label);
  const known = expectedOutputTokensOf(base, seat, estimate);
  if (known !== null) return known;
  const a = { ...DEFAULT_ESTIMATE, ...(estimate || {}) };
  const cap = seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
  const out = /-(merge|full)$/.test(base) ? a.draftTokens : a.critiqueTokens;
  return Number.isFinite(out) && out >= 0 ? Math.min(out, cap) : Math.min(DEFAULT_ESTIMATE.critiqueTokens, cap);
}

/**
 * The typical charge of one attempt of this call, in dollars: its real prompt as input and typicalOutputTokensOf as output, at the price the worst case uses, the same estimator as the
 * gate's expected cost (so a call with an expected size is charged exactly that, and an empty error reply and a network retry of the same call carry the same amount: plan A T6). Capped at
 * `ceilingUsd` when given (the attempt's own worst case). This is the ONE function a typical charge comes from; src/chain.js's 5xx seam (httpErrorAttemptSettlement) receives the figure
 * as `typical` and returns it (his pick of 04 Nov 2026, "typical cost"). null when the seat or label is unusable.
 */
export function typicalCallUsd(seat, { system = '', user = '', label, estimate = {}, cache = null, ceilingUsd = null } = {}) {
  const out = typicalOutputTokensOf(label, seat, estimate);
  if (out === null) return null;
  const usd = usdAtOutput(seat, { system, user, cache }, out);
  return Number.isFinite(ceilingUsd) && ceilingUsd >= 0 ? Math.min(usd, ceilingUsd) : usd;
}

// `maximum: true` (0.8.2 item 8c; ChatGPT review 1 #5, owner 7 Oct 2026) prices the SAME planned calls at their whole output allowance instead of the typical output: each row's output is the call's own cap
// (the seat's maxTokens, its panelMaxTokens for a review, the stage's own smaller cap for proposals and architectures) and an Anthropic seat's one same-effort retry is added, as the spend cap's projection
// (projectAttempts) does. Calls the plan does not list are not in it either way: a re-ask of a refused table, the cut-off retry of a seat that is not Anthropic, an answer-back call. The cap stops those.
export function estimateChainRows(config, { fromRun = false, maximum = false, accounts = false, typedReads = null } = {}) {   // accounts (DUALCAP milestone 2): each row also names the per-provider cap its call bills through (billingAccountOf), for the limit screen's per-cap figure; off: the rows are unchanged
  // A partial estimate block is filled from the defaults (M2 review: { promptTokens } alone priced NaN).
  const a = { ...DEFAULT_ESTIMATE, ...(config.estimate || {}) };
  const reviewOut = seat => critiqueTokensFor(seat, a.critiqueTokens);
  // Typical output sizes (0.8.3 estimator unit, 15 Oct 2026): the EXPECTED figure prices alternatives, proposals and deep-dive calls at the chain's typical size when `estimate.alternativeOutTokens` / `proposalOutTokens` / `deepDiveOutTokens` is set
  // (never above the call's own cap), and at the whole cap when the key is absent - today's behaviour, byte for byte. The MAXIMUM figure always uses the caps. The keys change only what is PRINTED; the runtime cap is the seat's maxTokens
  // and alternatives.maxTokens, which these keys never touch. Calibration is the chain author's: a dated derivation in the chain's description (src/cost.js is not told where the number came from).
  const typicalOut = (key, cap) => (maximum ? cap : typicalOutOf(config.estimate, key, cap));
  // The debate, reply, alt-debate and alt-reply calls (0.8.3 estimator follow-up, 15 Oct 2026; C&C PASS ON CONDITIONS): ONE rule for all seven `estimate` keys, "absent = today's figure". The first three keys fall back to the cap (typicalOut above);
  // these four fall back to the CONSTANT the expected figure always used (1500 / 800 / 1500 / 800). A valid key prices the call at min(key, the seat's cap) - the cap the maximum pass uses, `seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS`.
  // The MAXIMUM pass ignores `output` for these rows (push takes the seat cap), so the maximum is untouched. External seats are priced $0 either way. The 7 Oct 2026 derivation of typical sizes is the chain author's (est_calib_7oct.py).
  const stageOut = (key, seat, constant) => (maximum ? constant : stageOutOf(config.estimate, key, seat, constant));
  const rows = [];
  // `times` (round-semantics 2a): one row stands for that many identical calls; input, output and usd are the TOTALS of the repeats (so every sum over rows stays right) and the row carries `times`. Absent for a single call.
  // 0.8.3 estimator unit (C&C thcmcp-6d, 19 Okt 2026): every row's input also carries the SYSTEM text its call will send, from the one place that composes it (src/stage-system.js systemTextsFor; the LONGEST text a
  // row can send is priced), counted with the estimator invoke() projects with (estimateTokens: characters / 4). Before this, a row priced only the declared sizes, so a grant sized from the figure could be smaller
  // than the projection of the real call (tree-whole-mock legs 9, 9b, 10 stopped at their cap). The advise rows add their own system text and are skipped there. The USER side stays declared.
  const systemTokens = (label, seat) => Math.max(0, ...systemTextsFor(label, config, seat).map(estimateTokens));
  // 0.8.4 cache part (b)1, the cache-shaped order. (1) LEAD-IN: with the order live for a seat, every judge call (panel, post, answer, the final read, the first-mode critic) carries its lead-in ahead of the instructions: a few tokens
  // on every such row, marked or not. (2) THE MARK RULE (src/cache-order-gate.js markTtlOf), priced per (seat, pass) group in BOTH figures: the first marked call of a group (the panel; the first post of the ending exchange) at the WRITE
  // price of the lifetime, every later call of the group (the exchange rounds, the in-pass re-asks) at the READ price. The head is the seat's one system text (welcome + persona block) and the plan (request, criteria, draft): `markFor`.
  const leadInKindOf = label => (/^ldebate-/.test(label) ? 'post' : /^lreply-/.test(label) ? 'answer' : /^(panel|critique|final-read)-/.test(label) ? 'panel' : null);
  const leadInTokens = (label, seat) => {
    const kind = leadInKindOf(label ?? '');
    const lead = kind && seat && cacheOrderSeat(config, seat) ? held('judgeKindLeadIn') : null;
    return typeof lead === 'function' ? estimateTokens(`${lead({ kind })}\n\n`) : 0;
  };
  // The order puts the draft boundary's lines into the exchange prompts too (H is the verdict prompts' head for every call kind, src/cache-order.js neutralHeadOf): the kind-neutral sentence and start line in front of the draft, the end line behind it.
  // A row of an order-live seat counts them where the order adds them to that prompt: the exchange rows (ldebate, lreply), the panel review, its in-pass re-ask, the sign-off re-ask, the `-solo` ask, the first-mode critique and the final read
  // (0.8.4 boundary fix-up; before it only the exchange rows did; the per-kind bar is test/cost-boundary-panel-kinds.test.js). The mark's head holds them too, for every marked kind (markFor's default `extra`): the order sends ONE neutral head
  // H whose last line is the end line, in front of the mark, whatever the call kind. The checks block (criteria_kinds) is added the same way and is NOT counted: its size depends on the criteria of the task, which the estimate does not read.
  const boundaryTokens = seat => {
    if (!seat || !cacheOrderSeat(config, seat) || !draftBoundaryOn(config)) return 0;
    const [sentence, start, end] = [held('draftBoundarySentenceNeutral'), held('draftStartLine'), held('draftEndLineNeutral')].map(f => (typeof f === 'function' ? f() : ''));
    return estimateTokens(`${sentence}\n\n${start}\n\n\n\n${end}`);
  };
  const markFor = (seat, { read = false, extra = boundaryTokens(seat) } = {}) => {
    const ttl = markTtlOf(config, seat);
    return ttl ? { headTokens: a.promptTokens + a.draftTokens + extra + estimateTokens(withoutNotes(() => judgeSystemR1(seat, config))), ttl, ...(read ? { read: true } : {}) } : null;
  };
  // The EXPECTED figure's input dollars (the maximum prices through worstCaseOf): a marked row splits its input into the head (write or read multiple of the model) and the rest (the plain price).
  const inputUsdOf = (seat, p, input, cache) => {
    if (!cache) return (input / 1e6) * p.in * cacheInputMultOf(seat.provider, seat.model);   // 3b: a selected seat's input is billed as a write
    const head = Math.min(input, Math.max(0, Math.ceil(cache.headTokens ?? 0)));
    const mults = cacheMultsOfCall(seat.provider, seat.model, priceAt(seat.provider, seat.model, input), cache.ttl), mult = cache.read === true ? mults.read : mults.write;
    return ((input - head) / 1e6) * p.in + (head / 1e6) * p.in * mult;
  };
  const accountField = seat => { if (!accounts) return {}; const account = billingAccountOf(seat); return account ? { account } : {}; };
  const push = (label, seat, input, output, callCap, times = 1, cache = null) => {   // cache: { headTokens, ttl, read? } for a call that carries a prompt-cache marker (both figures since the cache-shaped order; the unrecorded state's ruling-B rows are still the maximum's only)
    if (!seat) return;
    input += systemTokens(label, seat) + leadInTokens(label, seat);
    const external = seat.provider === 'external';
    const p = external ? { in: 0, out: 0 } : priceOf(seat.provider, seat.model);
    if (maximum && !external) {
      const out = callCap ?? seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
      const att = p ? projectAttemptsTokens(seat, { inputTokens: input, maxTokens: out, cache }) : { first: 0, retry: 0 };
      rows.push({ label, seat: `${seat.provider}/${seat.model}`, ...accountField(seat), input: input * times, output: out * times, usd: (att.first + att.retry) * times, priced: !!p, ...(times > 1 ? { times } : {}) });
      return;
    }
    const usd = p ? inputUsdOf(seat, p, input, cache) + (output / 1e6) * p.out : 0;   // 3b: a selected seat's input is billed as a write; a marked row (the order's mark rule) splits its input into the head and the rest
    rows.push({ label, seat: `${seat.provider}/${seat.model}`, ...accountField(seat), input: input * times, output: output * times, usd: usd * times, priced: !!p, ...(times > 1 ? { times } : {}) });
  };
  // 0.8.4 unit 4 (his picks OWNER 5 and 6, 03 Nov 2026, heading "PLAN A'S OWNER ITEMS ..."): rows the MAXIMUM figure adds at the EXPECTED cost of the call they repeat, not at its cap: a silent judge's re-asks and the automatic
  // retries after a network error. push() prices a maximum row at the call's whole allowance (and an Anthropic seat's retry), so these go through here; `systemLabel` is the label whose system text the repeat carries.
  const pushExpected = (label, seat, input, output, times, systemLabel, cache = null) => {   // cache: as in push (a re-ask of a marked group reads what the group wrote)
    if (!seat) return;
    input += systemTokens(systemLabel, seat) + leadInTokens(systemLabel, seat);
    const external = seat.provider === 'external';
    const p = external ? { in: 0, out: 0 } : priceOf(seat.provider, seat.model);
    const usd = p ? inputUsdOf(seat, p, input, cache) + (output / 1e6) * p.out : 0;   // 3b: a selected seat's input is billed as a write
    if (!(usd > 0) && p) return;   // a free or external seat adds no dollar: no row (an UNPRICED seat keeps its row, shown as unpriced like every other row of it)
    rows.push({ label, seat: `${seat.provider}/${seat.model}`, ...accountField(seat), input: input * times, output: output * times, usd: usd * times, priced: !!p, ...(times > 1 ? { times } : {}) });
  };
  // A review's own output cap in the UNANIMOUS panel: panelMaxTokens when the seat sets one, else its maxTokens (chain.js, the panel stage). First-mode critiques and dispute reviews call at maxTokens.
  const reviewCap = seat => seat?.panelMaxTokens ?? seat?.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
  // 0.8.4 S4b (C&C's item 4): the rows of ONE exchange, one definition for the ordinary exchange of a pass and for the ending exchange: per judge a post row and an answer row for `exchangeRounds` rounds on `times` passes. With the prompt cache on (the maximum
  // figure, a seat that calls Anthropic directly; ruling B) round 1 is not marked and rounds 2..R are, each projected with the plan (and the system text) at the write price; otherwise every round is one row. `labelOf(kind, critic)` names a row;
  // `extraTokens(kind, critic, label)` adds input that the label's recorded system text does not carry (the ending exchange's last round). The ordinary exchange passes none: its rows are what they were.
  const pushExchangeRows = (judges, { labelOf, times, exchangeRounds, cacheTtl, extraTokens = () => 0, groupStart = false }) => {   // groupStart: the exchange is the first call of its group (the ending exchange has no panel before it)
    for (const critic of judges) {
      for (const kind of ['ldebate', 'lreply']) {
        const label = labelOf(kind, critic);
        const extra = extraTokens(kind, critic, label);
        const input = a.promptTokens + a.draftTokens + 400 * Math.max(judges.length - 1, 1) + extra;
        if (cacheOrderSeat(config, critic)) {
          // THE ORDER IS LIVE for this seat: ruling B's rows do not exist (its marks are not sent). A marked seat (markTtlOf): the panel before the exchange wrote the group's entry, so every post and answer round reads it; in the ending exchange the
          // first post writes it. An unmarked seat (single by shape, or not a direct Anthropic seat): plain rows. The draft boundary's lines are part of the prompt now and of its head (boundaryTokens).
          const orderInput = input + boundaryTokens(critic), mark = (opts = {}) => markFor(critic, { ...opts, extra: boundaryTokens(critic) });
          if (mark()) {
            if (groupStart && kind === 'ldebate') {
              push(label, critic, orderInput, reviewOut(critic), reviewCap(critic), times, mark());
              if (exchangeRounds > 1) push(`${label}-x2`, critic, orderInput, reviewOut(critic), reviewCap(critic), times * (exchangeRounds - 1), mark({ read: true }));
            } else push(label, critic, orderInput, reviewOut(critic), reviewCap(critic), times * exchangeRounds, mark({ read: true }));
          } else push(label, critic, orderInput, reviewOut(critic), reviewCap(critic), times * exchangeRounds);
        } else if (cacheTtl && isDirectAnthropicSeat(critic) && exchangeCallCarriesHead({ ttl: cacheTtl, k: 2, rounds: exchangeRounds })) {
          // ruling B: round 1 is not marked; rounds 2..R are. THE FIRST marked round of a seat's pass (round 2) writes the entry, so it is projected with the plan (and the system text) at the WRITE price; rounds 3..R read that entry, so they are
          // projected with it at the READ price (C&C 09 Nov 2026: the estimate prices what the group of calls costs, it does not add 'every call misses'; the per-call guard before each send, invoke(), still prices a marked call's head at the write price).
          const headTokens = a.promptTokens + a.draftTokens + extra + estimateTokens(systemTextsFor(label, config, critic).sort((x, y) => y.length - x.length)[0] ?? '');
          push(label, critic, input, reviewOut(critic), reviewCap(critic), times);
          push(`${label}-x2`, critic, input, reviewOut(critic), reviewCap(critic), times, { headTokens, ttl: cacheTtl });
          push(`${label}-x3`, critic, input, reviewOut(critic), reviewCap(critic), times * (exchangeRounds - 2), { headTokens, ttl: cacheTtl, read: true });
        } else push(label, critic, input, reviewOut(critic), reviewCap(critic), times * exchangeRounds);
      }
    }
  };
  // 0.8.4 S6 (Q5, Q8; MONEY): the SHORTENED exchange of the layers above the lowest, once the pair W5 + W14 is recorded: ONE round, a post row and an answer row per judge (2K rows) of each such layer that has two or more judges, on the same pass count as that layer's reviews
  // (the layers a pass reaches are not predicted: like the lowest layer's rows, the figure counts the calls the pass COULD make). The text each row carries is the label's recorded system text, which already includes the W5 and W14 tails (src/stage-system.js). Held: no layer, no row.
  const upperExchangeLayers = () => {
    const critics = config.seats.critics || [];
    if (!shortExchangeOn() || !critics.length || !critics.every(c => Number.isInteger(c.layer))) return [];
    const low = Math.min(...critics.map(c => c.layer));
    return [...new Set(critics.map(c => c.layer))].filter(l => l > low && critics.filter(c => c.layer === l).length >= 2).sort((x, y) => x - y);
  };
  // 0.8.4 S6 (G7, Q8; MONEY): the ONE extra verdict call a top-layer judge gets when its reply to the exchange ended with "sign-off: no" and nothing of its own stands (src/chain.js refusedSignoffs, label ending -reask<IN_PASS_REASKS_PER_SEAT + 1>). In the MAXIMUM only, like the in-pass re-asks, at the
  // review's EXPECTED cost (the price of a repeat, OWNER 6) plus the tokens of the held note it carries; one per top-layer judge per visit of the top layer. The unheard re-ask PASSES stay out of it (one definition across chains). Needs the exchange at the top layer (two judges there) and the note recorded.
  // 0.8.4 S8 (money step): the SORT LIST. A top-layer verdict (and the final read) is shown the list of the open objections it sorts: input only, no extra call. MAXIMUM only: about 400 tokens per judge BELOW the top layer (one standing objection each), the unit of the
  // go-up's `400 x K2`, S7b's `400 x K1` and S7c's `400 x K3` above: an APPROXIMATION, the same kind as those. The real bound is the number of open objections times the field cap every critic field is read at (chain.js CRITIC_FIELD_MAX_CHARS, 8000 characters), and a judge holding several objections
  // exceeds the unit; the list also holds the top layer's own objections and, at the final read, the late findings, which this unit leaves out (named). The text is printed whole (nothing is cut), so no cut figure enters it. Output is not a term: the MAXIMUM prices a review at the seat's whole cap (`reviewCap`), which holds the sorting rows.
  // Gate = the send, term for term: a panel row only for a seat chain.js asks to sort (src/stage-system.js climbSortingFor, the predicate panelPromptFor shares with the estimate's system text), the final-read rows only while src/sorting.js sortingOn holds. The EXPECTED figure never moves for the LIST; once the three S8 words are recorded the top seats' SYSTEM text (W7 and the reply form) is priced through the RULES rows and moves both figures. Held: nothing moves.
  const sortLowerK = (config.seats.critics || []).filter(c => c.layer < Math.max(...(config.seats.critics || []).map(x => x.layer))).length;
  const sortGainOf = critic => (maximum && climbSortingFor(critic, config) ? 400 * sortLowerK : 0);
  const sortReadGain = maximum && sortingOn(config) ? 400 * sortLowerK : 0;
  const finalReadWordsGain = maximum && sortingOn(config) && finalReadWordsOn() ? Math.ceil(held('finalReadRule')({ read: true }).length / 4) : 0;   // 0.8.4 S16 (G2a): W31's words in each final-read prompt (priced in the maximum under the same gate as the S8 allowance above; the cap itself projects the real prompt)
  const signoffReaskRows = (nameOf, timesOfTop) => {
    if (!maximum || !signoffRefusalOn()) return;
    const critics = config.seats.critics || [];
    const top = Math.max(...critics.map(c => c.layer));
    if (!upperExchangeLayers().includes(top)) return;
    const noteTokens = estimateTokens(held('signoffRefusedReaskNote')());
    for (const critic of critics.filter(c => c.layer === top)) { const name = nameOf(critic); pushExpected(`${name}-reask${IN_PASS_REASKS_PER_SEAT + 1}`, critic, a.promptTokens + a.draftTokens + noteTokens + sortGainOf(critic) + boundaryTokens(critic), reviewOut(critic), timesOfTop, name, markFor(critic, { read: true })); }   // the G7 re-ask is a panel-kind call of the same group: it reads what the group wrote
  };
  // Pre-release audit 2026-09-23 (lint #3): the optional stages below were paid at run time but
  // never priced here, so `--dry-run` and `council doctor` under-stated a chain that enabled them.
  // Seat choice and gating mirror chain.js exactly (same fallbacks), so the rows appear only when
  // the run would really make those calls. `descending` chains run a different stage shape and are
  // still priced as a normal chain - a known gap, not closed here.
  const lab = seat => seat.lab || seat.provider;
  // 0.8.4 seats unit: two seats of ONE model on ONE layer (plan-claude-council) must not share a row: the second, third ... seat of a layer gets `-<n>` after its lab; a seat that is alone with its model on its layer keeps the plain lab, so every existing row label stays as it was.
  const sameLayerNo = sameLayerOrdinals(config.seats?.critics);
  const nameOf = critic => `${critic.lab || critic.provider}${(sameLayerNo.get(critic) ?? 1) > 1 ? `-${sameLayerNo.get(critic)}` : ''}`;
  // the seat keys of a repeated model, computed here without registering them (registering clears the keys of a run that may be going on): the dispute review's row label is the label the run uses, `dispute-review-<seat key>`
  const keysHere = new Map(); for (const r of repeatedLabsOf(config.seats?.critics)) if (r.keys) for (const [s, k] of r.keys) keysHere.set(s, k);
  const keyNameOf = critic => keysHere.get(critic) ?? seatKeyOf(critic);
  // the rule-bound and rule-go-up rows keep the label they always had: the registered seat key when it differs from the lab (a model on a second layer), else the lab; only a same-layer twin that no key has been registered for gets the `-<n>` of nameOf, so two twins never share a row
  const ruleNameOf = critic => (seatKeyOf(critic) !== (critic.lab || critic.provider) ? seatKeyOf(critic) : nameOf(critic));
  if (config.ambiguity_union?.enabled && !fromRun) {
    for (const seat of config.seats.ambiguity || (config.seats.critics || []).slice(0, 3)) push(`ambiguity-${lab(seat)}`, seat, a.promptTokens, TYPICAL_OUTPUT_TOKENS.ambiguity);
  }
  if (config.preflight && !fromRun) {
    const seats = (config.preflight.seats && config.preflight.seats.length) ? config.preflight.seats : (config.seats.critics || []);
    for (const seat of seats) push(`preflight-${lab(seat)}`, seat, a.promptTokens, TYPICAL_OUTPUT_TOKENS.preflight);
  }
  if (config.questions && !fromRun) push('questions', config.seats.questions || config.seats.criteria, a.promptTokens, TYPICAL_OUTPUT_TOKENS.questions);
  // A chain with hand-written criteria skips that stage entirely.
  if (!config.criteria?.length) push('criteria', config.seats.criteria, a.promptTokens, TYPICAL_OUTPUT_TOKENS.criteria);
  // Whole alternative architectures (config.alternatives.enabled): one architecture per proposer
  // lab, then the same debate + reply rounds proposals get. Its board is read by the skeleton and
  // the builder, so it is added to both inputs below. Output per alternative is the stage's own
  // token cap - the same number runChain caps each call at.
  let alternativeTokens = 0;
  if (config.alternatives?.enabled === true && !fromRun) {
    // Output per alternative is the cap runChain actually uses: the seat's own maxTokens unless
    // the chain sets alternatives.maxTokens (pre-release audit 2026-09-23, Alternatives #1).
    // Tiered councils: seats.alternatives (the anchors) write the architectures when set; with
    // alternatives.debaters "all", the proposers (the mass seats) also post on them. Same fallbacks
    // as chain.js.
    const seats = config.seats.alternatives || config.seats.proposers || config.seats.critics || [];
    const posters = [...seats];
    if (config.alternatives.debaters === 'all') for (const s of config.seats.proposers || []) if (!posters.some(p => (p.lab || p.provider) === (s.lab || s.provider))) posters.push(s);
    const capOf = seat => { const own = seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS; return config.alternatives.maxTokens ? Math.min(own, config.alternatives.maxTokens) : own; };
    const altOut = seat => typicalOut('alternativeOutTokens', capOf(seat));
    for (const seat of seats) push(`alternative-${seat.lab || seat.provider}`, seat, a.promptTokens + 400, altOut(seat), capOf(seat));
    // What the NEXT stages read is the board: since 0.8.1 (FX-11) every architecture reaches it whole, up to what its
    // seat was allowed to write, so the worst case is each seat's own output cap (it was ~2,000 tokens while the
    // fields were cut at 2,000 characters).
    alternativeTokens = seats.reduce((n, seat) => n + altOut(seat), 0);   // what the board holds: the typical size in the expected figure, the cap in the maximum
    if (seats.length > 1) {
      for (const seat of posters) push(`alt-debate-${seat.lab || seat.provider}`, seat, a.promptTokens + 1600 + alternativeTokens, stageOut('altDebateOutTokens', seat, TYPICAL_OUTPUT_TOKENS.altDebate));
      for (const seat of seats) push(`alt-reply-${seat.lab || seat.provider}`, seat, a.promptTokens + 3000, stageOut('altReplyOutTokens', seat, TYPICAL_OUTPUT_TOKENS.altReply));
      alternativeTokens += alternativeTokens; // the board roughly doubles what the next stages read
    }
  }
  let proposalTokens = 0;
  if (config.proposals && !fromRun) {
    const parts = config.proposals.parts ?? 3, per = config.proposals.maxTokens ?? 1500;
    // What a proposal call can produce: chain.js asks min(seat cap, parts x per + 300) (0.8.1 FX-12; this priced
    // parts x per, unclamped, and without the 300).
    const propCap = seat => Math.min(seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS, parts * per + 300);
    const propOut = seat => typicalOut('proposalOutTokens', propCap(seat));
    push('skeleton', config.seats.skeleton || config.seats.builder, a.promptTokens + 400 + alternativeTokens, TYPICAL_OUTPUT_TOKENS.skeleton);
    const samples = config.proposals.samples ?? 1, keep = config.proposals.keep ?? parts;
    for (const seat of config.seats.proposers || config.seats.critics) {
      for (let k = 0; k < samples; k++) push(`propose-${seat.lab || seat.provider}${samples > 1 ? `-${k + 1}` : ''}`, seat, a.promptTokens + 1600, propOut(seat), propCap(seat));
      if (samples > 1) push(`judge-${seat.lab || seat.provider}`, config.seats.judge || seat, a.promptTokens + 1600 + samples * propCap(seat), TYPICAL_OUTPUT_TOKENS.judge);
      // On the board: a lab's whole proposal set (one call's output), or with samples the `keep` single proposals a judge
      // keeps (about one part each), never more than all its attempts produced.
      proposalTokens += samples > 1 ? Math.min(keep * per, samples * propOut(seat)) : propOut(seat);
    }
  }
  if (config.debate && !fromRun) {
    for (const seat of config.seats.proposers || config.seats.critics) {
      push(`debate-${seat.lab || seat.provider}`, seat, a.promptTokens + 1600 + proposalTokens, stageOut('debateOutTokens', seat, TYPICAL_OUTPUT_TOKENS.debate));
      push(`reply-${seat.lab || seat.provider}`, seat, a.promptTokens + 3000, stageOut('replyOutTokens', seat, TYPICAL_OUTPUT_TOKENS.reply));
    }
    proposalTokens += proposalTokens; // the board roughly doubles what the builder reads
  }
  if (!fromRun) push('build', config.seats.builder, a.promptTokens + 400 + proposalTokens + alternativeTokens, a.draftTokens);
  // Tiered councils: the deep-dive seat. Each call reads the criteria, the draft and one chunk of
  // the source, and may write its whole maxTokens. The rows stop where the seat's own dollar cap
  // would stop the stage (the last row carries what is left of it), because runChain stops there
  // too; then one reviser pass over the findings. The source size is the chain's promptTokens
  // assumption (four characters a token), which --task raises for a large task.
  if (config.deep_dive?.enabled === true && config.seats.deep_dive && !fromRun) {
    const seat = config.seats.deep_dive;
    const dd = { job: 'sources', maxCalls: 24, chunkChars: 60000, ...config.deep_dive };
    const focus = Array.isArray(dd.focus) && dd.focus.length ? dd.focus.length : 1;
    const chunks = Math.max(1, Math.ceil((a.promptTokens * 4) / dd.chunkChars));
    const calls = Math.min(dd.maxCalls, focus * chunks);
    const out = seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
    const typOut = typicalOut('deepDiveOutTokens', out);   // the expected row's output; the stop rule below still projects the whole cap (what runtime projects)
    const inTok = Math.min(a.promptTokens, Math.ceil(dd.chunkChars / 4)) + a.draftTokens + 1000 + systemTokens(`deep-dive-${seat.lab || seat.provider}-1`, seat);
    const p = seat.provider === 'external' ? { in: 0, out: 0 } : priceOf(seat.provider, seat.model);
    let left = Number.isFinite(dd.usd) ? dd.usd : Infinity;
    for (let n = 1; n <= calls; n++) {
      // Audit fix cnc-money F2: BOTH passes stop where deep-dive.js stops the stage, on the projection of an attempt plus an Anthropic seat's one same-effort retry; the expected pass lists and spends
      // the first attempt only, the maximum pass lists the whole projection. (They used to stop on different figures, so the two passes planned different rows and the dry run joined them by index.)
      const att = p ? projectAttemptsTokens(seat, { inputTokens: inTok, maxTokens: out }) : null;
      const inMult = cacheInputMultOf(seat.provider, seat.model);   // 3b: a selected seat's input is billed as a write; the expected row, the maximum row and `left` below all use this one figure, so both passes plan the same rows
      const firstUsd = p ? (inTok / 1e6) * p.in * inMult + (typOut / 1e6) * p.out : 0;   // the first attempt at the expected size (the maximum pass: the cap, typOut === out there)
      const capUsd = p ? (inTok / 1e6) * p.in * inMult + (out / 1e6) * p.out : 0;
      const projected = att ? att.first + att.retry : capUsd;
      if (p && projected > left) break;
      const usd = maximum && att ? att.first + att.retry : firstUsd;
      rows.push({ label: `deep-dive-${seat.lab || seat.provider}-${n}`, seat: `${seat.provider}/${seat.model}`, ...accountField(seat), input: inTok, output: typOut, usd, priced: !!p });
      left -= capUsd;   // BOTH passes subtract the cap-based figure, so they plan the same rows (audit fix cnc-money F2): the typical size changes only this row's printed output and usd
    }
    push('deep-dive-revise', config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens + a.critiqueTokens, a.draftTokens);
  }
  const unanimous = config.signoff === 'unanimous';
  const limits = roundLimitsOf(config);
  const ladderPreview = previewOfLadder(limits, maximum, typedReads);   // 0.8.4 (commit 7): a ladder chain is priced in top-layer READS; null for every other chain
  // The notes lane (declared here because the revise rows below carry it too; the handoff / notes-answer rows further down use the same value).
  const notesCfg = !fromRun && reviewNotesActive(config) ? notesConfigOf(config) : null;
  // Review fix F9, closing the revise rows (C&C 18 Okt 2026): a REVISE call's prompt carries the items no revise has shown the writer yet (chain.js reviseNotesNote: sinceLastRevise), at most one overseer round's worth (the item budget is per judge, per kind, per overseer round). The MAXIMUM adds that at the lane's read caps to every revise row; the expected figure is untouched.
  const reviseNotesTokens = maximum && notesCfg ? Math.ceil(((notesCfg.textMax + notesCfg.aboutMax) * notesCfg.perKind * 2 * (config.seats.critics || []).length) / 4) : 0;
  // 0.8.4 S7b A5 (plan item g, RS-14): the MAXIMUM figure of a layer-2 call also carries the section that asks layer 2 to rule on layer 1's open objections: about 400 tokens per layer-1 judge (K1 = the judges of the lowest layer, one standing objection each; the go-up's
  // `400 x K2` unit, an approximation: the real bound is the section budget (fitOpenRows, LEDGER_MAX_TOKENS_EST) and a judge holding several objections exceeds it). The gate mirrors src/chain.js term for term: the section is built when `severityOn && ledgerOn && row.layer > layerNumbers[0] && row.layer < topLayer`
  // (severityOn = ratingsDemanded(config); ledgerOn = answer_back && layered && >= 2 layers) and is the S7b one when `layerOneRulingActive(held)` and `row.layer === layerNumbers[1]` (so >= 3 layers, the second one gets it). "Layer 1 signed off in this pass" is a runtime fact: the MAXIMUM assumes it true.
  // Applies to the review row of that layer, its in-pass `-reask` rows (a re-ask goes through the same prompt build, chain.js layerOneNote) and, on a layered chain without overseer rounds, the per-pass `panel-<n>-*` rows. Output is already the call's cap in the MAXIMUM (push) and the expected figure never moves: only input is added.
  const s7bLayers = [...new Set((config.seats.critics || []).map(c => c.layer))].sort((x, y) => x - y);
  const s7bLive = maximum && ratingsDemanded(config) && s7bLayers.length >= 3 && settingsOf(config).answerBackOn && layerOneRulingActive(held);
  const s7bK1 = (config.seats.critics || []).filter(c => c.layer === s7bLayers[0]).length;
  const s7bGainOf = critic => (s7bLive && critic.layer === s7bLayers[1] ? 400 * s7bK1 : 0);
  // 0.8.4 S7c (W41; Q8 item 5 (ii), CA8): a seat BELOW the top layer is shown the top layer's reasons for an objection of its that the top layer overruled, in its first review after the top layer objected and the plan went back: no extra call, only input. The MAXIMUM adds
  // `400 x K3` input tokens (K3 = the judges of the top layer, one reason each, one objection per seat: the unit of the go-up's `400 x K2` and S7b's `400 x K1`, an approximation; reasons are shown whole, W44, so a long reason or several objections exceed it, and a config-derived bound exists:
  // per ruling K3 x the ruling call's output cap) to the review rows of such a seat (the review row, its in-pass re-ask row, the per-pass pair of a chain without overseer rounds): an upper bound, since the section shows once per block. A row family is raised only where a ruling by the top layer can REACH it:
  // the STALL ruling (its sentences recorded AND `dispute.enabled`, chain.js stalledNow) reaches every seat below the top layer (a stall row carries the objections of several layers, its ruling layer is the one above the highest raiser), in both shapes; the GO-UP ruling (its sentences recorded, a chain WITH
  // overseer rounds: it fires at layer 2's revision bound, chain.js layer2BoundGoUp) carries layer-2 objections only, so it reaches the layer-2 seats of a chain with three layers or more. Gate for both = chain.js layerThreeNote: the held section recorded, answer_back on (retained), a layered chain of two layers or
  // more. Held: nothing moves; the expected figure never moves.
  const s7cTop = s7bLayers[s7bLayers.length - 1];
  const s7cK3 = (config.seats.critics || []).filter(c => c.layer === s7cTop).length;
  const s7cBase = maximum && (config.seats.critics || []).length > 0 && config.seats.critics.every(c => c.layer !== undefined) && s7bLayers.length >= 2 && settingsOf(config).answerBackOn && typeof held('layerThreeReasonsSection') === 'function';
  const s7cStall = s7cBase && config.dispute?.enabled === true && rulingActive(held) && ratingsDemanded(config);   // + SG-2 (C&C 08 Nov 2026, the stall gate): the stall goes up only with the ledger (s7cBase carries answer_back) AND the rating demand, term for term with chain.js `stallGoUpOn`; where it cannot go up the top layer never rules on it, so W41 is not reached
  const s7cGoUp = s7cBase && s7bLayers.length >= 3 && limits.overseer !== null && goUpRulingActive(held);
  // M1 COMPLETE U2-3 (the revival of S7c commit 4, which C&C withdrew while a new run could not produce a send_up escalation): the AUTOMATIC go-up at layer 1's revision bound (trigger layer1_bound) lands on the layer above the highest raiser, so in a chain of EXACTLY TWO layers it lands on the TOP layer and
  // W41 / the dissent record become reachable with the dispute stage off; in a chain of three layers or more it lands on layer 2 (not the top layer): no W41 term there. Gates (mirroring chain.js): the held go-up line recorded (chain.js layer1BoundGoUp block), rulingActive(held) (the sendUp ruling sentences it reuses), overseer rounds (the layer-1 stop exists only there), exactly two layers.
  const s7cLayerOne = s7cBase && s7bLayers.length === 2 && limits.overseer !== null && typeof held('layerOneGoUpLine') === 'function' && ratingsDemanded(config) && rulingActive(held);   // + A2 (C&C 07 Nov 2026): the go-up needs the ledger (answer_back: s7cBase carries settingsOf(config).answerBackOn) AND the rating demand, term for term with chain.js
  // 0.8.4 S8 (money step): a SORTING route. A top-layer seat's may-leave sorting of an objection (rated 4 or above, or unrated) is an overrule row of the same source (src/chain.js layerThreeOverrulesSource), so a seat below the top layer is shown the same section whenever the sorting is on: the same `400 x K3` unit (an approximation, the same kind).
  // Gate = chain.js layerThreeNote's, term for term: the held section recorded, the ledger (s7cBase) and the sorting on (src/sorting.js sortingOn). MAXIMUM only; held: nothing moves.
  const s7cSorting = s7cBase && sortingOn(config);
  const s7cGainOf = critic => (critic.layer < s7cTop && (s7cStall || s7cLayerOne || (s7cGoUp && critic.layer === 2) || s7cSorting) ? 400 * s7cK3 : 0);
  if ((limits.overseer !== null || ladderPreview) && unanimous) {
    // Round semantics (2a; Muad 15 Oct 2026: a round ends only when the overseer layer gives a verdict). A layer-aware estimate that does NOT loop over maxRounds: each seat's calls are counted by the layer it sits in.
    // EXPECTED = the plain-run shape: every overseer round ends after ONE climb (every layer asked once, the writer revises after each overseer objection but the last). MAXIMUM = every allowed revision used in every overseer round (the
    // bounds b1, b2): layer 1 is asked b1 + b2 + 1 times per round, layer 2 b2 + 1 times, layer 3 once. Planned calls at their output caps; in-pass re-asks and the unheard re-ask passes are NOT in it (one definition across chains, C&C 15 Oct).
    // a LADDER chain (commit 7): n is the number of top-layer READS of the preview, and each read is a climb of `climb[1]` layer-1 and `climb[2]` layer-2 passes (previewOfLadder); an overseer chain keeps its own count and bounds
    const n = ladderPreview ? ladderPreview.reads : limits.overseer; const { 1: b1, 2: b2 } = ladderPreview ? { 1: 0, 2: 0 } : limits.layerRevisions;
    const timesOf = ladderPreview ? (layer => ladderPreview.reads * (ladderPreview.climb[layer] ?? 1)) : layer => (maximum ? n * ({ 1: b1 + b2 + 1, 2: b2 + 1 }[layer] ?? 1) : n);
    for (const critic of config.seats.critics) push(`panel-L${critic.layer}-${nameOf(critic)}`, critic, a.promptTokens + a.draftTokens + s7bGainOf(critic) + s7cGainOf(critic) + sortGainOf(critic) + boundaryTokens(critic), reviewOut(critic), reviewCap(critic), timesOf(critic.layer), markFor(critic));   // a marked seat's panel call WRITES its group's entry
    // B2 (debate-084/b2): the exchange inside the lowest layer is one post call and one answer call per layer-1 judge per pass, on the same pass count as the layer-1 reviews. The prompt carries the other judges' objections (about 400 tokens each, one per other judge).
    const lowest = Math.min(...config.seats.critics.map(c => c.layer));
    const judges = config.seats.critics.filter(c => c.layer === lowest);
    if (judges.length >= 2) {   // 0.8.4: the exchange is part of every layered unanimous chain; it needs two judges at the lowest layer
      const exchangeRounds = maximum ? LAYER_ONE_EXCHANGE_ROUNDS : 1;   // the maximum counts every allowed round (0.8.4: the layer-1 exchange stops after 3); the expected figure one
      const cacheTtl = maximum ? promptCacheTtl(config) : null;   // prompt caching (src/prompt-cache.js): only the MAXIMUM figure has marked calls (the first marked round of a group at the write price, the later ones at the read price); the expected figure has one exchange round, which is never marked
      pushExchangeRows(judges, { labelOf: (kind, critic) => `${kind}-L${lowest}-${nameOf(critic)}`, times: timesOf(lowest), exchangeRounds, cacheTtl });
    }
    for (const layer of upperExchangeLayers()) pushExchangeRows(config.seats.critics.filter(c => c.layer === layer), { labelOf: (kind, critic) => `${kind}-L${layer}-${nameOf(critic)}`, times: timesOf(layer), exchangeRounds: 1, cacheTtl: null });   // S6: one round, never marked for the cache
    signoffReaskRows(critic => `panel-L${critic.layer}-${nameOf(critic)}`, timesOf(Math.max(...config.seats.critics.map(c => c.layer))));   // S6 (G7)
    // 0.8.4 unit 4 (OWNER 6): the MAXIMUM includes a silent judge's in-pass re-asks at the review's EXPECTED cost (a seat that was not heard is asked again up to IN_PASS_REASKS_PER_SEAT times in a pass). The unheard re-ask PASSES
    // (overseer-rounds.js passCeiling) are not in it.
    if (maximum) for (const critic of config.seats.critics) { const name = `panel-L${critic.layer}-${nameOf(critic)}`; { pushExpected(`${name}-reask`, critic, a.promptTokens + a.draftTokens + s7bGainOf(critic) + s7cGainOf(critic) + sortGainOf(critic) + boundaryTokens(critic), reviewOut(critic), IN_PASS_REASKS_PER_SEAT * timesOf(critic.layer), name, markFor(critic, { read: true })); pushExpected(`${name}-solo`, critic, a.promptTokens + a.draftTokens + s7bGainOf(critic) + s7cGainOf(critic) + sortGainOf(critic) + boundaryTokens(critic), reviewOut(critic), SOLO_ASKS_PER_SEAT * timesOf(critic.layer), name, markFor(critic, { read: true })); } }
    const revises = ladderPreview ? n * (ladderPreview.climb[1] + ladderPreview.climb[2]) + (n - 1) : maximum ? n * (b1 + b2) + (n - 1) : n - 1;   // a ladder read: every layer-1 and layer-2 pass ends in a revision, and every read but the last that objects does too
    if (revises > 0) push('revise-all', config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens + a.critiqueTokens + proposalTokens + reviseNotesTokens, a.draftTokens, undefined, revises);
    // E4b unit 2: at most one decider call per revise (a conflict is found just before a revise). Only in the MAXIMUM, and only once the decider's prompt is recorded (a held prompt makes no call, so it prints no dollar); an external decider is $0.
    if (maximum && revises > 0 && deciderActive(config)) push('conflict', deciderSeatOf(config), a.promptTokens + a.draftTokens + 3000, deciderSeatOf(config).maxTokens ?? SEAT_DEFAULT_MAX_TOKENS, undefined, revises);
    // 0.8.4 S7 (Q7, CA5, C12): the layer-2 bound go-up makes the top layer's seats RULE on layer 2's objections in the round where layer 2 hits its bound: one short call per top-layer seat, at most once per overseer round. Only in the MAXIMUM (a number inside the upper estimate: the expected
    // figure is "every round ends after one climb", and the dry run prints rows by the EXPECTED pass, so this adds no label to any screen), and only once the go-up's own three sentences are recorded (a held ruling makes no call, so it prints no dollar: the same gate as the ruling itself,
    // src/escalation.js goUpRulingActive). Sized like the seat's review plus one ~400-token objection per layer-2 judge (push() adds the go-up system text through src/stage-system.js RULES, label rule-go-up-) (the exchange rows' constant). The stall escalation's own rule- calls stay unlisted, as before.
    // M1 COMPLETE U2-3 (money; the layer-1 go-up's RULING calls): at layer 1's revision bound the plan goes up and layer 2's seats rule (chain.js ruleOnEscalation, `rule-<pass>-<seat>`, the recorded sendUp sentences). Layer 2 is asked at most b2 + 1 times per overseer round (b2 revising visits + the climb; a go-up pass IS one of those visits, so the
    // layer-2 REVIEW rows above already count it through timesOf(2) = n x (b2 + 1)), and each go-up pass has one ruling call per layer-2 seat: n x (b2 + 1) per seat, an upper bound (a go-up pass is not every visit). Sized like the seat's review plus about 400 tokens per layer-1 judge (one standing objection each: the go-up's `400 x K2`
    // unit, an approximation; the real bound is the ruling call's output cap and the reasons are shown whole). The stall rule's own rule- calls stay unlisted, as before. Gate = chain.js: the held go-up line recorded and the ruling sentences recorded (rulingActive); MAXIMUM only; the expected figure never moves.
    // 0.8.4 (apply, C&C ruling 12 Nov 2026: the over-count): both go-up ruling blocks below are listed only where the run can SEND those calls. The go-up fires on a layer_bound stop with why 'revisions' (src/overseer-rounds.js:49, :252; chain.js layer1BoundGoUp / layer2BoundGoUp), and that stop needs layer bounds, which a ladder does not have (overseer-rounds.js:36-37; a ladder pass never moves the plan by passUp, chain.js:6092, :6589). On the ladder preview (every shipped planning chain) the rows were listed and never sent (box job 66: zero rule- labels served; job 68: $20 to $133 of each upper figure). `!ladderPreview` follows the chain file's `ladder` KEY (limits.ladder: the setting chain.js reads when the run's own saved numbers or a typed --ladder do not override it), not a chain name; a typed --ladder or a resume's saved ladder is NOT seen by the dry run, so a person's own overseer-keys chain run with --ladder still lists these rows (FOR_085).
    if (maximum && !ladderPreview && typeof held('layerOneGoUpLine') === 'function' && settingsOf(config).answerBackOn && ratingsDemanded(config) && rulingActive(held) && s7bLayers.length >= 2) {   // the A2 gate term for term: ledgerOn (answer_back, layered, >= 2 layers) && severityOn
      const k1 = config.seats.critics.filter(c => c.layer === s7bLayers[0]).length;
      for (const critic of config.seats.critics.filter(c => c.layer === s7bLayers[1])) push(`rule-bound-L${critic.layer}-${ruleNameOf(critic)}`, critic, a.promptTokens + a.draftTokens + 400 * k1, reviewOut(critic), reviewCap(critic), n * (b2 + 1));
    }
    if (maximum && !ladderPreview && goUpRulingActive(held)) {
      const layerOfSeat = c => c.layer; const topLayer = Math.max(...config.seats.critics.map(layerOfSeat)); const midJudges = config.seats.critics.filter(c => c.layer === 2).length;
      if (topLayer >= 3 && midJudges > 0) for (const critic of config.seats.critics.filter(c => c.layer === topLayer)) push(`rule-go-up-L${critic.layer}-${ruleNameOf(critic)}`, critic, a.promptTokens + a.draftTokens + 400 * midJudges, reviewOut(critic), reviewCap(critic), n);
    }
    // 0.8.4 S9 (Q10, D8; MONEY): the proposer return. A decision-level layer-3 objection ends an overseer round and sends ONE decision to every proposer seat (seats.proposers only, no fall back to the critics): P blind alternatives, P posts, P answers, at most once per
    // overseer round but the last (n - 1 times; a continue's round is the ceiling's perContinue, not a row). Only in the MAXIMUM (the expected figure is "no objection is decision-level", so no label joins any dry-run screen) and only behind the ONE gate chain.js and the call
    // ceiling read (src/call-gates.js proposerReturnOn: the Decisions rule on, the S9 words recorded, P >= 1). Rows are the calls a return CAN make (all readable: 3P): an unreadable reply makes fewer, never more. Sized from the drafted texts (src/proposer-return.js): the first call
    // carries the plan, request, criteria, the skeleton (when the run had one) and the entry (promptTokens + draftTokens + 1000 for the entry and the objection), the post call the request, criteria and entry plus the OTHER proposers' alternatives at their whole caps, the answer call the same with its own alternative
    // and the other posts. Output = the seat's whole cap. The label's system text is the return's one system line (src/stage-system.js RULES, label return-).
    if (maximum && proposerReturnOn(config) && n >= 2) {
      const props = proposerSeatsOf(config); const capOf = seat => seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
      for (const seat of props) {
        const others = props.filter(o => o !== seat).reduce((t, o) => t + capOf(o), 0);
        push(`return-alt-${seatKeyOf(seat)}`, seat, a.promptTokens + a.draftTokens + 1000 + (config.proposals ? TYPICAL_OUTPUT_TOKENS.skeleton : 0), capOf(seat), capOf(seat), n - 1);   // the skeleton rides along when the run had a proposals stage (the typical size the skeleton row prices)
        if (props.length >= 2) push(`return-post-${seatKeyOf(seat)}`, seat, a.promptTokens + 1000 + others, capOf(seat), capOf(seat), n - 1);
        if (props.length >= 2) push(`return-answer-${seatKeyOf(seat)}`, seat, a.promptTokens + 1000 + capOf(seat) + others, capOf(seat), capOf(seat), n - 1);
      }
    }
  } else if ((config.seats.critics || []).length) for (let r = 1; r <= limits.passes; r++) {   // BUG-D-018: limits.passes is maxRounds ?? 2, the passes the run really gets (the raw config.maxRounds is undefined for a chain that omits it). BUG-D-033: a config with no critics (the digest stand-in) has no panel, critique or revise rows to price
    if (unanimous) {
      for (const critic of config.seats.critics) {
        push(`panel-${r}-${nameOf(critic)}`, critic, a.promptTokens + a.draftTokens + s7bGainOf(critic) + s7cGainOf(critic) + sortGainOf(critic) + boundaryTokens(critic), reviewOut(critic), reviewCap(critic), 1, markFor(critic));
        if (maximum) { pushExpected(`panel-${r}-${nameOf(critic)}-reask`, critic, a.promptTokens + a.draftTokens + s7bGainOf(critic) + s7cGainOf(critic) + sortGainOf(critic) + boundaryTokens(critic), reviewOut(critic), IN_PASS_REASKS_PER_SEAT, `panel-${r}-${nameOf(critic)}`, markFor(critic, { read: true })); pushExpected(`panel-${r}-${nameOf(critic)}-solo`, critic, a.promptTokens + a.draftTokens + s7bGainOf(critic) + s7cGainOf(critic) + sortGainOf(critic) + boundaryTokens(critic), reviewOut(critic), SOLO_ASKS_PER_SEAT, `panel-${r}-${nameOf(critic)}`, markFor(critic, { read: true })); }   // 0.8.4 unit 4 (OWNER 6): as above
      }
      // 0.8.4 (H15 widened): the exchange is part of every layered unanimous chain, so a chain WITHOUT overseer rounds prices it too, one set of rows per pass on the lowest layer's judges (the block in the overseer branch above does the same per overseer pass); it needs two judges there.
      if (exchangeJudgeCount(config) >= 2) {
        const lowest = Math.min(...config.seats.critics.map(c => c.layer));
        const judges = config.seats.critics.filter(c => c.layer === lowest);
        const exchangeRounds = maximum ? LAYER_ONE_EXCHANGE_ROUNDS : 1;   // the maximum counts every allowed round (0.8.4: the layer-1 exchange stops after 3); the expected figure one
        const cacheTtl = maximum ? promptCacheTtl(config) : null;   // as in the overseer branch: only the MAXIMUM has marked calls, priced as above
        pushExchangeRows(judges, { labelOf: (kind, critic) => `${kind}-${r}-${nameOf(critic)}`, times: 1, exchangeRounds, cacheTtl });
      }
      for (const layer of upperExchangeLayers()) pushExchangeRows(config.seats.critics.filter(c => c.layer === layer), { labelOf: (kind, critic) => `${kind}-${r}-${nameOf(critic)}`, times: 1, exchangeRounds: 1, cacheTtl: null });   // S6: as in the overseer branch, per pass
      signoffReaskRows(critic => `panel-${r}-${nameOf(critic)}`, 1);   // S6 (G7)
    } else {
      const critic = config.seats.critics[(r - 1) % config.seats.critics.length];
      push(`critique-${r}`, critic, a.promptTokens + a.draftTokens + boundaryTokens(critic), reviewOut(critic));
    }
    if (r < limits.passes) push(`revise-${r}`, config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens + a.critiqueTokens + proposalTokens + reviseNotesTokens, a.draftTokens);
    if (maximum && r < limits.passes && deciderActive(config) && (config.seats.critics || []).every(c => c.layer !== undefined)) push(`conflict-${r}`, deciderSeatOf(config), a.promptTokens + a.draftTokens + 3000, deciderSeatOf(config).maxTokens ?? SEAT_DEFAULT_MAX_TOKENS);   // E4b unit 2: as above, per revise opportunity
  }
  // 0.8.4 S4b (CA6, map A10; MONEY): the ENDING exchange, in the MAXIMUM only (the expected figure is unchanged: it runs only at a finish or the round cap, and only for a layer-1 objection still not debated). Once per run, up to EXCHANGE_ROUNDS rounds of one post and one answer per
  // layer-1 judge (labels ldebate-end-L<layer>-<seat>, lreply-end-...; the pre-run row names, as ldebate-L<layer>- does). It needs two judges at the lowest layer, and it exists only while its wording (W26) is recorded: held, no row is added and every figure is what it was.
  if (maximum && unanimous && endingExchangeOn() && (config.seats.critics || []).length && config.seats.critics.every(c => c.layer !== undefined) && exchangeJudgeCount(config) >= 2) {
    const lowestEnd = Math.min(...config.seats.critics.map(c => c.layer));
    const judgesEnd = config.seats.critics.filter(c => c.layer === lowestEnd);
    // C&C's item 4: the SAME rows as the ordinary exchange (one helper), including the prompt-cache prices of the marked calls (the run passes cacheTtl to exchangeRound). The last (seventh) round sends the last-round text (W26, and the reply half),
    // which the label's recorded system text does not carry: its tokens beyond that text are added to the input of every round (a ceiling, as the maximum is).
    const lastRoundTokens = (kind, critic) => withoutNotes(() => Math.max(...[false, true].map(again => estimateTokens((kind === 'ldebate' ? lastRoundPostSystem : lastRoundReplySystem)(config, critic, again)))));
    pushExchangeRows(judgesEnd, { labelOf: (kind, critic) => `${kind}-end-L${lowestEnd}-${nameOf(critic)}`, times: 1, exchangeRounds: EXCHANGE_ROUNDS, cacheTtl: promptCacheTtl(config), groupStart: true, extraTokens: (kind, critic, label) => Math.max(0, lastRoundTokens(kind, critic) - systemTokens(label, critic)) });
  }
  // Stages that can run after the panel, priced as worst cases too (pre-release audit 2026-09-23,
  // ProposalsDebateDispute #5): the figure a person approves before a paid run must not sit below
  // what the run can actually spend.
  //  - dispute: one reviser pass over the open objections (runs when the panel ends without
  //    agreement; needs unanimous sign-off, as runChain does);
  //  - dispute-review: each critic re-reads the draft before and after that pass;
  //  - canary-reply: one extra reply from the author of the probed proposal, when sampled.
  // Unit D (src/final-read.js): at the end of a run (agreed or not) every top-layer seat that has not read the final plan reads it once. In the plain agreed run nothing changes the plan after the sign-off, so the EXPECTED figure has no such read unless the chain has a stage that rewrites it (a final edit seat or a post-signoff challenge); the MAXIMUM always counts it (a not-agreed end, or a dispute rewrite):
  // one call per top-layer seat on a plan of the final size, priced like that seat's panel review. A re-ask on an unreadable reply is not in it (the estimator leaves in-pass re-asks out everywhere; the cap stops those).
  if ((maximum || config.seats.finalist || config.challenge?.enabled === true) && finalReadOn(config)) {   // 0.8.4 S11: the config part of the gate is src/call-gates.js finalReadOn (the same four terms, so the call ceiling's Cl is live on exactly this)
    const top = Math.max(...config.seats.critics.map(c => c.layer));
    for (const critic of config.seats.critics.filter(c => c.layer === top)) push(`final-read-L${top}-${nameOf(critic)}`, critic, a.promptTokens + a.draftTokens + sortReadGain + finalReadWordsGain + boundaryTokens(critic), reviewOut(critic), reviewCap(critic), 1);
    // 0.8.4 unit 4 (OWNER 6): a final read that was not heard is asked once more (src/final-read.js); the MAXIMUM includes that one re-ask at the read's expected cost.
    if (maximum) for (const critic of config.seats.critics.filter(c => c.layer === top)) pushExpected(`final-read-L${top}-${nameOf(critic)}-reask`, critic, a.promptTokens + a.draftTokens + sortReadGain + finalReadWordsGain + boundaryTokens(critic), reviewOut(critic), 1, `final-read-L${top}-${nameOf(critic)}`);
  }
  if (config.dispute?.enabled === true && unanimous) {
    const critics = config.seats.critics || [];
    push('dispute', config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens + critics.length * a.critiqueTokens, a.draftTokens);
    if (config.dispute.review) {
      for (const critic of critics) push(`dispute-review-${keyNameOf(critic)}`, critic, a.promptTokens + 2 * a.draftTokens + a.critiqueTokens, reviewOut(critic));
    }
  }
  if (config.canary?.enabled && config.debate && !fromRun) {
    const author = (config.seats.proposers || config.seats.critics || [])[0];
    push(`canary-reply-${author ? (author.lab || author.provider) : 'author'}`, author, a.promptTokens + 3000, TYPICAL_OUTPUT_TOKENS.canaryReply);
  }
  if (config.claims?.enabled) push('claims', config.seats.claims || config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens, a.critiqueTokens);
  if (config.challenge?.enabled === true) {
    push('challenge', config.seats.challenger || (config.seats.critics || [])[0], a.promptTokens + a.draftTokens, a.critiqueTokens);
    // Worst case: the challenge lands and the reviser answers it once.
    push('challenge-revise', config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens + a.critiqueTokens, a.draftTokens);
  }
  if (config.coldRead?.enabled === true) push('cold-read', config.seats.coldRead, a.draftTokens, a.critiqueTokens);
  push('final', config.seats.finalist, a.promptTokens + a.draftTokens, a.draftTokens);
  // 0.8.3 notes lane 2b-2 (money; gate note Notes_Lane_2b_Gate_Note.md section 5): rows exist only when the run would really use the lane (`reviewNotesActive`: the chain key AND all four held sentences, the same predicate chain.js uses) and
  // only on a full run. The quoted items are priced at their per-item caps (itemChars + aboutChars, 4 chars per token as the ledger estimates), up to perKind x 2 kinds x judges: an overstatement on purpose (Muad 15 Okt: overstating is welcome).
  // FOLD (handoff seat == writer seat, as chain.js decides): the items ride in the handoff call, so that row's INPUT grows. Otherwise ONE `notes-answer` call (the writer seat; output = estimate.notesAnswerOutTokens in the expected figure, the
  // seat's cap in the maximum; $0 on an external writer, as every external row). The judges' extra reply tokens and the memory block are NOT rows: the call caps do not move, and the dry run and the cap screen say what the maximum leaves out.
  const notesWriter = config.seats.reviser || config.seats.builder;
  const notesHandoffSeat = config.seats.handoff || config.seats.builder;
  const sameNotesSeat = (x, y) => !!x && !!y && lab(x) === lab(y) && x.provider === y.provider && x.model === y.model;
  const notesFolded = !!notesCfg && !!config.handoff && sameNotesSeat(notesHandoffSeat, notesWriter);
  // Review fix F9 (18 Okt 2026): the MAXIMUM prices the notes input at the lane's READ caps (textMax + aboutMax, what the harness really keeps of an item) and for every round the maximum plans (the notes of all rounds reach the writer: budgetLeft is per judge per kind per overseer round, chain.js), where the expected figure keeps the asked lengths and one round. Overstating is welcome (owner, 15 Okt 2026). Rounds come from the same helper the panel rows use.
  const notesRounds = maximum ? Math.max(1, ladderPreview?.reads ?? limits.overseer ?? limits.passes ?? 1) : 1;
  const notesItemChars = notesCfg ? (maximum ? notesCfg.textMax + notesCfg.aboutMax : notesCfg.itemChars + notesCfg.aboutChars) : 0;
  const notesItemTokens = notesCfg ? Math.ceil((notesItemChars * notesCfg.perKind * 2 * (config.seats.critics || []).length * notesRounds) / 4) : 0;
  if (config.handoff) push('handoff', notesHandoffSeat, a.promptTokens + a.draftTokens + (notesFolded ? notesItemTokens : 0), TYPICAL_OUTPUT_TOKENS.handoff);
  if (notesCfg && !notesFolded) push('notes-answer', notesWriter, a.promptTokens + a.draftTokens + notesItemTokens, typicalOut('notesAnswerOutTokens', notesWriter?.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS));
  // "How this plan was argued" (src/argued.js): the request, the final plan and a fact pack about
  // the size of one critique round's worth of posts, out as a short section (under 700 words). $0 on
  // an external handoff seat, like the handoff row above; priced when that seat is billed.
  if (config.argued?.enabled === true && !config.descending) push('argued', config.seats.handoff || config.seats.builder, a.promptTokens + a.draftTokens + a.critiqueTokens, TYPICAL_OUTPUT_TOKENS.argued);
  // The final security review reads the request plus the finished draft (promptTokens +
  // draftTokens, same input as a panel critique) and replies with a findings list, which is
  // critique-shaped output - so it uses the chain's own critiqueTokens assumption, not a new number.
  if (config.security_review?.enabled === true) push(SECURITY_REVIEW_LABEL, config.seats.security_reviewer || DEFAULT_SECURITY_REVIEWER_SEAT, a.promptTokens + a.draftTokens, a.critiqueTokens);
  // 0.8.4 unit 4 (his pick OWNER 5, "Both figures": "The dry run's upper figure and the run's counted totals both price a network-error retry at its expected cost"; his decision 9: up to 3, counted and bounded). A dropped
  // connection is asked again at most NETWORK_RESUMES_PER_RUN times in a RUN, on whichever calls it falls, so the most the run allows is that many retries of its dearest call, each at that call's expected cost: ONE row, only in the
  // MAXIMUM and only when a priced call exists. The deep dive and the advice calls are never asked again after a drop (chain.js NO_RESUME_LABELS and its prefixes), so they are not candidates.
  if (maximum) {
    let dearest = null;
    for (const r of estimateChainRows(config, { fromRun, accounts, typedReads })) {
      if (/^(deep-dive|advise)-/.test(r.label) || !(r.usd > 0)) continue;
      const per = r.usd / (r.times || 1);
      if (!dearest || per > dearest.per) dearest = { per, r };
    }
    if (dearest) {
      const t = dearest.r.times || 1;
      // DUALCAP (Mini-C&C, 04 Nov 2026): the bound is three per RUN, not per account, so this row carries NO account and is flagged `allCaps`: every cap's figure includes it in full (rowBillsThroughCap) and the whole-run figure counts it
      // once. Each cap's upper estimate therefore errs HIGH by the share of the other accounts, which is the direction these figures may err; a per-account row would understate a cap or, summed, overstate the run.
      rows.push({ label: 'network-retries', seat: dearest.r.seat, allCaps: true, note: 'the run allows three of these in all, whichever account they fall on: every cap\'s figure counts them in full', input: (dearest.r.input / t) * NETWORK_RESUMES_PER_RUN, output: (dearest.r.output / t) * NETWORK_RESUMES_PER_RUN, usd: dearest.per * NETWORK_RESUMES_PER_RUN, priced: dearest.r.priced, times: NETWORK_RESUMES_PER_RUN });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Per-run spend cap.
//
// costOf() above is measurement: what a stage cost once it had already been
// paid for. A cap that only measures is not a cap, so enforcement needs a
// number BEFORE the call goes out - hence a worst case rather than an actual.
//
// Worst case for one stage is: every prompt character billed as input, plus
// the seat's entire maxTokens budget billed as output. A stage essentially
// never spends its whole output budget, so this over-estimates on purpose - a
// cap that occasionally stops a run slightly early is a working cap, and one
// that lets a run slip past the ceiling is not.
//
// 27 Okt 2026 (owner: "going by the expected-maximum is absolutely stupid. Stop this"): invoke()'s gate
// no longer decides on this worst case. It decides on the call's EXPECTED cost (expectedCallUsd above)
// plus the expected cost of the calls in flight; a call the dry run does not plan keeps its worst case
// there. The worst case below is still what a call reserves on disk before it is sent
// (spend-reservations.jsonl), what a call in flight at a crash is charged, and what an unreadable or
// billed-but-failed reply counts. Since the gate admits on the expected size, a run can now end above
// its cap by what its last calls wrote past their expected sizes.

// Characters per token. Real tokenisers vary by model and language; 4 is the
// usual English rule of thumb and errs low (i.e. estimates MORE tokens) on
// the code and JSON these prompts are full of.
const CHARS_PER_TOKEN = 4;

/** The size of one call's prompt in tokens: ceil(chars / 4). The ONE formula: estimateTokens, worstCaseOf, the rate lookups (priceAt) and invoke()'s price pin all use it, so a call lands on one tier everywhere. */
export const promptTokensOfChars = chars => Math.ceil(chars / CHARS_PER_TOKEN);
/** The characters of one call's prompt: system + user. The ONE expression every site reads (projectAttempts, expectedCallUsd, invoke()'s projection and price pin, the cache-miss worst case), so the sites cannot drift apart. */
export const promptCharsOf = ({ system = '', user = '' } = {}) => (system || '').length + (user || '').length;

export function estimateTokens(text) {
  return promptTokensOfChars((text || '').length);
}

/**
 * The most this stage could cost. Returns 0 for a seat with no price entry -
 * an unpriced model cannot be accounted for, so it cannot be capped either
 * (this is why the $0 mock chains run freely under any ceiling).
 *
 * `retries` multiplies the whole figure (kept for callers that project N identical attempts). `retryMaxTokens` adds ONE more attempt
 * with its own, larger output cap: the Anthropic thinking retry in chain.js invoke() (0.8.1 milestone R) retries at the SAME effort
 * with a bigger cap, so its worst case is the first attempt plus a bigger second one, not twice the first.
 */
export function worstCaseOf(provider, model, { promptChars = 0, maxTokens = 8000, retries = 1, retryMaxTokens = null, pin = null, cache = null } = {}) {
  const input = promptTokensOfChars(promptChars);   // the call's prompt size: the one figure the rate is looked up at (DUALCAP 4d), and the one the input cost uses
  const p = priceAt(provider, model, input);
  if (!p) return { usd: 0, priced: false };
  // Prompt caching: a call that carries a marker is projected with its cached head (system text + the plan, `cache.headTokens`) at the WRITE price and the rest at the input price. The projection never
  // assumes a hit: a hit can only make the call cheaper, a miss rewrites the entry.
  // 3b: what the call carries is decided in ONE place (cacheModeOf). 'auto' (a selected seat, nothing sent): the whole prompt is billed as a write, at the row's write multiple or the page's figure. 'explicit': the named head at the write
  // price of its lifetime (Anthropic's table) - or, on a selected OpenRouter seat, at the row's own multiples (the DEFAULT lifetime only: OpenAI's 12-hour lifetime writes at 2.5x, analysis C8, and part (b) revisits this branch if it offers it). 'off' and 'none': the plain input price.
  const mode = cacheModeOf(provider, model, { cache });
  const selected = isAutoCacheWriteModel(provider, model);
  const headTokens = mode === 'auto' ? input : mode === 'explicit' && cache ? Math.min(input, Math.max(0, Math.ceil(cache.headTokens ?? 0))) : 0;
  const headMult = mode === 'auto' ? autoWriteMultOf(p)
    : mode === 'explicit' && cache ? (cache.read === true ? (selected ? Math.min(1, p.cacheReadMult ?? 1) : cacheMultsOfCall(provider, model, p, cache.ttl).read) : (selected ? autoWriteMultOf(p) : cacheMultsOfCall(provider, model, p, cache.ttl).write)) : 1;   // `read`: only the dry run's rows for the later calls of a group set it (chain.js invoke() never does: its guard prices a marked call's head at the write price)
  // A3a: `pin` is the seat's OWN provider.max_price (ownPinOf). Per field the call is priced at the higher of the table row and that pin: a pin above the row raises the projection, a pin below never lowers it.
  const pIn = Math.max(p.in, pin?.prompt ?? 0), pOut = Math.max(p.out, pin?.completion ?? 0);
  const attempt = out => ((input - headTokens) / 1e6) * pIn + (headTokens / 1e6) * pIn * headMult + (out / 1e6) * pOut;
  const usd = attempt(maxTokens) * retries + (retryMaxTokens ? attempt(retryMaxTokens) : 0);
  return { usd, priced: true };
}

/**
 * The worst case of each attempt of one call, exactly as invoke() projects it before sending: the whole prompt as input and the
 * seat's whole maxTokens as output; an Anthropic seat gets a second, bigger attempt when its cap has room to grow (the same-effort
 * retry after thinking used the whole cap: retryCapFor, the model's ceiling). { first, retry } in dollars; retry is 0 when there is none.
 */
// The one predicate for "this seat's call may be repeated once at a bigger cap" (invoke() and projectAttempts use it; so does the add-on's calls_at_most): the seat's real identity
// is Anthropic, whichever transport carries it.
export const isAnthropicSeat = seat => (seat?.originalProvider ?? seat?.provider) === 'anthropic';

export function projectAttempts(seat, { system = '', user = '', cache = null } = {}) {
  const promptChars = promptCharsOf({ system, user });
  return projectAttemptsTokens(seat, { inputTokens: Math.ceil(promptChars / CHARS_PER_TOKEN), maxTokens: seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS, cache: cache ? { headTokens: Math.ceil(cache.headChars / CHARS_PER_TOKEN), ttl: cache.ttl } : null });
}

// The same two attempts from a token count instead of a prompt: the dry run's "maximum" (estimateChainRows, maximum: true) prices each planned call exactly as the cap would project it. `maxTokens` is the call's own output cap.
export function projectAttemptsTokens(seat, { inputTokens = 0, maxTokens = SEAT_DEFAULT_MAX_TOKENS, cache = null } = {}) {
  const promptChars = inputTokens * CHARS_PER_TOKEN;
  const pin = ownPinOf(seat);
  const first = worstCaseOf(seat.provider, seat.model, { promptChars, maxTokens, pin, cache }).usd;
  if (!isAnthropicSeat(seat)) return { first, retry: 0 };
  const retryCap = retryCapFor(maxTokens, retryCeilingOf(seat));
  if (retryCap <= maxTokens) return { first, retry: 0 };
  return { first, retry: worstCaseOf(seat.provider, seat.model, { promptChars, maxTokens: retryCap, pin, cache }).usd };
}

/**
 * The worst case of one call, exactly as invoke() projects it before sending: both attempts of projectAttempts. Shared so a stage
 * with its own ceiling inside the run's (the deep-dive seat) projects the same number the run cap does.
 */
export function projectStage(seat, opts = {}) {
  const { first, retry } = projectAttempts(seat, opts);
  return first + retry;
}

/**
 * Would running this stage risk breaching the ceiling? Pure, so it is
 * testable without a provider.
 *
 * `cap` of null means no ceiling and always returns ok.
 */
export function wouldBreach({ spent, cap, projected }) {
  if (cap === null || cap === undefined) return { breach: false };
  // Audit A1-5: a cap that is not a finite number above zero fails closed (comparisons with NaN are all false, which used to read as "fits").
  if (!(typeof cap === 'number' && Number.isFinite(cap) && cap > 0)) return { breach: true, after: spent + projected, remaining: 0 };
  // Cost-unit gate page U1 (audit item 2): a spent or projected figure that is not a finite number >= 0 fails closed. `NaN > cap` is false, so a NaN projection used to read as "fits", was admitted, and made `reserved` NaN for the rest of the sitting (the cap was off).
  if (![spent, projected].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return { breach: true, after: spent + projected, remaining: 0, unbounded: true };
  const after = spent + projected;
  return { breach: after > cap, after, remaining: Math.max(0, cap - spent) };
}

/**
 * The smallest whole-cent cap that wouldBreach lets a call through (T1-14: a refusal that names a figure must name one that passes): rounded up to the cent, then checked with the SAME predicate that refused, so float noise
 * (0.07 * 100 is 7.000000000000001) cannot make the named figure fail.
 */
export function smallestCapThatPasses(spent, projected) {
  if (![spent, projected].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return NaN;   // no figure passes an unbounded call; formatUsd says "an unknown amount"
  let cents = Math.ceil((spent + projected) * 100);
  while (wouldBreach({ spent, cap: cents / 100, projected }).breach && cents < 1e12) cents++;
  return cents / 100;
}
