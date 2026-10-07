// 0.8.2 item 4 (plan item 4 = A3 + F1/F7; owner 6 Oct 2026 ~18:55: LABEL only, no re-run): the signed text vs the delivered text. Pure, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTextLabels, textSha256, changedAfterReviewSentence } from '../src/text-labels.js';

const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');

test('buildTextLabels: a plain signed run delivers the text it signed', () => {
  const l = buildTextLabels({ reviewedDraft: 'PLAN', signed: true, round: 2, openObjections: 0, body: 'PLAN', deliverable: 'PLAN' });
  assert.deepEqual(l.signed_text, { sha256: sha('PLAN'), round: 2, signed_off: true });
  assert.equal(l.delivered_text.same_as_signed, true);
  assert.deepEqual(l.delivered_text.changed_by, []);
  assert.equal(l.delivered_text.sha256, sha('PLAN'));
  assert.equal(l.handoff_text, undefined, 'no handoff stage, no handoff record');
  assert.equal(changedAfterReviewSentence(l), '');
});

test('buildTextLabels: a model edit after the review is named and not re-reviewed; a harness note alone is a note, not a change', () => {
  const edited = buildTextLabels({ reviewedDraft: 'PLAN', signed: true, round: 1, body: 'PLAN (edited)', deliverable: 'PLAN (edited)', bodyChanges: ['final_edit'] });
  assert.equal(edited.delivered_text.same_as_signed, false);
  assert.deepEqual(edited.delivered_text.changed_by, ['final_edit']);
  assert.equal(edited.delivered_text.re_reviewed, false);
  assert.equal(changedAfterReviewSentence(edited), "After the panel's last review the final edit changed the plan, and no panel re-read it.");
  const two = buildTextLabels({ reviewedDraft: 'P', signed: false, round: 3, openObjections: 2, body: 'Q', deliverable: 'Q', bodyChanges: ['dispute', 'challenge'] });
  assert.match(changedAfterReviewSentence(two), /the dispute pass and the post-signoff challenge changed the plan/);
  // a note above an unchanged body: the BODY is the signed text, the delivered file differs only by the harness's own note
  const noted = buildTextLabels({ reviewedDraft: 'PLAN', signed: true, round: 1, body: 'PLAN', deliverable: '## Cold-reader findings\n\n1. x\n\n---\nPLAN', harnessNotes: ['cold_read_block'] });
  assert.equal(noted.delivered_text.same_as_signed, true, 'the model-written body equals the signed text');
  assert.notEqual(noted.delivered_text.sha256, noted.delivered_text.body_sha256, 'the file hash covers the note, the body hash does not');
  assert.deepEqual(noted.delivered_text.harness_notes, ['cold_read_block']);
  assert.equal(changedAfterReviewSentence(noted), '');
});

test('buildTextLabels: an unsigned run reads "not accepted, N open objections"; the handoff record says what it was made from and that no panel read it', () => {
  const l = buildTextLabels({ reviewedDraft: 'P', signed: false, round: 7, openObjections: 3, body: 'P', deliverable: 'BLOCK\nP', harnessNotes: ['dissent_block'], handoffMadeFrom: 'BLOCK\nP' });
  assert.deepEqual(l.signed_text, { sha256: sha('P'), round: 7, signed_off: false, label: 'not_accepted', open_objections: 3 });
  assert.deepEqual(l.handoff_text, { made_from_sha256: sha('BLOCK\nP'), made_from_signed: false, panel_reviewed: false });
  const same = buildTextLabels({ reviewedDraft: 'P', signed: true, round: 1, body: 'P', deliverable: 'P', handoffMadeFrom: 'P' });
  assert.equal(same.handoff_text.made_from_signed, true);
  assert.equal(textSha256(undefined), sha(''));
});

import { renderTextLabelsBoard } from '../src/text-labels.js';
import { finishedState, partialBanner } from '../src/handoff-from-run.js';

