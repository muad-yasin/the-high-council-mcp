// DECLINED lines and the one function every reader of a model's draft text goes through (0.8.1 FX-15: the build stage did not parse them).
// parseDisputes moved here verbatim from src/chain.js (which re-exports it, so every import keeps working): a builder's or a reviser's raw stage text
// can end in DECLINED lines, and whoever takes that text as a DRAFT - the build stage, a reviser stage, `--from-run`, `council handoff --from-run` -
// must strip them. Nothing else in the harness may read build.md or a revise-N.md as a draft without `stripDeclined` or `readModelDraft`
// (test/regression-081-build-declined.test.js scans src/ for it). The finalist stage is deliberately NOT routed through here: its prompt has no DECLINED
// channel (its job is to remove chain artifacts), so a DECLINED line in its reply is text, not a dispute.
import { readFileSync } from 'node:fs';
import { noteLineOf } from './review-notes.js';

// §5 (v3 plan, MISTRAL-3 accepted): a reviser that judges an objection to not
// be a real defect ends its reply with one or more trailing "DECLINED: <reason>"
// lines (src/roles.js's reviser system prompt). Those lines are never part of
// the deliverable a critic grades - they're stripped here and returned
// separately so the caller can carry them into report.json's `disputes`
// field instead. Only lines strictly at the end of the reply count: a
// "DECLINED:"-shaped line does not get pulled out of the middle of the
// deliverable's own body text.
// `disputedBlock` (default true: the reviser stages, as in 0.8.0): also strip a trailing Disputed block. The build stage and the draft readers FX-15 added pass false: a
// builder's plan may legitimately contain a paragraph that starts with "Disputed" (audit A5-2), so only its DECLINED lines are stripped there.
/**
 * How many lines of closing chatter (non-blank lines that are not a well-formed `DECLINED: O-xxxxxxxx: ...` line) may follow a DECLINED line for that line to still count as part of the trailer. One named constant, OPEN for C&C's ruling
 * (trailer-fix gate note 15 Oct 2026): three allow a sentence plus a two-line sign-off, while a longer tail starts to look like plan text, which must never be cut.
 */
export const CLOSING_LINES_MAX = 3;

// Notes lane unit 2 (gate note Notes_Lane_Unit2_Gate_Note.md section 2, C&C ruling Q11): a writer's answer line to a judge's proposal or idea (`NOTE-TAKEN|DECLINED|SAME: N-xxxxxxxx ...`, the ONE grammar in
// src/review-notes.js) is a trailer line like a DECLINED line, for EVERY caller. It is stripped from the text and returned apart in `noteLines` (raw lines, top to bottom). Only a WELL-FORMED line counts
// (a `NOTE-` line with a bad id, wrong case or a self-pointing SAME is plain text: it stays, and spends the closing budget below). A well-formed NOTE line costs nothing in the closing walk.
const wellFormedNote = line => { const n = noteLineOf(line); return n !== null && n.malformed !== true; };

// ROADMAP 83 (early finish by the session): ONE trailer line, `EARLY-FINISH: <the session's reason>`, a reviser answered by the person's own session may end its reply with. It is a trailer line like a NOTE line, for EVERY
// caller (stripped from the text, so it can never reach a draft, a deliverable or a critic), and returned apart as `earlyFinish`. Only a stage that acts on it reads that field (the layered revise); every other reader
// only strips. Well-formed = the exact uppercase word, a colon, and at least one character of reason; anything else is plain text and spends the closing budget.
export const earlyFinishOf = line => { const m = /^EARLY-FINISH:[ \t]*(\S.*)$/.exec(String(line).trim()); return m ? m[1].trim() : null; };
const wellFormedEarly = line => earlyFinishOf(line) !== null;

