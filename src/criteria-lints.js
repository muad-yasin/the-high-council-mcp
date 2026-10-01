// $0 lints over the acceptance criteria, run before any paid review round (0.8.0, roadmap "Debate,
// criteria, milestones" item 2). The panel grades a draft against these criteria and nothing else, so
// a criterion that cannot be shown false lets a weak plan pass, and a list that never asks whether the
// plan agrees with itself never checks that. Three heuristics, each named, none blocking: a finding is
// a line in the run log and an entry in report.json, never a stop and never a reason to re-ask a model.
//
// They are word-level heuristics, in the same posture as src/lints.js and src/criteria-kinds.js: they
// miss a rephrasing and can flag a good criterion; a person reading the list is the judge.
//
//   no-consistency    a list of three or more that never asks the plan to agree with itself
//                     (consistent, contradict, cross-reference, the same name/number everywhere)
//   presence-heavy    at least 60% of a list of three or more only ask that the plan NAME, LIST or
//                     MENTION something, with no number, check or condition on it
//   vague-words       one finding per criterion using a vague word (scalable, robust, intuitive, ...)
//                     with no number or named check beside it (the same test as criteria_kinds)
import { isVague } from './criteria-kinds.js';
import { criterionIds } from './criteria-ledger.js';

export const PRESENCE_SHARE = 0.6;
export const MIN_LIST = 3;

const CONSISTENCY = /\b(consisten(?:t|tly|cy)|contradict\w*|cross[- ]?referenc\w*|agrees? with|in agreement|same (?:name|term|number|figure|value)s?|match(?:es)? (?:the|its|across|between))\b/i;
const PRESENCE = /^\s*(?:the |a |an )?(?:plan|deliverable|document|handoff|proposal|design|spec(?:ification)?)\s+(?:names?|lists?|includes?|mentions?|states?|contains?|has|describes?|identifies|provides|covers|specif(?:y|ies))\b/i;
const CONDITION = /\d|`[^`]+`|\b(every|each|all|only|never|without|unless|before|after|because|at least|at most|no more than|fewer than|within|exactly|matches?|consisten\w*|contradict\w*)\b|\bno\s/i;

const text = c => (typeof c === 'string' ? c : c && typeof c === 'object' ? String(c.criterion ?? c.text ?? '') : '');

/** Presence-only: asks that something be named or listed, and puts no condition on it. */
export const isPresenceOnly = c => PRESENCE.test(text(c)) && !CONDITION.test(text(c));

/**
 * Lint a criteria list. Returns [{ id, message, criterion_ids }] (empty when clean); `criterion_ids`
 * are the positional ids (C1, C2, ...) of src/criteria-ledger.js. Never throws, never calls anything.
 */
export function lintCriteria(criteria) {
  const list = (Array.isArray(criteria) ? criteria : []).map(text).map(s => s.trim()).filter(Boolean);
  if (!list.length) return [];
  const ids = criterionIds(list);
  const out = [];
  if (list.length >= MIN_LIST && !list.some(c => CONSISTENCY.test(c))) {
    out.push({ id: 'no-consistency', criterion_ids: [], message: 'no criterion asks the plan to be consistent with itself (names, numbers and decisions that must agree across sections); the panel will not check it.' });
  }
  const presence = ids.filter((_, i) => isPresenceOnly(list[i]));
  if (list.length >= MIN_LIST && presence.length / list.length >= PRESENCE_SHARE) {
    out.push({ id: 'presence-heavy', criterion_ids: presence, message: `${presence.length} of ${list.length} criteria only ask that the plan name, list or mention something (${presence.join(', ')}); a plan can satisfy them and still be wrong.` });
  }
  ids.forEach((id, i) => {
    if (isVague(list[i])) out.push({ id: 'vague-word', criterion_ids: [id], message: `${id} uses a vague word with no number or named check beside it: "${list[i].slice(0, 100)}${list[i].length > 100 ? '...' : ''}"` });
  });
  return out;
}
