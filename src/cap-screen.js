// The screen a person reads before typing the spending limit (typed-cap gate page T2 and section 6, 14 Oct 2026; Astra #4: four numbers, one blank field, no promise it cannot keep). PURE: figures in, text out. The same text is the terminal prompt's body and the MCP
// elicitation's message. Every sentence here is a DRAFT for Muad's yes (E 145).
//
// Contract:
//   buildCapScreen({ kind, subject, estimate, maximum, ceilings, suggestion, priceAsOf, landed }) -> { text, fields, enforcement }
//     kind        'run' | 'tree' | 'side' | 'legacy' | 'raise' | 'amend'   (a tree's estimate covers the root run only; its maximum is unknown; 'side' = a paid command on a finished run, T5: `subject.verb` names it, and `history.floorUsd` what its folder already counted)
//     subject     the chain and task the person is about to start     { chain, task }
//     estimate    { usd, scope } | null                               the dry-run projection and what it covers; null = none available
//     maximum     { usd } | { unknown: '<why>' }                      the dry run's second figure when the whole workload is bounded; otherwise the word unknown with its reason
//     ceilings    [{ usd, source }]                                   every ceiling in force (COUNCIL_MAX_USD_LIMIT, the plugin's max_usd): the typed amount cannot exceed them
//     suggestion  { usd, source } | null                              a configured value (MAX_USD_PER_RUN, a flag): SHOWN, never in the field and never the entry
//     userPrices  [{ key, in, out }] the seats priced by the project's pricing.user.json: their FIGURES are shown
//     landed      the cost-unit items that have landed                 selects the enforcement sentence (one switch, below)
//   The limit field is BLANK by construction: this builder returns no default and no prefilled value.
import { formatUsd } from './cost.js';

/** The cost-unit items that must all have landed before the screen may say the limit bounds every request (cost-unit gate page section 4): U2 per-attempt bounds, U3 billed cost recorded, U5 dearest-endpoint rows, U6 tiers, U7 byte input bound, U9 the output side. Nothing has landed yet. */
export const STRONG_ENFORCEMENT_NEEDS = Object.freeze(['U2', 'U3', 'U5', 'U6', 'U7', 'U9']);
export const COST_UNIT_LANDED = Object.freeze([]);

/** 'weak' until every item of STRONG_ENFORCEMENT_NEEDS is in `landed`. The caller passes the landed list; the default is today's. */
export function enforcementState(landed = COST_UNIT_LANDED) {
  return STRONG_ENFORCEMENT_NEEDS.every(item => landed.includes(item)) ? 'strong' : 'weak';
}

// The two enforcement sentences. WEAK is what the code can promise today (the price used for the check is the table's row for each model, the input is counted as characters / 4 and an attempt retried inside one call is not separately bounded: cost-unit gate page);
// STRONG is a separate E item that turns on only when the items above have landed. Neither claims a bound on anything outside THC (a key used elsewhere, an advisor that is not a THC call).
export const ENFORCEMENT_SENTENCES = Object.freeze({
  weak: 'Before each call, THC adds up what the run has spent and the most that call could cost, and refuses the call if the total passes your limit. The price it uses is the price table\'s row for each model, so a provider that charges more can take a call past your limit by that difference. This is a guardrail, not a guarantee.',
  strong: 'Every request THC makes is refused before it is sent when its worst case would pass your limit, retried requests included. If a bill turns out higher than that worst case, THC records the full amount and sends nothing more. This does not cover a key used outside THC.',
});
export const COMPLETION_SENTENCE = 'The run may stop unfinished when the limit that is left cannot cover the next call.';

