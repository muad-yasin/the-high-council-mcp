// The permanent ladder at a RESUME (0.8.4): one fact read from the run folder, nothing else. `topLayerReadsMade` counts the passes in which the top layer was asked (a `panel-<pass>-<lab>` stage of a layer-3 seat), the number a
// typed `--rounds N` is compared with. 
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const labOf = seat => seat?.lab || seat?.provider;

/**
 * The number of top-layer reads a ladder RUN is bound by, for the figures that price it (0.8.4, the --rounds fix-up; C&C ruling 11 Nov 2026): the number a person typed with --rounds (the TOTAL, as chain.js reads it), else a resumed run's saved
 * `ladderRounds` plus the --continue amounts recorded at its overseer_cap stops (the same sum as chain.js `ladderAdd`: only a whole `add` above 0 counts), else null (no number: the figures keep the chain's own maxRounds, or the assumption of 7 and 3).
 * Pure. `choices` are the run's recorded round choices with `add` already filled in (cli.js fills a missing one with defaultAdd, as it does for the run itself).
 */
export function ladderBoundOf({ typed = null, saved = null, choices = [] } = {}) {
  if (Number.isInteger(typed) && typed >= 1) return typed;
  if (!Number.isInteger(saved) || saved < 1) return null;
  const added = (Array.isArray(choices) ? choices : []).filter(c => c?.choice === 'continue' && c.kind === 'overseer_cap' && Number.isInteger(c.add) && c.add > 0).reduce((n, c) => n + c.add, 0);
  return saved + added;
}

export function topLayerReadsMade(runDir, config) {
  if (!existsSync(runDir)) return 0;
  // A run stopped at the limit it was given knows its own count (the cap counts objecting top-layer verdicts; a silent seat's unreadable reply also leaves a stage file, which the labels below would count as a read).
  try { const stop = JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop; if (stop?.kind === 'overseer_cap' && Number.isInteger(stop.rounds)) return stop.rounds; } catch { /* no partial report: count the labels */ }
  // A stage label is built from the seat KEY (src/seat-key.js): the lab, except that the same model repeated on another layer gets `<lab>-l<layer>` on every layer but its lowest. So a top-layer seat whose lab is also used below is read as `<lab>-l3`.
  const critics = Array.isArray(config?.seats?.critics) ? config.seats.critics : [];
  const labs = new Set(critics.filter(c => c?.layer === 3).flatMap(c => (critics.some(o => o?.layer !== 3 && labOf(o) === labOf(c)) ? [`${labOf(c)}-l3`] : [labOf(c), `${labOf(c)}-l3`])));
  const passes = new Set();
  for (const f of readdirSync(runDir)) {
    const m = /^panel-(\d+)-(.+)\.md$/.exec(f);
    if (m && labs.has(m[2])) passes.add(Number(m[1]));
  }
  return passes.size;
}
