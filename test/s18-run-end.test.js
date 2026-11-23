// 0.8.4 S18 (DEFECT found in merged code; Muad's 30 Okt heading "the run ends as agreed when layer 3 signs off and the handler says good to build", an escalated layer-3 sign-off counts as agreed): `final_read.run_end` said 'not_agreed' for an escalated or ladder sign-off the handler had agreed
// (`passed` is false there), so a final-read objection at such an end neither blocked the ending (finalReadBlocksAgreement reads run_end 'agreed') nor avoided the false basis label final_read_objection, and the sentences about the earlier agreement said "every layer had signed off". Now run_end is 'agreed' when `passed` OR the handler agreed
// the sign-off (agreedByCheck), and the four sentences have variants for the handler-agreed case. Offline, mock seats, $0. The whole-run row is the T15p fixture (test/helpers/s8-handler-rows.js, the escalated sign-off with the handler's good_to_build, final_read on) read for what it did not assert. The words are held (the check's words are injected; as shipped no check
// is asked and nothing changes). A final read cannot call at such an end (nothing changes the text after the good_to_build: the dispute, the challenge and the final edit are skipped, chain.js agreedAtPoint), so the objection and the sentences are pinned PURELY on the records and renderers. Written without a run (no tests on the laptop). The red of the whole-run row is the parent commit ('not_agreed').
import test from 'node:test';
import assert from 'node:assert/strict';
import { runT15p } from './helpers/s8-handler-rows.js';
import { finalReadRecord, finalReadLogLines, renderFinalReadBlock, renderFinalReadBoard, finalReadBlocksAgreement } from '../src/final-read.js';
import { endingOf, isAgreed } from '../src/ending.js';

const SEAT_OBJECTS = { lab: 'top-gamma', layer: 3, label: 'final-read-top-gamma', last_read_sha: 'sha-old', reasked: false, read: true, meets: false, failures: [{ criterion: 'C', problem: 'A new problem.', severity: 5, not_debated: true }] };

test('F3 (whole run): an escalated sign-off that the handler agreed (good_to_build) has final_read.run_end "agreed", as the ending says', async () => {
  const d = await runT15p();
  assert.equal(d.error, undefined, `premise: the run ends without an error (${String(d.error?.stack || d.error)})`);
  assert.deepEqual([d.result.passed, d.result.buildChecks?.[0]?.kind, d.result.ending?.kind], [false, 'escalated', 'agreed'], 'premise: an escalated sign-off, passed false, the ending agreed on the handler\'s good_to_build');
  assert.equal(d.result.finalRead?.run_end, 'agreed', 'F3: the final-read record says the run had ended agreed');
});

test('F3 (pure): at an escalated sign-off the handler agreed, a final-read objection that holds the sign-off blocks the agreement (the ending is signed_off_at_top_not_agreed with the final-read basis) and the record carries no final_read_objection basis of its own (that basis is for runs that had not agreed)', () => {
  const RUN_END = 'agreed';   // how the chain now records the end of a run the handler agreed (it recorded 'not_agreed' before the fix)
  const fr = finalReadRecord({ ran: true, finalSha: 'sha-new', runEnd: RUN_END, seats: [SEAT_OBJECTS] });
  assert.equal(fr.basis, undefined, 'the basis names only a run that had ended without agreement');
  assert.equal(finalReadBlocksAgreement(fr), true, 'the objection holds the sign-off');
  const e = endingOf({ agreement: { kind: 'escalated', pass: 3, sha: 'sha-new' }, check: { answer: 'good_to_build', pass: 3 }, handling: true, finalSha: 'sha-new', finalRead: fr });
  assert.deepEqual([e.kind, e.basis.at(-1)], ['signed_off_at_top_not_agreed', 'final_read_objection']);
  assert.equal(isAgreed({ ending: e, finalRead: fr }), false);
});

test('F3 (pure, WORDING S18-w10, w11, w12): the sentences about the earlier agreement say that layer 3 signed off and the handler said good to build when that is how the run had agreed, and still say every layer otherwise', () => {
  const fr = finalReadRecord({ ran: true, finalSha: 'sha-new', runEnd: 'agreed', seats: [SEAT_OBJECTS] });
  const VIA = true;   // the end was agreed by the handler's good_to_build on layer 3's sign-off (an escalated or ladder one)
  const log = finalReadLogLines(fr.seats, 'agreed', 'sha-new', VIA).join('\n');
  assert.match(log, /OBJECTED TO THE FINAL PLAN with an objection that holds the sign-off: layer 3 had signed off and the handler had said good to build on an earlier text, but this run is NOT agreement\./, 'the log line');
  assert.doesNotMatch(log, /every layer had signed off/, 'no "every layer" at an end layer 3 and the handler agreed');
  const block = renderFinalReadBlock(fr, VIA);
  assert.match(block, /Layer 3 had signed off and the handler had said good to build, but the plan changed after layer 3 last read it\./, 'the block above the plan');
  const board = renderFinalReadBoard(fr, [], VIA);
  assert.match(board, /Layer 3 had signed off and the handler had said good to build, but the plan changed after layer 3 last read it; layer 3 was asked to read the final plan/, 'the BOARD section');
  assert.match(finalReadLogLines(fr.seats, 'agreed', 'sha-new', false).join('\n'), /every layer had signed off on an earlier text/, 'guard: a full sign-off keeps its sentence');
  assert.match(renderFinalReadBlock(fr, false), /^## Layer 3 on the final plan\n\nEvery layer had signed off, but the plan changed after layer 3 last read it\./, 'guard: a full sign-off keeps its header');
});
