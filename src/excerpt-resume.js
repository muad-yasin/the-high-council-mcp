// 0.8.4 D38 (plan A T1.4, T5; C&C 09 Nov 2026): what the command does at a resume with the reads a handling session named in its stage answers (`session_reads`, stored on `<stage>.usage.json` by
// src/stage-submission.js). For every stage whose reads are not yet in `excerpts.jsonl` (an entry whose `answered_stage` is that stage means they are): cut each read from the file (D8, src/excerpt-extract.js,
// the path check), scan the cut text for key shapes (D20, src/excerpt-scan.js), and append ALL of them in one write (src/excerpt-record.js appendExcerpts). A hit throws SecretShapedPrompt BEFORE anything is
// appended, so the pause records nothing, and the pause's label `excerpt-E-<n>` carries the id the line gets when the person goes on: n = the lines already in the file + the read's place among the reads that will be
// recorded. The person's choices at that pause: --continue (the value is allowed; the line is recorded as continued_by_person), --drop-excerpt (the label is in run.json `secretDrops`; ONE `withheld` line, no
// text), or nothing (still paused). A finish cannot arise for an excerpt pause: it is raised at the start of a resume (phase 'before'), where --finish is refused. A text the harness cannot cut is one line with status not_cut (a request or a session read), the reason in the refusal's words, and a note says why;
// the claim it supported stays unverified. This module reads and writes files; it never calls a model.
import { secretStopIdOf } from './outbound-scan.js';
import { readRunJson, listRunFiles } from './run-files.js';
import { EXCERPT_LABEL_PREFIX, excerptLabelOf, isExcerptLabel } from './secret-pause.js';
import { extractExcerpt, REFUSAL_WORDS } from './excerpt-extract.js';
import { scanExcerptKeyShape } from './excerpt-scan.js';
import { appendExcerpts, liveExcerpts, readExcerpts } from './excerpt-record.js';
import { sessionReadsProblems } from './excerpt-channel.js';
import { normLines, requestKey } from './text-requests.js';
import { isNotASeat } from './excerpt-slot.js';
import { sittingOf } from './stale-guard.js';
import { reservationLinesOf } from './spend-reservations.js';
import { buildCheckLabel } from './build-check.js';
import { handlerSortLabel } from './handler-sort.js';
import { retagPickLabel } from './retag-pick.js';

export { EXCERPT_LABEL_PREFIX, excerptLabelOf, isExcerptLabel };

export { REFUSAL_WORDS };   // the words live in src/excerpt-extract.js (a leaf), so src/stage-submission.js can use them
/** WORDING D38-w6. */
export const DROP_REASON = 'Dropped by the person at the key-shape pause: the text was left out and the run went on.';

/** WORDING D18-w6: the reason a request nobody answered carries (a pause that left it out; text the harness could not cut is a not_cut line, worded by REFUSAL_WORDS). */
export const UNANSWERED_REASON = 'The handling session did not answer this request.';

/**
 * What a resume still has to record, in a FIXED order (so a stop label is the id the line gets): stage by stage in stage-name order, the stage's session reads first, then its answers to the text requests the stage listed by request
 * number, and for a request the answers left out (or all of them when the stage was answered with no `excerpt_answers`) an unanswered line. "Already recorded" is per KIND: a stage's session reads are done when a session_read line
 * names the stage; a request is done when a seat_request line names the REPLY that carried it (its origin), whatever stage lists it again (one kind never hides the other). `.late.usage.json` is never read. -> { work: [{ stage, reads, answers, requests }], problems }
 */
