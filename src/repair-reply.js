// 3 Nov 2026 (owner's pick "Auto + handler tool"; headings "THE REPAIR TOOL'S SHAPE ..." and "THE REPAIR TOOL LEAVES NO TRACE IN THC'S RECORD ..." in the detail file): the handler's repair of a stage that a repair pause holds
// (src/near-json.js). The MCP tool repair_reply (src/mcp/server.js) is this function plus the run checks and the resume; the CLI way (write `<label>.md` by hand, then --resume) goes through the same acceptance check in the stage
// cache. What it may do is narrow, on purpose: it never writes or changes a verdict, a quote, a rating or a problem, and it never fills a row the seat did not write.
//
// Contract. repairReply(dir, stage, { text, restoreRows, decline }) -> { kind, declined, changed? } when the repair was written and the pause closed, or { refusal, code } when nothing was written.
//   dir: a run folder the caller has already passed through trustedRunDir (no symbolic link anywhere in it); stage: a label the caller has checked (STAGE_LABEL).
//   Exactly one input:
//     text         (pause kind near_json) the seat's reply with its JSON fixed. Scanned for credential shapes first (an answer is input); taken only if acceptanceFor passes (the same words in the same order).
//     restoreRows  (pause kind table_rows) row numbers; THC builds the repair itself: the original object with those rows' `criterion` set to the exact text of the criterion at the row's position (the marker's list).
//                  Every number must be one the pause flagged (the marker's `rows`: the criteria the table left without a row), a row the seat wrote and a position the criteria list has, each once. So the handler can only
//                  give a criterion that has no row the row at its own position, never a second row to a criterion that has one (C&C's review of unit 6, 4 Nov 2026: acceptanceFor alone checks only that row k gets criterion k's
//                  text). acceptanceFor then checks the result as it checks a repair a person wrote.
//     ids          (pause kind id_slip, 4 Nov 2026) pairs { from, to }, each one the pause found (the marker's `slips`), each `from` once; THC sets those posts' `on` / answers' `id` and re-writes the object as JSON.
//     decline      the original reply written back unchanged; recorded as declined. The stage is then read as it would be without a repair (the pause triggers ask cache.repaired, so it never pauses again).
//   The repair is written atomically as `<stage>.md` (never through a link), then acceptRepair moves the marker (accepted) and NEEDS-<stage>.md into originals/ at once, so the top level is an ordinary stage and a second call
//   is refused ("already repaired"). The paid usage record is never touched (it stays at its label, counted once). A refused repair writes nothing: the reason comes back to the caller, who has the text in hand.
// The sentences are A-DRAFT (public MCP text; Review/WORDING_0.8.4.md, REPLY REPAIR).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { acceptanceFor, acceptRepair, acceptedRepairOf, objectOf, originalOf, repairMarkerOf, REPAIR_KINDS } from './near-json.js';
import { writeRunFileAtomic } from './run-files.js';
import { secretShapesIn } from './outbound-scan.js';
import { credentialSentence } from './stage-submission.js';

const refuse = (code, refusal) => ({ refusal, code });
// What each kind takes, and the words its kind refusal uses (4 Nov 2026, unit 8: the third kind; the near_json and table_rows sentences are the unit-6 ones with the given input named).
const KIND_INPUT = { near_json: ['text', 'a reply that is almost JSON'], table_rows: ['restore_rows', 'its sign-off table'], id_slip: ['ids', 'an objection id one character off'] };
const kindRefusal = (stage, kind, given) => refuse('kind', `"${stage}" waits for a repair of ${KIND_INPUT[kind][1]}: give ${KIND_INPUT[kind][0]} (or decline: true), not ${given}; nothing was written`);

