// The stage cache of a run folder: `<label>.md` holds the text, `<label>.usage.json` what it cost, both written as each stage completes, so a resume replays them at zero cost (chain.js invoke() takes this object through
// setCache). One copy for the main run (src/cli.js) and for both side runs (--rematch, --replay; 13 Oct 2026, T2-1): MOVED out of cli.js unchanged apart from the names of its three inputs (runDir -> dir, cacheFingerprint ->
// fingerprint, unverifiedReplays -> unverified).
//
//   makeStageCache({ dir, fingerprint, unverified = [] }) -> { get, warn, invalidate }
//     get(label)        the stage as it is on disk, flagged `staleInputs` when the task/config fingerprint differs; null when there is no text or a record is unreadable. A stage whose usage record exists WITHOUT its text is a
//                       payment that happened: it is moved into superseded/ BEFORE the stage re-runs and added to the sitting's live budget (the orphan fix of the same day).
//     warn(label, why)  a replay that could only be checked coarsely is recorded, not silent (pushed to `unverified`, written to WARNINGS.md)
//     invalidate(label, why)  a stale stage's files move into superseded/, never overwritten
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countEarlierSpend } from './chain.js';
import { archiveSuperseded, supersededSpendOf, supersededStagesOf } from './superseded.js';

const SUPERSEDED_HINT = (label, n) => n ? `superseded/${label}.${n}.*` : '(no files)';

export function makeStageCache({ dir, fingerprint, unverified = [] }) {
  return {
    get: label => {
      const t = join(dir, `${label}.md`);
      if (!existsSync(t)) {
        // Cost first, text last (onStage below): a usage record with no text is a call that was paid for whose text never landed (the process ended between the two writes). Its payment is kept: moved into
        // superseded/ BEFORE the stage runs again, so the new usage file cannot overwrite it and the run's total (and the cap, on this resume) cannot drop. Found 13 Oct 2026: the old getter returned null here and
        // the re-run overwrote the orphan, so a resumed run counted ONE payment for two calls. If the move fails the stage is NOT run again (a refusal naming the file), never a path to a lower total.
        if (existsSync(join(dir, `${label}.usage.json`))) {
          let n;
          let orphanUsd = 0;
          try { orphanUsd = Number(JSON.parse(readFileSync(join(dir, `${label}.usage.json`), 'utf8')).usd); } catch { /* unreadable: kept anyway, counted as 0 here (the file itself is what the spend readers judge) */ }
          try { n = archiveSuperseded(dir, label); } catch (err) {
            throw Object.assign(new Error(`${join(dir, `${label}.usage.json`)} holds a payment whose text never landed, and it could not be set aside (${err?.code || err?.message}); stage "${label}" was not run again, so that payment cannot be lost. Fix the folder and resume again.`), { controlFlow: true });
          }
          // ORDERING (backend rule 7): the archive updates the LIVE budget, here, at the moment the file moves. The start-time countEarlierSpend of superseded/ (above, before any stage) ran before this file was there and the stage is
          // not replayed, so without this line the cap of the resume itself would stay low; a stale stage gets the same treatment from invoke() at its invalidate. Counted once: report.json's totals read superseded/ at the end.
          countEarlierSpend(Number.isFinite(orphanUsd) && orphanUsd > 0 ? orphanUsd : 0);
          appendFileSync(join(dir, 'WARNINGS.md'), `- cache_orphan: stage "${label}" had a cost record and no text (the process ended between the two writes); its first payment is kept as ${SUPERSEDED_HINT(label, n)}\n`);
        }
        return null;
      }
      let u = {};
      for (const f of [`${label}.prompt.json`, `${label}.usage.json`]) {
        if (!existsSync(join(dir, f))) continue;
        // A torn or corrupt usage file used to throw here on every resume, until someone deleted it
        // by hand (bug audit 2026-09-23, CLI #8). It is a cache miss instead: the stage re-runs.
        try { u = { ...u, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }; } catch {
          console.log(`  CACHE: ${f} is unreadable - treating "${label}" as not yet run.`);
          appendFileSync(join(dir, 'WARNINGS.md'), `- cache_unreadable: ${f} could not be parsed; the stage was re-run\n`);
          return null;
        }
      }
      const staleInputs = !!u.inputsFingerprint && u.inputsFingerprint !== fingerprint;
      return { text: readFileSync(t, 'utf8'), ...u, staleInputs, fromDisk: true };
    },
    // Pre-release cache audit #1: a replay that could only be checked coarsely is recorded, not silent.
    warn: (label, why) => {
      unverified.push({ stage: label, why });
      appendFileSync(join(dir, 'WARNINGS.md'), `- cache_unverified: stage "${label}" replayed - ${why}\n`);
    },
    invalidate: (label, why) => {
      const n = archiveSuperseded(dir, label);
      appendFileSync(join(dir, 'WARNINGS.md'), `- cache_stale: stage "${label}" invalidated - ${why}; the old files are kept as ${SUPERSEDED_HINT(label, n)}\n`);
    },
  };
}

/** Written under a temp name in the same directory, then renamed: readers see the old file or the whole new one, never a torn write. */
function writeFileAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/**
 * The lean onStage of a side run (--rematch, --replay): `<label>.usage.json` then `<label>.md`, atomically, COST FIRST and text last, as the main run writes a stage (src/cli.js onStage): a crash between the two leaves a payment
 * with no text, which the cache getter above keeps (superseded/) instead of overwriting. `fingerprint` is stored so a changed chain or task makes the stage STALE on a later sitting. A cached stage (replayed from disk) writes nothing.
 */
export function writeSideStage(dir, s, { fingerprint }) {
  if (s.cached) return;
  writeFileAtomic(join(dir, `${s.label}.usage.json`), JSON.stringify({
    provider: s.provider, model: s.model, usage: s.usage, usd: s.usd, ms: s.ms, inputsFingerprint: fingerprint, promptHash: s.promptHash,
    ...(Number.isFinite(s.cappedAt) ? { cappedAt: s.cappedAt } : {}), ...(s.noAnswer ? { noAnswer: s.noAnswer } : {}), ...(s.reservationId ? { reservationId: s.reservationId } : {}),
  }));
  writeFileAtomic(join(dir, `${s.label}.md`), s.text);
}

/**
 * A side run's result before its report is built: what earlier sittings paid for stages that were set aside (stale or orphaned, superseded/) is folded into `totals.usd`, shown as `totals.supersededUsd`, and listed in
 * `superseded[]` (label, amount, reservation id), exactly as the main run folds it (src/cli.js, at its report). Without this a resumed replay's report.json would read LOWER than its folder costs (spend.js recovers the
 * difference through its `later` term, but BOARD readers and the tree's report_totals check read the report). A no-op when nothing was set aside.
 */
export function foldSupersededInto(result, dir) {
  const supersededUsd = supersededSpendOf(dir);
  if (!(supersededUsd > 0)) return result;
  result.totals = { ...result.totals, usd: (result.totals.usd || 0) + supersededUsd, supersededUsd };
  result.superseded = supersededStagesOf(dir).map(({ label, usd, reservationId, kind }) => ({ label, usd, reservationId, ...(kind ? { kind } : {}) }));
  return result;
}
