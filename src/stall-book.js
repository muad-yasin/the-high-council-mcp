// 0.8.4 S5 (Q13, RU-S5-03/05, T7a-T7f, T12l, T20l): the PER-OBJECTION stall count. A pure file: no I/O, no model call, no clock.
//
// An objection stalls when it has the same id, the same normalised quoted passage and an unchanged writer response for the stall window of consecutive VERDICTS OF ITS RAISER in which it stood.
//   - The problem text is never an input: a judge that rewords its complaint (and declares "continues") keeps the id and the count (T7a, T7c).
//   - A different quoted passage keeps the id and restarts the count at 1 (T7f); so does a writer response that changed the passage (T7d).
//   - An unrelated objection does not touch another objection's count (T7b): there is no whole-pass signature here.
//   - R9 (C&C 05 Nov 2026): the count is per VERDICT of the raiser, not per pass. A seat that was not heard with a NEW verdict in a pass (not asked because a lower layer objected, unheard, or a carried verdict
//     of a no-revise re-ask) neither adds to nor ends the count of its objections: an upper layer sits out every pass after an objection restarts the plan at layer 1, so a per-pass count could never reach w at layer 2 or 3.
//     A seat that WAS heard and no longer raises the id ends its count (a withdrawal ends it).
//   - RU-S5-05: at an overseer-round change the counts of the layers BELOW the top layer restart; the top layer's count is KEPT across overseer rounds (Q13: "counted over consecutive top-layer verdicts across overseer rounds").
//   - T20l: an id sent up is not sent up again in the same overseer round while it keeps the same passage (the plan's own rule: the same layer would be asked the same question on the same text).
//   - "Unchanged writer response" (R4): a QUOTED objection's response is `changed` only when its quote was found in the draft at the objection's last verdict and is not found in the draft now (present, then absent:
//     a judge who repeats a slightly-off quote never finds it, and must still be able to stall). An UNQUOTED objection has nothing to compare ("the writer declined it again or did not address it" are both
//     "not addressed", and a fix is seen as the judge's own withdrawal or a new `#2` id), so its response is `unchanged` while it stands.
//
// The caller (src/chain.js) decides `present` (is the quote in the draft: it owns the draft) and passes the verdict facts; this file only counts.

/** A stable key for one objection of one seat. */
const keyOf = (lab, id) => `${lab}\u0000${id}`;

/**
 * @param {{ window: number, topLayer?: number|null }} o `window` = the chain's stall window (dispute.stall_rounds: 3 in every shipped layered chain, 2 by the code's default); `topLayer` = the chain's top layer (null/undefined on an unlayered chain).
 */
