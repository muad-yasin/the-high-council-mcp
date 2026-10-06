// Re-reads OpenRouter's public model list and raises src/pricing.json's `openrouter/*` rows that are below it (0.8.1 pre-release audit, MAN-4 / MAN-7).
//   node scripts/refresh-openrouter-prices.mjs [models.json] [--endpoints <folder of <id with / as __>.json>] [--write]
// No models file: fetches https://openrouter.ai/api/v1/models (public, no key). The spend cap projects against these rows, so the rule is one-sided on purpose:
//   - a row BELOW the list's headline price is RAISED to it (the cap was projecting less than the list says);
//   - a row ABOVE it is NEVER lowered here (a row may be deliberately dear: a promotion that expires, a ZDR endpoint, a first-party price); it is reported;
//   - rows with `expires` are not touched.
// The list's headline is one endpoint's price (often an unusual one), and a call can fall back to a dearer endpoint: with --endpoints (the list of
// /api/v1/models/<id>/endpoints saved per model) the dearest NON-fast-tier endpoint that can serve the model's smallest shipped output cap is printed next to it. That column is
// information for the owner's decision on whether the rows should price the dearest endpoint; this script does not apply it.
// Writing records `_openrouterCheckedAt` (read by test/pricing-freshness.test.js) and a dated line in each changed row's `_source`.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const epIdx = args.indexOf('--endpoints');
const epDir = epIdx >= 0 ? args[epIdx + 1] : null;
const modelsFile = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--endpoints');
const TODAY = process.env.PRICING_CHECKED_AT || new Date().toISOString().slice(0, 10);

const list = modelsFile ? JSON.parse(readFileSync(modelsFile, 'utf8')) : await (await fetch('https://openrouter.ai/api/v1/models')).json();
const live = new Map(list.data.map(m => [m.id, m]));
const pricingPath = join(root, 'src', 'pricing.json');
const table = JSON.parse(readFileSync(pricingPath, 'utf8'));
const perM = v => Number(v) * 1e6;
const r6 = x => Math.round(x * 1e6) / 1e6;

// the smallest output cap any shipped chain gives a seat of each OpenRouter model (the endpoints that cannot return that much are not candidates)
const minCap = new Map();
for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
  for (const v of Object.values(c.seats || {})) for (const s of (Array.isArray(v) ? v : [v])) {
    if (s?.provider === 'openrouter') minCap.set(s.model, Math.min(minCap.get(s.model) ?? Infinity, s.maxTokens ?? 36000));
  }
}
const FAST_TIER = /\/(fast|ultrafast|priority|flex)\b/;
function dearestEndpoint(id) {
  if (!epDir) return null;
  const fn = join(epDir, `${id.replace(/\//g, '__')}.json`);
  if (!existsSync(fn)) return null;
  const eps = (JSON.parse(readFileSync(fn, 'utf8')).data?.endpoints ?? []).filter(e => !FAST_TIER.test(e.tag || '') && (e.max_completion_tokens ?? Infinity) >= (minCap.get(id) ?? 36000));
  if (!eps.length) return null;
  return { in: Math.max(...eps.map(e => perM(e.pricing.prompt))), out: Math.max(...eps.map(e => perM(e.pricing.completion))), n: eps.length };
}

const changes = []; const lines = [];
for (const [key, row] of Object.entries(table)) {
  if (!key.startsWith('openrouter/') || !row || typeof row !== 'object') continue;
  const id = key.slice('openrouter/'.length);
  const m = live.get(id);
  if (!m) { lines.push(`${id}: NOT LISTED any more`); continue; }
  const li = perM(m.pricing.prompt), lo = perM(m.pricing.completion);
  const dear = dearestEndpoint(id);
  const note = dear ? `  dearest endpoint ${r6(dear.in)}/${r6(dear.out)} (n=${dear.n})` : '';
  if (row.expires) { lines.push(`${id}: file ${row.in}/${row.out}, list ${r6(li)}/${r6(lo)}: KEPT (expires ${row.expires})${note}`); continue; }
  const newIn = li > row.in * 1.05 ? r6(li) : row.in, newOut = lo > row.out * 1.05 ? r6(lo) : row.out;
  if (newIn !== row.in || newOut !== row.out) {
    lines.push(`${id}: file ${row.in}/${row.out} -> ${newIn}/${newOut} (list ${r6(li)}/${r6(lo)})${note}  RAISED`);
    changes.push({ key, row, newIn, newOut, li, lo });
  } else if (row.in > li * 1.05 || row.out > lo * 1.05) lines.push(`${id}: file ${row.in}/${row.out} ABOVE list ${r6(li)}/${r6(lo)}: kept (this script never lowers)${note}`);
  else lines.push(`${id}: file ${row.in}/${row.out} = list${note}`);
}
console.log(lines.join('\n'));
if (write) {
  // Text-level edit, so the rest of the file keeps its formatting (1.0 stays 1.0) and the diff shows only the rows that changed.
  let text = readFileSync(pricingPath, 'utf8');
  const num = n => (Number.isInteger(n) ? `${n}.0` : String(n));
  for (const c of changes) {
    const start = text.indexOf(`"${c.key}": {`);
    const end = text.indexOf('\n  }', start);
    if (start < 0 || end < 0) throw new Error(`cannot find the row ${c.key} in src/pricing.json`);
    let block = text.slice(start, end);
    const was = `${c.row.in}/${c.row.out}`;
    block = block.replace(/"in":\s*[0-9.]+/, `"in": ${num(c.newIn)}`).replace(/"out":\s*[0-9.]+/, `"out": ${num(c.newOut)}`);
    const add = `openrouter.ai/api/v1/models re-read ${TODAY}: list ${r6(c.li)}/${r6(c.lo)} per Mtok, raised from ${was} (the cap was projecting less than the list)`;
    block = /"_source":\s*"/.test(block) ? block.replace(/("_source":\s*")((?:[^"\\]|\\.)*)"/, (m, pre, body) => `${pre}${body}; ${add}"`) : block.replace(/("out":\s*[0-9.]+)/, `$1,\n    "_source": ${JSON.stringify(add)}`);
    text = text.slice(0, start) + block + text.slice(end);
  }
  if (!/"_openrouterCheckedAt"/.test(text)) text = text.replace(/("asOf":\s*"[^"]*",?\n)/, `$1  "_openrouterCheckedAt": "${TODAY}",\n  "_openrouterStaleDays": 45,\n  "_openrouterNote": "The date every openrouter/* row was last compared with OpenRouter's live model list (scripts/refresh-openrouter-prices.mjs, which only RAISES a row below the list). test/pricing-freshness.test.js turns red _openrouterStaleDays after it: re-run the script before then (MAN-7). Direct-provider rows (anthropic/, openai/, google/...) are NOT covered by this date: they carry their own _source dates.",\n`);
  else text = text.replace(/"_openrouterCheckedAt":\s*"[^"]*"/, `"_openrouterCheckedAt": "${TODAY}"`);
  JSON.parse(text); // still valid
  writeFileSync(pricingPath, text);
  console.log(`\nwrote ${pricingPath}: ${changes.length} row(s) raised, _openrouterCheckedAt ${TODAY}`);
} else console.log(`\n(dry: ${changes.length} row(s) would be raised; pass --write)`);
