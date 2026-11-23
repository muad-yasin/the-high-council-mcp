// 0.8.4 item 6: the batch of test/held-prompts/held-084-summary.js (the pairing convention of test/held-prompts.test.js). Recorded all together or not at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/roles.js';
import * as HS from './held-prompts/held-084-summary.js';

const CALLS = { handlerSummaryInstruction: [[]], handlerSummaryEndLine: [[{ run: 'runs/2026-11-10T00-00-00-000Z' }]] };

test('the summary instruction batch of the 0.8.4 build (held-084-summary.js): recorded all together or not at all, and a recorded one renders exactly as drafted', () => {
  const names = Object.keys(HS).filter(n => typeof HS[n] === 'function');
  assert.deepEqual(Object.keys(CALLS).sort(), names.slice().sort(), 'every drafted function has calls here: add one when you draft one');
  const recorded = names.filter(n => n in R);
  assert.ok(recorded.length === 0 || recorded.length === names.length, `a partial re-record: ${recorded.join(', ')} are in src/roles.js, ${names.filter(n => !(n in R)).join(', ')} are not`);
  for (const name of recorded) for (const args of CALLS[name]) assert.equal(R[name](...args), HS[name](...args), `${name}: src/roles.js renders differently from test/held-prompts/held-084-summary.js`);
});

test('the drafted summary instruction: the four parts, only what the plan says, nothing added, the plan unchanged, and the command that adds the file', () => {
  const t = HS.handlerSummaryInstruction();
  for (const part of ['(1) a summary', '(2) what the plan leaves open', '(3) the key data points', '(4) an index']) assert.ok(t.includes(part), part);
  assert.match(t, /using only what the plan says/);
  assert.match(t, /Add no claim, number or decision that the plan does not contain, and change nothing in the plan\./);
  assert.match(t, /council summary-add <run folder> --summary-file <file>\.$/);
});

test('the drafted end line names the command and the run, and claims nothing about the ending', () => {
  const t = HS.handlerSummaryEndLine({ run: 'runs/x' });
  assert.equal(t, 'the handling session can add a summary and index of this plan at the top of deliverable.md: run council summary-add runs/x to see what to write.');
  assert.doesNotMatch(t, /agreed|signed|passed/i);
});
