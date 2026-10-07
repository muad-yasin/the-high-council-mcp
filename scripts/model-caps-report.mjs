#!/usr/bin/env node
// Writes maintainers/MODEL-CAPS.md (0.8.2 item 9; the owner's idea of 7 Oct 2026, C&C's draft): one row per model seated in a shipped chain, from the three sources that already hold the facts
// (src/pricing.json, src/reasoning-table.json, chains/*.json) and the harness's own functions (retryCeilingOf, cutOffRetryCap, ADVICE_RETRY_MAX_TOKENS). It types no number of its own: edit the sources, then run
// this script (`node scripts/model-caps-report.mjs`; `--check` exits 1 if the file differs). test/model-caps-report.test.js regenerates the text and fails while the committed file disagrees (the landing-page
// and skills-catalog pattern). Pure: reads files, calls nothing, spends nothing.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retryCeilingOf } from '../src/reasoning.js';
import { cutOffRetryCap } from '../src/chain.js';
import { ADVICE_RETRY_MAX_TOKENS } from '../src/advise.js';
import { SEAT_DEFAULT_MAX_TOKENS, priceOf } from '../src/cost.js';
import { isFreeProvider } from '../src/providers.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = join(here, '..');
export const OUT_FILE = 'maintainers/MODEL-CAPS.md';

const fmtTok = n => (Number.isFinite(n) ? n.toLocaleString('en-US') : '-');
const fmtUsd = n => (Number.isFinite(n) ? `$${n}` : '-');
// The first date in a row's free-text _source is the check date (later dates in it are history). A row with none falls back to the table's own date, said so.
const checkedOf = (row, table) => (row?._source?.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || (row ? `table ${table.asOf ?? '?'}` : '-');

/** The text of maintainers/MODEL-CAPS.md for the repository at `root`. */
export function generateModelCaps(root = DEFAULT_ROOT) {
  const readJson = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
  const pricing = readJson('src/pricing.json');
  const table = readJson('src/reasoning-table.json');

  // Every real seat in every shipped chain (mock and external seats have no model identity).
  const seats = [];
  for (const file of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).sort()) {
    const chain = JSON.parse(readFileSync(join(root, 'chains', file), 'utf8'));
    const name = file.replace(/\.json$/, '');
    const advice = chain.advise && Number.isFinite(chain.advise.usd) ? chain.advise.usd : null;
    const walk = (node, path) => {
      if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
      if (!node || typeof node !== 'object') return;
      if (typeof node.provider === 'string' && typeof node.model === 'string' && !['mock', 'external'].includes(node.provider)) seats.push({ chain: name, seat: node, advice });
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(chain, '');
  }

  const byModel = new Map();
  for (const s of seats) {
    const k = `${s.seat.provider}/${s.seat.model}`;
    if (!byModel.has(k)) byModel.set(k, []);
    byModel.get(k).push(s);
  }

  const rows = [];
  for (const [k, list] of [...byModel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const local = isFreeProvider(list[0].seat.provider); // a local model server (ollama): $0 by construction, no lab price and no reasoning row to look up
    const price = local ? priceOf(list[0].seat.provider, list[0].seat.model) : pricing[k];
    const r = table.models?.[k];
    const caps = new Map();    // label -> chains
    const retries = new Map(); // label -> retry cap
    const advice = [];
    for (const { chain, seat, advice: usd } of list) {
      for (const [field, cap] of [['maxTokens', seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS], ['panelMaxTokens', seat.panelMaxTokens]]) {
        if (!Number.isFinite(cap)) continue;
        const tag = `${field === 'panelMaxTokens' ? ' (panel)' : ''}${seat.maxTokens == null && field === 'maxTokens' ? ' (default)' : ''}${usd != null ? ' (advice)' : ''}`;
        const label = `${fmtTok(cap)}${tag}`;
        if (!caps.has(label)) caps.set(label, new Set());
        caps.get(label).add(chain);
        retries.set(label, usd != null ? cutOffRetryCap(cap, ADVICE_RETRY_MAX_TOKENS) : cutOffRetryCap(cap, retryCeilingOf(seat)));
      }
      if (usd != null) advice.push(`${chain} ${fmtUsd(usd)}`);
    }
    const capCell = [...caps.entries()].map(([c, ch]) => `${c}: ${[...ch].sort().join(', ')}`).join('<br>');
    const retryCell = [...retries.entries()].map(([c, t]) => `${c} → ${fmtTok(t)}`).join('<br>');
    const unlisted = table.unlisted?.[k] || table.unlisted?.[k.replace(/^[^/]+\//, '')];
    rows.push(`| \`${k}\` | ${price ? `${price.in} / ${price.out}` : '**no price row**'} | ${local ? 'local, $0 by construction' : checkedOf(price, pricing)} | ${r ? fmtTok(r.maxOutput) : local ? 'local model (no lab row)' : unlisted ? 'no reasoning row (not a reasoning model)' : '**no reasoning row**'} | ${r?.defaultEffort ?? '-'} | ${capCell} | ${retryCell} | ${advice.join('<br>') || '-'} | ${price?.critiqueTokens ? fmtTok(price.critiqueTokens) : '-'} |`);
  }

  return `# Model caps (GENERATED: edit the sources, then run the script; do not edit this file by hand)

Written by \`scripts/model-caps-report.mjs\` from \`src/pricing.json\` (table as of ${pricing.asOf}; OpenRouter rows compared with its live list on ${pricing._openrouterCheckedAt ?? '?'}), \`src/reasoning-table.json\` (as of ${table.asOf}) and \`chains/*.json\`.
To change a number, edit its source and run \`node scripts/model-caps-report.mjs\`; \`test/model-caps-report.test.js\` fails while this file disagrees with them.
One row per model seated in a shipped chain (mock and external seats are excluded). "Price checked" is the first date in the row's own \`_source\` note, or the table's date when the row has none.

| Model | Price in / out (USD per 1M tokens) | Price checked | Model's max output | Model's default effort | Our cap: chains | Retry after a cut-off (cap → retry) | Advice ceiling (advise.usd) | Typical judge reply (tokens) |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

Notes
- "Retry after a cut-off": planning chains double the cap, bounded by the model's own ceiling (\`retryCeilingOf\`); advice chains bound it at ${fmtTok(ADVICE_RETRY_MAX_TOKENS)} (\`ADVICE_RETRY_MAX_TOKENS\`), never below the cap. "(panel)" is a seat's \`panelMaxTokens\`, the cap of its review calls.
- "Our cap" is what a chain's seat sets; a seat that sets none gets ${fmtTok(SEAT_DEFAULT_MAX_TOKENS)} (shown "(default)"). A model's own maximum is the lab's published figure in the reasoning table; the spend cap projects every call at the seat's cap.
- Not in the data yet: the largest reply each OpenRouter endpoint accepts (it can be lower than the model's maximum, and a cap above it narrows routing) and measured speed (tokens per second). Neither is typed here.
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = generateModelCaps();
  const path = join(DEFAULT_ROOT, OUT_FILE);
  if (process.argv.includes('--check')) {
    const same = existsSync(path) && readFileSync(path, 'utf8') === text;
    console.log(same ? `${OUT_FILE} is current` : `${OUT_FILE} differs from its sources: run node scripts/model-caps-report.mjs`);
    process.exit(same ? 0 : 1);
  }
  writeFileSync(path, text);
  console.log(`wrote ${OUT_FILE}`);
}
