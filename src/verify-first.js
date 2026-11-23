// 0.8.4 D17 (plan A T1.3, slice 1; STEP3 F4; T3.3 entries 2, 3 and 5): the "Verify first" list. List 1 is written by the HANDOFF SEAT from the plan's UNVERIFIED markers (the seat paragraph of entry 2 asks for it); the
// harness reads it back, checks that no marker is left out, and appends the one harness line of entry 5. Pure and offline. Every sentence here is a held word (test/held-prompts/held-084-a.js) and does nothing until
// src/roles.js records it: with the words unrecorded every function returns its input and the gap check returns no gap (T1.3: the gap "ships with List 1, after the maintainer's yes on T3.3's entry 2, since without
// that section every handoff would get it"). The callers are src/cli.js (the gap check: both lintMilestones calls pass the plan) and, for the entry-5 line, the run's handoff stage in src/chain.js and the `--from-run` block in src/cli.js.
//
// What the heuristics are, so the plan and the code cannot drift:
//   - The "Verify first" section of a seat's handoff is a markdown heading that starts "Verify first" (any level, an optional number before it, anything after it) with the lines up to the next heading, or a line that starts with the label "Verify first:" with the lines that follow
//     it up to a blank line or the next heading.
//   - A marker is NAMED when the section's text, lower-cased, holds one of the marker's identifier-like tokens (a word of 5 characters or more with an underscore, a slash, a dot or a lower-to-upper case change, taken
//     from the claim and from what the marker says would settle it), or the first 40 characters of the claim or of the settle-by text (8 or more, trailing punctuation dropped). A line "<claim> - none: no step rests on
//     it" therefore names its claim. An empty section, or the empty-case line "Verify first: nothing - ...", names nothing.
import { held } from './held-roles.js';
import { unverifiedMarkers } from './claim-markers.js';

const norm = s => String(s ?? '').toLowerCase().replace(/[\s ]+/g, ' ').replace(/[`'"*]/g, '').trim();
const HEADING = /^\s{0,3}#{1,6}\s+/;
const LABEL = /^\s*(?:[-*]\s*)?\**verify first\**\s*:/i;
const HEAD_VF = /^\s{0,3}#{1,6}\s+(?:\d+(?:\.\d+)*[.)]?\s+)?\**verify first\b.*$/i;   // "## Verify first", "## 2. Verify first", "## Verify first (before any code)"
const heldText = name => { const t = held(name)?.(); return typeof t === 'string' && t ? t : null; };

/** The section of a seat's handoff text: { found, start, end, lines } with `start` the index of its first line and `end` one past its last non-empty line (indexes into the text's lines). */
export function verifyFirstSection(handoff) {
  const all = String(handoff ?? '').split('\n');
  for (let i = 0; i < all.length; i += 1) {
    const headingForm = HEAD_VF.test(all[i]);
    if (!headingForm && !LABEL.test(all[i])) continue;
    const inline = !headingForm && /:\s*\S/.test(all[i]);   // "Verify first: nothing - ..." keeps its content on the label line
    let end = i + 1;
    if (!inline) {
      while (end < all.length && !HEADING.test(all[end])) {
        if (!headingForm && end > i + 1 && all[end].trim() === '') break;   // a label's block ends at its first blank line; a heading's section at the next heading
        end += 1;
      }
    }
    while (end > i + 1 && all[end - 1].trim() === '') end -= 1;
    return { found: true, start: i, end, lines: all.slice(i, end) };
  }
  return { found: false, start: -1, end: -1, lines: [] };
}

const tokensOf = text => (String(text).match(/[A-Za-z_][\w./-]{3,}/g) || []).map(t => t.replace(/[.,;:/-]+$/, '')).filter(t => t.length >= 5 && /[_/.]|[a-z][A-Z]/.test(t)).map(t => t.toLowerCase());
const head = text => norm(text).replace(/[.!?\s]+$/, '').slice(0, 40);
const named = (hay, m) => {
  if (!hay) return false;
  if ([...new Set([...tokensOf(m.claim), ...tokensOf(m.body)])].some(t => hay.includes(t))) return true;
  const c = head(m.claim); const b = head(m.body);
  return (c.length >= 8 && hay.includes(c)) || (b.length >= 8 && hay.includes(b));
};

/**
 * Gaps for a handoff: [{ kind: 'verify_first_missing', message }], one per UNVERIFIED marker of the plan's own sections that the handoff's "Verify first" section does not name (T1.3, F4: the gap check and List 1 read
 * one set). Inert (always []) until the seat paragraph of entry 2 is recorded; also [] when the plan has no marker. The message is A-DRAFT (plan A l.93).
 */
export function verifyFirstGaps({ plan, handoff }) {
  if (!heldText('verifyFirstParagraph')) return [];
  const markers = unverifiedMarkers(plan);
  if (!markers.length) return [];
  const hay = norm(verifyFirstSection(handoff).lines.join('\n'));
  return markers.filter(m => !named(hay, m)).map(m => ({ kind: 'verify_first_missing', message: `section ${m.section} of the plan rests on '${m.claim.slice(0, 80)}', which the plan marks UNVERIFIED, and the 'Verify first' section does not name it.` }));
}

const DEPENDENCY_ANCHOR = 'If the plan has the build session install or download anything';
const STATUS_ANCHOR = 'Say which, and why, in the next section.';
const once = (text, anchor, what) => {
  const found = String(text).split(anchor).length - 1;
  if (found !== 1) throw new Error(`withVerifyFirst: the handoff prompt must carry ${what} once (found ${found}), so the "Verify first" words have no place to go`);
};

/**
 * The handoff seat's system text with the drafted seat words (T3.3 entry 2, with STEP3 F4's sentence): the "Verify first" paragraph goes right BEFORE the dependency paragraph, and (milestone form only, entry 3) the
 * needs_evidence rule right after the Status instruction. Inert while the words are unrecorded; loud when an anchor is not in the text exactly once.
 */
export function withVerifyFirst(system, { milestones = false } = {}) {
  let out = String(system);
  const paragraph = heldText('verifyFirstParagraph');
  if (paragraph) { once(out, DEPENDENCY_ANCHOR, 'the dependency paragraph'); out = out.replace(DEPENDENCY_ANCHOR, () => `${paragraph}\n\n${DEPENDENCY_ANCHOR}`); }
  const rule = milestones ? heldText('verifyFirstStatusRule') : null;
  if (rule) { once(out, STATUS_ANCHOR, 'the Status instruction'); out = out.replace(STATUS_ANCHOR, () => `${STATUS_ANCHOR} ${rule}`); }
  return out;
}

/**
 * T3.3 entry 5, as the plan places it ("the last line of List 1"; entry 2: it "may still follow the 'nothing' line"): when no fenced block of the task is a test file (src/fence-tests.js noFencedTestFile), the harness
 * appends its line after the last line of the seat's "Verify first" section; if the seat wrote none, the line is appended at the end of the text as its own line (the missing section is reported by the gap check). Inert while
 * the line is unrecorded, idempotent, and never touches the text otherwise.
 */
export function withNoTestsLine(handoff, noFencedTestFile) {
  const line = heldText('handoffNoTestsLine');
  const text = String(handoff ?? '');
  if (!noFencedTestFile || !line || text.includes(line)) return text;
  const sec = verifyFirstSection(text);
  if (!sec.found) return `${text.replace(/\s+$/, '')}\n\n${line}\n`;
  const lines = text.split('\n');
  lines.splice(sec.end, 0, line);
  return lines.join('\n');
}
