// The final read (B3 prep, unit D; Muad, 1 Nov 2026: "It counts as the final plan, so layer 3 must read it before the run ends"). Opt-in chain switch
// `final_read: { enabled: true }`. When a layered run ends WITHOUT agreement, the layer-3 seats that have not read the plan as it now stands read it once
// (one call each, one re-ask on an unreadable reply), and their words are recorded as a closing statement. This file holds the pure parts: which seats must read,
// the record shape, and the texts. The calls themselves are runFinalRead in src/chain.js (next to runDisputeReview), so every call goes through invoke().
//
// "Read" is per SEAT (C&C ruling 1 Nov 2026): a seat has read a plan when its latest recorded verdict in panelVerdicts is a readable one (signed_off or objected,
// carried over an unchanged draft included, exchange_cleared counted as signed_off) on a round whose draft is exactly that plan. A stated pass, an unheard seat and a
// seat never asked have not read. A seat that has not read the plan as it ends is asked; one that has is not.
//
// Every sentence a person or a model reads below is A-DRAFT (the owner's one wording review): the log lines, the record block and the BOARD section.
import { keyOfRecord } from './seat-key.js';
import { holdsSignOff, readSeverity } from './severity.js';

/** The stage label of one seat's final read. The re-ask adds `-reask1`. Never rename: a paused run replays by label. */
export const finalReadLabel = seatKey => `final-read-${seatKey}`;
export const FINAL_READ_REASK_SUFFIX = '-reask1';

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
    if (!out.has(key) || !READABLE.has(row?.verdict)) continue;
    const sha = draftShaByRound?.[row.round];
    if (typeof sha !== 'string' || sha === '') continue;
    if (!(row.round >= (lastRound.get(key) ?? -Infinity))) continue;
    lastRound.set(key, row.round);
    out.set(key, sha);
  }
  return out;
}

/** The seat keys that must read: those whose last read is not exactly this plan (never read always differs). */
export function seatsToRead(finalSha, shas) {
  return [...shas].filter(([, sha]) => sha !== finalSha).map(([key]) => key);
}

/** One seat's entry of the record. `last_read_sha` is what the seat had read before this stage (null: nothing). */
export function readEntry({ lab, seat, layer, label, lastReadSha, reasked, critique }) {
  return {
    lab, ...(seat ? { seat } : {}), layer, label, last_read_sha: lastReadSha, reasked, read: true,
    meets: critique.meets === true,
    // criterion and problem as the seat wrote them; id, fix and severity ride along when the reply has them. Severity is copied through readSeverity: a readable tag as written, anything else null, and no key at all when the reply has none (with the chain's severity switch off the parse drops every tag, so no switch-off record carries the key).
    failures: (critique.failures || []).map(f => ({ criterion: f.criterion, problem: f.problem, ...(f.fix ? { fix: f.fix } : {}), ...(f.id ? { id: f.id } : {}), ...(f.severity !== undefined ? { severity: readSeverity(f.severity).ok ? f.severity : null } : {}) })),
  };
}
export function unreadEntry({ lab, seat, layer, label, lastReadSha, reasked, why }) {
  return { lab, ...(seat ? { seat } : {}), layer, label, last_read_sha: lastReadSha, reasked, read: false, why };
}

