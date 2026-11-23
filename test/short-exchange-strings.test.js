// 0.8.4 S6 (M1), U6-2b: the sentences a person reads about an objection that climbed FLAGGED (the exchange had not debated it) name the layer that left it not debated, which can now be a layer above the lowest (the shortened exchange). The record carries `layer` on the
// flagged entry only when it is not the lowest, so every existing report and every printed byte is what it was. Offline, pure, $0. WRITTEN WITHOUT A RUN (overnight, no box). Not covered: the run-log line of chain.js (a log, no row).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ESC from '../src/escalation.js';
import * as SHAPE from '../src/report-shape.js';

const row = layer => ({ round: 2, pass: 3, from_layer: 2, to_layer: 3, trigger: 'stall', ids: ['O-aaaaaaaa'], labs: ['alpha'], not_debated: [{ id: 'O-aaaaaaaa', lab: 'alpha', next: 'debated_after_send_back', ...(layer ? { layer } : {}) }], rulings: [], outcome: [] });
const asText = x => (Array.isArray(x) ? x.join('\n') : String(x));
const block = layer => asText(ESC.escalatedSignoffBlock({ end: { pass: 3, layer: 3, below: [2] }, escalations: [row(layer)] }));
const board = layer => asText(SHAPE.renderEscalationsBoard([row(layer)]));

test('PIN (held bytes): a flagged entry with no `layer` prints exactly the layer-1 sentences it always printed, in the escalated sign-off block and on the board. Limit: green on the old source by design', () => {
  assert.ok(block(undefined).includes("- O-aaaaaaaa (raised by alpha, layer 2): passed up to layer 3 in round 3, but layer 1's exchange had not debated it, so it was not ruled on. Layer 1 debated it in a later pass, after the plan was sent back."), block(undefined));
  assert.ok(board(undefined).includes("- O-aaaaaaaa (alpha): stood unchanged up to pass 2, passed up to layer 3, but layer 1's exchange had not debated it, so layer 3 was not asked to rule on it. Layer 1 debated it in a later pass, after the plan was sent back."), board(undefined));
});

test('a flagged entry whose `layer` is 2 names layer 2 in the sign-off block, on the board and in the "what became of it" words; the other three words are unchanged', () => {
  assert.ok(block(2).includes("- O-aaaaaaaa (raised by alpha, layer 2): passed up to layer 3 in round 3, but layer 2's exchange had not debated it, so it was not ruled on. Layer 2 debated it in a later pass, after the plan was sent back."), block(2));
  assert.ok(board(2).includes("but layer 2's exchange had not debated it, so layer 3 was not asked to rule on it. Layer 2 debated it in a later pass, after the plan was sent back."), board(2));
  assert.equal(ESC.notDebatedNextWords({ next: 'debated_after_send_back', layer: 2 }), 'Layer 2 debated it in a later pass, after the plan was sent back.');
  assert.equal(ESC.notDebatedNextWords({ next: 'debated_after_send_back', layer: 1 }), ESC.NOT_DEBATED_NEXT_WORDS.debated_after_send_back);
  for (const next of ['withdrawn', 'standing_dissent', 'pending']) assert.equal(ESC.notDebatedNextWords({ next, layer: 2 }), ESC.NOT_DEBATED_NEXT_WORDS[next], next);
  assert.equal(ESC.notDebatedNextWords({ next: 'unknown' }), '');
});
