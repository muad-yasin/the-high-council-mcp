// 0.8.4 T14 (CA2/D17, as amended by the owner 05 Nov 2026 03:52): a resumed run CONTINUES ON ITS SAVED REPLIES when the only thing that changed is THC's wording. PURE: no disk, no clock, no terminal.
// A stage whose stored prompt hash differs from the one it is asked now (cacheVerdict cause 'prompt', src/cache-integrity.js) has two possible causes: THC's WORDING changed between the sitting that wrote it and now (an update: the
// owner's word covers it), or the CONTENT it is asked changed (pre-release audit 5, the bottom comment of cache-integrity.js: an earlier stage ran live in a later sitting, so this stage's prompt carries text no seat answered; replaying
// it is the HIGH bug). Nothing on disk told the two apart, so every stage record now carries `writtenBy` (src/cli.js): { version, code_sha256?, sitting, text? }. This file is the ONE rule that reads it.
//
// THE RULE (decide): a prompt-stale stage is KEPT, marked as answered under the earlier wording, only if ALL hold:
//   1. it has `writtenBy` with a sitting number, and its reply text still matches `writtenBy.text` when the record holds one (a hand-edited answer does not; the pause's prompt.json carries none, the answer did not exist yet, and the write-back completes it);
//   2. the code that wrote it differs from the code running now (the version differs, or both code stamps exist and differ; with no stamp on either side it is version-only: a named limit);
//   3. nothing this stage DEPENDS ON changed. The ledger holds every stage this sitting has passed, in run order. A stage depends on all of them (fail closed) except its declared PARALLEL GROUP-mates (a call site that has verified the
//      prompt reads none of its group-mates sets `group`; src/chain.js). An entry counts as CHANGED for a dependent when it ran live or missed the cache this sitting, has no `writtenBy` (an unstamped stage counts as later than
//      everything), was written in a LATER sitting than the dependent, or its reply no longer matches its recorded text.
// Otherwise the stage is a cache miss as it always was. Unrun stages are asked with the current wording. Nothing here prices anything: a kept stage makes no paid call.

import { createHash } from 'node:crypto';

const PASS_LABEL = /^(?:panel|critique|revise|allocator|ldebate|lreply|rule|conflict)-(\d+)(?:-|$)/;
/** The pass a stage label belongs to (`revise-N` is the reply to pass N), or null for a stage that belongs to no pass (criteria, skeleton, build, handoff, the build check ...). */
export function passOfLabel(label) {
  const m = PASS_LABEL.exec(String(label ?? ''));
  return m ? Number(m[1]) : null;
}

/** The first 12 hex of sha256 over a reply text: what a stage record's `writtenBy.text` holds. */
export const textHashOf = text => createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 12);

/** The WARNINGS.md line of a stage kept as saved under THC's earlier wording (A-DRAFT): ONE copy, written by the CLI's onStage for a stage that went through invoke() and by the cache for a stage read outside it. */
export const keptLineOf = ({ label, version, sitting }) => `- answered_under_earlier_wording: stage "${label}"${passOfLabel(label) !== null ? ` (pass ${passOfLabel(label)})` : ''} was answered under THC's earlier wording (written by ${version ?? 'an earlier version'}) and was kept as it is in sitting ${sitting ?? '?'}\n`;

/**
 * The words a route goes by in a person's own text (A-DRAFT, FIX 5): the direct Anthropic key, OpenRouter, a Claude Code session; any other value is shown as it is. Raw ids belong in report.json only.
 */
export const routeWords = r => ({ anthropic: 'the direct Anthropic key', openrouter: 'OpenRouter', session: 'a Claude Code session' })[r] ?? String(r);

/** The WARNINGS.md line of a stage kept as saved after a change of route (A-DRAFT, FIX 5): its key is the report field's name; ONE copy, written by the CLI's onStage and by the cache for a stage read outside invoke(). */
export const keptRouteLineOf = ({ label, writtenRoute, route, sitting }) => `- answered_on_another_route: stage "${label}"${passOfLabel(label) !== null ? ` (pass ${passOfLabel(label)})` : ''} was answered on ${routeWords(writtenRoute)} and was kept as it is in sitting ${sitting ?? '?'}, which runs on ${routeWords(route)}\n`;

/** The sitting number of a record's writtenBy, or null when it is not a positive whole number. */
export const sittingOf = w => (w && Number.isInteger(w.sitting) && w.sitting > 0 ? w.sitting : null);

/**
 * Did THC's code change between the record and now? `written` = a record's writtenBy, `now` = { version, code_sha256? }. A different version always counts; the code stamps decide only when BOTH exist (a packaged binary has none:
 * then two builds with one version string never count as changed, a named limit).
 */
export function wordingChanged(written, now) {
  if (!written || !now) return false;
  if (typeof written.version !== 'string' || typeof now.version !== 'string') return false;
  if (written.version !== now.version) return true;
  return typeof written.code_sha256 === 'string' && typeof now.code_sha256 === 'string' && written.code_sha256 !== now.code_sha256;
}

