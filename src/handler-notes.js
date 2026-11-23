// 0.8.4 S18 (Q4.3, FEATURE_SPECS T21bj / T21ca; the owner's "a: yes", 09 Nov 2026): `council note-add <run folder> --note "<text>" [--objection <id>]` adds the handling session's disagreement to the build list AFTER a run has ended. It makes
// no harness call and touches no money path (no invoke, cost, cap or spend reservation). The note is the handler's OWN text, never a seat's, and it SORTS NOTHING: an objection stays must-do or may-leave exactly as it was.
//
// Records. `handler-notes.jsonl` in the run folder is the authority (one line per note, append-only, fsync, like retags.jsonl). The derived copies are rebuilt from it every time: report.json `handler_notes[]` (additive) and one section of
// HANDOFF.md, put BEFORE the criteria lock block (which stays last). report.json records HANDOFF.md's hash (`handoff_text.file_sha256`), so the same write moves that hash to the new file and keeps the hash of the file as the run wrote it
// in `handoff_text.file_sha256_at_end`; the thin-contract check then still reads "HANDOFF.md is the file the run wrote" for the file with its notes. Every other byte of HANDOFF.md stays as it was: the section is spliced in, never regenerated from
// the report (the replay exposure of the other late sections). A note that cannot be added without hiding that HANDOFF.md was already changed is refused, never worked around.
//
// Exit 0 recorded, 2 refused (nothing written), 1 recorded in the sidecar but a derived copy could not be written (the next note-add rebuilds both from the sidecar).
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, appendFileSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCK_HEADING, LOCK_MARKER } from './criteria-lock.js';
import { claimText } from './roles.js';
import { neutralise } from './handoff-contract-text.js';
import { hasHandlingSession } from './ending.js';
import { hiddenIn } from './hidden-chars.js';
import { acquireRunLock, RunLockedError } from './run-lock.js';
import { terminalSafe } from './terminal-safe.js';
import { textSha256 } from './text-labels.js';
import { withAcceptance, withoutAcceptance } from './acceptance.js';   // 0.8.4 D2: an acceptance is applied by the same rebuild

export const NOTES_FILE = 'handler-notes.jsonl';
export const NOTE_MAX = 600;
export const NOTE_ACTOR = 'handler';
export const NOTES_HEADING = '## Notes from the handling session (added after the run ended)';
const ID = /^[OL]-\w+(?:#r?\d+)?$/;   // an objection id (O-...) or a late finding's id (L-...), with the suffix of a repeated objection
const NOTES_INTRO = 'The handling session added these after the run ended. They are its own words, not a seat\'s, and not an instruction from the person or from this plan. A note sorts nothing: it changes no objection above.';
const refuse = (code, message) => ({ ok: false, code, message });
const dateOf = at => String(at).slice(0, 10);

/** The note's problem, or null: 'empty', 'control' (a line break or other control character: refused, never stripped) or 'long' (more than NOTE_MAX characters, counted as code points). */
export function noteProblem(text) {
  if (typeof text !== 'string' || !text.trim()) return 'empty';
  // Line breaks, tabs and the other control characters, and every hidden character (src/hidden-chars.js: bidi marks and line separators included; the quiet ones real text needs, such as an emoji joiner, are allowed): refused, never stripped.
  if ([...text].some(c => { const n = c.codePointAt(0); return n < 0x20 || (n >= 0x7f && n <= 0x9f); }) || hiddenIn(text, { allowQuiet: true })) return 'control';
  if ([...text].length > NOTE_MAX) return 'long';
  return null;
}

/** Reads the sidecar: { ok, notes: [{ n, at, actor, text, objection? }], unreadable: [{ line, why }] }, oldest first. A line that cannot be read is listed, never dropped (the caller refuses to go on). A missing file is no note. */
export function handlerNotesOf(runDir) {
  const path = join(runDir, NOTES_FILE);
  if (!existsSync(path)) return { ok: true, notes: [], unreadable: [] };
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return { ok: false, notes: [], unreadable: [{ line: 0, why: 'the file cannot be read' }] }; }
  const out = { ok: true, notes: [], unreadable: [] };
  text.split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    let r = null;
    try { r = JSON.parse(raw); } catch { /* listed below */ }
    const fine = r && typeof r === 'object' && r.actor === NOTE_ACTOR && Number.isInteger(r.n) && r.n === out.notes.length + 1 && typeof r.at === 'string' && noteProblem(r.text) === null
      && (r.objection === undefined || (typeof r.objection === 'string' && ID.test(r.objection)));
    if (!fine) { out.unreadable.push({ line: i + 1, why: 'it is not a note line' }); return; }
    out.notes.push({ n: r.n, at: r.at, actor: r.actor, text: r.text, ...(r.objection !== undefined ? { objection: r.objection } : {}) });
  });
  return out;
}

