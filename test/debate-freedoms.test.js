// test/debate-freedoms.test.js
//
// v7 item 4 (debate freedoms, scoped): two rights only, both gated on a chain's own opt-in
// `freedoms` key so a chain that never sets it gets exactly today's behavior. Novelty-based
// stopping, seconding, and question-challenging are explicitly out of scope for this item - see
// relay/runs/2026-09-14T00-20-44-997Z/deliverable.md §4.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain } from '../src/chain.js';

const seat = (model, lab) => ({ provider: 'mock', model, lab });

const config = (critics, freedoms) => ({
  name: 'test-freedoms', maxRounds: 2, stopOnPass: true, signoff: 'unanimous',
  freedoms,
  seats: {
    criteria: seat('mock-criteria'), builder: seat('mock-builder'),
    reviser: seat('mock-builder'), critics,
  },
});

const run = (critics, freedoms) => runChain({
  request: 'A test request.', config: config(critics, freedoms), log: () => {},
});

test('a blocking question pauses the round and resumes once the proposer answers', async () => {
  const result = await run(
    [seat('mock-critic-blocking', 'mock-a'), seat('mock-critic-a', 'mock-b')],
    { blocking_questions: true },
  );

  // mock-critic-blocking asks a question on its first reply, then signs off once the prompt
  // carries the answer back - so with a second, always-agreeing critic the panel is unanimous.
  assert.equal(result.passed, true, 'the panel should reach unanimous sign-off once the blocking question is answered');
  const asked = result.signoff.find(s => s.provider === 'mock-a');
  assert.equal(asked.signedOff, true, 'the seat that asked a blocking question still records a real verdict once answered');
});

test('blocking_question is ignored when the freedom is not enabled', async () => {
  // Without the flag, chain.js never reads parsed.blocking_question, so the mock's question-only
  // reply falls straight into normaliseCritique. It states no verdict, so it is an abstention that
  // blocks unanimity - never a sign-off, and never a pause. Tightened 2026-09-23
  // (Review/BugAudit_ChainParsers_2026-09-23.md #1): the old `notEqual(null)` assertion was also
  // satisfied by `true`, and a question-only reply was in fact signing off (audit repro t7.mjs).
  const result = await run(
    [seat('mock-critic-blocking', 'mock-a'), seat('mock-critic-a', 'mock-b')],
    undefined,
  );
  const asked = result.signoff.find(s => s.provider === 'mock-a');
  assert.notEqual(asked.signedOff, true, 'a question-only reply is never a sign-off');
  assert.equal(result.passed, false, 'a seat that stated no verdict blocks unanimity');
});

test('a pass is recorded with its reason, and does not count as a sign-off or an objection', async () => {
  const result = await run(
    [seat('mock-critic-passer', 'mock-a'), seat('mock-critic-a', 'mock-b')],
    { pass: true },
  );

  const passed = result.signoff.find(s => s.provider === 'mock-a');
  assert.equal(passed.passed, true);
  assert.ok(passed.passReason, 'a pass carries its stated reason');
  assert.equal(passed.signedOff, null, 'a pass is not a sign-off');
  assert.equal(passed.objections, null, 'a pass is not an objection either');

  // A passed seat does not block unanimity, same as an abstention - the panel still reaches
  // sign-off once the remaining voting seats agree.
  const other = result.signoff.find(s => s.provider === 'mock-b');
  assert.equal(other.signedOff, true);
});

test('existing tests pass unchanged with the freedoms key absent', async () => {
  const result = await run(
    [seat('mock-critic-a', 'mock-a'), seat('mock-critic-b', 'mock-b')],
    undefined,
  );
  assert.equal(result.passed, true);
  for (const s of result.signoff) {
    assert.equal(s.passed, false);
    assert.equal(s.passReason, null);
  }
});
