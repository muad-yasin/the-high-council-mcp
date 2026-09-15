// V6-2 (relay/runs/2026-09-15T15-13-25-950Z/deliverable.md) - unit tests against src/spans.js's
// pure functions, per this repo's own convention of testing an extracted pure module directly
// (test/outcome.test.js does the same). test/spans-cli.test.js covers the full CLI wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveParentSpanId, roundSpanIdFor, recordRoundStageAndCheckClose, replaySpanStateFromStageLogText, sumRoundUsdFromStageLogText } from '../src/spans.js';

function idGen() {
  let n = 0;
  return () => `id-${n++}`;
}

test('1. a panel stage resolves its parent to the enclosing round span, created lazily on first reference', () => {
  const roundSpanIds = new Map();
  const gen = idGen();
  const parent = resolveParentSpanId('panel-1-lab-a', 'root', roundSpanIds, gen);
  assert.equal(parent, 'id-0');
  assert.equal(roundSpanIds.get(1), 'id-0');
});

test('2. a second stage in the same round reuses the same round span id, not a new one', () => {
  const roundSpanIds = new Map();
  const gen = idGen();
  const first = resolveParentSpanId('panel-1-lab-a', 'root', roundSpanIds, gen);
  const second = resolveParentSpanId('panel-1-lab-b', 'root', roundSpanIds, gen);
  assert.equal(first, second);
});

test('3. a critique stage also resolves to a round span (both panel and critique nest under a round)', () => {
  const roundSpanIds = new Map();
  const gen = idGen();
  const parent = resolveParentSpanId('critique-2', 'root', roundSpanIds, gen);
  assert.equal(roundSpanIds.get(2), parent);
});

test('4. every non-panel, non-critique stage resolves to the run root, never a round span', () => {
  const roundSpanIds = new Map();
  const gen = idGen();
  for (const label of ['criteria', 'skeleton', 'propose-lab-a', 'debate-lab-a', 'reply-lab-a', 'build', 'revise-1', 'handoff', 'final', 'allocator-1']) {
    assert.equal(resolveParentSpanId(label, 'root', roundSpanIds, gen), 'root', label);
  }
  assert.equal(roundSpanIds.size, 0, 'no round spans should have been created');
});

test('5. roundSpanIdFor is idempotent for the same round', () => {
  const roundSpanIds = new Map();
  const gen = idGen();
  assert.equal(roundSpanIdFor(3, roundSpanIds, gen), roundSpanIdFor(3, roundSpanIds, gen));
});

test('6. recordRoundStageAndCheckClose only closes once the count reaches criticsCount, and only once', () => {
  const counts = new Map();
  assert.equal(recordRoundStageAndCheckClose('panel-1-lab-a', counts, 2), null);
  assert.equal(recordRoundStageAndCheckClose('panel-1-lab-b', counts, 2), 1);
});

test('7. recordRoundStageAndCheckClose returns null for a non-round-stage label (build, handoff, ...)', () => {
  const counts = new Map();
  assert.equal(recordRoundStageAndCheckClose('build', counts, 2), null);
  assert.equal(counts.size, 0);
});

test('8. recordRoundStageAndCheckClose never closes when criticsCount is 0 (a chain with no critics seat)', () => {
  const counts = new Map();
  assert.equal(recordRoundStageAndCheckClose('panel-1-lab-a', counts, 0), null);
});

test('9. two rounds are tracked independently - round 1 closing does not affect round 2s count', () => {
  const counts = new Map();
  recordRoundStageAndCheckClose('panel-1-lab-a', counts, 2);
  recordRoundStageAndCheckClose('panel-1-lab-b', counts, 2);
  assert.equal(recordRoundStageAndCheckClose('panel-2-lab-a', counts, 2), null);
});

test('10. replaySpanStateFromStageLogText rebuilds round span ids from a partially-completed round, so resume closes it correctly', () => {
  const text = [
    JSON.stringify({ stage: 'panel-1-lab-a', lab: 'lab-a', usd: 0.01, span_id: 's1', parent_span_id: 'round-1-id' }),
  ].join('\n');
  const { roundSpanIds, roundPanelCounts } = replaySpanStateFromStageLogText(text);
  assert.equal(roundSpanIds.get(1), 'round-1-id');
  assert.equal(roundPanelCounts.get(1), 1);
});

test('11. replaySpanStateFromStageLogText ignores kind:"round" lines and unparseable lines', () => {
  const text = [
    JSON.stringify({ kind: 'round', round: 1, span_id: 'r1', seats: [], spentUsd: 0 }),
    'not json{{{',
    JSON.stringify({ stage: 'panel-2-lab-a', lab: 'lab-a', usd: 0, span_id: 's2', parent_span_id: 'round-2-id' }),
  ].join('\n');
  const { roundSpanIds, roundPanelCounts } = replaySpanStateFromStageLogText(text);
  assert.equal(roundPanelCounts.get(1), undefined);
  assert.equal(roundSpanIds.get(2), 'round-2-id');
});

test('12. sumRoundUsdFromStageLogText sums only that round\'s panel/critique lines, skipping other rounds and kind:"round" lines', () => {
  const text = [
    JSON.stringify({ stage: 'panel-1-lab-a', usd: 0.01 }),
    JSON.stringify({ stage: 'panel-1-lab-b', usd: 0.02 }),
    JSON.stringify({ kind: 'round', round: 1, spentUsd: 0.03 }),
    JSON.stringify({ stage: 'panel-2-lab-a', usd: 0.05 }),
    JSON.stringify({ stage: 'build', usd: 0.10 }),
  ].join('\n');
  assert.equal(sumRoundUsdFromStageLogText(text, 1), 0.03);
  assert.equal(sumRoundUsdFromStageLogText(text, 2), 0.05);
});

test('13. sumRoundUsdFromStageLogText tolerates a truncated last line and unparseable lines', () => {
  const text = `${JSON.stringify({ stage: 'panel-1-lab-a', usd: 0.01 })}\n{"stage":"panel-1-lab-b","usd":0.0`;
  assert.equal(sumRoundUsdFromStageLogText(text, 1), 0.01);
});
