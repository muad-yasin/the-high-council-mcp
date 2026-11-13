// The final read (B3 prep, unit D; Muad, 1 Nov 2026: "It counts as the final plan, so layer 3 must read it before the run ends"). 0.8.4 S16: no switch (it is part of every layered unanimous run; src/final-read-gate.js). When a layered run ends WITHOUT agreement, the layer-3 seats that have not read the plan as it now stands read it once
// (one call each, one re-ask on an unreadable reply), and their words are recorded as a closing statement. This file holds the pure parts: which seats must read,
// the record shape, and the texts. The calls themselves are runFinalRead in src/chain.js (next to runDisputeReview), so every call goes through invoke().
//
// "Read" is per SEAT (C&C ruling 1 Nov 2026): a seat has read a plan when its latest recorded verdict in panelVerdicts is a readable one (signed_off or objected,
// carried over an unchanged draft included, exchange_cleared counted as signed_off) on a round whose draft is exactly that plan. A stated pass, an unheard seat and a
// seat never asked have not read. A seat that has not read the plan as it ends is asked; one that has is not.
//
// Every sentence a person or a model reads below is A-DRAFT (the owner's one wording review): the log lines, the record block and the BOARD section.
import { keyOfRecord, shownKey } from './seat-key.js';
import { holdsSignOff, readSeverity } from './severity.js';
import { relayedTail } from './overseer-rounds.js';
import { topLayerOf, layerWord, layerWordCap, layerHyphen, layerUpper, layerHyphenUpper } from './top-layer.js';

/** The run's top layer as the record names it (the highest layer among its seats and reused seats): the number the final read's texts print; null when the record names none (the texts then say "the top layer", src/top-layer.js). Pure. */
export const layerNOf = rec => topLayerOf({ finalRead: rec });

/** The stage label of one seat's final read. The re-ask adds `-reask1`. Never rename: a paused run replays by label. */
export const finalReadLabel = (seatKey, tag = '') => `final-read-${seatKey}${tag}`;
export const FINAL_READ_REASK_SUFFIX = '-reask1';
/** 0.8.4 S16 (D; Q9(e), N6): nobody has read the final plan: no top-layer seat read exactly this text before (`readBefore`: the climb, a reused sorting, a coverage seat's earlier read) and none of the seats asked now read it. Pure. A seat that read it before makes the end an ordinary not-agreed one: no stop, no continue. */
export const nobodyReadFinalPlan = (readBefore, entries) => !readBefore && (entries || []).every(e => e.read !== true);
/** 0.8.4 S16 (D, Q9(e), F4): the read a CONTINUE at the final-read stop makes is `-c<n>` (n = 1, 2, ...), the read before a FINISH is `-f`. Additive labels: the first read's labels never change (a paused run replays by label), and a replayed unreadable reply must not answer a read that is meant to ask again. */
export const finalReadTag = (kind, n = 0) => (kind === 'continue' ? `-c${n}` : kind === 'finish' ? '-f' : '');

const READABLE = new Set(['signed_off', 'objected']);

/** The keys of the top layer's seats, in panel order. */
export function topSeatsOf(critics) {
  const layers = (critics || []).map(c => c.layer).filter(Number.isInteger);
  if (!layers.length) return [];
  const top = Math.max(...layers);
  return critics.filter(c => c.layer === top);
}

/**
 * For each top-layer seat key: the sha12 of the draft it last read (a readable verdict on that round's draft), or null when it never read one.
 * Pure and derived, never recorded. `draftShaByRound[round]` is draftIdOf(draft) at the round's start (chain.js); a row whose round has no sha counts as not read.
 */
export function layer3ReadShas(panelVerdicts, draftShaByRound, topSeatKeys) {
  const out = new Map(topSeatKeys.map(k => [k, null]));
  const lastRound = new Map();
  for (const row of panelVerdicts || []) {
    const key = keyOfRecord(row);
    if (!out.has(key) || row?.cut || !READABLE.has(row?.verdict)) continue;   // 0.8.4 --finish: a row marked `cut` is no read
    const sha = draftShaByRound?.[row.round];
    if (typeof sha !== 'string' || sha === '') continue;
    if (!(row.round >= (lastRound.get(key) ?? -Infinity))) continue;
    lastRound.set(key, row.round);
    out.set(key, sha);
  }
  return out;
}

