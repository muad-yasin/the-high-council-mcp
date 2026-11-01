#!/usr/bin/env node
// Regenerates every public figure that DERIVES from the price table, so a refresh of src/pricing.json (scripts/refresh-openrouter-prices.mjs) cannot leave a shipped number behind.
//   node scripts/regen-derived-figures.mjs           rewrite what is stale (repeats until nothing moves), print each change
//   node scripts/regen-derived-figures.mjs --check   write nothing; exit 1 and name every stale figure (or false comparison sentence)
// RUN IT AFTER every price change (the refresh script prints a reminder). It is the one entry point for: the README Pricing table (scripts/pricing-table.mjs); the dry-run figures printed in the shipped planning chains'
// descriptions, the AI-README table rows and sentences, the README rows and the landing-page sentence; the sentences that compare the upper estimate or the cheapest end with the default cap (rewritten when a figure crosses it,
// and CHECKED in both directions); the advice chains' max_price pins (RA-7: an advice seat that was not raised in the 0.8.1 audit pins max_price EQUAL to its row); the advice ceilings (advise.usd) and the derivation sentences
// of advise-single-glm-flash and advise-single-deepseek; the README review-notes Known-limit bullet's dollar bounds ("at the table prices"); and maintainers/MODEL-CAPS.md (scripts/model-caps-report.mjs).
// Every figure comes from the code the tests re-derive it with (dryRunReport, estimateChainRows, priceOfChain, priceOf; the review-notes bound is the exported function `reviewNotesBound` below, which test/notes-lane-on.test.js
// NL-4b imports, so one code path makes the README figure and the test's expected figure); nothing is typed. ONE rule for the advice ceilings (C&C, 1 Nov 2026): a ceiling whose description PRINTS its derivation (advise-single, advise-single-qwen, advise-single-glm-flash,
// advise-single-deepseek) floats both ways with the rows; a ceiling with no printed derivation (advise-standard, -astra, -opus, -gemini) is typed and untouched here. The RA-7 exemption list is exported below and imported by its test.
// (The first form of this header, in commit 238cc81c, claimed more than it did; commit 4fc44a96 corrected it for the review-notes bound.) NOT covered, by design: the plan-high-council hash pin in test/plan-tiers.test.js (a
// test constant: its CHANGED note is written by hand) and the prose of a Known limit (a sentence that became false is rewritten by the person who moves the price).
// test/regen-derived-figures.test.js runs the derivation with a deliberately wrong figure and on the committed tree. (PRICES lane, 1 Nov 2026; born from two misses: unit 2's NL-4b and the 0.8.3 NL-4b-style readers no per-commit set could see.)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryRunReport } from '../src/dry-run.js';
import { DEFAULT_MAX_USD, DESKTOP_DEFAULT_MAX_USD } from '../src/default-cap.js';
import { priceOf } from '../src/cost.js';
import { priceOfChain } from '../src/send-path-refusals.js';
import { BRIEF_MAX_CHARS } from '../src/advice-brief.js';
import { estimateChainRows } from '../src/cost.js';
import { cutOffRetryCap } from '../src/chain.js';
import { ADVICE_RETRY_MAX_TOKENS } from '../src/advise.js';
import { MEMORY_MAX_TOKENS_EST } from '../src/review-notes.js';
import { generatePricingTable, START, END } from './pricing-table.mjs';
import { generateModelCaps, OUT_FILE } from './model-caps-report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = join(here, '..');
const usd = n => `$${n.toFixed(2)}`;
const f4 = n => `$${n.toFixed(4)}`;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const swapAll = (text, from, to) => text.replace(new RegExp(`${esc(from)}(?![0-9])`, 'g'), () => to);
const cent = x => Math.ceil(x * 100 - 1e-9) / 100;
/** The README review-notes Known-limit bound of one lane chain, in dollars with two decimals: the memory block (up to MEMORY_MAX_TOKENS_EST tokens per call at each paid judge's input price) x the later overseer rounds x the passes of an overseer round. test/notes-lane-on.test.js NL-4b calls this same function. */
export function reviewNotesBound(c) {
  const block = c.seats.critics.reduce((s, x) => s + (x.provider === 'external' ? 0 : (MEMORY_MAX_TOKENS_EST / 1e6) * priceOf(x.provider, x.model).in), 0);
  const passes = 1 + Object.values(c.layerRevisions ?? {}).reduce((a, b) => a + b, 0);
  return (block * (c.maxOverseerRounds - 1) * passes).toFixed(2);
}
// the 0.8.1 audit's exemption list of RA-7: these advice seats' pins are not tied to the row. THE source of truth: test/regression-081-audit-reaudit.test.js RA-7 imports this export
export const RA7_RAISED = new Set(['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash-1017', 'z-ai/glm-5.3', 'z-ai/glm-5.2', 'meta-llama/llama-3.3-70b-instruct']);