export function repairReply(dir, stage, { text, restoreRows, ids, decline } = {}) {
  const given = [typeof text === 'string', Array.isArray(restoreRows), Array.isArray(ids), decline === true].filter(Boolean).length;
  if (given !== 1) return refuse('input', 'give exactly one of text, restore_rows, ids or decline: true; nothing was written');
  const marker = repairMarkerOf(dir, stage);
  if (!marker && existsSync(join(dir, `${stage}.repair.json`))) return refuse('marker', `${stage}.repair.json cannot be read, so there is nothing to hold a repair to and nothing was written; look at the run folder`);
  if (marker?.accepted || (!marker && acceptedRepairOf(dir, stage))) return refuse('repaired', `"${stage}" was already repaired (or its repair was declined); a stage is repaired once, so nothing was written`);
  if (!marker || !existsSync(join(dir, `NEEDS-${stage}.md`))) return refuse('not_waiting', `run is not waiting for a repair of "${stage}"`);
  // A reply file at the label while the pause is pending: one written by hand the CLI way, or a call of this tool cut short between its write and its acceptance. The resume's stage cache checks it (and accepts or keeps it); never overwritten here.
  if (existsSync(join(dir, `${stage}.md`))) return refuse('reply_present', `"${stage}" already has a reply file (${stage}.md) that the run has not yet checked against the original, so nothing was written; resume the run (resume_run) to have it checked`);
  // 4 Nov 2026 (unit 8, under C&C's fail-closed ruling): a kind THC does not know is refused before any input is judged (the check refuses it too).
  if (!REPAIR_KINDS.includes(marker.kind)) return refuse('kind', `the pause record of "${stage}" names a kind of repair the harness does not know, so nothing was written; look at the run folder`);
  const original = originalOf(dir, marker);
  if (original === null) return refuse('original', `the original reply of "${stage}" cannot be read from originals/, so no repair can be checked against it and nothing was written`);
  const input = typeof text === 'string' ? 'text' : Array.isArray(restoreRows) ? 'restore_rows' : Array.isArray(ids) ? 'ids' : null;
  if (input && KIND_INPUT[marker.kind][0] !== input) return kindRefusal(stage, marker.kind, input);

  let repaired;
  if (typeof text === 'string') {
    const found = secretShapesIn(text, { exemptReservedHosts: true });
    if (found.length) return refuse('credential', `the repair for "${stage}" was not written: it holds ${credentialSentence(found)}. A repair keeps every word of the seat's reply, so if the reply itself holds such a string, decline the repair (decline: true) instead; the reply is then read as it would be without a repair.`);
    repaired = text;
  } else if (Array.isArray(restoreRows)) {
    const object = objectOf(original);
    const rows = Array.isArray(object?.criteria) ? object.criteria : null;
    const criteria = Array.isArray(marker.criteria) ? marker.criteria : null;
    if (!rows || !criteria) return refuse('original', `the original reply of "${stage}" or its pause record holds no table THC can set a criterion text in, so nothing was written`);
    const max = Math.min(rows.length, criteria.length);
    const flagged = (Array.isArray(marker.rows) ? marker.rows : []).filter(n => Number.isInteger(n) && n >= 1 && n <= max);
    if (!flagged.length) return refuse('original', `the pause record of "${stage}" names no row to restore, so nothing was written`);
    const fits = restoreRows.length > 0 && restoreRows.every(n => flagged.includes(n)) && new Set(restoreRows).size === restoreRows.length;
    if (!fits) return refuse('rows', `restore_rows may name only ${flagged.length === 1 ? `row ${flagged[0]}, once` : `rows ${flagged.join(', ')}, each once`}: a row may be restored only where its words did not fit the criterion at its position (a row the seat did not write is never added, and no criterion gets two rows); nothing was written`);
    for (const n of restoreRows) {
      if (!rows[n - 1] || typeof rows[n - 1] !== 'object' || Array.isArray(rows[n - 1]) || typeof criteria[n - 1] !== 'string') return refuse('rows', `row ${n} of the seat's table is not a row THC can set a criterion text in, so nothing was written`);
      rows[n - 1].criterion = criteria[n - 1];
    }
    // The repair is the original object re-written as JSON: text outside the object and number formatting are not kept; a duplicate key keeps its last value, as every reader of the reply reads it (a duplicate key that
    // changes the decision reads null, so such a reply is never a table pause). The resume reads the repaired reply again with every guard.
    repaired = JSON.stringify(object);
  } else if (Array.isArray(ids)) {
    // 4 Nov 2026 (unit 8): THC substitutes the ids itself, only pairs the pause found (the marker's slips), each `from` once; the handler types no id of its own. The object is re-written as JSON, as for a table repair.
    const slips = Array.isArray(marker.slips) ? marker.slips : [];
    if (!slips.length) return refuse('original', `the pause record of "${stage}" names no id to restore, so nothing was written`);
    const fits = ids.length > 0 && ids.every(p => p && slips.some(q => q.from === p.from && q.to === p.to)) && new Set(ids.map(p => p.from)).size === ids.length;
    if (!fits) return refuse('ids', `ids may name only these pairs, each once: ${slips.map(q => `${q.from} -> ${q.to}`).join(', ')} (the ids one character from an id the seat was shown); nothing was written`);
    const object = objectOf(original);
    const lists = [Array.isArray(object?.posts) ? ['posts', 'on'] : null, Array.isArray(object?.replies) ? ['replies', 'id'] : null].filter(Boolean);
    if (!lists.length) return refuse('original', `the original reply of "${stage}" holds no post or answer THC can set an id in, so nothing was written`);
    for (const [arr, field] of lists) for (const e of object[arr]) { const p = e && typeof e === 'object' ? ids.find(q => q.from === e[field]) : null; if (p) e[field] = p.to; }
    repaired = JSON.stringify(object);
  } else {
    repaired = original;
  }

  const verdict = acceptanceFor(marker, original, repaired);
  if (!verdict.ok) return refuse('not_taken', `the repair of "${stage}" was not taken, and nothing was written: ${verdict.why}`);
  const w = writeRunFileAtomic(dir, `${stage}.md`, repaired);
  if (w.refusal) return refuse('write', w.refusal);
  const declined = decline === true;
  try { acceptRepair(dir, stage, marker, { declined }); } catch (e) {
    // A run that read the stage between the write and this line has accepted the repair itself (the stage cache): the pause is closed either way.
    if (!acceptedRepairOf(dir, stage)) return refuse('close', `the repaired reply of "${stage}" was written, but its pause could not be closed (${e?.code || e?.message}); resume the run (resume_run) to have it checked`);
  }
  // The kind is one of REPAIR_KINDS (checked above); `changed`: the row numbers of a table repair, or the shown ids an id-slip repair now names (THC's ids, from the shape-checked marker).
  return { kind: marker.kind, declined, ...(marker.kind !== 'near_json' && verdict.changed ? { changed: verdict.changed } : {}) };
}