/**
 * 0.8.4 S16 (Q9(e), D13, RU-ADD-A12; T9c, T21b, NEW-A12-1, NEW-A12-2): a top-layer seat that read exactly this plan is reused ONLY if what it sorted covers the current text of every open objection and late finding. `seats`: the keys to test; `shownBySeat`:
 * key -> the items that seat was shown at its last verdict ([{ id, ... }], null when it was shown none); `current`: the items now ([{ id, ... }]); `fpOf`: item -> a short fingerprint of its text. A seat is asked again when some current item is missing from what it was shown
 * (opened since: in the ending exchange, in a layer-3 post) or was shown under another text (amended since). An item that is gone from `current` (withdrawn) changes nothing. Pure.
 */
export function coverageGaps({ seats = [], shownBySeat = new Map(), current = [], fpOf }) {
  return seats.filter(key => {
    const seen = new Map((shownBySeat.get(key) || []).map(i => [i.id, fpOf(i)]));
    return current.some(i => seen.get(i.id) !== fpOf(i));
  });
}

/**
 * 0.8.4 S16 (Q12, T21ae, advisor 09 Nov): the ids of a seat's objections at the final read. An id is per seat, criterion and quoted passage (src/objection-ids.js): the same ones, whatever the words, is the SAME objection ("a reworded complaint about the same quote still counts as the same"); a suffix (#2) comes only from the Q12 assigner,
 * which objectionId already applies through its registry. `failures`: the seat's own failures; `rows`: anchored sorting entries ({ criterion, problem, quote, severity? }); `known`: the ids open in the list the seat was shown; `baseIdOf(f)`: the id (chain.js passes objectionId over the seat key).
 * A sorting entry whose id is one of the seat's own failures' or a listed one is that objection (the seat's word on it), not a second objection: it gets NO NEW ID (Q12). 0.8.4 S18 (C&C's ruling, 09 Nov 2026; the owner's 29 Okt "layer 3 signs off"): the seat's word on it is no longer thrown away. An entry on the seat's own failure in the same reply is
 * that failure (already a record); an entry on a LISTED id (the seat's own earlier objection, which the id says: it is minted over the seat key) is returned in `restated`, with the id it restates, and the caller records it as the seat's failure on that id, so the seat reads as objecting, with the reason, passage and rating it gave. -> { failures (with ids), added (rows with ids), restated (rows with the taken id) }. Pure.
 */
export function finalReadObjections({ failures = [], rows = [], known = new Map(), baseIdOf }) {
  const own = failures.map(f => ({ ...f, id: f.id || baseIdOf(f) }));
  const taken = new Set([...own.map(f => f.id), ...(known instanceof Map ? known.keys() : known)]);
  const added = []; const restated = [];
  const ownIds = new Set(own.map(f => f.id));
  for (const row of rows) {
    const id = baseIdOf(row);
    if (taken.has(id)) { if (!ownIds.has(id) && !restated.some(r => r.id === id)) restated.push({ ...row, id }); continue; }
    taken.add(id); added.push({ ...row, id });
  }
  return { failures: own, added, restated };
}

/** The seat keys that must read: those whose last read is not exactly this plan (never read always differs). */
export function seatsToRead(finalSha, shas) {
  return [...shas].filter(([, sha]) => sha !== finalSha).map(([key]) => key);
}

/**
 * 0.8.4 S8 c2b (T9a): the seats NOT asked because they had already read exactly this plan, with the statement they made then: the verdict of their last readable row (the one layer3ReadShas used). `seats`: [{ key, lab, seat?, layer }] (the top
 * layer's, in panel order); `mustRead`: the keys that are asked. Pure. The seat's sorting is added when its last verdict row carries one (the climb verdict's, S8 money step).
 */
export function reusedEntries({ seats = [], panelVerdicts = [], draftShaByRound = {}, finalSha, mustRead = [] } = {}) {
  const asked = new Set(mustRead);
  return seats.filter(s => !asked.has(s.key)).map(s => {
    let last = null;
    for (const row of panelVerdicts || []) {
      if (keyOfRecord(row) !== s.key || row?.cut || !READABLE.has(row?.verdict)) continue;   // 0.8.4 --finish: a row marked `cut` is no read (as layer3ReadShas)
      const sha = draftShaByRound?.[row.round];
      if (typeof sha !== 'string' || sha === '' || (last && !(row.round >= last.round))) continue;
      last = row;
    }
    return { lab: s.lab, ...(s.seat ? { seat: s.seat } : {}), layer: s.layer, read_sha: finalSha, ...(last ? { round: last.round, statement: { verdict: last.verdict }, ...(Array.isArray(last.sorting) && last.sorting.length ? { sorting: last.sorting } : {}) } : {}) };
  });
}

