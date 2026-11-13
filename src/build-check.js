// 0.8.4 S4 (M1; CA4, D15, W15 as amended by W33; C&C's rulings of 4 Nov 2026): the BUILD CHECK, the handler's last look before a layered run ends agreed. The handler is the handling session (E3); the check is an EXTERNAL STAGE (the
// `answers` stage's shape): at layer 3's sign-off the run writes the check (src/chain.js askBuildCheck) as NEEDS-build-check-<n>.md and waits (exit 3); the handler's answer is build-check-<n>.md. No API call, no revision, no counter is used by
// asking. This file holds the switch, the prompt and the test of an answer; the wiring is in chain.js.
//
// THE SWITCH (C&C's Q-a ADDENDUM): ONE held read, the build-check wording (buildCheckSystem + buildCheckUser), gates BOTH the check AND the `ending` record, which for a run with no handling session says "agreed, no build check" (copy correction 11; src/ending.js). While the wording is held no chain asks a check and no
// `ending` is written: every reader reads `passed` plus the final read, byte-identical to before. Recorded, both go live together.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { held } from './held-roles.js';
import { draftIdOf } from './verdict-envelope.js';
import { namesEveryId, readBuildCheckAnswer } from './ending.js';

export const buildCheckLive = () => typeof held('buildCheckSystem') === 'function' && typeof held('buildCheckUser') === 'function';
export const buildCheckLabel = n => `build-check-${n}`;

/** The prompt of one check: { system, user }. `items`: [{ id, layer, severity?, flags?, problem }], every open objection at layer 3's sign-off (at M1 layer 3 sorts nothing, so each counts as must-do). Deterministic: a resume rebuilds it byte for byte. */
export function buildCheckPrompt({ plan, items, late = [], statements = [], layer = null }) {   // 0.8.4 S8: `layer` is the run's top layer (the chain passes its topLayer); the held user text prints it, "the top layer" when none
  return { system: held('buildCheckSystem')(), user: held('buildCheckUser')({ plan, items, late, statements, sha: draftIdOf(plan), layer }) };
}

/**
 * Judges the handler's answer text against the ids the check demands (CA4: "an answer that does not name them all counts as no answer"). Returns { ok: true, answer, reasons } or { ok: false, why, missing? }:
 * 'unreadable' (not good_to_build / not_yet), 'no_reasons' (a not_yet carries its reasons to the writer, so it needs some), 'ids_missing' (the ids it does not name).
 */
export function judgeBuildCheck(text, ids, aliases = null) {   // 0.8.4 S18 (T18t): `aliases` as in namesEveryId
  const a = readBuildCheckAnswer(text);
  if (!a) return { ok: false, why: 'unreadable' };
  if (a.answer === 'not_yet' && !a.reasons) return { ok: false, why: 'no_reasons' };
  const named = namesEveryId(a.reasons, ids, aliases);
  if (!named.ok) return { ok: false, why: 'ids_missing', missing: named.missing };
  return { ok: true, answer: a.answer, reasons: a.reasons };
}

/**
 * How many answers to the build check were set aside, derived from the run folder and never counted anywhere else (C&C's Q-f: "refused files moved aside, counted by listing"): the answer files of `build-check-<n>` that
 * the cache moved into superseded/ (a refused answer, or one set aside because its prompt or the chain changed). The report's `ending.refused_answers`.
 */
/**
 * 0.8.4 S18 (RU-S18-02, item 18 R, Q5 (a)): the REFUSED answers as rows, derived from the run folder like the count above (a refusal ends in a pause, so no report is written at that time): one `superseded/build-check-<n>.<k>.refusal.json` per refused answer, written by the cache
 * when it sets the answer aside. Rows in the order they were made: { n, label, pass, why, missing[], required[] }. An unreadable or foreign file is left out (never invented).
 */
export function refusalRowsOf(runDir) {
  const dir = join(runDir, 'superseded');
  let names = [];
  try { names = existsSync(dir) ? readdirSync(dir) : []; } catch { return []; }
  const out = [];
  for (const f of names) {
    const m = /^(?:build-check|sort)-(\d+)\.(\d+)\.refusal\.json$/.exec(f);   // 0.8.4 S18 (WORDING S18-w23): the sort wait's refusals (label sort-<n>) are rows of the same record
    if (!m) continue;
    let r = null; try { r = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    if (!r || !Number.isInteger(r.n) || typeof r.label !== 'string' || !Number.isInteger(r.pass) || !['unreadable', 'no_reasons', 'ids_missing'].includes(r.why)) continue;
    out.push({ at: [Number(m[1]), Number(m[2])], row: { n: r.n, label: r.label, pass: r.pass, why: r.why, missing: Array.isArray(r.missing) ? r.missing.map(String) : [], required: Array.isArray(r.required) ? r.required.map(String) : [] } });
  }
  return out.sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]).map(x => x.row);
}

/** The latest refusal of one check (by label), or null: the NEEDS file of a check that was refused says why (held sentence). */
export const latestRefusalOf = (runDir, label) => refusalRowsOf(runDir).filter(r => r.label === label).at(-1) ?? null;

export function refusedAnswersOf(runDir) {
  const dir = join(runDir, 'superseded');
  let names = [];
  try { names = existsSync(dir) ? readdirSync(dir) : []; } catch { return 0; }
  return names.filter(f => /^build-check-\d+\.\d+\.md$/.test(f)).length;
}
