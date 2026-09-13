// v5 §1 candidate 7: a realistic-case cost estimate before picking a chain,
// extending the project's existing "price before you run" discipline from
// `estimateChainRows`'s worst-case (the chain's own declared token
// assumptions, no history) to what this chain has actually cost on this
// machine. DERIVED, same convention as spend.js/verdict-stats.js: no
// ledger, read back from runs/*/report.json, repriced at CURRENT
// pricing.json rather than trusting a historical run's own possibly-stale
// `usd` field (a model's price can change between the run and today).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runIdToDate } from './spend.js';
import { costOf } from './cost.js';

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/**
 * A cost range for `chainName`, built from every historical run of that
 * exact chain in `runsDir` within the last `days`. The range is the
 * observed min/max of what those runs actually cost, repriced at today's
 * pricing.json - a real spread from real runs, not a fabricated tolerance
 * formula. A single historical run gives a zero-width range (low === high)
 * rather than inventing variance that was never observed.
 * Never throws - a missing runs/ dir or no matching history is a note, not
 * an error.
 */
export function forecastCost(chainName, runsDir, { days = 90, now = Date.now() } = {}) {
  const cutoff = now - days * 24 * 3600 * 1000;

  let ids = [];
  try {
    ids = existsSync(runsDir) ? readdirSync(runsDir) : [];
  } catch {
    return { chain: chainName, days, runsUsed: 0, low: null, high: null, mean: null, note: 'runs directory could not be read' };
  }

  const perRunUsd = [];
  for (const id of ids) {
    const when = runIdToDate(id);
    if (!when || when.getTime() < cutoff) continue;
    const report = readJson(join(runsDir, id, 'report.json'));
    if (!report || report.chain !== chainName) continue;

    let total = 0;
    for (const s of report.stages || []) {
      if (!s.usage) continue;
      total += costOf(s.provider, s.model, s.usage).usd;
    }
    perRunUsd.push(total);
  }

  if (!perRunUsd.length) {
    return { chain: chainName, days, runsUsed: 0, low: null, high: null, mean: null, note: 'no historical runs of this chain in the window' };
  }

  const low = Math.min(...perRunUsd);
  const high = Math.max(...perRunUsd);
  const mean = perRunUsd.reduce((a, b) => a + b, 0) / perRunUsd.length;

  return { chain: chainName, days, runsUsed: perRunUsd.length, low, high, mean };
}
