// Row 16 of M5 (0.8.3 M5f): the record's schema (src/tree-transitions.js EVENT_FIELDS / EVENT_OPTIONAL) validates an optional field only WHEN it is present, so a writer that stops writing one is silent. This audit
// lists, per event, the fields every PRODUCTION writer must have written, and returns the problems found in a record. Run it only on records the real writers produced (a fixture that appends by hand, or the
// `approvePending` helper, which records an approval without a gate, is not one). Not a test file.
const str = v => typeof v === 'string' && v.length > 0;
const sha = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const arr = v => Array.isArray(v);
/** K10 (C2a-record commit 5): WHO answered, on every gate-bound event a production writer records (the table requires it on a new event; this audit catches a writer that stops writing it). */
const who = { actor: v => v === 'person' || v === 'session', via: v => v === 'terminal' || v === 'elicitation' || v === 'mcp' };

/** event name -> (event, record) -> [field, ...] of the fields that are missing or malformed. */
export const PRESENCE = {
  node_registered: e => e.node === 'R' ? [] : bad(e, { bundleSha256: sha, bundleBytes: v => Number.isInteger(v) && v >= 1, dependsOn: arr, obligations: v => v && typeof v === 'object' }),
  node_closed: e => bad(e, { returnedUsd: v => Number.isFinite(v) && v >= 0, ...(e.outcome === 'incomplete' ? { gateId: str, shownSha256: sha, ...who, planCopy: v => v === null } : { thinContractSha256: sha, planCopy: v => v === null || v === 'plan-at-close.md' }) }),   // restore gap 2a: the audit copy is an EXPLICIT value on every writer (a person's incomplete close keeps no plan: null)
  guard_refused: e => bad(e, { origin: str }),
  frontier_previewed: e => bad(e, { boundSha256: sha }),
  // resolvedRefs (CR-2E-003, lane T G1): what each child's context_refs resolved to when the split was verified; a writer that drops it fails here
  split_verified: e => bad(e, { splitSha256: sha, children: arr, resolvedRefs: arr }),   // S8 held state: the child paths the verified block names; an absent list reads as unknown = never held, so a writer that drops it must turn this red
  decision_recorded: e => bad(e, { stopId: str, gateId: str, shownSha256: sha, ...who, form: v => v === 'regenerate' || v === 'milestone', ...(e.form === 'milestone' ? { node: str, generation: Number.isInteger, milestone: str } : {}) }),
  milestone_resolved: e => bad(e, { decisionId: str, remaining: v => Array.isArray(v) && v.every(x => typeof x === 'string'), ...(e.node === 'R' ? {} : { changesProvides: v => v === false }) }),
  tree_abandoned: e => bad(e, { gateId: str, shownSha256: sha, ...who }),   // ROADMAP 57: the typed gate of the abandon; written only by src/tree-abandon.js abandonTree (its form arrives in the next commit)
  node_closed_unstarted: e => bad(e, { stopId: str, gateId: str, shownSha256: sha, ...who }),
  bundle_input_allowed: e => bad(e, { stopId: str, gateId: str, shownSha256: sha, ...who, types: v => Array.isArray(v) && v.length > 0 }),   // T-b: the person's allowance for an unregistered child   // c3b: the close of a child never registered; no runId, $0
  needs_decision_opened: e => bad(e, { affected: arr, ...(e.source === 'person' ? { reason: str, gateId: str, shownSha256: sha, ...who } : {}), ...(e.source === 'bundle_input' ? { findings: v => arr(v) && v.length > 0, carriers: arr, parent: v => !!v && typeof v === 'object' && !Array.isArray(v), ...(e.node === 'R' ? { child: v => !!v && typeof v === 'object' } : {}) } : {}) }),   // S5b part B: the stop before a registration
  generation_opened: e => bad(e, { decisionId: str, nodes: v => arr(v) && v.length > 0 }),
  blocked: e => e.reason === 'parent_changed' ? bad(e, { frontierKey: str }) : e.reason === 'root_affected' ? bad(e, { stopId: str }) : e.reason === 'pii_mode_mismatch' ? bad(e, { transition: str, check: str, detail: str }) : [],
  limit_raised: e => bad(e, { gateId: str, shownSha256: sha, ...who }),
  cap_amended: e => bad(e, { gateId: str, shownSha256: sha, ...who, expectedRevision: v => Number.isInteger(v) && v >= 1 }),   // budget commit 1: a person's new total; written only by src/tree-budget.js amendCap
  chain_limits_amended: e => bad(e, { gateId: str, shownSha256: sha, ...who, fromSha256: sha, toSha256: sha, limitFreeSha256: sha, fromLimits: arr, toLimits: arr }),   // 0.8.3: a person's accepted change of a seat's own price limit; written only by src/tree-chain-limits.js amendChainLimits
  accounting_accepted: e => bad(e, { gateId: str, shownSha256: sha, ...who, covers: v => arr(v) && v.length > 0 }),
  stop_restored: e => bad(e, { actor: v => v === 'sitting', stopId: str, runId: str, deliveredBodySha256: sha, observedBodySha256: sha, providerPins: v => v === undefined || (arr(v) && v.length > 0 && v.every(p => p && typeof p.node === 'string' && Number.isInteger(p.generation) && sha(p.boundThinContractSha256) && sha(p.observedThinContractSha256))) }),   // restore gap (gate page 10.2): the system's answer; a dependent's carries the provider pins it re-read (a stop that names provider_pin is checked in test/tree-restore.test.js)
  plan_accepted: e => bad(e, { actor: v => v === 'session' || v === 'person', stopId: str, runId: str, previousBodySha256: sha, acceptedBodySha256: sha, scan: v => !!v && typeof v === 'object' && Number.isInteger(v.keyFindings), ...(e.actor === 'session' ? { via: str, reason: str } : { via: str, gateId: str, shownSha256: sha }) }),   // 2b: written only by src/tree-accept.js acceptChangedPlan; the actor decides which fields must stand beside it
  grant_issued: e => bad(e, { gateId: str, shownSha256: sha, ...who }),   // K10: a top-up is a gate-bound answer too (it was not audited before)
  held_released: e => bad(e, { reason: str, nodes: arr }),   // S8-5: the loop's writer of exit X2 of the held state (src/tree-loop.js releaseHeldIfNoChildren)
  integration_recorded: e => bad(e, { gateId: str, shownSha256: sha, ...who, bound: v => !!v && typeof v === 'object' && !Array.isArray(v) }),   // M6 S2: a result counts only when complete
};
function bad(e, rules) { return Object.entries(rules).filter(([k, ok]) => !ok(e[k])).map(([k]) => k); }

