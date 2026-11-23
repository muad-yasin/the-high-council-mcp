// 0.8.4 D10 (plan A T5.5), the pause unit: what a resume does with the excerpts waiting when the privacy switch is ON. The batch (src/excerpt-resume.js excerptBatch with hold) comes back with the rows that carry text
// still without an `approval`; this module binds them to ONE excerpt_approval gate with the screen a person reads, and on the resume after the person's answers applies each answer (approve, edit, refuse; declining the
// gate refuses all) and returns the rows to record. It reads and writes no gate file itself: the gate calls come in as `gate` (src/cli.js passes them; the gate scanner of test/gate-answer.test.js lets only listed
// modules import src/gate.js). Pure otherwise: no clock but the one it is given, no model call.
//   gate.latest()                 -> the newest excerpt_approval gate with no excerpts_recorded line: { id, status, excerpts, answer } | null   (answer: the gate's answer line: { channel, actor, ts, reason, excerpt_answers })
//   gate.request({ screen, excerpts }) -> { ok: true, id } | { ok: false, code, message }   (writes the screen file and asks)
//   gate.recorded(id, count)      -> { ok: true } | { ok: false, code, message }
import { approvalScreen, applyApproval, shownLinesOf } from './excerpt-approval.js';
import { appendExcerpts, sha256Of } from './excerpt-record.js';
import { excerptLabelOf } from './secret-pause.js';
import { scanExcerptKeyShape } from './excerpt-scan.js';

/** A-DRAFT (WORDING D10-w1): the names the screen shows. A seat is named by its role and its key, found from the REPLY that carried its request (a proposer and a judge may share a key); a stage by what the person knows it as. */
export const seatNameOf = (origin, key) => `${/^debate-/.test(origin ?? '') ? 'the proposer' : 'the judge'} ${key}`;
export function stageNameOf(stage) {
  if (stage === 'build') return 'the build';
  const m = /^revise-(\d+)(?:-|$)/.exec(String(stage));
  return m ? `the revision of round ${m[1]}` : 'the step it was writing';
}

/** The ids and the list a gate binds for the rows of `batch` that wait: ids by their place in the batch (the place they take in excerpts.jsonl), so a refused or no-text row before them keeps its number. */
export function boundOf(batch, firstId) {
  return batch.flatMap((x, k) => (x.approval === null ? [{ id: `E-${firstId + k}`, lines: x.lines ?? null, text_sha256: sha256Of(x.text), shown_lines: shownLinesOf(x.text) }] : []));
}
// by the four fields, never by the order of keys a stored copy comes back in
const sameBound = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, k) => x && b[k] && ['id', 'lines', 'text_sha256', 'shown_lines'].every(f => (x[f] ?? null) === (b[k][f] ?? null)));

/**
 * -> { action: 'record', rows, gates: [{ id, count }] }  the rows to append now (all of the batch, in order, none waiting), and the gates whose answers were applied (each one's excerpts_recorded line follows the append)
 *  | { action: 'asked', gateIds }                         the gates that wait for the person now (asked in this call or before); nothing is recorded
 * A pause with more texts than one gate holds (`gate.max`) gets SEVERAL gates, each with its own id, screen and hash; their answers bind together: nothing is applied until every one is answered. Throws when a gate cannot
 * be asked (the run must not go on without the approval it needs).
 */
