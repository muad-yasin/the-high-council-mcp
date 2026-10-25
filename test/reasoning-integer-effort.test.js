// DeepSeek V4.1 Flash takes an INTEGER reasoning effort (1-100) in its chat-template kwargs, and the word "high" means 75 on the model's template and 50 on vLLM's encoder (src/reasoning-table.json,
// sources.deepseek-v41-model-card). The shipped seat therefore sends the integer 75 (C&C ruling, 14 Oct 2026). An integer counts as "high or above" only from the number the model's table row names
// (`highAtLeast`); a row without one keeps every integer a lowering (fails closed). Offline, pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loweringReasons, highExtraFor, reasoningProblems, rowOf } from '../src/reasoning.js';
import * as reasoning from '../src/reasoning.js';   // isHighInteger is read off the namespace so this file still loads against a tree that lacks it

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const V41 = { provider: 'together', model: 'deepseek-ai/DeepSeek-V4.1-Flash', maxTokens: 36000 };
const V4_0731 = { provider: 'together', model: 'deepseek-ai/DeepSeek-V4-Flash-0731', maxTokens: 36000 };
const kw = effort => ({ chat_template_kwargs: { thinking: true, reasoning_effort: effort } });
const reasons = (seat, effort) => loweringReasons(kw(effort), seat).filter(r => r.path === 'chat_template_kwargs.reasoning_effort');

test('the V4.1 Flash row carries the number an integer effort counts as high from, and the form that writes it', () => {
  assert.equal(rowOf(V41).highAtLeast, 75);
  assert.deepEqual(highExtraFor(V41).extra, kw(75));
});

test('an integer at or above the row\'s highAtLeast is not a lowering; below it, off the scale or not an integer is', () => {
  for (const ok of [75, 76, 100]) assert.deepEqual(reasons(V41, ok), [], `${ok}`);
  for (const bad of [74, 50, 25, 1, 0, -5, 101, 75.5, NaN, '75', null]) assert.equal(reasons(V41, bad).length, 1, `${JSON.stringify(bad)} must be a lowering`);
  assert.deepEqual(reasons(V41, 'high'), [], 'the words keep working');
  assert.equal(reasons(V41, 'low').length, 1);
});

test('a model row with NO highAtLeast keeps every integer a lowering (fails closed), and a seat the table does not know too', () => {
  assert.equal(rowOf(V4_0731).highAtLeast, undefined);
  assert.equal(reasons(V4_0731, 75).length, 1, 'V4-Flash-0731 has no number: an integer is a lowering');
  assert.equal(reasons({ provider: 'together', model: 'no-such-model' }, 100).length, 1);
  assert.equal(reasons(null, 100).length, 1);
  assert.equal(reasoning.isHighInteger?.(100, { highAtLeast: undefined }), false);
  assert.equal(reasoning.isHighInteger?.(75, { highAtLeast: 75 }), true);
});

test('reasoningProblems (the chain-lint rule reasoning-not-high) accepts the shipped seat and refuses an integer below the number', () => {
  assert.deepEqual(reasoningProblems({ ...V41, extra: kw(75) }), []);
  const low = reasoningProblems({ ...V41, extra: kw(50) });
  assert.equal(low.length, 1);
  assert.equal(low[0].path, 'chat_template_kwargs.reasoning_effort');
  assert.equal(low[0].value, 50);
  assert.equal(reasoningProblems({ ...V41, extra: { chat_template_kwargs: { thinking: false, reasoning_effort: 75 } } }).length > 0, true, 'thinking off is still a lowering');
});

test('the shipped plan-debate-roles-c1 critic seat sends the integer inside chat_template_kwargs, and it lints clean', () => {
  const chain = JSON.parse(readFileSync(join(root, 'chains', 'outdated', 'plan-debate-roles-c1.json'), 'utf8'));
  const seat = chain.seats.critics.find(s => s.model === 'deepseek-ai/DeepSeek-V4.1-Flash');
  assert.ok(seat, 'the V4.1 Flash critic is seated');
  assert.deepEqual(seat.extra, kw(75));
  assert.equal(seat.extra.reasoning_effort, undefined, 'never top-level: Together types that field as a low/medium/high enum');
  assert.deepEqual(reasoningProblems(seat), []);
});
