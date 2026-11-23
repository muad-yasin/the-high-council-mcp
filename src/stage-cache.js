// The stage cache of a run folder: `<label>.md` holds the text, `<label>.usage.json` what it cost, both written as each stage completes, so a resume replays them at zero cost (chain.js invoke() takes this object through
// setCache). One copy for the main run (src/cli.js) and for both side runs (--rematch, --replay; 13 Oct 2026, T2-1): MOVED out of cli.js unchanged apart from the names of its three inputs (runDir -> dir, cacheFingerprint ->
// fingerprint, unverifiedReplays -> unverified).
//
//   makeStageCache({ dir, fingerprint, unverified = [] }) -> { get, warn, invalidate }
//     get(label)        the stage as it is on disk, flagged `staleInputs` when the task/config fingerprint differs; null when there is no text or a record is unreadable. A stage whose usage record exists WITHOUT its text is a
//                       payment that happened: it is moved into superseded/ BEFORE the stage re-runs and added to the sitting's live budget (the orphan fix of the same day).
//     warn(label, why)  a replay that could only be checked coarsely is recorded, not silent (pushed to `unverified`, written to WARNINGS.md)
//     invalidate(label, why)  a stale stage's files move into superseded/, never overwritten
//     awaitingRepair(label, promptHash)   2 Nov 2026: a stage whose paid reply was almost JSON and is set aside for a repair (src/near-json.js) and has no text yet: { original, refusal, kind, paid }, { released, paid } when its prompt changed, or null (3 Nov 2026:
//                             `paid` is the paid call's usage record, which stays at its label; invoke() counts it once and pauses again instead of paying for the stage twice). get() checks a repair that has
//                             arrived against the original (repairAcceptance); taken, the marker and the NEEDS file move into originals/ and the stage is an ordinary one; refused, it is kept in originals/ with its reason.
//     repaired(label, promptHash)   3 Nov 2026: true when originals/ holds an accepted repair of this stage for this prompt: the pause triggers read it, so a repaired stage never pauses twice.
import { keptLineOf, keptRouteLineOf, textHashOf } from './stale-guard.js';   // 0.8.4 T14
import { billedFieldsOf, discardedFieldOf } from './billed-facts.js';
import { foldProviderReportedInto } from './provider-reported.js';
import { foldCountedInto } from './counted-spend.js';
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countEarlierSpend } from './chain.js';
import { endpointNameOf } from './providers.js';
import { foldUnreplayedInto } from './unreplayed.js';
import { archiveSuperseded, supersededSpendOf, supersededStagesOf, SUPERSEDED_DIR } from './superseded.js';
import { acceptRepair, acceptedRepairOf, acceptanceFor, finishMove, originalOf, releaseRepairMarker, repairMarkerOf, setAsideOriginal } from './near-json.js';
import { personaUsageFields } from './persona-record.js';
import { basisField } from './counted-bases.js';

const SUPERSEDED_HINT = (label, n) => n ? `superseded/${label}.${n}.*` : '(no files)';

