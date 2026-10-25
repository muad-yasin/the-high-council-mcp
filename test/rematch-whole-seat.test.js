// CR-MX-001 (25 Okt 2026): a rematch rotates WHOLE seats. It used to rotate provider/model/extra/lab only, so a seat's baseUrl and maxTokens stayed with the SLOT: in a mixed chain an OpenRouter seat could land in the slot of a
// local server and its key went there. Layers are rules, so a layered array rotates within each layer (the old whole-array rotation put one model twice on a layer on 9 of 30 seeds of plan-china-high-council and the chain was refused).
// Offline, $0: the pure function is called directly; the one send test stubs globalThis.fetch and records EVERY url and Authorization header, so no request can leave the machine. Keys are placeholder literals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reshuffleSeats, rematchDestinationProblems, RematchRefused } from '../src/rematch.js';
import { duplicateLabSlots, resolveChainSeats, runSingleStage, setBudget, setCache } from '../src/chain.js';
import { repeatedLabsOf } from '../src/seat-key.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => resolveChainSeats(JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8')));
const SLOT = ['layer', 'lane', 'role'];
const LISTS = ['proposers', 'critics', 'alternatives'];
const LAYERED = ['plan-china-high-council', 'plan-claude-council', 'plan-high-council', 'plan-medium-council'];
const withoutSlot = s => { const o = { ...s }; for (const f of [...SLOT, 'lab']) delete o[f]; return o; };

test('RW-1 (property, seeds 1..60, the four shipped layered chains): whole seats travel, slot fields stay, each layer keeps its models, one lab one label across every list, and no seed is refused', () => {
  for (const name of LAYERED) {
    const cfg = chain(name);
    for (let seed = 1; seed <= 60; seed++) {
      const out = reshuffleSeats(cfg, seed);
      const relabel = new Map();   // original lab -> new label, across EVERY list
      const back = new Map();      // new label -> original lab
      for (const key of LISTS) {
        const before = cfg.seats[key]; const after = out.seats[key];
        if (!Array.isArray(before)) continue;
        assert.equal(after.length, before.length, `${name} ${key} seed ${seed}`);
        after.forEach((seat, i) => {
          const slot = before[i];
          for (const f of SLOT) assert.deepEqual(seat[f], slot[f], `${name} ${key}[${i}] ${f} stays with the slot (seed ${seed})`);
          // which original seat is this? the one whose travelling fields match; its extra is BYTE-identical (reasoning is never changed by a rematch)
          const origin = before.filter(o => JSON.stringify(withoutSlot(o)) === JSON.stringify(withoutSlot(seat)));
          assert.ok(origin.length >= 1, `${name} ${key}[${i}] is one of the original seats, whole (seed ${seed})`);
          const o = origin[0];
          assert.equal(JSON.stringify(seat.extra), JSON.stringify(o.extra), 'extra byte-identical');
          const lab = o.lab || o.provider;
          if (relabel.has(lab)) assert.equal(relabel.get(lab), seat.lab, `${name}: one lab, one label (${lab}, seed ${seed})`); else relabel.set(lab, seat.lab);
          if (back.has(seat.lab)) assert.equal(back.get(seat.lab), lab, `${name}: two labs never share a label (${seat.lab}, seed ${seed})`); else back.set(seat.lab, lab);
        });
        // every layer holds the same multiset of models as before
        const byLayer = list => { const m = new Map(); for (const s of list) { const k = s.layer ?? 0; m.set(k, [...(m.get(k) ?? []), `${s.provider}/${s.model}`].sort()); } return [...m].sort(); };
        assert.deepEqual(byLayer(after), byLayer(before), `${name} ${key}: the same models on each layer (seed ${seed})`);
      }
      assert.deepEqual(duplicateLabSlots(out), [], `${name} seed ${seed}: the runChain refusal "two seats share a lab" cannot fire`);
      assert.ok(repeatedLabsOf(out.seats.critics).every(r => r.keys), `${name} seed ${seed}: every model repeated across layers keeps its seat key`);
    }
  }
});

