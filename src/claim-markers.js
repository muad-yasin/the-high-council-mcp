// 0.8.4 D15 (plan A T1.1, D15; STEP3 F7 and A9): the claim-marker checker. A statement a plan makes about the project carries one marker at its end: [CHECKED: ...], [UNVERIFIED: ...], [DISPUTED: ...] or [ABSENT: ...].
// This module READS a plan and reports where that vocabulary is not kept, as information only. Pure and offline: no I/O, no model call; it never rejects a draft and never changes a byte of the text it is given (a test
// pins both). Its findings go to the warnings file and the report (the wiring is a later unit).
//
// The vocabulary (plan A T1.1): CHECKED = the statement rests on text shown to the seat that writes it and to every seat after it (a fenced block, a recorded tool result or a recorded excerpt; STEP3 A9), and the marker names
// that text: `[CHECKED: src/chain.js lines 4440-4447]`, `[CHECKED: tool result check_versions:0]`, `[CHECKED: excerpt E-2]` ("inferred from" may open the body). UNVERIFIED = no seat could check it, the marker names the one act
// that would settle it. DISPUTED = a judge's objection stands against it, `[DISPUTED: O-1a2b3c4d]`; only the dispute pass writes it, after the panel stopped without agreement. ABSENT = the statement says something is not in the
// shown material, the marker says where the looking was done.
//
// The heuristic, stated here so the plan and the code cannot drift:
//   - The plan is read line by line. Headings (`#`), fenced code blocks of the plan itself and blank lines are skipped. A line is split into sentences at . ! ? followed by a space or the end, never inside a marker; a marker
//     that follows a sentence's full stop belongs to that sentence. "Section <n>" is the number at the start of the nearest heading ("## 3. Design" -> 3, "### 3.2 x" -> 3.2), else that heading's ordinal; text before the first
//     heading is section 0. "Line <m>" is the line in the whole plan.
//   - An UNMARKED PROJECT CLAIM is a sentence, outside its markers, that names a file (an extension in src/preflight.js ARTIFACT_EXTENSIONS), a function (`name()`), an identifier (a backticked token) or a version (1.2, v1.2.3,
//     "version 4"), or states that something exists or does not ("does not exist", "there is no", "is not in", "already exists", "is missing", ...), and carries none of the four markers. It will flag some sentences that are not
//     claims about the project (a plan step that names the file it will create, say): a false flag costs a reader's attention and stops nothing.
//   - A DISPUTED marker is a finding unless a dispute pass has run (`disputePassRan`).
//   - A CHECKED marker that cites `<path> lines <a>-<b>` is a finding unless some fenced block of the task (the `task` text) for that path shows lines a to b (a block written by `council fence` starts with a `// <path>` line that
//     is not part of the file; a trailing "[truncated: ...]" note and the empty line a final newline leaves before the closing fence are not file lines). A CHECKED marker that cites `excerpt E-<n>` is a finding unless the run recorded that excerpt (`excerptIds`; STEP3 F7). A tool-result citation is not
//     checked here. With `task` null the range check is off.
import { ARTIFACT_EXTENSIONS } from './preflight.js';
import { fencedBlocks } from './fence-tests.js';