/**
 * Did the ROUTE change between the record and now? (0.8.4 cache part (b)2, FIX 5, C&C 10 Nov 2026 on his 05 Nov 03:52 heading: a changed prompt on resume continues on its saved replies.) A route change CAN change a prompt: a session (external)
 * seat is outside the cache order, so once the order's words are recorded a judge's prompt differs between the session route and the others, and the stage cache reads the saved stage as asked a different prompt. `written` = a record's writtenBy,
 * `now` = { version, code_sha256?, route? }. A record or a sitting with no route is the direct route ('anthropic'): a direct run's record has never carried one, and writtenByRecord adds a route only for another route.
 */
const routeOf = x => (typeof x?.route === 'string' && x.route !== '' ? x.route : 'anthropic');
export function routeChanged(written, now) {
  if (!written || !now) return false;
  return routeOf(written) !== routeOf(now);
}

/**
 * The ledger of one sitting. `now` = { version, code_sha256? } of the running code; null disarms it (a sitting whose stamp failed, a side run, a direct caller): decide() then always says no, so the cache behaves as it always did.
 * note({ label, group, writtenBy, textOk, live }) records a stage the sitting passed (replayed or run); decide({ ... }) answers for a prompt-stale one.
 */
export function createWordingLedger({ now = null } = {}) {
  const entries = [];
  const kept = [];
  const keptRoute = [];   // FIX 5: stages kept because only the ROUTE changed (a separate record: the earlier-wording one would be false for them)
  const changedFor = (entry, sitting) => entry.live || sittingOf(entry.writtenBy) === null || sittingOf(entry.writtenBy) > sitting || entry.textOk === false;
  return {
    get armed() { return !!now; },
    /** The route this sitting runs on ('anthropic' when it carries none). */
    get route() { return routeOf(now); },
    /** FIX 5: true when a stage's record differs from this sitting by its ROUTE alone (THC's code is the same): the record sites say 'another route', not 'earlier wording'. Does not decide anything: decide() still returns { keep: true } for both. */
    routeOnly(writtenBy) { return !!now && !!writtenBy && !wordingChanged(writtenBy, now) && routeChanged(writtenBy, now); },
    /** Record a stage this sitting passed. `live` = it ran or missed the cache (changes what later stages are asked); otherwise it was replayed (`writtenBy` and `textOk` from its record). */
    note({ label, group = null, writtenBy = null, textOk = true, live = false }) {
      entries.push({ label, group, writtenBy, textOk, live });
    },
    /** For a prompt-stale stage: { keep: true } or { keep: false, why }. Records the kept stage in `kept` (what the report lists). */
    decide({ label, group = null, writtenBy = null, textOk = true }) {
      if (!now) return { keep: false, why: 'unarmed' };
      const sitting = sittingOf(writtenBy);
      if (sitting === null) return { keep: false, why: 'no_stamp' };
      if (!textOk) return { keep: false, why: 'text_edited' };
      if (!wordingChanged(writtenBy, now) && !routeChanged(writtenBy, now)) return { keep: false, why: 'same_code' };   // FIX 5: THC's code changed, or the route did; the other conditions (a stamp, an unedited reply, nothing upstream changed) are the same for both
      for (const e of entries) {
        if (group !== null && e.group === group) continue;   // a declared parallel group-mate: its prompt and this one read nothing of each other
        if (changedFor(e, sitting)) return { keep: false, why: 'upstream_changed', upstream: e.label };
      }
      if (kept.some(k => k.stage === label) || keptRoute.some(k => k.stage === label)) return { keep: true };   // one row per label, whichever call asked twice
      const pass = passOfLabel(label);
      if (!wordingChanged(writtenBy, now)) { keptRoute.push({ stage: label, ...(pass !== null ? { pass } : {}), written_route: routeOf(writtenBy), route: routeOf(now) }); return { keep: true }; }   // FIX 5: the route alone changed: its own list and no 'prompt' row
      kept.push({ stage: label, ...(pass !== null ? { pass } : {}), cause: 'prompt', written_under: writtenBy.version });
      return { keep: true };
    },
    /** The stages kept this sitting, in the order the replay reached them. Rebuilt in every sitting (a stage kept before is kept again, or asked, by the same rule). */
    get kept() { return kept.slice(); },
    /** FIX 5: the stages kept this sitting because the route changed (rebuilt every sitting, like `kept`). */
    get keptRoute() { return keptRoute.slice(); },
  };
}

/**
 * The `writtenBy` record a stage gets when it is written: null when this sitting has no stamp (fail closed: nothing is written, so a later sitting reads the stage as unstamped).
 * `now` = { version, code_sha256? }, `sitting` = this sitting's number, `text` = the 12-hex hash of the reply (absent for a pause's prompt.json: the answer does not exist yet).
 */
export function writtenByRecord({ now, sitting, text = null }) {
  if (!now || !Number.isInteger(sitting) || sitting < 1 || typeof now.version !== 'string') return null;
  return { version: now.version, ...(typeof now.code_sha256 === 'string' ? { code_sha256: now.code_sha256 } : {}), ...(routeOf(now) !== 'anthropic' ? { route: routeOf(now) } : {}), sitting, ...(typeof text === 'string' ? { text } : {}) };   // FIX 5: a route other than the direct one is recorded (a direct run's record keeps the shape it always had)
}