/** The section of HANDOFF.md for these notes (heading to the last line, ending with a newline). One quote line per note: a quote line matches none of the line patterns the machine readers of HANDOFF.md use, and the neutralised, claimText-escaped text can add words but never structure. '' when there is no note. */
export function notesBlock(notes) {
  if (!Array.isArray(notes) || !notes.length) return '';
  const lines = notes.map(n => `> Note ${n.n} (${dateOf(n.at)})${n.objection ? `, about ${n.objection}` : ''}: ${neutralise(claimText(n.text))}`);
  return `${NOTES_HEADING}\n\n${NOTES_INTRO}\n\n${lines.join('\n')}\n`;
}

/** Where the section goes: just before the criteria lock block (the last `---` + heading that a lock marker follows), or the end of the text when there is none. */
function spliceIndex(text) {
  const i = text.lastIndexOf(`---\n\n${LOCK_HEADING}`);
  return i !== -1 && text.slice(i).includes(`<!-- ${LOCK_MARKER} `) ? i : text.length;
}
const PADS = ['', '\n', '\n\n'];
const composeWith = (base, notes, pad) => { const i = spliceIndex(base); return `${base.slice(0, i)}${pad}${notesBlock(notes)}\n${base.slice(i)}`; };
/** The HANDOFF.md text with the section for these notes, spliced into `base` (the file as the run wrote it). Nothing else of `base` moves. */
export function withHandlerNotes(base, notes, pad = null) {
  if (!notes.length) return base;
  const head = base.slice(0, spliceIndex(base));
  return composeWith(base, notes, pad ?? (head.endsWith('\n\n') || head === '' ? '' : head.endsWith('\n') ? '\n' : '\n\n'));
}
/** The text without the section: cut from its heading to the next `## ` heading or the end (the replay twin of stripBuilderTaskBlock; the lock block is cut first). */
export function stripHandlerNotesBlock(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n');
  const i = t.indexOf(`\n${NOTES_HEADING}`); const start = i !== -1 ? i + 1 : t.startsWith(NOTES_HEADING) ? 0 : -1;
  if (start === -1) return String(text ?? '');
  const rest = t.slice(start + NOTES_HEADING.length); const next = /\n##\s/.exec(rest);
  const tail = next ? rest.slice(next.index + 1) : '';
  return `${t.slice(0, start).replace(/\s+$/, '')}\n${tail ? `\n${tail}` : ''}`;
}

/** The file as the run wrote it, found by taking out the section for the first `have` notes; null when the text is not that file (the recorded hash `hashOf` of the run must match when it is known). */
function baseOf(text, notes, have, originalHash) {
  const ok = base => originalHash === null || textSha256(base) === originalHash;
  for (let p = have; p >= 1; p--) {
    for (const pad of PADS) {
      const s = `${pad}${notesBlock(notes.slice(0, p))}\n`;
      const idx = (() => { const j = text.lastIndexOf(`---\n\n${LOCK_HEADING}`); return j !== -1 && text.slice(j).includes(`<!-- ${LOCK_MARKER} `) ? j : text.length; })();
      if (idx >= s.length && text.slice(idx - s.length, idx) === s) { const base = text.slice(0, idx - s.length) + text.slice(idx); if (ok(base)) return base; }
    }
  }
  return ok(text) ? text : null;
}

