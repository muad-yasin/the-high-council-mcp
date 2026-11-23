// 0.8.4 T2.1 / D1 (plan A, C&C's words of 09 Nov 2026 on UNIT3_STEP0_FACTS): THE ending matrix. One row per way a run ends; the report's `ending_word`, the dispute record's `reason` (a derived copy), the banner's reason
// sentence and the Status values a handoff may carry are read from it. PURE: plain data in, plain data out; no model, no file, no clock.
//
// How it relates to the other two sources (nothing here replaces either):
//   `ending` (src/ending.js, S4)  an OBJECT about how an AGREEMENT ended; recorded only on a layered run that reached layer 3's sign-off and, while the build-check words are held, on no run at all. `isAgreed` / `endsNotAgreed`
//                                 treat it as authoritative. This module never writes it and never reads it to find the word, except for one refinement: a `signed_off` run whose `ending` says not agreed reads
//                                 `signed_off_at_top_not_agreed` (S4 stays the single source for that case).
//   `final_read.run_end` (S18)    'agreed' iff the run passed or the handler said good to build; 'not_agreed' otherwise.
// `ending_word` is ONE word for EVERY run that ends (not for a run that waits at a stop: that has no report.json). Where `ending` and `run_end` exist they AGREE with it on the one question they all answer, agreed or not:
// `agreedOf(report)` below is that reading, and test/ending-matrix.test.js pins that it equals `isAgreed` for every row. They do not share a vocabulary: `ending.kind` is agreed | signed_off_at_top_not_agreed.
//
// The words are the ones `panelEnding` (src/overseer-rounds.js) already returns, with `not_signed_off` split into `stalled` and `round_cap`, plus S4's `signed_off_at_top_not_agreed`. The dispute record's `reason` keeps its
// legacy spelling (`panel_signed_off`, `layer_not_signed_off`, `no_heard_reviewer`: a public enum in schemas/report-v1.json): each row says which. `panelEnding` itself is untouched (it feeds the public `answer.ending`), and a
// test pins that it equals the matrix's `panel_word` for every single flag.
//
// PRECEDENCE: the flags a run sets (noHeardReviewer, notQuorate, finishedStop, layerStop, earlyFinish, escalatedEnd, stalled) are each set immediately before the pass loop's `break` (src/chain.js), so one run sets one.
// For the order in which `endingWordOf` reads them, the dispute record's own order is followed (it is the public record that has to stay byte-identical).
import { isAgreed } from './ending.js';
import { STATUS_VALUES } from './milestones.js';

const NOTHING_OPEN_REASON = 'stopped before the top layer signed off, with no objection open';   // A-DRAFT (0.8.4 round 1, A7-4): the reason of a run finished AT ONCE at a stop with no objection open; read by the banner (src/handoff-from-run.js) and by the handoff prompt (src/handoff-prompt.js through src/chain.js), so it is wording a model reads too
const NOT_AGREED_NOTHING_OPEN_REASON = 'finished without agreement, with no objection open';   // M-reason (ROUND2; the handoff prompt reads it too): a run that did not end agreed with nothing standing at the end
const NOT_AGREED_REASON = 'finished with open objections';   // today's banner sentence for every run without a pass and without degradation (src/handoff-from-run.js), reproduced here until the per-row sentences are approved (T2 step 3)
const AGREED_REASON = 'signed off';
const STATUS_ALL = STATUS_VALUES;   // src/milestones.js: the one list of Status values
const STATUS_NOT_AGREED = Object.freeze(STATUS_VALUES.filter(v => v !== 'ready_for_build' && v !== 'partial'));                         // T2.5 (D29): after an ending without agreement, `ready_for_build` and `partial` wait for an acceptance

// agrees: 'never' (no way for this ending to be an agreed one: the agreed reading returns false whatever `ending` says) | 'by_ending' (S4's ending and the final read decide, `isAgreed`).
// acceptance: 'when_not_agreed' (an acceptance record, T2.3, is needed before building when the run is not agreed) | 'no'.
const row = (o) => Object.freeze({ reaches_build: true, ...o, banner_reason_agreed: o.agrees === 'never' ? null : AGREED_REASON, banner_reason_not_agreed: NOT_AGREED_REASON, status_when_agreed: STATUS_ALL, status_when_not_agreed: STATUS_NOT_AGREED });

