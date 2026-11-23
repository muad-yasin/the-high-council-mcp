#!/usr/bin/env node
// Regenerates every public figure that DERIVES from the price table, so a refresh of src/pricing.json (scripts/refresh-openrouter-prices.mjs) cannot leave a shipped number behind.
//   node scripts/regen-derived-figures.mjs           rewrite what is stale (repeats until nothing moves), print each change
//   node scripts/regen-derived-figures.mjs --check   write nothing; exit 1 and name every stale figure (or false comparison sentence)
// RUN IT AFTER every price change (the refresh script prints a reminder). It is the one entry point for: the README Pricing table (scripts/pricing-table.mjs); the dry-run figures printed in the shipped planning chains'
// descriptions, the AI-README table rows and sentences, the README rows and the landing-page sentence; the sentences that compare the upper estimate or the cheapest end with the default cap (rewritten when a figure crosses it,
// and CHECKED in both directions); the review-notes Known-limit bullet's dollar bounds in KNOWN-LIMITS.md ("at the table prices"); and maintainers/MODEL-CAPS.md (scripts/model-caps-report.mjs).
// Every figure comes from the code the tests re-derive it with (dryRunReport, estimateChainRows, priceOf; the review-notes bound is the exported function `reviewNotesBound` below, which test/notes-lane-on.test.js
// NL-4b imports, so one code path makes the README figure and the test's expected figure); nothing is typed. (0.8.4: the advice chains left the package, so the max_price pins of RA-7 and the Known limit that printed advise-standard's ceiling are no longer derived here.)
// (The first form of this header, in commit 238cc81c, claimed more than it did; commit 4fc44a96 corrected it for the review-notes bound.) NOT covered, by design: the plan-high-council hash pin in test/plan-tiers.test.js (a
// test constant: its CHANGED note is written by hand) and the prose of a Known limit (a sentence that became false is rewritten by the person who moves the price).
// test/regen-derived-figures.test.js runs the derivation with a deliberately wrong figure and on the committed tree. (PRICES lane, 1 Nov 2026; born from two misses: unit 2's NL-4b and the 0.8.3 NL-4b-style readers no per-commit set could see.)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryRunReport } from '../src/dry-run.js';
import { DEFAULT_MAX_USD, DESKTOP_DEFAULT_MAX_USD } from '../src/default-cap.js';
import { priceOf, cacheInputMultOf } from '../src/cost.js';
import { estimateChainRows, previewOfLadder } from '../src/cost.js';
import { roundLimitsOf } from '../src/overseer-rounds.js';
import { MEMORY_MAX_TOKENS_EST } from '../src/review-notes.js';
import { generatePricingTable, START, END } from './pricing-table.mjs';
import { generateModelCaps, OUT_FILE } from './model-caps-report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = join(here, '..');
const usd = n => `$${n.toFixed(2)}`;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const swapAll = (text, from, to) => text.replace(new RegExp(`${esc(from)}(?![0-9])`, 'g'), () => to);
/** The README review-notes Known-limit bound of one lane chain, in dollars with two decimals: the memory block (up to MEMORY_MAX_TOKENS_EST tokens per call at each paid judge's input price) x the later overseer rounds x the passes of an overseer round. test/notes-lane-on.test.js NL-4b calls this same function. */
export function reviewNotesBound(c) {
  const block = c.seats.critics.reduce((s, x) => s + (x.provider === 'external' ? 0 : (MEMORY_MAX_TOKENS_EST / 1e6) * priceOf(x.provider, x.model).in * cacheInputMultOf(x.provider, x.model)), 0);
  // 0.8.4 (commit 8): a LADDER chain has no overseer-round count; the bound is on the dry run's UPPER basis, in top-layer reads: the later reads (reads - 1) x the passes of one read's full climb (layer-1 passes + layer-2 visits + the read itself). An overseer chain keeps its own count and bounds.
  const ladder = previewOfLadder(roundLimitsOf(c), true);
  const rounds = ladder ? ladder.reads : c.maxOverseerRounds;
  const passes = ladder ? ladder.climb[1] + ladder.climb[2] + 1 : 1 + Object.values(c.layerRevisions ?? {}).reduce((a, b) => a + b, 0);
  return (block * (rounds - 1) * passes).toFixed(2);
}
/** One pass. `overlay` (rel path -> text) replaces what is on disk, for the test. Returns { changes: Map(rel -> new text), notes: [string], problems: [string] }. */
export function deriveOnce(root = DEFAULT_ROOT, overlay = new Map()) {
  const base = rel => (overlay.has(rel) ? overlay.get(rel) : readFileSync(join(root, rel), 'utf8'));
  const work = new Map();
  const get = rel => (work.has(rel) ? work.get(rel) : base(rel));
  const set = (rel, text) => work.set(rel, text);
  const notes = []; const problems = [];
  const chainNames = dir => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : []);
  // every shipped chain (0.8.4: the advice chains left chains/outdated/ and chains/ with the add-on; the retired planning chains keep the figures they were retired with)
  const relMap = new Map(); for (const n of chainNames('chains')) relMap.set(n, `chains/${n}.json`);
  const allChains = () => [...relMap.keys()];
  const relOf = name => relMap.get(name) ?? `chains/${name}.json`;
  const chainOf = name => JSON.parse(get(relOf(name)));

  // 1. the README Pricing table
  { const t = get('README.md'); const a = t.indexOf(START), b = t.indexOf(END);
    if (a >= 0 && b > a) { const next = t.slice(0, a) + generatePricingTable(root) + t.slice(b + END.length); if (next !== t) { set('README.md', next); notes.push('README pricing table'); } } }

  // 3. the dry-run figures in the planning chains' descriptions, the AI-README rows and sentences, the README, the landing sentence
  for (const name of allChains()) {
    const rel = relOf(name); const c = chainOf(name); const d = c.description || '';
    const mE = /(\$[0-9][0-9,.]*[0-9]) expected/.exec(d); const mM = /upper estimate of (\$[0-9][0-9,.]*[0-9])/.exec(d);
    if (!mE || !mM) continue;
    const r = dryRunReport(c, { defaultCapUsd: DEFAULT_MAX_USD }).estimate;
    const nE = usd(r.expectedUsd), nM = usd(r.maximumUsd);
    const mF = /cheapest end,? \(?(\$[0-9]+(?:\.[0-9]+)?)/.exec(d); const nF = Number.isFinite(r.floorUsd) ? usd(r.floorUsd) : null;
    const all = [[mE[1], nE, 'expected'], [mM[1], nM, 'upper estimate'], ...(mF && nF ? [[mF[1], nF, 'cheapest end']] : [])];
    // two figures may print the same value (the quick-start chain: expected = cheapest end); that is fine while they move to the same new value, and a problem when one printed value would have to become two
    const target = new Map(); let clash = null;
    for (const [a, b] of all) { if (target.has(a) && target.get(a) !== b) clash = a; target.set(a, b); }
    if (clash) { problems.push(`${name}: the printed value ${clash} stands for two figures that now differ (${all.filter(x => x[0] === clash).map(x => `${x[2]} ${x[1]}`).join(', ')}); fix by hand`); continue; }
    const pairs = [...target].filter(([a, b]) => a !== b).map(([a, b]) => [a, b, all.filter(x => x[0] === a).map(x => x[2]).join(' and ')]);
    if (!pairs.length) continue;
    set(rel, pairs.reduce((s, [a, b]) => swapAll(s, a, b), get(rel)));
    for (const doc of ['AI-README.md', 'README.md']) set(doc, get(doc).split('\n').map(l => ((l.startsWith(`| \`${name}\` |`) || l.includes(`\`${name}\` expects `)) ? pairs.reduce((s, [a, b]) => swapAll(s, a, b), l) : l)).join('\n'));
    if (name === 'plan-mini-council' && (existsSync(join(root, 'docs/index.html')) || overlay.has('docs/index.html'))) set('docs/index.html', pairs.reduce((s, [a, b]) => s.replace(new RegExp(`(it is expected to cost |with an upper estimate of )${esc(a)}(?![0-9])`, 'g'), (m, p1) => p1 + b), get('docs/index.html')));
    notes.push(`${name}: ${pairs.map(([a, b, w]) => `${w} ${a} -> ${b}`).join('; ')}`);
  }

  // 4. the sentences that compare a figure with the default cap: rewritten when a figure crossed it, CHECKED both ways
  const cap = `$${DEFAULT_MAX_USD}`;
  for (const name of allChains().filter(n => /^plan-/.test(n))) {
    const rel = relOf(name); const c = chainOf(name); const d = c.description || '';
    if (!/ expected/.test(d)) continue;
    const r = dryRunReport(c, { defaultCapUsd: DEFAULT_MAX_USD }).estimate;
    if (!(r.floorUsd > DEFAULT_MAX_USD) && /cheapest end \(\$[0-9.,]+[^)]*\)\s+(?:are|is) above the default cap/.test(d)) problems.push(`${name}: the description says the cheapest end is above the default cap of ${cap}, but ${usd(r.floorUsd)} is not`);
    // the expected figure itself above the cap (the ladder's expected shape is three top-layer reads): a sentence that says it fits under the cap is false and is not rewritten here, a person writes it (the owner's call: the default cap or the sentence)
    if (r.expectedUsd > DEFAULT_MAX_USD && /expected figure \(\$[0-9.,]+\) fits under it/.test(d)) problems.push(`${name}: the description says the expected figure fits under the default cap of ${cap}, but ${usd(r.expectedUsd)} does not; write the sentence by hand`);
    if (!(r.maximumUsd > DEFAULT_MAX_USD)) {
      if (d.includes(`above the default cap of ${cap}`)) problems.push(`${name}: the description says a figure is above the default cap of ${cap}, but the upper estimate ${usd(r.maximumUsd)} is not`);
      continue;
    }
    // upper estimate above the cap
    const oldFits = `Every figure printed here fits under the ${cap} default cap, and under the Claude Desktop bundle's default Spend ceiling of $${DESKTOP_DEFAULT_MAX_USD}.`;
    if (d.includes(oldFits)) {
      if (r.maximumUsd > DESKTOP_DEFAULT_MAX_USD) { problems.push(`${name}: above the Claude Desktop ceiling too; write the description sentence by hand`); continue; }
      set(rel, get(rel).split(oldFits).join(`The upper estimate (${usd(r.maximumUsd)}) is above the default cap of ${cap}; the expected figure (${usd(r.expectedUsd)}) fits under it. On the command line that cap is not a limit for a paid run: it is the figure the dry run compares a chain with. Every figure printed here fits under the Claude Desktop bundle's default Spend ceiling of $${DESKTOP_DEFAULT_MAX_USD}.`));
      const oldRow = `Every figure fits under the default cap of ${cap}. This roster has not run.`;
      set('AI-README.md', get('AI-README.md').split('\n').map(l => (l.startsWith(`| \`${name}\` |`) && l.includes(oldRow)) ? l.replace(oldRow, `Its upper estimate (${usd(r.maximumUsd)}) is above the default cap of ${cap}; the expected figure (${usd(r.expectedUsd)}) fits under it. This roster has not run.`) : l).join('\n'));
      notes.push(`${name}: "fits under the default cap" sentence rewritten (upper estimate ${usd(r.maximumUsd)})`);
    }
    // the cheapest end itself above the cap
    if (r.floorUsd > DEFAULT_MAX_USD) {
      const oldD = `The upper estimate (${usd(r.maximumUsd)}) is above the default cap of ${cap}.`;
      const newD = `The upper estimate (${usd(r.maximumUsd)}) and the cheapest end (${usd(r.floorUsd)}, one overseer round, the dry run's floor) are above the default cap of ${cap}.`;
      if (get(rel).includes(oldD)) { set(rel, get(rel).split(oldD).join(newD)); notes.push(`${name}: cheapest end ${usd(r.floorUsd)} sentence rewritten`); }
      const oldR = `Its upper estimate (${usd(r.maximumUsd)}) is above the default cap of ${cap}; the cheapest end (${usd(r.floorUsd)}) fits under it.`;
      const newR = `Its upper estimate (${usd(r.maximumUsd)}) and cheapest end (${usd(r.floorUsd)}) are above the default cap of ${cap}.`;
      if (get('AI-README.md').includes(oldR)) { set('AI-README.md', get('AI-README.md').split(oldR).join(newR)); notes.push(`${name}: AI-README row rewritten`); }
    }
  }

  // 6. the review-notes Known-limit bullet (KNOWN-LIMITS.md since 0.8.4; it was in README.md): block x judges x later overseer rounds x passes, at the table prices (test/notes-lane-on.test.js NL-4b computes the same)
  for (const name of allChains()) {
    const re = new RegExp('\\$[0-9]+\\.[0-9]{2} for `' + esc(name) + '`'); const limits = get('KNOWN-LIMITS.md'); if (!re.test(limits)) continue;
    const fresh = `$${reviewNotesBound(chainOf(name))} for \`${name}\``; const old = re.exec(limits)[0];
    if (old !== fresh) { set('KNOWN-LIMITS.md', limits.replace(old, () => fresh)); notes.push(`KNOWN-LIMITS.md review-notes bound for ${name}: ${old.split(' ')[0]} -> ${fresh.split(' ')[0]}`); }
  }

  // 7. maintainers/MODEL-CAPS.md
  { const next = generateModelCaps(root); const cur = get(OUT_FILE); if (next !== cur) { set(OUT_FILE, next); notes.push(`${OUT_FILE}`); } }

  const changes = new Map();
  for (const [rel, text] of work) if (text !== base(rel)) changes.set(rel, text);
  return { changes, notes, problems };
}

