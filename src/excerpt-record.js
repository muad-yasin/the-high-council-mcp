// 0.8.4 D9 (plan A T5.3): the excerpt record. `excerpts.jsonl` in the run folder, one JSON line per excerpt of project text the seats are shown during a run, or per request that was declined, left unanswered,
// withheld or not cut. Pure file work, $0, no model call. This module is the RECORD: building and checking an entry, appending it, reading the file back, the report's additive count-and-hash entry, and the prompt block
// (its words are A-DRAFT and held: `excerptsBlock` in test/held-prompts/held-084-a.js; while src/roles.js has not recorded it the block is ''). Who extracts the text (D8), when a scan runs (D20), the approval
// switch (D10) and the call sites in a run are other units and call into this one.
//
// A line holds: schema (the version tag the sibling run-folder records carry, spend-reservations/1 for one; here excerpts/1), id (E-<n>, in the order recorded), request_kind, requested_by, objection_id, why, source_kind, path, lines, text, text_sha256, file_sha256, edited, pasted_by, advisor, advisor_said,
// answered_stage, scans, approval, and `origin` after objection_id (C&C 09 Nov 2026: the label of the reply that carried a seat's request, e.g. panel-1-<seat key> or debate-<seat key>; null for a session_read). `text` is the EXACT text shown after any edit (plan A STEP3 A3): the prompt block is built from it, never by cutting the file again, so a file that changes
// afterwards, or a person's redaction, is shown on a resume as it was recorded. `approval` is { status, actor, channel, at, reason } with status not_required | approved | edited | refused | unanswered |
// withheld (STEP3 F5) | not_cut (C&C 09 Nov 2026: the harness could not cut the text a request or a session read named; no actor, no channel, a reason in the refusal's words, answered_stage required); `channel` is one of the gate's own channels (cli, elicitation, session: APPROVAL_CHANNELS below, pinned to src/gate.js by test/excerpt-schema.test.js; this module cannot import the gate, the gate scanner of
// test/gate-answer.test.js allows only listed importers) and `actor` is what the gate ledger recorded for that answer, never a second vocabulary (STEP3 F10):
// the operating-system user name for `cli`, the MCP client's name for `elicitation`, `main-session` for `session`, and null when the gate recorded none.
// One optional field after `approval`, `supersedes` (A1, 0.8.4 pr2 fix): the id of an earlier row recorded `not_required` that this row REPLACES. The record is append-only, so a row recorded before the privacy switch was turned on and not yet shown to any seat
// cannot be changed in place when the person is asked about it at the switch; it is asked again as a new row that names it here, and every reader of the run's excerpts uses `liveExcerpts` (the rows no later row replaces), so the older text reaches no
// prompt, no quote check and no plan check once the person has answered, and before that the run does not go on at all. A row that replaces nothing has no such key.
// A declined, unanswered, withheld or not_cut request (and a not_cut session read) has text, text_sha256, file_sha256, scans null; `answered_stage` is the stage whose answer carried the text or the decline (the text is shown in every prompt from the next stage on), for a request left unanswered the stage at whose pause it was left out, null only when no pause came after the request (C&C ruling 09 Nov 2026 replaced plan A's first_stage by it; the unanswered case is the default asked on 09 Nov, WORDING D18-w13).
//
// Two fields beyond plan A's table and STEP3, both flagged for the review: `answered_stage`, on every kind, in the place of the table's `first_stage` (C&C ruling 09 Nov 2026: the writer cannot know the label of the next prompt; the
// plan's heading for a session read says "for its answer to <stage>"), and `advisor_said` beside `advisor` (T4.2 records the advisor's words beside its `advisor` field).
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { held } from './held-roles.js';