/** One seat's entry of the record. `last_read_sha` is what the seat had read before this stage (null: nothing). */
export function readEntry({ lab, seat, layer, label, lastReadSha, reasked, critique, sorting = null, sortingIgnored = 0, sortingNew = [], concern = null }) {
  return {
    lab, ...(seat ? { seat } : {}), layer, label, last_read_sha: lastReadSha, reasked, read: true,
    meets: critique.meets === true,
    ...(typeof concern === 'string' && concern ? { concern } : {}),   // 0.8.4 S16 (I, D25; WORDING S16-w22b): a note for the build to watch that claims no criterion fails; never an objection, never rated
    ...(sortingIgnored > 0 ? { sorting_ignored: sortingIgnored } : {}),   // 0.8.4 S8: rows of this seat's sorting that were ignored (no id, an unknown sort, a repeated id, or a sorting that is not a list)
    ...(sortingNew && sortingNew.length ? { sorting_new: sortingNew } : {}),   // 0.8.4 S8 c2b: a new defect this seat found at the closing read (a must-do with an id outside the list, or none and the passage): kept whole, and made a late finding by chain.js
    ...(sorting && sorting.length ? { sorting } : {}),   // 0.8.4 S8: this seat's sorting rows (src/sorting.js), present only while the sorting gate is on and the reply carried rows
    // criterion and problem as the seat wrote them; id, fix and severity ride along when the reply has them. Severity is copied through readSeverity: a readable tag as written, anything else null, and no key at all when the reply has none (with the chain's severity switch off the parse drops every tag, so no switch-off record carries the key).
    failures: (critique.failures || []).map(f => ({ criterion: f.criterion, problem: f.problem, ...(f.fix ? { fix: f.fix } : {}), ...(f.quote ? { quote: f.quote } : {}), ...(f.id ? { id: f.id } : {}), not_debated: true, ...(f.severity !== undefined ? { severity: readSeverity(f.severity).ok ? f.severity : null } : {}), ...(holdsSignOff(f.severity === undefined ? undefined : (readSeverity(f.severity).ok ? f.severity : null)) ? { open: true } : {}) })),   // 0.8.4 S18 (WORDING S18-w15, spec l.1486): an objection that holds the sign-off stays OPEN on the record under the seat's name with its own rating; one below 4 ends nothing and carries no mark   // 0.8.4 S16 (T21ae, T21f, Q12): an objection of the final read keeps its quote and its id (chain.js mints it over the seat key) and is never debated (no exchange follows the read)
  };
}
export function unreadEntry({ lab, seat, layer, label, lastReadSha, reasked, why }) {
  return { lab, ...(seat ? { seat } : {}), layer, label, last_read_sha: lastReadSha, reasked, read: false, why };
}
/** 0.8.4 (finish at once at the spending limit; A-DRAFT LAD-B6): a seat the final read did NOT ask, because the person ended the run at the spending limit and its call would bill. Not an abstention and not a seat that failed to answer: `not_run` says so, and the seat counts as one that did not read (an unread seat never clears the run). */
export const FINAL_READ_NOT_RUN_WHY = 'the person ended the run at the spending limit, so this seat was not asked (no judge reads the plan again)';
/** 0.8.4 (finish at once at the spending limit; A-DRAFT LAD-R26): a seat that WAS asked (its reply is on disk) but gave no usable reply, and whose re-ask was not made because the person ended the run at the spending limit. Not `not_run` (it was asked) and not an ordinary "did not read" (it was not asked again): `reask_not_run` says so. */
export const FINAL_READ_NOT_REASKED_WHY = 'its reply on disk could not be read, and the person ended the run at the spending limit, so it was not asked again (no judge reads the plan again)';
export const FINAL_READ_NOT_REASKED_FINISH_WHY = 'its reply on disk could not be read, and the person ended the run at once, so it was not asked again (no judge reads the plan again)';   // A-DRAFT (LAD-R28)
export function notReaskedEntry({ lab, seat, layer, label, lastReadSha, reason = 'spending_limit' }) {
  return { ...unreadEntry({ lab, seat, layer, label, lastReadSha, reasked: false, why: reason === 'finished_at_once' ? FINAL_READ_NOT_REASKED_FINISH_WHY : FINAL_READ_NOT_REASKED_WHY }), reask_not_run: reason === 'finished_at_once' ? 'finished_at_once' : 'spending_limit' };
}
export const FINAL_READ_NOT_RUN_FINISH_WHY = 'the person ended the run at once, so this seat was not asked (its read of this plan is not on disk, and no judge reads the plan again)';   // A-DRAFT (LAD-R28)
export function notRunEntry({ lab, seat, layer, label, lastReadSha, reason = 'spending_limit' }) {
  const atOnce = reason === 'finished_at_once';
  return { ...unreadEntry({ lab, seat, layer, label, lastReadSha, reasked: false, why: atOnce ? FINAL_READ_NOT_RUN_FINISH_WHY : FINAL_READ_NOT_RUN_WHY }), not_run: atOnce ? 'finished_at_once' : 'spending_limit' };
}

