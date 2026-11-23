// Signed text vs delivered text (0.8.2 item 4; plan item 4 = A3 + F1/F7 of the ChatGPT reviews, owner 6 Oct 2026 ~18:55: LABEL only, the panel is NOT re-run on a changed text).
// The panel signs (or fails to sign) ONE draft. Several stages run after it and may change what is delivered: the dispute pass, the post-signoff challenge's revise, the final edit
// (model edits, nobody re-reviews them), and the harness's own notes (the dissent block, the cold-read block: written by the harness, never by a model). The handoff is written from the
// delivered text. This module only records WHAT happened, as hashes and names, so a reader can tell; it changes no verdict (`passed` is untouched everywhere) and calls no model.
// Pure and $0. The fields are additive in report.json: signed_text, delivered_text, handoff_text.
import { createHash } from 'node:crypto';

export const textSha256 = s => createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex');

/**
 * { signed_text, delivered_text, handoff_text? } for a finished run.
 *   reviewedDraft  the draft the panel last reviewed (the text it signed, or failed to)       signed   did the panel sign it (`passed` at that point)
 *   round          the last panel round (null when none ran)                                   openObjections  how many objections were still open when the panel stopped
 *   bodyChanges    the model-written stages that changed the body after the review, in order: 'dispute', 'challenge', 'final_edit'
 *   harnessNotes   the harness-written blocks put above the body: 'dissent_block', 'cold_read_block', 'escalated_signoff_block' (stall escalation), 'final_read_block' (unit D)
 *   body           the model-written text as delivered (before any harness block)             deliverable  the text as written to deliverable.md
 *   handoffMadeFrom the text the handoff stage was given (the deliverable at that point), or null when the chain has no handoff
 *   handoffOpenObjections  the rows the handoff prompt listed as open ([] unless the run ended agreed on the handler's check with objections open)
 */
export function buildTextLabels({ reviewedDraft, signed, round, openObjections, bodyChanges = [], harnessNotes = [], body, deliverable, handoffMadeFrom = null, handoffOpenObjections = [] }) {
  const signedSha = textSha256(reviewedDraft);
  const bodySha = textSha256(body);
  const same = bodyChanges.length === 0 && bodySha === signedSha;
  return {
    signed_text: {
      sha256: signedSha,
      round: Number.isInteger(round) ? round : null,
      signed_off: signed === true,
      // "not accepted, N open objections" (ticket 2): a stalled or round-capped run says so; N is 0 for a signed run.
      ...(signed === true ? {} : { label: 'not_accepted', open_objections: Math.max(0, Number(openObjections) || 0) }),
    },
    delivered_text: {
      sha256: textSha256(deliverable),
      body_sha256: bodySha,
      same_as_signed: same,
      changed_by: [...bodyChanges],
      harness_notes: [...harnessNotes],
      // a model edit after the last review that no panel re-read (always true when changed_by is not empty: the panel is not re-run)
      re_reviewed: false,
    },
    ...(handoffMadeFrom === null ? {} : {
      handoff_text: { made_from_sha256: textSha256(handoffMadeFrom), made_from_signed: signed === true && same && textSha256(handoffMadeFrom) === signedSha, panel_reviewed: false,
        // 0.8.4 round 1, 9a: the objections the handoff prompt listed (a run that ended agreed on the handler's check with some open); `council handoff --from-run` reads them back
        ...(Array.isArray(handoffOpenObjections) && handoffOpenObjections.length ? { open_objections: handoffOpenObjections.map(o => ({ id: o.id, layer: o.layer ?? null, severity: o.severity ?? null, problem: o.problem })) } : {}) },
    }),
  };
}

const NOTE_WORDS = { dissent_block: 'the unresolved-dissent block', cold_read_block: 'the cold-reader block', escalated_signoff_block: 'the escalated sign-off block', final_read_block: 'the final-read block', dissent_record_block: 'the dissents-on-the-record block' };   // escalated_signoff_block and final_read_block: stall escalation / unit D, A-DRAFT; dissent_record_block: M1 COMPLETE U1-3, A-DRAFT

/**
 * The BOARD.md section (A3/F1): '' when the panel signed and the delivered text is the signed text with no harness note; otherwise what is true, in plain words. Only a board that
 * exists gets it (the caller does not create a BOARD.md for it).
 */