test('RW-2: an array where only SOME seats have a layer is refused, naming the list; arrays with no layer rotate as one group and every seat still moves', () => {
  const mixed = { seats: { critics: [{ provider: 'mock', model: 'a', lab: 'a', layer: 1 }, { provider: 'mock', model: 'b', lab: 'b' }] } };
  assert.throws(() => reshuffleSeats(mixed, 3), e => e instanceof RematchRefused && /seats\.critics: some seats have a whole-number "layer" and some do not/.test(e.message));
  const flat = reshuffleSeats({ seats: { critics: ['a', 'b', 'c'].map(m => ({ provider: 'mock', model: m, lab: m, maxTokens: 100 + m.charCodeAt(0) })) } }, 2);
  assert.deepEqual(flat.seats.critics.map(s => s.model).sort(), ['a', 'b', 'c']);
  assert.ok(flat.seats.critics.every((s, i) => s.model !== ['a', 'b', 'c'][i]), 'a derangement, as before');
  assert.ok(flat.seats.critics.every(s => s.maxTokens === 100 + s.model.charCodeAt(0)), 'maxTokens travels with its model');
});

test('RW-3 (receiving end, in-process): in a mixed chain no request that carries the OpenRouter key goes to the local server\'s address, however the seats are rotated', async () => {
  const LOCAL = 'http://127.0.0.1:41999/v1';
  const seats = [
    { provider: 'ollama', model: 'llama-local', lab: 'local', baseUrl: LOCAL, maxTokens: 300 },
    { provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'orx', maxTokens: 500 },
  ];
  const seen = [];
  const had = { k: process.env.OPENROUTER_API_KEY, o: process.env.OLLAMA_API_KEY }; const original = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = 'sk-or-v1-placeholder-not-a-key'; delete process.env.OLLAMA_API_KEY;
  globalThis.fetch = async (url, opts) => { seen.push({ url: String(url), auth: opts?.headers?.authorization ?? opts?.headers?.Authorization ?? null }); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    setCache(null); setBudget(null);
    for (const seed of [1, 2, 3]) {
      const out = reshuffleSeats({ seats: { critics: seats } }, seed);
      for (const seat of out.seats.critics) await runSingleStage(seat, { system: 's', user: 'u', label: `rw3-${seed}-${seat.lab}` });
    }
    assert.ok(seen.length >= 6, 'both seats were called for each seed');
    const leaked = seen.filter(r => r.url.startsWith('http://127.0.0.1:41999') && r.auth && /sk-or-v1/.test(r.auth));
    assert.deepEqual(leaked, [], 'the OpenRouter key never reached the local server\'s address');
    assert.ok(seen.filter(r => r.auth && /sk-or-v1/.test(r.auth)).every(r => new URL(r.url).hostname === 'openrouter.ai'), 'every request that carried the key went to openrouter.ai (stubbed)');
  } finally {
    globalThis.fetch = original;
    if (had.k === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had.k;
    if (had.o !== undefined) process.env.OLLAMA_API_KEY = had.o;
  }
});

test('RW-4 (the check as a seam, defence in depth): a seat that would send its key to another host, or a denied model, is named with its reason; a clean seat list gives nothing', () => {
  const ok = [{ provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'a' }, { provider: 'ollama', model: 'llama-local', lab: 'b', baseUrl: 'http://127.0.0.1:41999/v1' }];
  assert.deepEqual(rematchDestinationProblems(ok, {}), []);
  const bad = rematchDestinationProblems([{ provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'a', baseUrl: 'https://api.openai.com/v1' }], {});
  assert.equal(bad.length, 1); assert.match(bad[0].seat, /^a \(openrouter\/qwen\/qwen3\.7-plus\)$/); assert.match(bad[0].reasons[0], /api\.openai\.com.*not openrouter's own API host/);
  const denied = rematchDestinationProblems([{ provider: 'openrouter', model: 'x-ai/grok-9', lab: 'g' }], {});
  assert.ok(denied.length === 1 && denied[0].reasons.length >= 1, 'a denied model is named');
});
