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
import { staleSentences } from './stale-stages.js';
import { estimatedPartWords } from './counted-spend.js';

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
  weak: 'Before each call, THC adds up what the run has counted and what that call is expected to cost (its worst case, where THC has no expected size for it), and refuses the call if the total passes your limit. A re-ask or a retry is checked at the expected cost of the call it repeats. The price it uses is the price table\'s row for each model, so a provider that charges more can take a call past your limit by that difference. This is a guardrail, not a guarantee.',
  strong: 'Every request THC makes is refused before it is sent when its worst case would pass your limit, retried requests included. If a bill turns out higher than that worst case, THC records the full amount and sends nothing more. This does not cover a key used outside THC.',
});
export const COMPLETION_SENTENCE = 'The run may stop unfinished when the limit that is left cannot cover the next call.';

/** The host-preference paragraph (provider-preference.json): shown on the screen with the switch off, and by the dry run (per-cap screens leave it out). Null for no rows. */
export const preferenceSentence = (preferences = []) => (preferences.length ? `Host preference (provider-preference.json in your project folder): ${preferences.map(r => `${r.key}: ${r.prefer.join(', ')}`).join('; ')}. OpenRouter is asked to try these hosts first, in this order, and any other host only if none of them can serve the call. A bare tag also covers that provider's regional endpoints, and a host the chain ignores is skipped. The preference changes only the order hosts are tried in; each host keeps its own listed price.` : null);