export const ENDING_MATRIX = Object.freeze({
  signed_off:                   row({ panel_word: 'signed_off', dispute_reason: 'panel_signed_off', dispute_reason_idle: 'panel_signed_off', agrees: 'by_ending', acceptance: 'when_not_agreed' }),
  signed_off_at_top_not_agreed: row({ panel_word: 'signed_off', dispute_reason: 'panel_signed_off', dispute_reason_idle: 'panel_signed_off', agrees: 'never', acceptance: 'when_not_agreed' }),
  escalated_signoff:            row({ panel_word: 'escalated_signoff', dispute_reason: 'escalated_signoff', dispute_reason_idle: 'escalated_signoff', agrees: 'by_ending', acceptance: 'when_not_agreed' }),
  early_finish:                 row({ panel_word: 'early_finish', dispute_reason: 'early_finish', dispute_reason_idle: 'early_finish', agrees: 'never', acceptance: 'when_not_agreed' }),
  rule_no_handler:              row({ panel_word: 'rule_no_handler', dispute_reason: 'rule_no_handler', dispute_reason_idle: 'rule_no_handler', agrees: 'never', acceptance: 'when_not_agreed' }),
  finish_chosen:                row({ panel_word: 'finish_chosen', dispute_reason: 'finish_chosen', dispute_reason_idle: 'finish_chosen', agrees: 'by_ending', acceptance: 'when_not_agreed' }),   // by_ending: a secret or budget finish after a good_to_build can carry an agreed ending (src/chain.js, the `check:` expression of the ending)
  layer_stop:                   row({ panel_word: 'layer_stop', dispute_reason: 'layer_not_signed_off', dispute_reason_idle: 'layer_not_signed_off', agrees: 'never', acceptance: 'when_not_agreed' }),
  no_reviewer_heard:            row({ panel_word: 'no_reviewer_heard', dispute_reason: 'no_heard_reviewer', dispute_reason_idle: 'no_heard_reviewer', agrees: 'never', acceptance: 'when_not_agreed' }),
  not_quorate:                  row({ panel_word: 'not_quorate', dispute_reason: 'not_quorate', dispute_reason_idle: 'not_quorate', agrees: 'never', acceptance: 'when_not_agreed' }),
  stalled:                      row({ panel_word: 'not_signed_off', dispute_reason: 'stalled', dispute_reason_idle: 'no_open_objections', agrees: 'never', acceptance: 'when_not_agreed' }),   // idle: the dispute record of a stalled end with no open objection says no_open_objections today
  round_cap:                    row({ panel_word: 'not_signed_off', dispute_reason: 'round_cap', dispute_reason_idle: 'no_open_objections', agrees: 'never', acceptance: 'when_not_agreed' }),
});
/** The run waiting at a stop is not an ending (T2.1 (g)): no report.json, no word. It has a row so that the matrix covers the state and no reader takes it for an ending. */
export const WAITING_ROW = Object.freeze({ reaches_build: false, panel_word: null, dispute_reason: null, dispute_reason_idle: null, agrees: 'never', acceptance: 'no', banner_reason_agreed: null, banner_reason_not_agreed: null, status_when_agreed: Object.freeze([]), status_when_not_agreed: Object.freeze([]) });

export const ENDING_WORDS = Object.freeze(Object.keys(ENDING_MATRIX));

/**
 * The word of a run, from the flags the chain holds (see PRECEDENCE above). `ending`: the S4 record, when there is one; it refines only a `signed_off` run (layer 3 signed and the run is NOT agreed: the handler said not_yet,
 * the text changed after the sign-off, or the final read objected). Every other row takes its word from the flags and S4 supplies only the agreed reading.
 */
export function endingWordOf({ passed = false, noHeardReviewer = null, notQuorate = null, finishedStop = null, layerStop = null, earlyFinish = null, escalatedEnd = null, stalled = null, ending = null } = {}) {
  if (passed === true) return ending?.kind === 'signed_off_at_top_not_agreed' ? 'signed_off_at_top_not_agreed' : 'signed_off';
  if (noHeardReviewer) return 'no_reviewer_heard';
  if (notQuorate) return 'not_quorate';
  if (finishedStop) return finishedStop.chosen === 'rule' ? 'rule_no_handler' : 'finish_chosen';
  if (layerStop) return 'layer_stop';
  if (earlyFinish) return 'early_finish';
  if (escalatedEnd) return 'escalated_signoff';
  if (stalled) return 'stalled';
  return 'round_cap';
}

/** The dispute record's `reason` for a word (the legacy spelling). `ran`: whether the dispute stage ran (true) or was recorded idle (false). Unknown word -> null. */
export function disputeReasonOf(word, ran) {
  const r = ENDING_MATRIX[word];
  return r ? (ran ? r.dispute_reason : r.dispute_reason_idle) : null;
}

/** `stop_kind` for a stop: its kind, with `/why` when the stop has one (layer_bound/revisions, stall_stop/top_layer ...); null when there is no stop. The hard stop is not a kind: `isHardStop(report.stop)`. */
export function stopKindOf(stop) {
  if (!stop || typeof stop !== 'object' || typeof stop.kind !== 'string' || !stop.kind) return null;
  return typeof stop.why === 'string' && stop.why ? `${stop.kind}/${stop.why}` : stop.kind;
}