export const EXCERPTS_FILE = 'excerpts.jsonl';
export const EXCERPT_SCHEMA = 'excerpts/1';
export const REQUEST_KINDS = ['seat_request', 'session_read', 'seat_read'];   // seat_read is reserved (T5.6): the same fields, a seat reading the project itself
export const SOURCE_KINDS = ['repository_file', 'task_file', 'context_document', 'handed_draft'];
export const SCAN_RESULTS = ['clear', 'hit', 'continued_by_person'];
/** `personal_data` alone may also be `not_scanned` (C&C ruling 09 Nov 2026): no personal-data scan runs during a run (his 08 Nov answer), so the entry says the check did not run instead of recording a pass. `key_shape` always ran, so it never takes this value. */
export const PERSONAL_DATA_RESULTS = [...SCAN_RESULTS, 'not_scanned'];
export const APPROVAL_STATUSES = ['not_required', 'approved', 'edited', 'refused', 'unanswered', 'withheld', 'not_cut'];
export const ADVISOR_VALUES = ['consulted', 'none', 'unavailable'];
/** The gate's channels (src/gate.js PERSON_CHANNELS and SESSION_CHANNEL). Copied here because the gate scanner (test/gate-answer.test.js, R2) lets only listed modules import src/gate.js; test/excerpt-schema.test.js pins this list to the gate's own, so it cannot drift into a second vocabulary. */
export const APPROVAL_CHANNELS = ['cli', 'elicitation', 'session'];
const TEXT_STATUSES = ['not_required', 'approved', 'edited'];   // these carry text; the other four (refused, unanswered, withheld, not_cut) are a request that was not answered with text
/** The ids of a run's recorded excerpts, split by whether they carry text: { shown: [id], noText: [id] }. Only an excerpt that carries text was shown to a seat (CHECKED = rests on text shown), so only `shown` supports a `[CHECKED: excerpt E-<n>]`. */
export function excerptIdSetsOf(entries) {
  const out = { shown: [], noText: [] };
  for (const e of Array.isArray(entries) ? entries : []) if (e && typeof e.id === 'string') (TEXT_STATUSES.includes(e.approval?.status) ? out.shown : out.noText).push(e.id);
  return out;
}
/** The rows of the run that count: every row no later row replaces (`supersedes`). Every reader that decides what a seat is shown, what a quote or a claim may rest on, or what is checked reads this, never the raw list. Rows that replace nothing are all live, so a run without one is unchanged. */
export function liveExcerpts(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const replaced = new Set(list.map(e => e?.supersedes).filter(id => typeof id === 'string'));
  return replaced.size ? list.filter(e => !replaced.has(e?.id)) : list;
}
const FIELDS = ['schema', 'id', 'request_kind', 'requested_by', 'objection_id', 'origin', 'why', 'source_kind', 'path', 'lines', 'text', 'text_sha256', 'file_sha256', 'edited', 'pasted_by', 'advisor', 'advisor_said', 'answered_stage', 'scans', 'approval'];

export const sha256Of = text => createHash('sha256').update(String(text), 'utf8').digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;
const str = v => typeof v === 'string' && v.trim() !== '';
const strOrNull = v => v === null || str(v);

