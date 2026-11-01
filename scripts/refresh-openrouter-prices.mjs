// Re-reads OpenRouter's public model list and endpoints and sets src/pricing.json's `openrouter/*` rows to what the spend cap should count (0.8.1 pre-release audit, MAN-4 / MAN-7; PRICES lane, 1 Nov 2026), and records the HOST PICTURE behind each row.
//   node scripts/refresh-openrouter-prices.mjs [models.json] [--endpoints <folder>] [--pages <folder>] [--fetch <folder>] [--hosts-only] [--list-hosts] [--write]
//     A saved folder carries the day it was read in `_fetch.json` (written by --fetch); a block is dated with that day, never with today's, and --write refuses a folder without it (PRICING_CHECKED_AT sets the day by hand, for tests).
//     --list-hosts: also prints every endpoint of every model with its precision, context length and output limit, and why one is left out.
//     --hosts-only: with --write, writes ONLY the `hosts` blocks: no row is raised and _openrouterCheckedAt does not move (each block carries its own date).
//     <folder> holds, per model, `<id with / as __>.json` (the /api/v1/models/<id>/endpoints answer) and `<id with / as __>.html` (the public model page, https://openrouter.ai/<id>).
//     --fetch <folder> first downloads models.json, every row's endpoints answer and its page into <folder> (a folder OUTSIDE the repository; GET only, no key, no paid call), then computes from those files
//     and from nothing else: the fetch step and the compute step are apart, so a saved folder can be re-read, tested and kept as the evidence of a refresh.
// No models file: fetches https://openrouter.ai/api/v1/models (public, no key). The spend cap projects against these rows, and every call carries them as its price limit (price-pin.js), so a row is
// the DEAREST ELIGIBLE HOST (A-DRAFT, owner's design 1 Nov 2026 via C&C: "the price THC COUNTS stays the dearest eligible host"):
//   - a row with a host picture is set to exactly the dearest eligible host, per side, in BOTH directions, EXCEPT a TIER-DRIVEN row (the dearest prompt-size or time-of-day tier gives another figure than the base prices): no single figure prices its TIER part right, so
//     that part is RECORDED, NOT YET COUNTED: the row's `tiers` list (written beside its block, 0.8.4 unit 2b) holds the dearest rate any eligible host charges from each prompt-size threshold, `rateFor` in src/price-table.js gives a call the rate its own
//     prompt reaches, and its block says `tier_driven: true`; the spend cap and the price limit read the tiers only once DUALCAP's wiring (4d) passes them a prompt size. Until then the row's `in`/`out` count the higher of today's figure and the dearest
//     eligible host at BASE price (never lowered). Otherwise: a row below it is RAISED (the cap was projecting less than a host can bill), a row above it is LOWERED
//     (the 0.8.1 rule "never lowers" was the audit-night script's own choice; a promotion that ends, a ZDR host or a first-party host are handled by the eligible set and by the pin, not by keeping a stale figure: a host that later
//     raises its price above the row is excluded by the pin, which means fewer hosts or a refused call, never overspending);
//   - a row WITHOUT a host picture (no endpoints answer, or no eligible host) keeps the old rule: raised to the list's headline price when that is more than 5% above it, never lowered; it is reported;
//   - rows with `expires` are not touched (test/pricing-expiry.test.js covers them);
//   - writing counted prices needs answers read TODAY (the `_fetch.json` stamp of a --fetch made the same day, or PRICING_CHECKED_AT for tests): older answers are refused, because a host's price moves within a day.
//   - the stamp `_openrouterCheckedAt` means: every `openrouter/` row WITHOUT an `expires` date was compared with the list on that date (the day the answers were read). Rows with `expires` are not compared by design
//     (test/pricing-expiry.test.js covers them) but must still be on the list. A row, with or without `expires`, that the list does not name any more cannot be checked, so the script then REFUSES: it exits 2, writes nothing
//     and does not move the stamp (the lane E guard, 24 Okt 2026).
// The list's headline is one endpoint's price (often an unusual one), and a call can fall back to a dearer endpoint. With the endpoints answers the script reads every endpoint ("host", one provider tag) of the model and keeps the ELIGIBLE ones:
//   1. not a fast, ultrafast, priority or flex tier (by tag, or by the answer's own `service_tier`);
//   2. able to return the model's smallest shipped output cap (the smallest `maxTokens` any chain in this checkout's chains/ gives the model; 36000 when none sets one). An endpoint that publishes NO limit is COUNTED (the ceiling errs high);
//   3. not listed under "Not used in Standard routing" on the model's page. That flag exists nowhere in the API or in the page's embedded data, only as a divider row of the page's table (data-testid="routing-mode-divider").
//      The page row is matched to an endpoint by provider name and by both prices. A page that cannot be read, a divider with another label, or a row that matches no endpoint or more than one is NEVER a reason to drop a host:
//      the hosts stay counted and the row's filters say "routing flag not read" (a wrong drop lowers the ceiling, a wrong count only raises it).
// From the eligible endpoints the script writes the lowest, the median and the highest input and output price, the count and the filters into the row's `hosts` block (A-DRAFT, PRICES lane, 1 Nov 2026). The figures THC COUNTS (`in`, `out`) are
// set from `hosts.in.high` / `hosts.out.high` (unless --hosts-only); the median is taken for each side on its own, over endpoints (not providers), and for an even count it is the mean of the two middle prices.
// AFTER a write that moved a price, run `node scripts/regen-derived-figures.mjs` (the --write output says so): the README, AI-README, landing page, chain descriptions, advice pins and ceilings and MODEL-CAPS derive from the rows,
// and nothing else keeps them current (scripts/regen-derived-figures.mjs --check, and test/regen-derived-figures.test.js, turn red when they are stale).
// Writing records `_openrouterCheckedAt` (read by test/pricing-freshness.test.js), each row's `hosts.checked`, and a dated line in each changed row's `_source`.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const hostsOnly = args.includes('--hosts-only');
const listHosts = args.includes('--list-hosts');
// --propose <model id>[,<model id>...]|all  [--largest-call-tokens <n>] [--ignore <slug>]...: PROPOSES a provider-preference.json (src/provider-preference.js) into <folder>/proposed-provider-preference.json and prints it. For each model the hosts
// that are ELIGIBLE (the same filters as the host picture) AND whose BASE prices are at or below the median of the eligible hosts' base prices on both sides (the picture's stored median is tier-priced, so it is not used), cheapest first.
// A host is left off when its context length cannot hold --largest-call-tokens, or its published output limit is below --max-output-tokens (an unpublished one counts as unable when the number is given: the chain's own maxTokens, not the shipped
// minimum the host picture uses), or when its tag is --ignore'd (a banned slug removes every endpoint under it). "At or below" the median is the default; --strict-below keeps only hosts strictly below it, and both counts are printed.
// --propose-out <folder> writes the proposal there instead of beside the fetched answers. It never writes the operator's project file: the operator copies and edits the proposal.
const proposeArg = args.includes('--propose') ? args[args.indexOf('--propose') + 1] : (args.includes('--for-chain') ? 'all' : null);
const largestCall = args.includes('--largest-call-tokens') ? Number(args[args.indexOf('--largest-call-tokens') + 1]) : null;
const maxOutput = args.includes('--max-output-tokens') ? Number(args[args.indexOf('--max-output-tokens') + 1]) : null;
// --for-chain <chain.json>: take each OpenRouter seat's model, its maxTokens (the output the host must be able to return) and its own extra.provider.ignore from that chain, per model (the flags below are the same thing by hand, for every model at once).
const chainSeats = (() => { const f = args.includes('--for-chain') ? args[args.indexOf('--for-chain') + 1] : null; if (!f) return null; const c = JSON.parse(readFileSync(f, 'utf8')); const m = new Map();
  for (const v of Object.values(c.seats || {})) for (const sd of (Array.isArray(v) ? v : [v])) if (sd?.provider === 'openrouter') { const e = m.get(sd.model) ?? { maxTokens: 0, ignore: new Set() }; e.maxTokens = Math.max(e.maxTokens, sd.maxTokens ?? 36000); for (const g of (sd.extra?.provider?.ignore ?? [])) e.ignore.add(g); m.set(sd.model, e); }
  return m; })();