export function pauseAtApproval({ batch, firstId, gate, scanOptions = {} }) {
  const held = batch.flatMap((x, k) => (x.approval === null ? [{ x, id: `E-${firstId + k}`, k }] : []));
  if (!held.length) return { action: 'record', rows: batch, gates: [] };
  const bound = boundOf(batch, firstId);
  const chunks = []; for (let i = 0; i < bound.length; i += gate.max) chunks.push(bound.slice(i, i + gate.max));
  const waiting = gate.waiting();
  const mine = chunks.map(c => waiting.filter(g => sameBound(g.excerpts, c)).at(-1) ?? null);   // the newest gate that asks about exactly these excerpts
  const asked = [];
  for (const [i, c] of chunks.entries()) {
    const g = mine[i];
    if (g && g.status === 'pending') { asked.push(g.id); continue; }
    if (g && (g.status === 'approved' || g.status === 'declined')) continue;
    // none, an expired one, or one answered for excerpts that are no longer these (the file changed): ask again, for exactly these
    const ids = new Set(c.map(e => e.id));
    const rows = held.filter(h => ids.has(h.id)).map(h => h.x);
    const pending = rows.map(x => ({ ...x, requested_by: x.request_kind === 'session_read' ? null : (x.origin ?? x.requested_by) }));
    const names = { seats: {}, stages: {} };
    for (const x of rows) { if (x.request_kind === 'seat_request') names.seats[x.origin ?? x.requested_by] = seatNameOf(x.origin, x.requested_by); else names.stages[x.answered_stage] = stageNameOf(x.answered_stage); }
    const made = gate.request({ screen: approvalScreen({ pending, nextId: Number(c[0].id.slice(2)), labels: names }), excerpts: c });
    if (!made.ok) throw Object.assign(new Error(`the approval of the excerpts could not be asked (${made.code}): ${made.message}`), { excerptRefusal: true });
    asked.push(made.id);
  }
  if (asked.length) return { action: 'asked', gateIds: asked };
  const chunkOf = new Map(chunks.flatMap((c, i) => c.map(e => [e.id, i])));
  const rows = batch.map((x, k) => {
    if (x.approval !== null) return x;
    const id = `E-${firstId + k}`;
    const g = mine[chunkOf.get(id)];
    const a = g.answer || {};
    const facts = { channel: a.channel, actor: a.actor ?? null, at: a.ts };
    const answer = g.status === 'declined' ? { id, decision: 'refuse', reason: typeof a.reason === 'string' && a.reason.trim() ? a.reason : undefined } : (Array.isArray(a.excerpt_answers) ? a.excerpt_answers : []).find(y => y.id === id);
    if (!answer) throw Object.assign(new Error(`the answers of gate ${g.id} have none for excerpt ${id}, so nothing was recorded. Nothing was run and nothing was spent.`), { excerptRefusal: true });
    const scan = text => ({ key_shape: scanExcerptKeyShape(excerptLabelOf(firstId + k), text, scanOptions), personal_data: 'not_scanned' });
    return applyApproval(x, answer, facts, { scan, bound: bound.find(b => b.id === id) });
  });
  return { action: 'record', rows, gates: mine.map((g, i) => ({ id: g.id, count: chunks[i].length })) };
}

/** Append the rows and say so in the gate ledger, gate by gate. The rows go first: a crash between the two leaves rows without a use line (completeUsedGates below writes the line at the next resume), never a use line without rows. -> the entries written. */
export function recordApproved({ runDir, rows, gates, gateApi }) {
  const written = appendExcerpts(runDir, rows);
  for (const g of gates) {
    const done = gateApi.recorded(g.id, g.count);
    if (!done.ok) throw Object.assign(new Error(`the answers to gate ${g.id} were applied but could not be marked used (${done.code}): ${done.message}`), { excerptRefusal: true });
  }
  return written;
}

// where an edit's file lines land: the same arithmetic as applyApproval (the first file line of the shown text moves with the kept range)
function editedLinesOf(b, answer) {
  const first = b.lines ? Number(b.lines.split('-')[0]) : 1;
  const [lo, hi] = answer.lines ? answer.lines.split('-').map(Number) : [1, b.shown_lines];
  return answer.lines || b.lines ? `${first + lo - 1}-${first + hi - 1}` : null;
}
/**
 * A gate that was asked AGAIN (the file changed or the gate expired, so a newer gate binds some of the same ids; ids are batch positions) is not the one the rows came from: the newer gate is judged, this one is left as it is.
 * `every` = every excerpt gate in the order of the ledger, oldest first: [{ id, excerpts }]. Pure. The ONE copy of the rule: completeUsedGates (here) and run_status (src/run-status.js) both ask it.
 */