/** The record under report.json `final_read`. Present on every layered unanimous run that reaches the end, `ran: false` with a reason when nobody was asked. */
export function finalReadRecord({ ran, reason, finalSha, runEnd, seats = [], sorting = null, reused = [], noHandler = false, relayed = false, coverageOnly = false }) {   // 0.8.4 S18 (WORDING S18-w22): `noHandler`: the run has no handling session
  const objected = runEnd === 'not_agreed' && finalReadObjected({ ran, seats });   // 0.8.4 S16 (T21f; WORDING S16-w73d): the named basis of a not-agreed end whose final read was objected to; `ending` is NOT touched (a finish at a stop has none)
  return { ran, ...(reason ? { reason } : {}), ...(reason === 'finished_at_once' && relayed ? { relayed: true } : {}), ...(reason === 'finished_at_once' && coverageOnly === true ? { coverage_only: true } : {}), run_end: runEnd, final_sha: finalSha, ...(objected ? { basis: 'final_read_objection' } : {}), ...(noHandler && finalReadObjected({ ran, seats }) ? { decided_by: 'none' } : {}), seats, ...(sorting && sorting.length ? { sorting } : {}), ...(reused && reused.length ? { reused } : {}) };   // 0.8.4 S8: `sorting` = the seats' sortings combined (src/sorting.js combineSortings), additive
}

/**
 * The ONE place the final read asks JUDGE's holdsSignOff (src/severity.js): a seat that READ the plan and objected, where EVERY objection it raised is rated below 4 (a sweep: recorded, not a flip), is cleared. A reply with no objection listed,
 * an objection with no readable tag (an untagged one holds), and every record written with the severity switch off (no failure carries a tag, so holdsSignOff is true for each) are NOT cleared: with the switch off this reads exactly as before.
 * No band arithmetic here; the lines belong to severity.js.
 */
const sweptOnly = e => e.read === true && e.meets === false && Array.isArray(e.failures) && e.failures.length > 0 && e.failures.every(f => !holdsSignOff(f?.severity));
/** A top-layer seat that read the plan and holds it: it objected, and at least one objection holds sign-off (or it named none). */
const seatObjects = e => e.read === true && e.meets === false && !sweptOnly(e);
/** A top-layer seat that read the plan and does not hold it: no objection, or only swept ones. */
const seatClears = e => e.read === true && (e.meets === true || sweptOnly(e));

/**
 * True when the final read ran and at least one top-layer seat READ the plan and objected with an objection that holds sign-off (seatObjects). On a run that ended AGREED this is what turns the ending into "not agreed"
 * (fail closed: his rule is that no route ends before the top layer has read the final text, except the person's own finish-now, which skips the final read). Accepts the result's `finalRead` and report.json's `final_read`.
 * signoff[] and `passed` are never touched by it (public contract); outcome, the exit code, the verdict line and the BOARD banner read it.
 */
export const finalReadObjected = fr => fr?.ran === true && (fr.seats || []).some(seatObjects);

/**
 * True when an AGREED run (run_end 'agreed') must not be reported as agreed: the final read ran and some top-layer seat objected to the final plan with an objection that holds sign-off OR did not read it (an unknown is not a pass: fail closed).
 * On a run that ended without agreement the ending is already not agreed, so this is false there. Outcome, the exit code, the verdict line, the BOARD banner and run_status read it.
 */
export const finalReadBlocksAgreement = fr => fr?.ran === true && fr.run_end === 'agreed' && (fr.seats || []).some(e => !seatClears(e));
/**
 * 0.8.4 S4 (copy correction 11): true when the final read ran on EXACTLY the plan `sha` and every top-layer seat read it and clears it (no objection that holds, or only swept ones). It says nothing about `run_end`, so it cannot be fooled by
 * a record whose run_end is not 'agreed'; an empty seat list, a seat that did not read, an objection that holds, or a read of another plan is false (fail closed).
 */