const MARKER = /\[(CHECKED|UNVERIFIED|DISPUTED|ABSENT):([^\]]*)\]/g;
const EXTENSIONS = [...ARTIFACT_EXTENSIONS].sort((a, b) => b.length - a.length).join('|');
const FILE = new RegExp(`(?<![\\w./-])[\\w.-]+(?:/[\\w.-]+)*\\.(?:${EXTENSIONS})(?![\\w])`);
const FUNCTION = /(?<![\w`])[A-Za-z_][\w.]*\(\)/;
const IDENTIFIER = /`[^`\s]{2,}`/;
const VERSION = /(?<![\w./-])(?:v\d+(?:\.\d+){0,2}|\d+\.\d+(?:\.\d+)?|version \d+)(?![\w/-])/i;
const EXISTS = /\b(?:does not exist|doesn't exist|do not exist|don't exist|there is no|there are no|there is not|is not in|are not in|is missing|already exists?|already has|already contains|already defines)\b/i;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;

function sentencesOf(line) {
  const markers = [...line.matchAll(MARKER)].map(m => ({ start: m.index, end: m.index + m[0].length, kind: m[1], body: m[2].trim() }));
  const inMarker = k => markers.some(m => k >= m.start && k < m.end);
  const spans = []; let start = 0; let i = 0;
  while (i < line.length) {
    if ('.!?'.includes(line[i]) && !inMarker(i) && (i + 1 >= line.length || /\s/.test(line[i + 1]))) {
      let end = i + 1;
      for (;;) { const gap = /^\s*/.exec(line.slice(end))[0].length; const m = markers.find(x => x.start === end + gap); if (!m) break; end = m.end; }
      spans.push([start, end]); start = end; i = end; continue;
    }
    i += 1;
  }
  if (line.slice(start).trim()) spans.push([start, line.length]);
  return spans.map(([s, e]) => ({ text: line.slice(s, e).trim(), markers: markers.filter(m => m.start >= s && m.end <= e), bare: line.slice(s, e).replace(MARKER, ' ') }));
}

const sectionLabel = (heading, ordinal) => { const m = /^(\d+(?:\.\d+)*)[.)]?(?:\s|$)/.exec(heading.trim()); return m ? m[1] : String(ordinal); };

function nameOf(bare) {
  for (const re of [FILE, FUNCTION, IDENTIFIER, VERSION, EXISTS]) { const m = re.exec(bare); if (m) return re === EXISTS ? `a statement that something exists or does not ("${m[0]}")` : m[0]; }
  return null;
}

// The lines of a fenced block that are file text: without council fence's leading `// <path>` line and a trailing truncation note.
const fileLinesOf = body => {
  const lines = String(body).split('\n');
  if (lines.length && /^\/\/ \S+$/.test(lines[0])) lines.shift();
  if (lines.length && /^\[truncated: /.test(lines[lines.length - 1])) lines.pop();
  if (lines.length && lines[lines.length - 1] === '') lines.pop();   // council fence writes `${text}\n${fence}`: a file that ends with a newline leaves one empty line before the closing fence
  return lines.length;
};
const samePath = (a, b) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

/**
 * The ONE definition of "section <n>, line <m>" for plan A's drafted findings (claim_unmarked, claim_disputed_early, claim_range_unshown here; the same words open T1.3's verify_first_missing): every line of a plan
 * with the section it sits in and whether it is plan text. `section` is the number at the start of the nearest heading above it ("## 3. Design" -> "3", "### 3.2 x" -> "3.2"), else that heading's ordinal among the
 * plan's headings; text before the first heading is section "0". `line` is the line counted in the whole plan, from 1. `kind` is "heading", "fence" (a line of a fenced code block of the plan, fence lines included) or
 * "text". Pure.
 */
export function planLines(plan) {
  const out = []; let section = '0'; let ordinal = 0; let fenced = null;
  String(plan ?? '').split('\n').forEach((text, k) => {
    const line = k + 1;
    const fence = FENCE_LINE.exec(text);
    if (fenced) { out.push({ line, text, section, kind: 'fence' }); if (fence && fence[1][0] === fenced[0] && fence[1].length >= fenced.length && text.trim() === fence[1]) fenced = null; return; }
    if (fence) { fenced = fence[1]; out.push({ line, text, section, kind: 'fence' }); return; }
    const h = HEADING.exec(text);
    if (h) { ordinal += 1; section = sectionLabel(h[1], ordinal); out.push({ line, text, section, kind: 'heading' }); return; }
    out.push({ line, text, section, kind: 'text' });
  });
  return out;
}

/**
 * Findings for a plan, in the order they occur: [{ id, section, line, message }] with id claim_unmarked | claim_disputed_early | claim_range_unshown. The messages are A-DRAFT (plan A T1 wording; the excerpt form of
 * claim_range_unshown is mine, STEP3 F7 names the finding but drafts no sentence for it). `task` is the task text with its fenced blocks (null: no range check), `excerptIds` the ids of the excerpts that carry text (the ones a seat was shown), `excerptNoText` the ids the run
 * recorded WITHOUT text (withheld, refused, unanswered, not cut: A-DRAFT sentence below, so a withheld excerpt is not called "never recorded"), `disputePassRan` whether the dispute pass has run.
 */
export function checkClaimMarkers({ plan, task = null, excerptIds = [], excerptNoText = [], disputePassRan = false } = {}) {
  const findings = [];
  const blocks = task === null ? null : fencedBlocks(task);
  for (const { line, text: raw, section, kind } of planLines(plan)) {
    if (kind !== 'text') continue;
    const text = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
    if (!text || /^[|:\s-]+$/.test(text)) continue;
    for (const s of sentencesOf(text)) {
      const at = { section, line };
      if (!s.markers.length) {
        const what = nameOf(s.bare);
        if (what) findings.push({ id: 'claim_unmarked', ...at, message: `section ${section}, line ${line}: '${s.text.slice(0, 80)}' names ${what} and carries no CHECKED, UNVERIFIED, DISPUTED or ABSENT marker.` });
        continue;
      }
      for (const m of s.markers) {
        if (m.kind === 'DISPUTED' && !disputePassRan) findings.push({ id: 'claim_disputed_early', ...at, message: `section ${section}, line ${line} is marked DISPUTED, but no dispute pass has run; only the last revision writes that marker.` });
        if (m.kind !== 'CHECKED') continue;
        const exc = /\bexcerpt\s+(E-[1-9]\d*)/i.exec(m.body);
        if (exc) {
          if (!excerptIds.includes(exc[1])) findings.push({ id: 'claim_range_unshown', ...at, message: excerptNoText.includes(exc[1])
            ? `section ${section}, line ${line} is marked [CHECKED: excerpt ${exc[1]}], and that excerpt carries no text: it was withheld, refused, left unanswered or not cut, so no seat was shown it.`   // A-DRAFT (C&C 11 Nov 2026: a withheld excerpt is recorded, so "never recorded" would be false)
            : `section ${section}, line ${line} is marked [CHECKED: excerpt ${exc[1]}], and the run never recorded that excerpt.` });
          continue;
        }
        const range = /(?:inferred from\s+)?(\S+)\s+lines?\s+(\d+)\s*-\s*(\d+)/i.exec(m.body);
        if (range && blocks) {
          const [, path, a, b] = range; const lo = Number(a); const hi = Number(b);
          const shown = blocks.some(x => x.path && samePath(x.path, path) && lo >= 1 && lo <= hi && hi <= fileLinesOf(x.body));
          if (!shown) findings.push({ id: 'claim_range_unshown', ...at, message: `section ${section}, line ${line} is marked [CHECKED: ${path} lines ${a}-${b}], and no fenced block of the task contains that range.` });
        }
      }
    }
  }
  return findings;
}

/** The finding line as the warnings file prints it. */
export const claimFindingLine = f => `${f.id}: ${f.message}`;

/**
 * Every UNVERIFIED marker in the plan's own sections (the same reading as checkClaimMarkers: headings, fenced code blocks and blank lines skipped), in order: [{ section, line, claim, body }]. `claim` is the
 * sentence the marker ends, without its markers; `body` is what the marker says would settle it. The one parser of that marker: src/verify-first.js reads the plan through it (plan A T1.3, STEP3 F4).
 */
export function unverifiedMarkers(plan) {
  const out = [];
  for (const { line, text: raw, section, kind } of planLines(plan)) {
    if (kind !== 'text') continue;
    const text = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
    if (!text || /^[|:\s-]+$/.test(text)) continue;
    for (const s of sentencesOf(text)) for (const m of s.markers) if (m.kind === 'UNVERIFIED') out.push({ section, line, claim: s.bare.replace(/\s+/g, ' ').replace(/\s+([.!?])/g, '$1').trim(), body: m.body });
  }
  return out;
}