export function buildCapScreen({ kind = 'run', subject = {}, notesMemory = '', estimate = null, maximum = { unknown: 'it was not computed' }, ceilings = [], suggestion = null, priceAsOf = null, landed = COST_UNIT_LANDED, userPrices = [], history = null } = {}) {
  const what = kind === 'tree' ? 'tree' : kind === 'side' && subject.verb ? subject.verb : 'run';
  const later = kind === 'legacy' || kind === 'raise' || kind === 'amend';   // T4b2: a run's limit AFTER the first one (or for a run made before the typed limit existed): the figures are what it has already counted
  const enforcement = enforcementState(landed);
  const fields = {
    estimate: estimate && Number.isFinite(estimate.usd)
      ? `Estimate: about ${formatUsd(estimate.usd)} for ${estimate.scope ?? `this ${what}`}${priceAsOf ? `, at the prices of ${priceAsOf}` : ''}.`
      : 'Estimate: not available.',
    maximum: maximum && Number.isFinite(maximum.usd)
      ? `Most it could cost to finish, by the dry run's count: ${formatUsd(maximum.usd)} (not a ceiling: see below).`
      : `Most it could cost to finish, by the dry run's count: unknown (${maximum?.unknown ?? 'it was not computed'}).`,
    limit: `Your limit: type the total, in US dollars, that this ${what} may spend (for example 5). THC refuses any call whose projected cost would take the total past it.`,
    ceilings: ceilings.filter(c => c && Number.isFinite(c.usd)).map(c => `Ceiling in force: ${formatUsd(c.usd)}${c.source ? ` (set by ${c.source})` : ''}. You cannot type more.`),
    suggestion: suggestion && Number.isFinite(suggestion.usd) ? `Configured suggestion: ${formatUsd(suggestion.usd)}${suggestion.source ? ` (from ${suggestion.source})` : ''}. It is shown only; it is not your limit until you type it.` : null,
    // The figures a person is about to rely on, from the project's own price file (never only a label: $0.01 must be visible before typing). The wording is HELD (E item).
    userPrices: userPrices.length ? `Priced from pricing.user.json in your project folder: ${userPrices.map(r => `${r.key} in ${r.in} / out ${r.out} per million tokens${r.src && r.src.in !== r.src.out ? ` (the ${r.src.in === 'shipped' ? 'in' : 'out'} figure is the package's, the higher one)` : ''}`).join('; ')}. THC's cost projection is only as good as those figures.` : null,
    enforcement: ENFORCEMENT_SENTENCES[enforcement],
    completion: COMPLETION_SENTENCE,
  };
  // The history block of a later screen. Every figure is the caller's (cli.js reads the run folder; the raise floor and suggestion come from STOPPED-budget.json through src/resume-ceiling.js): nothing is derived here.
  const h = history || {};
  const money = n => (Number.isFinite(n) ? formatUsd(n) : 'unknown');
  const lines = [];
  if (kind === 'legacy') lines.push(`This run was started before a typed limit existed.`, `Already counted: ${money(h.spentUsd)}${h.unsettledUsd > 0 ? `, of which ${money(h.unsettledUsd)} is for calls that were still running when the run stopped and may or may not have been billed` : ''}.`);
  if (kind === 'raise') lines.push(`This run stopped at its limit of ${money(h.previousCapUsd)}: ${money(h.spentUsd)} counted${Number.isFinite(h.projectedStageUsd) ? `, and the next stage could cost up to ${money(h.projectedStageUsd)}` : ''}.`, ...(Number.isFinite(h.suggestedUsd) ? [`The smallest total that gets past this stop: ${money(h.suggestedUsd)}.`] : []));
  if (kind === 'amend') lines.push(Array.isArray(h.changed) && h.changed.length ? `Changed since the limit for this run was typed: ${h.changed.join('; ')}.` : 'Something this run was started with changed since its limit was typed; the earlier state of this run cannot be shown.', `Previous limit: ${money(h.previousCapUsd)}. Already counted: ${money(h.spentUsd)}.`);
  const floorLine = later && Number.isFinite(h.floorUsd) ? ` It must be above ${money(h.floorUsd)}, what the run has already counted.` : '';
  // T5: a side command on a folder that already spent (an earlier sitting of the same rematch or replay, or the original run for handoff / draft / digest): the limit is a TOTAL for that folder, above what it has counted.
  const sideCounted = kind === 'side' && Number.isFinite(h.floorUsd) && h.floorUsd > 0;
  if (sideCounted) { lines.push(`Already counted for this folder: ${money(h.floorUsd)}.`); fields.limit = `Your limit: type the TOTAL, in US dollars, for this run folder as a whole, counting the ${money(h.floorUsd)} the run has already counted (not extra for this ${what} alone). It must be above ${money(h.floorUsd)}. THC refuses any call that would take the total past it.`; }
  if (later) fields.limit = `Your new limit: type the TOTAL, in US dollars, for the whole run (not extra).${floorLine} THC refuses any call that would take the total past it.`;
  fields.history = lines.length ? lines : null;
  const head = later
    ? `Continue this run?${subject.chain ? ` Chain: ${subject.chain}.` : ''}${subject.task ? ` Task: ${subject.task}.` : ''}`
    : kind === 'side' ? `Run this ${what}?${subject.chain ? ` Chain: ${subject.chain}.` : ''}${subject.task ? ` Task: ${subject.task}.` : ''}`
    : `Start this ${what}?${subject.chain ? ` Chain: ${subject.chain}.` : ''}${subject.task ? ` Task: ${subject.task}.` : ''}`;
  const text = [head, '', ...(later ? [...lines, ...fields.ceilings] : [fields.estimate, fields.maximum, ...(notesMemory ? [`Not counted in either figure: ${notesMemory}.`] : []), ...(sideCounted ? lines : []), ...fields.ceilings]), ...(fields.suggestion ? [fields.suggestion] : []), ...(fields.userPrices ? [fields.userPrices] : []), '', fields.limit, '', fields.enforcement, fields.completion].join('\n');
  return { text, fields, enforcement };
}
