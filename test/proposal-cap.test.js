// test/proposal-cap.test.js
//
// v5 §1 candidate 10: debate-size shaping via an opt-in max_proposals_per_seat
// cap. His call, 2026-09-13: no default - a chain that never sets the field
// behaves exactly as before. Only a chain that does set it, and only a seat
// whose own returned list still exceeds it, pays for one merge prompt to
// fold its own proposals down before the board ever sees the extras.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockDebate = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));

test('test_proposal_cap_merge: a seat returning 4 proposals is folded to 2 when the chain sets the cap', async () => {
  const config = {
    ...mockDebate,
    proposals: { ...mockDebate.proposals, parts: 4, maxProposalsPerSeat: 2 },
    seats: {
      ...mockDebate.seats,
      proposers: [
        { provider: 'mock', model: 'mock-proposer-quad', lab: 'mock-a' },
        { provider: 'mock', model: 'mock-proposer-b', lab: 'mock-b' },
      ],
    },
  };
  const result = await runChain({ request: 'Do the thing.', config, log: () => {} });

  const fromA = result.proposals.filter(p => p.lab === 'mock-a');
  assert.equal(fromA.length, 2, 'the over-cap seat must be folded down to exactly 2 proposals on the board');

  // The merge stage itself must be on record in the run's stages, under a
  // label a run folder can write to disk like any other stage.
  const mergeStage = result.stages.find(s => s.label === 'propose-mock-a-merge');
  assert.ok(mergeStage, 'expected one merge-stage transcript for the over-cap seat');
});

test('test_proposal_cap_merge: no cap set (the default) leaves an over-length seat untouched', async () => {
  const config = {
    ...mockDebate,
    proposals: { ...mockDebate.proposals, parts: 4 },
    seats: {
      ...mockDebate.seats,
      proposers: [
        { provider: 'mock', model: 'mock-proposer-quad', lab: 'mock-a' },
        { provider: 'mock', model: 'mock-proposer-b', lab: 'mock-b' },
      ],
    },
  };
  const result = await runChain({ request: 'Do the thing.', config, log: () => {} });

  const fromA = result.proposals.filter(p => p.lab === 'mock-a');
  assert.equal(fromA.length, 4, 'with no cap set, an existing chain must behave exactly as it did before this candidate existed');
  assert.ok(!result.stages.some(s => s.label === 'propose-mock-a-merge'), 'no merge prompt should run when no cap is set');
});

test('test_proposal_cap_merge: a seat already at or under the cap is never sent a merge prompt', async () => {
  const config = {
    ...mockDebate,
    proposals: { ...mockDebate.proposals, parts: 4, maxProposalsPerSeat: 5 },
  };
  const result = await runChain({ request: 'Do the thing.', config, log: () => {} });
  assert.ok(!result.stages.some(s => s.label.endsWith('-merge')), 'a seat under the cap must not pay for a merge prompt');
});

test('test_proposal_cap_merge: a non-positive or non-integer cap is ignored, not treated as a valid (footgun) cap', async () => {
  const config = {
    ...mockDebate,
    proposals: { ...mockDebate.proposals, parts: 4, maxProposalsPerSeat: -1 },
    seats: {
      ...mockDebate.seats,
      proposers: [
        { provider: 'mock', model: 'mock-proposer-quad', lab: 'mock-a' },
        { provider: 'mock', model: 'mock-proposer-b', lab: 'mock-b' },
      ],
    },
  };
  const result = await runChain({ request: 'Do the thing.', config, log: () => {} });
  const fromA = result.proposals.filter(p => p.lab === 'mock-a');
  assert.equal(fromA.length, 4, 'a negative cap must be ignored, not slice from the end of the list');
  assert.ok(!result.stages.some(s => s.label === 'propose-mock-a-merge'));
});

