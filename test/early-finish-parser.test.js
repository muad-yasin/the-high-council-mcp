// ROADMAP 83 commit 1 (C&C thcmcp-6d ruling 20 Okt 2026): the early-finish trailer line and the run's ending word. Offline, $0.
//  EF-1 parseDisputes strips one well-formed `EARLY-FINISH: <reason>` trailer line and returns the reason apart; look-alikes stay plan text; a line in the middle of the plan is never touched.
//  EF-2 stripDeclined (every other reader) strips it too, so it can never reach a draft or a deliverable.
//  EF-3 the ending word of an early finish is `early_finish`, NEVER `finish_chosen` (that word says a person chose to finish at a limit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDisputes, stripDeclined } from '../src/draft-disputes.js';

const PLAN = 'The worker retries failed requests.\n\nStep one. Step two.';

test('EF-1: a trailing EARLY-FINISH line is stripped and returned; the last one wins; it is free in the closing walk; look-alikes are plan text', () => {
  const r = parseDisputes(`${PLAN}\nDECLINED: O-11111111: not a defect\nEARLY-FINISH: only two wording items are open, the builder can do them\n`);
  assert.equal(r.draft, PLAN);
  assert.equal(r.earlyFinish, 'only two wording items are open, the builder can do them');
  assert.deepEqual(r.disputes, ['O-11111111: not a defect'], 'the DECLINED line is read as it always was (no ids unless the stage asks)');
  assert.equal(parseDisputes(`${PLAN}\nEARLY-FINISH: first\nEARLY-FINISH: second\n`).earlyFinish, 'second');
  assert.equal(parseDisputes(`${PLAN}\nEARLY-FINISH: reason\nThanks, done.\nBest.\n`).draft, `${PLAN}\nThanks, done.\nBest.`, 'two closing lines after it do not hide it');
  for (const bad of ['early-finish: lower case', 'EARLY-FINISH:', 'EARLY-FINISH:   ', 'EARLY FINISH: no hyphen', ' - EARLY-FINISH x']) {
    const x = parseDisputes(`${PLAN}\n${bad}\n`);
    assert.equal(x.earlyFinish, null, bad);
    assert.ok(x.draft.includes(bad.trim()), `${bad} stays in the text`);
  }
  assert.equal(parseDisputes(`${PLAN}\nEARLY-FINISH: quoted in the body\n\nMore plan text follows here.\nAnd more.\nAnd more again.\nAnd the last.\n`).earlyFinish, null, 'a line in the middle of the plan is never pulled out');
  assert.equal(parseDisputes(PLAN).earlyFinish, null);
});

test('EF-2: stripDeclined, the reader every other stage goes through, strips the line', () => {
  assert.equal(stripDeclined(`${PLAN}\nEARLY-FINISH: reason\n`), PLAN);
});

test('EF-3: an early finish ends as early_finish, never as finish_chosen; the older endings are unchanged', async () => {
  const { panelEnding } = await import('../src/overseer-rounds.js');
  assert.equal(panelEnding({ passed: false, earlyFinish: { reason: 'r' } }), 'early_finish');
  assert.equal(panelEnding({ passed: false, finishedStop: { kind: 'overseer_cap', chosen: 'finish' } }), 'finish_chosen');
  assert.equal(panelEnding({ passed: true, earlyFinish: { reason: 'r' } }), 'signed_off', 'a passed run is a pass');
  assert.equal(panelEnding({ passed: false, layerStop: { reason: 'x' } }), 'layer_stop');
  assert.equal(panelEnding({ passed: false }), 'not_signed_off');
});