export function pendingExcerptWork(runDir, recorded) {
  const doneReads = new Set(recorded.filter(e => e.request_kind === 'session_read').map(e => e.answered_stage));
  const doneOrigins = new Set(recorded.filter(e => e.request_kind === 'seat_request').map(e => e.origin));   // a reply whose requests are on file is done, whatever stage lists them again (a revise-N-full pause lists round N's requests again); one pause lists every request of a reply and the resume records every listed one
  const files = listRunFiles(runDir);
  const stages = [...new Set(files.flatMap(n => (n.endsWith('.late.usage.json') ? [] : n.endsWith('.usage.json') ? [n.slice(0, -'.usage.json'.length)] : n.endsWith('.prompt.json') ? [n.slice(0, -'.prompt.json'.length)] : [])))].sort();
  const answered = new Set(files.filter(n => n.endsWith('.md') && !n.endsWith('.late.md')).map(n => n.slice(0, -3)));   // a reply written as a FILE has no usage record: the stage is answered when <stage>.md exists
  const work = []; const problems = [];
  for (const stage of stages) {
    const usage = files.includes(`${stage}.usage.json`) ? (readRunJson(runDir, `${stage}.usage.json`) ?? {}) : {};
    let reads = []; let answers = []; let requests = [];
    if (usage.session_reads !== undefined && !doneReads.has(stage)) {
      const bad = sessionReadsProblems(usage.session_reads);
      if (bad.length) problems.push(`${stage}.usage.json: ${bad.join('; ')}`); else reads = usage.session_reads;
    }
    const listed = files.includes(`${stage}.prompt.json`) ? readRunJson(runDir, `${stage}.prompt.json`)?.text_requests : undefined;
    if (Array.isArray(listed) && listed.length && answered.has(stage)) {
      requests = listed.filter(r => r && Number.isInteger(r.n) && !doneOrigins.has(r.origin ?? null));
      answers = Array.isArray(usage.excerpt_answers) ? [...usage.excerpt_answers].sort((x, y) => x.request - y.request) : [];
    }
    if (reads.length || requests.length) work.push({ stage, reads, answers, requests });
  }
  return { work, problems };
}
/** How many lines the pending work would write (for the log line when nothing is recorded yet). */
export const pendingExcerptCount = (runDir, recorded) => pendingExcerptWork(runDir, recorded).work.reduce((n, w) => n + w.reads.length + w.requests.length, 0);
/** Kept for the reads-only callers: the stages with reads still to record. */
export function pendingSessionReads(runDir, recorded) {
  const { work, problems } = pendingExcerptWork(runDir, recorded);
  return { pending: work.filter(w => w.reads.length).map(w => ({ stage: w.stage, reads: w.reads })), problems };
}

// The calls of the handling session's own (its answers and the handler's waits) never carry the excerpt block (src/excerpt-slot.js: they are the session's own prompts), so a record of one says nothing about what a seat was shown. The names come from the
// label functions of the units that ask them, so a rename there cannot leave a name here behind.
const HANDLER_OWN = [/^answers$/, ...[handlerSortLabel, retagPickLabel, buildCheckLabel].map(label => new RegExp(`^${label('\\d+')}$`))];
const carriesNoBlock = label => isNotASeat(label) || HANDLER_OWN.some(r => r.test(label));

/**
 * A1 (0.8.4 pr2 fix): which of `rows` (rows recorded `not_required`, i.e. while the privacy switch was off) a seat may ALREADY have been shown, from the run folder alone. Nothing in the record says so directly (no `shown` field: what a seat is shown is
 * decided in memory when the stages run), so the evidence is what a call leaves behind, in two kinds:
 *   - a stage record written in the sitting that recorded the row or a later one (`writtenBy.sitting` on `<label>.usage.json`, or on the `<label>.prompt.json` an external stage's pause leaves, answered or not: its NEEDS file carries the block, and the answer
 *     arriving later must not change the verdict), for a stage that is not the stage whose answer carried the row and is not one of the session's own calls: the row is recorded at the START of a sitting, before any stage of it runs, and every stage written from then on comes after the answer that carried it, so its prompt carried the row;
 *   - a spend reservation (written and fsynced BEFORE a paid call is sent) made at or after the row was recorded, for a stage of the same kind: a call that went out and left no stage record.
 * The sitting that recorded a row is the last sitting of run.json (`sittings[].at`) stamped at or before the row's own time. A record with no stamp, a row whose sitting cannot be found, or a stage that was never run proves nothing: the row is then NOT in the
 * set, so the switch holds it for the person. WHAT THIS CANNOT TELL (declared): a stage of an EARLIER position that was re-run live in the recording sitting (a stale stage set aside and asked again) counts as having shown the row.
 * The hold is per ROW, not per seat: once any seat has been sent a row it stays live for every later call, including a seat that has not seen it yet (a panel cut off after its first judge). -> Set of row ids.
 */
