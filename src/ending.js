// 0.8.4 S4 (M1; CA4, D15, D38, G11, C&C's S4 answers of 4 Nov 2026): how an agreement on a LAYERED run ended, and the ONE rule every reader of "did the run end agreed" shares.
// PURE: plain data in, plain data out; no model, no file, no clock.
//
// `ending` is a record of report.json (additive, experimental): { kind, basis[], handler_check, signed_sha, refused_answers? }.
//   kind: 'agreed'                       layer 3 signed off, no final read objects (where the chain has one), and (a) there is a handling session and it answered good_to_build to the build check (CA4), or (b) there is NO handling session (Muad's pick, 4 Nov 2026
//                                        22:08, copy correction 11: the run ends agreed as before 0.8.4 and the record says no build check happened: basis no_handling_session, handler_check none; only for a sign-off that every layer gave); in both, on the very text layer 3 signed
//                                        (with no session also on a changed text that the final read cleared)
//         'signed_off_at_top_not_agreed' layer 3 signed off but the run is NOT agreed: the handler said not_yet and the run ended there, or the text that is delivered is not the text layer 3 signed, or a final read objected after the sign-off
//                                        (never claimed as agreement). A ladder or an escalated sign-off with NO handling session has no ending at all: it was never agreement of the whole panel (`passed` false) and its readers keep that rule.
//   handler_check: 'good_to_build' | 'not_yet' | 'none' (no handling session: no check is asked)
//   basis[]: what the ending rests on: 'layer_3_sign_off', 'handler_check', and the marks 'no_handling_session', 'handler_not_yet', 'text_changed_after_sign_off', 'final_read_objection'
//   signed_sha: the 12-hex id (src/verdict-envelope.js draftIdOf) of the text layer 3 signed; a good_to_build binds to it (C&C's PERMANENT invariant: a different final text never reads agreed)
// `passed` is never set by the ending (G11: it keeps its meaning, "the panel signed off on the final draft under the chain's sign-off rule"). The kinds 'stopped' and 'waiting' are NOT report.json values: a stop
// is a report-partial.json (the run has no report.json), and waiting at the build check is the NEEDS file plus run_status.
// An ending is recorded only on a layered run that reached layer 3's sign-off. A run that ended any other way (round cap, stall, finish, a stop) has none: its readers fall back to `passed` as before.
import { finalReadBlocksAgreement, finalReadClears } from './final-read.js';

export const ENDING_KINDS = Object.freeze(['agreed', 'signed_off_at_top_not_agreed']);
export const HANDLER_CHECKS = Object.freeze(['good_to_build', 'not_yet', 'none']);

/** Is there a session that can check the build? It decides only whether the build check is ASKED (copy correction 11), never whether the run can end agreed. The reviser seat (the builder when there is no reviser) is the handler's own session: provider "external". The same rule `council retag-add` uses. */
export const hasHandlingSession = config => {
  const seat = config?.seats?.reviser || config?.seats?.builder;
  return seat?.provider === 'external';
};

/**
 * The ending of a run that reached layer 3's sign-off. `agreement`: { sha } (what layer 3 signed). `check`: null when no check was asked, else { answer: 'good_to_build' | 'not_yet' }. `finalSha`: the id of the text the run delivers.
 * `handling`: whether a handling session exists. `finalRead`: the final-read record, when the chain has one. Returns the `ending` record, or null when there is none to record.
 */
