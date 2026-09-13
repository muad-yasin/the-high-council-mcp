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