// --user-prices <file>: a project's pricing.user.json, so the proposal can show the EFFECTIVE row (the higher of the shipped row and the file's, per side, as the cap counts it) beside the median and mark any host above it: the price limit
// (max_price = the effective row) filters such a host out, so it is dead in the file. --largest-output-tokens <model>=<n> (repeatable) and --wall-seconds <s> (default 300): a host whose page speed (tokens per second) would need 80% or more of the wall
// for that model's largest call goes LAST in the order (a floor, never a sort key; a host with no published speed is not penalised and no host is dropped).
const userPricesFile = args.includes('--user-prices') ? args[args.indexOf('--user-prices') + 1] : null;
const wallSeconds = args.includes('--wall-seconds') ? Number(args[args.indexOf('--wall-seconds') + 1]) : 300;
const largestOut = new Map(args.flatMap((a, i) => (a === '--largest-output-tokens' && /^[^=]+=\d+$/.test(args[i + 1] ?? '') ? [[args[i + 1].split('=')[0], Number(args[i + 1].split('=')[1])]] : [])));
const strictBelow = args.includes('--strict-below');
const ignoreSlugs = args.flatMap((a, i) => (a === '--ignore' ? [args[i + 1]] : []));
const valueOf = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const fetchDir = valueOf('--fetch');
let epDir = valueOf('--endpoints');
let pageDir = valueOf('--pages');
const modelsFile = args.find((a, i) => !a.startsWith('--') && !['--endpoints', '--pages', '--fetch', '--propose', '--propose-out', '--user-prices', '--largest-output-tokens', '--wall-seconds', '--for-chain', '--largest-call-tokens', '--max-output-tokens', '--ignore'].includes(args[i - 1]));
const TODAY = process.env.PRICING_CHECKED_AT || new Date().toISOString().slice(0, 10);
const fileOf = id => id.replace(/\//g, '__');

const pricingPath = join(root, 'src', 'pricing.json');
const table = JSON.parse(readFileSync(pricingPath, 'utf8'));
const perM = v => Number(v) * 1e6;
const r6 = x => Math.round(x * 1e6) / 1e6;

// ---- the fetch step (the only code that touches the network besides the default models list) ----
let fetchFailed = [];
let listFile = modelsFile;
if (fetchDir) {
  const dir = resolve(fetchDir);
  const rel = relative(root, dir);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) { console.error(`refused: --fetch ${fetchDir} is inside the repository. Name a folder outside it (the saved answers are evidence of one refresh, not source).`); process.exit(2); }
  mkdirSync(dir, { recursive: true });
  const get = async url => { const r = await fetch(url, { headers: { 'User-Agent': 'the-high-council-price-refresh (read only)' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
  const listText = await get('https://openrouter.ai/api/v1/models');
  listFile = join(dir, 'models.json'); writeFileSync(listFile, listText);
  const fetchIds = new Set(Object.entries(table).filter(([key, row]) => key.startsWith('openrouter/') && row && typeof row === 'object' && !row.expires).map(([key]) => key.slice('openrouter/'.length)));
  for (const id of (chainSeats ? chainSeats.keys() : [])) fetchIds.add(id);   // --for-chain: a model the chain seats that has no shipped row (it is priced by the project's pricing.user.json) is fetched too
  for (const id of fetchIds) {
    for (const [what, url, ext] of [['endpoints', `https://openrouter.ai/api/v1/models/${id}/endpoints`, 'json'], ['page', `https://openrouter.ai/${id}`, 'html']]) {
      try { writeFileSync(join(dir, `${fileOf(id)}.${ext}`), await get(url)); } catch (e) { fetchFailed.push(`${id} ${what}: ${e.message}`); }
    }
  }
  writeFileSync(join(dir, '_fetch.json'), `${JSON.stringify({ fetchedAt: new Date().toISOString(), list: 'https://openrouter.ai/api/v1/models', endpoints: 'https://openrouter.ai/api/v1/models/<id>/endpoints', page: 'https://openrouter.ai/<id>', failed: fetchFailed }, null, 2)}\n`);
  epDir = dir; pageDir = dir;
}

// The date a host picture was READ: the explicit PRICING_CHECKED_AT (tests), else the stamp --fetch wrote into the folder, else none. The compute step never dates old files with today's date: with --write and no date it refuses.
const stamp = epDir && existsSync(join(epDir, '_fetch.json')) ? (() => { try { return JSON.parse(readFileSync(join(epDir, '_fetch.json'), 'utf8')); } catch { return null; } })() : null;
const HOSTS_READ = process.env.PRICING_CHECKED_AT || (typeof stamp?.fetchedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(stamp.fetchedAt) ? stamp.fetchedAt.slice(0, 10) : null);

const list = listFile ? JSON.parse(readFileSync(listFile, 'utf8')) : await (await fetch('https://openrouter.ai/api/v1/models')).json();
const live = new Map(list.data.map(m => [m.id, m]));

// the smallest output cap any shipped chain gives a seat of each OpenRouter model (the endpoints that cannot return that much are not candidates)
const minCap = new Map();
for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
  for (const v of Object.values(c.seats || {})) for (const s of (Array.isArray(v) ? v : [v])) {
    if (s?.provider === 'openrouter') minCap.set(s.model, Math.min(minCap.get(s.model) ?? Infinity, s.maxTokens ?? 36000));
  }
}
const TIER_WORDS = ['fast', 'ultrafast', 'priority', 'flex'];
const FAST_TIER = new RegExp(`\\/(${TIER_WORDS.join('|')})\\b`);
// an answer's own service_tier is a fast tier only when it IS one of the words above; any other value ("standard", "default", a word not seen yet) leaves the host counted (a wrong drop lowers the ceiling)
const isFastTierValue = v => typeof v === 'string' && TIER_WORDS.includes(v.toLowerCase());
const same = (a, b) => Math.abs(a - b) < 1e-9;
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The page's "Not used in Standard routing" rows: [{ name, prices: [..] }] | { unread: why }. Pure (text in, rows out).
function notStandardRows(html) {
  // "no divider" is a claim about the page, so it is made only when the page's endpoints table is there to be read (its rows carry aria-label="Open <provider> details"); without the table the flag is simply not read
  if (!/aria-label="Open [^"]+ details"/.test(html)) return { unread: 'the page shows no endpoints table' };
  const i = html.indexOf('data-testid="routing-mode-divider"');
  if (i < 0) return { rows: [], note: 'the page shows no "Not used in Standard routing" divider' };
  const tail = html.slice(i);
  const end = tail.indexOf('</tbody>');
  const seg = end >= 0 ? tail.slice(0, end) : tail;
  const parts = seg.split(/<tr[\s>]/);
  if (!/Not used in Standard routing/.test(parts[0])) return { unread: 'the page has a routing divider with another label' };
  const rows = [];
  for (const p of parts.slice(1)) {
    const name = /aria-label="Open (.+?) details"/.exec(p)?.[1];
    const prices = [...p.matchAll(/\$(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
    if (!name || prices.length < 2) return { unread: 'a row under the divider could not be read' };
    rows.push({ name, prices });
  }
  return { rows };
}

// The host picture of one model, or null when its endpoints answer was not given. Pure given the files.
function hostPicture(id) {
  if (!epDir) return null;
  const fn = join(epDir, `${fileOf(id)}.json`);
  if (!existsSync(fn)) return null;
  const need = minCap.get(id) ?? 36000;
  const all = (JSON.parse(readFileSync(fn, 'utf8')).data?.endpoints ?? []).map(e => ({
    tag: e.tag || '', provider: e.provider_name || '', quant: e.quantization || 'not stated', tier: e.service_tier, ctx: e.context_length ?? null, out_reason: '',
    bin: r6(perM(e.pricing?.prompt)), bout: r6(perM(e.pricing?.completion)), maxc: e.max_completion_tokens ?? null,
    // overrides: by PROMPT SIZE (min_prompt_tokens: the row's `tiers`, priced per call by rateFor) and by TIME OF DAY (utc windows: the cap has no clock, so they count in the host's base, `cin`/`cout`)
    tiers: (Array.isArray(e.pricing?.overrides) ? e.pricing.overrides : []).filter(o => Number.isInteger(o.min_prompt_tokens)).map(o => ({ from: o.min_prompt_tokens, in: r6(perM(o.prompt ?? e.pricing.prompt)), out: r6(perM(o.completion ?? e.pricing.completion)) })),
    tod: (Array.isArray(e.pricing?.overrides) ? e.pricing.overrides : []).filter(o => !Number.isInteger(o.min_prompt_tokens)).map(o => ({ in: r6(perM(o.prompt ?? e.pricing.prompt)), out: r6(perM(o.completion ?? e.pricing.completion)) })),
  })).filter(e => Number.isFinite(e.bin) && Number.isFinite(e.bout)).map(e => ({ ...e, cin: Math.max(e.bin, ...e.tod.map(t => t.in)), cout: Math.max(e.bout, ...e.tod.map(t => t.out)) })).map(e => ({ ...e, in: Math.max(e.cin, ...e.tiers.map(t => t.in)), out: Math.max(e.cout, ...e.tiers.map(t => t.out)) }));   // a host's price is its DEAREST figure, over its base price and every override (by prompt size or by time of day): the cap has no tiers, and a long or a peak-hour call can be billed at it
  const notTier = all.filter(e => !FAST_TIER.test(e.tag) && !isFastTierValue(e.tier));
  const able = notTier.filter(e => (e.maxc ?? Infinity) >= need);
  const unpublished = able.filter(e => e.maxc === null).length;
  // the page's routing flag
  let routingNote; let dropped = [];
  const pf = pageDir ? join(pageDir, `${fileOf(id)}.html`) : null;
  if (!pf || !existsSync(pf)) routingNote = 'routing flag not read (no page given)';
  else {
    const r = notStandardRows(readFileSync(pf, 'utf8'));
    if (r.unread) routingNote = `routing flag not read (${r.unread})`;
    else {
      let unmatched = 0;
      for (const row of r.rows) {
        const hit = all.filter(e => { const pn = norm(e.provider); const rn = norm(row.name); return pn && (rn.startsWith(pn) || pn.startsWith(rn)) && row.prices.some(p => Math.abs(p - e.bin) < 1e-4) && row.prices.some(p => Math.abs(p - e.bout) < 1e-4); });
        if (hit.length === 1) { if (able.includes(hit[0])) dropped.push(hit[0]); } else unmatched++;   // a row that is already out by tier or length costs nothing here
      }
      routingNote = r.rows.length === 0 ? (r.note || 'no host is marked "Not used in Standard routing"') : `${dropped.length} host(s) the page marks "Not used in Standard routing" left out${unmatched ? `; ${unmatched} page row(s) could not be matched to one host and their hosts stay counted (routing flag not read for them)` : ''}`;
    }
  }
  for (const e of all) e.out_reason = (FAST_TIER.test(e.tag) || isFastTierValue(e.tier)) ? 'fast tier' : !notTier.includes(e) ? '' : !able.includes(e) ? `output limit ${e.maxc} < ${need}` : dropped.includes(e) ? 'page: Not used in Standard routing' : '';
  const eligible = able.filter(e => !dropped.includes(e));
  if (!eligible.length) return { eligible: [], note: `NO ELIGIBLE HOST: ${all.length} endpoint(s) listed, ${notTier.length} outside the fast tiers, ${able.length} able to return ${need} tokens` };
  const side = k => { const v = eligible.map(e => e[k]).sort((a, b) => a - b); const n = v.length; return { low: v[0], median: n % 2 ? v[(n - 1) / 2] : r6((v[n / 2 - 1] + v[n / 2]) / 2), high: v[n - 1] }; };
  const filters = [
    `fast, ultrafast, priority and flex tiers left out (${all.length - notTier.length})`,
    `output limit of at least ${need} tokens (the smallest maxTokens a shipped chain gives this model; ${notTier.length - able.length} left out${unpublished ? `; ${unpublished} publish no limit and are counted` : ''})`,
    routingNote,
    'a host with price overrides (by prompt size or by time of day) is priced at its dearest figure',
    'hosts of every provider are counted, Open Inference included (a chain\'s own extra.provider.ignore is not applied to these figures)',
  ];
  // A row is TIER-DRIVEN when counting the dearest prompt-size / time-of-day tier gives a different figure than the base prices do: no single figure prices such a row right (the dearest tier refuses a call that cannot reach the tier,
  // the base price under-counts one that does), so the row keeps today's figure until the cap prices each call at the tier its own input reaches (unit 2b). The block says so.
  const baseHigh = k => Math.max(...eligible.map(e => (k === 'in' ? e.cin : e.cout)));
  const tierDriven = !same(baseHigh('in'), Math.max(...eligible.map(e => e.in))) || !same(baseHigh('out'), Math.max(...eligible.map(e => e.out)));
  // The row's TIERS (0.8.4 unit 2b): at each prompt-size threshold any eligible host has, the dearest rate any eligible host can charge there (a host's rate at b is its base-counted price raised by every tier of its own from <= b); only a threshold
  // that raises either side above the step before it is written, ascending, so rateFor(promptTokens) gives the dearest a call of that size can be billed at.
  const cuts = [...new Set(eligible.flatMap(e => e.tiers.map(t => t.from)))].sort((a, b) => a - b);
  const rateAt = b => ({ in: Math.max(...eligible.map(e => Math.max(e.cin, ...e.tiers.filter(t => t.from <= b).map(t => t.in)))), out: Math.max(...eligible.map(e => Math.max(e.cout, ...e.tiers.filter(t => t.from <= b).map(t => t.out)))) });
  const rowTiers = []; let prev = { in: baseHigh('in'), out: baseHigh('out') };
  for (const b of cuts) { const r = rateAt(b); if (r.in > prev.in + 1e-9 || r.out > prev.out + 1e-9) { const t = { from: b, in: Math.max(r.in, prev.in), out: Math.max(r.out, prev.out) }; rowTiers.push(t); prev = t; } }
  return { eligible, all, rowTiers, hosts: { checked: HOSTS_READ ?? TODAY, count: eligible.length, providers: new Set(eligible.map(e => e.provider)).size, in: side('in'), out: side('out'), ...(tierDriven ? { tier_driven: true } : {}), filters } };
}

const changes = []; const lines = []; const unlisted = []; const hostEdits = []; const noHosts = []; const hostLines = [];
for (const [key, row] of Object.entries(table)) {
  if (!key.startsWith('openrouter/') || !row || typeof row !== 'object') continue;
  const id = key.slice('openrouter/'.length);
  const m = live.get(id);
  if (!m) { lines.push(`${id}: NOT LISTED any more`); unlisted.push(id); continue; }
  const li = perM(m.pricing.prompt), lo = perM(m.pricing.completion);
  const pic = row.expires ? null : hostPicture(id);
  const h = pic?.hosts;
  const dearest = h ? pic.eligible.filter(e => same(e.out, h.out.high) || same(e.in, h.in.high)).map(e => `${e.tag} ${e.quant} ctx ${e.ctx ?? '?'}`).join(', ') : '';
  const note = pic?.note ? `  ${pic.note}` : h ? `  dearest eligible host ${h.in.high}/${h.out.high} (n=${h.count}; lowest ${h.in.low}/${h.out.low}, median ${h.in.median}/${h.out.median}; dearest: ${dearest})` : '';
  if (h) hostEdits.push({ key, hosts: h, tiers: pic.rowTiers });
  else if (!row.expires) noHosts.push(id);
  if (listHosts && pic?.all) for (const e of [...pic.all].sort((x, y) => x.out - y.out)) hostLines.push(`    ${id}  ${e.tag.padEnd(30)} ${e.quant.padEnd(10)} ctx ${String(e.ctx ?? '?').padEnd(8)} max ${String(e.maxc ?? 'unpublished').padEnd(11)} ${e.in}/${e.out}${e.tiers.length ? `   (base ${e.bin}/${e.bout}; tier from ${e.tiers.map(t => `${t.from} tokens ${t.in}/${t.out}`).join(', ')})` : ''}${e.out_reason ? `   OUT: ${e.out_reason}` : ''}`);
  if (row.expires) { lines.push(`${id}: file ${row.in}/${row.out}, list ${r6(li)}/${r6(lo)}: KEPT (expires ${row.expires})`); continue; }
  const evidence = `${fileOf(id)}.json`;
  if (h?.tier_driven) {
    // the TIER part is held, the HOST part is not: a tier-driven row counts the higher of today's figure and the dearest eligible host at BASE price (region variants counted, never lowered)
    const baseIn = Math.max(...pic.eligible.map(e => e.cin)), baseOut = Math.max(...pic.eligible.map(e => e.cout));
    const newIn = Math.max(row.in, baseIn), newOut = Math.max(row.out, baseOut);
    const heldNote = `the dearest tier is ${h.in.high}/${h.out.high}: no single figure prices it right; the tier is recorded in the row's tiers and not yet counted`;
    if (!same(newIn, row.in) || !same(newOut, row.out)) {
      lines.push(`${id}: file ${row.in}/${row.out} -> ${newIn}/${newOut} (the dearest eligible host at base price; tier part held: ${heldNote})${note}  ${hostsOnly ? 'RAISE NOT APPLIED (--hosts-only)' : 'RAISED'}  evidence ${evidence}`);
      if (!hostsOnly) changes.push({ key, row, newIn, newOut, evidence, n: h.count, dir: 'RAISED', basePart: true });
    } else lines.push(`${id}: file ${row.in}/${row.out} HELD (tier part: ${heldNote}; the base-price dearest host is ${baseIn}/${baseOut}, not above today's figure)${note}`);
    continue;
  }
  if (h) {
    // the row is the dearest eligible host, per side, in both directions
    const newIn = h.in.high, newOut = h.out.high;
    if (!same(newIn, row.in) || !same(newOut, row.out)) {
      const dir = newIn >= row.in && newOut >= row.out ? 'RAISED' : newIn <= row.in && newOut <= row.out ? 'LOWERED' : 'CHANGED (one side up, one down)';
      lines.push(`${id}: file ${row.in}/${row.out} -> ${newIn}/${newOut}${note}  ${hostsOnly ? `${dir} NOT APPLIED (--hosts-only)` : dir}  evidence ${evidence}`);
      if (!hostsOnly) changes.push({ key, row, newIn, newOut, evidence, n: h.count, dir });
    } else lines.push(`${id}: file ${row.in}/${row.out} = dearest eligible host${note}`);
    if (li > newIn * 1.05 || lo > newOut * 1.05) lines.push(`    (the list's headline ${r6(li)}/${r6(lo)} is above the dearest eligible host: a tier or a host the eligibility rules leave out)`);
    continue;
  }
  const newIn = li > row.in * 1.05 ? r6(li) : row.in, newOut = lo > row.out * 1.05 ? r6(lo) : row.out;
  if (newIn !== row.in || newOut !== row.out) {
    lines.push(`${id}: file ${row.in}/${row.out} -> ${newIn}/${newOut} (list ${r6(li)}/${r6(lo)})${note}  ${hostsOnly ? 'RAISE NOT APPLIED (--hosts-only)' : 'RAISED'}`);
    if (!hostsOnly) changes.push({ key, row, newIn, newOut, li, lo, dir: 'RAISED' });
  } else if (row.in > li * 1.05 || row.out > lo * 1.05) lines.push(`${id}: file ${row.in}/${row.out} ABOVE list ${r6(li)}/${r6(lo)}: kept (no host picture, so the old rule: never lowered)${note}`);
  else lines.push(`${id}: file ${row.in}/${row.out} = list${note}`);
}
const proposals = {}; const proposalLines = [];
// The page's speed per row (tokens per second, P50): matched to an endpoint by provider name and both base prices, exactly as the routing flag is. Unmatched or unpublished = unknown (no penalty).
function pageSpeeds(html) {
  const out = [];
  for (const p of html.split(/<tr[\s>]/).slice(1)) {
    const name = /aria-label="Open (.+?) details"/.exec(p)?.[1]; const tps = /(\d+)<span class="text-muted-foreground"> tps<\/span>/.exec(p)?.[1];
    if (!name || !tps) continue;
    out.push({ name, prices: [...p.matchAll(/\$(\d+(?:\.\d+)?)/g)].map(m => Number(m[1])), tps: Number(tps) });
  }
  return out;
}
const QUANT_RANK = q => { const x = String(q).toLowerCase(); if (/bf16|fp16|f16/.test(x)) return 0; if (/fp8|int8/.test(x)) return 1; if (/fp4|mxfp4|nvfp4|int4/.test(x)) return 2; return 3; };
// A model's NATIVE endpoints (its maker's own host and the partners licensed to serve it at full precision) carry no quantization field and sort first, ahead of the quantization order (C&C ruling, 1 Nov 2026: "native OpenAI/Azure endpoints"
// for OpenAI's models). Native is relative to the MODEL: openai/* is native on openai and azure; the anthropic/* and google/* entries are this script's extension of that ruling. An open-weight model on azure or bedrock with no stated
// quantization is NOT native: it sorts with "not stated".
const NATIVE_BY_AUTHOR = { openai: ['openai', 'azure'], anthropic: ['anthropic', 'amazon-bedrock', 'google-vertex', 'azure'], google: ['google-vertex', 'google-ai-studio'] };
const orderKey = (e, id) => (NATIVE_BY_AUTHOR[id.split('/')[0]]?.includes(e.tag.split('/')[0]) && /unknown/i.test(e.quant) ? -1 : QUANT_RANK(e.quant));
let userRows = {}; if (userPricesFile) userRows = JSON.parse(readFileSync(userPricesFile, 'utf8'));
if (proposeArg) {
  const wanted = proposeArg === 'all' ? null : new Set(proposeArg.split(','));
  const ids = chainSeats ? [...chainSeats.keys()] : Object.entries(table).filter(([key, row]) => key.startsWith('openrouter/') && !row?.expires).map(([key]) => key.slice('openrouter/'.length));
  for (const id of ids) {
    if (wanted && !wanted.has(id)) continue;
    const key = `openrouter/${id}`;
    const pic = hostPicture(id); if (!pic?.eligible?.length) { proposalLines.push(`${id}: no proposal (${pic?.note ?? 'no endpoints answer given'})`); continue; }
    const med = k => { const v = pic.eligible.map(e => e[k]).sort((a, b) => a - b); const n = v.length; return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; };
    const mIn = med('bin'), mOut = med('bout');
    const shipped = table[key]; const user = userRows[key];
    const row = (shipped || user) ? { in: Math.max(shipped?.in ?? 0, user?.in ?? 0), out: Math.max(shipped?.out ?? 0, user?.out ?? 0) } : null;
    const aboveRow = e => row && (e.bin > row.in + 1e-9 || e.bout > row.out + 1e-9);
    const needOut = chainSeats?.get(id)?.maxTokens ?? maxOutput;
    const okCtx = e => (largestCall === null || (e.ctx !== null && e.ctx >= largestCall)) && (needOut === null || needOut === undefined || (e.maxc !== null && e.maxc >= needOut));
    const banSet = [...ignoreSlugs, ...(chainSeats?.get(id)?.ignore ?? [])];
    const banned = e => banSet.some(g => e.tag === g || e.tag.startsWith(`${g}/`));
    const atOrBelow = e => e.bin <= mIn + 1e-12 && e.bout <= mOut + 1e-12; const below = e => e.bin < mIn - 1e-12 && e.bout < mOut - 1e-12;
    const usable = f => pic.eligible.filter(e => f(e) && okCtx(e) && !banned(e));
    const inScope = strictBelow ? below : atOrBelow;
    // speeds from the page (when it is there)
    const pf = pageDir ? join(pageDir, `${fileOf(id)}.html`) : null; const speeds = pf && existsSync(pf) ? pageSpeeds(readFileSync(pf, 'utf8')) : [];
    const tpsOf = e => { const hit = speeds.filter(r => { const pn = norm(e.provider), rn = norm(r.name); return pn && (rn.startsWith(pn) || pn.startsWith(rn)) && r.prices.some(x => Math.abs(x - e.bin) < 1e-4) && r.prices.some(x => Math.abs(x - e.bout) < 1e-4); }); return hit.length === 1 ? hit[0].tps : null; };
    const big = largestOut.get(id) ?? null;
    const slow = e => big !== null && tpsOf(e) !== null && big / tpsOf(e) >= 0.8 * wallSeconds;
    const kept = usable(inScope).sort((a, b) => (slow(a) - slow(b)) || (orderKey(a, id) - orderKey(b, id)) || (a.bout - b.bout) || (a.bin - b.bin) || (a.tag < b.tag ? -1 : 1));
    const dropped = pic.eligible.filter(e => inScope(e) && (!okCtx(e) || banned(e)));
    if (!kept.length) { proposalLines.push(`${id}: no proposal (no eligible host at or below the base median ${mIn}/${mOut} survives the context and ignore filters)`); continue; }
    proposals[key] = { prefer: kept.map(e => e.tag) };
    // a bare tag (no variant or region) matches every region and variant of that provider at OpenRouter, but NOT a service-tier endpoint (docs read 2026-11-01): list the siblings it would also pull in
    const sibs = t => pic.all.filter(e => e.tag.startsWith(`${t}/`) && !e.tier && !isFastTierValue(e.tier) && !FAST_TIER.test(e.tag));
    const bareLines = kept.filter(e => !e.tag.includes('/')).flatMap(e => { const sb = sibs(e.tag); return sb.length ? [`      BARE TAG ${e.tag} also matches: ${sb.map(x => `${x.tag} (base ${x.bin}/${x.bout}${x.out_reason ? `, OUT: ${x.out_reason}` : ''}${aboveRow(x) ? ', ABOVE THE ROW' : ''})`).join(', ')}`] : []; });
    proposalLines.push(`${id}: base median ${r6(mIn)}/${r6(mOut)}${row ? `; effective row ${row.in}/${row.out}` : '; no row (price it in pricing.user.json)'}; ${pic.eligible.length} eligible hosts (at or below the median: ${usable(atOrBelow).length} usable, strictly below: ${usable(below).length} usable); prefer ${kept.length} (${strictBelow ? 'strictly below' : 'at or below'}; order: native first, then quantization high to low, then OUTPUT price (input price breaks ties)${big !== null ? `, hosts too slow for ${big} tokens inside ${wallSeconds} s last` : ''}):${kept.map(e => `\n      ${e.tag}  ${e.quant}  ctx ${e.ctx ?? '?'}  base ${e.bin}/${e.bout}${tpsOf(e) !== null ? `  ${tpsOf(e)} tok/s${slow(e) ? ' (TOO SLOW, last)' : ''}` : ''}${aboveRow(e) ? '  ABOVE THE ROW (filtered out by the price limit)' : ''}`).join('')}${bareLines.length ? `\n${bareLines.join('\n')}` : ''}${dropped.length ? `\n    left off (context shorter than ${largestCall}, output limit below ${needOut ?? '(not given)'}, or ignored): ${dropped.map(e => e.tag).join(', ')}` : ''}`);
  }
}
console.log(lines.join('\n'));
if (proposeArg) {
  console.log(`\nproposed provider-preference.json (A-DRAFT; below-or-at the base median on both sides; native endpoints first, then quantization high to low, then price; the operator copies and edits it):\n${proposalLines.join('\n')}`);
  const outDir = args.includes('--propose-out') ? resolve(args[args.indexOf('--propose-out') + 1]) : epDir;   // default: beside the fetched answers; --propose-out names another folder
  { const rel = args.includes('--propose-out') ? relative(root, outDir) : null; if (rel !== null && (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))) { console.error(`\nrefused: the proposal folder ${outDir} is inside the repository. Name a folder outside it (the proposal is the operator's input, not source).`); process.exit(2); } }
  if (outDir && Object.keys(proposals).length) { mkdirSync(outDir, { recursive: true }); const out = join(outDir, 'proposed-provider-preference.json'); writeFileSync(out, `${JSON.stringify(proposals, null, 2)}\n`); console.log(`\nwrote ${out}`); }
}
if (hostLines.length) console.log(`\nhosts (precision, context length, output limit; OUT = left out of the figures):\n${hostLines.join('\n')}`);
if (fetchFailed.length) console.error(`\nnot fetched (${fetchFailed.length}):\n  ${fetchFailed.join('\n  ')}`);
// A-DRAFT (lane E, 24 Okt 2026; maintainer-script sentence): a row the list no longer names was never compared, so the stamp must not say it was.
if (unlisted.length) {
  console.error(`\nrefused: ${unlisted.length} openrouter/ row(s) are not on OpenRouter's list any more (${unlisted.join(', ')}), so they could not be compared. Nothing was written and _openrouterCheckedAt was not moved. Remove the row (a seat on it cannot be called) or re-key it to the model's new id, then run this again.`);
  process.exit(2);
}
// A-DRAFT (PRICES lane, 1 Nov 2026; maintainer-script sentence): with --fetch a model whose endpoints answer or page could not be read gets no host picture, and a half-refreshed table is not written.
if (write && fetchDir && fetchFailed.length) {
  console.error(`\nrefused: ${fetchFailed.length} answer(s) could not be fetched, so the host picture would be incomplete. Nothing was written. Run this again.`);
  process.exit(2);
}
// A-DRAFT (PRICES lane, 1 Nov 2026; maintainer-script sentence): old saved answers must not get today's date.
if (write && !hostsOnly && epDir && hostEdits.length && HOSTS_READ !== TODAY) {
  console.error(`\nrefused: the answers were read on ${HOSTS_READ ?? 'an unknown day'}, not today (${TODAY}), and a host's price moves within a day. Nothing was written. Run again with --fetch <folder>.`);
  process.exit(2);
}
if (write && hostEdits.length && !HOSTS_READ) {
  console.error(`\nrefused: ${epDir} has no _fetch.json (written by --fetch) and PRICING_CHECKED_AT is not set, so the day these answers were read is unknown. Nothing was written. Run with --fetch <folder> instead.`);
  process.exit(2);
}
if (write) {
  // Text-level edit, so the rest of the file keeps its formatting (1.0 stays 1.0) and the diff shows only the rows that changed.
  let text = readFileSync(pricingPath, 'utf8');
  const num = n => (Number.isInteger(n) ? `${n}.0` : String(n));
  // the end of the row object that starts at `start` (the first line that closes it at the table's indent)
  const rowEnd = (key, start) => { const end = text.indexOf('\n  }', start); if (start < 0 || end < 0) throw new Error(`cannot find the row ${key} in src/pricing.json`); return end; };
  for (const c of changes) {
    const start = text.indexOf(`"${c.key}": {`);
    const end = rowEnd(c.key, start);
    let block = text.slice(start, end);
    const was = `${c.row.in}/${c.row.out}`;
    block = block.replace(/"in":\s*[0-9.]+/, `"in": ${num(c.newIn)}`).replace(/"out":\s*[0-9.]+/, `"out": ${num(c.newOut)}`);
    const add = c.evidence
      ? `openrouter.ai/api/v1/models/${c.key.slice('openrouter/'.length)}/endpoints and the model page, read ${HOSTS_READ}: counted price set to the dearest eligible host ${c.basePart ? 'at base price ' : ''}${num(c.newIn)}/${num(c.newOut)} per Mtok (${c.n} hosts${c.basePart ? '; its price tier is not counted yet' : ''}), was ${was}`
      : `openrouter.ai/api/v1/models re-read ${TODAY}: list ${r6(c.li)}/${r6(c.lo)} per Mtok, raised from ${was} (the cap was projecting less than the list)`;
    block = /"_source":\s*"/.test(block) ? block.replace(/("_source":\s*")((?:[^"\\]|\\.)*)"/, (m, pre, body) => `${pre}${body}; ${add}"`) : block.replace(/("out":\s*[0-9.]+)/, `$1,\n    "_source": ${JSON.stringify(add)}`);
    text = text.slice(0, start) + block + text.slice(end);
  }
  // the `hosts` block is always the LAST key of its row; an older one is removed first, so a second run replaces rather than stacks, and no other byte of the row moves
  for (const h of hostEdits) {
    const start = text.indexOf(`"${h.key}": {`);
    const end = rowEnd(h.key, start);
    let block = text.slice(start, end);
    const at = block.indexOf(',\n    "hosts": {');
    if (at >= 0) block = block.slice(0, at);
    block = block.replace(/,\n    "tiers": \[[^\n]*\]/, '');   // a stale tiers line goes; the fresh one (if any) is written before the host picture
    const tiersLine = h.tiers?.length ? `,\n    "tiers": ${JSON.stringify(h.tiers.map(t => ({ from: t.from, in: t.in, out: t.out })))}` : '';
    const pretty = JSON.stringify(h.hosts, null, 2).split('\n').map((l, i) => (i ? `    ${l}` : l)).join('\n');
    block = `${block}${tiersLine},\n    "hosts": ${pretty}`;
    text = text.slice(0, start) + block + text.slice(end);
  }
  if (!/"_openrouterCheckedAt"/.test(text) && !hostsOnly) text = text.replace(/("asOf":\s*"[^"]*",?\n)/, `$1  "_openrouterCheckedAt": "${TODAY}",\n  "_openrouterStaleDays": 45,\n  "_openrouterNote": "The date every openrouter/* row was last compared with OpenRouter's live model list (scripts/refresh-openrouter-prices.mjs, which only RAISES a row below the list). test/pricing-freshness.test.js turns red _openrouterStaleDays after it: re-run the script before then (MAN-7). Direct-provider rows (anthropic/, openai/, google/...) are NOT covered by this date: they carry their own _source dates.",\n`);
  else if (!hostsOnly) text = text.replace(/"_openrouterCheckedAt":\s*"[^"]*"/, `"_openrouterCheckedAt": "${HOSTS_READ ?? TODAY}"`);
  // A-DRAFT (PRICES lane, 1 Nov 2026): the note says what the date now means
  if (!hostsOnly && changes.some(c => c.evidence)) text = text.replace(/("_openrouterNote":\s*")((?:[^"\\]|\\.)*)"/, (m, pre) => `${pre}The day every openrouter/* row WITHOUT an \`expires\` date was last compared with OpenRouter's endpoints (scripts/refresh-openrouter-prices.mjs --fetch <folder> --write, answers read the same day): a row is the dearest eligible host per side, raised or lowered (a row whose dearest figure depends on a price tier counts the higher of today's figure and its dearest eligible host at base price; its tier part is recorded in the row's \`tiers\` and not yet counted by the spend cap, and its \`hosts\` block says \`tier_driven\`), and its \`hosts\` block records the check date, the host count, the lowest, median and highest price and the filters used. The script refuses to move this date while a row is not on OpenRouter's list or while the answers are not from today. test/pricing-freshness.test.js turns red _openrouterStaleDays after it: re-run the script before then (MAN-7). Direct-provider rows (anthropic/, openai/, google/...) are NOT covered by this date: they carry their own _source dates."`);
  JSON.parse(text); // still valid
  writeFileSync(pricingPath, text);
  if (changes.length) console.log('\nA price moved: now run node scripts/regen-derived-figures.mjs (every figure that derives from the rows), then re-record the plan-high-council hash pin in test/plan-tiers.test.js by hand if its description changed.');
  console.log(`\nwrote ${pricingPath}: ${changes.length} row(s) changed (${changes.filter(c => c.dir === 'RAISED').length} raised, ${changes.filter(c => c.dir === 'LOWERED').length} lowered), ${hostEdits.length} host picture(s) written${noHosts.length ? ` (none for ${noHosts.length} row(s): no endpoints answer given)` : ''}, _openrouterCheckedAt ${hostsOnly ? 'not moved' : (HOSTS_READ ?? TODAY)}`);
} else console.log(`\n(dry: ${changes.length} row(s) would change, ${hostEdits.length} host picture(s) would be written; pass --write)`);