export function parseDisputes(text, { disputedBlock = true, withIds = false } = {}) {
  let lines = text.split('\n');
  const noteLines = [];
  const earlyLines = [];   // top to bottom; the LAST one is the session's final word
  const declined = [];
  const declinedIds = []; // 0.8.2 (owner, 7 Oct 2026, P13): in step with `declined`: the objection id a line answers ("DECLINED: O-1a2b3c4d: <reason>"), or null
  // Strip trailing DECLINED lines and a trailing Disputed block, in any order, until neither is
  // left at the end. Blank lines inside the trailer are skipped, not treated as its end. Bug-audit
  // fix, 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #3): a reply ending in "\n" - every
  // external-seat reviser file does - left an empty last line, the loop stopped there, every
  // DECLINED line was lost from report.json's `disputes` AND shipped inside the deliverable text.
  //
  // The Disputed block: pre-release audit 2026-09-23 (RolesPrompts #1, HIGH). REVISER_SYSTEM used
  // to ALSO tell the reviser to add a "Disputed" line at the end, contradicting the DECLINED rule
  // below it, and only DECLINED was stripped. In a real premium run the reviser ended its draft
  // with a multi-line "DISPUTED: ... This plan's position, unchanged: ..." paragraph: it stayed in
  // the graded draft, `disputes` was empty, and panel seats then marked "records dissent honestly"
  // as met BECAUSE of it. The prompt rule is gone (DECLINED is the only channel); this strip is the
  // defence in depth for a model that writes one anyway. Only a TRAILING block counts - one that
  // starts at a "Disputed" heading or a "DISPUTED:" line with nothing but its own paragraph after it
  // - so a plan that merely discusses disputes in its body is never cut.
  const DISPUTED_START = /^(#{1,6}\s*)?(\*\*)?disputed\b(\*\*)?\s*:?/i;
  for (let changed = true; changed;) {
    changed = false;
    let i = lines.length - 1;
    while (i >= 0 && lines[i].trim() === '') i--;
    while (i >= 0) {
      const line = lines[i].trim();
      if (line === '') { i--; continue; }
      if (wellFormedNote(line)) { noteLines.unshift(line); i--; changed = true; continue; }
      if (wellFormedEarly(line)) { earlyLines.unshift(earlyFinishOf(line)); i--; changed = true; continue; }
      if (!/^DECLINED:\s*.+/.test(line)) break;
      const rest = line.replace(/^DECLINED:\s*/, '');
      const { ids, reason } = withIds ? splitDeclinedId(rest) : { ids: [null], reason: rest }; // `withIds`: only the stage whose prompt asks for ids (the revise of a chain with answer_back.enabled); everywhere else a line is read as it always was
      for (const id of [...ids].reverse()) { declined.unshift(reason); declinedIds.unshift(id); } // a line naming several ids gives each its own entry with the same reason
      i--; changed = true;
    }
    lines = lines.slice(0, i + 1);
    // A trailing Disputed block: walk back over its paragraph(s) to the line that opens it.
    let j = lines.length - 1;
    while (j >= 0 && lines[j].trim() === '') j--;
    let k = j;
    while (k >= 0 && !DISPUTED_START.test(lines[k].trim()) && lines[k].trim() !== '' && !/^#{1,6}\s/.test(lines[k].trim())) k--;
    // A heading-style block ("## Disputed") may be followed by a blank line and then its lines.
    if (k >= 0 && lines[k].trim() === '' && k > 0) {
      let h = k - 1;
      while (h >= 0 && lines[h].trim() === '') h--;
      if (h >= 0 && /^#{1,6}\s*(\*\*)?disputed\b/i.test(lines[h].trim())) k = h;
    }
    if (disputedBlock && k >= 0 && k <= j && DISPUTED_START.test(lines[k].trim())) {
      const block = lines.slice(k, j + 1).map(l => l.trim()).filter(Boolean);
      const body = [block[0].replace(DISPUTED_START, '').trim(), ...block.slice(1)].filter(Boolean).join(' ');
      if (body) { declined.push(body); declinedIds.push(null); }
      lines = lines.slice(0, k);
      changed = true;
    }
  }
  // Closing chatter (tier (a) defect since 0.8.2, found by the notes-lane page's probe, 15 Oct 2026): a reviser that adds a closing sentence AFTER its DECLINED lines used to keep every one of them in the plan and lose the
  // dispute record, because the loop above stops at the first line that is not a DECLINED line. Walk back from the end: a STRICT line (`DECLINED:` + a well-formed objection id, whatever `withIds` is) is collected for free;
  // every other non-blank line spends a budget of CLOSING_LINES_MAX, and the walk stops when it is spent. So a strict line quoted in the middle of a plan is never touched, and any number of strict lines above one closing
  // sentence all go. Only the strict lines are removed: the chatter stays where it is (silently deleting text that may be plan is the failure this closes). Known limit: a well-formed id line in the closing region that is plan text is stripped.
  {
    const strictRest = line => { const m = /^DECLINED:\s*(.+)/.exec(line.trim()); return m && splitDeclinedId(m[1]).ids[0] !== null ? m[1] : null; };
    const hits = []; const noteHits = []; const earlyHits = []; let budget = CLOSING_LINES_MAX;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === '') continue;
      if (strictRest(lines[i]) !== null) { hits.push(i); continue; }
      if (wellFormedNote(lines[i])) { noteHits.push(i); continue; } // an answer line is free, like a strict DECLINED line
      if (wellFormedEarly(lines[i])) { earlyHits.push(i); continue; } // so is the early-finish line
      if (budget === 0) break;
      budget--;
    }
    for (const i of hits) { // bottom to top, so unshift leaves the record top to bottom
      const rest = strictRest(lines[i]);
      const { ids, reason } = withIds ? splitDeclinedId(rest) : { ids: [null], reason: rest };
      for (const id of [...ids].reverse()) { declined.unshift(reason); declinedIds.unshift(id); }
    }
    for (const i of noteHits) noteLines.unshift(lines[i].trim()); // bottom to top, so unshift leaves them top to bottom, above the ones the first loop took
    for (const i of earlyHits) earlyLines.unshift(earlyFinishOf(lines[i]));
    if (hits.length || noteHits.length || earlyHits.length) { const drop = new Set([...hits, ...noteHits, ...earlyHits]); lines = lines.filter((_, i) => !drop.has(i)); }
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return { draft: lines.join('\n'), disputes: declined, disputeIds: declinedIds, noteLines, earlyFinish: earlyLines.length ? earlyLines[earlyLines.length - 1] : null };
}

// "O-1a2b3c4d: <reason>" (also "[O-1a2b3c4d] <reason>", "O-1a2b3c4d - <reason>", "O-1a2b3c4d <reason>"; any case) names the objection a DECLINED line answers (src/objection-ids.js: "O-" and eight hex digits).
// A line with no id, or an id and nothing after it, stays whole as a reason with no id: a line is never lost and never matched to an objection by guesswork.
function splitDeclinedId(rest) {
  // Audit fix cnc-prompts F5: an id may be wrapped in backticks, emphasis or angle/square brackets, and one line may name several ("`O-aaaaaaaa`, `O-bbbbbbbb` - reason").
  const WRAP = '[`*_<\\[(]*'; const END = '[`*_>\\])]*'; const ONE = 'O-[0-9a-f]{8}(?![0-9a-f])';
  const m = new RegExp(`^${WRAP}(${ONE}(?:${END}\\s*,\\s*${WRAP}${ONE})*)${END}\\s*(?:[:\\-\\u2013\\u2014]\\s*)?(\\S[\\s\\S]*)$`, 'i').exec(rest);
  return m ? { ids: m[1].match(/O-[0-9a-f]{8}/gi).map(x => x.toLowerCase().replace(/^o-/, 'O-')), reason: m[2].trim() } : { ids: [null], reason: rest };
}

/** Notes lane 2b-1b: the closing answer lines (strict NOTE-TAKEN / NOTE-DECLINED / NOTE-SAME) of a stage reply that is NOT a revise (the handoff reply, the standalone notes-answer reply). The SAME closing walk as parseDisputes
 *  (a strict NOTE line is free, any other non-blank line spends CLOSING_LINES_MAX, the walk stops when spent) but it removes ONLY well-formed NOTE lines: no DECLINED line, no Disputed block, nothing else moves. When no line is
 *  removed the text comes back byte for byte. -> { text, noteLines } (noteLines top to bottom, trimmed). Lives here, not in review-notes.js, because CLOSING_LINES_MAX and the walk are this file's (review-notes.js stays a leaf). */
export function collectNoteLines(text) {
  const src = String(text ?? ''); const lines = src.split('\n'); const hits = []; let budget = CLOSING_LINES_MAX;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '') continue;
    if (wellFormedNote(lines[i])) { hits.push(i); continue; }
    if (budget === 0) break;
    budget--;
  }
  if (!hits.length) return { text: src, noteLines: [] };
  const drop = new Set(hits); const kept = lines.filter((_, i) => !drop.has(i));
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  return { text: kept.join('\n'), noteLines: hits.reverse().map(i => lines[i].trim()) };
}

/** The draft in a model's stage text, with its trailing DECLINED lines removed (a Disputed paragraph is plan text here; see parseDisputes). */
export function stripDeclined(text) {
  return parseDisputes(String(text ?? ''), { disputedBlock: false }).draft;
}

/** The same strip as stripDeclined, with the NOTE answer lines it removed (a caller that can show a count uses this one; stripDeclined returns the text only). */
export function stripDeclinedWithNotes(text) {
  const r = parseDisputes(String(text ?? ''), { disputedBlock: false });
  return { draft: r.draft, noteLines: r.noteLines };
}

/** Read a stage file (build.md, revise-N.md) as a draft: its text without the DECLINED lines. */
export function readModelDraft(path) {
  const text = readFileSync(path, 'utf8');
  // A reviser's stage file is read the way the reviser stage reads it (its trailing Disputed block is the model's own record of a declined objection); a builder's is not.
  return /(^|[\\/])revise-\d+\.md$/.test(path) ? parseDisputes(text).draft : stripDeclined(text);
}
