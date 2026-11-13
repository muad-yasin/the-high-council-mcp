// 0.8.4 S4b (M1; CA6, Q1(g), W26): the two prompt texts of the LAST (seventh) round of the ENDING exchange, composed in ONE place from the recorded ones, so the exchange and the cost estimate read the same text.
//   post:  the ordinary post prompt of the judge (stage-system.js layerDebateSystemFor, persona block and ratings sentence included) with the recorded sentence on a newly found defect REPLACED by W26 (held('lateFindingRule'));
//   reply: the ordinary reply prompt of the raiser with W26's reply half appended (held('lastRoundReplyRule'): keep or withdraw, no amend).
// The held state: nothing here is used (`endingExchangeOn()` is false) and no call is added. ONE held read, the sentence lateFindingRule, switches the whole ending exchange on (its calls, its record, its cost rows) with this text and the reading of the field late_finding.
import { held } from './held-roles.js';
import { layerDebateSystemFor, layerReplySystemFor } from './stage-system.js';
import { withoutNotes } from './persona-record.js';

/** Is the ending exchange in force? True exactly while W26 (lateFindingRule) is recorded. */
export const endingExchangeOn = () => typeof held('lateFindingRule') === 'function';

/** The recorded sentence that W26 replaces in the last round (src/prompts/recorded-083.js, the post prompt), as the plain text has it. */
export const NEW_DEFECT_SENTENCE = 'If you find a material defect in the plan that is not on the list, put it in "new_objections": something the plan says or leaves out that fails the request or a criterion, not a wish to widen its scope. It is recorded with the other objections of this layer and is never dropped.';
// With the rating demand recorded (withSeverityPost) the closing sentence of that paragraph changes ("... follows the same rating rule.") and the sentence that asks for a rating on a new objection is added after it, in a form that depends on the ledger and the handler.
// So the cut is made BETWEEN two recorded anchors that hold in every variant: the opening of the sentence, and the recorded line that follows the whole paragraph. Everything from the one to the other is the paragraph about a newly found defect (and its rating); W26 takes its place.
const NEW_DEFECT_OPENING = 'If you find a material defect in the plan that is not on the list, put it in "new_objections": something the plan says or leaves out that fails the request or a criterion, not a wish to widen its scope.';
const AFTER_NEW_DEFECT = '\nNo count of posts settles an objection, for or against it.';

/**
 * The post prompt of the last round: the ordinary text (any variant: plain, or with the rating demand, with or without the ledger and the handler) with W26 in place of the paragraph on a newly found defect, so no sentence asking for a new objection,
 * or for its rating, is left in the last round. It throws when either anchor is not found exactly once, instead of keeping two sentences. The JSON example below the paragraph is not touched (format text; named to the wording review).
 */
export function lastRoundPostSystem(config, seat, again) {
  const base = layerDebateSystemFor(config, seat, again);
  const once = text => base.split(text).length === 2;
  if (!once(NEW_DEFECT_OPENING) || !once(AFTER_NEW_DEFECT)) throw new Error('the post prompt no longer carries, exactly once, the paragraph on a newly found defect and the line after it, so the last round\'s rule on late findings cannot take the paragraph\'s place');
  const from = base.indexOf(NEW_DEFECT_OPENING); const to = base.indexOf(AFTER_NEW_DEFECT);
  if (to < from) throw new Error('the post prompt carries the line after the paragraph on a newly found defect before the paragraph: the last round\'s rule on late findings cannot take the paragraph\'s place');
  return `${base.slice(0, from)}${held('lateFindingRule')()}${base.slice(to)}`;
}

/** The reply prompt of the last round: the ordinary text with W26's reply half appended (or the ordinary text when that half is not recorded). */
export function lastRoundReplySystem(config, seat, again) {
  const base = layerReplySystemFor(config, seat, again);
  const rule = held('lastRoundReplyRule');
  return typeof rule === 'function' ? `${base}\n\n${rule()}` : base;
}

/**
 * C&C's item 2: the check that the last round's prompts can be composed, made ONCE, at the START of the run (src/chain.js runChainStages, after the chain's own refusals), before the first paid call: while W26 is recorded, on a layered chain, for every
 * layer-1 seat and both `again` values (the seventh round is `again`; the first is not), post and reply. A mismatch stops the run before it spends; at the end of a run it would fire after the spend, and inside exchangeRound the same throw would be read as
 * the judge's no_reply. Not recorded, or not layered: nothing is built. The prompts are built inside withoutNotes, so the persona record (src/persona-record.js) is not touched by a build that sends nothing.
 */
export function assertEndingPrompts(config) {
  if (!endingExchangeOn()) return;
  const critics = Array.isArray(config?.seats?.critics) ? config.seats.critics : [];
  if (!critics.length || !critics.every(c => c && c.layer !== undefined)) return;
  const lowest = Math.min(...critics.map(c => c.layer));
  withoutNotes(() => {
    for (const seat of critics.filter(c => c.layer === lowest)) for (const again of [false, true]) { lastRoundPostSystem(config, seat, again); lastRoundReplySystem(config, seat, again); }
  });
}
