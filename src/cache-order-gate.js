// The gate of the cache-shaped prompt order (0.8.4 cache part (b)1), kept apart from src/cache-order.js so that the cost estimate (src/cost.js) can read the same predicate without importing the layout code (and, through it, the providers).
// Nothing here holds a prompt word: the words come from held() (src/held-roles.js), by name.
//
// WHEN THE ORDER IS LIVE (C&C, 10 Nov 2026: the order is never live while a recorded sentence is untrue under it): the chain's prompt_cache switch is on AND every held name of the batch is recorded together: the lead-in of a judge's
// instructions (`judgeKindLeadIn`); the phrase that puts the instructions where the re-ask notes say they are (`orderInstructionsPhrase`: the notes tell a re-asked judge to answer "with the JSON object the system prompt describes", and
// in the new order the system text no longer describes it); the two judge-side excerpt sentences that say the excerpts are "marked as such below" (the block now stands above the instructions): `criticOnlySourceSentenceOrder`,
// `criticExcerptOnlyRuleOrder`; and the two kind-neutral boundary lines (the head H is the same for every call kind, and a post or an answer grades no draft): `draftBoundarySentenceNeutral`, `draftEndLineNeutral`; and the heading of the request to repair an almost-JSON reply, which says the reply format was the seat's system prompt (`repairFormatWhereOrder`).
// A seat that is a session (external) seat is never given the order.
import { held } from './held-roles.js';
import { promptCacheTtl, isDirectAnthropicSeat, isRoutedClaudeSeat } from './prompt-cache.js';
import { shortExchangeOn } from './short-exchange.js';
import { highExtraFor } from './reasoning.js';

/** The held names that make the order live, recorded all together or none (test/held-prompts-084-cache-order.test.js). */
export const ORDER_WORDS = Object.freeze(['judgeKindLeadIn', 'orderInstructionsPhrase', 'criticOnlySourceSentenceOrder', 'criticExcerptOnlyRuleOrder', 'draftBoundarySentenceNeutral', 'draftEndLineNeutral', 'repairFormatWhereOrder']);
export const cacheOrderWordsOn = () => ORDER_WORDS.every(name => typeof held(name) === 'function');

/** Is the new order live for the CHAIN: the prompt_cache switch is on and its words are recorded? */
export const cacheOrderOn = config => promptCacheTtl(config) !== null && cacheOrderWordsOn();

/** Does this seat get the new order? The one predicate. A session (external) seat keeps today's order: its instructions are the system text it is handed. */
export const cacheOrderSeat = (config, seat) => cacheOrderOn(config) && seat?.provider !== 'external';

// The words of the recorded re-ask notes that name the system prompt as the place of the reply format (src/prompts/recorded-082.js criticReaskNote, criticUnansweredNote; recorded-083.js criticStatedPassNote, severityReaskNote; the held
// signoffRefusedReaskNote). They are replaced by the recorded phrase where the order is live, in the harness's own note only, never in text a judge quoted.
const SYSTEM_PROMPT_PHRASE = 'the system prompt describes';

/** A re-ask note as a seat is sent it: with the order live for the seat, the phrase that names the system prompt is replaced by the recorded one. Not live, or no note: the very same text. */
export function orderNote(config, seat, text) {
  if (typeof text !== 'string' || !cacheOrderSeat(config, seat)) return text;
  // Only the LAST occurrence: the harness's own sentence comes after any text of the judge's that a note carries (the severity notes name the judge's own criterion before it), so a criterion that happens to contain the phrase is never touched.
  const at = text.lastIndexOf(SYSTEM_PROMPT_PHRASE);
  return at < 0 ? text : `${text.slice(0, at)}${held('orderInstructionsPhrase')()}${text.slice(at + SYSTEM_PROMPT_PHRASE.length)}`;
}

/**
 * Does the layer of this judge seat run an exchange (a post and an answer round after the blind review), BY SHAPE? A layered unanimous chain: the lowest layer with two or more judges always, an upper layer only with the shortened
 * exchange recorded (src/short-exchange.js) and two or more judges there. A first-mode chain, a chain whose critics are not all layered and a layer of one judge run none. By shape only: a pass that ends with one heard judge still pays what it paid
 * (the dry run counts the calls a pass COULD make, like every other row). No number of rounds appears here.
 */
export function exchangeLayerOf(config, seat) {
  const critics = Array.isArray(config?.seats?.critics) ? config.seats.critics : [];
  if (config?.signoff !== 'unanimous' || !critics.length || !critics.every(c => c && Number.isInteger(c.layer)) || !Number.isInteger(seat?.layer)) return false;
  if (critics.filter(c => c.layer === seat.layer).length < 2) return false;
  return seat.layer === Math.min(...critics.map(c => c.layer)) || shortExchangeOn();
}

/**
 * THE MARK RULE (cache part (b)1; 0.8.4): the cache lifetime text ('5m' or '1h') a judge call of this seat is marked with, or null. Marked: every judge call of a direct-Anthropic seat (the panel and its retries and re-asks, the exchange post and
 * answer) whose order is live and whose layer runs an exchange (exchangeLayerOf), because only such a group of calls (a seat's calls in one pass, all starting with the same system text and the same head H) can read what the first one wrote.
 * Never the final read, never the first-mode critic (they are not asked for here), never a seat that is alone in its layer (single BY SHAPE: it would pay the write and read nothing). A seat whose reasoning setting depends on the output cap (settingsDependOnCap) is not marked either. Everything else is null: the order only.
 */
export function markTtlOf(config, seat) {
  const ttl = promptCacheTtl(config);
  // A routed Claude seat (isRoutedClaudeSeat) is marked on the same rule, always at 5 minutes whatever the chain's lifetime is (his 10 Nov 2026 04:05 heading names 5 minutes for them; plan-claude-council's 1 hour is for its direct seats). The rate it is projected at is the write multiple of OpenRouter's own page for Claude models (src/cache-prices.js).
  return ttl && cacheOrderSeat(config, seat) && (isDirectAnthropicSeat(seat) || isRoutedClaudeSeat(seat)) && exchangeLayerOf(config, seat) && !settingsDependOnCap(seat) ? (isRoutedClaudeSeat(seat) ? '5m' : ttl) : null;
}

/**
 * Anthropic invalidates a cache entry when the thinking configuration (or the effort) of a request differs from the one that wrote it. A seat whose reasoning setting is DERIVED from the call's output cap (the budget form: a model
 * with no effort levels and no reasoning field of its own gets thinking.budget_tokens = a share of the cap, src/reasoning.js highExtraFor) sends a different setting whenever a call runs at a different cap (a bigger-cap retry), so its
 * later calls cannot be counted as reads: such a seat is not marked. A seat with an effort level or a reasoning field of its own sends the same setting at every cap.
 */
export function settingsDependOnCap(seat) {
  const cap = seat?.panelMaxTokens ?? seat?.maxTokens;
  if (typeof cap !== 'number') return false;
  const at = c => JSON.stringify(highExtraFor({ ...seat, maxTokens: c }, c));
  return at(cap) !== at(cap * 2);
}
