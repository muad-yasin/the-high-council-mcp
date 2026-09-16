#!/usr/bin/env node
// "What does $N actually buy?" - the inverse of budget.js.
//
// budget.js answers: given a token budget, what does it cost.
// This answers: given money, how much real work is that.
//
//   node src/buys.js --usd 43 --roster cheap --split 90

import { ROSTERS, priceRoster } from './budget.js';

// Concrete units, so a token count means something.
const UNITS = {
  'page of prose (~500 words)': 670,
  'long design document': 12_000,
  'one deliverable through the 2-lab verify chain (worst case)': 54_400,
  'one SMO-style production bible through the verify chain': 130_000,
  'a full 10-request blind benchmark (4 outputs each)': 130_000 * 40,
};

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const usdBudget = Number(arg('usd', 43));
const rosterName = arg('roster', 'cheap');
const share = Number(arg('split', 90)) / 100;
const roster = ROSTERS[rosterName];

// Price 1M tokens per seat to get the roster's blended rate.
const probe = priceRoster({ perModel: 1e6, roster, inputShare: share });
const usdPerMtokTotal = probe.total / (probe.tokens / 1e6);

const tokens = (usdBudget / usdPerMtokTotal) * 1e6;

// Bug-audit fix, 2026-09-16: an unpriced model in the roster contributes its real tokens to
// `probe.tokens` but $0 to `probe.total`, understating `usdPerMtokTotal` (and therefore
// overstating how much `tokens` a given budget buys) by exactly that model's share - loud here
// so this script never quietly reports an inflated token count off a silently-undercounted rate.
if (probe.unpriced.length) {
  console.log(`\nWARNING: ${probe.unpriced.length} model(s) missing from pricing.json (${probe.unpriced.join(', ')}) - the blended rate below excludes them entirely, so every figure this prints understates real cost / overstates real tokens bought.`);
}

console.log(`\nRoster: ${rosterName} (${roster.length} models, ${Math.round(share * 100)}% input / ${Math.round((1 - share) * 100)}% output)`);
console.log(`Blended rate: $${usdPerMtokTotal.toFixed(3)} per million tokens across the whole roster\n`);
console.log(`$${usdBudget} buys ${(tokens / 1e6).toFixed(1)}M tokens of total traffic.\n`);
console.log(`That is, in units you can picture:\n`);
const w = Math.max(...Object.keys(UNITS).map(k => k.length));
for (const [label, cost] of Object.entries(UNITS)) {
  const n = tokens / cost;
  // Force en-US grouping; the default locale turns 5823 into "5.823".
  const shown = n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(1) : n.toFixed(2);
  console.log(`  ${label.padEnd(w)}  ${String(shown).padStart(9)}`);
}
console.log(`\nOr per unit: one deliverable through the verify chain costs $${(usdPerMtokTotal * 54_400 / 1e6).toFixed(3)} on this roster.`);
