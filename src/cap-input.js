// The typed spending limit: ONE pure parser (typed-cap gate page T1, 14 Oct 2026; Astra #10; Muad: "a max-cap that the user always have to type manually before a run starts"). No file, no clock, no environment, no float arithmetic.
//
// Contract:
//   parseCapInput(text, { ceilingUsd = null, ceilingSource = null, paid = true }) ->
//        { ok: true, capUsd: '7.5', capMicroUsd: 7500000 }                    the normalized decimal string and the integer micro-dollars (what the record stores)
//      | { ok: false, code, sentence }                                       `sentence` is the person-facing refusal (it ends "Nothing was started."), `code` is a stable word for tests and the record.
//   GRAMMAR: trim; then ONLY  0 | [1-9][0-9]{0,5}  optionally followed by a dot and 1 to 4 digits. No sign, exponent, hexadecimal, thousands separator, comma decimal, currency sign, unit word or "none"/"off"/"unlimited".
//   ZERO parses but is never a cap for a PAID start (`paid: true`): 0 means "no paid call", and a paid chain cannot run on it; a free-only run needs no typed cap at all (the caller never asks). It therefore never reaches `setBudget`.
//   CEILINGS stay ceilings, never consent: an amount above `ceilingUsd` (COUNCIL_MAX_USD_LIMIT / the plugin's max_usd) is refused with the ceiling named. The ceiling is compared in micro-dollars.
//   A value echoed in a sentence is redacted (a key pasted into the wrong field) and cut at 40 characters.
import { redactText } from './secret-patterns.js';

export const CAP_GRAMMAR = /^(0|[1-9][0-9]{0,5})(\.([0-9]{1,4}))?$/;
export const MICRO = 1_000_000;

const shown = raw => { const t = redactText(String(raw)).text; return t.length > 40 ? `${t.slice(0, 40)}...` : t; };
const refuse = (code, sentence) => ({ ok: false, code, sentence: `${sentence} Nothing was started.` });
// The ceiling test, ONE copy for the CLI's typed limit (parseCapInput below) and the tree's amounts (src/tree-ceiling.js: tree start, the member's start; 15 Oct 2026, C&C: COUNCIL_MAX_USD_LIMIT bounds a tree's typed amounts too). Micro-dollar integers, so it is
// exact for an amount with six decimals or fewer (a seventh decimal rounds); the caller gives the number's text for the sentence and its micro-dollars. null = within the ceiling (or none given).
export function ceilingRefusal(capUsd, capMicroUsd, { ceilingUsd = null, ceilingSource = null } = {}) {
  if (ceilingUsd === null || ceilingUsd === undefined) return null;
  const ceilMicro = Math.round(Number(ceilingUsd) * MICRO);
  if (!Number.isFinite(ceilMicro)) return refuse('ceiling_unreadable', 'The ceiling in force could not be read, so no limit can be accepted against it.');
  if (capMicroUsd > ceilMicro) return refuse('above_ceiling', `The limit you typed ($${capUsd}) is above the ceiling in force ($${(ceilMicro / MICRO).toString()}${ceilingSource ? `, set by ${ceilingSource}` : ''}). Type $${(ceilMicro / MICRO).toString()} or less.`);
  return null;
}
const UNLIMITED = /^(none|off|unlimited|infinity|inf|no\s*limit|nolimit)$/i;

export function parseCapInput(text, { ceilingUsd = null, ceilingSource = null, paid = true } = {}) {
  if (typeof text !== 'string' || !text.trim()) return refuse('empty', 'Type the limit as a number of US dollars, for example 5 or 2.50.');
  const t = text.trim();
  if (UNLIMITED.test(t)) return refuse('unlimited', 'An unlimited run is not offered. Type a limit in US dollars, for example 5.');
  if (/^\d[\d. ]*,\d/.test(t)) return refuse('comma', `"${shown(t)}" has a comma. Use a dot for the decimals, for example 2.50.`);
  if (/[^\d.]/.test(t.replace(/^\s+|\s+$/g, ''))) return refuse('format', `"${shown(t)}" is not a plain number of dollars. Type only digits and an optional dot, without a currency sign, letters, a plus or minus sign or an exponent, for example 7 or 2.50.`);
  const m = CAP_GRAMMAR.exec(t);
  if (!m) {
    if (/^\d+\.\d{5,}$/.test(t)) return refuse('precision', `"${shown(t)}" has more than four decimals. Use at most four, for example 2.5025.`);
    if (/^\d{7,}(\.\d*)?$/.test(t)) return refuse('too_large', `"${shown(t)}" has more than six digits before the dot. Type a smaller limit.`);
    return refuse('format', `"${shown(t)}" is not a plain number of dollars. Type digits with an optional dot, with a digit before the dot and no leading zeros, for example 7, 0.5 or 2.50.`);
  }
  const whole = m[1]; const frac = m[3] ?? '';
  const capMicroUsd = Number(whole) * MICRO + Number(frac.padEnd(6, '0'));      // exact: at most 6 + 6 digits, below 2^53
  const capUsd = frac.replace(/0+$/, '') ? `${whole}.${frac.replace(/0+$/, '')}` : whole;
  if (capMicroUsd === 0 && paid) return refuse('zero_paid', 'A limit of 0 allows no paid call, and this chain has paid seats. Type a positive limit, or choose a chain whose seats are all priced at $0.');
  const over = ceilingRefusal(capUsd, capMicroUsd, { ceilingUsd, ceilingSource });
  if (over) return over;
  return { ok: true, capUsd, capMicroUsd };
}
