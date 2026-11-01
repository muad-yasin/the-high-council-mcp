// S5-01 (0.8.4): paid stage files that no stage row of the report accounts for.
// A sitting can pay for a stage (a re-ask, a panel seat) and write its `<label>.usage.json` + text, and a later sitting then never asks that label again (a changed path, a resume that finished sooner): the file stays in the
// run folder, its money is real, but no `stages[]` row carries it, so the report's total, `--spend` once report.json exists and the tree's figure all read LOWER than `--spend` read before the report was written.
// This is the one place that finds them, so the report writers (cli.js, stage-cache.js foldSupersededInto) and the reader of an older report (spend.js) agree.
//   Counted: a top-level `*.usage.json` with a figure above zero whose label is in no stage row AND whose reservation id is in no stage row. Either match accounts for the file; that errs LOW on purpose (a label that came back
//   with another id is never counted twice), and a file from before 0.8.3 has no id, so only its label can account for it.
//   Every kind of top-level `*.usage.json` writer was checked: a stage's own file (counted if unaccounted), `<stage>.late.usage.json` from stage-submission.js (an external answer: no `usd`, so $0, never counted), `<label>.stale-*`
//   (no longer written: a stale stage moves into superseded/), `handoff-from-run.usage.json` (below).
//   Not counted: `handoff-from-run.usage.json` (a post-run call; spend.js and the tree already add it by name), anything under superseded/ (its own record), a file whose figure is unreadable (spend.js reports those
//   as unknown figures; it is not a figure to add).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { usdFigure } from './usd-figure.js';

const NOT_A_STAGE_FILE = new Set(['handoff-from-run.usage.json']);

/** [{ label, usd, reservationId }] for every unreplayed paid file in `dir`, given the report's stage rows. Never throws. */
export function unreplayedOf(dir, stages) {
  const rows = Array.isArray(stages) ? stages : [];
  const labels = new Set(rows.map(s => s?.label).filter(l => typeof l === 'string'));
  const ids = new Set(rows.map(s => s?.reservationId).filter(i => typeof i === 'string'));
  let names = [];
  try { names = readdirSync(dir).filter(f => f.endsWith('.usage.json') && !NOT_A_STAGE_FILE.has(f)).sort(); } catch { return []; }
  const out = [];
  for (const f of names) {
    const label = f.replace(/\.usage\.json$/, '');
    if (labels.has(label)) continue;
    let u = null;
    try { u = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    if (u === null || typeof u !== 'object' || Array.isArray(u)) continue;
    const usd = usdFigure(u.usd);
    if (!(usd > 0)) continue;
    const reservationId = typeof u.reservationId === 'string' ? u.reservationId : null;
    if (reservationId && ids.has(reservationId)) continue;
    out.push({ label, usd, reservationId });
  }
  return out;
}

/** What `unreplayedOf` found, added to a result's totals the way the superseded records are: `totals.usd` includes it, `totals.unreplayedUsd` shows it, `result.unreplayed` lists it. A no-op when there is none. */
export function foldUnreplayedInto(result, dir) {
  if (!Array.isArray(result?.stages)) return result;   // no stage rows, no basis for saying what they hold
  const found = unreplayedOf(dir, result?.stages);
  const sum = found.reduce((n, o) => n + o.usd, 0);
  if (!(sum > 0)) return result;
  result.totals = { ...result.totals, usd: (result.totals?.usd || 0) + sum, unreplayedUsd: sum };
  result.unreplayed = found;
  return result;
}
