// Muad, 2026-09-26: "Kimi K3 is not excluded completely from being used, it was just removed from
// our own chain configs." A user may seat Kimi/Moonshot in a chain of their own (src/denied-models.js
// no longer refuses it), but no chain this package ships may name one, in any seat or extra field.
//
// CHANGED ACCEPTED TEST (0.8.4, the plan-the-high-council chain). OLD bar: no shipped chain names a Kimi/Moonshot model, anywhere. NEW bar: the same, with ONE exemption that names
// the chain file and the exact model: chains/plan-the-high-council.json may seat moonshotai/kimi-k3.1-pro (one proposer, lab "kimi-k3.1-pro"), and nothing else of Kimi or Moonshot
// (no other model, no other lab, no other field of that seat, no other seat) anywhere in it. WHY: the owner, 30 Okt 2026 00:24, on the new roster: "we can give them a new chance with
// kimi k3.1 pro. I hear it is strong". His earlier exclusion keeps its scope: K3 and every other Kimi model stay out of every shipped chain, and K3.1 Pro stays out of every other chain.
// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 00:58 and 01:56). OLD bar: the exemption is one chain, plan-the-high-council, which seated K3.1 Pro as a proposer. NEW bar: the same exemption (the exact model and lab, nothing else of Kimi or Moonshot) applies to three chains: plan-the-high-council and its twin plan-high-council (K3.1 Pro keeps only its judge seat, layer 2) and plan-china-high-council (a proposer and the layer-3 judge). WHY: the owner's roster headings for those chains; K3 and every other Kimi model stay out of every shipped chain, and K3.1 Pro stays out of every other chain.
// (An earlier commit on this branch deleted this file; that deletion was passed when it was made, and this narrowed test replaces it by the review ruling of 4 Nov 2026.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deniedReasonsOf } from '../src/denied-models.js';
import { everyChainFile } from './helpers/chain-file.js';

const chainsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'chains');

// the one exemption: a chain's path under the package root -> the one seat that may name Kimi
const KIMI_SEAT = { provider: 'openrouter', model: 'moonshotai/kimi-k3.1-pro', lab: 'kimi-k3.1-pro' };
const EXEMPT = { 'chains/plan-the-high-council.json': KIMI_SEAT, 'chains/plan-high-council.json': KIMI_SEAT, 'chains/plan-china-high-council.json': KIMI_SEAT };

/** The seats of a chain file that name Kimi/Moonshot, minus the one exempt seat's own model and lab values. Pure: a function of the path and the parsed chain. */
export function kimiProblems(rel, cfg) {
  const ok = EXEMPT[rel];
  const out = [];
  for (const s of Object.values(cfg.seats || {}).flat()) {
    if (!s || typeof s !== 'object') continue;
    const exempt = ok && s.provider === ok.provider && s.model === ok.model;
    const text = JSON.stringify(exempt ? { ...s, model: undefined, lab: s.lab === ok.lab ? undefined : s.lab } : s);
    if (/kimi|moonshot/i.test(text)) out.push(`${rel}: ${s.provider}/${s.model} (lab ${s.lab})`);
  }
  return out;
}

test('no shipped chain seats a Kimi/Moonshot model except moonshotai/kimi-k3.1-pro in plan-the-high-council, plan-high-council and plan-china-high-council (the retired ones in chains/outdated/ are scanned too: the ruling of 18 Okt 2026; the exemption: 30 Okt 2026)', () => {
  const hits = [];
  for (const { file: f, dir, path } of everyChainFile(join(chainsDir, '..'))) {
    hits.push(...kimiProblems(`${dir.replaceAll('\\', '/')}/${f}`, JSON.parse(readFileSync(path, 'utf8'))));
  }
  assert.deepEqual(hits, []);
});

test('the exemption is narrow and can fail: K3.1 Pro on any other shipped chain, another Kimi model on the exempt chain, a second Kimi field on the exempt seat and a second Kimi seat are each caught', () => {
  const base = JSON.parse(readFileSync(join(chainsDir, 'plan-the-high-council.json'), 'utf8'));
  const rel = 'chains/plan-the-high-council.json';
  assert.deepEqual(kimiProblems(rel, base), [], 'the chain as shipped is clean');
  const kimi = c => c.seats.critics.find(s => s.model === 'moonshotai/kimi-k3.1-pro');   // CHANGED (0.8.4 seats unit): the flagship's K3.1 Pro seat is its layer-2 judge now, not a proposer
  // K3.1 Pro planted on another shipped chain (and in the retired folder): refused
  assert.equal(kimiProblems('chains/plan-medium-council.json', base).length, 1, 'the same seat in another chain is a hit');
  assert.equal(kimiProblems('chains/outdated/plan-premium-7.json', base).length, 1, 'and in a retired chain');
  // another Kimi model on the exempt chain
  const k3 = structuredClone(base); kimi(k3).model = 'moonshotai/kimi-k3';
  assert.equal(kimiProblems(rel, k3).length, 1, 'K3 on the exempt chain');
  // the exempt seat with a second Kimi mention (another lab, an extra field)
  const lab = structuredClone(base); kimi(lab).lab = 'kimi-other';
  assert.equal(kimiProblems(rel, lab).length, 1, 'another lab on the exempt seat');
  const extra = structuredClone(base); kimi(extra).extra.note = 'moonshot';
  assert.equal(kimiProblems(rel, extra).length, 1, "a Moonshot mention in the exempt seat's extra");
  // a second Kimi seat on the exempt chain
  const second = structuredClone(base); second.seats.critics[0].model = 'moonshotai/kimi-k3.1-pro';
  assert.equal(kimiProblems(rel, second).length, 1, 'a second Kimi seat on the exempt chain');
});

test('a user chain may seat Kimi; xAI/Grok stays denied', () => {
  assert.deepEqual(deniedReasonsOf({ provider: 'openrouter', model: 'moonshotai/kimi-k3' }), []);
  assert.ok(deniedReasonsOf({ provider: 'openrouter', model: 'x-ai/grok-4' }).length > 0);
});