export const finalReadClears = (fr, sha) => fr?.ran === true && fr.final_sha === sha && Array.isArray(fr.seats) && fr.seats.length > 0 && fr.seats.every(seatClears);

/** 0.8.4 S16 (WORDING S16-w6b): a COVERAGE seat is one that read exactly the final plan (its last read is this sha) and was asked again only because an objection or late finding was opened or amended after its sorting. */
const isCoverage = (e, finalSha) => typeof finalSha === 'string' && finalSha !== '' && e.last_read_sha === finalSha;
function notAskedWord(e) { return e.not_run === 'finished_at_once' ? 'NOT ASKED (finished at once)' : 'NOT ASKED (spending limit)'; }   // A-DRAFT (LAD-R28 for the second form)
const verdictWord = (e, finalSha) => (e.not_run ? notAskedWord(e) : !e.read ? (isCoverage(e, finalSha) ? 'DID NOT READ AGAIN' : 'DID NOT READ') : e.meets ? 'no objection' : 'objected');   // A-DRAFT: "no objection", not "signed off": in a run that ended without agreement a sign-off word could be read as approval of the plan

/** 0.8.4 S18 (WORDING S18-w10): how the agreement before the final read is worded; `viaHandler` = layer 3 signed off and the handler said good to build (an escalated or ladder sign-off), where "every layer" would be false. */
const signedOnEarlier = (viaHandler, N) => (viaHandler ? `${layerWord(N)} had signed off and the handler had said good to build on an earlier text` : 'every layer had signed off on an earlier text');

/** Log lines for the stage. The loud lines name every seat that did not read, and an objection that ends an agreed run. A-DRAFT. */
export function finalReadLogLines(entries, runEnd = 'not_agreed', finalSha = null, viaHandler = false) {   // 0.8.4 S18 (WORDING S18-w10): `viaHandler`: the end was agreed by the handler's good_to_build on layer 3's sign-off (an escalated or ladder one), not by every layer
  const lines = entries.map(e => `  ${e.lab}: ${e.not_run ? `was NOT asked: ${e.why}.` : e.read ? (e.meets ? 'read the final plan and raised no objection.' : `read the final plan and objected (${e.failures.length} objection(s)).`) : isCoverage(e, finalSha) ? `had read the final plan; did NOT read it again after an objection or late finding was opened or amended: ${e.why}.` : `did NOT read the final plan: ${e.why}.`}`);
  const unread = entries.filter(e => !e.read && !isCoverage(e, finalSha)).map(e => e.lab);
  const unreadAgain = entries.filter(e => !e.read && isCoverage(e, finalSha)).map(e => e.lab);
  const N = layerNOf({ seats: entries });   // S8: the run's top layer from the entries (the chain's own entries always carry their layer)
  if (unread.length) lines.push(`  NOT EVERY ${layerHyphenUpper(N)} SEAT READ THE FINAL PLAN after its last change (${unread.join(', ')} did not).${runEnd === 'agreed' ? '' : ' The run ended without agreement.'}`);
  if (unreadAgain.length) lines.push(`  ${layerHyphenUpper(N)} SEAT(S) (${unreadAgain.join(', ')}) DID NOT READ AGAIN after an objection or late finding was opened or amended.${runEnd === 'agreed' ? '' : ' The run ended without agreement.'}`);
  if (runEnd === 'agreed' && entries.some(seatObjects)) lines.push(`  ${layerUpper(N)} OBJECTED TO THE FINAL PLAN with an objection that holds the sign-off: ${signedOnEarlier(viaHandler, N)}, but this run is NOT agreement.`);
  else if (runEnd === 'agreed' && (unread.length || unreadAgain.length)) lines.push(`  This run is NOT agreement: ${signedOnEarlier(viaHandler, N)}, but not every ${layerHyphen(N)} seat read the final plan.`);
  return lines;
}

