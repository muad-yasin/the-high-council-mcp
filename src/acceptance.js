// 0.8.4 T2.3 / D2 (plan A, C&C's words of 09 Nov 2026): the ACCEPTANCE of a plan a run ended without agreement on. A separate, explicit record, never implied by a finish: it approves building the plan AS IT STANDS. It overrules no judge and marks
// nothing agreed (the ending word, the banner and the open objections are untouched; only the Status clamp lifts). The gate ledger is the authority (kind `acceptance`, src/gate.js); report.json gets a derived `acceptance` entry and HANDOFF.md
// gets one line under the banner and its Status back. This file is the PURE half: the open objections, the text the acceptor is shown, who may accept, the line, and its splice. No model, no file, no clock.
import { claimText } from './roles.js';
import { neutralise } from './handoff-contract-text.js';
import { isHardStop, isPersonStop } from './overseer-rounds.js';
import { clampStatus, liftStatus } from './handoff-status.js';
import { statusAllowedOf, agreedOf, OBJECTION_ID, standingLateOf } from './ending-matrix.js';
import { hiddenIn } from './hidden-chars.js';

export const ACCEPTANCE_REASON_MAX = 600;
export const ACCEPT_LEAD = '> **Accepted as it stands**';
const dateOf = at => String(at).slice(0, 10);

/** The reason's problem, or null: 'empty', 'control' (a line break, control or hidden character: refused, never stripped) or 'long' (more than ACCEPTANCE_REASON_MAX code points). */
export function acceptanceReasonProblem(text) {
  if (typeof text !== 'string' || !text.trim()) return 'empty';
  if ([...text].some(c => { const n = c.codePointAt(0); return n < 0x20 || (n >= 0x7f && n <= 0x9f); }) || hiddenIn(text, { allowQuiet: true })) return 'control';
  if ([...text].length > ACCEPTANCE_REASON_MAX) return 'long';
  return null;
}

/**
 * What stands open at the end of a finished run, from its report: the dispute record's open objections that the final read did not close (else the last critique's failures), and the late findings the run still carries (`late_findings[]`, never
 * debated, found where no round follows to debate them; a row marked `dropped_after_check` is no longer carried and is not listed). -> [{ id, lab, criterion, problem, late? }] sorted by id, one per id; `late: true` marks a late finding.
 * An entry with no id cannot be named and is not listed.
 */
