// B3 prep, JUDGE milestone 2 (C&C: "the existing draft_end_marker switch applied to a stage the code forgot, not a new mechanism"): the FINAL READ's user prompt carries the same end-of-draft marker the panel verdicts carry, under the same condition
// (the chain's draft_end_marker switch and the held words of the start line, 0.8.4 D27; the notes lane no longer matters), from the same constant (R.DRAFT_END_MARKER: one source). Without the switch the final read's prompt is what it was. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { draftStartLine, draftBoundarySentence } from './held-prompts/held-084-d27.js';
import * as R from '../src/roles.js';
import { neverHeardChain } from './helpers/final-read-chain.js';

afterEach(() => { setPromptSpy(null); setCache(null); setBudget(null); setHeldForTest(null); });
const WORDS = { draftStartLine, draftBoundarySentence };
const HELD = { draftStartLine: undefined, draftBoundarySentence: undefined };   // hides the two D27 names whether or not src/roles.js records them
const finalReadPrompts = async extra => {
  const seen = []; setPromptSpy(({ label, user }) => { if (/^final-read-/.test(label)) seen.push({ label, user }); });
  await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-fr-marker', config: neverHeardChain('marker', { final_read: { enabled: true }, ...extra }) });
  return seen;
};

test('final read, boundary ON (the switch and both held words): the user prompt carries the end line straight after the draft, from the one constant, with or without the notes lane; the prompts of the panel carry it too', async () => {
  // CHANGED ACCEPTED (0.8.4 D27, 09 Nov 2026; C&C ruling). OLD: the final read carried the end line with the switch AND the notes lane. NEW: with the switch AND the two held words of the start line recorded (injected here); the notes lane is no part of the gate. WHY: his pick "Start + end lines, all chains"; the whole boundary arrives together at the release.
  setHeldForTest(WORDS);
  for (const extra of [{ reviewNotes: { enabled: true, perKind: 3 }, draft_end_marker: { enabled: true } }, { draft_end_marker: { enabled: true } }]) {
    const on = await finalReadPrompts(extra);
    assert.ok(on.length > 0, 'the final read ran (else this passes vacuously)');
    for (const p of on) { assert.equal(p.user.split(R.DRAFT_END_MARKER).length, 2, p.label); assert.ok(p.user.indexOf(R.DRAFT_END_MARKER) > p.user.indexOf('# Draft under review'), p.label); }
  }
});

test('final read, boundary OFF (no switch, or the words still held): no end line in the final read\'s prompt, as before', async () => {
  // CHANGED ACCEPTED (0.8.4 D27, 09 Nov 2026). OLD: the arms were no switch, the lane alone, and the switch alone. NEW: the same, plus the switch with the notes lane while the words are held (it used to send the line), and the words recorded without the switch. WHY: the gate is the switch AND the words.
  const arms = [[{}, WORDS], [{ reviewNotes: { enabled: true, perKind: 3 } }, WORDS], [{ draft_end_marker: { enabled: false } }, WORDS], [{ draft_end_marker: { enabled: true } }, HELD], [{ reviewNotes: { enabled: true, perKind: 3 }, draft_end_marker: { enabled: true } }, HELD]];
  for (const [extra, words] of arms) {
    setHeldForTest(words);
    const off = await finalReadPrompts(extra);
    assert.ok(off.length > 0);
    for (const p of off) assert.equal(p.user.includes(R.DRAFT_END_MARKER), false, JSON.stringify(extra));
  }
});