/** 0.8.4 S18 (WORDING S18-w26, w27, A-DRAFT; C&C: the BOARD and the deliverable's block show the handler's sort from the same record row, `final_read.sorting[].by: 'handler'`): what the handling session sorted an objection of the final read, with its own reasons and the seat that signed this text. '' when it sorted nothing. */
const handlerRowOf = (record, f) => (Array.isArray(record?.sorting) ? record.sorting.find(r => r?.by === 'handler' && r.id === f?.id) : null);
const handlerNoteOf = (record, f) => { const h = handlerRowOf(record, f); if (!h) return ''; const w = (h.reasons || []).find(x => x.seat === 'handler'); const sp = splitOfFinalRead(record); return ` The handling session sorted it ${h.sort === 'may_leave' ? 'may-leave' : 'must-do'}${sp ? ` (${sp.signed.join(', ')} signed this text)` : ''}: ${String(w?.reason ?? '').replace(/\s+/g, ' ').trim()}`; };
const handlerBoardOf = (record, f) => { const h = handlerRowOf(record, f); return h ? ` (sorted ${h.sort === 'may_leave' ? 'may-leave' : 'must-do'} by the handling session)` : ''; };
/**
 * The sentence of the final-read block for a run FINISHED AT ONCE with the owed read not made (record `ran: false`, `reason: 'finished_at_once'`), else ''. 0.8.4: A-DRAFT LAD-F10 (nobody read the final plan), LAD-R25 (only part of the top layer had read this version) and, since 10 Nov 2026 (the owner: a finish after the rounds keeps the panel's "agreed"), the last sentence only where the run did not end agreed (LAD-R43).
 * One copy: renderFinalReadBlock below and the summary block (src/summary-add.js, an agreed finish-now) both read it.
 */
export function finalReadNotReadWords(record) {
  if (record?.ran !== false || record.reason !== 'finished_at_once') return '';
  const N0 = layerNOf(record); const tail = record.run_end === 'agreed' ? '' : ' The run ended without agreement.';
  if (record.coverage_only === true) return `The run was finished at once at the person's choice${relayedTail(record)}, so ${layerWord(N0)} did not read the final plan again after an objection or late finding was opened or amended; all of ${layerWord(N0)} had read this version before.${tail}`;   // 0.8.4 apply, entry 46: every top-layer seat had read this version and only a coverage read was owed (the shapes with and without a seat in `reused`)
  if (Array.isArray(record.reused) && record.reused.length) return `The run was finished at once at the person's choice${relayedTail(record)}, so the final plan was not read again; only part of ${layerWord(N0)} had read this version before (${record.reused.map(r => r.seat ?? r.lab).join(', ')}).${tail}`;
  return `The run was finished at once at the person's choice${relayedTail(record)}, so ${layerWord(N0)} did not read the final plan.${tail}`;
}
/** The block that joins the builder's blocks above the plan (a record, not plan text, no re-read). Empty when the stage did not run. */
export function renderFinalReadBlock(record, viaHandler = false) {   // 0.8.4 S18 (WORDING S18-w11): `viaHandler` as in finalReadLogLines
  const notRead = finalReadNotReadWords(record);   // 0.8.4 (finish at once, A-DRAFT LAD-F10 and LAD-R25; the words moved into finalReadNotReadWords unchanged, so the summary block reads the same sentence)
  if (notRead) return `## ${layerWordCap(layerNOf(record))} on the final plan\n\n${notRead}\n---\n`;
  if (!record?.ran || !record.seats.length) return '';
  const agreedEnd = record.run_end === 'agreed';
  const N = layerNOf(record);   // S8: the run's top layer from the record
  const coverage = record.seats.some(e => isCoverage(e, record.final_sha));   // 0.8.4 S16 (WORDING S16-w6b)
  const out = [`## ${layerWordCap(N)} on the final plan`, '', agreedEnd
    ? `${viaHandler ? `${layerWordCap(N)} had signed off and the handler had said good to build` : 'Every layer had signed off'}, but the plan changed after ${layerWord(N)} last read it. ${layerWordCap(N)} was asked to read the final plan. This is a record of what each seat said; no revision followed.`
    : `The run ended without agreement. After the plan's last change${coverage ? ", or after an objection or late finding was opened or amended since a seat's last sorting," : ','} ${layerWord(N)} was asked to read it. This is a record of what each seat said, not a verdict, and no revision followed.`, ''];   // A-DRAFT
  for (const e of record.seats) {
    out.push(`### ${e.lab}: ${verdictWord(e, record.final_sha)}`, '');
    if (!e.read) out.push(e.not_run ? `This seat was not asked: ${e.why}.` : isCoverage(e, record.final_sha) ? `This seat had read the final plan but did not read it again after an objection or late finding was opened or amended: ${e.why}.` : `This seat did not read the final plan: ${e.why}.`, '');
    else if (e.meets) out.push(agreedEnd ? 'Read the final plan and raised no objection.' : 'Read the final plan and raised no objection. This is not agreement: the run ended without it.', '');
    else for (const f of e.failures) out.push(`- "${f.criterion}": ${f.problem}${handlerNoteOf(record, f)}`, '');
  }
  const unread = record.seats.filter(e => !e.read && !isCoverage(e, record.final_sha)).map(e => e.lab);
  const unreadAgain = record.seats.filter(e => !e.read && isCoverage(e, record.final_sha)).map(e => e.lab);
  if (unread.length) out.push(`**Not every ${layerHyphen(N)} seat read the final plan (${unread.join(', ')} did not).**`, '');
  if (unreadAgain.length) out.push(`**${unreadAgain.join(', ')} had read the final plan but did not read it again after an objection or late finding was opened or amended.**`, '');
  if (finalReadObjected(record)) out.push(`**${layerWordCap(N)} objected to the final plan` + (agreedEnd ? ' with an objection that holds the sign-off, so this run is NOT agreement.**' : '.**'), '');
  else if (agreedEnd && (unread.length || unreadAgain.length)) out.push(`**This run is NOT agreement: not every ${layerHyphen(N)} seat read the final plan.**`, '');
  if (record.handler_sort_not_run === 'finished_at_once') out.push('The handling session was not asked to sort the objection: the run was finished at once, so it stays unsorted.', '');   // A-DRAFT (LAD-R29)
  return `${out.join('\n')}\n---\n`;   // 0.8.4 S16 (WORDING S16-w4): every harness note ends with a `---` line; bodyOfDelivered (src/tree-split.js) finds the plan after the last one
}