export function renderTextLabelsBoard({ signedText, deliveredText, outcome, ending = null, ladderBlock = false, requestedBlock = false, sentToJudge = false }) {   // `ending` (the report's record) and `ladderBlock` (escalated_signoff.ladder): the two cases of 0.8.4 round 1 (A1-3, A1-5) tell themselves apart by them
  if (!signedText || !deliveredText) return '';
  const changed = changedAfterReviewSentence({ delivered_text: deliveredText });
  const notes = deliveredText.harness_notes?.length ? `The harness wrote ${list(deliveredText.harness_notes.map(n => (n === 'escalated_signoff_block' && ladderBlock ? 'the ladder sign-off block' : n === 'escalated_signoff_block' && requestedBlock ? 'the top-layer sign-off block' : NOTE_WORDS[n] || n)))} above the plan; it is not model text and no panel read it. ` : '';   // A-DRAFT (0.8.4 round 1, A1-5: the ladder sign-off block's name)
  const degraded = signedText.signed_off && outcome === 'degraded';
  if (signedText.signed_off && !degraded && !changed && !notes) return '';
  // A-DRAFT (pr2 fix, board sentence): "and was never put to the panel" is left out when a judge read the draft and its answer was cut off by the person's finish (sentToJudge).
  const head = degraded
    ? `**Not a clean sign-off:** the run finished degraded (a seat was not heard), so "signed" below means only that the labs that were heard signed; the draft they last reviewed has sha256 \`${signedText.sha256.slice(0, 12)}\` (round ${signedText.round ?? '?'}).`
    : signedText.signed_off
    ? `The panel signed the draft with sha256 \`${signedText.sha256.slice(0, 12)}\` (round ${signedText.round ?? '?'}).`
    : ending?.kind === 'agreed' && Array.isArray(ending.basis) && ending.basis.includes('handler_check')
    ? (signedText.round === null ? `**Agreed on the handler's build check:** the whole panel did not sign off (${signedText.open_objections ?? 0} open objection${signedText.open_objections === 1 ? '' : 's'} at the end); the run's last draft has sha256 \`${signedText.sha256.slice(0, 12)}\`${sentToJudge ? '.' : ' and was never put to the panel.'}` : `**Agreed on the handler's build check:** the whole panel did not sign off (${signedText.open_objections ?? 0} open objection${signedText.open_objections === 1 ? '' : 's'} at the end, round ${signedText.round ?? '?'}); its last draft has sha256 \`${signedText.sha256.slice(0, 12)}\`.`)   // A-DRAFT (0.8.4 round 1, A1-3)
    : (signedText.round === null ? `**Not accepted:** the panel did not sign off (${signedText.open_objections ?? 0} open objection${signedText.open_objections === 1 ? '' : 's'} when it stopped); the run's last draft has sha256 \`${signedText.sha256.slice(0, 12)}\`${sentToJudge ? '.' : ' and was never put to the panel.'}` : `**Not accepted:** the panel did not sign off (${signedText.open_objections ?? 0} open objection${signedText.open_objections === 1 ? '' : 's'} when it stopped, round ${signedText.round ?? '?'}); its last draft has sha256 \`${signedText.sha256.slice(0, 12)}\`.`);
  return `## Signed text and delivered text\n\n${head} ${changed || (deliveredText.same_as_signed ? 'The delivered plan is that text.' : '')} ${notes}Delivered file sha256 \`${deliveredText.sha256.slice(0, 12)}\`. (report.json: signed_text, delivered_text.)\n\n`.replace(/ +\n/g, '\n').replace(/  +/g, ' ');
}

const STAGE_WORDS = { dispute: 'the dispute pass', challenge: 'the post-signoff challenge', final_edit: 'the final edit' };
const list = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "the final edit and the post-signoff challenge": the stages that changed the body, in plain words ('' when the record names none). */
export function changedByWords(d) {
  return Array.isArray(d?.changed_by) ? list(d.changed_by.map(c => STAGE_WORDS[c] || c)) : '';
}

/** The clause of the run status line for a passed run whose delivered text is not the text the panel signed (0.8.2 item 4; run-status.js finishedRunState, and the ending line of the summary block, src/summary-add.js): "on the signed draft; the delivered text differs (changed by the final edit)". Null when the record does not say the text differs. One copy. */
export function deliveredDiffersClause(d) {
  if (!d || d.same_as_signed !== false) return null;
  const by = changedByWords(d);
  return `on the signed draft; the delivered text differs${by ? ` (changed by ${by})` : ''}`;
}

/** One short sentence for BOARD.md / HANDOFF.md / run_status: what changed after the panel's last review. '' when nothing did. */
export function changedAfterReviewSentence(labels) {
  const d = labels?.delivered_text;
  if (!d || d.same_as_signed !== false) return '';
  // A hand-edited or damaged report can carry same_as_signed:false with no changed_by list: say that much, never throw (this runs inside `council handoff --from-run`).
  if (!Array.isArray(d.changed_by) || !d.changed_by.length) return `The delivered plan differs from the text the panel last reviewed, and no panel re-read it.`;
  return `After the panel's last review ${list(d.changed_by.map(c => STAGE_WORDS[c] || c))} changed the plan, and no panel re-read it.`;
}
