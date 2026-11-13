// 0.8.4 S16 (F; T9e T21q T21bz; WORDING S16-w60 to w68): the pure parts of `--finish` at a spending stop: the decision (which stops accept it, which refuse and what they say), the recorded entry's shape, the words the command prints, the headline of a run that ended this way,
// and the dissent digest's first-pass guard. The behaviour (the chain ends at the stage the limit stopped; the CLI records, exits 4 and resumes) is test/s16-spend-finish.test.js and test/s16-spend-finish-cli.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spendFinishDecision, spendFinishState, spendFinishAnswer, spendFinishNote, SPEND_FINISH_BAD, SPEND_PHASES } from '../src/spend-finish.js';
import { budgetFinishWords, finishedAtStopWords, verdictHeadline } from '../src/verdict-headline.js';
import { deriveDissentSummary, renderDigestTemplate } from '../src/dissent-digest.js';

const stopAt = (phase, extra = {}) => ({ stoppedAt: 'panel-2-lb', seat: 'mock/mock-priced', spentUsd: 1, capUsd: 2, ...(phase ? { phase } : {}), ...extra });

test('the phases the harness records are the three the decision knows', () => {
  assert.deepEqual([...SPEND_PHASES], ['before', 'loop', 'after']);
});

test('T9e: a stop INSIDE the review rounds accepts --finish and records the stage and, with per-provider caps, the cap; nothing else is new', () => {
  assert.deepEqual(spendFinishDecision({ stop: stopAt('loop') }), { record: { label: 'panel-2-lb' } });
  assert.deepEqual(spendFinishDecision({ stop: stopAt('loop', { capName: 'anthropic' }) }), { record: { label: 'panel-2-lb', cap_name: 'anthropic' } });
});

test('T9e: a stop BEFORE the review rounds and one AFTER them refuse --finish, each saying what the raise will do, and record nothing', () => {
  const before = spendFinishDecision({ stop: stopAt('before'), runDir: 'runs/x' });
  assert.equal(before.record, undefined);
  assert.equal(before.refusal, '--finish: this stop came before the review rounds began, so there is no plan under review yet and nothing to finish. Raise the spending limit as before (the way to do it is in runs/x/STOPPED-budget.md): the run then goes on from the stage it stopped at. Nothing was recorded, run or spent.');
  const after = spendFinishDecision({ stop: stopAt('after'), runDir: 'runs/x' });
  assert.equal(after.refusal, '--finish: this stop came after the review rounds, so the run is already ending. Raise the spending limit as before (the way to do it is in runs/x/STOPPED-budget.md): the stage it stopped at is paid for and the run ends the way it was going to. Nothing was recorded, run or spent.');
});

test('fail closed: a stop record with no phase, an unreadable one or one without a stage name refuses; a tree member and --max-usd beside --finish refuse', () => {
  for (const stop of [stopAt(null), null, 'x', stopAt('loop', { stoppedAt: '' }), stopAt('inside')]) {
    const d = spendFinishDecision({ stop, runDir: 'runs/x' });
    assert.equal(d.record, undefined);
    assert.match(d.refusal, /^--finish: the stop record \(STOPPED-budget\.json\) does not say where in the run it came, so your choice cannot be matched to a review\. .* Nothing was recorded, run or spent\.$/);
  }
  assert.match(spendFinishDecision({ stop: stopAt('loop'), member: true }).refusal, /^--finish: this run is a member of a tree;/);
  assert.match(spendFinishDecision({ stop: stopAt('loop'), maxUsdGiven: true }).refusal, /^--finish: give it alone\. .* Nothing was recorded, run or spent\.$/);
});

test('run.json budgetFinish: only a whole entry arms; a damaged one is "bad" (the resume is refused); none is none; the label is NOT compared with the stop file', () => {
  const ok = { choice: 'finish', label: 'panel-2-lb', at: '2026-11-09T10:00:00.000Z', via: 'cli' };
  assert.equal(spendFinishState({}), 'none');
  assert.equal(spendFinishState({ budgetFinish: ok }), 'finish');
  for (const bad of [null, 'finish', {}, { ...ok, choice: 'continue' }, { ...ok, label: '' }, { ...ok, at: 'yesterday' }, { ...ok, label: 7 }]) assert.equal(spendFinishState({ budgetFinish: bad }), 'bad', JSON.stringify(bad));
  assert.match(SPEND_FINISH_BAD, /^--resume: the finish recorded in run\.json \(budgetFinish\) cannot be read/);
});

