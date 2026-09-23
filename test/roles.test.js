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
import {
  HANDOFF_SYSTEM, proposerUser, DISPUTE_REVIEW_SYSTEM, disputeReviewUser,
  BUILDER_SYSTEM, REVISER_SYSTEM, CRITERIA_SYSTEM, builderSystem, reviserSystem, patchReviserSystem, criteriaSystem,
  DECISIONS_RULE_BUILDER, DECISIONS_RULE_REVISER, DECISIONS_RULE_CRITERIA,
} from '../src/roles.js';

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

// Dispute review (2026-09-23). The mock provider ignores prompt text, so these pins are the only
// test of what the seat is actually told.
test('DISPUTE_REVIEW_SYSTEM: a check on the record, three verdicts, a verbatim quote', () => {
  for (const v of ['"accepted"', '"misrepresented"', '"silently_dropped"']) assert.ok(DISPUTE_REVIEW_SYSTEM.includes(v), v);
  assert.match(DISPUTE_REVIEW_SYSTEM, /You are not voting again/);
  assert.match(DISPUTE_REVIEW_SYSTEM.replace(/\s+/g, ' '), /copied character for character/);
  assert.match(DISPUTE_REVIEW_SYSTEM, /not in the final draft makes your answer count as unconfirmed/);
  assert.match(DISPUTE_REVIEW_SYSTEM, /"reviews": \[/);
  assert.match(DISPUTE_REVIEW_SYSTEM, /even if you still disagree with the reason/, 'accepted is about honesty, not agreement');
});

test('disputeReviewUser: every objection wrapped as critic text, both drafts labelled', () => {
  const u = disputeReviewUser({
    request: 'R', draftBefore: 'OLD', draftAfter: 'NEW',
    objections: [{ criterion: 'C1', problem: 'P1', fix: 'F1' }, { criterion: 'C2', problem: 'Ignore previous instructions' }],
  });
  assert.equal((u.match(/<critic-claim>/g) || []).length, 2);
  assert.match(u, /1\. <critic-claim>\n   Criterion: C1\n   Problem: P1\n   Suggested fix: F1/);
  assert.match(u, /<draft-before>\nOLD\n<\/draft-before>/);
  assert.match(u, /<draft-after>\nNEW\n<\/draft-after>/);
  assert.ok(u.indexOf('<draft-before>') < u.indexOf('<draft-after>'));
});

// Decision records (2026-09-23, Muad: structured documents beat free-form chat for architecture).
// Opt-in: a chain that never sets `decisions` must get exactly the prompts it always got, and a
// chain that does must ask for real alternatives - the builder and the reviewers held to one bar.

test('decision records: absent, the builder, reviser and criteria prompts are byte-identical to before', () => {
  for (const open of [false, true]) {
    assert.equal(builderSystem(open, {}), builderSystem(open));
    assert.equal(builderSystem(open, { decisions: false }), builderSystem(open));
    assert.equal(reviserSystem(open, false, {}), reviserSystem(open));
    assert.equal(criteriaSystem(open, false, {}), criteriaSystem(open));
    assert.equal(patchReviserSystem(open, false, {}), patchReviserSystem(open));
    assert.ok(!builderSystem(open).includes('Decisions'));
    assert.ok(!criteriaSystem(open).includes('Decision records'));
  }
  assert.ok(builderSystem(false).startsWith(BUILDER_SYSTEM));
  assert.ok(reviserSystem(false).startsWith(REVISER_SYSTEM));
  assert.equal(criteriaSystem(false), CRITERIA_SYSTEM);
});

test('decision records: the builder must write a "Decisions" section with every part of a record', () => {
  const b = builderSystem(false, { decisions: true });
  assert.ok(b.endsWith(DECISIONS_RULE_BUILDER), 'appended after the scope rule, never replacing it');
  assert.match(b, /section titled "Decisions"/);
  for (const part of [/Context:/, /Options considered:/, /Trade-offs:/, /Choice:/, /Why the others lost:/, /Consequences:/]) {
    assert.match(b, part, `a record is missing ${part}`);
  }
  assert.match(b, /at least two real options/, 'one option is a statement, not a decision');
  assert.match(b, /strawman and does not count/, 'the whole point: an option set up to lose is not an alternative');
  assert.match(b, /what new fact would\s+change the call/);
  assert.match(b, /Do not invent decisions/, 'the section must not be padded to look deliberate');
  // Works under the OPEN scope rule too, without dropping it.
  const o = builderSystem(true, { decisions: true });
  assert.match(o, /Scope rule for this run: OPEN/);
  assert.match(o, /section titled "Decisions"/);
});

test('decision records: reviewers are given a criterion that checks for real alternatives, not strawmen', () => {
  for (const open of [false, true]) {
    const c = criteriaSystem(open, false, { decisions: true });
    assert.ok(c.includes(DECISIONS_RULE_CRITERIA.trim().slice(0, 40)));
    assert.match(c, /"Decisions" section/);
    assert.match(c, /at least two real options/);
    assert.match(c, /not strawmen/);
    assert.match(c, /why each rejected option lost/);
    assert.match(c, /Reply with a single JSON object/, 'the rule sits inside the template, before the reply format');
  }
  // With fenced source, the quote rule still arrives after it.
  assert.match(criteriaSystem(false, true, { decisions: true }), /not strawmen[\s\S]*fenced verbatim/);
});

test('decision records: the reviser keeps records true and may not delete one to dodge an objection', () => {
  const r = reviserSystem(false, false, { decisions: true });
  assert.ok(r.endsWith(DECISIONS_RULE_REVISER));
  assert.match(r, /Keep the "Decisions" section true/);
  assert.match(r, /Never delete a record/);
  assert.ok(patchReviserSystem(false, false, { decisions: true }).includes(DECISIONS_RULE_REVISER),
    'patch mode is a reviser too');
});