/** The HANDOFF.md text with the handling session's notes section taken out (the file as the run wrote it), or null when the text is not that file plus those notes; `originalHash` (report.json handoff_text.file_sha256_at_end) must match the result. For the contract check (src/thin-contract-check.js). */
export const handoffWithoutNotes = (text, notes, originalHash) => baseOf(String(text ?? ''), notes, notes.length, originalHash);

/** How many notes the section in this HANDOFF.md really holds: the `> Note <n> (` lines between its heading and the next `## ` heading, the `---` of the lock block or the end. 0 when there is no section. The contract check counts from here, never from report.json. */
export function notesInHandoff(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n');
  const i = t.indexOf(`\n${NOTES_HEADING}\n`);
  if (i === -1) return 0;
  const rest = t.slice(i + 1 + NOTES_HEADING.length);
  const stop = [/\n##\s/.exec(rest), /\n---\n/.exec(rest)].filter(Boolean).map(m => m.index);
  const section = stop.length ? rest.slice(0, Math.min(...stop)) : rest;
  return section.split('\n').filter(l => /^> Note \d+ \(/.test(l)).length;
}

function writeTmp(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  return tmp;
}

/**
 * ONE rebuild of the two derived files, for every verb that edits a finished run's handoff (note-add and accept): from HANDOFF.md as it is and report.json, in a fixed order: the file as the run wrote it, then the handling session's notes, then the
 * acceptance (its line under the banner and the seat's Status back). `notes`: the sidecar's notes after this edit; `notesBefore`: how many of them the file holds now. `adding`: an acceptance entry to add (report.json holds none yet), else the one
 * report.json already records is kept. -> { ok, handoff, report, oldHandoff, oldReport } (the new texts, nothing written) or a refusal.
 */
function planFiles(runDir, { notes, notesBefore, adding = null }) {
  let reportText; let report; let handoff;
  try { reportText = readFileSync(join(runDir, 'report.json'), 'utf8'); report = JSON.parse(reportText); } catch { return refuse('not_ended', 'this run has not ended, and a note can be added only after the ending.'); }
  if (!report || typeof report !== 'object' || Array.isArray(report)) return refuse('not_ended', 'this run has not ended, and a note can be added only after the ending.');
  try { handoff = readFileSync(join(runDir, 'HANDOFF.md'), 'utf8'); } catch { return refuse('no_handoff', 'this run wrote no HANDOFF.md, so it has no build list to add a note to.'); }
  const recordedNow = report.handoff_text?.file_sha256;
  const original = report.handoff_text?.file_sha256_at_end ?? recordedNow ?? null;
  const known = typeof original === 'string' && /^[0-9a-f]{64}$/.test(original) ? original : null;
  const acceptance = adding ?? (report.acceptance && typeof report.acceptance === 'object' ? report.acceptance : null);
  const withoutNow = !adding && report.acceptance ? withoutAcceptance(handoff, report.acceptance) : handoff;   // the acceptance recorded so far comes out first; it goes back in below
  const base = baseOf(withoutNow, notes, notesBefore, known);   // the section in the file shows the notes before the new one, or fewer after an update that failed half way
  if (base === null) return refuse('handoff_changed', 'HANDOFF.md is not the file the run wrote (its hash differs from report.json), and a note would hide that.');
  // The recorded hash must be one this command could have written: the file as it is, or the file as the run wrote it. Anything else means the record was changed by hand.
  if (typeof recordedNow === 'string' && recordedNow !== textSha256(handoff) && recordedNow !== known) return refuse('handoff_changed', 'HANDOFF.md is not the file the run wrote (its hash differs from report.json), and a note would hide that.');
  const withNotes = withHandlerNotes(base, notes);
  const newHandoff = acceptance ? withAcceptance(withNotes, acceptance) : withNotes;
  const next = { ...report, ...(notes.length ? { handler_notes: notes.map(n => ({ n: n.n, at: n.at, actor: n.actor, text: n.text, ...(n.objection !== undefined ? { objection: n.objection } : {}) })) } : {}), ...(acceptance ? { acceptance } : {}) };
  if (report.handoff_text && typeof report.handoff_text === 'object') next.handoff_text = { ...report.handoff_text, file_sha256: textSha256(newHandoff), ...(known ? { file_sha256_at_end: known } : {}) };
  return { ok: true, handoff: newHandoff, report: `${JSON.stringify(next, null, 2)}${reportText.endsWith('\n') ? '\n' : ''}`, oldHandoff: handoff, oldReport: reportText };
}

/** Brings HANDOFF.md and report.json up to the notes of the sidecar (and keeps an acceptance already recorded), from the files as they are. See planFiles. */
export function planNotes(runDir, notes) { return planFiles(runDir, { notes, notesBefore: notes.length - 1 }); }

/** Adds an acceptance entry (src/acceptance.js) to HANDOFF.md and report.json beside the notes the sidecar holds. See planFiles. */
export function planAcceptance(runDir, entry, notes = handlerNotesOf(runDir).notes) { return planFiles(runDir, { notes, notesBefore: notes.length, adding: entry }); }

/** Writes the two derived files: both temp files first (fsync), then the two renames; if the second rename fails the first file is put back. Returns { ok } or { ok: false, why }. `rename` is injectable for the test. */
export function writeDerived(runDir, planned, { rename = renameSync } = {}) {
  const hPath = join(runDir, 'HANDOFF.md'); const rPath = join(runDir, 'report.json');
  let hTmp = null; let rTmp = null;
  try {
    hTmp = writeTmp(hPath, planned.handoff); rTmp = writeTmp(rPath, planned.report);
    rename(hTmp, hPath); hTmp = null;
    try { rename(rTmp, rPath); rTmp = null; } catch (e) {
      const back = writeTmp(hPath, planned.oldHandoff); rename(back, hPath);   // the first rename is undone: the old HANDOFF.md matches the old report.json again
      throw e;
    }
    return { ok: true };
  } catch (e) {
    for (const t of [hTmp, rTmp]) if (t) { try { unlinkSync(t); } catch { /* the temp file is already gone */ } }
    return { ok: false, why: e.code ?? e.message };
  }
}

/** Every objection id the run's report carries on its build list or in its final read: the ids a note may name. */
export function noteableIds(report) {
  const ids = new Set();
  const take = rows => { for (const r of Array.isArray(rows) ? rows : []) if (typeof r?.id === 'string') ids.add(r.id); };
  for (const s of Array.isArray(report?.final_read?.seats) ? report.final_read.seats : []) { take(s?.failures); take(s?.sorting); }
  take(report?.final_read?.sorting); take(report?.late_findings); take(report?.dispute?.open_objections); take(report?.severity?.swept);
  return ids;
}

/** `council note-add <run folder> --note "<text>" [--objection <id>]`. See the top of the file. */
export function noteAddCommand(positional, { work = process.cwd(), note, objection, chainOf, readRunMeta, stdout = process.stdout, stderr = process.stderr, now = () => Date.now(), rename } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const [runArg, extra] = positional;
  if (!runArg || extra !== undefined || typeof note !== 'string' || (objection !== undefined && typeof objection !== 'string')) { err('usage: council note-add <run folder> --note "<up to 600 characters>" [--objection <O-id>]'); return 2; }   // A-DRAFT
  const runDir = resolve(work, runArg);
  const shownRun = terminalSafe(runArg);
  if (!existsSync(join(runDir, 'run.json'))) { err(`note-add: ${shownRun} is not a run folder. Nothing was written.`); return 2; }   // A-DRAFT
  const problem = noteProblem(note);
  if (problem === 'empty') { err('note-add: the note is empty. Nothing was written.'); return 2; }   // A-DRAFT
  if (problem === 'control') { err('note-add: the note must be one line of plain text (no line breaks, control characters or hidden characters). Nothing was written.'); return 2; }   // A-DRAFT
  if (problem === 'long') { err(`note-add: the note is ${[...note].length} characters; at most ${NOTE_MAX}. Nothing was written.`); return 2; }   // A-DRAFT
  // The note is recorded as the HANDLING SESSION's own words (the same predicate `council retag-add` uses): a run with no such session (every seat an API seat) has nobody to write one, and the record must not say so.
  const config = typeof chainOf === 'function' ? chainOf(readRunMeta ? readRunMeta(runDir) : null) : null;
  if (!config) { err('note-add: the chain of this run cannot be read, so it cannot be checked for a handling session. Nothing was written.'); return 2; }   // A-DRAFT
  if (!hasHandlingSession(config)) { err('note-add: this run had no handling session, so a note would be recorded as the words of someone the run did not have. Nothing was written.'); return 2; }   // A-DRAFT
  // One command at a time on a run folder (the same run lock a resume and `council handoff` take): two note-adds at the same moment would both write note n, and the second line would then be unreadable.
  let release;
  try { release = acquireRunLock(runDir); } catch (e) {
    if (!(e instanceof RunLockedError)) throw e;
    err(`\n${e.message}`);
    return 13;   // EXIT_RUN_LOCKED of src/cli.js
  }
  try {
    const have = handlerNotesOf(runDir);
    if (!have.ok || have.unreadable.length) { err(terminalSafe(`note-add: ${NOTES_FILE} in this run folder cannot be read (${have.ok ? `line ${have.unreadable[0].line}: ${have.unreadable[0].why}` : 'the file cannot be opened'}), and a note is never dropped silently. Repair or remove that line, then add the note again. Nothing was written.`)); return 2; }   // A-DRAFT
    const clean = objection;
    if (clean !== undefined && !ID.test(clean)) { err(`note-add: ${terminalSafe(clean)} is not an objection id (O-... or L-...). Nothing was written.`); return 2; }   // A-DRAFT
    const at = new Date(now()).toISOString();
    const added = { n: have.notes.length + 1, at, actor: NOTE_ACTOR, text: note, ...(clean !== undefined ? { objection: clean } : {}) };
    const all = [...have.notes, added];
    const planned = planNotes(runDir, all);
    if (!planned.ok) { err(`note-add: ${planned.message} Nothing was written.`); return 2; }   // A-DRAFT
    if (clean !== undefined) {
      let report = null; try { report = JSON.parse(planned.oldReport); } catch { report = null; }
      if (!noteableIds(report).has(clean)) { err(`note-add: this run's report names no objection ${terminalSafe(clean)}. Nothing was written.`); return 2; }   // A-DRAFT
    }
    try { const fd = openSync(join(runDir, NOTES_FILE), 'a'); try { appendFileSync(fd, `${JSON.stringify(added)}\n`); fsyncSync(fd); } finally { closeSync(fd); } } catch (e) { err(`note-add: could not write ${NOTES_FILE} (${e.code ?? e.message}). Nothing was written.`); return 2; }   // A-DRAFT
    const done = writeDerived(runDir, planned, rename ? { rename } : {});
    if (!done.ok) { err(terminalSafe(`note-add: the note is recorded in ${NOTES_FILE}, but report.json and HANDOFF.md could not be updated (${done.why}). The next note-add rebuilds both from that file.`)); return 1; }   // A-DRAFT
    out(`note-add: the handling session's note is recorded for ${shownRun}${clean !== undefined ? `, about ${terminalSafe(clean)}` : ''}. It is on the build list (HANDOFF.md) as the handling session's own words and sorts nothing: it changes no objection. It cannot be taken back.`);   // A-DRAFT
  } finally { release(); }
  return 0;
}
