// The five other layered planning chains name the Claude Code session as their conflict decider too (0.8.3 Job 4, 18 Okt 2026; owner: "A, yes", to C&C's question whether plan-mini, plan-mini-council-sol-session, plan-medium and the two China chains should get his
// session as conflict decider, "each conflict pauses the run until he answers in his session"). Config only: the decider's prompt is held, so the stage records `prompt_held` and calls nothing, and no printed figure moves.
// Pinned: the seat is byte-for-byte the one plan-high-council ships, and no tier chain seats external/claude-code-session on its PANEL (a decider that is also a judge would rule on its own objection).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = n => JSON.parse(readFileSync(join(root, 'chains', `${n}.json`), 'utf8'));
// The set follows the folders (C&C ruling 18 Okt 2026, item 6): a chain is a layered planning chain when it has critics and every critic carries a `layer`; a chain whose panel is all `mock` is a fixture (chains/mock-layered.json), not a shipped planning chain. A chain cut or added later changes this set by itself, and the README sentence must follow it. (A test, not a chain-lint rule, because the set must follow chains/*.json, not because lint would refuse a user's own chain.)
const isMock = c => c && c.provider === 'mock';
const LAYERED_ALL = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(n => {
  const k = load(n).seats?.critics || [];
  return k.length > 0 && k.every(c => c && c.layer !== undefined) && !k.every(isMock);
}).sort();
// CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026). Muad, 24 Okt 2026: "I think the decider should be the LLM that handles the run, not the model that is placed on one of the seats"; then "B sounds fine to me" on doctor's one-key line.
// OLD (lane B commit 2, which wrongly quoted "a NEW one-key chain for the quick start" as Muad's words; the chain was C&C's proposal and Muad gave his OK on 23 Okt 2026; his words of 24 Okt 2026: "no, it was you that asked for this new chain. I gave you my OK"):
// plan-default-opro-council was the one layered planning chain with NO Claude Code session in it, its decider a paid OpenRouter seat (TD-4 pinned that), and TD-1 to TD-3 exempted it. NEW: it names the session as its decider like every other layered planning chain (no exemption any more);
// doctor leaves an external seats.decider slot out of its one-key test, so the chain stays on the "one key" line (test/one-key-decider.test.js, test/first-ten-minutes.test.js).
const ONE_KEY = 'plan-default-opro-council';
const LAYERED = LAYERED_ALL;
const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

test('TD-1: every layered planning chain names the same external Claude Code session as its decider, and the file text of the seat is identical to plan-high-council\'s', () => {
  const ref = load('plan-high-council').seats.decider;
  assert.deepEqual(ref, { provider: 'external', model: 'claude-code-session' });
  // CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026). OLD: the reference text was lines 84-87 of plan-high-council.json (the tail of the seat before the decider plus the key line), which only fits a chain whose decider follows an external seat. NEW: the decider block itself, from its key line to its closing brace. WHY: plan-default-opro-council now names the session too and its decider follows the critics.
  const hi = readFileSync(join(root, 'chains', 'plan-high-council.json'), 'utf8'); const at = hi.indexOf('    "decider": {');
  const refText = hi.slice(at, hi.indexOf('    },', at) + '    },'.length);
  assert.equal(refText.split('\n').length, 4, 'the reference block is the four lines of the seat');
  assert.ok(LAYERED.includes('plan-high-council') && LAYERED.length > 1, 'the derived set is not empty (a gate that returns nothing is suspect)');
  for (const n of LAYERED) {
    assert.deepEqual(load(n).seats.decider, ref, `${n} names the session decider`);
    assert.ok(readFileSync(join(root, 'chains', `${n}.json`), 'utf8').includes(refText), `${n}: the decider block is byte-identical to the one in chains/plan-high-council.json`);
  }
});

test('TD-2: no layered planning chain seats external/claude-code-session on its panel (the decider would rule on its own objection)', () => {
  for (const n of LAYERED) assert.deepEqual((load(n).seats.critics || []).filter(c => c.provider === 'external' && c.model === 'claude-code-session'), [], `${n}: the session is not a judge`);
});

test('TD-3: the README sentence about the decider lists exactly the layered planning chains found in chains/*.json, and its number word matches', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const m = /The (\w+) layered planning chains \(([^)]*)\) name the Claude Code session as their decider/.exec(readme);
  assert.ok(m, 'the README sentence is there');
  const listed = [...m[2].matchAll(/`([^`]+)`/g)].map(x => x[1]).sort();
  assert.deepEqual(listed, LAYERED, 'the README lists exactly the derived set');
  assert.equal(NUMBER_WORDS[m[1]], LAYERED.length, 'the number word is the size of the set');
});

// CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026; Muad: "B sounds fine to me"). OLD TD-4: plan-default-opro-council has no external seat at all, and its decider is a paid OpenRouter seat (the exemption in TD-1 to TD-3 held only for that reason). NEW: its decider is the session seat, the
// same as every other layered planning chain, and it is the ONLY external seat in the chain, so one OpenRouter key still runs everything else. WHY: the decider is the session that handles the run, not a model placed on a seat; doctor's one-key line leaves the decider slot out (test/one-key-decider.test.js).
test('TD-4: plan-default-opro-council names the session as its decider, and every seat other than the decider is an OpenRouter seat (one key runs the rest of the chain)', () => {
  assert.ok(LAYERED_ALL.includes(ONE_KEY), 'the one-key chain is a layered planning chain');
  const c = load(ONE_KEY);
  assert.deepEqual(c.seats.decider, load('plan-high-council').seats.decider);
  const seats = [c.seats.criteria, c.seats.skeleton, c.seats.builder, c.seats.reviser, c.seats.handoff, ...c.seats.proposers, ...c.seats.critics];
  assert.deepEqual(seats.filter(s => s.provider !== 'openrouter').map(s => `${s.provider}/${s.model}`), [], 'every seat except the decider is an OpenRouter seat');
});

test('TD-5: plan-default-opro-council: every seat reasons at exactly "high", or carries no reasoning setting where the reasoning table says the model\'s own default is above high (Muad 23 Okt 2026: high for every seat, never lower)', () => {
  const table = JSON.parse(readFileSync(join(root, 'src', 'reasoning-table.json'), 'utf8')).models;
  const c = load(ONE_KEY);
  // CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026): the decider is left out of this list (it is the session seat, which has no table row and sends nothing); the rest is unchanged.
  const seats = [c.seats.criteria, c.seats.skeleton, c.seats.builder, c.seats.reviser, c.seats.handoff, ...c.seats.proposers, ...c.seats.critics];
  const bad = []; let sentNothing = 0;
  for (const s of seats) {
    const row = table[`${s.provider}/${s.model}`];
    if (!row) { bad.push(`${s.model}: no row in the reasoning table`); continue; }
    if (row.defaultAboveHigh) { if (s.extra !== undefined) bad.push(`${s.model}: its default is above high, so it is sent nothing, but extra is ${JSON.stringify(s.extra)}`); else sentNothing++; }
    else if (s.extra?.reasoning?.effort !== 'high') bad.push(`${s.model}: effort ${JSON.stringify(s.extra?.reasoning?.effort)}, expected "high"`);
  }
  assert.deepEqual(bad, []);
  assert.ok(sentNothing >= 2, `the check can fail the other way too: GLM-5.3 and GLM-5.3 Flash are the seats sent nothing (${sentNothing})`);
});