/** Problems of an entry, as plain sentences; [] when it is valid. Does not throw. */
export function excerptProblems(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['the entry is not an object'];
  const p = [];
  const need = (ok, msg) => { if (!ok) p.push(msg); };
  need(e.schema === EXCERPT_SCHEMA, `schema must be ${EXCERPT_SCHEMA}`);
  need(typeof e.id === 'string' && /^E-[1-9]\d*$/.test(e.id), 'id must look like E-<n>');
  need(REQUEST_KINDS.includes(e.request_kind), `request_kind must be one of ${REQUEST_KINDS.join(', ')}`);
  if (e.request_kind === 'session_read') need(e.requested_by === null, 'a session_read has no requesting seat (requested_by must be null)');
  else need(str(e.requested_by), 'requested_by must be the requesting seat\'s key');
  need(strOrNull(e.objection_id), 'objection_id must be a string or null');
  if (e.request_kind === 'session_read') need(e.origin === null, 'a session_read has no origin reply (origin must be null)');
  else need(str(e.origin), 'origin must be the label of the reply that carried the request');
  need(str(e.why), 'why must be a non-empty sentence');
  need(SOURCE_KINDS.includes(e.source_kind), `source_kind must be one of ${SOURCE_KINDS.join(', ')}`);
  need(str(e.path), 'path must be a non-empty string');
  need(e.lines === null || (typeof e.lines === 'string' && /^\d+-\d+$/.test(e.lines) && Number(e.lines.split('-')[0]) <= Number(e.lines.split('-')[1])), 'lines must be "a-b" with a <= b, or null');
  need(strOrNull(e.pasted_by), 'pasted_by must be a string or null');
  need(e.advisor === null || ADVISOR_VALUES.includes(e.advisor), `advisor must be one of ${ADVISOR_VALUES.join(', ')} or null`);
  need(strOrNull(e.advisor_said), 'advisor_said must be a string or null');
  need(typeof e.edited === 'boolean', 'edited must be true or false');
  // A-DRAFT (pr2 fix, A1): a new refusal of a hand-edited record, in its own words.
  if (e.supersedes !== undefined) need(typeof e.supersedes === 'string' && /^E-[1-9]\d*$/.test(e.supersedes) && typeof e.id === 'string' && /^E-[1-9]\d*$/.test(e.id) && Number(e.supersedes.slice(2)) < Number(e.id.slice(2)), 'supersedes must be the id of an earlier row');
  const a = e.approval;
  if (!a || typeof a !== 'object') { p.push('approval must be an object'); return p; }
  need(APPROVAL_STATUSES.includes(a.status), `approval.status must be one of ${APPROVAL_STATUSES.join(', ')}`);
  need(typeof a.at === 'string' && !Number.isNaN(Date.parse(a.at)), 'approval.at must be a time');
  need(a.channel === null || APPROVAL_CHANNELS.includes(a.channel), `approval.channel must be one of the gate's channels (${APPROVAL_CHANNELS.join(', ')}) or null`);
  need(strOrNull(a.actor) && strOrNull(a.reason), 'approval.actor and approval.reason must be strings or null');
  if (a.status === 'not_required') need(a.actor === null && a.channel === null, 'not_required has no actor and no channel');
  if (['approved', 'edited', 'refused', 'withheld'].includes(a.status)) need(str(a.channel), `${a.status} needs the gate's channel (the actor is what the gate recorded: an operating-system user name, an MCP client name or main-session, and null when it recorded none)`);
  // A refusal's reason is the person's own words and OPTIONAL (plan A T5.5: "refuse (with an optional reason, shown to the requesting seat)"; C&C's fix, 04 Nov 2026): none given is recorded as null, never as an empty string
  // (strOrNull above refuses ""). A request the session left unanswered, and one withheld after a scan, always carry the harness's reason.
  if (['unanswered', 'withheld', 'not_cut'].includes(a.status)) need(str(a.reason), `${a.status} needs a reason`);
  if (a.status === 'unanswered') need(a.actor === null && a.channel === null, 'unanswered has no actor and no channel (nobody answered)');
  if (a.status === 'not_cut') need(a.actor === null && a.channel === null, 'not_cut has no actor and no channel (the harness could not cut the text; nobody answered)');
  if (a.status === 'edited') need(e.edited === true, 'an edited approval means edited is true');
  // C&C 09 Nov 2026 (WORDING U1-w6): the stage whose answer carried the text or the decline; only a request nobody answered has none.
  if (a.status === 'unanswered') need(strOrNull(e.answered_stage), 'an unanswered request names the stage at whose pause it was left out, or none (answered_stage must be a stage or null)');
  else need(str(e.answered_stage), 'answered_stage must name the stage whose answer carried the text or the decline');
  if (TEXT_STATUSES.includes(a.status)) {
    need(typeof e.text === 'string', 'a recorded excerpt carries its text (an empty or whitespace-only text is still a text)');
    need(typeof e.text === 'string' && e.text_sha256 === sha256Of(e.text), 'text_sha256 must be the sha256 of text');
    need(e.file_sha256 === null || HEX64.test(e.file_sha256 || ''), 'file_sha256 must be a sha256 or null');
    const s = e.scans;
    need(s && typeof s === 'object' && SCAN_RESULTS.includes(s.key_shape) && PERSONAL_DATA_RESULTS.includes(s.personal_data), `scans must be { key_shape, personal_data }: key_shape ${SCAN_RESULTS.join(', ')}; personal_data ${PERSONAL_DATA_RESULTS.join(', ')}`);
  } else {
    need(e.text === null && e.text_sha256 === null && e.file_sha256 === null && e.scans === null, `${a.status} carries no text: text, text_sha256, file_sha256 and scans are null`);
    need(e.edited === false, `${a.status} has nothing edited`);
  }
  return p;
}

/** The entry for input `i` as number `n`: every field of the table, in a fixed order; text_sha256 is computed from text. Throws, listing every problem. */
export function buildExcerptEntry(n, i) {
  const entry = {
    schema: EXCERPT_SCHEMA,
    id: `E-${n}`,
    request_kind: i.request_kind,
    requested_by: i.requested_by ?? null,
    objection_id: i.objection_id ?? null,
    origin: i.origin ?? null,   // not forced: a seat_request without one is refused by excerptProblems
    why: i.why,
    source_kind: i.source_kind,
    path: i.path,
    lines: i.lines ?? null,
    text: i.text ?? null,   // every field is passed through as given (a stray value on a request that carries no text is REFUSED by excerptProblems, never silently dropped)
    text_sha256: typeof i.text === 'string' ? sha256Of(i.text) : null,
    file_sha256: i.file_sha256 ?? null,
    edited: i.edited === true,
    pasted_by: i.pasted_by ?? null,
    advisor: i.advisor ?? null,
    advisor_said: i.advisor_said ?? null,
    answered_stage: i.answered_stage ?? null,   // not forced: a missing or stray value is refused by excerptProblems, never silently filled
    scans: i.scans ?? null,
    approval: { status: i.approval?.status, actor: i.approval?.actor ?? null, channel: i.approval?.channel ?? null, at: i.approval?.at, reason: i.approval?.reason ?? null },
    ...(i.supersedes === undefined || i.supersedes === null ? {} : { supersedes: i.supersedes }),   // only a row that replaces an earlier one carries the key, so every other row keeps the exact shape it always had
  };
  const problems = excerptProblems(entry);
  if (problems.length) throw new Error(`excerpt ${entry.id} is not valid: ${problems.join('; ')}`);
  return entry;
}

