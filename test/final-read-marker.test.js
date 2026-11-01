// B3 prep, JUDGE milestone 2 (C&C: "the existing draft_end_marker switch applied to a stage the code forgot, not a new mechanism"): the FINAL READ's user prompt carries the same end-of-draft marker the panel verdicts carry, under the same condition
// (the chain's draft_end_marker switch and the notes lane), from the same constant (R.DRAFT_END_MARKER: one source). Without the switch the final read's prompt is what it was. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import * as R from '../src/roles.js';
import { neverHeardChain } from './helpers/final-read-chain.js';

afterEach(() => { setPromptSpy(null); setCache(null); setBudget(null); });
const finalReadPrompts = async extra => {
  const seen = []; setPromptSpy(({ label, user }) => { if (/^final-read-/.test(label)) seen.push({ label, user }); });
  await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-fr-marker', config: neverHeardChain('marker', { final_read: { enabled: true }, ...extra }) });
  return seen;
};

test('final read, marker switch ON (with the notes lane): the user prompt carries the marker straight after the draft, from the one constant; the prompts of the panel carry it too', async () => {
  const on = await finalReadPrompts({ reviewNotes: { enabled: true, perKind: 3 }, draft_end_marker: { enabled: true } });
  assert.ok(on.length > 0, 'the final read ran (else this passes vacuously)');
  for (const p of on) { assert.equal(p.user.split(R.DRAFT_END_MARKER).length, 2, p.label); assert.ok(p.user.indexOf(R.DRAFT_END_MARKER) > p.user.indexOf('# Draft under review'), p.label); }
});

test('final read, marker switch OFF (and notes lane only): no marker in the final read\'s prompt, as before', async () => {
  for (const extra of [{}, { reviewNotes: { enabled: true, perKind: 3 } }, { draft_end_marker: { enabled: true } }]) {
    const off = await finalReadPrompts(extra);
    assert.ok(off.length > 0);
    for (const p of off) assert.equal(p.user.includes(R.DRAFT_END_MARKER), false, JSON.stringify(extra));
  }
});
