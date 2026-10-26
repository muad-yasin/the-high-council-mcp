// The conflict decider (0.8.3 E4b units 2 and 3; Muad 15 Okt 2026 "Definetly A": an extra judge rules which side wins when a lower judge's old objection comes back after an upper judge's was fixed; gate pages
// Review/Build_0.8.3/m6-closing/E4b_Gate_Page.md + section 10, and m7/A_E4b_Units23_Gate_Note.md, C&C PASS ON CONDITIONS). The detector is src/conflict-detector.js (unit 1, pure). This module is the glue chain.js asks:
// is a decider seated AND its prompt recorded, how a conflict is put to it, how its answer is read, and the row `decisions[]` keeps.
//
// Contract (pure; no I/O, no clock):
//   DECIDER_HELD_NAMES        the three prompt functions the stage needs from src/roles.js (held until Muad's yes at M7): conflictDeciderSystem, conflictDeciderUser, reviserDecisionNote.
//   deciderSeatOf(config)     the `seats.decider` seat, or null.
//   externalDeciderOf(config) / seatsForOneKey(config, seats) / deciderPausesRun(config, heldFn)   doctor's one-key line (Muad 24 Okt 2026, "B sounds fine to me"): an EXTERNAL seats.decider slot does not keep a chain off the line, the caveat is printed only while that decider can pause the run.
//   deciderActive(config)     a seat is named AND all three prompt functions exist (src/held-roles.js `held`). While they do not, the stage behaves as Branch C: no call, a `prompt_held` row, nothing else changes.
//   conflictItems(found, failuresByRound, labOf)   the conflicts of ONE pass, at most MAX_CONFLICTS_PER_CALL, each { n, id, lab, layer, round, others: [{ id, lab, layer, round, criterion, problem, quote }], objection }.
//   readRulings(parsed, items)   -> one { prevail, reason, ask_person } | null per item (null = unreadable: that conflict is recorded `decided: false`, why `unreadable_ruling`). `prevail` must be one of the item's ids or "neither".
//   decisionRow(...)          the row report.json `decisions[]` keeps (additive). A decision ANNOTATES; it never closes an objection (only the raising judge's validated withdrawal does).
import { held } from './held-roles.js';

export const DECIDER_HELD_NAMES = Object.freeze(['conflictDeciderSystem', 'conflictDeciderUser', 'reviserDecisionNote']);
export const MAX_CONFLICTS_PER_CALL = 3;
const REASON_CHARS = 600;

export const deciderSeatOf = config => {
  const s = config?.seats?.decider;
  return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
};
// Doctor's "one key alone runs" line lists a chain whose every seat is a paid seat on one key, with nobody to wait for. The conflict decider is the one seat that may be the person's own session (Muad 18 Okt 2026, and 24 Okt 2026: "I think the decider should be the LLM that handles the run, not the model that is placed on one of the seats"), and it is asked only when a swing between judge layers happens. So ONLY the seats.decider slot, and only when it is external, is left out of that count:
// any other external seat, a mock seat, or a decider on a second key still keeps the chain off the line. The caveat is printed only when the run can really pause there (an external decider whose prompt is recorded), never otherwise.
export const externalDeciderOf = config => { const s = deciderSeatOf(config); return s && s.provider === 'external' ? s : null; };
export const seatsForOneKey = (config, seats) => { const d = externalDeciderOf(config); return d ? seats.filter(s => s !== d) : seats; };
export const ONE_KEY_PAUSE_CAVEAT = 'a swing between judge layers pauses the run and leaves a file to answer';   // A-DRAFT (doctor line)
export const deciderPausesRun = (config, heldFn = held) => !!externalDeciderOf(config) && deciderActive(config, heldFn);
export const deciderActive = (config, heldFn = held) => !!deciderSeatOf(config) && DECIDER_HELD_NAMES.every(n => typeof heldFn(n) === 'function');

const textOf = f => ({ criterion: String(f?.criterion ?? ''), problem: String(f?.problem ?? ''), quote: String(f?.quote ?? '') });

