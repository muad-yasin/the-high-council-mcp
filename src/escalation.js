import { layerWord, layerHyphen } from './top-layer.js';
// Stall escalation (shape B, 27 Okt 2026; the owner's pick: "I'd rather have plans layer 3 signed off"): the pure parts. On a layered chain a stall below the top layer no longer ends the revise loop: the stalled pass makes no
// revise, the next pass asks only the layers from the next one up, and that layer's seats rule on the stuck objections (src/chain.js wires it; design Review/StallEscalation/Design_2026-10-27.md, C&C rulings of 27 Okt 2026).
// No imports from roles.js, no provider and no clock: the caller asks the held sentences (src/held-roles.js) and passes plain data in.
//
// Contract:
//   escalationTarget({ failures, layerOf, layerNumbers }) -> { from, to } | null
//       from = the HIGHEST layer among the labs of the stalled signature (a mixed-layer signature goes up from its highest layer); to = the next layer above it. null at the top layer, or when no failure names a layered lab.
//   RULING_HELD          the three held names; the ruling stage makes a call only when ALL are recorded (rulingActive), like the conflict decider's deciderActive.
//   readRulings(parsed, ids) -> { byId: Map<id, { ruling: 'sustain' | 'overrule', reason }>, ignored: [{ id, why }] }
//       The two words are the whole vocabulary (case, spaces and a closing full stop are not a different word). An overrule with no reason is NO ruling (the prompt says so). Two different rulings for one id are no ruling for it
//       (fail closed). An id that is not being ruled on is ignored and recorded.
//   settleRulings({ ids, seats, perSeat }) -> [{ id, result: 'sustained' | 'overruled' | 'undecided', sustainers: [seat], why? }]
//       perSeat: [{ seat, byId?: Map, why? }] in seat order. Sustained if ANY seat sustained it (each sustaining seat adopts it); overruled only if EVERY seat gave a readable overrule; otherwise undecided, which leaves the
//       objection standing as its raiser's (an unreadable or missing ruling is never an overrule).
//   escalatedSignoffBlock({ end, escalations }) -> string   A-DRAFT, the words a person reads above the deliverable after an escalated sign-off; held for the owner's yes with the ruling sentences.

/** @returns {{ from: number, to: number } | null} */
export function escalationTarget({ failures, layerOf, layerNumbers }) {
  const layers = (Array.isArray(failures) ? failures : []).map(f => layerOf?.[f?.lab]).filter(n => Number.isFinite(n));
  if (!layers.length || !Array.isArray(layerNumbers)) return null;
  const from = Math.max(...layers);
  const to = layerNumbers.filter(n => n > from).sort((a, b) => a - b)[0];
  return Number.isFinite(to) ? { from, to } : null;
}