test('the answer (exit 4): records, says nothing ran, names the stage, the final read and its cost; the figure is not given once the long-list parts are recorded; a raise that does not cover the read stops the run again', () => {
  const plain = spendFinishAnswer({ label: 'panel-2-lb', topLayer: 3, topSeats: 2, runDir: 'runs/x' });
  assert.equal(plain, 'Your choice to end the run here is recorded: nothing was run and nothing was spent. The run stays stopped. When you raise the spending limit as before (the way to do it is in runs/x/STOPPED-budget.md), the run ends at stage "panel-2-lb", NOT agreed, after the final read of layer 3: that read makes up to 4 calls, none for a seat of that layer that has already read exactly this text. That read runs only once your raise pays for it; a raise that does not cover it stops the run again, still not ended.');
  const parts = spendFinishAnswer({ label: 'panel-2-lb', topLayer: 3, topSeats: 2, parts: true, runDir: 'runs/x' });
  assert.match(parts, /after the final read of layer 3: it makes two calls for each seat of that layer for each part of a long list, fewer when a seat has already read exactly this text\./);
  assert.doesNotMatch(parts, /up to \d+ calls/);
  assert.match(spendFinishAnswer({ label: 's', runDir: 'r' }), /after the final read\. That read runs only once/);
  // CHANGED ACCEPTED (the raise screen's finish note carries the caveat of the --finish answer, S16-w62f). OLD: '  you chose to end the run at the spending stop (stage "panel-2-lb"); it ends there, NOT agreed, after the final read.' NEW: the same, then " A raise that does not cover it stops the run again, still not ended. "
  assert.equal(spendFinishNote('panel-2-lb'), '  you chose to end the run at the spending stop (stage "panel-2-lb"); it ends there, NOT agreed, after the final read. A raise that does not cover it stops the run again, still not ended.');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: ...NOT agreement: the run stopped before stage "panel-2-lb" was paid for. NEW: ...NOT agreement: the run stopped at stage "panel-2-lb", before its next call was paid for. WHY: NL-0389 (RESOLVED_LIST), src/verdict-headline.js budgetFinishWords.
test('T21q: the words of a run that ended this way: budget_stop names the stage (and the cap), is NOT agreement, and never says a layer "did not sign off" (the pass was cut)', () => {
  const report = { passed: false, stop: { kind: 'budget_stop', pass: 2, overseer_round: 1, label: 'panel-2-lb', chosen: 'finish', cap_name: 'anthropic' }, layers: [{ layer: 1, round: 2, state: 'signed_off' }, { layer: 3, round: 2, state: 'not_asked' }] };
  assert.equal(budgetFinishWords(report), 'finished at the person\'s choice at the spending limit, the anthropic cap, after the final read, NOT agreement: the run stopped at stage "panel-2-lb", before its next call was paid for');
  assert.equal(budgetFinishWords({ ...report, stop: { ...report.stop, cap_name: undefined } }), 'finished at the person\'s choice at the spending limit, after the final read, NOT agreement: the run stopped at stage "panel-2-lb", before its next call was paid for');
  assert.equal(budgetFinishWords({ ...report, passed: true }), null);
  assert.equal(budgetFinishWords({ stop: { kind: 'overseer_cap', chosen: 'finish' } }), null);
  assert.equal(finishedAtStopWords(report), null, 'no top-layer clause for a cut pass');
  const h = verdictHeadline(report);
  assert.deepEqual([h.heading, h.label], ['Verdict', 'NOT AGREED']);
  assert.match(h.text, /^NOT AGREED - finished at the person's choice at the spending limit/);
});

test('the dissent digest: a budget_stop in the FIRST pass with no layer answered has no panel verdict; a later pass, or a first pass that answered, reads as before', () => {
  const stop = (pass) => ({ kind: 'budget_stop', pass, overseer_round: 1, label: 'panel-1-la', chosen: 'finish' });
  const cut = deriveDissentSummary({ outcome: 'x', stop: stop(1), layers: [{ layer: 1, round: 1, state: 'unfinished' }, { layer: 2, round: 1, state: 'not_asked' }] });
  assert.equal(cut.noPanel, 'spend');
  assert.equal(renderDigestTemplate(cut), 'No verdict of the panel counts: the run was finished at the person\'s choice at the spending limit in the first pass, before the review of the plan was complete.');
  assert.equal(deriveDissentSummary({ outcome: 'x', stop: stop(2), layers: [] }).noPanel, undefined);
  assert.equal(deriveDissentSummary({ outcome: 'x', stop: stop(1), layers: [{ layer: 1, round: 1, state: 'objected' }] }).noPanel, undefined);
});
