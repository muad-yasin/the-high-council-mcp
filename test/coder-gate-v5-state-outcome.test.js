// MLLM Coder v5 items 1 and 3's chain.js touch points (relay/runs/2026-09-15T03-43-44-216Z/
// deliverable.md). Item 1's own outcome logic is unit-tested directly in test/outcome.test.js;
// this file proves chain.js's two progressHook touch points fire with the real, already-parsed
// data the plan specifies - src/cli.js's state.json writer (test/run-state.test.js covers its
// pure classification logic) is a thin consumer of exactly these events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain, setProgressHook } from '../src/chain.js';
import { parseRoundFromLabel, classifyStageCompletion, classifyVerdictEvent } from '../src/run-state.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockDebateConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));

test('touch point 1: every real paid call fires a start event with {label, lab, startedAt} before its result exists', async () => {
  const seen = [];
  setProgressHook(e => seen.push(e));
  try {
    await runChain({ request: 'A well-formed task.', config: mockDebateConfig, log: () => {} });
  } finally {
    setProgressHook(null);
  }
  const starts = seen.filter(e => e.startedAt);
  assert.ok(starts.length > 0, 'expected at least one start event');
  for (const s of starts) {
    assert.equal(typeof s.label, 'string');
    assert.equal(typeof s.lab, 'string');
    assert.equal(typeof s.startedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(s.startedAt)));
  }
  // criteria/skeleton/propose-*/debate-* stages all go out for real in this chain.
  assert.ok(starts.some(s => s.label === 'criteria'));
  assert.ok(starts.some(s => /^propose-/.test(s.label)));
});

test('touch point 2: a critique/panel stage fires a verdict event carrying the already-computed `passed` boolean', async () => {
  const seen = [];
  setProgressHook(e => seen.push(e));
  let result;
  try {
    result = await runChain({ request: 'A well-formed task.', config: mockDebateConfig, log: () => {} });
  } finally {
    setProgressHook(null);
  }
  const verdictEvents = seen.filter(e => !e.startedAt && e.passed !== undefined);
  assert.ok(verdictEvents.length > 0, 'expected at least one verdict event');
  // Round goes 1 -> 2 on this two-round mock chain (round 1 fails, round 2 passes).
  const rounds = new Set(verdictEvents.map(e => parseRoundFromLabel(e.label)).filter(r => r !== null));
  assert.ok(rounds.has(1) && rounds.has(2), `expected rounds 1 and 2, got ${[...rounds]}`);
  // At least one seat's verdict is a real sign-off by the end.
  assert.ok(verdictEvents.some(e => e.passed === true));
  assert.equal(result.passed, true);
});

test('touch point 2: a reply stage fires a verdict event carrying already-counted decisions', async () => {
  const seen = [];
  setProgressHook(e => seen.push(e));
  try {
    await runChain({ request: 'A well-formed task.', config: mockDebateConfig, log: () => {} });
  } finally {
    setProgressHook(null);
  }
  const replyEvents = seen.filter(e => !e.startedAt && e.decisions);
  assert.ok(replyEvents.length > 0, 'expected at least one reply verdict event');
  for (const e of replyEvents) {
    assert.equal(typeof e.decisions.keep, 'number');
    assert.equal(typeof e.decisions.amend, 'number');
    assert.equal(typeof e.decisions.withdraw, 'number');
  }
});

test('a mock-provider-error critic fires a dropped verdict event, never an objected one for that lab', async () => {
  const config = {
    ...mockDebateConfig,
    signoff: 'unanimous',
    proposals: undefined,
    debate: false,
    seats: {
      ...mockDebateConfig.seats,
      critics: [{ provider: 'mock', model: 'mock-provider-error', lab: 'broken-lab' }],
    },
  };
  const seen = [];
  setProgressHook(e => seen.push(e));
  try {
    await runChain({ request: 'x', config, log: () => {} });
  } finally {
    setProgressHook(null);
  }
  const brokenEvents = seen.filter(e => e.lab === 'broken-lab' && !e.startedAt);
  assert.ok(brokenEvents.length > 0, 'expected at least one verdict event for the broken lab');
  assert.ok(brokenEvents.every(e => classifyVerdictEvent(e) === 'dropped'), 'a provider-error critic must classify as dropped, never objected/signed');
});

test('no progress hook installed (the default, and every caller other than the CLI): chain.js behaves exactly as before, no crash', async () => {
  setProgressHook(null);
  const result = await runChain({ request: 'A well-formed task.', config: mockDebateConfig, log: () => {} });
  assert.equal(result.passed, true);
});

test('propose-/debate- stage labels classify as posted generically (no verdict event needed)', () => {
  assert.equal(classifyStageCompletion('propose-mock-a'), 'posted');
  assert.equal(classifyStageCompletion('debate-mock-a'), 'posted');
});
