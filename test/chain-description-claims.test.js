// 0.8.3 (GLM unit, C&C thcmcp-cd ruling 23 Okt 2026): a shipped chain's description says "No proposer's cap is below the most the harness will retry its model at, so a proposal cut off at its cap is not
// asked again with a bigger one". That is a claim about the CODE, and it rests on src/reasoning-table.json, which scripts/refresh-reasoning-table.mjs rewrites every release week: a row raised above a
// proposer's cap makes the sentence false with nothing red. So this test asserts the claim's TRUTH for every chain that carries it, from src (never typed numbers): the retry cap the proposal stage would use
// for a proposal cut off at the cap it was ASKED at (chain.js: min(seat cap, parts x proposals.maxTokens + 300), as proposal-ceiling.test.js's ceilingOf; retried with cutOffRetryCap(from, retryCeilingOf(seat)))
// equals that asked cap. Offline, $0.
// HIGH unit (23 Okt 2026, Muad: "High should be *our* default setting. Some models are so cheap that *their* default is Max effort, and we can go with that"): the same for the effort sentence (DC-5, DC-6) and for daily7-sub-a's caps half (DC-4's second marker).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retryCeilingOf, rowOf } from '../src/reasoning.js';
import { cutOffRetryCap, DEFAULT_MAX_TOKENS } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SENTENCE = "No proposer's cap is below the most the harness will retry its model at, so a proposal cut off at its cap is not asked again with a bigger one.";
const chains = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'))]);
const carrying = chains.filter(([, c]) => (c.description || '').includes(SENTENCE));
// chain.js (proposal stage, `if (config.proposals ...)`): the proposers are config.seats.proposers || config.seats.critics, and each call is asked
// capped = { ...seat, maxTokens: Math.min(seat.maxTokens ?? DEFAULT_MAX_TOKENS, parts x perPart + 300) }, parts = proposals.parts ?? 3, perPart = proposals.maxTokens ?? 1500.
const askedCap = (c, seat) => Math.min(seat.maxTokens ?? DEFAULT_MAX_TOKENS, (c.proposals.parts ?? 3) * (c.proposals.maxTokens ?? 1500) + 300);
const CAPS_PREFIX = 'Output caps are the largest reply the harness knows for each model:';
// daily7-sub-a says its caps half in one sentence of its own (the child chain has no caps list): the same truth is asserted for it.
const D7_CAPS = "Every API seat's cap is the largest reply the harness knows for its model";
const CAPS_MARKERS = [CAPS_PREFIX, D7_CAPS];
// The exception clause for a model whose table row is unknown (Muad 23 Okt 2026, 21:14: "unknown" where no lab publishes a limit; their seats keep his 128,000). The wording is lane D's MODEL-CAPS phrase.
const NO_LIMIT_CLAUSE = 'no published limit was found, so the seat cap is 128,000';
const NO_LIMIT_CAP = 128000;
const seatsOf = c => { const out = []; const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.provider && o.model) out.push(o); else Object.values(o).forEach(walk); } }; walk(c.seats); return out; };
const proposersOf = c => c.seats.proposers || c.seats.critics || [];

test('DC-1: the retry sentence is carried by at least one shipped chain (a ratchet: a test that iterates nothing proves nothing)', () => {
  assert.ok(carrying.length >= 1, 'no shipped chain carries the retry sentence');
});

test('DC-2: in every chain that carries the retry sentence, a cut-off proposal at each proposer\'s asked cap gets no bigger cap (derived from src/reasoning-table.json, not typed)', () => {
  const bad = [];
  for (const [file, c] of carrying) {
    assert.ok(c.proposals, `${file}: carries the retry sentence but has no proposal stage`);
    const proposers = proposersOf(c).filter(s => s.provider !== 'external');
    assert.ok(proposers.length > 0, `${file}: carries the sentence but names no proposer`);
    for (const seat of proposers) {
      const asked = askedCap(c, seat);
      const next = cutOffRetryCap(asked, retryCeilingOf(seat));
      if (next !== asked) bad.push(`${file}: ${seat.provider}/${seat.model} is asked ${asked} and would be retried at ${next} (retry ceiling ${retryCeilingOf(seat)})`);
    }
  }
  assert.deepEqual(bad, [], 'the sentence is false for:\n' + bad.join('\n'));
});

