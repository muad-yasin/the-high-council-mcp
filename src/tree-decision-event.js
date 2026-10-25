// The `decision_recorded` event of a stop decision, in ONE module (0.8.3 SG-1 unit): the apply of src/tree-decide-stop.js writes it from these functions, and the what-if size check (src/tree-decide-size.js) builds the event it asks about from the SAME functions, so the two cannot drift.
/**
 * The fields of a stop decision's `decision_recorded` event, in ONE place: the apply in src/tree-decide-stop.js writes them, and the what-if size check (src/tree-decide-size.js) builds the event it asks about from the SAME function, with placeholder gate fields (the
 * derivation never reads them). `regenerateDecisionEvent` adds the earlier-plan choice, as the apply does.
 */
export const stopDecisionBase = ({ decisionText, affected, form, stop, covers = [], gateId, shownSha256, actor, via, reason, planMode, obligation }) => ({ text: decisionText, affected: form === 'milestone' ? [] : affected, form, stopId: stop.id, ...(form === 'milestone' && covers.length ? { covers: covers.map(c => c.id) } : {}), gateId, shownSha256, actor, via, ...(reason ? { reason } : {}), ...(planMode ? { planMode } : {}), ...(obligation ? { obligation } : {}) });
export const regenerateDecisionEvent = (decisionArgs, oldChoice) => ({ event: 'decision_recorded', ...stopDecisionBase(decisionArgs), ...(oldChoice ? { oldPlan: oldChoice.oldPlan } : {}) });