/** The conflicts of one pass as the decider is shown them. `found` is findConflict's answer; the objection texts are read from the failures of the pass they were raised in. */
export function conflictItems(found, failuresByRound, { limit = MAX_CONFLICTS_PER_CALL } = {}) {
  const failureOf = (round, lab, id) => {
    const entry = (Array.isArray(failuresByRound) ? failuresByRound : []).find(r => r?.round === round);
    return (entry?.failures ?? []).find(f => f?.lab === lab && f?.id === id) ?? null;
  };
  return (Array.isArray(found) ? found : []).slice(0, limit).map((c, i) => ({
    n: i + 1, id: c.id, lab: c.lab, layer: c.layer, round: c.first_round, silent_round: c.silent_round, returned_round: c.round,
    objection: textOf(failureOf(c.round, c.lab, c.id) ?? failureOf(c.first_round, c.lab, c.id)),
    others: (c.other ?? []).map(o => ({ id: o.id, lab: o.lab, layer: o.layer, round: o.round, ...textOf(failureOf(o.round, o.lab, o.id)) })),
  }));
}

/** One reading per item, from the parsed JSON the decider returned. A missing or invalid ruling is null for that item only. */
export function readRulings(parsed, items) {
  const list = Array.isArray(parsed?.rulings) ? parsed.rulings : [];
  return items.map(item => {
    const r = list.find(x => Number(x?.conflict) === item.n);
    if (!r || typeof r !== 'object') return null;
    const allowed = new Set([item.id, ...item.others.map(o => o.id), 'neither']);
    const prevail = typeof r.prevail === 'string' ? r.prevail.trim() : '';
    if (!allowed.has(prevail)) return null;
    const reason = typeof r.reason === 'string' ? r.reason.replace(/\s+/g, ' ').trim().slice(0, REASON_CHARS) : '';
    return { prevail, reason, ask_person: r.ask_person === true };
  });
}

/**
 * One `decisions[]` row. `decided` is true only when a ruling was read. `why` says why not: 'no_decider_seat' | 'prompt_held' | 'last_round' | 'loop_ended' | 'over_limit' | 'unreadable_ruling' | 'decider_unreachable' | 'person_asked' (unit 3: the run is stopped for the person) | 'tree_member' (the ask is not offered to a tree member: the applied side is neither).
 * The decider is not a voter: its lab is shown beside the labs of the two parties, and `shares_lab_with` names the party it shares a lab with (a ruling by one of the two sides is visible).
 */
export function decisionRow({ round, overseerRound = null, label = null, item, kind, deciderLab = null, ruling = null, why = null, extra = {} }) {
  const parties = [item.lab, ...item.others.map(o => o.lab)];
  const ids = [item.id, ...item.others.map(o => o.id)];
  const layers = [item.layer, ...item.others.map(o => o.layer)];
  return {
    pass: round, ...(Number.isInteger(overseerRound) ? { overseer_round: overseerRound } : {}), ...(label ? { label } : {}), kind,
    ...(deciderLab ? { decider_lab: deciderLab, shares_lab_with: [...new Set(parties.filter(l => l === deciderLab))] } : {}),
    ids, labs: parties, layers, rounds: [item.round, ...item.others.map(o => o.round)], silent_round: item.silent_round,   // the pass each objection was raised in (parallel to ids) and the pass the first one's judge was asked and let it go: the evidence for the swing
    decided: !!ruling,
    ...(ruling ? { prevail: ruling.prevail, reason: ruling.reason, ask_person: ruling.ask_person } : { why }),
    ...extra,   // unit 3: decider_prevail / decider_reason (what the seat said when the applied side is not its own), via ('cli': the person's choice), why 'tree_member'
  };
}