/** The matrix row of a report (by its `ending_word`; a result holds it camelCase, `endingWord`), or null for a report without one (every report written before 0.8.4's matrix). */
export const rowOfReport = report => { const w = report?.ending_word ?? report?.endingWord; return typeof w === 'string' && Object.hasOwn(ENDING_MATRIX, w) ? ENDING_MATRIX[w] : null; };

/**
 * Did the run end AGREED? The matrix's agreed reading, for the readers that used to read `report.passed` alone: a `never` row is not agreed whatever else the report says; every other row, and a report with no
 * `ending_word`, is what `isAgreed` says (a recorded `ending` first, then the final read, then `passed`).
 */
export function agreedOf(report) {
  if (!report) return false;
  const r = rowOfReport(report);
  if (r && r.agrees === 'never') return false;
  return isAgreed(report);
}

/** The banner's reason sentence for a word and an agreement reading (today's sentences; the per-row sentences of plan A's T2 wording replace them in this one place). `word` may be null or unknown: the default row. */
/**
 * The ONE counts fact of "no objection stands" (0.8.4 round 1, A7 and R3): the recorded count is 0 (signed_text.open_objections) AND the dispute record lists none that stands (an entry the closing read closed, `closed_by`, does not stand;
 * a dispute record with no list, or none at all, adds nothing: the recorded count decides). A report whose count is not a number claims nothing. `x` is a report.json or a result. Late findings are asked separately (standingLateOf).
 */
export const noObjectionStandsByCount = x => {
  if ((x?.signed_text ?? x?.signedText)?.open_objections !== 0) return false;
  const list = x.dispute?.open_objections;
  return !(Array.isArray(list) && list.some(o => o && !o.closed_by));
};
/** A run finished AT ONCE at a stop (stop.finished_at_once) with no objection open at the end (noObjectionStandsByCount): the one case of 0.8.4 round 1's A7. `x` is a report.json or a result; one field decides it at every reader. */
export const finishedAtOnceNothingOpen = x => x?.stop?.finished_at_once === true && !['secret_pause', 'budget_stop', 'owner_pause'].includes(x.stop.kind) && noObjectionStandsByCount(x);   // the stops that have their own finish words (a credential pause, the spending limit, the owner's pause) are not this case, as in finishedAtStopWords (src/verdict-headline.js)