export function rowsMayBeShown(runDir, rows) {
  const out = new Set();
  if (!rows.length) return out;
  const files = listRunFiles(runDir);
  const sittings = readRunJson(runDir, 'run.json')?.sittings;
  const starts = Array.isArray(sittings) ? sittings.map(x => Date.parse(x?.at)) : [];
  const stamped = [];   // { label, sitting }: the stages that have run, and in which sitting
  const labels = new Set(files.flatMap(n => (n.endsWith('.late.usage.json') ? [] : n.endsWith('.usage.json') ? [n.slice(0, -'.usage.json'.length)] : n.endsWith('.prompt.json') ? [n.slice(0, -'.prompt.json'.length)] : [])));
  for (const label of labels) {
    if (carriesNoBlock(label)) continue;
    const usage = files.includes(`${label}.usage.json`) ? readRunJson(runDir, `${label}.usage.json`) : null;
    const asked = files.includes(`${label}.prompt.json`) ? readRunJson(runDir, `${label}.prompt.json`) : null;   // an external stage's prompt is on disk from the pause, answered or not: the evidence must not change when the session answers
    const sitting = sittingOf(usage?.writtenBy) ?? sittingOf(asked?.writtenBy);   // the one reader of a stage record's stamp (src/stale-guard.js); a usage record with no stamp (what submit_stage writes) does not hide the prompt record's
    if (sitting !== null) stamped.push({ label, sitting });
  }
  const reserved = reservationLinesOf(runDir).filter(l => l && l.event === 'reserved' && typeof l.label === 'string' && !carriesNoBlock(l.label)).map(l => ({ label: l.label, at: Date.parse(l.at) }));
  for (const e of rows) {
    const at = Date.parse(e.approval?.at);
    let sitting = 0; starts.forEach((t, i) => { if (t <= at) sitting = i + 1; });   // sittings are appended in order, so the last one stamped at or before the row is the one that recorded it
    const byStage = sitting > 0 && stamped.some(r => r.label !== e.answered_stage && r.sitting >= sitting);
    const byReservation = reserved.some(r => r.label !== e.answered_stage && r.at >= at);
    if (byStage || byReservation) out.add(e.id);
  }
  return out;
}

/**
 * The batch a resume has to record: `inputs` in the fixed order (see pendingExcerptWork), each ready for appendExcerpts, and the log `notes`. `root` is the project folder the run started in; `drops` the person's drops (run.json
 * secretDrops entries { label, stop }: honoured only when its label AND its stop id, the hash of the exact scanned text at the pause, both match now, so a read that moved to another place cannot be dropped in the place of the
 * one the person saw); `scanOptions` the run's outbound-scan options ({ allow, allowed }); `actor` the name the record keeps for a drop. Throws SecretShapedPrompt on a hit (nothing appended) and an `excerptRefusal` Error
 * when the file cannot be read. With `hold` (the privacy switch is on) a row that carries text comes back with `approval: null`: it waits for the person's answer (src/excerpt-pause.js) and is not recorded here.
 * A1 (0.8.4 pr2 fix), with `hold` only: a row recorded `not_required` BEFORE the switch was turned on, which no seat can have been shown yet (`rowsMayBeShown`), is asked about like a new text: the batch begins with a copy of it, built from the RECORDED text
 * (never a new cut), that names it in `supersedes`; the older row stays on disk and is no longer live (`liveExcerpts`). A row a seat may already have been shown is left as it is, so every stage that saw it replays unchanged. The copies come first, so
 * the ids the batch's places give (firstId + place) and the `excerpt-E-<n>` labels of the reads after them stay what they will be in the file.
 */
