// PR #2 fix unit, items 6 and 7 (the words a spending finish gets). Offline, $0: the scenario of test/helpers/layer-two-run.js.
//   Item 6 (V7): the run.log line of a spending finish names the spending limit (the sentence the outer catches of chain.js already use), at both inner catches (the layer that was cut with nothing else answered, and the layer cut after an earlier layer answered);
//     a found-secret finish keeps its own sentence.
//   Item 7 (V5(b), Bug Audit S3 F1): "no judge read the plan again" is printed only when no judge did: BOARD.md and the verdict line of the CLI (which prints from the result, not from the report) say what is on disk.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as chain from '../src/chain.js';
import { renderBoardMd } from '../src/report-shape.js';
import { budgetFinishWords, ownerPauseFinishWords } from '../src/verdict-headline.js';
import { setHeldForTest } from '../src/held-roles.js';
import { scenario, FINAL_READ_OK } from './helpers/layer-two-run.js';

afterEach(() => { chain.setSpendFinish?.(null); chain.setCache(null); chain.setBudget(null); chain.setPromptSpy(null); chain.setOutboundScan({}); chain.setNoMoneySitting?.(false); setHeldForTest(null); });

const DISPUTE = { dispute: { enabled: true, stall_rounds: 2 } };
const SPEND_LINE = /finishing at the person's choice: the spending limit stopped the run at stage "([^"]+)", before its next call was paid for; this is NOT agreement\./;
const SECRET_LINE = /finishing at the person's choice: the run was paused at a credential-shaped string in stage "([^"]+)"; this is NOT agreement\./;

// site 1: layer 1 is the layer cut, nothing else of the pass answered (its judge is the only one of the layer and its stage is a miss)
// site 2: layer 1 signs off, the stage of layer 2 is the miss (an earlier layer answered)
const SITES = [
  ['nothing else of the pass answered', { extra: DISPUTE, cutLabels: ['panel-1-la'], overrides: { ...FINAL_READ_OK } }, 'panel-1-la'],
  ['an earlier layer answered', { extra: DISPUTE, cutLabels: ['panel-1-lb'], overrides: { 'panel-1-la': FINAL_READ_OK['final-read-lc'], ...FINAL_READ_OK } }, 'panel-1-lb'],
];
for (const [site, opts, label] of SITES) {
  test(`item 6: a spending finish where ${site}: the run.log line names the spending limit, never a credential-shaped string`, async () => {
    chain.setSpendFinish({ capName: null });
    const lines = [];
    await scenario({ ...opts, lines });
    const log = lines.join('\n');
    assert.equal(SPEND_LINE.exec(log)?.[1], label, log);
    assert.ok(!/credential-shaped/.test(log), 'no sentence about a credential-shaped string in a run that met none');
  });
  test(`control: a found-secret finish where ${site}: the run.log line is the credential sentence, as before`, async () => {
    chain.setOutboundScan({ finish: true });
    const lines = [];
    await scenario({ ...opts, lines });
    assert.equal(SECRET_LINE.exec(lines.join('\n'))?.[1], label);
    assert.ok(!SPEND_LINE.test(lines.join('\n')));
  });
}

