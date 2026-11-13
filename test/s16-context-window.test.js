// 0.8.4 S16 (H; Muad 09 Nov 2026): the input window W per OpenRouter model (src/context-windows.json) and the room rule (a part's whole prompt at chars/4 plus the seat's cap fits in HALF of W).
// The table is data written by scripts/refresh-context-windows.mjs; these tests read it and the shipped chains, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { contextWindowOf, fitsHalfWindow } from '../src/context-window.js';

const chainsDir = new URL('../chains/', import.meta.url);
const shippedOpenRouter = () => {
  const out = new Set();
  const walk = x => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x.provider === 'openrouter' && typeof x.model === 'string') out.add(x.model); Object.values(x).forEach(walk); } };
  for (const f of readdirSync(chainsDir).filter(n => n.endsWith('.json'))) walk(JSON.parse(readFileSync(new URL(f, chainsDir), 'utf8')).seats ?? {});
  return [...out];
};
const table = JSON.parse(readFileSync(new URL('../src/context-windows.json', import.meta.url), 'utf8'));

test('the table names a window for every OpenRouter model a shipped chain seats, each a whole number of tokens, dated', () => {
  assert.equal(table.schema, 'context-windows/1');
  assert.match(table.asOf, /^\d{4}-\d{2}-\d{2}$/);
  for (const id of shippedOpenRouter()) assert.ok(Number.isInteger(table.models[id]) && table.models[id] >= 65536, `${id} has a window`);
  assert.deepEqual(Object.keys(table.models), Object.keys(table.models).slice().sort(), 'sorted, so a refresh makes a small diff');
});

test('no fail-open on a shipped chain: every top-layer seat of every shipped layered chain that is not an external (session) seat has a window row, derived from the chain files', () => {
  let checked = 0;
  for (const f of readdirSync(chainsDir).filter(n => n.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(new URL(f, chainsDir), 'utf8'));
    const critics = c.seats?.critics;
    if (!Array.isArray(critics) || !critics.length || !critics.every(x => x.layer !== undefined) || c.signoff !== 'unanimous') continue;
    const top = Math.max(...critics.map(x => x.layer));
    for (const seat of critics.filter(x => x.layer === top && x.provider !== 'external' && x.provider !== 'mock')) { checked += 1; assert.ok(contextWindowOf(seat) !== null, `${f}: top-layer seat ${seat.provider}/${seat.model} has a window row`); }
  }
  assert.ok(checked > 0, 'premise: at least one shipped layered chain has a top-layer API seat');
  assert.equal(contextWindowOf({ provider: 'anthropic', model: 'claude-fable-5-1' }), 1000000);
});

test('contextWindowOf: an OpenRouter seat of the table has its window (the smallest host\'s); any other seat, and a model not in the table, has none (no room check)', () => {
  assert.equal(contextWindowOf({ provider: 'openrouter', model: 'tencent/hy4-preview' }), 262144, 'the tightest shipped host route');
  assert.equal(contextWindowOf({ provider: 'openrouter', model: 'no/such-model' }), null);
  assert.equal(contextWindowOf({ provider: 'external', model: 'subscription:fable-5.1' }), null);
  assert.equal(contextWindowOf({ provider: 'anthropic', model: 'tencent/hy4-preview' }), null, 'the direct table is keyed by the direct model');
  assert.equal(contextWindowOf(undefined), null);
});

test('the room rule: prompt tokens (chars/4, the harness\'s estimator) plus the cap sent must fit in half of W; at the tightest shipped route (W 262144, cap 64000) the prompt may be 67072 tokens', () => {
  const W = 262144, cap = 64000, half = Math.floor(W / 2);
  assert.equal(half - cap, 67072);
  assert.equal(fitsHalfWindow(W, 67072 * 4, cap), true, 'exactly half');
  assert.equal(fitsHalfWindow(W, 67072 * 4 + 1, cap), false, 'one token over (ceil of chars/4)');
  assert.equal(fitsHalfWindow(null, 10, 10), false, 'no window: the caller makes no room check, this is not asked');
});
