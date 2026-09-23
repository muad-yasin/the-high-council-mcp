// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #1, #2).
//
// #1: normaliseCritique set `meets` from failures.length alone, so any reply that failed to NAME a
//     failure signed off - the "garbled or unheard counts as consent" incident class.
// #2: a non-array `failures` (or a null criteria row) threw inside reviewSeat; the reply is on disk
//     before it is parsed, so every resume replayed it and crashed again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseCritique, runChain, setCache, setBudget } from '../src/chain.js';

const signs = c => normaliseCritique(c).meets === true;

test('contract: an explicit meets:false never signs off, even when it names nothing', () => {
  const c = normaliseCritique({ meets: false, verdict_line: 'Fails criterion 2' });
  assert.equal(c.meets, false);
  assert.equal(c.unreadable, undefined);
  assert.equal(c.failures.length, 1, 'kept as an unlabelled objection the reviser can act on');
  assert.match(c.failures[0].problem, /Fails criterion 2/);
});

test('contract: a failure with a problem but no criterion key is an objection, not a placeholder', () => {
  const c = normaliseCritique({ meets: false, failures: [{ problem: 'x', fix: 'y' }] });
  assert.equal(c.meets, false);
  assert.equal(c.failures[0].problem, 'x');
});

test('contract: FAIL / NOT MET / UNMET table verdicts count as failures, not only the exact FAILED', () => {
  for (const verdict of ['FAIL', 'NOT MET', 'not_met', 'Unmet', 'failed']) {
    const c = normaliseCritique({ criteria: [{ criterion: 'C1', verdict, evidence: 'e' }] });
    assert.equal(c.meets, false, verdict);
    assert.equal(c.failures[0].criterion, 'C1', verdict);
  }
});

test('contract: replies that state no verdict are unreadable abstentions, never consent', () => {
  for (const reply of [
    {},                                          // nothing at all
    { blocking_question: 'Which OS?' },          // question-only reply
    { criterion: 'C1', verdict: 'MET' },         // a truncated array brace-sliced to its first row
    { note: 'a fenced snippet picked out of a prose objection' },
    { criteria: [{ criterion: 'C1', verdict: 'PARTIAL' }] },
    42, 'looks good', null, [], [{ meets: true }],
  ]) {
    const c = normaliseCritique(reply);
    assert.equal(c.meets, false, JSON.stringify(reply));
    assert.equal(c.unreadable, true, JSON.stringify(reply));
  }
});

test('contract: a non-array failures or null criteria rows never throw (#2)', () => {
  assert.doesNotThrow(() => normaliseCritique({ meets: false, failures: 'nope' }));
  assert.equal(normaliseCritique({ meets: false, failures: 'nope' }).unreadable, true);
  assert.equal(normaliseCritique({ meets: true, failures: { a: 1 } }).unreadable, true, 'meets:true does not rescue a malformed failures field');
  assert.doesNotThrow(() => normaliseCritique({ meets: false, criteria: [null, 3, { criterion: 'C', verdict: 'FAILED' }] }));
  assert.equal(normaliseCritique({ criteria: [null, { criterion: 'C', verdict: 'FAILED' }] }).failures[0].criterion, 'C');
});

test('contract: real sign-offs still sign off, including the 2026-09-07 Llama placeholder shape', () => {
  assert.ok(signs({ meets: true, failures: [] }));
  assert.ok(signs({ meets: true }));
  // Every criterion MET, meets:false, a placeholder failure because the array "had to" hold something.
  assert.ok(signs({ meets: false, failures: [{ criterion: 'None' }], criteria: [{ criterion: 'C1', verdict: 'MET' }, { criterion: 'C2', verdict: 'MET' }] }));
  assert.ok(signs({ criteria: [{ criterion: 'C1', verdict: 'met' }] }));
  // A named failure always wins over a meets:true.
  assert.equal(normaliseCritique({ meets: true, failures: [{ criterion: 'C1', problem: 'p' }] }).meets, false);
});

// End to end: the panel turns a no-verdict reply into an abstention (blocks unanimity), and a
// non-array `failures` replayed from disk on resume no longer crashes the run.
const panelChain = { name: 'contract', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'],
  seats: { reviser: { provider: 'mock', model: 'mock-builder' }, critics: [
    { provider: 'mock', model: 'mock-critic-a', lab: 'a' },
    { provider: 'mock', model: 'mock-critic-a', lab: 'b' },
  ] } };
const DRAFT = 'REVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.';

for (const [name, text] of [
  ['an explicit meets:false with no criterion', '{"meets":false,"verdict_line":"Fails criterion 2"}'],
  ['a question-only reply', '{"blocking_question":"Which OS?"}'],
  ['a non-array failures field (replayed from disk on resume)', '{"meets":false,"failures":"nope"}'],
]) {
  test(`panel: ${name} never signs off and never crashes the run`, async () => {
    setBudget(null);
    setCache({ get: label => /^panel-\d+-b/.test(label) ? { text, usage: { input: 1, output: 1 }, usd: 0 } : null });
    try {
      const r = await runChain({ request: 'Req.', config: panelChain, draft: DRAFT, log: () => {} });
      assert.equal(r.passed, false);
      assert.notEqual(r.signoff.find(s => s.provider === 'b').signedOff, true);
    } finally { setCache(null); }
  });
}