test('DC-3: the caps sentence is carried by at least one shipped chain (a ratchet)', () => {
  assert.ok(chains.some(([, c]) => (c.description || '').includes(CAPS_PREFIX)), 'no shipped chain carries the caps sentence');
});
// The effort sentence. HIGH unit (23 Okt 2026) it read "Every API seat reasons at high, or at the model's own default where that is higher (the harness sends these no effort setting: LIST)". CHANGED ACCEPTED TEST (2 Nov 2026,
// owner: "High for THC's chains, default to High on all chains, users can change it if they want to"): the sentence is now "Every API seat reasons at high" (daily7-sub-a: "and it reasons at high."), and its truth is the plain one:
// every API seat of the chain states exactly "high" in its file, with no exception for a model whose own default is above high. Nothing in it rests on the table's defaultAboveHigh any more.
// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 09 Nov 2026 21:51: xhigh for Qwen 3.8 27B). OLD: the sentence was "Every API seat reasons at high;" and nothing else. NEW: a chain that seats Qwen 3.8 27B says "Every API seat reasons at high, except Qwen 3.8 27B, which runs at xhigh because the model offers no high setting (the chain states xhigh for it);", and DC-6 holds it to that: every API seat states high except that one seat, which states xhigh. WHY: the model has no high setting (reasoning-table row), so the one exception is stated in the sentence and checked against the file.
const QWEN_SENTENCE = 'Every API seat reasons at high, except Qwen 3.8 27B, which runs at xhigh because the model offers no high setting (the chain states xhigh for it);';
const EFFORT_MARKERS = ['Every API seat reasons at high;', QWEN_SENTENCE, 'and it reasons at high.'];
const OLD_EFFORT_WORDS = ["or at the model's own default where that is higher", 'no effort setting', 'are sent nothing'];
const effortCarrying = chains.filter(([, c]) => EFFORT_MARKERS.some(m => (c.description || '').includes(m)));

test('DC-5: the effort sentence is carried by at least one shipped chain (a ratchet), and no shipped chain still carries the old wording', () => {
  // CHANGED (0.8.4 seats unit): OLD bar >= 7 (a typed count, after daily7-sub-a moved to chains/outdated/). NEW: every shipped chain whose description says it "reasons at high" carries one of the known sentences, and there is at least one; derived from the files, so the count moves with the chains.
  const saysHigh = chains.filter(([, c]) => /reasons at high/.test(c.description || '')).map(([f]) => f);
  assert.deepEqual(effortCarrying.map(([f]) => f).sort(), saysHigh.sort(), 'every description that speaks of the effort uses one of the checked sentences');
  assert.ok(effortCarrying.length >= 3, `the effort sentence is carried by ${effortCarrying.length} shipped chains`);
  const old = chains.filter(([, c]) => OLD_EFFORT_WORDS.some(w => (c.description || '').includes(w))).map(([f]) => f);
  assert.deepEqual(old, [], 'these descriptions still say some seats are sent no effort setting');
});

test('DC-6: in every chain that carries the effort sentence, every API seat states exactly "high" (no max, no xhigh, no seat left to the model\'s own default), except the one Qwen 3.8 27B seat that the sentence names, which states xhigh', () => {
  const bad = [];
  for (const [file, c] of effortCarrying) {
    for (const seat of seatsOf(c).filter(s => s.provider !== 'mock' && s.provider !== 'external')) {
      const eff = seat.extra?.reasoning?.effort;
      const form = rowOf(seat)?.form;
      const want = (c.description || '').includes(QWEN_SENTENCE) && seat.model === 'qwen/qwen3.8-27b' ? 'xhigh' : 'high';   // CHANGED (0.8.4 seats unit): the one exception the sentence names
      if (form === 'openrouter-effort' && eff !== want) bad.push(`${file}: ${seat.provider}/${seat.model} states ${eff ?? 'no effort'}, not ${want}`);
      if (eff !== undefined && eff !== want) bad.push(`${file}: ${seat.provider}/${seat.model} states ${eff}`);
    }
  }
  assert.deepEqual(bad, [], 'the effort sentence is false for:\n' + bad.join('\n'));
});

test('DC-4: in every chain that carries the caps sentence, each paid seat\'s cap IS the table\'s number for its model; a seat whose row is unknown sits at the 128,000 its description names (derived from src/reasoning-table.json)', () => {
  const bad = [];
  for (const [file, c] of chains.filter(([, x]) => CAPS_MARKERS.some(m => (x.description || '').includes(m)))) {
    for (const seat of seatsOf(c).filter(s => s.provider !== 'external' && s.provider !== 'mock')) {
      const row = rowOf(seat);
      if (typeof row?.maxOutput === 'number') {
        if (seat.maxTokens !== row.maxOutput) bad.push(`${file}: ${seat.provider}/${seat.model} has cap ${seat.maxTokens}, the table says ${row.maxOutput}`);
      } else if (!row || row.maxOutput !== null || seat.maxTokens !== NO_LIMIT_CAP || !c.description.includes(NO_LIMIT_CLAUSE)) {
        bad.push(`${file}: ${seat.provider}/${seat.model} ${row ? 'has a null table figure' : 'has NO table row'}, so its cap must be ${NO_LIMIT_CAP} and the description must say "${NO_LIMIT_CLAUSE}" (cap ${seat.maxTokens})`);
      }
    }
  }
  assert.deepEqual(bad, [], 'the caps sentence is false for:\n' + bad.join('\n'));
});