export const RULING_HELD = Object.freeze(['escalationRulingSystem', 'escalationRulingUser', 'ledgerRulingsSection']);
/** True only when every held sentence of the ruling is recorded (`held` is src/held-roles.js's). */
/** 0.8.4 M1 COMPLETE U2 (T4c): the automatic go-up at layer 1's revision bound (trigger 'layer1_bound') says everything the person's send-up (trigger 'send_up', legacy, recorded choices of older runs) says: the objections were still open at layer 1's revision limit and went up a layer. ONE helper, so every word table reads the two alike. Pure. */
export const isLayerOneUp = trigger => trigger === 'send_up' || trigger === 'layer1_bound';
/** 0.8.4 S7: how many escalation rows each trigger has (a row without a known trigger is a stall, as every reader has always read it). Pure. */
export function escalationTriggersOf(escalations) {
  const n = { stall: 0, send_up: 0, layer2_bound: 0 };
  for (const e of Array.isArray(escalations) ? escalations : []) n[isLayerOneUp(e?.trigger) ? 'send_up' : e?.trigger === 'layer2_bound' ? 'layer2_bound' : 'stall'] += 1;
  return n;
}
const CAUSE_WORDS = [   // [trigger, the objections, what was done]; the first clause present is written in full, each later one as "others ..."
  ['stall', 'objections that stood unchanged', 'were passed up'],
  ['send_up', "objections that were still open at layer 1's revision limit", 'were sent up'],
  ['layer2_bound', "objections of layer 2 that were still open at layer 2's revision limit", 'were sent up'],
];
/** What the final verdict line says caused the escalation(s) (A-DRAFT for a send-up and for the layer-2 go-up): the stall wording byte for byte when every escalation was a stall (or none is recorded), the send-up wording when every one was a send-up, both when a run had both, and one clause more for a layer-2 go-up. Pure. */
export function escalationCauseWords(escalations) {
  const n = escalationTriggersOf(escalations);
  const present = CAUSE_WORDS.filter(([k]) => n[k] > 0);
  if (!present.length) present.push(CAUSE_WORDS[0]);
  return present.map(([, what, did], i) => `${i === 0 ? what : what.replace(/^objections/, 'others')} ${did}`).join(' and ');
}
/** The BOARD/dissent clause of ONE escalation row: when its objections were open (stall: stood unchanged; send_up and layer2_bound: still open when the layer had used its revisions). Pure. */
export const escalationStoodWords = e => (isLayerOneUp(e?.trigger) ? `still open when layer 1 had used its revisions in pass ${e.round}` : e?.trigger === 'layer2_bound' ? `still open when layer 2 had used its revisions in pass ${e.round}` : `stood unchanged up to pass ${e.round}`);
const BLOCK_CAUSE = [   // the escalated-sign-off block's cause clauses, in this order
  ['stall', 'objections that stood unchanged over consecutive rounds were passed up a layer'],
  ['send_up', 'objections that were still open after layer 1 had used its revisions were sent up a layer'],
  ['layer2_bound', "objections of layer 2 that were still open after layer 2 had used its revisions were sent up a layer"],
];
const blockCauseWords = escalations => {
  const n = escalationTriggersOf(escalations);
  const present = BLOCK_CAUSE.filter(([k]) => n[k] > 0).map(([, w]) => w);
  if (!present.length) present.push(BLOCK_CAUSE[0][1]);
  return present.length === 1 ? `${present[0]} instead of ending the run.` : present.length === 2 ? `${present[0]}, and ${present[1]}, instead of ending the run.` : `${present[0]}, ${present[1]}, and ${present[2]}, instead of ending the run.`;
};

/** 0.8.4 S7 fix-up (A-DRAFT, WORDING row GU-15d-W): the cause words of the "Unresolved dissent" header's escalated-sign-off clause when a layer-2 go-up is among the escalations (null otherwise: the header keeps its three older outputs). The clauses are BLOCK_CAUSE's, joined as the block joins them, without its tail. Pure. */
export const escalatedHeaderCauseWords = escalations => {
  const n = escalationTriggersOf(escalations);
  if (!(n.layer2_bound > 0)) return null;
  const present = BLOCK_CAUSE.filter(([k]) => n[k] > 0).map(([, w]) => w);
  return present.length === 1 ? present[0] : present.length === 2 ? `${present[0]}, and ${present[1]}` : `${present[0]}, ${present[1]}, and ${present[2]}`;
};

export const rulingActive = held => RULING_HELD.every(name => typeof held(name) === 'function');

// 0.8.4 S7 (A-DRAFT): the layer-2 bound go-up has its OWN three sentences (W9 and its two companions); the recorded three say the objections "stood unchanged" or were open at the first layer's limit, which is untrue for layer 2's bound. The go-up asks for a ruling only when ALL THREE are recorded (own gate, like RULING_HELD); until then layer 3 reviews the plan blind, rules on nothing and the layer-2 objections stay with their raisers.
export const GO_UP_HELD = Object.freeze(['goUpRulingSystem', 'goUpRulingUser', 'goUpRulingsSection']);
export const goUpRulingActive = held => GO_UP_HELD.every(name => typeof held(name) === 'function');

// 0.8.4 S7b (D39 / W39 / Q7(e)): layer 2 rules on layer 1's still-open objections inside its ordinary blind-review call. Live only when ALL FIVE names are recorded: the rating demand (the severity switch), the relation wording W6 (a re-raise of an objection a ruling closed gets a new linked id, T12g; without it the old id would be hidden as closed while its raiser still holds it), and the three S7b sentences (the section, the reply tail, and the wording of layer 3's ledger for a ruling made in layer 2's call). Until then no prompt, record or figure moves. Names only: the words are A-DRAFT in a later commit.
export const LAYER_ONE_RULING_HELD = Object.freeze(['ratingDemand', 'relationRule', 'layerOneRulingsSection', 'layerOneRulingsReplyTail', 'layerOneRulingsLedgerSection']);
export const layerOneRulingActive = held => LAYER_ONE_RULING_HELD.every(name => typeof held(name) === 'function');