export function openObjectionsOf(report) {
  const fromDispute = Array.isArray(report?.dispute?.open_objections) ? report.dispute.open_objections.filter(o => o && o.closed_by !== 'final_read') : null;
  const rows = fromDispute ?? (Array.isArray(report?.lastCritique?.failures) ? report.lastCritique.failures : []);
  const late = standingLateOf(report?.late_findings);   // 0.8.4 round 1, the A7 fix: the one filter (src/ending-matrix.js), the one the finish-at-once reasons read
  const lateIds = new Set(late.map(l => l?.id));   // marked by membership, so an L- id that another list also names keeps its mark whichever list is read first
  const seen = new Map();
  for (const o of [...rows, ...late]) if (o && typeof o.id === 'string' && OBJECTION_ID.test(o.id) && !seen.has(o.id)) seen.set(o.id, { id: o.id, lab: String(o.lab ?? ''), criterion: String(o.criterion ?? ''), problem: String(o.problem ?? ''), ...(lateIds.has(o.id) ? { late: true } : {}) });
  return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** What is bound when an acceptance is asked: the delivered text it is about and the sorted ids it accepts as they stand. */
export function acceptanceBinding(report) {
  return { plan_sha256: typeof report?.delivered_text?.sha256 === 'string' ? report.delivered_text.sha256 : null, objections: openObjectionsOf(report).map(o => o.id) };
}

/** The text the acceptor is shown and approves (A-DRAFT; the gate hashes these exact bytes). */
export function acceptanceQuoteText({ runId, report, objections }) {
  const hasLate = objections.some(o => o.late === true);
  const list = objections.length ? objections.map(o => (o.late ? `- ${o.id} (${o.lab || 'a judge'}, a late finding): ${neutralise(claimText(o.problem || o.criterion || '(no text)')).slice(0, 300)}` : `- ${o.id} (${o.lab || 'a judge'}): ${neutralise(claimText(o.problem || o.criterion || '(no text)')).slice(0, 300)}`)).join('\n') : '(none are open)';
  const head = hasLate ? 'Open objections and late findings accepted as they stand (a late finding was found where no round follows to debate it, so it was not debated):' : 'Open objections accepted as they stand:';   // WORDING U3-w33 (the late variant)
  return `# Accept this plan as it stands?\n\nRun ${runId}. The run ended "${report?.ending_word ?? 'without a word'}" and the panel did not agree. Accepting approves building the plan as it stands. It does not agree with any judge, changes no objection and marks nothing agreed: the banner and the open objections below stay on the handoff.\n\nPlan sha256: ${report?.delivered_text?.sha256 ?? '(not recorded)'}\n\n${head}\n${list}\n`;   // WORDING U3-w13
}

/**
 * May the handling SESSION accept this run's plan? (plan A D2 choice B.) Only when no stop of the run was the person's and the delivered text is the text the panel last reviewed; otherwise the person accepts. The per-objection test is a
 * second condition, checked where the answer is read. -> { ok: true } | { ok: false, why: 'agreed' | 'hard_stop' | 'person_stop' | 'text_changed', message }.
 * `report`: report.json; `meta`: run.json (roundChoices: each choice records its channel; a choice typed at the terminal is `cli`).
 */
export const PERSON_STOP_KINDS = Object.freeze(['secret_pause', 'budget_stop']);   // a scan hit and the spending limit: the person's stops, as stop_decide's own description says
export function sessionMayAccept({ report, meta }) {
  if (PERSON_STOP_KINDS.includes(report?.stop?.kind) || (report?.spending_finish && typeof report.spending_finish === 'object')) return { ok: false, why: 'person_stop', message: 'this run was finished at a scan hit or at the spending limit, which are the person\'s stops, so accepting this plan is the person\'s.' };   // A-DRAFT
  if (Array.isArray(report?.raises) && report.raises.length) return { ok: false, why: 'person_stop', message: 'the person raised the spending limit of this run, so accepting this plan is the person\'s.' };   // A-DRAFT
  if ((Array.isArray(meta?.conflictChoices) && meta.conflictChoices.length) || (Array.isArray(meta?.seatChoices) && meta.seatChoices.length)) return { ok: false, why: 'person_stop', message: 'a conflict between objections or a silent seat was decided at the terminal, so accepting this plan is the person\'s.' };   // A-DRAFT
  if (isHardStop(report?.stop)) return { ok: false, why: 'hard_stop', message: 'a stop after seven or more overseer rounds is the person\'s alone, so accepting this plan is the person\'s too.' };   // A-DRAFT
  if (isPersonStop(report?.stop) && report.stop.kind !== 'owner_pause') return { ok: false, why: 'hard_stop', message: 'a stop at the round limit the person typed is the person\'s alone, so accepting this plan is the person\'s too.' };   // A-DRAFT (LAD-P2; 0.8.4, C&C 10 Nov: the ladder run\'s typed-limit stop, at every N)
  const choices = Array.isArray(meta?.roundChoices) ? meta.roundChoices : [];
  // A relayed choice is the person's: this extends the plan A D2 rule above (when the person answered a stop, the person accepts) to an answer the person gave through the session. Accept exists only for a run that did not end agreed, so the handler's agreed ending is not touched.
  if (choices.some(c => c && typeof c === 'object' && c.relayed === true)) return { ok: false, why: 'person_stop', message: 'a stop of this run was answered with the person\'s own words, relayed by the handling session, so accepting this plan is the person\'s.' };   // A-DRAFT (LAD-P3; 0.8.4)
  if (choices.some(c => c && typeof c === 'object' && c.channel !== 'session')) return { ok: false, why: 'person_stop', message: 'a stop of this run was answered at the terminal, so accepting this plan is the person\'s.' };   // A-DRAFT
  if (report?.delivered_text?.same_as_signed !== true) return { ok: false, why: 'text_changed', message: 'the delivered text is not the text the panel last reviewed (a later stage changed it), so accepting this plan is the person\'s.' };   // A-DRAFT
  return { ok: true };
}

/** Why an acceptance cannot be made for this report at all, or null: the run must have ended (a report), must not have agreed (nothing to accept), and must not already be accepted. */
export function acceptanceRefusal(report) {
  if (!report || typeof report !== 'object') return { code: 'not_ended', message: 'this run has not ended, and a plan can be accepted only after the ending.' };   // A-DRAFT
  if (report.acceptance) return { code: 'already_accepted', message: 'this plan was already accepted as it stands.' };   // A-DRAFT
  if (agreedOf(report)) return { code: 'agreed', message: 'this run ended agreed, so there is nothing to accept.' };   // A-DRAFT
  return null;
}

/** The words for who accepted (T4.2's chooser values): the handling session, or a choice typed at the terminal. */
export const chooserWords = entry => (entry?.relayed === true ? "the person's words, relayed by the handling session" : entry?.channel === 'session' ? 'the handling session' : 'a choice typed at the terminal');   // 0.8.4 (relayed accept, A-DRAFT LAD-A3)

/** The line under the banner (A-DRAFT; harness-written). `entry`: the report's acceptance entry. */
export function acceptanceLine(entry) {
  const rows = entry.objections ?? [];
  const ids = rows.filter(o => o.late !== true).map(o => o.id); const lateIds = rows.filter(o => o.late === true).map(o => o.id);
  const lateTail = lateIds.length ? ` Late findings, not debated, accepted as they stand: ${lateIds.join(', ')}.` : '';   // WORDING U3-w34 (the late variant)
  return `${ACCEPT_LEAD} by ${chooserWords(entry)} on ${dateOf(entry.at)}: ${neutralise(claimText(entry.relayed === true && typeof entry.person_words === 'string' ? entry.person_words : entry.reason)).replace(/[\s.]+$/, '')}. Open objections left standing, accepted as they stand: ${ids.length ? ids.join(', ') : 'none'}.${lateTail} Written by the harness, not a model.`;   // WORDING U3-w14
}

/** The index in `text` just after the leading block of `> ` lines (the banner), where the acceptance line goes; 0 when the text does not start with a quote line. */
function afterBanner(text) {
  const lines = text.split('\n'); let end = 0; let i = 0;
  while (i < lines.length && lines[i].startsWith('> ')) { end += lines[i].length + 1; i += 1; }
  return Math.min(end, text.length);
}

/**
 * The HANDOFF.md text with the acceptance: the line at the end of the banner block and the seat's Status back (liftStatus with the word the entry records). A text that already holds the line is returned unchanged.
 */
export function withAcceptance(text, entry) {
  const line = acceptanceLine(entry);
  const t = String(text ?? '');
  if (t.includes(`${line}\n`)) return t;
  const lifted = typeof entry.status_restored === 'string' ? liftStatus(t, entry.status_restored) : t;
  const at = afterBanner(lifted);
  if (at === 0) return `${line}\n\n${lifted}`;   // no banner (a run that did not agree always has one): the line opens the file
  return `${lifted.slice(0, at)}${line}\n${lifted.slice(at)}`;
}

/** The exact inverse of withAcceptance for this entry: the line taken out and the Status clamped again. The text is returned unchanged when it holds no such line. */
export function withoutAcceptance(text, entry) {
  const line = acceptanceLine(entry);
  const t = String(text ?? '');
  let out;
  if (t.startsWith(`${line}\n\n`)) out = t.slice(line.length + 2);
  else if (t.includes(`\n${line}\n`)) out = t.replace(`${line}\n`, '');
  else return t;
  if (typeof entry.status_restored === 'string') out = clampStatus(out, statusAllowedOf(undefined, { agreed: false })).text;
  return out;
}

/** The text without any acceptance line (the replay twin of stripHandlerNotesBlock: on a case-insensitive disk the cached handoff stage is HANDOFF.md itself). The Status is not clamped again here: the replayed text is the seat's, which has its own word. */
export function stripAcceptanceLines(text) {
  const t = String(text ?? '');
  if (!t.includes(ACCEPT_LEAD)) return t;
  return t.split('\n').filter(l => !l.startsWith(ACCEPT_LEAD)).join('\n');
}