/** The record under report.json `final_read`. Present whenever the switch is on, `ran: false` with a reason when nobody was asked. */
export function finalReadRecord({ ran, reason, finalSha, runEnd, seats = [] }) {
  return { ran, ...(reason ? { reason } : {}), run_end: runEnd, final_sha: finalSha, seats };
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
 * (fail closed: his rule is that no route ends before the top layer has read the final text). Accepts the result's `finalRead` and report.json's `final_read`.
 * signoff[] and `passed` are never touched by it (public contract); outcome, the exit code, the verdict line and the BOARD banner read it.
 */
export const finalReadObjected = fr => fr?.ran === true && (fr.seats || []).some(seatObjects);

/**
 * True when an AGREED run (run_end 'agreed') must not be reported as agreed: the final read ran and some top-layer seat objected to the final plan with an objection that holds sign-off OR did not read it (an unknown is not a pass: fail closed).
 * On a run that ended without agreement the ending is already not agreed, so this is false there. Outcome, the exit code, the verdict line, the BOARD banner and run_status read it.
 */
export const finalReadBlocksAgreement = fr => fr?.ran === true && fr.run_end === 'agreed' && (fr.seats || []).some(e => !seatClears(e));

const verdictWord = e => (!e.read ? 'DID NOT READ' : e.meets ? 'no objection' : 'objected');   // A-DRAFT: "no objection", not "signed off": in a run that ended without agreement a sign-off word could be read as approval of the plan

/** Log lines for the stage. The loud lines name every seat that did not read, and an objection that ends an agreed run. A-DRAFT. */
export function finalReadLogLines(entries, runEnd = 'not_agreed') {
  const lines = entries.map(e => `  ${e.lab}: ${e.read ? (e.meets ? 'read the final plan and raised no objection.' : `read the final plan and objected (${e.failures.length} objection(s)).`) : `did NOT read the final plan: ${e.why}.`}`);
  const unread = entries.filter(e => !e.read).map(e => e.lab);
  if (unread.length) lines.push(`  NOT EVERY LAYER-3 SEAT READ THE FINAL PLAN after its last change (${unread.join(', ')} did not).${runEnd === 'agreed' ? '' : ' The run ended without agreement.'}`);
  if (runEnd === 'agreed' && entries.some(seatObjects)) lines.push('  LAYER 3 OBJECTED TO THE FINAL PLAN with an objection that holds the sign-off: every layer had signed off on an earlier text, but this run is NOT agreement.');
  else if (runEnd === 'agreed' && unread.length) lines.push('  This run is NOT agreement: every layer had signed off on an earlier text, but not every layer-3 seat read the final plan.');
  return lines;
}

/** The block that joins the builder's blocks above the plan (a record, not plan text, no re-read). Empty when the stage did not run. */
export function renderFinalReadBlock(record) {
  if (!record?.ran || !record.seats.length) return '';
  const agreedEnd = record.run_end === 'agreed';
  const out = ['## Layer 3 on the final plan', '', agreedEnd
    ? 'Every layer had signed off, but the plan changed after layer 3 last read it. Layer 3 was asked to read the final plan. This is a record of what each seat said; no revision followed.'
    : 'The run ended without agreement. After the plan\'s last change, layer 3 was asked to read it. This is a record of what each seat said, not a verdict, and no revision followed.', ''];   // A-DRAFT
  for (const e of record.seats) {
    out.push(`### ${e.lab}: ${verdictWord(e)}`, '');
    if (!e.read) out.push(`This seat did not read the final plan: ${e.why}.`, '');
    else if (e.meets) out.push(agreedEnd ? 'Read the final plan and raised no objection.' : 'Read the final plan and raised no objection. This is not agreement: the run ended without it.', '');
    else for (const f of e.failures) out.push(`- "${f.criterion}": ${f.problem}`, '');
  }
  const unread = record.seats.filter(e => !e.read).map(e => e.lab);
  if (unread.length) out.push(`**Not every layer-3 seat read the final plan (${unread.join(', ')} did not).**`, '');
  if (finalReadObjected(record)) out.push('**Layer 3 objected to the final plan' + (agreedEnd ? ' with an objection that holds the sign-off, so this run is NOT agreement.**' : '.**'), '');
  else if (agreedEnd && unread.length) out.push('**This run is NOT agreement: not every layer-3 seat read the final plan.**', '');
  return `${out.join('\n')}\n`;
}

/** BOARD.md section. */
export function renderFinalReadBoard(record) {
  if (!record?.ran || !record.seats.length) return '';
  const rows = record.seats.map(e => `- **${verdictWord(e)}** - ${e.lab} (layer ${e.layer})${e.reasked ? ', asked twice' : ''}${e.read ? (e.meets ? '' : `: ${e.failures.map(f => f.criterion).join('; ')}`) : `: ${e.why}`}`);
  return `\n## Final read by layer 3\n\n${record.run_end === 'agreed' ? 'Every layer had signed off, but the plan changed after layer 3 last read it' : 'The run ended without agreement'}; layer 3 was asked to read the final plan (plan id ${record.final_sha}).\n\n${rows.join('\n')}\n`;
}

/** Chain lint: a switch that would silently do nothing is refused (this repo's rule). A-DRAFT (the words a person reads). */
export function lintFinalReadChain(config, filePath = 'the chain file') {
  if (config?.final_read?.enabled !== true) return [];
  const critics = config.seats?.critics;
  const layered = Array.isArray(critics) && critics.length > 0 && critics.every(c => c?.layer !== undefined);
  if (config.signoff !== 'unanimous' || !layered) {
    return [{ kind: 'final-read-needs-layers', message: `final_read.enabled is true but this chain ${config.signoff !== 'unanimous' ? 'is not "signoff": "unanimous"' : 'has no layered panel (every seat in seats.critics needs a "layer")'}: the final read comes at the end of a layered unanimous run, agreed or not, and asks the top-layer seats that have not yet read the plan as it stands to read it, so here it would do nothing.`, fix: `Remove "final_read" from ${filePath}, or make the panel layered and unanimous.` }];
  }
  return [];
}

/** One line for the end-of-run summary (the terminal is what a handler acts on). '' when the stage did not run. A-DRAFT. */
export function finalReadSummaryLine(record) {
  if (!record?.ran || !record.seats?.length) return '';
  return `final read: ${record.seats.map(e => `${e.lab} ${!e.read ? 'DID NOT READ' : e.meets ? 'no objection' : `objected (${e.failures.length})`}`).join('; ')}${record.run_end === 'agreed' && record.seats.some(e => !seatClears(e)) ? ' - the run is NOT agreed' : ''}`;
}
