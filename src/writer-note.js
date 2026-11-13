// 0.8.4 S4 (M1; Q1(f), D35, W34, T19a, T19l): the WRITER'S FIX NOTE of a pass, as the record keeps it. PURE: plain data in, plain data out.
// The writer (the reviser) is asked, once the wording W34 is recorded (held('writerFixNote')), to say for each objection that stood what it did with it:
//   a FIX-TAKEN line (src/draft-disputes.js): the judge's line or its own fix, and the passage of the plan it changed;
//   or a DECLINED line (the one decline channel the reviser already has): its reason, and no passage.
// The record is built from those lines and from nothing else: a fix is never inferred from a draft diff, an objection with no line has no row, an id that is not a standing objection of the pass is dropped (and returned apart so the caller can log it),
// and an id with both a fix line and a DECLINED line is recorded as `conflicting` with neither claimed. The passage and the reason are the writer's own words (model-supplied claims, not verified here).
// A row keeps the judge's own fix line (the failure's `fix`), so the record holds the judge's line, the writer's note and (in severity.withdrawn[].cleared_by, the raiser's answer) side by side.

/** taken: 'judge_line' | 'writer_own' (a fix, with `passage`) | 'declined' (with `reason`, no passage) | 'conflicting' (both kinds of line named the id). */
export const WRITER_TAKEN = Object.freeze(['judge_line', 'writer_own', 'declined', 'conflicting']);

/**
 * `failures`: the pass's standing objections ([{ id, lab, fix? }]). `fixTaken`: the parsed FIX-TAKEN lines of the reply that became the draft ([{ id, by: 'judge_line' | 'writer_own', passage }], top to bottom; the LAST line for an id counts).
 * `declined` / `declinedIds`: the parsed DECLINED reasons and the ids they name (null = no id), in step. -> { rows, dropped } (`dropped`: the ids of fix lines that name no standing objection).
 */
export function writerNoteRows({ failures, fixTaken = [], declined = [], declinedIds = [] }) {
  const standing = new Map();
  for (const f of failures || []) if (f && typeof f.id === 'string' && !standing.has(f.id)) standing.set(f.id, f);
  const rows = [];
  for (const [id, f] of standing) {
    const fixes = fixTaken.filter(x => x.id === id);
    const k = declinedIds.indexOf(id);
    const base = { id, lab: f.lab, ...(typeof f.fix === 'string' && f.fix.trim() ? { judge_fix: f.fix.trim() } : {}) };
    if (fixes.length && k >= 0) rows.push({ ...base, taken: 'conflicting' });
    else if (k >= 0) rows.push({ ...base, taken: 'declined', reason: String(declined[k] ?? '').trim() });
    else if (fixes.length) { const last = fixes.at(-1); rows.push({ ...base, taken: last.by, passage: last.passage }); }
  }
  const dropped = [...new Set(fixTaken.map(x => x.id).filter(id => !standing.has(id)))];
  return { rows, dropped };
}
