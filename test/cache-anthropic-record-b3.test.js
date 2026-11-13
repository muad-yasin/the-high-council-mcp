// 0.8.4 cache part a: the direct-Anthropic record cannot drift while the OpenRouter side is added. Each case is ONE REAL usage object of the B3 debate (run 2026-11-02T09-33-06-532Z, harness commit 4665462a) with the dollar figure the harness recorded
// for it; costOf must reproduce that figure from the usage object and the shipped price row (anthropic Haiku 5.5 0.5 / 2.5, Sonnet 5.5 2 / 10, Opus 5.5 4 / 20 per Mtok, the same rows B3 priced with). All 334 of B3's direct-Anthropic figures reproduce
// to the cent under this formula (checked off-line, 09 Nov 2026); these are one per shape. NAMED PINS: they pass on the parent tree; FAIL CONDITION: costOf prices a direct-Anthropic call, marked or not, differently from the figure recorded.
// Offline, $0. Written without a run (no tests on the laptop).
import test from 'node:test';
import assert from 'node:assert/strict';
import { costOf } from '../src/cost.js';

const CASES = [
  ['Haiku, a round-2 call that WROTE the entry (1h)', 'claude-haiku-5-5', { input: 2001, output: 1576, thinking: 1230, cacheAsked: '1h', cacheRead: 0, cacheWrite: 245070, cacheWrite1h: 245070, stop: 'end_turn' }, 0.2500105],
  ['Haiku, a round-3 call that READ it', 'claude-haiku-5-5', { input: 2998, output: 1003, thinking: 671, cacheAsked: '1h', cacheRead: 245070, cacheWrite: 0, cacheWrite1h: 0, stop: 'end_turn' }, 0.01626],
  ['Haiku, an unmarked round-1 call', 'claude-haiku-5-5', { input: 247373, output: 5104, thinking: 4008, stop: 'end_turn' }, 0.1364465],
  ['Opus, an unmarked layer-3 exchange call', 'claude-opus-5-5', { input: 247626, output: 2059, thinking: 1370, stop: 'end_turn' }, 1.031684],
  ['Sonnet, an unmarked panel call', 'claude-sonnet-5-5', { input: 250510, output: 16339, thinking: 7945, stop: 'end_turn' }, 0.66441],
];

for (const [name, model, usage, recorded] of CASES) {
  test(`B3 record (NAMED PIN): ${name}: costOf gives the recorded figure ${recorded}`, () => {
    const got = costOf('anthropic', model, usage);
    assert.equal(got.priced, true);
    assert.ok(Math.abs(got.usd - recorded) < 1e-6, `${got.usd} vs recorded ${recorded}`);
  });
}
