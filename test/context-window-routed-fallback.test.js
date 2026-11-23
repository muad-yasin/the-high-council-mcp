// 0.8.4 the Claude route, WIRING (Builder B; C&C's ruling on blocker 4): a Claude model reached through OpenRouter with NO window row of its own reads the DIRECT model's row (the same model: only the route changes; every host's window equals the direct one in the 10 Nov 2026 read of
// the saved endpoint files). Where neither row exists the seat has no window, as any seat with no row has always had, and the start log and the dry run NAME that the final read's room check is skipped for it (routedSeatsWithoutWindow, skippedRoomLines).
// The routed fable-5.1 (the default security reviewer's model) is the real case: the routed table has no row for it, the direct table does. The tests read the real table; none of them uses the test seam, which would bypass the table.
// RED ON THE TREE BEFORE THIS UNIT: CW-1 fails at its first assertion (the routed fable-5.1 has no window: null), a clean red; CW-2 and CW-3 fail at theirs (the function is not exported: asserted by typeof, not by a TypeError).
// NO RED OF ITS OWN: CW-4 (it pins what already held: a model with a routed row of its own keeps it, and no other lab's seat gets a fallback).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CW from '../src/context-window.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = JSON.parse(readFileSync(join(root, 'src', 'context-windows.json'), 'utf8'));
const routed = (model, extra = {}) => ({ provider: 'openrouter', model, originalProvider: 'anthropic', ...extra });

test('CW-1: a routed Claude model with no row of its own reads the direct model\'s row (fable-5.1: the default security reviewer\'s model)', () => {
  assert.equal(TABLE.models['anthropic/claude-fable-5.1'], undefined, 'premise: the routed table has no row for fable-5.1');
  assert.ok(TABLE.direct['anthropic/claude-fable-5-1'] > 0, 'premise: the direct table has one');
  assert.equal(CW.contextWindowOf(routed('anthropic/claude-fable-5.1')), TABLE.direct['anthropic/claude-fable-5-1']);
});
test('CW-2: a routed Claude model with neither row has no window, and is NAMED (a made-up model, and Haiku 4.5, which has no direct row)', () => {
  assert.equal(typeof CW.routedSeatsWithoutWindow, 'function', 'src/context-window.js exports routedSeatsWithoutWindow');
  assert.equal(TABLE.direct['anthropic/claude-made-up-9-9'], undefined);
  assert.equal(CW.contextWindowOf(routed('anthropic/claude-made-up-9.9')), null);
  const seats = [routed('anthropic/claude-made-up-9.9'), routed('anthropic/claude-made-up-9.9'), routed('anthropic/claude-fable-5.1'), routed('anthropic/claude-sonnet-5.5'), { provider: 'openrouter', model: 'qwen/qwen3.8-max-0902' }, { provider: 'anthropic', model: 'claude-made-up-9-9' }, { provider: 'mock', model: 'mock-builder' }, null];
  assert.deepEqual(CW.routedSeatsWithoutWindow(seats), ['anthropic/claude-made-up-9.9'], 'only a routed Claude seat with no window at all, each model once; a seat with a window, another lab\'s seat, a direct seat and a mock seat are not named');
  assert.deepEqual(CW.routedSeatsWithoutWindow([]), []);
  assert.deepEqual(CW.routedSeatsWithoutWindow(undefined), []);
});
test('CW-3: the line the start log and the dry run print names the model and says the final read does not check the window for that seat', () => {
  assert.equal(typeof CW.skippedRoomLines, 'function', 'src/context-window.js exports skippedRoomLines');
  const lines = CW.skippedRoomLines(['anthropic/claude-made-up-9.9', 'anthropic/claude-other-1.0']);
  assert.equal(lines.length, 2);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the line names the model and matches /room check is skipped/. NEW: the whole sentence by value, "No input window is known for <model>, so for that seat the final read does not check whether its prompt fits the window." WHY: skippedRoomLines (src/context-window.js:30), the resolved text of the row (RESOLVED_LIST).
  assert.equal(lines[0], 'No input window is known for anthropic/claude-made-up-9.9, so for that seat the final read does not check whether its prompt fits the window.');
  assert.equal(lines[1], 'No input window is known for anthropic/claude-other-1.0, so for that seat the final read does not check whether its prompt fits the window.');
  assert.deepEqual(CW.skippedRoomLines([]), [], 'nothing to say when every seat has a window');
});
test('CW-4: a routed model with a row of its own keeps it; a direct seat and another lab\'s seat read what they always read; no other model gets a fallback', () => {
  for (const [model, w] of Object.entries(TABLE.models).filter(([m]) => m.startsWith('anthropic/claude-'))) assert.equal(CW.contextWindowOf(routed(model)), w, `${model}: its own row`);
  assert.equal(CW.contextWindowOf({ provider: 'anthropic', model: 'claude-fable-5-1' }), TABLE.direct['anthropic/claude-fable-5-1'], 'a direct seat reads the direct table');
  const other = Object.keys(TABLE.models).find(m => !m.startsWith('anthropic/'));
  if (other) assert.equal(CW.contextWindowOf({ provider: 'openrouter', model: other }), TABLE.models[other], 'another lab\'s routed seat is unchanged');
  assert.equal(CW.contextWindowOf({ provider: 'openrouter', model: 'openai/gpt-made-up' }), null, 'a model of another lab with no row has none: the fallback is for a Claude model only');
  assert.equal(CW.contextWindowOf({ provider: 'openrouter', model: 'anthropic/not-a-claude-model-5.5' }), null, 'and for a model whose id begins "anthropic/claude-" only');
});