/** One pass. `overlay` (rel path -> text) replaces what is on disk, for the test. Returns { changes: Map(rel -> new text), notes: [string], problems: [string] }. */
export function deriveOnce(root = DEFAULT_ROOT, overlay = new Map()) {
  const base = rel => (overlay.has(rel) ? overlay.get(rel) : readFileSync(join(root, rel), 'utf8'));
  const work = new Map();
  const get = rel => (work.has(rel) ? work.get(rel) : base(rel));
  const set = (rel, text) => work.set(rel, text);
  const notes = []; const problems = [];
  const chainNames = dir => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : []);
  // every chain a test reads, chains/outdated's advice chains included (C&C ruling, 1 Nov 2026: advise-premium lives there); a name is in one folder only
  const relMap = new Map(); for (const dir of ['chains', 'chains/outdated']) for (const n of chainNames(dir)) if (!relMap.has(n) && (dir === 'chains' || /^advise-/.test(n))) relMap.set(n, `${dir}/${n}.json`);   // outdated: only the advice chains (advise-premium: tests read it); the retired planning chains keep the figures they were retired with, they are not shipped
  const allChains = () => [...relMap.keys()];
  const relOf = name => relMap.get(name) ?? `chains/${name}.json`;
  const chainOf = name => JSON.parse(get(relOf(name)));

  // 1. the README Pricing table
  { const t = get('README.md'); const a = t.indexOf(START), b = t.indexOf(END);
    if (a >= 0 && b > a) { const next = t.slice(0, a) + generatePricingTable(root) + t.slice(b + END.length); if (next !== t) { set('README.md', next); notes.push('README pricing table'); } } }

  // 2. the advice chains' max_price pins (RA-7), before any figure that reads a chain
  for (const name of allChains().filter(n => /^advise-/.test(n))) {
    const rel = relOf(name); const c = chainOf(name); let text = get(rel);
    for (const s of c.seats.critics || []) {
      const mp = s.extra?.provider?.max_price; const row = priceOf(s.provider, s.model);
      if (!mp || !row || RA7_RAISED.has(s.model) || (mp.prompt === row.in && mp.completion === row.out)) continue;
      const re = new RegExp(`("max_price":\\s*\\{\\s*"prompt":\\s*)${esc(String(mp.prompt))}(,\\s*"completion":\\s*)${esc(String(mp.completion))}(\\s*\\})`);
      if (!re.test(text)) { problems.push(`${rel}: cannot find the max_price ${JSON.stringify(mp)} to move to the row ${row.in}/${row.out}`); continue; }
      text = text.replace(re, (m, a, b2, c3) => `${a}${row.in}${b2}${row.out}${c3}`); notes.push(`${name}: ${s.model} max_price ${mp.prompt}/${mp.completion} -> ${row.in}/${row.out}`);
    }
    set(rel, text);
  }

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
    if (name === 'plan-default-opro-council' && (existsSync(join(root, 'docs/index.html')) || overlay.has('docs/index.html'))) set('docs/index.html', pairs.reduce((s, [a, b]) => s.replace(new RegExp(`(it is expected to cost |with an upper estimate of )${esc(a)}(?![0-9])`, 'g'), (m, p1) => p1 + b), get('docs/index.html')));
    notes.push(`${name}: ${pairs.map(([a, b, w]) => `${w} ${a} -> ${b}`).join('; ')}`);
  }

  // 4. the sentences that compare a figure with the default cap: rewritten when a figure crossed it, CHECKED both ways
  const cap = `$${DEFAULT_MAX_USD}`;
  for (const name of allChains().filter(n => /^plan-/.test(n))) {
    const rel = relOf(name); const c = chainOf(name); const d = c.description || '';
    if (!/ expected/.test(d)) continue;
    const r = dryRunReport(c, { defaultCapUsd: DEFAULT_MAX_USD }).estimate;
    if (!(r.floorUsd > DEFAULT_MAX_USD) && /cheapest end \(\$[0-9.,]+[^)]*\)\s+(?:are|is) above the default cap/.test(d)) problems.push(`${name}: the description says the cheapest end is above the default cap of ${cap}, but ${usd(r.floorUsd)} is not`);
    if (!(r.maximumUsd > DEFAULT_MAX_USD)) {
      if (d.includes(`above the default cap of ${cap}`)) problems.push(`${name}: the description says a figure is above the default cap of ${cap}, but the upper estimate ${usd(r.maximumUsd)} is not`);
      continue;
    }
    // upper estimate above the cap
    const oldFits = `Every figure printed here fits under the ${cap} default cap, and under the Claude Desktop bundle's default Spend ceiling of $${DESKTOP_DEFAULT_MAX_USD}.`;
    if (d.includes(oldFits)) {
      if (r.maximumUsd > DESKTOP_DEFAULT_MAX_USD) { problems.push(`${name}: above the Desktop ceiling too; needs a different sentence`); continue; }
      set(rel, get(rel).split(oldFits).join(`The upper estimate (${usd(r.maximumUsd)}) is above the default cap of ${cap}; the expected figure (${usd(r.expectedUsd)}) fits under it. On the command line that cap is only a suggestion. Every figure printed here fits under the Claude Desktop bundle's default Spend ceiling of $${DESKTOP_DEFAULT_MAX_USD}.`));
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
      const newR = `Its upper estimate (${usd(r.maximumUsd)}) and the cheapest end (${usd(r.floorUsd)}) are above the default cap of ${cap}.`;
      if (get('AI-README.md').includes(oldR)) { set('AI-README.md', get('AI-README.md').split(oldR).join(newR)); notes.push(`${name}: AI-README row rewritten`); }
    }
  }

  // 5. the advice ceilings and the two derivation sentences
  { // advise-single prints its derivation: first call + one retry at the 64,000-token retry cap, for the dearest brief the add-on prices (48,000 characters of non-ASCII text) and for 12,000 ASCII characters; the ceiling is the total rounded up to the cent
    const name = 'advise-single'; const c = chainOf(name); const seat = c.seats.critics[0]; const row = priceOf(seat.provider, seat.model);
    const retry = structuredClone(c); retry.seats.critics[0].maxTokens = ADVICE_RETRY_MAX_TOKENS;
    const dear = '\u65e5'.repeat(BRIEF_MAX_CHARS), small = 'x'.repeat(12_000);
    const f1 = priceOfChain(c, dear).worst, r1 = priceOfChain(retry, dear).worst, f2 = priceOfChain(c, small).worst, r2 = priceOfChain(retry, small).worst;
    // the printed totals add the PRINTED (rounded) components, as the sentence always did
    const R3 = x => Number(x.toFixed(3)); const t1 = R3(f1) + R3(r1), t2 = R3(f2) + R3(r2);
    const ceil = cent(Math.max(t1, f1 + r1)); setUsd(name, ceil);   // never below the real first call + retry (two rounded components can lose a thousandth)
    let text = get(relOf(name));
    const re1 = /ceiling, \$[0-9.]+: it covers/; const re2 = /first call \$[0-9.]+ \(about ([0-9,]+) input tokens x \$[0-9.]+ per million \+ ([0-9,]+) output tokens x \$[0-9.]+ per million\), retry at the 64,000-token retry cap \$[0-9.]+ \(input again \+ 64,000 x \$[0-9.]+ per million\), total \$[0-9.]+\./; const re3 = /An ASCII brief of 12,000 characters \(about ([0-9,]+) tokens\): \$[0-9.]+ \+ \$[0-9.]+ = \$[0-9.]+\./;
    if (re1.test(text) && re2.test(text) && re3.test(text)) {
      text = text.replace(re1, () => `ceiling, $${ceil.toFixed(2)}: it covers`)
        .replace(re2, (m, inTok, outTok) => `first call $${f1.toFixed(3)} (about ${inTok} input tokens x $${row.in} per million + ${outTok} output tokens x $${row.out} per million), retry at the 64,000-token retry cap $${r1.toFixed(3)} (input again + 64,000 x $${row.out} per million), total $${t1.toFixed(3)}.`)
        .replace(re3, (m, tok) => `An ASCII brief of 12,000 characters (about ${tok} tokens): $${f2.toFixed(3)} + $${r2.toFixed(3)} = $${t2.toFixed(3)}.`);
      set(relOf(name), text);
    } else problems.push(`${name}: the printed derivation was not found`);
  }
  { // advise-single-qwen prints: first call + one retry at the retry cap, +15%, rounded up
    const name = 'advise-single-qwen'; const c = chainOf(name); const seat = c.seats.critics[0]; const row = priceOf(seat.provider, seat.model);
    const first = priceOfChain(c, 'x'.repeat(BRIEF_MAX_CHARS)).worst; const inputUsd = first - ((seat.maxTokens ?? 36000) / 1e6) * row.out;
    const retry = inputUsd + (cutOffRetryCap(seat.maxTokens ?? 36000, ADVICE_RETRY_MAX_TOKENS) / 1e6) * row.out;
    const R4 = x => Number(x.toFixed(4)); const total = R4(first) + R4(retry); const ceil = cent(Math.max(total, first + retry) * 1.15); setUsd(name, ceil);   // the printed total adds the printed (rounded) components
    const re = /(first call at the 48,000-character brief limit )\$[0-9.]+( \+ one retry of a cut-off reply at the add-on's retry cap \(cutOffRetryCap\(36000, ADVICE_RETRY_MAX_TOKENS 64000\) = 64,000 tokens, not the doubled 72,000, because the add-on passes its own ceiling\) )\$[0-9.]+( = )\$[0-9.]+(; \+15% = )\$[0-9.]+(; rounded up to )\$[0-9.]+(\.)/;
    let text = get(relOf(name));
    if (re.test(text)) { text = text.replace(re, (m, a1, a2, a3, a4, a5, a6) => `${a1}${f4(first)}${a2}${f4(retry)}${a3}${f4(total)}${a4}${f4(total * 1.15)}${a5}$${ceil.toFixed(2)}${a6}`).replace(/advise\.usd \(\$[0-9.]+\)/, () => `advise.usd ($${ceil.toFixed(2)})`); set(relOf(name), text); }
    else problems.push(`${name}: the printed derivation was not found`);
  }
  for (const name of ['advise-single-glm-flash', 'advise-single-deepseek']) { // the description states the derivation: ceiling = ceil_cent(1.15 x 2 x first call)
    const c = chainOf(name); const seat = c.seats.critics[0]; const row = priceOf(seat.provider, seat.model);
    const first = priceOfChain(c, 'x'.repeat(BRIEF_MAX_CHARS)).worst; const outCost = (seat.maxTokens / 1e6) * row.out; const input = first - outCost; const two = 2 * first; const ceil = cent(two * 1.15);
    setUsd(name, ceil);
    const tokens = name === 'advise-single-deepseek' ? '360,000' : '131,072'; const fmtOut = name === 'advise-single-deepseek' ? n => `$${String(+n.toFixed(3))}` : f4;
    const re = new RegExp("first call at the 48,000-character brief limit \\$[0-9.]+ \\(input \\$[0-9.]+ \\+ " + tokens + " output tokens at this seat's pricing\\.json row of \\$[0-9.]+ per Mtok \\$[0-9.]+\\) \\+ one retry of an unreadable reply at the same " + tokens + "-token cap \\$[0-9.]+ = \\$[0-9.]+; \\+15% = \\$[0-9.]+; rounded up to \\$[0-9.]+\\.");
    const fresh = `first call at the 48,000-character brief limit ${f4(first)} (input ${f4(input)} + ${tokens} output tokens at this seat's pricing.json row of $${row.out.toFixed(2)} per Mtok ${fmtOut(outCost)}) + one retry of an unreadable reply at the same ${tokens}-token cap ${f4(first)} = ${f4(two)}; +15% = ${f4(two * 1.15)}; rounded up to $${ceil.toFixed(2)}.`;
    let text = get(relOf(name));
    if (re.test(text)) text = text.replace(re, () => fresh); else problems.push(`${name}: the derivation sentence was not found`);
    text = text.replace(/advise\.usd \(\$[0-9.]+\)/, () => `advise.usd ($${ceil.toFixed(2)})`);
    if (name === 'advise-single-deepseek') text = text.replace(/\(list \$[0-9.]+ \/ \$[0-9.]+ per Mtok\)/, () => `(list $${row.in} / $${row.out.toFixed(2)} per Mtok)`);
    set(relOf(name), text);
  }
  function setUsd(name, value) {
    const rel = relOf(name); const text = get(rel); const old = chainOf(name).advise.usd; if (value === old) return;
    const re = /("advise":\s*\{[^}]*?"usd":\s*)[0-9.]+/; if (!re.test(text)) { problems.push(`${rel}: no advise.usd`); return; }
    set(rel, text.replace(re, (m, a) => `${a}${value}`)); notes.push(`${name}: advise.usd ${old} -> ${value}`);
  }

  // 6. the README review-notes Known-limit bullet: block x judges x later overseer rounds x passes, at the table prices (test/notes-lane-on.test.js NL-4b computes the same)
  for (const name of allChains()) {
    const re = new RegExp('\\$[0-9]+\\.[0-9]{2} for `' + esc(name) + '`'); const readme = get('README.md'); if (!re.test(readme)) continue;
    const fresh = `$${reviewNotesBound(chainOf(name))} for \`${name}\``; const old = re.exec(readme)[0];
    if (old !== fresh) { set('README.md', readme.replace(old, () => fresh)); notes.push(`README review-notes bound for ${name}: ${old.split(' ')[0]} -> ${fresh.split(' ')[0]}`); }
  }

  // 6b. the README Known limit that prints advise-single's ceiling
  { const readme = get('README.md'); const m = /`advise-single`'s ceiling is (\$[0-9.]+) /.exec(readme); const now = `$${chainOf('advise-single').advise.usd}`;
    if (m && m[1] !== now) { set('README.md', readme.replace(m[0], () => `\`advise-single\`'s ceiling is ${now} `)); notes.push(`README: advise-single's ceiling ${m[1]} -> ${now}`); }
    const m2 = /\(`advise-single`: (\$[0-9.]+)\)/.exec(get('README.md')); if (m2 && m2[1] !== now) { set('README.md', get('README.md').replace(m2[0], () => `(\`advise-single\`: ${now})`)); notes.push(`README: advise-single's ceiling in the failed-start limit ${m2[1]} -> ${now}`); } }

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
    if (r.changes.size || r.problems.length) { console.error(`\n${r.changes.size} file(s) hold a figure that is not what the price table gives. Run: node scripts/regen-derived-figures.mjs`); process.exit(1); }
    console.log('every derived figure is current');
  } else {
    const r = deriveAndWrite();
    for (const n of r.notes) console.log(n);
    for (const p of r.problems) console.error(`problem: ${p}`);
    console.log(r.notes.length ? `\nwrote ${r.notes.length} change(s) in ${r.passes} pass(es)` : 'nothing to change');
    if (r.problems.length) process.exit(1);
  }
}
