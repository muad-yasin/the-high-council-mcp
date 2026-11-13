// Makes src/zdr-hosts.json, the dated table of which OpenRouter models have a zero-data-retention host (0.8.4, the optional zero-retention setting; the check is src/zero-retention.js).
//   node scripts/refresh-zdr-table.mjs --fetch <list.json>                       GET https://openrouter.ai/api/v1/endpoints/zdr (public, no key, no paid call) into <list.json> (a file OUTSIDE the repository)
//   node scripts/refresh-zdr-table.mjs --from-file <list.json> --as-of YYYY-MM-DD   print the table made from that saved list
//        ... --write    write it to src/zdr-hosts.json
//        ... --check    compare it with src/zdr-hosts.json and exit 1 when they differ (so a shipped table is proved to be this script's output for the saved list)
// The fetch step and the compute step are apart: a saved list can be re-read, checked and kept as the evidence of a refresh. --as-of is the day the list was read; it is never today's date by default.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zdrTableOf, allowedSlugsThatMatchOthers } from '../src/zdr-table.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const val = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const target = join(root, 'src', 'zdr-hosts.json');
const fmt = table => `${JSON.stringify(table, null, 1)}\n`;

if (args.includes('--fetch')) {
  const out = val('--fetch');
  if (!out) { console.error('--fetch needs a file path outside the repository'); process.exit(2); }
  const res = await fetch('https://openrouter.ai/api/v1/endpoints/zdr');
  if (!res.ok) { console.error(`the list answered HTTP ${res.status}; nothing was written`); process.exit(1); }
  writeFileSync(out, await res.text());
  console.log(`saved the list to ${out}; make the table with --from-file ${out} --as-of <the day you read it>`);
  process.exit(0);
}
const file = val('--from-file'), asOf = val('--as-of');
if (!file || !asOf) { console.error('usage: --from-file <list.json> --as-of YYYY-MM-DD [--write | --check]   (or --fetch <list.json>)'); process.exit(2); }
const list = JSON.parse(readFileSync(file, 'utf8'));
const rows = Array.isArray(list) ? list : list.data;
const table = zdrTableOf(rows, asOf);
const leaks = allowedSlugsThatMatchOthers(rows, table);
if (leaks.length) { console.error(`refused: ${leaks.length} allowed slug(s) would match an endpoint that is not allowed, e.g. ${leaks[0].model}: ${leaks[0].slug} matches ${leaks[0].other}; nothing was written`); process.exit(1); }
const text = fmt(table);
if (args.includes('--check')) {
  const have = readFileSync(target, 'utf8');
  if (have !== text) { console.error(`src/zdr-hosts.json is NOT this script's output for ${file} (--as-of ${asOf}): the table has ${Object.keys(JSON.parse(have).models).length} models, the script makes ${Object.keys(table.models).length}`); process.exit(1); }
  console.log(`src/zdr-hosts.json is exactly this script's output for ${file} (${Object.keys(table.models).length} models, as of ${asOf})`);
} else if (args.includes('--write')) { writeFileSync(target, text); console.log(`wrote ${target} (${Object.keys(table.models).length} models, as of ${asOf})`); } else process.stdout.write(text);