export function rebindsLater(gateId, bound, every) {
  const at = (every || []).findIndex(x => x.id === gateId);
  const ids = new Set((bound || []).map(b => b.id));
  return at >= 0 && every.slice(at + 1).some(x => Array.isArray(x.excerpts) && x.excerpts.some(e => ids.has(e.id)));
}
/**
 * The crash between recordApproved's append and its use line: the rows of an answered gate are in excerpts.jsonl and the gate has no `excerpts_recorded` line. At the next resume the pause finds nothing to record (every
 * stage already has its rows), so this writes the missing line, through the existing gate.recorded and with count = the gate's bound count. `entries` are the rows on disk. A gate is judged by its bound list ({ id, lines,
 * text_sha256, shown_lines }) against the rows at those ids, and by the answer it carries:
 *   a newer gate binds some of the same ids -> this one was asked again (the file changed); it is left as it is
 *   no row at any of its ids          -> not this case: the pause applies the answer (pauseAtApproval)
 *   every row present and matching    -> the use line is written (a gate already marked used is not waiting, so a second resume writes nothing)
 *   only some present, or any differs -> the record is damaged: a refusal naming the gate (excerptRefusal); the line is neither written nor skipped
 * A row keeps only part of the bound: an approved row all four fields (its text is the shown text), a refused row its lines (it has no text), an edited row its lines as the edit moved them (computed here the way applyApproval does); the text hash of an edited or refused row and the shown_lines of both are not in the row.
 * So every row is also matched to the ANSWER that made it: the status that answer means (approve -> approved, edit -> edited, refuse or a declined gate -> refused) and the answer's own channel, actor and time.
 * DECLARED GAPS (C&C 09 Nov 2026): (1) an edited row's text is matched by its lines, not by a hash: the edit answer carries lines only, the edited text is a slice of the bound text, and no row keeps the bound text, so no
 * hash can be compared (a new record field was not built). (2) A gate that was asked again (a newer gate binds some of its ids) is skipped HERE only; it stays answered and unused on the ledger for good. Which gates stop a
 * resume (excerptApprovalStops) is not changed by this function. No new ledger event.
 * -> [{ id, count }] the gates completed.
 */
export function completeUsedGates({ entries, gate }) {
  const byId = new Map((entries || []).map(e => [e.id, e]));
  const done = [];
  for (const g of gate.waiting()) {
    if (g.status !== 'approved' && g.status !== 'declined') continue;
    const bound = Array.isArray(g.excerpts) ? g.excerpts : [];
    if (!bound.length) continue;
    if (typeof gate.all !== 'function') throw new Error('completeUsedGates: the gate calls must include all() (every excerpt gate, oldest first)');   // programming error: without it a gate asked again would refuse every resume
    if (rebindsLater(g.id, bound, gate.all())) continue;
    const a = g.answer || {};
    const actor = typeof a.actor === 'string' && a.actor.trim() !== '' ? a.actor : null;
    const judged = bound.map(b => {
      const e = byId.get(b.id) ?? null;
      const answer = g.status === 'declined' ? { decision: 'refuse' } : (Array.isArray(a.excerpt_answers) ? a.excerpt_answers : []).find(y => y && y.id === b.id);
      const want = answer ? { approve: 'approved', edit: 'edited', refuse: 'refused' }[answer.decision] : undefined;
      const r = e?.approval || {};
      let ok = Boolean(e && want && r.status === want && r.channel === a.channel && r.at === a.ts && (r.actor ?? null) === actor);
      if (ok) ok = (e.lines ?? null) === (want === 'edited' ? editedLinesOf(b, answer) : (b.lines ?? null));
      if (ok && want === 'approved') ok = e.text_sha256 === b.text_sha256 && shownLinesOf(e.text) === b.shown_lines;
      return { id: b.id, present: e !== null, ok };
    });
    if (!judged.some(j => j.present)) continue;
    const bad = judged.filter(j => !j.ok).map(j => j.id);
    if (bad.length) throw Object.assign(new Error(`The record of this run is damaged: gate ${g.id} was answered, but excerpts.jsonl holds only some of its excerpts, or holds them with other contents (${bad.join(', ')}). Nothing was run and nothing was spent.`), { excerptRefusal: true });
    const marked = gate.recorded(g.id, bound.length);
    if (!marked.ok) throw Object.assign(new Error(`the answers to gate ${g.id} were applied but could not be marked used (${marked.code}): ${marked.message}`), { excerptRefusal: true });
    done.push({ id: g.id, count: bound.length });
  }
  return done;
}
