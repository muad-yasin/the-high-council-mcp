// Astra Part 2 D.2 / C&C order of 20 Okt: the BOARD footer must say only what the record holds. (The stop screen, conflict-decider.js:113-115, reaches a model through run_status, so its new wording stays held: see the paste.) The code records that the judge was ASKED in a pass and did not list the objection, and that the writer REVISED
// while the other-layer objections stood; it records nothing about an objection being "fixed". A-DRAFT wording (the stop screen and the BOARD footer).
import test from 'node:test';
import assert from 'node:assert/strict';

test('CW-1: the BOARD footer says "revised the plan in response to" and "was asked ... did not list it", never "fixed" or "let it go", for two and for three objections', async () => {
  const { renderDecisionsBoard } = await import('../src/report-shape.js');
  const row = (ids, labs, layers) => ({ pass: 3, ids, labs, layers, silent_round: 2, decided: false, why: 'person_asked' });
  const two = renderDecisionsBoard([row(['N-aaaa1111', 'N-bbbb2222'], ['alpha', 'beta'], [1, 2])]);
  const three = renderDecisionsBoard([row(['N-aaaa1111', 'N-bbbb2222', 'N-cccc3333'], ['alpha', 'beta', 'gamma'], [1, 2, 3])]);
  for (const [name, text] of [['two', two], ['three', three]]) {
    assert.ok(!/was fixed|let it go|asked and let/.test(text), `${name}: no "fixed" and no "let it go"`);
    assert.match(text, /N-aaaa1111 \(alpha, layer 1\) came back in pass 3, after the writer revised the plan in response to N-bbbb2222 \(beta, layer 2\)/);
  }
  assert.match(three, /in response to N-bbbb2222 \(beta, layer 2\), N-cccc3333 \(gamma, layer 3\)\. The judge that raised N-aaaa1111 was asked in pass 2 and did not list it; /);
  assert.match(two, /An objection from a judge of one layer came back after the writer revised the plan in response to an objection from another layer\./);
});