/** The line of a limit screen that says what the person's recorded finish does (unit-end item i; A-DRAFT LAD-R36). One prefix, so a pending screen can be told from one that must be asked again when the finish changed. */
export const FINISH_NOTE_PREFIX = 'What your finish does: ';
export function buildCapScreen({ kind = 'run', subject = {}, notesMemory = '', estimate = null, maximum = { unknown: 'it was not computed' }, ceilings = [], suggestion = null, priceAsOf = null, landed = COST_UNIT_LANDED, userPrices = [], preferences = [], history = null, cap = null, route = null } = {}) {
  // 0.8.4 DUALCAP unit 4b2: `cap` = { id, of } asks the limit of ONE per-provider cap (one screen per cap in force). The figures stay the run's: the dry run's rows
  // name a seat as provider/model, which does not say which account a mock seat bills through, so the screen says they cover every provider (A-DRAFT).
  const capId = cap && typeof cap.id === 'string' ? cap.id : null;
  const what = kind === 'tree' ? 'tree' : kind === 'side' && subject.verb ? subject.verb : 'run';
  const later = kind === 'legacy' || kind === 'raise' || kind === 'raise_early' || kind === 'amend';   // T4b2: a run's limit AFTER the first one (or for a run made before the typed limit existed): the figures are what it has already counted
  const enforcement = enforcementState(landed);
  const fields = {
    estimate: estimate && Number.isFinite(estimate.usd)
      ? `Estimate: about ${formatUsd(estimate.usd)} for ${estimate.scope ?? `this ${what}`}${priceAsOf ? `, at the prices of ${priceAsOf}` : ''}.`
      : 'Estimate: not available.',
    maximum: maximum && Number.isFinite(maximum.usd)
      ? `Upper estimate to finish, by the dry run's count: ${formatUsd(maximum.usd)} (not a ceiling: see below).`
      : `Upper estimate to finish, by the dry run's count: unknown (${maximum?.unknown ?? 'it was not computed'}).`,
    limit: capId ? `Your limit for ${capId}: type the total, in US dollars, that this ${what} may spend through ${capId} (for example 5). THC refuses any ${capId} call whose projected cost, added to what the run has already counted through ${capId}, would pass that limit.` : `Your limit: type the total, in US dollars, that this ${what} may spend (for example 5). THC refuses any call whose projected cost would take the total past it.`,
    ceilings: ceilings.filter(c => c && Number.isFinite(c.usd)).map(c => `Ceiling in force: ${formatUsd(c.usd)}${c.source ? ` (set by ${c.source})` : ''}. You cannot type more.`),
    suggestion: suggestion && Number.isFinite(suggestion.usd) ? `Configured suggestion: ${formatUsd(suggestion.usd)}${suggestion.source ? ` (from ${suggestion.source})` : ''}. It is shown only; it is not your limit until you type it.` : null,
    // The figures a person is about to rely on, from the project's own price file (never only a label: $0.01 must be visible before typing; the screen with the switch off: a per-cap screen sends the person to the dry run). The wording is HELD (E item).
    userPrices: userPrices.length ? `Priced from pricing.user.json in your project folder: ${userPrices.map(r => `${r.key} in ${r.in} / out ${r.out} per million tokens${r.src && r.src.in !== r.src.out ? ` (the ${r.src.in === 'shipped' ? 'in' : 'out'} figure is the package's, the higher one)` : ''}`).join('; ')}. THC's cost projection is only as good as those figures.` : null,
    // 0.8.4 PRICES unit 3: the hosts the project's provider-preference.json asks OpenRouter to try first for this chain's models (the start scope binds the approval to them). Omitted when the file names none. The wording is HELD (E item).
    preferences: preferenceSentence(preferences),
    enforcement: ENFORCEMENT_SENTENCES[enforcement],
    completion: COMPLETION_SENTENCE,
  };
  // The history block of a later screen. Every figure is the caller's (cli.js reads the run folder; the raise floor and suggestion come from STOPPED-budget.json through src/resume-ceiling.js): nothing is derived here.
  const h = history || {};
  const money = n => (Number.isFinite(n) ? formatUsd(n) : 'unknown');
  const lines = [];
  if (kind === 'legacy') lines.push(`This run was started before a typed limit existed.`, `Already counted: ${money(h.spentUsd)}${h.unsettledUsd > 0 ? `, of which ${money(h.unsettledUsd)} is for calls that were still running when the run stopped and may or may not have been billed` : ''}${h.estimatedUsd > 0 ? `; ${money(h.estimatedUsd)} of it is an estimate` : ''}.`);
  // unit 4c1: a raise of ONE per-provider cap names it, and its figures are that cap's (A-DRAFT S1, S2)
  if (kind === 'raise') lines.push(capId ? `This run stopped at its ${capId} limit of ${money(h.previousCapUsd)}: ${money(h.spentUsd)} counted through ${capId}${Number.isFinite(h.projectedStageUsd) ? `, and the next stage could cost up to ${money(h.projectedStageUsd)}` : ''}.` : `This run stopped at its limit of ${money(h.previousCapUsd)}: ${money(h.spentUsd)} counted${estimatedPartWords(h.estimatedUsd, formatUsd)}${Number.isFinite(h.projectedStageUsd) ? `, and the next stage could cost up to ${money(h.projectedStageUsd)}` : ''}.`, ...(Number.isFinite(h.suggestedUsd) ? [`The smallest total that lets the next call to a model be sent: ${money(h.suggestedUsd)}.`] : []));
  if (kind === 'raise_early') lines.push(capId ? `This run is under a ${capId} limit of ${money(h.previousCapUsd)}: ${money(h.spentUsd)} counted through ${capId}.` : `This run is under a limit of ${money(h.previousCapUsd)}: ${money(h.spentUsd)} counted${estimatedPartWords(h.estimatedUsd, formatUsd)}.`);   // A-DRAFT (B3 prototype: a raise before the run has stopped at its limit)
  if (kind === 'amend') lines.push(Array.isArray(h.changed) && h.changed.length ? `Changed since the limit for this run was typed: ${h.changed.join('; ')}.` : 'Something this run was started with changed since its limit was typed; the earlier state of this run cannot be shown.', `Previous limit: ${money(h.previousCapUsd)}. Already counted: ${money(h.spentUsd)}.`);
  // A changed chain or task affects the finished steps made before it: each one the run reaches again is asked again, the ones that bill are paid again, and what they cost before still counts toward the limit. Said before he types (A-DRAFT, LAD-S3 / LAD-S4); only when the caller counted such steps or the run adopts the ladder.
  if (kind === 'amend' && h.rerun && h.rerun.n > 0) lines.push(staleSentences(h.rerun));
  if (kind === 'amend' && h.rerun && h.rerun.ladder === true) lines.push('This chain now runs the ladder from its key: every finished step that answered a different prompt is asked again, the ones that bill are paid again, and what they cost before still counts toward the limit.');
  const floorLine = kind === 'raise_early' && Number.isFinite(h.previousCapUsd) ? ` It must be above ${money(h.previousCapUsd)}, the limit it has now.` : later && Number.isFinite(h.floorUsd) ? ` It must be above ${money(h.floorUsd)}, what the run has already counted${capId ? ` through ${capId}` : ''}.` : '';   // A-DRAFT for raise_early
  // T5: a side command on a folder that already spent (an earlier sitting of the same rematch or replay, or the original run for handoff / draft / digest): the limit is a TOTAL for that folder, above what it has counted.
  const sideCounted = kind === 'side' && Number.isFinite(h.floorUsd) && h.floorUsd > 0;
  if (sideCounted) { lines.push(`Already counted for this folder: ${money(h.floorUsd)}.`); fields.limit = `Your limit: type the TOTAL, in US dollars, for this run folder as a whole, counting the ${money(h.floorUsd)} the run has already counted (not extra for this ${what} alone). It must be above ${money(h.floorUsd)}. THC refuses any call that would take the total past it.`; }
  if (later) fields.limit = capId ? `Your new limit for the ${capId} cap: type the TOTAL, in US dollars, for what the run spends through ${capId} (not extra).${floorLine} THC refuses any such call that would take that cap past it.` : `Your new limit: type the TOTAL, in US dollars, for the whole run (not extra).${floorLine} THC refuses any call that would take the total past it.`;   // the cap's variant: A-DRAFT S3
  // 0.8.4 (ladder unit, C&C 10 Nov, unit-end item i; A-DRAFT LAD-R15/R20): what the person's recorded --finish does to this raise is said ON THE SCREEN they read before they type the figure - the terminal, the MCP dialog and the relayed raise all show this stored text, and a note printed after the approval is read too late.
  if (later && typeof h.finishNote === 'string' && h.finishNote.trim()) lines.push(`${FINISH_NOTE_PREFIX}${h.finishNote.trim()}`);
  fields.history = lines.length ? lines : null;
  // 0.8.4, C&C's Q3 ruling (R246; CL-E91: the screen that asks for the figure names first what the figure is for): the head of a run's limit AFTER the first one says so, for all four kinds. A-DRAFT.
  // Under per-provider caps the run has several limits and the screen is about ONE (the capLine above says which), so the head names it: any of the four kinds can carry a cap id.
  const laterHead = capId
    ? { legacy: `Set the ${capId} spending limit for this run?`, raise: `Raise this run's ${capId} spending limit?`, raise_early: `Raise this run's ${capId} spending limit?`, amend: `Set this run's ${capId} spending limit again?` }[kind]
    : { legacy: 'Set a spending limit for this run?', raise: 'Raise the spending limit of this run?', raise_early: 'Raise the spending limit of this run?', amend: 'Set the spending limit of this run again?' }[kind];
  const head = later
    ? `${laterHead}${subject.chain ? ` Chain: ${subject.chain}.` : ''}${subject.task ? ` Task: ${subject.task}.` : ''}`
    : kind === 'side' ? `Run this ${what}?${subject.chain ? ` Chain: ${subject.chain}.` : ''}${subject.task ? ` Task: ${subject.task}.` : ''}`
    : `Start this ${what}?${subject.chain ? ` Chain: ${subject.chain}.` : ''}${subject.task ? ` Task: ${subject.task}.` : ''}`;
  // DUALCAP milestone 2 (Muad: "no clear and easy to see indication what the number is for"): under a cap the screen opens with the cap's name in capitals (H1), and a start
  // shows THAT cap's estimate by the dry run's count (E1; E2 when nothing priced bills through it: its rows sum to $0) in place of the whole-run estimate and maximum. A-DRAFT.
  const capLine = capId ? `${capId.toUpperCase()} spending limit (cap ${Array.isArray(cap.of) && cap.of.includes(capId) ? cap.of.indexOf(capId) + 1 : 1} of ${Array.isArray(cap.of) && cap.of.length ? cap.of.length : 1}${Array.isArray(cap.of) && cap.of.length ? `: ${cap.of.join(', ')}` : ''})` : null;
  if (capId && !later) {
    const e = estimate && Number.isFinite(estimate.usd) ? estimate.usd : 0;
    fields.estimate = e > 0 ? `Calls through ${capId}, by the dry run's count${priceAsOf ? ` at the prices of ${priceAsOf}` : ''}: about ${formatUsd(e)}; upper estimate ${maximum && Number.isFinite(maximum.usd) ? formatUsd(maximum.usd) : 'unknown'} (not a ceiling).` : `No priced call goes through ${capId}, by the dry run's count.`;
    fields.maximum = null;
  }
  // Muad's yes (1 Nov 2026, the limit-screen cleanup): a per-cap screen (start or raise) leaves out the pricing.user.json and host-preference paragraphs; the dry run
  // prints both (userPriceLines, preferenceSentence). The screen with the switch off keeps them, byte for byte.
  if (capId) { fields.userPrices = null; fields.preferences = null; }
  const text = [...(capLine ? [capLine] : []), head, '', ...(later ? [...lines, ...fields.ceilings] : [fields.estimate, ...(fields.maximum ? [fields.maximum] : []), ...(notesMemory ? [`Not counted in either figure: ${notesMemory}.`] : []), ...(sideCounted ? lines : []), ...fields.ceilings]), ...(fields.suggestion ? [fields.suggestion] : []), ...(fields.userPrices ? [fields.userPrices] : []), ...(fields.preferences ? [fields.preferences] : []), ...(route ? [route] : []), '', fields.limit, '', fields.enforcement, fields.completion].join('\n');
  return { text, fields, enforcement };
}
