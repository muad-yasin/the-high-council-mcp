// The paid repair recommendation, the READING side (0.8.3 ROADMAP 77; design note M6_Root_Regenerate_Design_Note.md 17.5, "Parser (deterministic, defensive)"). PURE: no file, no clock, no model, no record.
// It turns the advisor's answer text into the recommendations the person chooses from, or into a closed list of named problems that decide whether ONE more ask is made (17.5b). A model never decides which problem it was.
//   parseRecommendations(answer, { maxBytes }) -> { ok: true, numbered, items: [{ n, text }] } | { ok: false, problems: ['P-a' | 'P-b' | 'P-c' | 'P-d' | 'P-e', ...], items?: [...] }
// The rules, as the design note states them:
//   numbered blocks (`1.` or `2)` at the start of a line) give those blocks in order; an answer with NO numbering and some text is ONE recommendation, option 1. Text before the first number is not a recommendation and is not kept.
//   Inside a block the recorded instruction is the block WITHOUT its last two non-empty lines when the block has three or more non-empty lines (the "changes" and "risks" lines); a block with fewer lines is taken whole.
//   KNOWN WEAKNESS (design note Q5b): a block whose last two lines are part of the instruction loses them, and a refusal or off-topic answer written in words passes. The screen shows the exact text that would be recorded, so a wrong split is visible.
// The problems (a closed list; every one is something this function can find):
//   P-a the answer is empty or whitespace only          P-b a recommendation holds no letter and no digit (punctuation only)
//   P-c numbering that cannot be followed: a number repeats or goes backwards, or a numbered line has no text after it
//   P-d a recommendation is longer than `maxBytes`      P-e a recommendation holds a hidden or control character (terminalSafe would change it)
// P-c is exactly those three cases; a gap in the numbering (1, 3) is not on the list. The fixed re-ask phrase for P-c names the same three (it is held for Muad's yes and is NOT in src; the sentences live in the wording draft).
// `maxBytes` is the caller's: the decision reader's own limit (DECISION_MAX_BYTES, src/tree-decide-stop.js), passed in so there is one copy of the number and this file imports nothing heavy. A missing or non-numeric limit throws.
import { terminalSafe } from './terminal-safe.js';

export const PROBLEMS = Object.freeze(['P-a', 'P-b', 'P-c', 'P-d', 'P-e']);
const NUMBERED = /^\s*(\d{1,4})[.)](?:\s+(.*)|\s*)$/;
const hasWord = t => /[\p{L}\p{N}]/u.test(t);

/** The instruction recorded from one block's lines (see the rule above). */
function instructionOf(lines) {
  const full = lines.map(l => l.trim()).filter(l => l !== '');
  return (full.length >= 3 ? full.slice(0, -2) : full).join('\n');
}

export function parseRecommendations(answer, { maxBytes } = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new TypeError('parseRecommendations needs the decision reader\'s byte limit (maxBytes)');
  const text = typeof answer === 'string' ? answer : '';
  if (text.trim() === '') return { ok: false, problems: ['P-a'] };
  const lines = text.split(/\r?\n/);
  const blocks = [];                                  // { n, lines }
  let last = 0; let numberProblem = false; let preamble = true;
  for (const line of lines) {
    const m = NUMBERED.exec(line);
    if (m) {
      const n = Number(m[1]);
      if (blocks.length > 0 && n <= last) numberProblem = true;       // a number repeated or went backwards
      last = n; preamble = false;
      blocks.push({ n, lines: m[2] !== undefined ? [m[2]] : [] });
    } else if (!preamble) blocks[blocks.length - 1].lines.push(line);
  }
  const numbered = blocks.length > 0;
  if (!numbered) blocks.push({ n: 1, lines });
  const problems = new Set();
  const items = blocks.map(b => ({ n: b.n, text: instructionOf(b.lines) }));
  if (numbered && (numberProblem || items.some(it => it.text === ''))) problems.add('P-c');            // a numbered line with no text is P-c, not P-b
  for (const it of items) {
    if (it.text !== '' && !hasWord(it.text)) problems.add('P-b');
    if (Buffer.byteLength(it.text) > maxBytes) problems.add('P-d');
    if (terminalSafe(it.text) !== it.text) problems.add('P-e');
  }
  if (problems.size) return { ok: false, problems: PROBLEMS.filter(p => problems.has(p)), items };
  return { ok: true, numbered, items };
}
