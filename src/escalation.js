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
/** What the final verdict line says caused the escalation(s) (A-DRAFT for a send-up): the stall wording byte for byte when every escalation was a stall (or none is recorded), the send-up wording when every one was a send-up, both when a run had both. Pure. */
export function escalationCauseWords(escalations) {
  const rows = Array.isArray(escalations) ? escalations : [];
  const up = rows.filter(e => e?.trigger === 'send_up').length;
  if (up === 0) return 'objections that stood unchanged were passed up';
  if (up === rows.length) return "objections that were still open at layer 1's revision limit were sent up";
  return "objections that stood unchanged were passed up and others that were still open at layer 1's revision limit were sent up";
}

export const rulingActive = held => RULING_HELD.every(name => typeof held(name) === 'function');

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
export function escalatedSignoffBlock({ end, escalations, replies = [], signoff = [], standing = null }) {
  // The ladder (A-DRAFT, person-facing): nothing was passed up, so the stall wording would be false. The lower layers were not asked in this pass, and the block says so.
  if (end.ladder) return ['## Ladder sign-off', '', `The top layer (layer ${end.layer}) signed off on this plan in round ${end.pass}. Layer ${(end.below || []).join(', ')} did not read this text: ${end.requested ? 'the pass was asked to start at the top layer' : 'the ladder asks the lower layers only at their turn'}. This is not consensus of the whole panel.`, '', '---', ''].join('\n');   // A-DRAFT variant for a pressed pass (end.requested): a person's request, not the ladder, put the pass at the top layer; an unpressed sign-off keeps its sentence byte for byte
  const rows = (escalations || []).flatMap(e => (e.outcome || []).map(o => ({ ...o, pass: e.pass, to_layer: e.to_layer, rulings: (e.rulings || []).filter(r => r.id === o.id) })));
  const label = o => (o.problem ? `: "${String(o.problem).replace(/\s+/g, ' ').trim().slice(0, 160)}${String(o.problem).trim().length > 160 ? '...' : ''}"` : '');
  const finalOf = (a, after) => {
    const later = (escalations || []).find(e => e.pass > after && (e.ids || []).includes(a.id));   // a LATER escalation only: an id's own escalation is not 'passed up again'
    if (later) return `passed up again in round ${later.pass} (listed below)`;
    const w = (replies || []).filter(r => r.lab === (a.seat ?? a.lab) && r.id === a.id && (r.effect === 'withdrawn' || r.effect === 'withdrawn_exchange')).pop();
    if (w) return w.effect === 'withdrawn_exchange' ? `withdrawn by ${a.lab} in round ${w.round}, in its layer's exchange, giving a reason` : `withdrawn by ${a.lab} in round ${w.round}, quoting the draft`;   // B2: the second wording is A-DRAFT
    const s = (signoff || []).find(x => (x.seat ?? x.lab) === (a.seat ?? a.lab));
    if (s?.signedOff === true) return `${a.lab} signed off in round ${end.pass} without raising it again`;
    return 'no final status is on record';
  };
  const line = o => {
    const raised = `${o.id} (raised by ${o.lab}, layer ${o.layer}${label(o)})`;
    if (o.result === 'overruled') return `- ${raised}: overruled by every judge of layer ${o.to_layer} in round ${o.pass}. Reasons given: ${o.rulings.filter(r => r.reason).map(r => `${r.lab}: ${r.reason}`).join(' / ')}`;
    if (o.result === 'sustained') return `- ${raised}: sustained in round ${o.pass} by ${(o.adopted_as || []).map(a => `${a.lab} (layer ${o.to_layer})`).join(' and ')}, whose objection it then was (${(o.adopted_as || []).map(a => a.id).join(', ')}). Final status: ${(o.adopted_as || []).map(a => finalOf(a, o.pass)).join('; ')}.`;
    // FIX F2: "listed under Unresolved dissent" only when the dispute stage's open set holds it (`standing`: seat key + id); otherwise its final status, in the approved form of the sustained line (reuse, no new sentence).
    const key = `${o.seat ?? o.lab}\u0000${o.id}`;
    if (!standing || standing.has(key)) return `- ${raised}: passed up to layer ${o.to_layer} in round ${o.pass}; no ruling closed it, so it is listed under Unresolved dissent.`;
    return `- ${raised}: passed up to layer ${o.to_layer} in round ${o.pass}; no ruling closed it. Final status: ${finalOf({ lab: o.lab, seat: o.seat ?? o.lab, id: o.id }, o.pass)}.`;
  };
  return [
    '## Escalated sign-off',
    '',
    `The top layer (layer ${end.layer}) signed off on this plan in round ${end.pass}, but not every judge did: ${(() => { const up = (escalations || []).filter(e => e.trigger === 'send_up').length; return up === 0 ? 'objections that stood unchanged over consecutive rounds were passed up a layer instead of ending the run.' : up === (escalations || []).length ? 'objections that were still open after layer 1 had used its revisions were sent up a layer instead of ending the run.' : 'objections that stood unchanged over consecutive rounds were passed up a layer, and objections that were still open after layer 1 had used its revisions were sent up a layer, instead of ending the run.'; })()} This is not consensus. The judges who raised these objections did not withdraw them:`,
    '',
    ...rows.map(line),
    '',
    '---',
    '',
  ].join('\n');
}