const idKey = v => String(v ?? '').trim().toLowerCase();
const wordOf = v => (typeof v === 'string' ? v.trim().toLowerCase().replace(/[.!]+$/, '') : '');

export function readRulings(parsed, ids) {
  const byId = new Map();
  const ignored = [];
  const wanted = new Map((ids || []).map(id => [idKey(id), id]));
  const list = parsed && typeof parsed === 'object' && Array.isArray(parsed.rulings) ? parsed.rulings : [];
  const conflicting = new Set();
  for (const r of list) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const id = wanted.get(idKey(r.id));
    if (!id) { ignored.push({ id: typeof r.id === 'string' ? r.id : '', why: 'unknown_id' }); continue; }
    const ruling = wordOf(r.ruling);
    const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
    if (ruling !== 'sustain' && ruling !== 'overrule') { ignored.push({ id, why: 'unreadable_ruling' }); continue; }
    if (ruling === 'overrule' && !reason) { ignored.push({ id, why: 'overrule_without_reason' }); continue; }
    if (conflicting.has(id)) continue;
    const before = byId.get(id);
    if (before && before.ruling !== ruling) { byId.delete(id); conflicting.add(id); ignored.push({ id, why: 'conflicting_rulings' }); continue; }
    if (!before) byId.set(id, { ruling, reason });
  }
  return { byId, ignored };
}

export function settleRulings({ ids, seats, perSeat }) {
  const of = new Map((perSeat || []).map(p => [p.seat, p]));
  return (ids || []).map(id => {
    const sustainers = (seats || []).filter(s => of.get(s)?.byId?.get(id)?.ruling === 'sustain');
    if (sustainers.length) return { id, result: 'sustained', sustainers };
    const all = (seats || []).length > 0 && (seats || []).every(s => of.get(s)?.byId?.get(id)?.ruling === 'overrule');
    if (all) return { id, result: 'overruled', sustainers: [] };
    // Why it stays standing: the first seat-level reason in seat order (a held prompt, an unreachable seat, an unreadable reply), else "no ruling" (a seat gave none, or one that did not count, for this id).
    const why = (seats || []).map(s => of.get(s)?.why).find(Boolean) || 'no_ruling';
    return { id, result: 'undecided', sustainers: [], why };
  });
}

/**
 * A-DRAFT (person-facing; held for the owner's yes in the same batch as the ruling sentences): the block above the deliverable when the top layer signed off over objections that were passed up. The standing ones are ALSO in
 * "Unresolved dissent" (today's dispute stage runs over them, C&C ruling 1); this block says what happened to every passed-up objection. `end`: { pass, layer }; `escalations`: report.json escalations[] rows (outcome rows carry
 * the raiser's `problem`). A sustained objection's FINAL status is read from the record (outside review D5, 27 Okt 2026), in this order: passed up again (a later escalation lists its new id); withdrawn by the seat that took it
 * over (`replies`: report.json answer_back_replies, effect "withdrawn"); that seat signed off in the final pass (`signoff`: the final pass's signoff[]); otherwise the block says no final status is on record. Pure.
 */
