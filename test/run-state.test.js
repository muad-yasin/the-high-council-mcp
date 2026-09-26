// v5 item 3: unit tests for src/run-state.js's pure helpers - the classification/parsing logic
// behind state.json, tested with no CLI process, no chain.js, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoundFromLabel, classifyStageCompletion, classifyVerdictEvent, sumCostFromStageLogText } from '../src/run-state.js';

test('parseRoundFromLabel: extracts the round from critique/panel/revise/allocator labels', () => {
  assert.equal(parseRoundFromLabel('critique-1'), 1);
  assert.equal(parseRoundFromLabel('panel-2-glm'), 2);
  assert.equal(parseRoundFromLabel('panel-2-glm-question'), 2);
  assert.equal(parseRoundFromLabel('revise-3'), 3);
  assert.equal(parseRoundFromLabel('allocator-1'), 1);
});

test('parseRoundFromLabel: null for labels with no round (criteria, build, propose-*, descending-*)', () => {
  assert.equal(parseRoundFromLabel('criteria'), null);
  assert.equal(parseRoundFromLabel('build'), null);
  assert.equal(parseRoundFromLabel('propose-deepseek'), null);
  assert.equal(parseRoundFromLabel('descending-plan-critic-glm'), null);
  assert.equal(parseRoundFromLabel(undefined), null);
});

test('classifyStageCompletion: posted for propose-/debate- prefixes, null for everything else', () => {
  assert.equal(classifyStageCompletion('propose-deepseek'), 'posted');
  assert.equal(classifyStageCompletion('debate-glm'), 'posted');
  assert.equal(classifyStageCompletion('reply-kimi'), null); // left to the verdict event
  assert.equal(classifyStageCompletion('panel-1-glm'), null);
  assert.equal(classifyStageCompletion('critique-1'), null);
  assert.equal(classifyStageCompletion('criteria'), null);
});

test('classifyStageCompletion: the tiered-council stages (architectures, posts on them, deep-dive calls) are posted', () => {
  assert.equal(classifyStageCompletion('alternative-gpt6-astra'), 'posted');
  assert.equal(classifyStageCompletion('alt-debate-gpt5.6-luna'), 'posted');
  assert.equal(classifyStageCompletion('deep-dive-deepseek-v4.1-flash-3'), 'posted');
  assert.equal(classifyStageCompletion('deep-dive-revise'), null, 'the reviser, not the deep-dive seat');
  assert.equal(classifyStageCompletion('alt-reply-fable5.1'), 'posted', 'no verdict event is sent for an architecture reply');
});

test('classifyVerdictEvent: dropped wins, distinct from objected/signed', () => {
  assert.equal(classifyVerdictEvent({ dropped: true }), 'dropped');
  assert.equal(classifyVerdictEvent({ passed: false }), 'objected');
  assert.equal(classifyVerdictEvent({ passed: true }), 'signed');
});

test('classifyVerdictEvent: a stated pass maps to posted', () => {
  assert.equal(classifyVerdictEvent({ passStated: true }), 'posted');
});

test('classifyVerdictEvent: reply decisions - held only when at least one keep, else falls back to current status', () => {
  assert.equal(classifyVerdictEvent({ decisions: { keep: 1, amend: 0, withdraw: 0 } }), 'held');
  assert.equal(classifyVerdictEvent({ decisions: { keep: 0, amend: 2, withdraw: 0 } }, 'posted'), 'posted');
  assert.equal(classifyVerdictEvent({ decisions: { keep: 0, amend: 0, withdraw: 1 } }, undefined), 'posted');
});

test('classifyVerdictEvent: an unrecognized event shape returns null rather than throwing', () => {
  assert.equal(classifyVerdictEvent({}), null);
  assert.equal(classifyVerdictEvent({ somethingElse: 1 }), null);
});

test('sumCostFromStageLogText: sums usd per lab and overall from real stage-log.jsonl-shaped lines', () => {
  const text = [
    JSON.stringify({ stage: 'propose-deepseek', lab: 'deepseek', usd: 0.02 }),
    JSON.stringify({ stage: 'propose-glm', lab: 'glm', usd: 0.01 }),
    JSON.stringify({ stage: 'critique-1', lab: 'deepseek', usd: 0.03 }),
  ].join('\n');
  const { perLab, spentUsd } = sumCostFromStageLogText(text);
  assert.equal(spentUsd, 0.06);
  assert.deepEqual(perLab.sort((a, b) => a.lab.localeCompare(b.lab)), [
    { lab: 'deepseek', usd: 0.05 },
    { lab: 'glm', usd: 0.01 },
  ]);
});

test('sumCostFromStageLogText: tolerant of empty text, a truncated last line, and unparseable lines', () => {
  assert.deepEqual(sumCostFromStageLogText(''), { perLab: [], spentUsd: 0 });
  assert.deepEqual(sumCostFromStageLogText(undefined), { perLab: [], spentUsd: 0 });
  const text = `${JSON.stringify({ lab: 'a', usd: 0.01 })}\n{"lab": "b", "usd": 0.0` /* truncated */;
  const { perLab, spentUsd } = sumCostFromStageLogText(text);
  assert.equal(spentUsd, 0.01);
  assert.deepEqual(perLab, [{ lab: 'a', usd: 0.01 }]);
});
