// The ONE definition of "hidden characters": code points that render as nothing (or as nothing useful) in a terminal or a preview, so that the text a person reads is not
// all of the text that is hashed, recorded or sent (audit item 7, 0.8.3; Review/Build_0.8.3/m6-closing/Item7_Gate_Note.md). Five lists used to disagree about this (the advice brief,
// the gate screen, the return path, the contract lint, the terminal filter); every one now asks this module, and test/hidden-chars.test.js fails on a new list anywhere in src/.
//
// Contract:
//   HIDDEN_CLASS_SOURCE      the character-class body: Default_Ignorable_Code_Point (Unicode's own name for "renders as nothing": soft hyphen, combining grapheme joiner, Hangul and
//                            Khmer fillers, Mongolian selectors, zero-width and bidi marks, word joiner and invisible operators, ALL variation selectors, the byte-order mark, the
//                            tag block) plus U+2800 (braille blank), U+2028 and U+2029 (line and paragraph separators). Not Cf as a whole: that would catch visible format marks
//                            (Arabic number signs), which real text uses. Membership of DICP depends on the Node/ICU Unicode version; the pin test is a floor, not a ceiling.
//   QUIET                    the members that real text of some scripts, emoji or typeset sources needs: ZWNJ and ZWJ (U+200C, U+200D), the soft hyphen (U+00AD: German text pasted from a PDF carries it; C&C, 14 Oct 2026), the emoji variation selector (U+FE0F), Mongolian free variation
//                            selectors (U+180B-180D, U+180F) and the Khmer inherent vowels (U+17B4-17B5). They are never REFUSED in authored text (as before this unit); they are counted
//                            and marked where a screen shows rendered text, unless the emoji rule below explains them.
//   EMOJI RULE               one U+FE0F directly after an Extended_Pictographic character, and U+200D between two Extended_Pictographic characters, are not counted or marked
//                            (they only quiet the count; nothing is ever refused because of them).
//   hiddenIn(text, {allowQuiet})    first offending code point as { code: 'U+XXXX', near } or null (for refusals)
//   countHidden(text)               how many hidden characters a screen should report (quiet ones explained by the emoji rule are not counted)
//   markHidden(text)                the same characters made visible in place as `[U+XXXX]` (for text the harness renders from model words; the shown text is what is hashed)
//   stripHiddenChars(text)          the class without QUIET removed (for text going back to an agent)
//   blankHiddenChars(text)          every run of hidden code points (QUIET ones too) and of C0/C1 control characters (tab, line feed and carriage return included) replaced by ONE space
//                                   (for a short text that is recorded or shown whole and must read as one visible line: a session's quoted reason, a host name from the network)
//   briefHiddenRegex()              the advice brief's refusal list: class + control characters, without U+FE0F and the line separators (what it refused before, plus the exotic invisible
//                                   members the old hand-written list lacked)
// Everything is built from numbers, never from escapes or pasted characters, so no invisible character is ever in this file.
const cp = (...a) => String.fromCodePoint(...a);
const SEPARATORS = [0x2028, 0x2029];
const EXTRA = [0x2800, ...SEPARATORS];
export const HIDDEN_CLASS_SOURCE = `\\p{Default_Ignorable_Code_Point}${cp(...EXTRA)}`;
// C0 and C1 controls except tab, line feed and carriage return (terminal-safe removes them for display; the advice brief refuses them)
const CONTROLS_SOURCE = '\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F-\\x9F';
const QUIET_POINTS = [0xAD, 0x200C, 0x200D, 0xFE0F, 0x180B, 0x180C, 0x180D, 0x180F, 0x17B4, 0x17B5];
const QUIET_SOURCE = cp(...QUIET_POINTS);
const EMOJI_SELECTOR = 0xFE0F;
const ZWJ = 0x200D;

const hiddenRe = flags => new RegExp(`[${HIDDEN_CLASS_SOURCE}]`, flags);
const HIDDEN_ONE = hiddenRe('u');
const PICTO = /\p{Extended_Pictographic}/u;
export const isHiddenPoint = c => HIDDEN_ONE.test(cp(c));
export const isQuietPoint = c => QUIET_POINTS.includes(c);
const code = c => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;

// the code points of `text` that count as hidden, with their position in the code-point array (the emoji rule needs neighbours)
function hiddenPoints(text) {
  const pts = [...String(text)].map(ch => ch.codePointAt(0));
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const c = pts[i];
    if (!isHiddenPoint(c)) continue;
    const prev = i > 0 ? pts[i - 1] : null; const next = i + 1 < pts.length ? pts[i + 1] : null;
    const explained = (c === EMOJI_SELECTOR && prev !== null && PICTO.test(cp(prev)))
      || (c === ZWJ && prev !== null && next !== null && PICTO.test(cp(prev)) && PICTO.test(cp(next)));
    out.push({ c, i, explained });
  }
  return { pts, hidden: out };
}

export function hiddenIn(text, { allowQuiet = false } = {}) {
  const { pts, hidden } = hiddenPoints(text);
  for (const h of hidden) {
    if (allowQuiet && isQuietPoint(h.c)) continue;
    return { code: code(h.c), near: cp(...pts.slice(Math.max(0, h.i - 12), h.i)).replace(/[\x00-\x1f]/g, ' ') };
  }
  return null;
}

// A LEADING byte-order mark is a file-encoding artifact, not hidden text: the boundary that reads a file or takes a payload strips it before any check and records nothing about it. Only an INTERIOR U+FEFF is a hidden character.
export const stripLeadingBom = text => (typeof text === 'string' && text.codePointAt(0) === 0xFEFF ? text.slice(1) : text);

export const countHidden = text => hiddenPoints(text).hidden.filter(h => !h.explained).length;

export function markHidden(text) {
  if (!HIDDEN_ONE.test(String(text))) return String(text);   // fast path: most text holds none
  const { pts, hidden } = hiddenPoints(text);
  const at = new Map(hidden.filter(h => !h.explained).map(h => [h.i, h.c]));
  return pts.map((c, i) => (at.has(i) ? `[${code(c)}]` : cp(c))).join('');
}

export function stripHiddenChars(text) {
  return [...String(text)].filter(ch => { const c = ch.codePointAt(0); return !isHiddenPoint(c) || isQuietPoint(c); }).join('');
}

// C0 and C1 controls, all of them: a line break or a tab must not reach a recorded note or a one-line screen either
const ALL_CONTROLS_SOURCE = '\\x00-\\x1F\\x7F-\\x9F';
export const blankHiddenChars = text => String(text).replace(new RegExp(`[${HIDDEN_CLASS_SOURCE}${ALL_CONTROLS_SOURCE}]+`, 'gu'), ' ');

export const briefHiddenRegex = () => new RegExp(`(?![${cp(EMOJI_SELECTOR, ...SEPARATORS)}])[${HIDDEN_CLASS_SOURCE}${CONTROLS_SOURCE}]`, 'u');