// 0.8.4 T14: `wording` = { sitting: () => this sitting's number or null } from the main run's CLI (null elsewhere: the hooks below then write nothing).
export function makeStageCache({ dir, fingerprint, unverified = [], wording = null }) {
  return {
    get: label => {
      const t = join(dir, `${label}.md`);
      const marker = repairMarkerOf(dir, label);
      if (marker?.accepted) acceptRepair(dir, label, marker);   // an acceptance cut short by a crash (marker rewritten as accepted, not yet moved): finished here
      else if (marker) finishMove(dir, label, marker);   // a pause cut short by a crash (marker written, reply still in place): finished here, never a call
      const repair = marker && !marker.accepted ? marker : null;
      if (!existsSync(t)) {
        // A repair pause (src/near-json.js): the paid reply's text is in originals/ and its usage record stays here. That is NOT an orphan (a payment whose text never landed): the marker says the stage waits for its repair,
        // so nothing is archived and nothing runs again; the run asks awaitingRepair (which also counts the payment toward this sitting's budget).
        if (repair) return null;
        // Cost first, text last (onStage below): a usage record with no text is a call that was paid for whose text never landed (the process ended between the two writes). Its payment is kept: moved into
        // superseded/ BEFORE the stage runs again, so the new usage file cannot overwrite it and the run's total (and the cap, on this resume) cannot drop. Found 13 Oct 2026: the old getter returned null here and
        // the re-run overwrote the orphan, so a resumed run counted ONE payment for two calls. If the move fails the stage is NOT run again (a refusal naming the file), never a path to a lower total.
        if (existsSync(join(dir, `${label}.usage.json`))) {
          let n;
          let orphanUsd = 0;
          let orphanCap;   // unit 4c1 (DUALCAP): the cap the orphan's record names, so the resume counts it in that cap (undefined: the run total only)
          try { const o = JSON.parse(readFileSync(join(dir, `${label}.usage.json`), 'utf8')); orphanUsd = Number(o.usd); if (typeof o.capName === 'string' && o.capName) orphanCap = o.capName; } catch { /* unreadable: kept anyway, counted as 0 here (the file itself is what the spend readers judge) */ }
          try { n = archiveSuperseded(dir, label); } catch (err) {
            throw Object.assign(new Error(`${join(dir, `${label}.usage.json`)} holds a payment whose text never landed, and it could not be set aside (${err?.code || err?.message}); stage "${label}" was not run again, so that payment cannot be lost. Fix the folder and resume again.`), { controlFlow: true });
          }
          // ORDERING (backend rule 7): the archive updates the LIVE budget, here, at the moment the file moves. The start-time countEarlierSpend of superseded/ (above, before any stage) ran before this file was there and the stage is
          // not replayed, so without this line the cap of the resume itself would stay low; a stale stage gets the same treatment from invoke() at its invalidate. Counted once: report.json's totals read superseded/ at the end.
          countEarlierSpend(Number.isFinite(orphanUsd) && orphanUsd > 0 ? orphanUsd : 0, orphanCap);
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
      const text = readFileSync(t, 'utf8');
      if (repair) {
        // The answer to a repair request: taken only if it reads word for word like the original (JSON punctuation and white space left out). Otherwise it is kept in originals/ (numbered, nothing deleted), the request stays, and the reason is written into the marker for the next NEEDS file.
        const original = originalOf(dir, repair);
        const verdict = original === null ? { ok: false, why: 'the original reply could not be read from originals/' } : acceptanceFor(repair, original, text);   // the check of this pause's kind (punctuation, or a table's criterion texts)
        if (!verdict.ok) {
          console.log(`  CACHE: the repair of stage "${label}" was not taken - ${verdict.why}. It is kept in originals/ and the request stays.`);
          setAsideOriginal({ runDir: dir, label, promptHash: repair.promptHash, fingerprint: repair.inputsFingerprint, refusal: verdict.why });
          return null;
        }
        acceptRepair(dir, label, repair);   // taken: the marker (accepted) and the NEEDS file move into originals/; from here the top level is an ordinary stage
      }
      // 3 Nov 2026 (owner: no trace of a repair in THC's record): a repaired stage is an ordinary stage. Its text is the repaired reply; its usage record is the PAID call's (provider, model, usd, prompt hash, reservation id),
      // so the replay counts the paid call once, at its label, under its real provider, and cacheVerdict checks the prompt hash the paid call answered. (c513ea4c replayed it as provider external, usd 0: a trace in stages[].)
      return { text, ...u, staleInputs, fromDisk: true };
    },
    awaitingRepair: (label, promptHash = null) => {
      const m = repairMarkerOf(dir, label);
      if (!m || m.accepted) return null;
      finishMove(dir, label, m);
      if (existsSync(join(dir, `${label}.md`))) return null;
      // `paid`: the paid call's usage record, still at its label. invoke() counts it toward this sitting's budget (and its cap) once, as a replay would: the cap seed of a resume reads superseded/ and unsettled
      // reservations only, so without this a resume before the repair would not count the call at all.
      let paid = null;
      try { const u = JSON.parse(readFileSync(join(dir, `${label}.usage.json`), 'utf8')); if (u && typeof u === 'object' && !Array.isArray(u)) paid = u; } catch { /* no record or unreadable: null, and invoke counts one attempt's worst case */ }
      // The prompt this stage is asked now is not the one the paid reply answered: the request is moot. The marker moves aside and the paid reply becomes a stale answer (superseded/, with its record, read above BEFORE it
      // moves); invoke() counts it toward this sitting once, since the cap seed ran before the move, and the stage runs live.
      if (promptHash && m.promptHash && promptHash !== m.promptHash) { releaseRepairMarker(dir, label); return { released: true, paid }; }
      return { original: originalOf(dir, m) ?? '', refusal: m.refusal, kind: m.kind, paid, ...(m.criteria ? { criteria: m.criteria, rows: m.rows ?? [] } : {}), ...(m.kind === 'id_slip' ? { slips: m.slips ?? [], shown: m.shown ?? [] } : {}) };
    },
    // 3 Nov 2026: whether this stage was repaired (or declined) for the prompt asked now, from the accepted marker in originals/. A repaired stage is read as it is and never pauses a second time (the pause triggers ask this;
    // before, the replay's provider `external` did that job).
    repaired: (label, promptHash = null) => {
      const a = acceptedRepairOf(dir, label);
      return !!a && (!promptHash || !a.promptHash || a.promptHash === promptHash);
    },
    // Pre-release cache audit #1: a replay that could only be checked coarsely is recorded, not silent.
    warn: (label, why) => {
      unverified.push({ stage: label, why });
      appendFileSync(join(dir, 'WARNINGS.md'), `- cache_unverified: stage "${label}" replayed - ${why}\n`);
    },
    // 0.8.4 T14 (CA2/D17): a stage read OUTSIDE invoke() (the handler's answers, a build-check answer) was kept as saved under THC's earlier wording: the same WARNINGS.md line the CLI's onStage writes for the others (one copy: keptLineOf).
    // 0.8.4 D18: a free-standing line for WARNINGS.md (the record must show a seat asked for text even when the request was dropped); chain.js does no file I/O.
    note: line => { appendFileSync(join(dir, 'WARNINGS.md'), `- ${line}\n`); },
    // FIX 5: the same for a stage kept because the route changed (the route now comes from the ledger, which the cache does not see)
    keptOnRoute: (label, writtenBy, route) => {
      appendFileSync(join(dir, 'WARNINGS.md'), keptRouteLineOf({ label, writtenRoute: writtenBy?.route ?? 'anthropic', route, sitting: wording?.sitting?.() ?? null }));
    },
    keptEarlier: (label, writtenBy) => {
      appendFileSync(join(dir, 'WARNINGS.md'), keptLineOf({ label, version: writtenBy?.version, sitting: wording?.sitting?.() ?? null }));
    },
    // 0.8.4 T14: the first time such a stage is used, the hash of the reply joins the pause's record (`<label>.prompt.json` holds writtenBy {version, sitting of the asking}, without a text because the answer did not exist), as the CLI's write-back
    // does for a stage that went through invoke(); a later sitting then sees a hand edit of the used answer. Nothing is written in a sitting with no stamp, when the record has no writtenBy (asked before this version) or when it already holds a text.
    stampUse: (label, text) => {
      if (!wording?.sitting?.()) return;
      const f = join(dir, `${label}.prompt.json`);
      try {
        const pj = JSON.parse(readFileSync(f, 'utf8'));
        const w = pj && typeof pj === 'object' ? pj.writtenBy : null;
        if (!w || typeof w !== 'object' || Array.isArray(w) || typeof w.text === 'string') return;
        writeFileAtomic(f, JSON.stringify({ ...pj, writtenBy: { ...w, text: textHashOf(text) } }));
      } catch { /* unreadable or not writable: the next sitting reads the record as it is (no text: no check), never an error here */ }
    },
    invalidate: (label, why, kind = 'cache_stale', data = null) => {   // 0.8.4 S4: `kind` is the class word of the WARNINGS.md line (a refused build-check answer is not a stale prompt). 0.8.4 S18: `data` (a refused build-check answer's row) is written beside the set-aside files as superseded/<label>.<n>.refusal.json, so the record is derived from the run folder (a refusal ends in a pause: no report is written)
      const n = archiveSuperseded(dir, label);
      if (data && n !== null) { try { writeFileSync(join(dir, SUPERSEDED_DIR, `${label}.${n}.refusal.json`), JSON.stringify(data)); } catch (err) { /* FAIL OPEN on purpose: the row is a record, not a gate (an unwritable folder must never turn a refusal into an accepted answer or stop the run); the loss is visible, because the WARNINGS.md line of the refusal below stays and one more line says that its row was not written, so a row count that disagrees with WARNINGS.md can be seen */ try { appendFileSync(join(dir, 'WARNINGS.md'), `- refusal_row_lost: stage "${label}" - the row of the refusal could not be written (${String(err?.message || err).slice(0, 120)})\n`); } catch { /* the folder is unwritable */ } } }
      releaseRepairMarker(dir, label);   // a stale repaired stage ends its repair pause too (otherwise the stage would pause again against a stale original)
      appendFileSync(join(dir, 'WARNINGS.md'), `- ${kind}: stage "${label}" invalidated - ${why}; the old files are kept as ${SUPERSEDED_HINT(label, n)}\n`);
    },
  };
}

/** Written under a temp name in the same directory, then renamed: readers see the old file or the whole new one, never a torn write. */
function writeFileAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

// The serving endpoint a reply named, as a record field: the one rule is providers.js endpointNameOf (a name that is not plain is left out, never cleaned).
export const endpointField = s => { const e = endpointNameOf(s?.endpoint); return e ? { endpoint: e } : {}; };

/**
 * The lean onStage of a side run (--rematch, --replay): `<label>.usage.json` then `<label>.md`, atomically, COST FIRST and text last, as the main run writes a stage (src/cli.js onStage): a crash between the two leaves a payment
 * with no text, which the cache getter above keeps (superseded/) instead of overwriting. `fingerprint` is stored so a changed chain or task makes the stage STALE on a later sitting. A cached stage (replayed from disk) writes nothing.
 */
export function writeSideStage(dir, s, { fingerprint }) {
  if (s.cached) return;
  writeFileAtomic(join(dir, `${s.label}.usage.json`), JSON.stringify({
    provider: s.provider, model: s.model, usage: s.usage, usd: s.usd, ms: s.ms, inputsFingerprint: fingerprint, promptHash: s.promptHash, ...personaUsageFields(s),
    ...(Number.isFinite(s.cappedAt) ? { cappedAt: s.cappedAt } : {}), ...(s.noAnswer ? { noAnswer: s.noAnswer } : {}), ...(s.reservationId ? { reservationId: s.reservationId } : {}), ...endpointField(s), ...billedFieldsOf(s), ...discardedFieldOf(s), ...basisField(s),   // 0.8.4 unit 1: what OpenRouter says it billed and the generation id, beside usd (record only)
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
  if (supersededUsd > 0) {
    result.totals = { ...result.totals, usd: (result.totals.usd || 0) + supersededUsd, supersededUsd };
    result.superseded = supersededStagesOf(dir).map(({ label, usd, reservationId, kind }) => ({ label, usd, reservationId, ...(kind ? { kind } : {}) }));
  }
  foldUnreplayedInto(result, dir);   // 0.8.4 S5-01: the same fold the main run does, so a side run's report is not lower than its folder either
  foldProviderReportedInto(result, dir);   // 0.8.4 unit 2: the provider-reported counter, from the same reader as the main run and `--spend`
  foldCountedInto(result, dir);   // 0.8.4 unit 6: totals.counted, from the same reader as the main run's report
  return result;
}