/** Writes and repeats until nothing moves (a pin or a ceiling that moved changes what the table and the caps report compute). Returns { notes, problems, passes }. */
export function deriveAndWrite(root = DEFAULT_ROOT) {
  const notes = []; let problems = [];
  for (let pass = 1; pass <= 5; pass++) {
    const r = deriveOnce(root); problems = r.problems;
    if (!r.changes.size) return { notes, problems, passes: pass };
    for (const [rel, text] of r.changes) writeFileSync(join(root, rel), text);
    notes.push(...r.notes);
  }
  return { notes, problems: [...problems, 'did not settle after 5 passes'], passes: 5 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const r = deriveOnce();
    for (const n of r.notes) console.error(`stale: ${n}`);
    for (const p of r.problems) console.error(`problem: ${p}`);
    if (r.changes.size || r.problems.length) { console.error(`\nCheck failed: ${r.changes.size} file(s) hold a figure that is not what the price table gives (node scripts/regen-derived-figures.mjs rewrites them); any problem listed above needs a fix by hand.`); process.exit(1); }
    console.log('every derived figure is current');
  } else {
    const r = deriveAndWrite();
    for (const n of r.notes) console.log(n);
    for (const p of r.problems) console.error(`problem: ${p}`);
    console.log(r.notes.length ? `\nwrote ${r.notes.length} change(s) in ${r.passes} pass(es)` : 'nothing to change');
    if (r.problems.length) process.exit(1);
  }
}
