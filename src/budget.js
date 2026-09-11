#!/usr/bin/env node
// Prices a whole-run token budget across a roster of models.
//
//   node src/budget.js --per-model 10000000 --roster frontier --split 80
//
// Unlike --dry-run, which prices one pass through a chain from per-stage
// assumptions, this answers the blunt question: if each seat chews through
// N tokens over a whole run, what does the run cost?

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PRICES = JSON.parse(readFileSync(join(here, 'pricing.json'), 'utf8'));

export const ROSTERS = {
  // Seven labs, top model from each. The seven-frontier-lab harness as asked for.
  frontier: [
    'anthropic/claude-opus-5',
    'openai/gpt-5',
    'google/gemini-2.5-pro',
    'xai/grok-4',
    'mistral/mistral-large-latest',
    'deepseek/deepseek-reasoner',
    'together/Qwen/Qwen2.5-72B-Instruct-Turbo',
  ],
  // The frontier roster with the Anthropic seat dropped from Opus 5 to
  // Sonnet 5. Same seven labs; only the most expensive seat changes.
  'frontier-sonnet': [
    'anthropic/claude-sonnet-5',
    'openai/gpt-5',
    'google/gemini-2.5-pro',
    'xai/grok-4',
    'mistral/mistral-large-latest',
    'deepseek/deepseek-reasoner',
    'together/Qwen/Qwen2.5-72B-Instruct-Turbo',
  ],
  // Seven labs again, but each lab's small model. Same structure, same
  // independence between labs, roughly a tenth of the bill.
  cheap: [
    'anthropic/claude-haiku-4-5-20251001',
    'openai/gpt-5-mini',
    'google/gemini-2.5-flash',
    'deepseek/deepseek-chat',
    'groq/llama-3.3-70b-versatile',
    'mistral/mistral-small-latest',
    'together/meta-llama/Llama-3.3-70B-Instruct-Turbo',
  ],
  // The shape worth actually running: one expensive builder, cheap critics.
  // Output tokens are what cost money, and only the builder writes at length.
  mixed: [
    'anthropic/claude-sonnet-5',
    'openai/gpt-5-mini',
    'google/gemini-2.5-flash',
    'deepseek/deepseek-chat',
    'groq/llama-3.3-70b-versatile',
    'mistral/mistral-small-latest',
    'together/meta-llama/Llama-3.3-70B-Instruct-Turbo',
  ],
};

// Repeated input is billed at a fraction of base price when a provider's
// prompt cache hits. The multiplier differs per lab (Anthropic reads at 0.1x
// and writes at 1.25x, OpenAI and Google land near 0.1x-0.25x). One number
// here is a deliberate simplification; treat cached figures as a floor.
const CACHE_READ_MULTIPLIER = 0.1;

export function priceRoster({ perModel, roster, inputShare, cacheHitRate = 0 }) {
  const rows = roster.map(key => {
    const p = PRICES[key];
    const input = perModel * inputShare;
    const output = perModel * (1 - inputShare);
    if (!p) return { key, input, output, usd: null };
    const cached = input * cacheHitRate;
    const fresh = input - cached;
    const usd = (fresh / 1e6) * p.in
              + (cached / 1e6) * p.in * CACHE_READ_MULTIPLIER
              + (output / 1e6) * p.out;
    return { key, input, output, usd, rate: p };
  });
  const total = rows.reduce((s, r) => s + (r.usd || 0), 0);
  return { rows, total, tokens: perModel * roster.length };
}

const usd = n => n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
const M = n => `${(n / 1e6).toFixed(1)}M`;

function table({ perModel, roster, inputShare, cacheHitRate, label }) {
  const { rows, total, tokens } = priceRoster({ perModel, roster, inputShare, cacheHitRate });
  const w = Math.max(...rows.map(r => r.key.length));
  console.log(`\n${label}`);
  console.log(`  ${M(perModel)} tokens per model, ${roster.length} models, ${M(tokens)} total`);
  console.log(`  split ${Math.round(inputShare * 100)}% input / ${Math.round((1 - inputShare) * 100)}% output` +
              (cacheHitRate ? `, ${Math.round(cacheHitRate * 100)}% of input served from prompt cache` : ', no prompt caching'));
  console.log('');
  for (const r of rows.sort((a, b) => (b.usd || 0) - (a.usd || 0))) {
    const price = r.rate ? `${r.rate.in}/${r.rate.out}` : 'unpriced';
    console.log(`  ${r.key.padEnd(w)}  ${price.padStart(12)} per Mtok   ${(r.usd === null ? 'unpriced' : usd(r.usd)).padStart(9)}`);
  }
  console.log(`  ${''.padEnd(w)}  ${''.padStart(12)}              ${usd(total).padStart(9)}  per run`);
  return total;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
  const perModel = Number(arg('per-model', 10_000_000));
  const share = Number(arg('split', 80)) / 100;
  const cache = Number(arg('cache', 0)) / 100;
  const which = arg('roster', null);

  const names = which ? [which] : Object.keys(ROSTERS);
  const totals = {};
  for (const n of names) {
    totals[n] = table({
      perModel, roster: ROSTERS[n], inputShare: share, cacheHitRate: cache,
      label: `ROSTER: ${n}`,
    });
  }
  if (names.length > 1) {
    console.log('\nRatio to the cheapest roster:');
    const min = Math.min(...Object.values(totals));
    for (const [n, t] of Object.entries(totals)) console.log(`  ${n.padEnd(9)} ${usd(t).padStart(9)}   ${(t / min).toFixed(1)}x`);
  }
}