export function escalatedSignoffBlock({ end, escalations, replies = [], signoff = [], standing = null, agreed = false, closed = null }) {
  // The ladder (A-DRAFT, person-facing): nothing was passed up, so the stall wording would be false. The lower layers were not asked in this pass, and the block says so. 0.8.4 S4: a pass a request put at the top layer on a chain WITHOUT the ladder (`requested`, no `ladder`) reads the same sentence under its own heading; nothing was passed up there either.
  if (end.ladder || end.requested) return [end.ladder ? '## Ladder sign-off' : '## Top-layer sign-off', '', `The top layer (${layerWord(end.layer)}) signed off on this plan in round ${end.pass}. ${(end.below || []).length === 1 ? 'Layer' : 'Layers'} ${(end.below || []).join(', ')} ${(end.below || []).length === 1 ? 'was' : 'were'} not asked in that pass: ${end.requested ? 'it was asked to start at the top layer' : 'the ladder asks the lower layers only at their turn'}. This is not consensus of the whole panel.`, '', '---', ''].join('\n');   // A-DRAFT variant for a pressed pass (end.requested): a person's request, not the ladder, put the pass at the top layer; an unpressed sign-off keeps its sentence byte for byte
  const rows = (escalations || []).flatMap(e => (e.outcome || []).map(o => ({ ...o, pass: e.pass, to_layer: e.to_layer, rulings: (e.rulings || []).filter(r => r.id === o.id) })));
  const label = o => (o.problem ? `: "${String(o.problem).replace(/\s+/g, ' ').trim().slice(0, 160)}${String(o.problem).trim().length > 160 ? '...' : ''}"` : '');
  const finalOf = (a, after) => {
    if (closed && closed.has(`${a.seat ?? a.lab}\u0000${a.id}`)) return `closed below 4 at ${layerWord(end.layer)}'s closing read (every ${layerHyphen(end.layer)} seat sorted it may-leave)`;   // 0.8.4 S8 c3 (A-DRAFT, WORDING row 1667): the closing read closed it after the dispute stage; `closed` is the closure's own set (seat key + id), null for a run without S8's words
    const later = (escalations || []).find(e => e.pass > after && (e.ids || []).includes(a.id));   // a LATER escalation only: an id's own escalation is not 'passed up again'
    if (later) return `passed up again in round ${later.pass} (listed below)`;
    const w = (replies || []).filter(r => r.lab === (a.seat ?? a.lab) && r.id === a.id && (r.effect === 'withdrawn' || r.effect === 'withdrawn_exchange')).pop();
    if (w) return w.effect === 'withdrawn_exchange' ? `withdrawn by ${a.lab} in round ${w.round}, in its layer's exchange, giving a reason` : `withdrawn by ${a.lab} in round ${w.round}, quoting the draft`;   // B2: the second wording is A-DRAFT
    const s = (signoff || []).find(x => !x.cut && (x.seat ?? x.lab) === (a.seat ?? a.lab));   // 0.8.4 --finish: a cut-off layer's row is no final sign-off
    if (s?.signedOff === true && (s.objections || []).some(x => x.id === a.id)) return `${a.lab} signed off in round ${end.pass} and still holds it as its own, open objection`;   // 0.8.4 S5 (A-DRAFT): a sustain below 4 holds nothing back, so the seat signs off and keeps the adopted objection
    if (s?.signedOff === true) return `${a.lab} signed off in round ${end.pass} without raising it again`;
    return 'no final status is on record';
  };
  // 0.8.4 (A-DRAFT): an objection that climbed FLAGGED (layer 1's exchange had not debated it) has no outcome row: it gets its own line here, with what became of it (`next`, derived: the same words as the board).
  const flaggedRows = (escalations || []).flatMap(e => (e.not_debated || []).map(n => `- ${n.id} (raised by ${n.lab}, layer ${e.from_layer}): passed up to layer ${e.to_layer} in round ${e.pass}, but layer ${n.layer ?? 1}'s exchange had not debated it, so it was not ruled on. ${notDebatedNextWords(n)}`.trim()));
  const line = o => {
    const raised = `${o.id} (raised by ${o.lab}, layer ${o.layer}${label(o)})`;
    if (o.result === 'overruled') return `- ${raised}: overruled by every judge of layer ${o.to_layer} in round ${o.pass}. Reasons given: ${o.rulings.filter(r => r.reason).map(r => `${r.lab}: ${r.reason}`).join(' / ')}${o.stays_open === true ? ` It stays open: it is rated 4 or above, is not rated, or was once rated 7 or above, so the ruling closed nothing${!standing || standing.has(`${o.seat ?? o.lab}\u0000${o.id}`) ? ', and it is listed under Unresolved dissent' : ''}.` : ''}`;   // 0.8.4 S5 (A-DRAFT)
    if (o.result === 'sustained') return `- ${raised}: sustained in round ${o.pass} by ${(o.adopted_as || []).map(a => `${a.lab} (layer ${o.to_layer})`).join(' and ')}, whose objection it then was (${(o.adopted_as || []).map(a => a.id).join(', ')}). Final status: ${(o.adopted_as || []).map(a => finalOf(a, o.pass)).join('; ')}.`;
    // FIX F2: "listed under Unresolved dissent" only when the dispute stage's open set holds it (`standing`: seat key + id); otherwise its final status, in the approved form of the sustained line (reuse, no new sentence).
    const key = `${o.seat ?? o.lab}\u0000${o.id}`;
    if (!standing || standing.has(key)) return `- ${raised}: passed up to layer ${o.to_layer} in round ${o.pass}; no ruling closed it, so it is listed under Unresolved dissent.`;
    return `- ${raised}: passed up to layer ${o.to_layer} in round ${o.pass}; no ruling closed it. Final status: ${finalOf({ lab: o.lab, seat: o.seat ?? o.lab, id: o.id }, o.pass)}.`;
  };
  return [
    '## Escalated sign-off',
    '',
    `The top layer (${layerWord(end.layer)}) signed off on this plan in round ${end.pass}, but not every judge did: ${blockCauseWords(escalations)} ${agreed ? 'This is not consensus of the whole panel: the handler then checked the build and the run ends agreed. The judges who raised these objections did not withdraw them:' : 'This is not consensus. The judges who raised these objections did not withdraw them:'}`,
    '',
    ...rows.map(line),
    ...flaggedRows,
    '',
    '---',
    '',
  ].join('\n');
}

