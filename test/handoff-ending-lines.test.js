// 0.8.4 D29 / T2.5 (T3.3 entry 7; WORDING U3-w31, held name `handoffEndingLines` in test/held-prompts/held-084-a.js): after a run that did not agree, the handoff seat is told at the top of its user prompt how the run ended and which Status values it may not write.
// HELD: nothing is added until src/roles.js records the name, and an agreed run, a `council handoff --from-run` and the dry run's estimate (no `ending`) are told nothing. No re-record of a recorded prompt. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setHeldForTest } from '../src/held-roles.js';
import { handoffPrompt } from '../src/handoff-prompt.js';
import { runChain, setPromptSpy } from '../src/chain.js';
import { readChainFile } from './helpers/chain-file.js';
import { handoffEndingLines } from './held-prompts/held-084-a.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => readChainFile(root, name);
const NOT = { word: 'round_cap', reason: 'finished with open objections', agreed: false };
const base = { request: 'R', draft: 'D', checks: '', criteria: ['a', 'b'] };
const CONFIGS = [{ name: 'plain' }, { name: 'ms', handoff_contract: { milestones: true } }];

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: EL-1 and the 'nothing added while it is not recorded' halves of EL-3 pinned the HELD state (handoffEndingLines not recorded). NEW: those are REMOVED (K7): handoffEndingLines is recorded in every shipped run. Sibling: EL-2 (an agreed run and a call with no ending add nothing; a run that did not agree puts the lines before the seat's own user prompt) and the 'on' half of EL-3 (the seat's own prompt follows the lines; the signed-off run is told nothing). WHY: handoffEndingLines recorded (src/prompts/recorded-084-a.js).
// REMOVED (K7): EL-1 'nothing recorded: the prompts are byte-identical with and without an ending, in both forms'.

test('EL-2 recorded: a run that did not agree puts the lines, a blank line and then the seat\'s own user prompt; the system prompt is untouched; an agreed run and a call with no ending add nothing', () => {
  for (const config of CONFIGS) {
    const plain = handoffPrompt({ config, ...base });
    setHeldForTest({ handoffEndingLines });
    const told = handoffPrompt({ config, ...base, ending: NOT });
    assert.equal(told.user, `${handoffEndingLines(NOT)}\n\n${plain.user}`);
    assert.equal(told.system, plain.system);
    // REMOVED (0.8.4 apply, ROUND2 ASTRA-ii then A7-prompt-agreed): the assert that matched the ending line's words ("The run behind this plan ended ... The panel did not agree on this plan and nobody has accepted it as it stands, so do not write Status ...") read the held function of test/held-prompts/held-084-a.js, which is test data, not the product: the line above already proves what the harness does (the function's output, a blank line, then the seat's own prompt), and test/held-prompts-084-a.test.js compares the held words with the recorded ones.
    assert.deepEqual(handoffPrompt({ config, ...base, ending: { ...NOT, agreed: true } }), plain, 'agreed: told nothing');
    assert.deepEqual(handoffPrompt({ config, ...base }), plain, 'no ending (from-run, the estimate): told nothing');
    setHeldForTest(null);
  }
});

const handoffUserOf = async (config, held) => {
  setHeldForTest(held);
  const seen = [];
  setPromptSpy(({ label, user }) => { if (label === 'handoff') seen.push(user); });
  await runChain({ config, request: 'A mock task.', log: () => {} });
  return seen;
};
test('EL-3 through a real run: the handoff stage of a run that stalled is told how it ended, and one that signed off is not', async () => {
  const stalled = { ...chain('mock-dispute'), handoff: true };
  const signed = { ...chain('mock-unanimous'), handoff: true, dispute: { enabled: true, stall_rounds: 2 } };
  const on = await handoffUserOf(stalled, { handoffEndingLines });
  assert.equal(on.length, 1);
  assert.match(on[0], /^The run behind this plan ended "stalled" \(finished with open objections\)\./);
  const ok = await handoffUserOf(signed, { handoffEndingLines });
  assert.equal(ok.length, 1); assert.doesNotMatch(ok[0], /The run behind this plan ended/);
});