// ---- unit 3: the person-ask (E4b unit 3, gate note m7/A_E4b_Unit3_Gate_Note.md, C&C PASS with the tree-member condition (ii)) ------------------------------------------------------------------------------------------------
//   ConflictAsked         controlFlow: the decider said `ask_person: true` for at least one conflict of this pass and the person has not chosen yet. Thrown BEFORE the revise (nothing is revised); the CLI stops the run at exit 25.
//   setConflictChoices / conflictChoiceFor   run.json `conflictChoices` [{ pass, n, prevail, via: 'cli', at }]: the person's choices (the channel, never an actor: the CLI cannot tell a person from an agent with a shell, as for --skip-seat).
//   parsePrevail(text, stop)   -> { ok: true, picks: [{ n, prevail }] } | { ok: false, why }: `--prevail 1=<id>|neither[,2=...]`, or a bare `<id>|neither` when only one conflict asked; every pick must name an id of THAT conflict or "neither".
//   conflictAskedWords(stop, { runPath, command })   the sentence a person reads (A-DRAFT).
export class ConflictAsked extends Error {
  constructor({ pass, overseerRound = null, asked }) {
    super(`the decider asked for the person to choose in pass ${pass}`);
    this.controlFlow = true;
    this.pass = pass;
    this.overseerRound = overseerRound;
    this.asked = asked;   // [{ n, ids, labs, layers, rounds, silent_round, decider_prevail, decider_reason, objections }]
  }
}

let choices = [];
export function setConflictChoices(list) { choices = Array.isArray(list) ? list.filter(c => c && Number.isInteger(c.pass) && Number.isInteger(c.n) && typeof c.prevail === 'string') : []; }
export function conflictChoiceFor(pass, n) { return choices.find(c => c.pass === pass && c.n === n) ?? null; }

export function parsePrevail(text, stop) {
  const asked = Array.isArray(stop?.conflicts) ? stop.conflicts : [];
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, why: '--prevail needs a value, for example --prevail 1=<objection id> or --prevail neither' };
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const picks = [];
  for (const part of parts) {
    const m = /^(\d+)=(.+)$/.exec(part);
    const n = m ? Number(m[1]) : (asked.length === 1 ? asked[0].n : null);
    const prevail = (m ? m[2] : part).trim();
    if (n === null) return { ok: false, why: `${part}: say which conflict it answers, as <n>=<objection id>|neither (the stop lists them by number)` };
    const c = asked.find(x => x.n === n);
    if (!c) return { ok: false, why: `conflict ${n} is not one the decider asked about (asked: ${asked.map(x => x.n).join(', ') || 'none'})` };
    if (prevail !== 'neither' && !c.ids.includes(prevail)) return { ok: false, why: `${prevail} is not an objection of conflict ${n}; choose one of ${c.ids.join(', ')} or "neither"` };
    picks.push({ n, prevail });
  }
  const missing = asked.filter(c => !picks.some(p => p.n === c.n));
  if (missing.length) return { ok: false, why: `conflict ${missing.map(c => c.n).join(', ')} still needs a choice` };
  return { ok: true, picks };
}

// A-DRAFT (Builder A, 18 Okt 2026): new person-facing text for the later Fable pass.
export function conflictAskedWords(stop, { runPath, command = 'council', choose = null } = {}) {   // `choose`: a tree member's own answer lines (src/tree-redirect.js), in place of the direct run's --resume line
  const out = [`The conflict decider asks you to choose in review pass ${stop.pass}. An objection from a judge of one layer came back after the writer revised the plan in response to an objection from another layer. The decider considers the choice yours to make.`];
  for (const c of stop.conflicts) {
    const named = c.ids.map((id, i) => `${id} (${c.labs[i]}, layer ${c.layers[i]}, raised in pass ${c.rounds[i]})`);      // the returned objection first, then the others as ONE list (the list shape of report-shape.js's board line)
    out.push('', `Conflict ${c.n}: ${named[0]} came back after the writer revised the plan in response to ${named.slice(1).join(', ')}. The judge that raised ${c.ids[0]} was asked in pass ${c.silent_round} and did not list it.`);
    out.push(`  The decider leans to: ${c.decider_prevail === 'neither' ? 'neither side' : c.decider_prevail}.${c.decider_reason ? ` Its reason (quoted, its words): ${c.decider_reason}` : ''}`);
  }
  out.push('', choose ?? `Choose with: ${command} --resume ${runPath} --prevail ${stop.conflicts.map(c => `${c.n}=<${c.ids.join('|')}|neither>`).join(',')}`);
  out.push('"neither" means both objections stand and the writer answers both. A choice closes nothing: the judge who raised an objection is still asked about it. Resuming without a choice only says this again and spends nothing. Over MCP there is no verb for this choice: a person runs the command above in a terminal.');
  return out.join('\n');
}