export function excerptBatch({ runDir, root, drops = [], scanOptions = {}, actor = null, hold = false, maxShownLines = Infinity, maxLineNumber = Infinity, now = () => new Date().toISOString() }) {
  const { entries, lines, problems } = readExcerpts(runDir);
  if (problems.length) throw Object.assign(new Error(`excerpts.jsonl cannot be read (${problems[0]}), so the session reads cannot be recorded. Nothing was run and nothing was spent.`), { excerptRefusal: true });   // WORDING D38-w5 (e)
  const { work } = pendingExcerptWork(runDir, entries);
  const inputs = []; const notes = [];
  const at = now();
  const nextLabel = () => excerptLabelOf(lines + inputs.length + 1);
  const textRow = (base, got, label) => {
    const drop = drops.find(d => d && d.label === label && d.stop === secretStopIdOf(label, '', got.text));
    if (drop) return { ...base, text: null, file_sha256: null, scans: null, edited: false, approval: { status: 'withheld', actor, channel: drop.relayed === true ? 'session' : 'cli', at, reason: DROP_REASON } };   // 0.8.4 (Q9): a drop the handling session relayed in the person's words says channel session, never cli
    const key_shape = scanExcerptKeyShape(label, got.text, scanOptions);   // throws on a hit nobody allowed: nothing has been appended
    return { ...base, text: got.text, file_sha256: got.file_sha256, edited: false, scans: { key_shape, personal_data: 'not_scanned' }, approval: hold ? null : { status: 'not_required', actor: null, channel: null, at, reason: null } };
  };
  const noText = { text: null, file_sha256: null, scans: null, edited: false };
  // the approval gate cannot bind a text longer than maxShownLines, or one whose lines run past line maxLineNumber (hold only)
  const tooBig = got => hold && (got.text.split('\n').length > maxShownLines || String(got.lines ?? '').split('-').some(n => Number(n) > maxLineNumber));
  // why a cut text cannot be recorded: the extraction refused it, or the approval gate cannot bind it (too_long, D10-w5). A text of only whitespace IS recorded (C&C 09 Nov 2026).
  const unfit = got => (!got.ok ? got.reason : tooBig(got) ? 'too_long' : null);
  // A text the harness could not cut is a line of its own (status not_cut, C&C 09 Nov 2026), for a request and for a session read alike: the record shows the read was tried. Words: D10-w9.
  const notCut = (reason) => ({ ...noText, approval: { status: 'not_cut', actor: null, channel: null, at, reason: `The text could not be cut: ${REFUSAL_WORDS[reason] ?? reason}.` } });
  if (hold) {
    const earlier = liveExcerpts(entries).filter(e => e.approval.status === 'not_required');
    const shown = rowsMayBeShown(runDir, earlier);
    for (const e of earlier) {
      if (shown.has(e.id)) continue;
      const base = { request_kind: e.request_kind, requested_by: e.requested_by, objection_id: e.objection_id, origin: e.origin, why: e.why, source_kind: e.source_kind, path: e.path, lines: e.lines, pasted_by: e.pasted_by, advisor: e.advisor, advisor_said: e.advisor_said, answered_stage: e.answered_stage, supersedes: e.id };
      if (tooBig({ text: e.text, lines: e.lines })) {   // the approval gate cannot bind it: the same row a new text of that size gets, and for a session read the same note (WORDING D10-w9)
        if (e.request_kind === 'session_read') notes.push(`  session read ${e.path} (answer to ${e.answered_stage}) could not be cut: ${REFUSAL_WORDS.too_long}; it is recorded as not cut.`);
        inputs.push({ ...base, pasted_by: null, ...notCut('too_long') });
      } else inputs.push({ ...base, text: e.text, file_sha256: e.file_sha256, edited: false, scans: e.scans, approval: null });
    }
  }
  for (const { stage, reads, answers, requests } of work) {
    for (const r of reads) {
      const got = extractExcerpt(root, r.path, r.lines ?? null);
      const why = unfit(got);
      if (why) {
        notes.push(`  session read ${r.path} (answer to ${stage}) could not be cut: ${REFUSAL_WORDS[why] ?? why}; it is recorded as not cut.`);   // WORDING D10-w9
        inputs.push({ request_kind: 'session_read', requested_by: null, objection_id: null, origin: null, why: r.why, source_kind: 'repository_file', path: r.path, lines: normLines(r.lines), pasted_by: null, advisor: null, advisor_said: null, answered_stage: stage, ...notCut(why) });
        continue;
      }
      inputs.push(textRow({ request_kind: 'session_read', requested_by: null, objection_id: null, origin: null, why: r.why, source_kind: 'repository_file', path: got.path, lines: got.lines, pasted_by: null, advisor: null, advisor_said: null, answered_stage: stage }, got, nextLabel()));
    }
    const answerOf = new Map(answers.map(a => [a.request, a]));
    for (const q of [...requests].sort((x, y) => x.n - y.n)) {
      const base = { request_kind: 'seat_request', requested_by: q.requested_by, objection_id: q.objection_id ?? null, origin: q.origin ?? null, why: q.why, source_kind: 'repository_file', path: q.path, lines: normLines(q.lines), pasted_by: 'main-session', advisor: null, advisor_said: null, answered_stage: stage };
      const a = answerOf.get(q.n);   // an unanswered line names the stage at whose pause it was left out (C&C's rule said null; asked, WORDING D18-w13)
      if (!a) { inputs.push({ ...base, pasted_by: null, ...noText, approval: { status: 'unanswered', actor: null, channel: null, at, reason: UNANSWERED_REASON } }); continue; }
      if (a.decline !== undefined && a.decline !== null) { inputs.push({ ...base, ...noText, approval: { status: 'refused', actor: 'main-session', channel: 'session', at, reason: a.decline } }); continue; }
      const got = extractExcerpt(root, a.path ?? q.path, a.lines ?? q.lines ?? null);
      const why = unfit(got);
      if (why) { inputs.push({ ...base, pasted_by: null, ...notCut(why) }); continue; }   // WORDING D18-w6, D10-w9
      inputs.push(textRow({ ...base, path: got.path, lines: got.lines }, got, nextLabel()));
    }
  }
  return { inputs, notes, firstId: lines + 1 };
}

