// test/roles.test.js
//
// Prompts are the product as much as the code is (see CLAUDE.md: prompt changes
// belong in src/roles.js, never inline in chain.js). A prompt cannot be tested
// by running it offline - the mock provider ignores prompt text by design - so
// what is pinned here is that a deliberate instruction has not been silently
// dropped by a later edit.
//
// Added 2026-09-11. A run produced a build plan with acceptance tests for nine
// items, invented from nothing, while five review agents and a test suite sat
// unused in the same working tree - because nothing ever told the handoff seat
// they existed. The "Available tools" convention closes that. Its whole value
// is the restraint: name what is listed, never invent, and say so plainly when
// nothing is listed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HANDOFF_SYSTEM, proposerUser } from '../src/roles.js';

test('the handoff seat is told to use the tools a task lists', () => {
  assert.match(HANDOFF_SYSTEM, /Available tools/,
    'the handoff prompt must name the section it reads tools from');
  assert.match(HANDOFF_SYSTEM, /exact name as listed/,
    'a tool named loosely is a tool the build session cannot find');
});

test('the handoff seat is forbidden from inventing tools or command lines', () => {
  // The prompt is a wrapped template literal, so line breaks land mid-sentence.
  assert.match(HANDOFF_SYSTEM, /[Nn]ever name a\s+tool that is not in that section/,
    'a hallucinated tool sends a build session looking for something that does not exist');
  assert.match(HANDOFF_SYSTEM, /never invent a command line/,
    'the council is told what exists, not how it is invoked - it cannot know the latter');
});

test('a task with no tools section still gets a usable handoff', () => {
  assert.match(HANDOFF_SYSTEM, /no such\s+section/,
    'the convention is optional; omitting it must not degrade the handoff into guesswork');
});

// v1 context partitioning (config.proposals.partition, opt-in - see chain.js). A slice is a
// per-seat instruction layered on top of the identical request/criteria/skeleton every proposer
// already gets. Regression-safety comes first: no `slice` argument must reproduce today's exact
// output, or every chain that never sets `partition` silently changes behavior underneath it.
test('proposerUser: no slice argument produces byte-for-byte the same prompt as before partitioning existed', () => {
  const args = { request: 'Do the thing.', criteria: ['One.', 'Two.'], skeleton: 'A skeleton.', parts: 3 };
  const withoutSliceArg = proposerUser(args);
  const withExplicitUndefined = proposerUser({ ...args, slice: undefined });
  const withNullSlice = proposerUser({ ...args, slice: null });
  const expected = '# Request\n\nDo the thing.\n\n# Acceptance criteria\n\n1. One.\n2. Two.\n\n# Skeleton of the plan\n\nA skeleton.\n\n# Your allowance\n\nAt most 3 proposals.';
  assert.equal(withoutSliceArg, expected);
  assert.equal(withExplicitUndefined, expected);
  assert.equal(withNullSlice, expected);
});

test('proposerUser: a slice is appended as an additional instruction, never replacing the shared material', () => {
  const args = { request: 'Do the thing.', criteria: ['One.'], skeleton: 'A skeleton.', parts: 2 };
  const base = proposerUser(args);
  const sliced = proposerUser({ ...args, slice: 'Focus on the config schema.' });
  assert.ok(sliced.startsWith(base), 'the shared request/criteria/skeleton must still be present, unchanged, at the start');
  assert.match(sliced, /Focus on the config schema\./);
  assert.match(sliced, /Per-seat focus instruction/);
});