export function createStallBook({ window, topLayer = null }) {
  if (!Number.isInteger(window) || window < 1) throw new RangeError('createStallBook: window must be a whole number >= 1');
  const entries = new Map();   // key -> { id, lab, layer, quoteKey, count, passes[], lastSeq, present }
  const seatSeq = new Map();   // lab -> the number of NEW verdicts that seat has given (heard, not carried)
  const sentUp = new Set();    // keys sent up in the current overseer round

  return {
    window,
    /** The entry as last noted, or null: the caller reads `present` and `quoteKey` to judge the writer's response before it notes this pass. */
    peek(lab, id) { const e = entries.get(keyOf(lab, id)); return e ? { quoteKey: e.quoteKey, present: e.present, count: e.count, passes: [...e.passes] } : null; },
    /**
     * Note one pass. `heard` = the labs (seat keys) heard with a NEW verdict in this pass. `standing` = every objection that stood in it:
     * { id, lab, layer, quoteKey, response, present, quoted } where `response` is 'unchanged' | 'changed' (ignored for the first sight of an id) and `present` is whether the quote was found in this pass's draft.
     * Returns nothing: read `reached()`.
     */
    note(pass, heard, standing) {
      const heardLabs = new Set(heard);
      for (const lab of heardLabs) seatSeq.set(lab, (seatSeq.get(lab) ?? 0) + 1);
      const keep = new Set();
      for (const s of standing) {
        if (!heardLabs.has(s.lab)) continue;   // a seat that was not heard with a new verdict does not count (R9); the caller never lists its objections, this is the backstop
        const k = keyOf(s.lab, s.id);
        keep.add(k);
        const prev = entries.get(k);
        const seq = seatSeq.get(s.lab);
        const consecutive = prev && prev.lastSeq === seq - 1 && prev.quoteKey === s.quoteKey && s.response !== 'changed';
        if (consecutive) { prev.count += 1; prev.passes.push(pass); prev.lastSeq = seq; prev.present = s.present; prev.layer = s.layer; }
        else entries.set(k, { id: s.id, lab: s.lab, layer: s.layer, quoteKey: s.quoteKey, count: 1, passes: [pass], lastSeq: seq, present: s.present });
      }
      // a heard seat that no longer raises an id ends that id's count
      for (const [k, e] of entries) if (heardLabs.has(e.lab) && !keep.has(k)) entries.delete(k);
    },
    /** The objections whose count reached the window and that were not already sent up in this overseer round. */
    reached() {
      return [...entries.entries()].filter(([k, e]) => e.count >= window && !sentUp.has(k)).map(([, e]) => ({ id: e.id, lab: e.lab, layer: e.layer, quoteKey: e.quoteKey, count: e.count, passes: e.passes.slice(-window) }));
    },
    /** The ones that reached the window but are held back because they were sent up already in this overseer round (T20l): for the record and the tests. */
    heldBack() { return [...entries.entries()].filter(([k, e]) => e.count >= window && sentUp.has(k)).map(([, e]) => e.id); },
    /** These objections were sent up: not again in this overseer round. */
    markSentUp(items) { for (const i of items) sentUp.add(keyOf(i.lab, i.id)); },
    /** A new overseer round: the counts of the layers below the top restart (RU-S5-05), the top layer's are kept (Q13), the sent-up memory is cleared. */
    newOverseerRound() {
      sentUp.clear();
      for (const [k, e] of entries) if (topLayer === null || e.layer !== topLayer) entries.delete(k);
    },
    /** The person chose to go on at a top-layer stall (S5 U-C): the objections that stalled are counted afresh. Their sent-up memory is kept (it belongs to the overseer round); every other count is untouched. */
    restart(items) { for (const i of items) entries.delete(keyOf(i.lab, i.id)); },
    /** The old fresh-window behaviour for the person's send-up (trigger 'send_up' keeps its lifetime as built): forget every count. */
    reset() { entries.clear(); sentUp.clear(); },
    /** For tests: the counts as they stand. */
    snapshot() { return [...entries.values()].map(e => ({ id: e.id, lab: e.lab, layer: e.layer, count: e.count, passes: [...e.passes] })); },
  };
}

/**
 * R9's "heard with a NEW verdict", as ONE pure predicate over the verdict shapes src/chain.js builds in a pass:
 *   a verdict with a `critique` (an objecting or signing-off reply, a re-ask's answer, an adopted unanswered-objection fallback, a `decidedOnly` verdict whose failures were all filtered)  -> heard
 *   a STATED PASS (`passed: true`, `critique: null`; it may carry `openOwn`, the seat's own held objections, which stand in the pass)  -> heard
 *   an abstained / unheard verdict (`abstained: true`, `critique: null`)  -> not heard
 *   a carried verdict (`carried: true`: a no-revise re-ask reused it)  -> not heard
 * Returns the seat keys; `keyOf` maps a verdict to its seat key.
 */
export const heardSeats = (verdicts, keyOf) => (verdicts || []).filter(v => !v.carried && !v.abstained && (v.critique || v.passed === true)).map(keyOf);

/** Q-i (C&C): the escalation lasts ONE pass for a stall; the person's send-up (legacy, a recorded choice of an older run) keeps the lifetime it was built with; M1 COMPLETE U2 (T4c) adds the automatic sibling trigger 'layer1_bound' to this switch instead. 0.8.4 S7 (C&C grant H-S7-a): the layer-2 bound go-up lasts ONE pass too (his 29 Okt words: layer 1 is never parked behind an upper-layer loop). */
export const escalationLastsOnePass = trigger => trigger === 'stall' || trigger === 'layer2_bound' || trigger === 'layer1_bound';   // M1 COMPLETE U2 (T4c): the AUTOMATIC go-up at layer 1's bound lasts one pass too (layer 1 is never parked); the legacy 'send_up' keeps the lifetime it was built with