test('item 7: a finish at once at the spending limit WITH a final read on disk: the board and the verdict line do not say that no judge read the plan again', async () => {
  chain.setSpendFinish({ capName: null, atOnce: true }); chain.setNoMoneySitting(true);
  const { result: r } = await scenario({ extra: DISPUTE, cutLabels: ['panel-1-lb'], overrides: { 'panel-1-la': FINAL_READ_OK['final-read-lc'], ...FINAL_READ_OK } });
  assert.equal(r.stop?.finished_at_once, true);
  assert.equal(r.finalRead?.ran, true, 'premise: the read of the top layer was on disk and counted');
  const board = renderBoardMd({ runId: 'r-at-once', result: r });
  assert.ok(/finished at the person's choice at the spending limit/i.test(board), 'premise: the board carries the budget words');
  assert.ok(!/no judge read the plan again/.test(board), board);
  assert.ok(!/no judge read the plan again/.test(budgetFinishWords(r)), 'the verdict line of the CLI is made from the result');
  assert.ok(/final read/.test(budgetFinishWords(r)), budgetFinishWords(r));
});

test('control: a finish at once with NO read on disk still says that no judge read the plan again, on the board and in the verdict line', async () => {
  chain.setSpendFinish({ capName: null, atOnce: true }); chain.setNoMoneySitting(true);
  const { result: r } = await scenario({ extra: DISPUTE, cutLabels: ['panel-1-lb', 'final-read-lc'], overrides: { 'panel-1-la': FINAL_READ_OK['final-read-lc'], ...FINAL_READ_OK } });
  assert.notEqual(r.finalRead?.ran, true, 'premise: no read ran');
  assert.ok(/no judge read the plan again/.test(renderBoardMd({ runId: 'r-at-once', result: r })));
  assert.ok(/no judge read the plan again/.test(budgetFinishWords(r)));
});

// C&C 13 Nov: the owner's pause finish says it by the same rule. A final read at the owner's pause finished at once is not reached by a real verb as far as traced (the read runs at the end of a run, a pause ends it before the next pass), so this row reads a report that carries one; the words follow what the report says.
test('item 7 at the owner\'s pause: "and no judge read the plan again" is said only when no final read is on the record', () => {
  const stop = { kind: 'owner_pause', chosen: 'finish', pass: 2, finished_at_once: true };
  assert.match(ownerPauseFinishWords({ stop, passed: false, final_read: { ran: false, reason: 'every_top_seat_read_this_plan' } }), /and no judge read the plan again/);
  assert.match(ownerPauseFinishWords({ stop, passed: false }), /and no judge read the plan again/, 'no record of a read: as before');
  assert.doesNotMatch(ownerPauseFinishWords({ stop, passed: false, final_read: { ran: true, seats: [{ lab: 'top', read: true }] } }), /no judge read the plan again/);
  assert.doesNotMatch(ownerPauseFinishWords({ stop, passed: false, finalRead: { ran: true, seats: [{ lab: 'top', read: true }] } }), /no judge read the plan again/, 'a result spells it finalRead');
});

// C&C 13 Nov: with a judge's cut answer on the record, "was never put to the panel" (signed_text.round is null: a pass whose only calls were cut does not count) is false beside an open objection that judge raised against that draft. The sentence says what is true of the plan: the existing wording without the clause.
test('the board does not say that the last draft "was never put to the panel" when a judge read it and its answer was cut; it still says so when no judge was asked', async () => {
  chain.setSpendFinish({ capName: null });
  const { result: cutRead } = await scenario({ critics: [['la', 1], ['lb', 1], ['lx', 2], ['lc', 3]], extra: DISPUTE, cutLabels: ['panel-1-lb'], overrides: { ...FINAL_READ_OK } });
  assert.equal(cutRead.signedText.round, null, 'premise: no panel round is recorded');
  assert.equal(cutRead.signedText.open_objections, 1, 'premise: a judge\'s open objection against that draft');
  const board = renderBoardMd({ runId: 'r-cut-read', result: cutRead });
  assert.match(board, /\*\*Not accepted:\*\* the panel did not sign off \(1 open objection when it stopped\); the run's last draft has sha256 `[0-9a-f]{12}`\. /);
  assert.doesNotMatch(board, /never put to the panel/);
  const { result: noRead } = await scenario({ extra: DISPUTE, cutLabels: ['panel-1-la'], overrides: { ...FINAL_READ_OK } });
  assert.equal(noRead.signedText.round, null);
  assert.match(renderBoardMd({ runId: 'r-no-read', result: noRead }), /and was never put to the panel\./, 'control: no judge was asked, the clause is true and stays');
});