/**
 * 0.8.4 (Q1(g)(2); RU-S3-50, 53, 55): what became of an objection that climbed FLAGGED (escalations[].not_debated[]), DERIVED from the record when the report is written, never written at the climb (the climb only knows the objection was not debated).
 * Reads the exchange rows (`layerDebates`), the answer-back rows (`answerBackReplies`) and the escalated sign-off. The first that holds wins:
 *   debated_after_send_back  a later pass's layer-1 exchange has a row for it that is no longer not_debated (it drew a counted post on its final text: the record's own test, RU-S1-15, FIX 1/2);
 *   withdrawn                its raiser withdrew it in an answer in a pass after the stalled one (the answer-back offers the raiser its open objections);
 *   standing_dissent         the run ended at the escalated sign-off with it still standing;
 *   pending                  none of these (the run stopped, or is still going, before either).
 * `escalation` is the escalations[] row (its `round` is the pass that stalled, its `pass` the escalated pass); a pass after the escalated pass counts as after the send-back.
 */
/** The words a person reads for each `next` (BOARD.md and the escalated sign-off block share them). A-DRAFT. */
export const NOT_DEBATED_NEXT_WORDS = Object.freeze({ debated_after_send_back: 'Layer 1 debated it in a later pass, after the plan was sent back.', withdrawn: 'Its raiser withdrew it afterwards.', standing_dissent: 'The run ended at the escalated sign-off with it still standing.', pending: 'The run stopped before any of these happened.' });

/** The words for what became of one flagged objection. The layer that left it not debated is `n.layer` when it is not the lowest (0.8.4 S6: the shortened exchange can leave a layer-2 objection not debated); without it the words are the layer-1 ones, byte for byte. */
export const notDebatedNextWords = n => (n?.next === 'debated_after_send_back' && Number.isInteger(n.layer) && n.layer !== 1 ? `Layer ${n.layer} debated it in a later pass, after the plan was sent back.` : (NOT_DEBATED_NEXT_WORDS[n?.next] ?? ''));

export function notDebatedNext(entry, escalation, { layerDebates = [], answerBackReplies = [], escalatedSignoff = null } = {}) {
  const after = Number.isInteger(escalation?.pass) ? escalation.pass : 0;
  if ((layerDebates || []).some(d => d?.pass > after && (d.objections || []).some(o => o?.id === entry?.id && o.outcome !== 'not_debated' && Array.isArray(o.posts) && o.posts.length > 0))) return 'debated_after_send_back';
  if ((answerBackReplies || []).some(r => r?.id === entry?.id && r.effect === 'withdrawn' && r.round > (escalation?.round ?? 0))) return 'withdrawn';
  if (escalatedSignoff) return 'standing_dissent';
  return 'pending';
}

/** The escalations[] rows as the report prints them: each `not_debated` entry gets its `next`, derived from the record (see notDebatedNext). Rows without a flagged objection are returned as they are. */
export function escalationsWithNext(escalations, record = {}) {
  return (escalations || []).map(e => (Array.isArray(e?.not_debated) ? { ...e, not_debated: e.not_debated.map(n => ({ ...n, next: notDebatedNext(n, e, record) })) } : e));
}
