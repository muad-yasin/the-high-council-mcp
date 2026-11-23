// 0.8.4 T2.5 / D29 (plan A, C&C's words of 09 Nov 2026): after a run that did not agree, the milestone handoff's first line may not say `ready_for_build` or `partial` until an acceptance is recorded. The harness replaces such a word with
// `needs_decision`, writes one note line under it, and keeps the seat's own word on the record (report.json handoff_milestones.status stays what the seat wrote; handoff_milestones.status_set_by_harness says what the harness put).
// PURE: text in, text out; no model, no file, no clock. It works on the HANDOFF.md text the harness composes (never on the stage file handoff.md, so a resume replays the seat's own words and the clamp is re-derived), on the SAME Status line
// the lint reads (src/milestones.js parseMilestones: the top block before the first `## ` heading, code fences masked, emphasis marks ignored). `liftStatus` is the exact inverse, given the seat's word: the acceptance uses it.
import { maskFences, STATUS_VALUES } from './milestones.js';

export const CLAMPED_STATUS = 'needs_decision';
const STATUS_RE = /^\s*Status:\s*[`'"*_<\[(]*([A-Za-z_]+)/;

/** The note line under a clamped Status (A-DRAFT; a harness-written line, like the banner's). `original` is the seat's word. */
export const statusNoteLine = original => `> Status set to ${CLAMPED_STATUS} by the harness: the handoff said ${original}, but the panel did not agree and nobody has accepted the plan as it stands.`;   // WORDING U3-w7

/** Lines and their separators exactly as written: { lines: [text], seps: [separator after each line, '' for the last] }. */
function linesOf(text) {
  const parts = String(text ?? '').split(/(\r\n|\r|\n)/);
  const lines = []; const seps = [];
  for (let i = 0; i < parts.length; i += 2) { lines.push(parts[i]); seps.push(parts[i + 1] ?? ''); }
  return { lines, seps };
}
/** A line without its emphasis marks (`**` and `__`, which parseMilestones drops), with a map from each kept character back to its place in the raw line. */
function stripWithMap(raw) {
  let s = ''; const map = [];
  for (let i = 0; i < raw.length; i++) {
    const two = raw.slice(i, i + 2);
    if (two === '**' || two === '__') { i += 1; continue; }
    s += raw[i]; map.push(i);
  }
  return { s, map };
}

/** Where the Status word is: { line, from, to, word } in the raw text's line list (the same line parseMilestones reads), or null when there is none. */
function statusSpot(lines) {
  const masked = maskFences(lines.join('\n')).split('\n');
  if (masked.length !== lines.length) return null;   // cannot happen (one separator, one newline); fail safe
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s/.test(masked[i])) return null;   // the Status line belongs to the top block, before the first `## ` heading
    const { s, map } = stripWithMap(masked[i]);
    const m = STATUS_RE.exec(s);
    if (!m) continue;
    const word = m[1];
    const startInS = m.index + m[0].length - word.length;
    return { line: i, from: map[startInS], to: map[startInS + word.length - 1] + 1, word };
  }
  return null;
}

/** The Status word of a handoff text as parseMilestones reads it, or null. */
export const statusWordOf = text => statusSpot(linesOf(text).lines)?.word ?? null;

/**
 * Clamps the Status of a handoff text. `allowed`: the Status values the run may carry (src/ending-matrix.js statusAllowedOf). Only a word that is a Status value and is not allowed is replaced; a missing or unknown word is left to the lint.
 * -> { text, original }: `original` is the seat's word when it was replaced, else null (and `text` is the input).
 */
export function clampStatus(text, allowed) {
  const { lines, seps } = linesOf(text);
  const spot = statusSpot(lines);
  if (!spot || !STATUS_VALUES.includes(spot.word) || allowed.includes(spot.word)) return { text, original: null };
  const line = lines[spot.line];
  lines[spot.line] = `${line.slice(0, spot.from)}${CLAMPED_STATUS}${line.slice(spot.to)}`;
  // the note goes on its own line right under the Status line, with the same line ending
  const eol = seps[spot.line] || '\n';
  lines.splice(spot.line + 1, 0, statusNoteLine(spot.word));
  seps.splice(spot.line, 1, eol, seps[spot.line]);
  return { text: lines.map((l, i) => l + seps[i]).join(''), original: spot.word };
}

/** The exact inverse of clampStatus for the seat's word `original`: the Status word restored and the note line taken out. The text is returned unchanged when it is not a clamped text of that word. */
export function liftStatus(text, original) {
  if (typeof original !== 'string' || !STATUS_VALUES.includes(original)) return text;
  const { lines, seps } = linesOf(text);
  const spot = statusSpot(lines);
  if (!spot || spot.word !== CLAMPED_STATUS || lines[spot.line + 1] !== statusNoteLine(original)) return text;
  const line = lines[spot.line];
  lines[spot.line] = `${line.slice(0, spot.from)}${original}${line.slice(spot.to)}`;
  lines.splice(spot.line + 1, 1);
  seps.splice(spot.line, 2, seps[spot.line + 1]);
  return lines.map((l, i) => l + seps[i]).join('');
}

/** liftStatus for either word the harness can have replaced: for a cached handoff stage that is HANDOFF.md itself on a case-insensitive disk, so a replay reads the seat's own Status again (the twin of stripHandlerNotesBlock). Unchanged when there is no note. */
export function liftAnyClamp(text) {
  for (const original of ['ready_for_build', 'partial']) { const t = liftStatus(text, original); if (t !== text) return t; }
  return text;
}