/** The ids of an objection or a late finding (O- or L-, an optional #N or #rN suffix): the one pattern of every reader that lists what stands open at the end. */
export const OBJECTION_ID = /^[OL]-\w+(?:#r?\d+)?$/;
/** 0.8.4 round 1, the A7 fix (R2): the late findings that STAND at the end, from a report's `late_findings` or a result's `lateFindings`: a row marked `dropped_after_check` is no longer carried, an entry with no readable id cannot be named. The acceptance reader (src/acceptance.js) lists exactly these. */
export const standingLateOf = rows => (Array.isArray(rows) ? rows : []).filter(l => l && l.dropped_after_check !== true && typeof l.id === 'string' && OBJECTION_ID.test(l.id));
/**
 * 0.8.4 apply, the M group (C&C's one fact of "nothing stands at the end"): the recorded count is exactly 0 and no dispute entry stands (noObjectionStandsByCount; an absent or non-number count fails closed) AND no late finding stands (standingLateOf).
 * The caller adds the ending: every site that says "open objections" or "open failures" for a run that did not end agreed asks this, and nobody re-derives it. `x` is a report.json or a result.
 */
export const nothingStandsAtEnd = x => noObjectionStandsByCount(x) && standingLateOf(x?.late_findings ?? x?.lateFindings).length === 0;
/**
 * 0.8.4 round 1, R1 (held fix): the printed shape of legs A and B: the record's ending says the top layer SIGNED OFF and the run did not end agreed (`ending.kind` signed_off_at_top_not_agreed: the handler said not yet), AND the person finished the run at once at a stop
 * (stop.finished_at_once; not at a stop that has its own finish words, as finishedAtOnceNothingOpen). The same ending kind also stands on a run that PASSED and was then not agreed (a final read that objected, a text changed after the sign-off): that run is not this shape and keeps its texts.
 * The ending's kind does NOT say every layer signed: on a plan file the top layer can sign in a pass that never asked a lower layer. `x` is a report.json or a result.
 */
export const topSignedNotAgreed = x => (x?.ending && typeof x.ending === 'object' ? x.ending : null)?.kind === 'signed_off_at_top_not_agreed' && x?.stop?.finished_at_once === true && !['secret_pause', 'budget_stop', 'owner_pause'].includes(x.stop.kind);
/**
 * 0.8.4 round 1, R3 (held fix): a run finished EARLY (stop.kind early_finish, the session's proposal and the overseer layer's yes) with NOTHING standing in the record: BOTH counts are 0 (signed_text.open_objections, and the dispute record lists none that stands: an entry the
 * closing read closed, `closed_by`, does not stand; a dispute record with no list, or none at all, adds nothing: the recorded count decides) AND no late finding stands (standingLateOf, the acceptance reader's filter). A report whose count is not a number claims nothing.
 * This is the one fact of "nothing stands" for the early finish; where a late finding stands the texts stay as they were. `x` is a report.json or a result.
 */
export const finishedEarlyNothingOpen = x => {
  if (x?.stop?.kind !== 'early_finish' || x.passed === true) return false;
  if (!noObjectionStandsByCount(x)) return false;
  return standingLateOf(x.late_findings ?? x.lateFindings).length === 0;
};
/**
 * The facts a finish-at-once or finish-early reason needs besides the count (R1, R2, R3): `early` (the early finish: nothing stands, no late finding either), whether the top layer SIGNED OFF (the record's ending, topSignedNotAgreed), whether the handler's check said not yet,
 * and the late findings that stand (sorted ids; always empty for an early finish). null for any other ending. `x` is a report.json or a result.
 */
export function finishedAtOnceCase(x) {
  const early = finishedEarlyNothingOpen(x);
  if (!early && !finishedAtOnceNothingOpen(x)) return null;
  const e = x.ending && typeof x.ending === 'object' ? x.ending : null;
  return { early, topSigned: !early && topSignedNotAgreed(x), handlerNotYet: !early && e?.handler_check === 'not_yet', late: early ? [] : standingLateOf(x.late_findings ?? x.lateFindings).map(l => l.id).sort() };
}
// 0.8.4 round 1, the A7 fix (A-DRAFT; one whole sentence for each case, the words are round 2's): the reason of a run finished at once at a stop, or early at the session's proposal, with no objection open by count.
const atOnceReasonOf = c => {
  const ids = c.late.join(', ');
  if (c.early) return 'finished early at the session\'s proposal and the overseer layer\'s yes, with no objection open';   // R3 (A-DRAFT): only where nothing stands, late findings included
  if (c.topSigned && c.late.length) return `stopped after the top layer signed off${c.handlerNotYet ? ' and the handler said not yet' : ''}, with no objection open but ${c.late.length === 1 ? 'a late finding' : 'late findings'} still standing: ${ids}`;
  if (c.topSigned) return `stopped after the top layer signed off${c.handlerNotYet ? ' and the handler said not yet' : ''}, with no objection open`;
  if (c.late.length) return `stopped before the top layer signed off, with no objection open but ${c.late.length === 1 ? 'a late finding' : 'late findings'} still standing: ${ids}`;
  return NOTHING_OPEN_REASON;
};

export function bannerReasonOf(word, agreed, { nothingOpenAtOnce = false, atOnce = null, nothingStands = false } = {}) {
  const r = ENDING_MATRIX[word];
  if (word === 'finish_chosen' && (nothingOpenAtOnce === true || atOnce) && agreed !== true) return atOnce ? atOnceReasonOf(atOnce) : NOTHING_OPEN_REASON;   // A7-4: every other ending keeps the shared reason
  if (word === 'early_finish' && atOnce?.early === true && agreed !== true) return atOnceReasonOf(atOnce);   // R3: an early finish with nothing standing in the record
  if (nothingStands === true && agreed !== true) return NOT_AGREED_NOTHING_OPEN_REASON;   // M-reason: any other ending that did not end agreed, with nothing standing at the end
  if (r && r.agrees === 'never') return r.banner_reason_not_agreed;   // a row that can never be agreed ignores the caller's reading
  if (agreed === true) return r?.banner_reason_agreed ?? AGREED_REASON;
  return r?.banner_reason_not_agreed ?? NOT_AGREED_REASON;
}

/** The Status values a handoff may carry (T2.5, D29): all five when the run is agreed or an acceptance exists, else the three that leave out `ready_for_build` and `partial`. */
export function statusAllowedOf(word, { agreed, accepted = false } = {}) {
  const r = ENDING_MATRIX[word] ?? null;
  const open = agreed === true || accepted === true;
  if (!r) return open ? STATUS_ALL : STATUS_NOT_AGREED;   // a run with no word (a stopped or crashed run, a report from before the matrix) decides on the agreed and accepted readings alone: fail closed
  return open ? r.status_when_agreed : r.status_when_not_agreed;
}