// 0.8.3 (C&C ruling, 13 Oct 2026): README.md and docs/index.html document a TOP-LEVEL `max_proposals_per_seat`, but chain.js read only `proposals.maxProposalsPerSeat`, so the documented
// key was silently ignored. The code now reads the documented key; the nested spelling keeps working; a chain that sets both to different values is refused (it would run one cap and
// look like the other).
const quadConfig = extra => ({
  ...mockDebate,
  ...extra,
  proposals: { ...mockDebate.proposals, parts: 4, ...(extra?.proposals || {}) },
  seats: {
    ...mockDebate.seats,
    proposers: [
      { provider: 'mock', model: 'mock-proposer-quad', lab: 'mock-a' },
      { provider: 'mock', model: 'mock-proposer-b', lab: 'mock-b' },
    ],
  },
});

test('max_proposals_per_seat (the documented top-level key) folds an over-cap seat', async () => {
  const result = await runChain({ request: 'Do the thing.', config: quadConfig({ max_proposals_per_seat: 2 }), log: () => {} });
  assert.equal(result.proposals.filter(p => p.lab === 'mock-a').length, 2, 'the documented top-level key must set the cap');
  assert.ok(result.stages.some(s => s.label === 'propose-mock-a-merge'));
});

test('max_proposals_per_seat: the same value under both spellings is one cap, not a conflict', async () => {
  const result = await runChain({ request: 'Do the thing.', config: quadConfig({ max_proposals_per_seat: 2, proposals: { maxProposalsPerSeat: 2 } }), log: () => {} });
  assert.equal(result.proposals.filter(p => p.lab === 'mock-a').length, 2);
});

test('max_proposals_per_seat: two different values under the two spellings are refused before any stage runs', async () => {
  const stages = [];
  await assert.rejects(
    runChain({ request: 'Do the thing.', config: quadConfig({ max_proposals_per_seat: 2, proposals: { maxProposalsPerSeat: 3 } }), log: () => {}, onStage: s => stages.push(s) }),
    err => /max_proposals_per_seat/.test(err.message) && /proposals\.maxProposalsPerSeat/.test(err.message) && /2/.test(err.message) && /3/.test(err.message),
  );
  assert.deepEqual(stages, [], 'refused before anything ran');
});

test('max_proposals_per_seat: chain-lint (council doctor) names the same conflict, with the fix', () => {
  const findings = lintChain(quadConfig({ max_proposals_per_seat: 2, proposals: { maxProposalsPerSeat: 3 } }), 'chains/x.json');
  const f = findings.find(x => x.kind === 'proposal-cap-conflict');
  assert.ok(f, JSON.stringify(findings.map(x => x.kind)));
  assert.match(f.message, /max_proposals_per_seat/);
  assert.match(f.fix, /chains\/x\.json/);
  assert.equal(lintChain(quadConfig({ max_proposals_per_seat: 2, proposals: { maxProposalsPerSeat: 2 } }), 'chains/x.json').some(x => x.kind === 'proposal-cap-conflict'), false);
});

// 0.8.3 (C&C ruling, 13 Oct 2026): the DOCUMENTED top-level key must be a whole number of 1 or more; any other value would be ignored and the chain would run with no cap. The nested camelCase key
// keeps its older, pinned "ignored" behaviour (the -1 test above), so it is not flagged.
test('max_proposals_per_seat: chain-lint refuses a top-level value that is not a whole number of 1 or more', () => {
  for (const bad of [0, -1, 1.5, '2', true, null]) {
    const f = lintChain(quadConfig({ max_proposals_per_seat: bad }), 'chains/x.json').find(x => x.kind === 'proposal-cap-invalid');
    assert.ok(f, `${JSON.stringify(bad)} must be refused`);
    assert.match(f.message, /max_proposals_per_seat/);
    assert.match(f.fix, /chains\/x\.json/);
  }
  assert.equal(lintChain(quadConfig({ max_proposals_per_seat: 2 }), 'chains/x.json').some(x => x.kind === 'proposal-cap-invalid'), false);
  assert.equal(lintChain(quadConfig({}), 'chains/x.json').some(x => x.kind === 'proposal-cap-invalid'), false, 'absent is the default: no cap');
  assert.equal(lintChain(quadConfig({ proposals: { maxProposalsPerSeat: -1 } }), 'chains/x.json').some(x => x.kind === 'proposal-cap-invalid'), false, 'the nested key keeps its pinned ignored behaviour');
});
