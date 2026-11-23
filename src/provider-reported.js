// 0.8.4 unit 2 (D12 part 2; his 03 Nov 2026: "0.8.4 records what was billed beside THC's own count"). The provider-reported counter: ONE pure reader of a run folder, called by the spend report (src/spend.js) and by both places
// that fold records into report.json (the main run in src/cli.js, a side run in src/stage-cache.js), so they give the same answer for the same folder. report.json is FROZEN when it is written: a one-call record written later
// (handoff --from-run, digest) is counted by the spend report and not by report.json, exactly as `totals.usd` behaves. It is DERIVED from the files at the moment it is asked, never recorded
// (CLAUDE.md "Cross-run spend"), and COUNTED NOWHERE: it is shown beside THC's own count, labelled `unverified`, and added to no total. Who takes it for the counted amount is a reader's mistake the field names forbid.
//
// What it reads (each file once; report.json is never read, so a folder that has one and a folder that does not give the same answer):
//   top-level `<label>.usage.json` ........ a stage's normal reply
//   superseded/`<label>.<n>.usage.json` ... a stage set aside (stale or orphaned): a normal reply
//   superseded/`<label>.call-<n>.usage.json` ... the one paid call of handoff --from-run, contract draft or digest: a normal reply
//   superseded/`<label>.charge-<n>.usage.json` ... a charge: kind `waste` (a discarded thinking attempt whose retry failed) is a normal reply; kind `billed` (a failed attempt) is IN only when it carries a figure,
//        because a failed attempt carries none by design (units 0 and 0b, a dropped body) and sits outside F3(c)'s boundary: counting it as "without" would make reporting look worse than it is.
// Only OpenRouter records are looked at, and only paid ones (usd above zero). A record with a plain `providerReportedCost` is an attempt WITH a figure: the figure goes to `cost` and THC's own usd for that attempt to `thcUsd`
// (like with like). A paid normal reply with none is an attempt WITHOUT (a file from before 0.8.4 reads so: "not reported", counted at its recorded usd). A stage whose thinking retry answered holds the split in
// `discardedAttempt`: its own figure is added when it has one (cost = both attempts, thcUsd = usd), else only the answer is compared (thcUsd = usd minus the discarded attempt's usd) and the discarded attempt counts as without.
// The unit of `cost` is NOT given by the provider's documentation ("cost in credits"; "the total amount charged to your account"): it is summed as reported and never read as dollars.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { billedFieldsOf, discardedFieldOf } from './billed-facts.js';
import { usdFigure } from './usd-figure.js';

const SUPERSEDED = 'superseded';
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const readRecord = path => { try { const o = JSON.parse(readFileSync(path, 'utf8')); return isRecord(o) ? o : null; } catch { return null; } };

/** One record's contribution: { cost, thcUsd, attempts, without } (all numbers, all zero for a record that is not counted). */
export function attemptsOfRecord(u, how) {
  const none = { cost: 0, thcUsd: 0, attempts: 0, without: 0 };
  if (!isRecord(u) || u.provider !== 'openrouter') return none;
  const usd = usdFigure(u.usd);
  if (usd === null || !(usd > 0)) return none;
  const mine = billedFieldsOf(u);
  const has = 'providerReportedCost' in mine;
  if (how === 'billed-charge') return has ? { cost: mine.providerReportedCost, thcUsd: usd, attempts: 1, without: 0 } : none;
  const d = discardedFieldOf(u).discardedAttempt;
  if (!d) return has ? { cost: mine.providerReportedCost, thcUsd: usd, attempts: 1, without: 0 } : { ...none, without: 1 };
  // a thinking retry answered: usd = the answer + the discarded attempt (d.usd)
  const dHas = 'providerReportedCost' in d;
  if (has && dHas) return { cost: mine.providerReportedCost + d.providerReportedCost, thcUsd: usd, attempts: 2, without: 0 };
  if (has && !dHas) return { cost: mine.providerReportedCost, thcUsd: Math.max(0, usd - d.usd), attempts: 1, without: 1 };
  if (!has && dHas) return { cost: d.providerReportedCost, thcUsd: d.usd, attempts: 1, without: 1 };
  return { ...none, without: 2 };
}

/**
 * The counter for one run folder, or null when the folder holds no OpenRouter paid record at all:
 *   { cost, attempts, thcUsd, attemptsWithout, unverified: true }
 * `cost` = the sum of the providers' reported figures (unit not given); `attempts` = how many attempts carried one; `thcUsd` = THC's own usd for exactly those attempts; `attemptsWithout` = paid normal replies that carried none.
 * Never throws; a missing folder, an unreadable file or a record that is not an object counts nothing.
 */
export function providerReportedOf(runDir) {
  let cost = 0, thcUsd = 0, attempts = 0, without = 0;
  const add = r => { cost += r.cost; thcUsd += r.thcUsd; attempts += r.attempts; without += r.without; };
  try {
    for (const f of readdirSync(runDir)) if (f.endsWith('.usage.json')) add(attemptsOfRecord(readRecord(join(runDir, f)), 'normal'));
    const sup = join(runDir, SUPERSEDED);
    if (existsSync(sup)) {
      for (const f of readdirSync(sup)) {
        if (!f.endsWith('.usage.json')) continue;
        const u = readRecord(join(sup, f));
        if (/\.charge-\d+\.usage\.json$/.test(f)) add(attemptsOfRecord(u, u?.kind === 'waste' ? 'normal' : 'billed-charge'));
        else add(attemptsOfRecord(u, 'normal'));
      }
    }
  } catch { /* an unreadable folder counts what was read */ }
  if (attempts === 0 && without === 0) return null;
  return { cost, attempts, thcUsd, attemptsWithout: without, unverified: true };
}

/** Puts the counter into a report's totals as `totals.providerReported` (the shape of providerReportedOf), when the folder holds anything to say; a no-op otherwise. The main run and a side run both call it, so report.json and the spend row agree. */
export function foldProviderReportedInto(result, dir) {
  const pr = providerReportedOf(dir);
  if (pr) result.totals = { ...result.totals, providerReported: pr };
  return result;
}
