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
 *   harnessNotes   the harness-written blocks put above the body: 'dissent_block', 'cold_read_block'
 *   body           the model-written text as delivered (before any harness block)             deliverable  the text as written to deliverable.md
 *   handoffMadeFrom the text the handoff stage was given (the deliverable at that point), or null when the chain has no handoff
 */
export function buildTextLabels({ reviewedDraft, signed, round, openObjections, bodyChanges = [], harnessNotes = [], body, deliverable, handoffMadeFrom = null }) {
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
      handoff_text: { made_from_sha256: textSha256(handoffMadeFrom), made_from_signed: same && textSha256(handoffMadeFrom) === signedSha, panel_reviewed: false },
    }),
  };
}

const NOTE_WORDS = { dissent_block: 'the unresolved-dissent block', cold_read_block: 'the cold-reader block' };

/**
 * The BOARD.md section (A3/F1): '' when the panel signed and the delivered text is the signed text with no harness note; otherwise what is true, in plain words. Only a board that
 * exists gets it (the caller does not create a BOARD.md for it).
 */
export function renderTextLabelsBoard({ signedText, deliveredText, outcome }) {
  if (!signedText || !deliveredText) return '';
  const changed = changedAfterReviewSentence({ delivered_text: deliveredText });
  const notes = deliveredText.harness_notes?.length ? `The harness wrote ${list(deliveredText.harness_notes.map(n => NOTE_WORDS[n] || n))} above the plan; it is not model text and no panel read it. ` : '';
  const degraded = signedText.signed_off && outcome === 'degraded';
  if (signedText.signed_off && !degraded && !changed && !notes) return '';
  const head = degraded
    ? `**Not a clean sign-off:** the run finished degraded (a seat was not heard), so "signed" below means only that the labs that were heard signed; the draft they last reviewed has sha256 \`${signedText.sha256.slice(0, 12)}\` (round ${signedText.round ?? '?'}).`
    : signedText.signed_off
    ? `The panel signed the draft with sha256 \`${signedText.sha256.slice(0, 12)}\` (round ${signedText.round ?? '?'}).`
    : `**Not accepted:** the panel did not sign off (${signedText.open_objections ?? 0} open objection${signedText.open_objections === 1 ? '' : 's'} when it stopped, round ${signedText.round ?? '?'}); its last draft has sha256 \`${signedText.sha256.slice(0, 12)}\`.`;
  return `## Signed text and delivered text\n\n${head} ${changed || (deliveredText.same_as_signed ? 'The delivered plan is that text.' : '')} ${notes}Delivered file sha256 \`${deliveredText.sha256.slice(0, 12)}\`. (report.json: signed_text, delivered_text.)\n\n`.replace(/ +\n/g, '\n').replace(/  +/g, ' ');
}

const STAGE_WORDS = { dispute: 'the dispute pass', challenge: 'the post-signoff challenge', final_edit: 'the final edit' };
const list = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "the final edit and the post-signoff challenge": the stages that changed the body, in plain words ('' when the record names none). */
export function changedByWords(d) {
  return Array.isArray(d?.changed_by) ? list(d.changed_by.map(c => STAGE_WORDS[c] || c)) : '';
}

/** One short sentence for BOARD.md / HANDOFF.md / run_status: what changed after the panel's last review. '' when nothing did. */
export function changedAfterReviewSentence(labels) {
  const d = labels?.delivered_text;
  if (!d || d.same_as_signed !== false) return '';
  // A hand-edited or damaged report can carry same_as_signed:false with no changed_by list: say that much, never throw (this runs inside `council handoff --from-run`).
  if (!Array.isArray(d.changed_by) || !d.changed_by.length) return `The delivered plan differs from the text the panel last reviewed, and no panel re-read it.`;
  return `After the panel's last review ${list(d.changed_by.map(c => STAGE_WORDS[c] || c))} changed the plan, and no panel re-read it.`;
}
