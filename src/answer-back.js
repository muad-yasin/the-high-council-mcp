// What a judge is shown about its own earlier objections from round 2 on (0.8.2 item 3; owner decision 3, 5 Oct 2026, ticket 10): its own objections by id, what the writer
// said it declined, and the passages of the draft that changed. DATA ONLY here: the harness builds it and records a summary in report.json (`answer_back`); the sentences that
// tell a judge to mark each objection sustained (with evidence) or withdrawn (with a quote) are a prompt change and wait for the owner's list (src/roles.js is not touched).
// 0.8.2 (owner ruling of 6 Oct 2026, decision 3 "withdrawn (with a quote)"): applyAnswers below reads the `answers` array a judge returns once the prompt asks for it, and enforces the rule that
// a withdrawal with no quote found in the draft does not count: the objection stays open (it is carried into the judge's failures). It is built and tested without a live prompt (a crafted
// mock judge) and only runs on a chain with answer_back.enabled. It changes when a run passes, which is why it is behind the flag.
// What can be known: a DECLINED line may carry the id of the objection it answers (0.8.2, owner 7 Oct, P13: `DECLINED: O-1a2b3c4d: <reason>`, src/draft-disputes.js); such a reason is attached to that objection, and a line with no
// usable id is given as a reason for the round, matched to no objection. The changed passages are a paragraph diff of the draft
// before and after the revise, so they work in full-rewrite mode as well as patch mode.
import { evidenceSpans, normQuote } from './post-quotes.js';
import { objectionId } from './objection-ids.js';
// The harness's own escapes in a passage it showed a judge (a leading `#` becomes `\#`, a defused tag starts with `&lt;`: src/roles.js claimText and the held writerText) are undone, so a passage copied from what the judge was shown still matches the draft.
const norm = s => String(s ?? '').replace(/\\#/g, '#').replace(/&lt;/g, '<').replace(/[`*_\u2018\u2019]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const paragraphs = text => String(text ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

/** Paragraphs of `newDraft` that are not in `oldDraft` (compared after collapsing spaces and case), in order, at most `max` of at most `maxChars` characters each. */
export function changedPassages(oldDraft, newDraft, { max = 12, maxChars = 1200 } = {}) {
  const before = new Set(paragraphs(oldDraft).map(norm));
  const out = [];
  for (const p of paragraphs(newDraft)) {
    if (before.has(norm(p))) continue;
    out.push(p.length > maxChars ? `${p.slice(0, maxChars - 1)}…` : p);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The answer-back for each lab that had objections in the round just revised: { [lab]: { objections: [{ id, criterion, problem, quote? }], declined: [reason], changed_passages: [text] } }.
 * `failures` are the round's tagged failures (each with lab and id), `declined` the reviser's DECLINED reasons, the drafts the text before and after the revise.
 */
export function buildAnswerBack({ failures, declined, declinedIds = [], oldDraft, newDraft }) {
  const changed = changedPassages(oldDraft, newDraft);
  const out = {};
  // 0.8.2 (owner, 7 Oct 2026, P13): a DECLINED line that names an objection's id (declinedIds[i], in step with declined[i]) is that objection's reason (`declined_reason`) and is not repeated in the
  // round's list; a reason that names none of the round's objections (no id, or an id nobody raised) stays in `declined`, as before. A reason for another judge's objection is that judge's, not this one's.
  const all = new Set((failures || []).map(f => f?.id).filter(Boolean));
  const unmatched = (declined || []).filter((_, i) => !declinedIds[i] || !all.has(declinedIds[i]));
  for (const f of failures || []) {
    if (!f?.lab) continue;
    const mine = (declined || []).filter((_, i) => declinedIds[i] && declinedIds[i] === f.id);
    const entry = (out[f.lab] ||= { objections: [], declined: [...unmatched], changed_passages: changed });
    // The id is the same for the same lab, criterion and quoted text BY DESIGN (src/objection-ids.js): two problems a judge listed under one criterion with no quote share an id. They are one objection here, with
    // the problems joined: a judge answers by id, and one id must name exactly one entry (a reviewer's review of 913ce2e..c40a25d, finding 1).
    const dup = entry.objections.find(o => o.id === f.id);
    if (dup) { if (f.problem && !String(dup.problem).includes(f.problem)) dup.problem = `${dup.problem} / ${f.problem}`; continue; }
    entry.objections.push({ id: f.id, criterion: f.criterion, problem: f.problem, ...(f.quote ? { quote: f.quote } : {}), ...(mine.length ? { declined_reason: mine.join(' / ') } : {}) });
  }
  return out;
}

/** The part of it that goes into report.json: ids and counts, never the passages (they can be long). */
export const answerBackSummary = (round, byLab) => Object.entries(byLab).map(([lab, a]) => ({
  round, lab, objection_ids: a.objections.map(o => o.id), declined: a.declined.length, changed_passages: a.changed_passages.length,
}));

/**
 * Applies a judge's `answers` to its own earlier objections (`own`: [{ id, criterion, problem, quote? }]) for the round it is judging `shownDraft`.
 *   status "withdrawn" counts only if `evidence` holds a quoted span (any length, 8+ characters once normalised; quotes and apostrophes of either shape are one) found in the draft; otherwise the withdrawal is refused and the objection is carried;
 *   status "sustained" keeps the objection (carried when the judge did not list it again); a status that is neither word keeps it the same way (effect unreadable_answer: an unreadable answer is never a withdrawal);
 *   an answer naming an id the judge never raised is recorded and ignored;
 *   an own objection with no answer at all is recorded as unanswered and is NOT carried here: carrying it at once would let a judge that ignores the `answers` array stall the run
 *   round after round (test/verdict-words.test.js pins that). It is returned in `unanswered` instead, in the same shape as a carried failure, and the caller decides (Astra's 0.8.2 review,
 *   7 Oct 2026, F1: an unanswered objection under a clean sign-off used to vanish, while a withdrawal with no quote was kept; src/chain.js now re-asks that judge once and carries
 *   whatever is still unanswered, once the re-ask sentence is recorded).
 * Returns { carried: [failure...], unanswered: [failure...], records: [{ id, status, effect }] }; `carried` entries are failures the caller adds to the judge's own, `records` go to report.json (`answer_back_replies`).
 */
export function applyAnswers({ lab, critique, own, shownDraft, round }) {
  const answers = Array.isArray(critique?.answers) ? critique.answers.filter(a => a && typeof a === 'object' && !Array.isArray(a)) : [];
  const listed = new Set((critique?.failures || []).map(f => objectionId(lab, f)));
  const idKey = v => String(v ?? '').trim().toLowerCase(); // a padded or re-cased id is the same id (an exact match would turn a refused withdrawal into a dropped objection)
  const byId = new Map((own || []).map(o => [idKey(o.id), o]));
  const draftText = normQuote(shownDraft); // the quote check normalises quotes and apostrophes on both sides; the paragraph diff above keeps its own norm
  const records = []; const carried = [];
  const seen = new Set();
  const asFailure = o => ({ criterion: o.criterion, problem: o.problem, fix: '', ...(o.quote ? { quote: o.quote } : {}), id: o.id, carried_from_round: round - 1 });
  const carry = o => { if (!listed.has(o.id) && !carried.some(c => c.id === o.id)) carried.push(asFailure(o)); };
  for (const a of answers) {
    const id = typeof a.id === 'string' ? a.id : '';
    // The two words are the whole vocabulary; case, surrounding spaces and a closing full stop are not a different word ("Withdrawn." reads as withdrawn), anything else is.
    const status = typeof a.status === 'string' ? a.status.trim().toLowerCase().replace(/[.!]+$/, '') : ''; // only a string can be one of the two words (String(['withdrawn']) would read as one)
    const o = byId.get(idKey(id));
    if (!o) { records.push({ id, status, effect: 'unknown_id' }); continue; }
    seen.add(o.id);
    if (status === 'withdrawn') {
      const quoted = evidenceSpans(a.evidence).some(q => draftText.includes(normQuote(q)));
      if (quoted) records.push({ id, status, quoted: true, effect: 'withdrawn' });
      else { records.push({ id, status, quoted: false, effect: 'withdrawal_refused' }); carry(o); }
    } else if (status === 'sustained') { records.push({ id, status, effect: 'sustained' }); carry(o); }
    else { records.push({ id, status, effect: 'unreadable_answer' }); carry(o); } // 3b: a word that is neither (fixed, resolved, open, "") must not drop an objection the judge did not list again
  }
  const unanswered = [];
  for (const o of own || []) if (!seen.has(o.id)) {
    records.push({ id: o.id, status: null, effect: 'unanswered' });
    if (!listed.has(o.id)) unanswered.push(asFailure(o)); // listed again as a failure: the judge still holds it, nothing is missing
  }
  return { carried, unanswered, records };
}