/** `dissents` (M1 COMPLETE U1-2, held): how many dissents the report holds; with one or more the basis gains the mark `dissent_on_record` (RU-S4-31: an ending named agreed with the dissent on the record). Default 0: every existing caller and pin sees the basis it always had. */
export function endingOf(args) {
  const e = endingCore(args);
  return e && args.dissents > 0 ? { ...e, basis: [...e.basis, 'dissent_on_record'] } : e;
}
function endingCore({ agreement, check, handling, finalSha, finalRead }) {
  const base = { signed_sha: agreement.sha, pass: agreement.pass };
  if (handling) {
    if (!check) return null;   // a handling session and no check asked (the build-check wording is held): no ending, the readers fall back to `passed` as before
    if (check.answer !== 'good_to_build') return { kind: 'signed_off_at_top_not_agreed', basis: ['layer_3_sign_off', 'handler_not_yet'], handler_check: 'not_yet', ...base };
  }
  // No session and a sign-off that not every layer gave (a ladder or an escalated one): it was never agreement of the whole panel (`passed` false as before 0.8.4) and the handler's check is what made it one (CA4); with nobody to check it, no ending is recorded and the readers keep today's rule.
  if (!handling && agreement.kind !== 'full') return null;
  // From here the sign-off stands on its own (no session to ask) or on the handler's good_to_build. Both bind to the text layer 3 signed. With no session a changed text is also accepted when the final read ran on exactly that text and every layer-3 seat cleared it (layer 3 then read and signed that very text).
  const basis = handling ? ['layer_3_sign_off', 'handler_check'] : ['layer_3_sign_off', 'no_handling_session'];
  const handler_check = handling ? 'good_to_build' : 'none';
  const readAndCleared = !handling && finalReadClears(finalRead, finalSha);   // the final read ran on exactly the plan that is delivered and every layer-3 seat cleared it
  if (finalReadBlocksAgreement(finalRead)) return { kind: 'signed_off_at_top_not_agreed', basis: [...basis, 'final_read_objection'], handler_check, ...base };   // the more specific reason first: layer 3 read the final plan and objected, or did not read it
  if (finalSha !== agreement.sha && !readAndCleared) return { kind: 'signed_off_at_top_not_agreed', basis: [...basis, 'text_changed_after_sign_off'], handler_check, ...base };
  return { kind: 'agreed', basis, handler_check, ...base };
}

const finalReadOf = x => x?.finalRead ?? x?.final_read;

/** What a recorded `ending` says about agreement: true (agreed), false (not agreed), null (no ending: the reader keeps its own rule). */
export const endingAgrees = x => (x?.ending && typeof x.ending === 'object' ? x.ending.kind === 'agreed' : null);

/**
 * THE agreement predicate, shared by every reader (the exit code of a run, --rematch and --replay, the verdict line, the BOARD banner, run_status, the outcome, the exports). `x` is a result (camelCase `finalRead`) or a
 * report (`final_read`). With an `ending` it decides (agreed, and no final-read objection); without one (every run folder written before M1, and every run that ended any other way) it is what it was: `passed` plus the final read.
 */
export const isAgreed = x => {
  if (!x) return false;
  if (x.ending && typeof x.ending === 'object') return x.ending.kind === 'agreed' && !finalReadBlocksAgreement(finalReadOf(x));
  return x.passed === true && !finalReadBlocksAgreement(finalReadOf(x));
};

/** The negative reading the exit sites used (`passed === false || the final read blocks`): a result with no `passed` and no `ending` is not called "not agreed" by it. */
export const endsNotAgreed = x => {
  if (!x) return false;
  if (x.ending && typeof x.ending === 'object') return x.ending.kind !== 'agreed' || finalReadBlocksAgreement(finalReadOf(x));
  return x.passed === false || finalReadBlocksAgreement(finalReadOf(x));
};

/**
 * The ids the build check demands an answer for, and the test of an answer (CA4, W15/W33): the answer must NAME every id (an id is named when it appears in the answer's text, is not the front of a longer id (`O-aaaaaaaa` is not named by `O-aaaaaaaa#r2`) and is not the tail of a longer word). An answer that does not name them all counts as no answer. Returns { ok, missing }.
 */
export function namesEveryId(text, ids, aliases = null) {   // 0.8.4 S18 (T18t): `aliases`: Map(id -> [ids]) - an id is also named when any of its aliases is (a late finding made from an unanchored failure is the same ground: the pair is named once, by either id)
  const t = String(text ?? '');
  const named = id => new RegExp(`(?<![\\w#])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w#])`, 'i').test(t);
  const missing = ids.filter(id => !named(id) && !((aliases instanceof Map ? aliases.get(id) : null) || []).some(named));
  return { ok: missing.length === 0, missing };
}

/**
 * Reads the handler's answer to the build check: JSON { "answer": "good_to_build" | "not_yet", "reasons": "..." }, or plain text whose first word is the answer (the rest is the reasons). Anything else is no answer.
 * Returns { answer, reasons } or null.
 */
export function readBuildCheckAnswer(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  let parsed = null;
  if (t.startsWith('{')) { try { parsed = JSON.parse(t); } catch { return null; } }
  if (parsed && typeof parsed === 'object') {
    const answer = typeof parsed.answer === 'string' ? parsed.answer.trim().toLowerCase() : '';
    if (answer !== 'good_to_build' && answer !== 'not_yet') return null;
    return { answer, reasons: typeof parsed.reasons === 'string' ? parsed.reasons.trim() : '' };
  }
  const m = /^(good_to_build|not_yet)\b[\s:,.-]*([\s\S]*)$/i.exec(t);
  return m ? { answer: m[1].toLowerCase(), reasons: m[2].trim() } : null;
}