/** The frontier_approved gate fields (only for a record whose approvals the real `tree approve` wrote), and the preview children's refusal keys. */
export function presenceProblems(events, { realApprovals = false } = {}) {
  const out = [];
  for (const e of events) {
    const missing = [...(PRESENCE[e.event]?.(e) ?? [])];
    if (e.event === 'frontier_approved') missing.push(...bad(e, realApprovals ? { boundSha256: sha, gateId: str, shownSha256: sha, ...who } : { gateId: str, shownSha256: sha, ...who }));   // R3: the gate fields on every approval; the hash too for the ones the real verb wrote
    if (e.event === 'frontier_previewed' && e.kind !== 'root_replan') for (const c of e.children) {
      if (c.admitted === false && !c.limit && c.refusedBy !== 'budget' && c.refusedBy !== 'stale' && c.refusedBy !== 'closed_unstarted') missing.push(`children[${c.node}].limit|refusedBy`);
      for (const k of ['scopeSha256', 'heldSha256']) if (!sha(c[k])) missing.push(`children[${c.node}].${k}`);
    }
    if (missing.length) out.push(`${e.event}${e.node ? ` ${e.node}` : ''} (#${e.id ?? e.seq ?? '?'}): ${missing.join(', ')}`);
  }
  return out;
}