/** Record the pending reads and answers (the privacy switch is off). -> { written: entries, notes: [log lines] }. Throws as excerptBatch does. */
export function recordSessionReads(opts) {
  const { inputs, notes } = excerptBatch({ ...opts, hold: false });
  const written = appendExcerpts(opts.runDir, inputs);
  if (written.length) notes.push(`  session reads: ${written.length} recorded as excerpts (${written[0].id} to ${written[written.length - 1].id}).`);   // WORDING D38-w5 (b); counts the lines of the seats' requests too (wording-review list)
  return { written, notes };
}

/** WORDING D18-w6, the second sentence: the reason of a request no pause came after. */
export const NO_PAUSE_REASON = 'No handling session pause came after this request.';
/**
 * The requests no later pause answered (src/chain.js textRequestsLeft, on the result): one `unanswered` line each with answered_stage null, written once. A request that already has a line (the same seat, reply,
 * path, lines, why and objection, WHATEVER its status) is not written again, so finishing a run a second time adds nothing; two identical requests of different replies are two lines. -> the lines written.
 */
export function recordUnaskedRequests({ runDir, left, now = () => new Date().toISOString() }) {
  const { entries, problems } = readExcerpts(runDir);
  if (problems.length || !Array.isArray(left) || !left.length) return [];
  const have = new Set(entries.filter(e => e.request_kind === 'seat_request').map(requestKey));
  const at = now();
  const inputs = [];
  for (const q of left) {
    if (have.has(requestKey(q))) continue;
    have.add(requestKey(q));
    inputs.push({ request_kind: 'seat_request', requested_by: q.requested_by, objection_id: q.objection_id ?? null, origin: q.origin ?? null, why: q.why, source_kind: 'repository_file', path: q.path, lines: normLines(q.lines), pasted_by: null, advisor: null, advisor_said: null, answered_stage: null, text: null, file_sha256: null, scans: null, edited: false, approval: { status: 'unanswered', actor: null, channel: null, at, reason: NO_PAUSE_REASON } });
  }
  return appendExcerpts(runDir, inputs);
}