/** The closed-below-4 lines of the BOARD's final-read section (A-DRAFT, WORDING row 1660; S8 c3): '' when nothing was closed. `closed`: closedRowsOf's rows. */
const closedBoardLines = (closed, N) => (Array.isArray(closed) && closed.length
  ? `Closed below 4 at ${layerWord(N)}'s closing read (every ${layerHyphen(N)} seat sorted these may-leave; each is rated below 4 and was never rated 7 or above, so none is still open):\n${closed.map(c => `- ${c.id} (raised by ${shownKey(c.lab)}): ${c.criterion}. ${c.reasons.map(r => `${shownKey(r.seat)}: ${r.reason}`).join(' / ')}`).join('\n')}\n`
  : '');
/** BOARD.md section. `closed` (S8 c3): the objections the closing read closed; they are shown whether the final read ran or every top seat had already read the plan. */
export function renderFinalReadBoard(record, closed = [], viaHandler = false) {   // 0.8.4 S18 (WORDING S18-w12): `viaHandler` as in finalReadLogLines
  const N = layerNOf(record);   // S8: the run's top layer from the record
  const closedLines = closedBoardLines(closed, N);
  if (!record?.ran && record && record.ran === false && closedLines) return `\n## Final read by ${layerWord(N)}\n\n${layerWordCap(N)} had already read the final plan (plan id ${record.final_sha}), so it was not asked again.\n\n${closedLines}`;
  if (!record?.ran || !record.seats.length) return '';
  const rows = record.seats.map(e => `- **${verdictWord(e, record.final_sha)}** - ${e.lab} (layer ${e.layer})${e.reasked ? ', asked twice' : ''}${e.read ? (e.meets ? '' : `: ${e.failures.map(f => `${f.criterion}${handlerBoardOf(record, f)}`).join('; ')}`) : `: ${e.why}`}${e.concern ? `\n  Concern (not an objection, holds nothing back): ${String(e.concern).replace(/\s+/g, ' ').trim()}` : ''}`);   // WORDING S16-w24
  const boardText = `\n## Final read by ${layerWord(N)}\n\n${record.run_end === 'agreed' ? `${viaHandler ? `${layerWordCap(N)} had signed off and the handler had said good to build` : 'Every layer had signed off'}, but the plan changed after ${layerWord(N)} last read it` : 'The run ended without agreement'}; ${layerWord(N)} was asked to read the final plan (plan id ${record.final_sha}).\n\n${rows.join('\n')}\n${closedLines ? `\n${closedLines}` : ''}`;
  return record.handler_sort_not_run === 'finished_at_once' ? `${boardText}\nThe handling session was not asked to sort the objection: the run was finished at once, so it stays unsorted.\n` : boardText;   // A-DRAFT (LAD-R29)
}

