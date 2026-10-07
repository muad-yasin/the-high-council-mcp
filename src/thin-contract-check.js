// `council contract check <run>` (0.8.2 item 6a): recompute what a run folder still holds and compare it with the thin contract in report.json (src/thin-contract.js). Pure: the caller reads the
// files and hands the texts in; `undefined` means "could not be read", which is reported as such and NEVER counted as a pass.
// Each item is { status: 'ok' | 'drift' | 'unchecked' | 'na', what, detail, outside }. `outside` marks a comparison against something OUTSIDE report.json (the task file, the context documents,
// deliverable.md, HANDOFF.md, a HANDOFF copy): only those can show that report.json itself was left alone, so a run with none that held is "nothing could be checked" (exit 2), not sealed.
// Exit: 1 if anything drifted, 2 if no outside comparison held (or there is no record), else 0.
import { recordHash, groundTruthSha256, sha256Of } from './thin-contract.js';
import { criteriaHash, checksHash, checksOf } from './criteria-lock.js';
import { RECORD_LINE_RE } from './handoff-contract-text.js';

const short = h => String(h || '').slice(0, 12);

export function checkThinContract({ report, deliverableText, handoffText, taskText, contextBundle, hasContext, handoffCopyText }) {
  const t = report?.thin_contract;
  if (!t || typeof t !== 'object') return { items: [], exit: 2, note: 'this report.json has no thin_contract (a run from before 0.8.2, an advice run, or a run that had nothing to seal): there is nothing to check' };
  const items = [];
  const add = (status, what, detail, outside = false) => items.push({ status, what, detail, outside });
  const same = (what, a, b, okText, driftText, outside = false) => (a === b ? add('ok', what, okText, outside) : add('drift', what, driftText, outside));

  // 1. The record against its own hash.
  same('record', recordHash(t), t.sha256, `the record's own hash holds (${short(t.sha256)})`, `the record's own hash does not match its fields: a field was edited (record says ${short(t.sha256)}, fields give ${short(recordHash(t))})`);

  // 2. The criteria and the way each is checked, recomputed from report.json's own lists (criteria_kinds holds the checks), against the record.
  if (Array.isArray(report.criteria)) {
    same('criteria', criteriaHash(report.criteria), t.criteria_sha256, `${report.criteria.length} criteria match the record (${short(t.criteria_sha256)})`, `the criteria in report.json are not the criteria the record sealed (${short(criteriaHash(report.criteria))} vs ${short(t.criteria_sha256)})`);
    const now = checksHash(checksOf(report.criteria, report.criteria_kinds));
    same('checks', now, t.checks_sha256, `how each criterion is checked matches the record (${short(t.checks_sha256)})`, `how a criterion is checked was changed in report.json (criteria_kinds gives ${short(now)}, the record sealed ${short(t.checks_sha256)})`);
  } else add('unchecked', 'criteria', 'report.json has no criteria list');
  if (report.criteria_sha256 !== undefined) same('criteria fingerprint', report.criteria_sha256, t.criteria_sha256, 'report.json criteria_sha256 equals the record', 'report.json criteria_sha256 differs from the record');
  if (report.checks_sha256 !== undefined) same('checks fingerprint', report.checks_sha256, t.checks_sha256, 'report.json checks_sha256 equals the record', 'report.json checks_sha256 differs from the record');

  // 3. The task.
  if (report.task_sha256 !== undefined) same('task fingerprint', report.task_sha256, t.task_sha256, 'report.json task_sha256 equals the record', 'report.json task_sha256 differs from the record');
  if (typeof taskText === 'string') same('task', sha256Of(taskText), t.task_sha256, `the task file still has the text the run was given (${short(t.task_sha256)})`, `the task file is not the text the run was given (${short(sha256Of(taskText))} vs ${short(t.task_sha256)})`, true);
  else add('unchecked', 'task', 'the task file is not readable from here (moved, deleted, or outside the working folder)');

  // 4. The evidence the run recorded as shown to the seats: tool results as stored in report.json, and the context documents when they can be read again.
  if (Array.isArray(report.ground_truth) || t.evidence?.ground_truth_sha256 !== null) {
    same('ground truth', groundTruthSha256(report.ground_truth), t.evidence?.ground_truth_sha256 ?? null, 'the tool results stored in report.json are the ones the record sealed', 'the tool results in report.json are not the ones the record sealed');
  } else add('ok', 'ground truth', 'report.json records no tool results, and the record claims none');
  if (t.evidence?.context_sha256 === null || t.evidence?.context_sha256 === undefined) {
    add(hasContext ? 'drift' : 'ok', 'context', hasContext ? 'the run was started with --context documents but the record seals none' : 'no --context documents, and none are claimed');
  } else if (typeof contextBundle === 'string') same('context', sha256Of(contextBundle), t.evidence.context_sha256, 'the --context documents still read as they did', 'the --context documents are not the text the run was given', true);
  else add('unchecked', 'context', 'the --context documents are not readable from here');

  // 5. The signed text and what was delivered after it (item 4's hashes).
  const s = report.signed_text; const d = report.delivered_text; const hnd = report.handoff_text;
  if (s?.sha256 !== undefined) same('signed text', s.sha256, t.signed_text_sha256, 'report.json signed_text.sha256 equals the record', 'report.json signed_text.sha256 differs from the record');
  else add('unchecked', 'signed text', 'report.json has no signed_text');
  if (d?.sha256 !== undefined) {
    if (typeof deliverableText === 'string') same('delivered text', sha256Of(deliverableText), d.sha256, `deliverable.md is the file the run wrote (${short(d.sha256)})`, `deliverable.md was changed after the run wrote it (${short(sha256Of(deliverableText))} vs ${short(d.sha256)})`, true);
    else add('unchecked', 'delivered text', 'deliverable.md is not readable');
    if (d.same_as_signed === true && !(d.harness_notes || []).length && typeof deliverableText === 'string') same('signed text is the delivered text', sha256Of(deliverableText), t.signed_text_sha256, 'the delivered file is the text the panel signed', 'the delivered file is not the text the panel signed', true);
    else if (d.same_as_signed === true) add('unchecked', 'signed text is the delivered text', 'the harness wrote a note above the model text (see delivered_text.harness_notes), so the file is not byte-for-byte the signed text and cannot be compared with it');
    else if (d.same_as_signed === false) add('unchecked', 'signed draft', 'a later stage changed the text (see delivered_text.changed_by): the signed draft is not a file in the run folder, so it cannot be recomputed');
  } else add('unchecked', 'delivered text', 'report.json has no delivered_text');
  if (hnd?.file_sha256 !== undefined) {
    if (typeof handoffText === 'string') same('HANDOFF.md', sha256Of(handoffText), hnd.file_sha256, `HANDOFF.md is the file the run wrote (${short(hnd.file_sha256)})`, `HANDOFF.md was changed after the run wrote it (${short(sha256Of(handoffText))} vs ${short(hnd.file_sha256)})`, true);
    else add('unchecked', 'HANDOFF.md', 'HANDOFF.md is not readable');
  } else add('na', 'HANDOFF.md', 'this report records no HANDOFF.md written by the run');

  // 6. A copy of HANDOFF.md the builder holds (`--handoff <file>`): the record hash it prints, plain text, against the run's, and the run it names. The LAST matching line is read (the harness writes its
  // line late; a seat quoting a line like it earlier must not win). This is the comparison that matters most, because the builder's copy is the one the run's own files cannot be edited to match.
  if (handoffCopyText !== undefined) {
    const lines = [...String(handoffCopyText).matchAll(/Thin contract: record sha256 ([0-9a-f]{64})(?:, run ([^\s]+?))?\./g)];
    const m = lines[lines.length - 1];
    if (!m) add('unchecked', 'HANDOFF copy', 'the copy carries no thin-contract line (a handoff from before 0.8.2, or the line was removed)');
    else if (m[2] && report.runId && m[2] !== report.runId) add('drift', 'HANDOFF copy', `the copy is another run's plan (it names run ${m[2]}, this is ${report.runId})`, true);
    else same('HANDOFF copy', m[1], t.sha256, `the copy names this run's record (${short(t.sha256)}${m[2] ? `, run ${m[2]}` : ''})`, `the copy names another record (${short(m[1])}) than this run's (${short(t.sha256)}): it is not this run's plan, or the run's report.json was changed`, true);
  }

  const drift = items.filter(i => i.status === 'drift').length;
  const heldOutside = items.filter(i => i.status === 'ok' && i.outside).length;
  return { items, exit: drift ? 1 : heldOutside ? 0 : 2 };
}

/** The lines the command prints. */
export function renderCheck({ items, exit, note }) {
  if (note) return { out: [], err: [note] };
  const lines = items.map(i => `${{ ok: 'ok', drift: 'DRIFT', unchecked: 'cannot check', na: 'not applicable' }[i.status]}: ${i.what}: ${i.detail}`);
  const drift = items.filter(i => i.status === 'drift').length;
  const ok = items.filter(i => i.status === 'ok').length;
  const outside = items.filter(i => i.status === 'ok' && i.outside).length;
  const un = items.filter(i => i.status === 'unchecked').length;
  const tail = drift ? `DRIFT in ${drift} of ${items.length} checks (${ok} held, ${un} could not be checked).`
    : exit === 2 ? `nothing outside report.json could be checked (${ok} checks inside it held, ${un} could not be checked): its own consistency held, but that does not show it was left alone.`
    : `sealed: ${ok} checks held (${outside} against files outside report.json), ${un} could not be checked. A tamper-evident record, not a tamper-proof one: whoever can edit report.json can edit the record too, so compare against the copy the builder holds.`;
  return { out: [...lines, tail], err: [] };
}
