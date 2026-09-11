import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PRICES = JSON.parse(readFileSync(join(here, 'pricing.json'), 'utf8'));

export function priceOf(provider, model) {
  return PRICES[`${provider}/${model}`] || null;
}

export function costOf(provider, model, usage) {
  const p = priceOf(provider, model);
  if (!p) return { usd: 0, priced: false };
  const usd = (usage.input / 1e6) * p.in + (usage.output / 1e6) * p.out;
  return { usd, priced: true };
}

export function summarise(stages) {
  let input = 0, output = 0, usd = 0;
  const unpriced = new Set();
  for (const s of stages) {
    if (!s.usage) continue;
    input += s.usage.input;
    output += s.usage.output;
    const c = costOf(s.provider, s.model, s.usage);
    usd += c.usd;
    if (!c.priced) unpriced.add(`${s.provider}/${s.model}`);
  }
  return { input, output, total: input + output, usd, unpriced: [...unpriced] };
}

export function formatUsd(n) {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Per-run spend cap.
//
// costOf() above is measurement: what a stage cost once it had already been
// paid for. A cap that only measures is not a cap, so enforcement needs a
// number BEFORE the call goes out - hence a worst case rather than an actual.
//
// Worst case for one stage is: every prompt character billed as input, plus
// the seat's entire maxTokens budget billed as output. A stage essentially
// never spends its whole output budget, so this over-estimates on purpose - a
// cap that occasionally stops a run slightly early is a working cap, and one
// that lets a run slip past the ceiling is not.

// Characters per token. Real tokenisers vary by model and language; 4 is the
// usual English rule of thumb and errs low (i.e. estimates MORE tokens) on
// the code and JSON these prompts are full of.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

/**
 * The most this stage could cost. Returns 0 for a seat with no price entry -
 * an unpriced model cannot be accounted for, so it cannot be capped either
 * (this is why the $0 mock chains run freely under any ceiling).
 *
 * `retries` covers the thinking-disabled retry in chain.js invoke(), which
 * can pay for the same stage twice.
 */
export function worstCaseOf(provider, model, { promptChars = 0, maxTokens = 8000, retries = 1 } = {}) {
  const p = priceOf(provider, model);
  if (!p) return { usd: 0, priced: false };
  const input = Math.ceil(promptChars / CHARS_PER_TOKEN);
  const usd = ((input / 1e6) * p.in + (maxTokens / 1e6) * p.out) * retries;
  return { usd, priced: true };
}

/**
 * Would running this stage risk breaching the ceiling? Pure, so it is
 * testable without a provider.
 *
 * `cap` of null means no ceiling and always returns ok.
 */
export function wouldBreach({ spent, cap, projected }) {
  if (cap === null || cap === undefined) return { breach: false };
  const after = spent + projected;
  return { breach: after > cap, after, remaining: Math.max(0, cap - spent) };
}