const pathOf = runDir => join(runDir, EXCERPTS_FILE);

/** What is on disk: { entries (valid, in order), lines (how many lines the file has), problems }. A missing file reads as none; a torn last line or a corrupt line is a problem, never a throw. */
export function readExcerpts(runDir) {
  const path = pathOf(runDir);
  if (!existsSync(path)) return { entries: [], lines: 0, problems: [] };
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (err) { return { entries: [], lines: 0, problems: [`${EXCERPTS_FILE} cannot be read: ${err.code || err.message}`] }; }
  const parts = raw.split('\n');
  const torn = parts[parts.length - 1] !== '';
  const lines = parts.filter(l => l.trim() !== '');
  const entries = []; const problems = [];
  lines.forEach((line, k) => {
    let e;
    try { e = JSON.parse(line); } catch { problems.push(`line ${k + 1}${torn && k === lines.length - 1 ? ' (the last line, torn)' : ''} is not JSON`); return; }
    const bad = excerptProblems(e);
    if (bad.length) { problems.push(`line ${k + 1}: ${bad.join('; ')}`); return; }
    if (e.id !== `E-${k + 1}`) { problems.push(`line ${k + 1}: id ${e.id} is out of order`); return; }
    // A-DRAFT (pr2 fix, A1): a new refusal of a hand-edited record, in its own words.
    if (e.supersedes !== undefined && !entries.some(x => x.id === e.supersedes && x.approval.status === 'not_required')) { problems.push(`line ${k + 1}: supersedes ${e.supersedes}, which is not an earlier row recorded as not_required`); return; }
    entries.push(e);
  });
  return { entries, lines: lines.length, problems };
}

/**
 * Append entries, numbered after the lines already there, with ONE write and an fsync (a torn earlier line is left behind a newline, never extended). Every entry is built and checked BEFORE anything is written, so one invalid entry
 * writes none of them (the key-shape pause relies on this: a stage's pending answers are scanned first and recorded together or not at all). Returns the entries, in order.
 */
export function appendExcerpts(runDir, inputs) {
  const path = pathOf(runDir);
  const had = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const count = had.split('\n').filter(l => l.trim() !== '').length;
  const entries = inputs.map((input, k) => buildExcerptEntry(count + k + 1, input));
  if (!entries.length) return entries;
  mkdirSync(runDir, { recursive: true });
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, `${had !== '' && !had.endsWith('\n') ? '\n' : ''}${entries.map(e => `${JSON.stringify(e)}\n`).join('')}`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  return entries;
}

/** Append one entry (see appendExcerpts). Returns the entry. */
export const appendExcerpt = (runDir, input) => appendExcerpts(runDir, [input])[0];

/** The report's additive entry: { count, file_sha256 } of the file as it is, or null when the run recorded no excerpt (the field is then absent). */
export function excerptsReportEntry(runDir) {
  const path = pathOf(runDir);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path);
  const { lines } = readExcerpts(runDir);
  return { count: lines, file_sha256: createHash('sha256').update(raw).digest('hex') };
}

/** The prompt block for the entries that carry text, from the recorded `text`; '' while its held words are not recorded in src/roles.js or when there is none. */
export function excerptBlockFor(entries) {
  const shown = (entries || []).filter(e => e && TEXT_STATUSES.includes(e.approval?.status) && typeof e.text === 'string');
  if (!shown.length) return '';
  const render = held('excerptsBlock');
  return typeof render === 'function' ? render({ entries: shown }) : '';
}

/**
 * 0.8.4 D30 (plan A T1.5): the paragraph added to the text written above each NEEDS file, for the session that answers an external seat and may have the project open (held name `externalStageParagraph`);
 * '' while it is not recorded in src/roles.js. Returned with the blank line that follows it, ready to sit before "## System prompt". Called by src/cli.js where the NEEDS-<stage>.md file is written (slot H2-f), in both its forms.
 */
export function externalStageBlock() {
  const text = held('externalStageParagraph')?.();
  return typeof text === 'string' && text ? `${text}\n\n` : '';
}