/** One line for the end-of-run summary (the terminal is what a handler acts on). '' when the stage did not run. A-DRAFT. */
export function finalReadSummaryLine(record) {
  if (!record?.ran || !record.seats?.length) return '';
  return `final read: ${record.seats.map(e => `${e.lab} ${e.not_run ? notAskedWord(e) : !e.read ? (isCoverage(e, record.final_sha) ? 'DID NOT READ AGAIN' : 'DID NOT READ') : e.meets ? 'no objection' : `objected (${e.failures.length})`}`).join('; ')}${record.run_end === 'agreed' && record.seats.some(e => !seatClears(e)) ? ' - the run is NOT agreed' : ''}`;
}

/**
 * 0.8.4 S18 (WORDING S18-w14, spec l.1486: an objection of the final read "is sorted must-do by the seat that raised it (N14) and goes to the build list"): the rows of the OPEN objections of a final read, read from the record's own mark (`failures[].open`), for the section of the build list. Pure; model text
 * is collapsed to one line so a model-written newline can start no section or task line (HANDOFF.md has line readers); the seat is named by its key.
 */
export function openFinalReadRows(record) {
  if (!record?.ran || !Array.isArray(record.seats)) return [];
  const one = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const split = splitOfFinalRead(record);   // S18: where the handler sorted a split objection, its sort, its reasons and the seat that signed are on the row
  const handled = new Map((Array.isArray(record.sorting) ? record.sorting : []).filter(r => r?.by === 'handler').map(r => [r.id, r]));
  return record.seats.flatMap(e => (e.read === true && Array.isArray(e.failures) ? e.failures.filter(f => f?.open === true).map(f => { const h = handled.get(f.id); const hw = h ? (h.reasons || []).find(x => x.seat === 'handler') : null; return { id: typeof f.id === 'string' ? f.id : null, seat: e.seat ?? e.lab, rating: typeof f.severity === 'number' ? f.severity : null, criterion: one(f.criterion), problem: one(f.problem), ...(h ? { handlerSort: h.sort, handlerReason: one(hw?.reason), signedBy: split ? split.signed : [] } : {}) }; }) : []));
}

/**
 * 0.8.4 S18 (spec l.1486, D31, W40): the SPLIT of the overseer layer at a not-agreed end: exactly one layer-3 seat read the final plan and holds an objection, and every other layer-3 seat read this same text and signed it (a seat that was asked and cleared it, or one not asked whose last verdict, on this text, signed off), at least one. Anything else (both
 * object, a seat that did not read, a seat whose last verdict objected) is not a split: nothing is sorted by the handler, the objection stays must-do. -> { objector (the seat's entry), signed [seat keys], ids [the objector's open objection ids] } | null. Pure.
 */
export function splitOfFinalRead(fr) {
  if (!fr?.ran || !Array.isArray(fr.seats)) return null;
  const objectors = fr.seats.filter(seatObjects);
  const cleared = fr.seats.filter(seatClears);
  const unusable = fr.seats.filter(e => !seatObjects(e) && !seatClears(e));
  const reused = Array.isArray(fr.reused) ? fr.reused : [];
  const reusedSigned = reused.filter(e => e?.statement?.verdict === 'signed_off');
  if (objectors.length !== 1 || unusable.length || reused.length !== reusedSigned.length || cleared.length + reusedSigned.length < 1) return null;
  const ids = (objectors[0].failures || []).filter(f => f?.open === true && typeof f.id === 'string').map(f => f.id);
  return { objector: objectors[0], signed: [...cleared, ...reusedSigned].map(e => e.seat ?? e.lab), ids };
}

/**
 * 0.8.4 S18 (spec l.1486): the final-read record with the handler's sortings put on the combined rows (`by: 'handler'`): the row of an objection's id names the handler's sort and reasons, and next to them the raiser's own must-do (the objection is sorted must-do by its seat, N14: the handler's sort replaces it, the raiser's own word does not decide alone).
 * The objection itself stays open under the seat's name with its rating. `sorts`: [{ id, sort, reasons }]. Pure.
 */
export function withHandlerSorts(fr, split, sorts) {
  const by = new Map(sorts.map(s => [s.id, s]));
  const own = String(split.objector.seat ?? split.objector.lab);
  const rows = sorts.map(s => { const f = (split.objector.failures || []).find(x => x.id === s.id) || {}; return { id: s.id, sort: s.sort, by: 'handler', seats: ['handler'], reasons: [{ seat: own, sort: 'must_do', reason: String(f.problem ?? '').replace(/\s+/g, ' ').trim() }, { seat: 'handler', sort: s.sort, reason: s.reasons }] }; });
  return { ...fr, sorting: [...(Array.isArray(fr.sorting) ? fr.sorting : []).filter(r => !by.has(r.id)), ...rows] };
}
