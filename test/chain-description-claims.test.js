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
// The effort sentence (HIGH unit): "Every API seat reasons at high, or at the model's own default where that is higher (the harness sends these no effort setting: LIST)". Its truth rests on the table's
// defaultAboveHigh / defaultEffort, which scripts/refresh-reasoning-table.mjs rewrites: a refresh that flips a row makes the list, or the seats, false with nothing else red.
const EFFORT_MARKER = "or at the model's own default where that is higher";
const effortCarrying = chains.filter(([, c]) => (c.description || '').includes(EFFORT_MARKER));
const DISPLAY = { 'z-ai/glm-5.3': 'GLM-5.3', 'z-ai/glm-5.3-flash': 'GLM-5.3 Flash', 'qwen/qwen3.8-max-0902': 'Qwen 3.8 Max' };   // a defaultAboveHigh model seated here without a name stops the test: add it, and the generator's NAME map
const RANK = { minimal: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
const listJoin = a => a.length <= 1 ? a.join('') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;
const sentNothingText = c => {
  const groups = {};
  for (const seat of seatsOf(c).filter(s => s.provider !== 'external' && s.provider !== 'mock')) {
    const row = rowOf(seat);
    if (!row?.defaultAboveHigh) continue;
    assert.ok(DISPLAY[seat.model], `${seat.model} has defaultAboveHigh but no display name in this test (and the generator): add it`);
    (groups[row.defaultEffort] ??= new Set()).add(DISPLAY[seat.model]);
  }
  return Object.keys(groups).sort((a, b) => RANK[b] - RANK[a]).map(e => `${listJoin([...groups[e]].sort())} at ${e}`).join(', ');
};

test('DC-5: the effort sentence is carried by at least one shipped chain (a ratchet)', () => {
  assert.ok(effortCarrying.length >= 1, 'no shipped chain carries the effort sentence');
});

test('DC-6: in every chain that carries the effort sentence, no seat states max or xhigh, an API seat states high or (on a model whose own default is above high) nothing, and the sentence names exactly the models that are sent no effort setting, each with the table\'s default', () => {
  const bad = [];
  for (const [file, c] of effortCarrying) {
    for (const seat of seatsOf(c).filter(s => s.provider !== 'mock')) {
      const eff = seat.extra?.reasoning?.effort;
      if (eff !== undefined && eff !== 'high') bad.push(`${file}: ${seat.provider}/${seat.model} states ${eff}`);
      if (seat.provider === 'external') continue;
      const row = rowOf(seat);
      if (row?.defaultAboveHigh) { if (seat.extra?.reasoning !== undefined) bad.push(`${file}: ${seat.provider}/${seat.model} is sent an effort although its own default (${row.defaultEffort}) is above high`); }
      else if (eff !== 'high') bad.push(`${file}: ${seat.provider}/${seat.model} states ${eff ?? 'no effort'}, not high`);
    }
    const text = sentNothingText(c);
    if (!text) bad.push(`${file}: the sentence lists models sent no effort setting, but no seat is on a model whose own default is above high`);
    else if (!c.description.includes(`no effort setting: ${text})`)) bad.push(`${file}: the list should read "${text}"`);
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
