// 0.8.4 round 1, R1 (held fix), the legs A and B shape through the REAL CLI and the run's own HANDOFF.md (src/cli.js writes the banner, not a reader of the report): every judge signs off, the handler says not yet, one overseer round, the person ends the run at once.
// The ending's kind says the top layer signed off and the run did not end agreed. The banner's sentence "The panel did not sign off on the plan below" is then wrong about the top layer; the new sentence claims only that the run did not end agreed. (The lead "Not a signed-off plan." stays: C&C 80296ad3, signedOff is THC's own term for an agreed run.)
// What tells the case apart (not a wording pin): the banner no longer carries the old sentence. Controls: an EDITED record (the report of the same run with the counts of a job217-like shape swapped in: 3 objections stand, the handler said not yet): the new sentence holds there too and the reason keeps "finished with open objections"; the same record without
// the finish-at-once stop (the shape of a run that passed and was then not agreed) and with another ending word keep today's sentences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { topSignedCliRun } from './helpers/top-signed-cli-run.js';
import { finishedState, partialBanner } from '../src/handoff-from-run.js';
import * as EM from '../src/ending-matrix.js';

let ran = null;
const real = () => (ran ??= topSignedCliRun());
const bannerOf = r => partialBanner({ state: finishedState({ passed: EM.agreedOf(r), outcome: r.outcome, delivered_text: r.delivered_text, ending_word: r.ending_word, nothing_open_at_once: EM.finishedAtOnceNothingOpen(r), at_once: EM.finishedAtOnceCase?.(r), nothing_stands: EM.nothingStandsAtEnd?.(r), top_signed: EM.topSignedNotAgreed?.(r) }), draftName: 'deliverable.md', runId: 'r1' });
const OLD_SENTENCE = /The panel did not sign off on the plan below/;

function premise(w) {
  assert.ok(w.report, `premise: the run wrote report.json (steps ${JSON.stringify(w.steps)})`);
  assert.equal(w.report.ending?.kind, 'signed_off_at_top_not_agreed', 'premise: the top layer signed off and the run did not end agreed');
  assert.equal(w.report.stop?.finished_at_once, true, 'premise: the person ended it at once');
  assert.equal(w.report.signed_text.open_objections, 0, 'premise: nothing is open');
  assert.ok(w.handoffMd && w.handoffMd.startsWith('> **'), 'premise: HANDOFF.md carries a harness banner');
}

test('R1 (the run\'s own HANDOFF.md): the banner of a run the top layer signed and that did not end agreed does not say "The panel did not sign off on the plan below"', () => {
  const w = real(); premise(w);
  const top = w.handoffMd.split('\n').slice(0, 3).join('\n');
  assert.doesNotMatch(top, OLD_SENTENCE);
  assert.equal(top.split('\n')[1], bannerOf(w.report).split('\n')[1], 'the sentence after the reason is the one the report reader builds (--from-run); line 1 differs only in the run id');
});

test('R1 (an EDITED record, derived from the same report: the top layer signed, 3 objections stand, the handler said not yet): the new sentence holds there too, and the reason keeps "finished with open objections"', () => {
  const w = real(); premise(w);
  const standing = structuredClone(w.report); standing.signed_text.open_objections = 3; standing.dispute = { ran: true, open_objections: [{ id: 'O-0a0a0a0a', lab: 'l1' }, { id: 'O-0b0b0b0b', lab: 'l1' }, { id: 'O-0c0c0c0c', lab: 'l1' }] };
  const b1 = bannerOf(standing);
  assert.doesNotMatch(b1, OLD_SENTENCE);
  assert.match(b1, /finished with open objections/);
});

test('R1 controls (the same report, one field swapped; they pass on the tip too): a run that is not finished at once (the shape of a run that passed and was then not agreed), or has another ending word, keeps today\'s sentences', () => {
  const w = real(); premise(w);
  const notAtOnce = structuredClone(w.report); delete notAtOnce.stop.finished_at_once;
  assert.match(bannerOf(notAtOnce), OLD_SENTENCE);
  const other = structuredClone(w.report); other.ending = null; other.ending_word = 'layer_stop';
  assert.match(bannerOf(other), OLD_SENTENCE);
});