test('renderTextLabelsBoard: silent for a clean signed run; plain words for a changed text, harness notes and an unsigned run', () => {
  const clean = buildTextLabels({ reviewedDraft: 'P', signed: true, round: 2, body: 'P', deliverable: 'P' });
  assert.equal(renderTextLabelsBoard({ signedText: clean.signed_text, deliveredText: clean.delivered_text }), '');
  const changed = buildTextLabels({ reviewedDraft: 'P', signed: true, round: 2, body: 'Q', deliverable: 'Q', bodyChanges: ['final_edit'] });
  assert.match(renderTextLabelsBoard({ signedText: changed.signed_text, deliveredText: changed.delivered_text }), /^## Signed text and delivered text\n\nThe panel signed the draft with sha256 `[0-9a-f]{12}` \(round 2\)\. After the panel's last review the final edit changed the plan, and no panel re-read it\./);
  const unsigned = buildTextLabels({ reviewedDraft: 'P', signed: false, round: 7, openObjections: 1, body: 'P', deliverable: 'X\nP', harnessNotes: ['dissent_block'] });
  const board = renderTextLabelsBoard({ signedText: unsigned.signed_text, deliveredText: unsigned.delivered_text });
  assert.match(board, /\*\*Not accepted:\*\* the panel did not sign off \(1 open objection when it stopped, round 7\)/);
  assert.match(board, /The harness wrote the unresolved-dissent block above the plan; it is not model text and no panel read it\./);
});

test('finishedState + partialBanner (F7): a degraded run that reads passed:true is NOT a clean sign-off and gets its own accurate banner; a signed run whose text changed gets the changed-text line; a clean run gets none', () => {
  assert.equal(partialBanner({ state: finishedState({ passed: true, outcome: 'consensus', delivered_text: { same_as_signed: true, changed_by: [] } }), draftName: 'deliverable.md', runId: 'r' }), '');
  const degraded = finishedState({ passed: true, outcome: 'degraded', delivered_text: { same_as_signed: true, changed_by: [] } });
  assert.equal(degraded.signedOff, false);
  assert.equal(degraded.degraded, true);
  const banner = partialBanner({ state: degraded, draftName: 'deliverable.md', runId: 'r' });
  assert.match(banner, /\*\*Not a clean sign-off\.\*\*/);
  assert.doesNotMatch(banner, /did not sign off on the plan below/, 'the old sentence would be false for a passed:true run');
  const changed = finishedState({ passed: true, outcome: 'consensus', delivered_text: { same_as_signed: false, changed_by: ['final_edit', 'dispute'] } });
  assert.equal(changed.signedOff, true);
  assert.match(partialBanner({ state: changed, draftName: 'x', runId: 'r' }), /\*\*Not the signed text\.\*\* After the panel's last review the final edit and the dispute pass changed the plan, and no panel re-read it\./);
  const open = partialBanner({ state: finishedState({ passed: false, outcome: 'no_consensus', delivered_text: { same_as_signed: true, changed_by: [] } }), draftName: 'deliverable.md', runId: 'r' });
  assert.match(open, /\*\*Not a signed-off plan\.\*\*/);
});

test('renderTextLabelsBoard: a degraded finish is not described as a plain sign-off, and a clean signed unchanged run still gets no section (item 4 review)', () => {
  const l = buildTextLabels({ reviewedDraft: 'PLAN', signed: true, round: 1, openObjections: 0, body: 'PLAN', deliverable: 'PLAN' });
  assert.equal(renderTextLabelsBoard({ signedText: l.signed_text, deliveredText: l.delivered_text }), '');
  assert.equal(renderTextLabelsBoard({ signedText: l.signed_text, deliveredText: l.delivered_text, outcome: 'consensus' }), '');
  const d = renderTextLabelsBoard({ signedText: l.signed_text, deliveredText: l.delivered_text, outcome: 'degraded' });
  assert.match(d, /\*\*Not a clean sign-off:\*\*/);
  assert.doesNotMatch(d, /The panel signed the draft/);
});

test('changedAfterReviewSentence: a damaged record (same_as_signed:false, no changed_by list) is a sentence, not a throw', () => {
  assert.match(changedAfterReviewSentence({ delivered_text: { same_as_signed: false } }), /differs from the text the panel last reviewed/);
});
