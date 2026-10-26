// The tree's events and the order they may come in (0.8.3 M1; PLAN 4.3 and the transition table of 8.5). Pure and $0: it reads a list of events and answers; it writes nothing.
//
// `events.jsonl` is the tree's one record. This module is the table of PLAN 8.5 as code, so the builder does not invent an order and a transition the table does not list is REFUSED (exit 19 at the CLI, with a
// `blocked` record naming it). It also folds the record into the state everything else asks about: which nodes exist, which one is ACTIVE (PLAN 8.1), which stops are open, which tree-wide blocks are sticky.
//
// Active (PLAN 8.1): a node is active from its `node_registered`, or from a later `node_resumed`, until its run ends (`node_closed`) or stops at its cap (`node_stopped`), or, for a post-run paid call,
// until its `node_released`. A paused node (waiting for an external seat) is still active; a budget-stopped node is not. At most one node is active at any time.
//
// What it does NOT check, on purpose: money (admission, grants, the lifetime cap: M2), the signed split and the gate behind an approval (M3, M5), readiness (M6). Where the table names a precondition that
// needs one of those, the caller checks it and this module checks only what the record itself can say.
import { hostname } from 'node:os';
import { createHash } from 'node:crypto';
import { isPidAlive } from './run-lock.js';
import { RUN_FOLDER } from './run-status.js';

export const EVENTS_SCHEMA = 'tree-events/1';

const PII_ALLOW_TYPES = Object.freeze(['email', 'iban', 'card']);   // the fixed words of src/pii-gate.js PII_TYPES minus `secret`: a tree takes no override of the key scan (this table imports nothing from the gate)
const isStr = v => typeof v === 'string' && v.length > 0;
// bundle unit step 2: the choice about the earlier plan (src/old-plan.js): { form: 'fresh' } or { form: 'data', sha256, bytes, node? } (`node`: the slot path whose new plan receives it, sub-plan route); `secret` is never an allowance
const isOldPlanChoice = v => v !== null && typeof v === 'object' && !Array.isArray(v) && (v.form === 'fresh' ? Object.keys(v).length === 1 : v.form === 'data' && Object.keys(v).sort().join().replace(',node', '') === 'bytes,form,sha256' && (v.node === undefined || isNodePath(v.node)) && /^[0-9a-f]{64}$/.test(v.sha256) && Number.isInteger(v.bytes) && v.bytes >= 0);
const isGen = v => Number.isInteger(v) && v >= 1;
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// A node path is the root `R` and milestone ids below it (a letter first, then letters, digits, `_` or `-`): no `.`, no `..`, no empty segment, since M4 names a folder after it.
export const isNodePath = v => typeof v === 'string' && /^R(\/[A-Za-z][A-Za-z0-9_-]*)*$/.test(v);
const isSha = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
/** K8: the shape of `reused` on a preview child (C2a_Gate_Page.md section 3, confirmed unchanged): the slot is the child itself, `adoptsNode`/`adoptsGeneration`/`runId` name the candidate it adopts, `fieldsSha256` the hash of the compared fields, `identityMap` how the adopted subtree's paths map. */
const validReused = r => isObj(r) && isNodePath(r.adoptsNode) && isGen(r.adoptsGeneration) && isStr(r.runId) && isStr(r.fieldsSha256) && (isObj(r.identityMap) || Array.isArray(r.identityMap));
const nodeFields = { node: isNodePath, generation: isGen };
const runFields = { ...nodeFields, runId: isStr };
const claimFields = { ...runFields, pid: v => Number.isInteger(v) && v > 0, host: isStr };

/**
 * Every event the record may hold, with the fields it MUST carry (a predicate per field). Fields beyond these are allowed: the record is open to additions, like report.json. M1 writes and reads the node and tree
 * events; the rest are shaped here so the reader can validate a whole file, and each is tightened by the milestone that first writes it (said at the event).
 */
export const EVENT_FIELDS = Object.freeze({
  tree_started: { treeId: isStr, treeJsonSha256: isStr },
  split_verified: { ...runFields, splitSha256: isStr },                                    // M3 writes it
  frontier_previewed: { frontierKey: isStr, parentNode: v => v === null || isNodePath(v), parentGeneration: v => v === null || isGen(v), parentRunId: v => v === null || isStr(v), splitSha256: v => v === null || isStr(v), children: v => Array.isArray(v) && v.length > 0 && v.every(c => isObj(c) && isNodePath(c.node) && isGen(c.generation) && (c.reused === undefined || validReused(c.reused))) },
  frontier_approved: { frontierKey: isStr, revision: v => Number.isInteger(v) && v >= 1 },  // M5 adds gateId and shownSha256 (the gate)
  // The member inventory is the set of these events (PLAN 4.3). M1 requires what identity, recovery and the transition table read; M4 and M5 add the derived inputs (bundle, obligation map, dependsOn) when they exist.
  node_registered: { ...runFields, attempt: isGen, depth: v => Number.isInteger(v) && v >= 0, parentNode: v => v === null || isNodePath(v), frontierKey: v => v === null || isStr(v), chain: v => isObj(v) && isStr(v.name) && isStr(v.sha256), grant: v => isObj(v) && Number.isFinite(v.amount) && v.amount > 0 && v.unit === 'usd' },
  node_started: claimFields,
  node_stopped: { ...runFields, reason: isStr },
  node_resumed: { ...claimFields, purpose: v => v === 'resume' || v === 'post_run' },
  // 0.8.3 member verb (gate note Member_Verb_Gate_Note.md + Member_Verb_Delta_Addendum.md, C&C 15/16 Okt 2026): the person's CHOICE for a member stopped at its overseer limit (`council tree decide <root> --continue-node|--finish-node <node>`).
  // The node stays `running` (no new phase: the seven readers of phase `stopped` never see it). CONSUMED IS DERIVED, never recorded: the choice is pending until the member's run.json holds a roundChoices entry for `stop` (the consumer reads it).
  node_choice: { ...runFields, choice: v => v === 'continue' || v === 'finish' || v === 'prevail', stop: isStr },       // 'prevail' (the conflict verb, `--prevail-node`) also carries `picks` (EVENT_OPTIONAL)
  node_released: { ...runFields, reason: isStr },
  node_closed: { ...runFields, outcome: isStr, share: v => v === 'released' || v === 'revoked' },  // M2 adds the amount returned to the pool
  // S5b part B, c3b (C&C Q1 revised): the close of a child that was NEVER REGISTERED. Its own event, so that `node_closed` keeps one invariant - every close has a run - and none of its readers ever sees a run-less one. $0, no runId: there is
  // no run, no grant and no folder. It answers the open `bundle_input` stop it names, in the same event (the same lock hold), and it carries the gate whose approval the person's typed word spent.
  node_closed_unstarted: { ...nodeFields, stopId: isStr, gateId: isStr, shownSha256: isStr },
  // 0.8.3 PII stop unit, T-b (owner 19 Okt 2026: the person chooses to continue AFTER SEEING): the person's allowance for ONE child whose derived input holds personal data, answering the open `bundle_input` stop it names in the same event.
  // Bound to the node, the generation, the stop and the TYPES the stop found (never more). No run, no money. The registration check and the child's own scan read it from here (state.piiAllowed), never from a flag: a member still takes no --allow-pii.
  price_answered: { node: isNodePath, generation: isGen, runId: isStr, model: v => isStr(v) && /^[a-z0-9_-]+\/\S+$/i.test(v) && v.length <= 200, inUsdPerM: v => isPrice(v), outUsdPerM: v => isPrice(v), before: v => v === 'none' || (isObj(v) && isPrice(v.in) && isPrice(v.out)), after: v => isObj(v) && isPrice(v.in) && isPrice(v.out), source: v => isStr(v) && v.trim() !== '' && v.length <= 300, gateId: isStr, shownSha256: isStr },
  // GAP A (Muad 23 Okt 2026, option B; plan Review/Build_0.8.3/m8/C_GapA_Session_Draft_Plan_2026-10-23.md): the SESSION writes the new decision for an open stop of the ROOT as a draft. It decides nothing, spends nothing and answers nothing: the person approves it at the terminal (`decision_recorded` with `fromSessionDraft`). `sha256` is the text's hash; the newest draft of a stop is the only one offered.
  stop_draft_written: { stopId: isStr, text: isStr, reason: isStr, sha256: isSha },
  // GAP A, Muad's answer 23 Okt 2026 ("the user then approves or say's if he wants something specific to be changed"): the PERSON's request, typed at the terminal on the screen that shows a draft, for the session to write a newer draft. It decides nothing. The draft stays approvable; a newer draft supersedes the request.
  stop_draft_change_asked: { stopId: isStr, draftId: isStr, text: isStr },
  stop_deferred: { stopId: isStr, conditions: v => Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every(c => DEFER_CODES.includes(c)), reason: isStr },
  bundle_input_allowed: { ...nodeFields, stopId: isStr, gateId: isStr, shownSha256: isStr, types: v => Array.isArray(v) && v.length > 0 && v.length <= PII_ALLOW_TYPES.length && new Set(v).size === v.length && v.every(t => PII_ALLOW_TYPES.includes(t)) },
  // Restore gap (0.8.3 M6, gate page sections 3 and 8; Astra #16-#18): the SITTING closes a `blocked`-source stop whose cause was an unreadable report.json when the files on disk are, byte for byte, what the run produced - the body hashes to the
  // sha256 the tree RECORDED at the node's close. A system record, never a person's decision (`actor: 'sitting'`): the record says WHO answered. It answers exactly the one stop it names and moves no money.
  stop_restored: { ...runFields, stopId: isStr, actor: v => v === 'sitting', deliveredBodySha256: isSha, observedBodySha256: isSha },
  // 0.8.3 M6 2b (gate page section 12; C&C 14 Oct 2026, packet-3 answer 4): a CHANGED plan file is ACCEPTED by a person or the session, never by the sitting (the table refuses actor 'sitting' with its own reason). It answers exactly the one stop
  // it names, moves the node's record-held body hash from `previousBodySha256` to `acceptedBodySha256` (the fold keeps both in `bodyHistory`), and is the ONLY thing that makes a body readable that report.json's own hash does not describe.
  // Written by ONE function (src/tree-accept.js acceptChangedPlan), which computes every hash and scan count itself. No money moves. `revert: true` = the accepted bytes are replaced by the bytes the panel signed (authority back to null).
  plan_accepted: { ...runFields, stopId: isStr, actor: v => PLAN_ACCEPT_ACTORS.includes(v), previousBodySha256: isSha, acceptedBodySha256: isSha, splitSha256: v => v === null || isSha(v), scan: v => isObj(v) && Number.isInteger(v.keyFindings) && v.keyFindings >= 0 && (v.piiFindings === null || (Number.isInteger(v.piiFindings) && v.piiFindings >= 0)) && (v.piiWarned === undefined || (Number.isInteger(v.piiWarned) && v.piiWarned >= 0)) },
  // 0.8.3 M6 REBUILD (gate page section 14, C&C PASS ON CONDITIONS 14 Oct 2026; Muad: the not-started sub-plan's input is rebuilt from the accepted text before it starts): the input bundle of a node that is REGISTERED AND NOT STARTED is replaced because a plan it quotes changed its
  // body (an accept or a revert of its parent or of a provider it depends on) after the bundle was built. Written by ONE function (src/tree-rebuild.js), by the sitting, after the new files are on disk. It carries no grant, chain, obligation or dependsOn: none of them can change here. `because` = the
  // newest body-changing plan_accepted of each node the bundle quotes (src/tree-transitions.js bodyEventsNewerThanBuild); previous and new hash may be EQUAL (accept then revert: the text is back, the event records that the bundle was checked against the newest body).
  node_bundle_rebuilt: { ...runFields, previousBundleSha256: isSha, bundleSha256: isSha, bundleBytes: v => Number.isInteger(v) && v >= 1, because: v => Array.isArray(v) && v.length >= 1 && v.every(b => b && isNodePath(b.node) && isGen(b.generation) && isStr(b.eventId) && isSha(b.acceptedBodySha256)), builtFrom: v => Array.isArray(v) && v.length >= 1 && v.every(b => b && isNodePath(b.node) && isGen(b.generation) && (b.eventId === null || isStr(b.eventId))) },
  // ROADMAP 57: a person ends the whole tree for good (`council tree decide <root> --abandon`). Its own event, written by ONE function (src/tree-abandon.js abandonTree) after the typed gate; no reason text, no snapshot: everything the
  // views say is derived from the record (state.abandoned, below).
  tree_abandoned: { gateId: isStr, shownSha256: isStr },
  grant_issued: { ...nodeFields, amount: v => Number.isFinite(v) && v > 0, unit: v => v === 'usd' },
  guard_refused: { ...nodeFields, item: isStr, guard: isStr },                              // M4
  blocked: { reason: v => BLOCKED_REASONS.includes(v), scope: isStr },                      // scope: 'tree', or the node key (`R/M2@g1`) for a refusal about one node
  needs_decision_opened: { source: isStr },                                                 // M5
  decision_recorded: { text: isStr, affected: v => Array.isArray(v) },                      // M5d: + stopId, gateId, shownSha256, form (see EVENT_OPTIONAL)
  generation_opened: { decisionId: isStr, nodes: v => Array.isArray(v) },
  milestone_resolved: { ...nodeFields, milestone: isStr },                                  // M5 (+ changesProvides, EVENT_OPTIONAL)
  integration_recorded: { agreement: isStr, result: v => v === 'pass' || v === 'fail' },    // M6 S2: the qualified id of the target and exactly pass or fail (+ gateId, shownSha256, bound: EVENT_OPTIONAL)
  // S8 held state (contract M6_HeldState_Contract_2026-10-12.md section 5, exit X2): the held children of a replaced root plan are PASSED OVER (K2: kept, not dead) because the new root plan has no children to adopt them
  held_released: { reason: v => v === 'no_children' || v === 'no_split', nodes: v => Array.isArray(v) && v.every(isStr) },
  limit_raised: { limit: isStr, from: Number.isInteger, to: Number.isInteger },             // M5 adds shownSha256
  // gate page 5 (budget commit 1): a person's NEW TOTAL for the whole tree. `expectedRevision` = the number of earlier cap_amended events + 1 as the person read it; the gate fields are required (a bare record is not an amendment).
  cap_amended: { fromCapUsd: v => Number.isFinite(v) && v > 0, toCapUsd: v => Number.isFinite(v) && v > 0, expectedRevision: v => Number.isInteger(v) && v >= 1, gateId: isStr, shownSha256: v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) },
  // 0.8.3 (Muad 23 Okt 2026, "2: ii"): a person accepts a changed PRICE LIMIT (a seat's own provider.max_price prompt/completion) in a chain file the tree pinned. Written by ONE function (src/tree-chain-limits.js amendChainLimits) after the typed gate, under
  // the tree lock, once it has re-read the file: `fromSha256` is the hash the tree accepted, `toSha256` the file's hash now, `limitFreeSha256` the hash of the file without its limits (equal in both: nothing else differs), `fromLimits`/`toLimits` the
  // limits snapshots (src/price-limits.js). Moves no money and no grant; it makes the tree accept the new file (readTreeRecord lays it over tree.chains). Person-only (ANSWERED_BY, answeredByRefusal below).
  chain_limits_amended: { chain: isStr, fromSha256: isSha, toSha256: isSha, limitFreeSha256: isSha, fromLimits: v => Array.isArray(v), toLimits: v => Array.isArray(v), gateId: isStr, shownSha256: isSha },
  accounting_accepted: { reservationIds: v => Array.isArray(v) && v.length > 0 && v.every(isStr) },   // M2: `<run id>:<reservation id>` keys (ids repeat across runs)
  // M2 (PLAN 7.2 item 6): a copy of one line of a member's own spend-reservations.jsonl, written with it. `line` is that line object, byte for byte (its `at` included), so the gate can tell the two files agree.
  reservation_mirrored: { runId: isStr, node: isNodePath, generation: isGen, line: v => isObj(v) && isStr(v.id) && (v.event === 'reserved' || v.event === 'settled') },
  // ROADMAP 77 (the paid repair recommendation, step 1: the GRANT; plan note Review/Build_0.8.3/m7/Roadmap77_Paid_Repair_Plan_Note_2026-10-20.md section 10). A recommendation is a side request, NOT a node: it is never in `state.nodes`, never counts toward maxRuns,
  // and its money rows live apart (adviceMoneyOf, src/tree-budget.js). `advice_registered` is the HOLD (the grant, inside the tree's typed cap; answered by the session or the person, C&C ruling 20 Okt: the session answers ONLY this grant, the person approves the brief);
  // `expiresAtMs` bounds the wait for that approval (the hold waits on a person, so a live pid cannot be its only release). One request is ONE grant over up to two runs (the first and one re-ask: the re-ask is a second folder).
  advice_registered: { adviceId: isStr, grantUsd: v => isPrice(v), purpose: v => v === 'recommendation', stopId: isStr, gateId: isStr, shownSha256: isSha, pid: v => Number.isInteger(v) && v > 0, host: isStr, expiresAtMs: v => Number.isFinite(v) && v > 0 },
  advice_run_added: { adviceId: isStr, runId: isStr, kind: v => v === 'first' || v === 'reask', briefSha256: isSha, shownSha256: isSha },
  advice_ended: { adviceId: isStr, reason: v => ADVICE_END_REASONS.includes(v), returnedUsd: v => isUsd(v) },
  // a copy of one line of an advice run's own spend-reservations.jsonl (the sibling of `reservation_mirrored`, whose `node` field stays a node path): the gate feeds both into one run-id map
  advice_reservation_mirrored: { adviceId: isStr, runId: isStr, line: v => isObj(v) && isStr(v.id) && (v.event === 'reserved' || v.event === 'settled') },
  readiness: { verdict: v => v === 'ready' || v === 'incomplete' || v === 'blocked', reasons: v => Array.isArray(v) && v.every(r => isObj(r) && isStr(r.severity) && isStr(r.code) && isStr(r.scope) && isStr(r.text)), inputs: isObj },   // M6 S3: the verdict, the reasons behind it and what it rests on (src/tree-readiness.js)
});
/** The named condition codes a deferral may carry (6d): the record can show them; "the agent thinks it matters" is not one. */
/** How a recommendation request ends (ROADMAP 77): settled (the calls were made and paid for), declined (the person declined the brief), never_started (no run was added), expired (the brief approval did not come in time), crashed (a dead claim), stopped (a guard refused after yes). */
export const ADVICE_END_REASONS = Object.freeze(['settled', 'declined', 'never_started', 'expired', 'crashed', 'stopped']);
export const DEFER_CODES = Object.freeze(['over_available', 'key_scan_finding', 'pii_finding', 'accounting_gate_fails', 'person_only_form', 'plan_unclear']);
export const EVENT_NAMES = Object.freeze(Object.keys(EVENT_FIELDS));
const isPrice = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isUsd = v => Number.isFinite(v) && v >= 0;
export const PLAN_ACCEPT_ACTORS = Object.freeze(['sitting', 'session', 'person']);      // 'sitting' is shaped here so the TABLE can refuse it with its own sentence (a hand-written line must not read as unknown)
// K10 (C2a-record commit 5; plan Review/Build_0.8.3/m7/C2a_Commit5_K10_Plan_2026-10-18.md): WHO answered a gate-bound event. `actor` is person or session, `via` the channel (a person: terminal or elicitation; the session: mcp), `reason` the session's written reason. Optional in the SHAPE, so a record from before the field still reads (as 'unknown (before the field)', never as a person); REQUIRED on a new event by answeredByRefusal, below.
export const ANSWER_VIAS = Object.freeze({ person: Object.freeze(['terminal', 'elicitation']), session: Object.freeze(['mcp']) });
const ANSWERED_BY = Object.freeze({ actor: v => v === 'person' || v === 'session', via: v => v === 'terminal' || v === 'elicitation' || v === 'mcp', reason: isStr });
/**
 * Fields an event MAY carry; when present they must be well formed. The record is open to other additions, but these are read by code, so a malformed one is a corrupt record.
 *   boundSha256   what an approval binds (children, grants and ceilings, the grant formula). Valid-when-equal is checked by approvalValid(). Optional only for M1/M2 fixtures: M5 makes it REQUIRED on
 *                 every frontier_previewed / frontier_approved it writes, and once ANY preview of a frontier carries one an approval without one is invalid (fail closed).
 *   capUsd, lifetimeCapUsd, capAskedUsd   on a claim: the cap the run was held to, the PLAN 7.4 lifetime cap, and what the caller asked for, so the cap is observable in the record.
 *   returnedUsd   on node_closed: the grant (first grant plus top-ups) minus runSpentUsd at close, which counts unsettled reservations at their worst case: the figure the cap uses.
 *   affected      on needs_decision_opened: the nodes the stop puts in question; the fold marks them stale (provisional: M5 owns the release rule, PLAN 8.4).
 *   check         on blocked: which continuation check failed (PLAN 7.6 step 2).
 */
export const EVENT_OPTIONAL = Object.freeze({
  // member verb, the conflict ask: `--prevail-node` records choice 'prevail' with one pick per conflict the decider asked about: [{ n, prevail: <objection id> | 'neither' }]
  node_choice: { picks: v => Array.isArray(v) && v.length > 0 && v.every(p => p && typeof p === 'object' && Number.isInteger(p.n) && typeof p.prevail === 'string' && p.prevail !== '') },
  // S8 held state: the child paths the verified block names (see src/tree-expansion.js verifySplit); absent in a record written before it, which reads as 'unknown' (a node whose children are unknown is never held)
  // resolvedRefs (CR-2E-003, C&C 25 Okt 2026): what each child's context_refs resolved to when the split was verified, { child, sha256 } in the block's order (src/tree-expansion.js verifySplit); absent on a split verified before 0.8.3's reference check
  split_verified: { children: v => Array.isArray(v) && v.every(isNodePath), resolvedRefs: v => Array.isArray(v) && v.every(x => isObj(x) && isStr(x.child) && isSha(x.sha256)) },
  // S8 (the root re-plan, rulings row 130): `kind` is 'split' when absent (every record before S8); a 'root_replan' frontier has NO parent (the four parent fields are null) and names the decision that opened it (`openedBy`)
  // K8 (C2a-record commit 4): `candidates` = the kept candidates' fates beside the children ([{ key, fate, reason }]); optional, inside boundSha256 once C2b's writer emits it
  frontier_previewed: { boundSha256: isStr, kind: v => v === 'split' || v === 'root_replan', openedBy: isStr, candidates: v => Array.isArray(v) && v.every(c => isObj(c) && isStr(c.key) && isStr(c.fate) && isStr(c.reason)) },       // C3: `reason` holds a fate CODE (same, scope, acceptance, branch_not_whole, slot_filled, no_slot, not_compared, ...), never words; the words are built from it at print time
  frontier_approved: { boundSha256: isStr, gateId: isStr, shownSha256: isStr, sessionConditions: v => isObj(v), ...ANSWERED_BY },   // gateId + shownSha256 (M5): the gate whose approval this spends and the hash of the text the person was shown
  node_started: { capUsd: isUsd, lifetimeCapUsd: isUsd, capAskedUsd: v => v === null || isUsd(v) },
  node_resumed: { capUsd: isUsd, lifetimeCapUsd: isUsd, capAskedUsd: v => v === null || isUsd(v) },
  node_closed: { ...ANSWERED_BY, returnedUsd: isUsd, thinContractSha256: isStr, gateId: isStr, shownSha256: isStr, deliveredBodySha256: v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v), planCopy: v => v === null || v === 'plan-at-close.md', copyFailed: isStr },   // planCopy (restore gap 2a, C&C ruling 9.5/3): the audit copy of the accepted plan kept in the run folder BEFORE this line, or an explicit null (no plan to keep); copyFailed = why a copy could not be written (a disclosed degradation: the diff cannot be shown later); thinContractSha256 (M4): the run's thin-contract pin, written by the member's end hook; deliveredBodySha256 (entry 3, 14 Oct 2026): the sha256 of the delivered body, recorded only when deliverable.md hashed to it at the close (absent on older closures)
  // PLAN 8.4: for a stopped CHILD the person states whether the answer changes anything the node provides to a sibling; only "no" resolves in place (false); "yes" is the regenerate form. The root provides to no sibling: no field.
  milestone_resolved: { decisionId: isStr, changesProvides: v => typeof v === 'boolean', remaining: v => Array.isArray(v) && v.every(isStr) },                         // M4: the decision_recorded whose text resolved the milestone (M5 writes it; one source of truth for the text)
  guard_refused: { origin: isStr },
  plan_accepted: { via: ANSWERED_BY.via, reason: isStr, gateId: isStr, shownSha256: isSha, thinContractSha256: isStr, revert: v => typeof v === 'boolean', rechecked: v => Array.isArray(v) && v.length === 1 && v[0] === 'derivation_refused' },   // rechecked: Astra (c), the writer re-derived the refused children against the accepted bytes and every one returned
  stop_restored: { rechecked: v => Array.isArray(v) && v.length > 0 && v.every(c => RECHECKED_BY_SITTING.includes(c)) && new Set(v).size === v.length, thinContractSha256: isStr, contractExit: v => v === 0, providerPins: v => Array.isArray(v) && v.length > 0 && v.every(p => isObj(p) && isNodePath(p.node) && isGen(p.generation) && isSha(p.boundThinContractSha256) && isSha(p.observedThinContractSha256)) },   // the closure's thin-contract pin the snapshot was compared to (present only when the closure held one)
  // M6 S2 (design note 1.5): a result COUNTS only when complete - the gate whose approval authorized it, the hash of the text read, and `bound` (the versions it was recorded against, built by ONE function, bindingOf in
  // src/tree-ready.js). Like grant_issued they are optional in the SHAPE (a bare event is well formed and is ignored by the reader, S1's bare-pass test), and required to count.
  integration_recorded: { gateId: isStr, shownSha256: isStr, bound: isObj, ...ANSWERED_BY },
  // answer 1 (rulings, 12 Oct): an acceptance for a member whose report.json cannot be read records the figure it was made from and the files it read: [{ runId, figureUsd, files: [{ name, sha256 }] }]
  accounting_accepted: { unreadableReports: v => Array.isArray(v) && v.length > 0 && v.every(u => isObj(u) && isStr(u.runId) && Number.isFinite(u.figureUsd) && u.figureUsd >= 0 && Array.isArray(u.files) && u.files.length > 0 && u.files.every(f => isObj(f) && isStr(f.name) && isStr(f.sha256))), gateId: isStr, shownSha256: isStr, covers: v => Array.isArray(v) && v.every(c => isObj(c) && isStr(c.code) && Array.isArray(c.keys) && isStr(c.detailSha256)), ...ANSWERED_BY },   // M5d: the problems it covers as they read then
  // M5d (PLAN 8.4, 8.5): a decision names the stop it answers and the gate whose approval authorized it. `form` is 'regenerate' (the stop is answered by this event, a new generation follows) or 'milestone' (resolve in place:
  // the stop stays open until the milestone_resolved that names this decision; node/generation/milestone say which milestone). `obligation` is the qualified identity the person said the stop is about (recorded only).
  // `covers` (M5e S5, C&C Q2): a ROOT milestone resolution answers EVERY open stop of the root in one bound decision: stopId is the primary, covers the others (all stops of the same node)
  decision_recorded: { ...ANSWERED_BY, replansRoot: v => v === true, covers: v => Array.isArray(v) && v.every(isStr), stopId: isStr, gateId: isStr, shownSha256: isStr, form: v => v === 'regenerate' || v === 'milestone' || v === 'keep', planMode: v => v === 'fresh' || v === 'data', obligation: isStr, node: isNodePath, generation: isGen, milestone: isStr, oldPlan: v => isOldPlanChoice(v), allowanceBytes: v => Number.isInteger(v) && v > 0, fromRecommendation: v => isObj(v) && Number.isInteger(v.n) && v.n >= 1 && isStr(v.adviceId), fromSessionDraft: v => isObj(v) && isStr(v.draftId) },
  limit_raised: { shownSha256: isStr, gateId: isStr, ...ANSWERED_BY },
  // S8: a root generation >= 2 is registered through the admitted path with the run it replaces and the sha256 of the task bytes it was planned from
  node_registered: { replacesRunId: isStr, taskSha256: isStr, builtFrom: v => Array.isArray(v) && v.every(b => b && isNodePath(b.node) && isGen(b.generation) && (b.eventId === null || isStr(b.eventId))) },
  grant_issued: { shownSha256: isStr, gateId: isStr, ...ANSWERED_BY },             // M5d: the gate whose approval authorized the top-up and the hash of the text read: the hash of the stop text the person read, and the gate whose approval this spends
  // M5e S4: a ROOT stop opened by an obligation decision names the child stop it came from and the obligation (its origin label)
  // S5b part B (source 'bundle_input': a stop on a node that was never registered, its derived input holding text the key scan or the personal-data gate refuses): `findings` = [{ file, line, name }] (the shape's NAME, never the value),
  // `carriers` = the finished nodes whose text carries it (a list: a context part can hold several), `parent` = the closed node whose verified split names the child
  needs_decision_opened: { blockedBy: v => Array.isArray(v) && v.length > 0 && v.every(b => isObj(b) && isStr(b.code) && isStr(b.text)), originStopId: isStr, obligation: isStr, affected: v => Array.isArray(v) && v.every(a => isObj(a) && isNodePath(a.node) && isGen(a.generation)),
    findings: v => Array.isArray(v) && v.every(f => isObj(f) && isStr(f.file) && (isGen(f.line) || (f.line === null && String(f.name).startsWith('oversize:'))) && isStr(f.name)),
    carriers: v => Array.isArray(v) && v.every(c => isObj(c) && isNodePath(c.node) && isGen(c.generation)),
    parent: v => isObj(v) && isNodePath(v.node) && isGen(v.generation),
    child: v => isObj(v) && isNodePath(v.node) && isGen(v.generation),
    reason: isStr,       // S8-8: the words a person typed when they opened a stop on the root plan (source 'person'); recorded verbatim. K10: here `reason` keeps THAT meaning (a session never opens a person's stop); the row adds only who/how
    actor: ANSWERED_BY.actor, via: ANSWERED_BY.via },
  node_closed_unstarted: { ...ANSWERED_BY },
  bundle_input_allowed: { ...ANSWERED_BY },
  stop_deferred: { ...ANSWERED_BY },
  stop_draft_written: { ...ANSWERED_BY },
  stop_draft_change_asked: { ...ANSWERED_BY },
  price_answered: { ...ANSWERED_BY },
  tree_abandoned: { ...ANSWERED_BY },
  advice_registered: { ...ANSWERED_BY },
  cap_amended: { ...ANSWERED_BY },
  chain_limits_amended: { ...ANSWERED_BY },
  blocked: { check: isStr, detail: isStr, frontierKey: isStr, ancestor: isStr, stopId: isStr },   // frontierKey (M5c4): on parent_changed, the frontier whose approval it invalidates (see foldRecord)
});

/** null when `line` is a well-formed event, else why not. The reader calls this on every complete line of the committed prefix. */
export function eventShapeError(line) {
  if (!isObj(line)) return 'not a JSON object';
  if (line.schema !== EVENTS_SCHEMA) return `schema is ${JSON.stringify(line.schema)}, not ${EVENTS_SCHEMA}`;
  if (!isStr(line.id) || !/^e\d+$/.test(line.id)) return 'no event id (e<n>)';
  if (!Object.hasOwn(EVENT_FIELDS, line.event)) return `unknown event ${JSON.stringify(line.event)}`;
  if (!isStr(line.at) || Number.isNaN(Date.parse(line.at))) return 'no time (at)';
  for (const [field, ok] of Object.entries(EVENT_FIELDS[line.event])) if (!ok(line[field])) return `${line.event}: field "${field}" is missing or malformed`;
  for (const [field, ok] of Object.entries(EVENT_OPTIONAL[line.event] || {})) if (line[field] !== undefined && !ok(line[field])) return `${line.event}: field "${field}" is malformed`;
  return null;
}

// `blocked` has two kinds of use, and mixing them would let one stray resume freeze a tree. A STATE reason says the tree itself cannot go on until a person acts: it stays in force, tree-wide (the four states PLAN 12
// rows 3 and 7, 4.3 and 8.4 name). Anything else is a record of one refused request and changes nothing (PLAN 8.5, last paragraph). Who clears a state reason: `accounting_accepted` clears accounting_blocked; the
// milestones that write the others (M5) say how theirs clear. The reasons are a CLOSED list, checked with the rest of the committed prefix: an unknown reason is a corrupt record, never a new state.
// `stale` is a mark on a node, not a reason here. `scope` says what a blocked event is about: 'tree', or the node key for a refusal about one node (so PLAN 7.6 step 2 can be computed from the record).
// `accounting_blocked` is DERIVED, not stored (M2): the tree is accounting_blocked exactly while the gate (src/tree-budget.js gateTree) fails, because PLAN 7.2 lets a person lift it by "restoring the missing record",
// and no event could say that. Every start, resume, admission and top-up runs the gate under the tree lock; a refusal writes a `blocked` RECORD with this reason, and a restored record simply passes the next gate.
// `record_corrupt` is derived the same way (the file does not read) and is listed here because it also stops every writer.
export const STICKY_REASONS = Object.freeze(['record_corrupt', 'parent_changed', 'root_affected']);
export const RECORD_REASONS = Object.freeze(['transition_refused', 'continuation_refused', 'expansion_refused', 'accounting_blocked', 'pii_mode_mismatch']);   // continuation_refused: PLAN 7.6 steps 2-5; expansion_refused: PLAN 5.5 (M3); pii_mode_mismatch: S5b, a member started under another personal-data mode than the tree's (src/tree-member.js)
// The readiness codes a restored file can close (gate page sections 8 and 9.2; C&C rulings 9.1-9.3, 14 Oct 2026): an unreadable report.json, an unreadable plan (the same body-hash test), and a provider pin that the re-read shows equal to
// what the dependent registered against (providerPins). NOT split_unreadable: a body that hashes to the recorded one parses its fence the same way, so that code could never legitimately close.
// D2 F4c (Q2, Muad 25 Okt 2026 14:45 "Yes to all"; Astra's Q2): every code a stop may close by the SITTING's own live test, each with its own test (src/tree-restore.js restoreDecision): the body hash (report_unreadable, plan_unreadable,
// split_changed: with the recorded body back the block is the verified one), the providers' pins (provider_pin), the sitting's re-run of the contract check exiting 0 (contract_check, now also alone: the task, context and
// HANDOFF files are read live, so a file put back changes the check), a split_verified on record (expansion_refused: the table checks that itself), the live re-derivation RETURNING (derivation_refused, the event carries
// `rechecked`). Every other code is the run's own output or a person's act and has no close test.
export const RESTORABLE_CODES = Object.freeze(['report_unreadable', 'plan_unreadable', 'provider_pin', 'split_changed', 'contract_check', 'expansion_refused', 'derivation_refused']);
/** The codes a stop_restored records as re-checked by the sitting live, where the table cannot repeat the test (D2 F4c: the sitting's evidence, as contractExit is for contract_check). */
export const RECHECKED_BY_SITTING = Object.freeze(['derivation_refused']);
/** The codes a stop may hold when a person or the session ACCEPTS a changed plan file (gate page 12): the plan no longer reads against report.json's hash (plan_unreadable), and an edited sealed file also fails `contract check` (contract_check, 12.3b). Anything else is a different cause. */
export const PLAN_ACCEPT_CODES = Object.freeze(['plan_unreadable', 'contract_check']);
/** The ONE answer to "which body hash is accepted for this node@generation" (gate page 12.1): the hash a `plan_accepted` folded onto the node entry, or null (every node today: the readers then check report.json's own hash exactly as before). */
export const planAuthorityOf = n => (n && typeof n.acceptedBodySha256 === 'string' ? n.acceptedBodySha256 : null);
/** The registered children of node@generation that were derived from its plan: a node whose frontier's parent is that node at that generation (gate page 12.11 condition 1). */
/** The registered nodes that were registered AGAINST this node's plan (they depend on it: dependsOn names node@generation): their bundles quote what it provides, and nothing re-reads a registered bundle when a plan's prose changes (gate page 12.11, advisor 14 Oct). */
export const registeredDependentsOf = (state, node, generation) => [...state.nodes.values()].filter(c => (c.dependsOn ?? []).some(d => d.node === node && d.generation === generation));
/**
 * The state-side refusals of a `plan_accepted`, in ONE place: the table (below) and the writer (src/tree-accept.js) both call it, so a sentence has one source and a table row cannot be bypassed by the library. -> a reason, or null.
 * `ref` = { stopId, node, generation, runId }.
 */
export function planAcceptStopRefusal(state, ref) {
  const meta = state.stopMeta.get(ref.stopId);
  if (!meta || !state.openStops.includes(ref.stopId)) return `stop ${ref.stopId} is not an open stop: accepting a changed plan answers exactly one open stop`;
  if (meta.source !== 'blocked') return `stop ${ref.stopId} is a ${meta.source ?? 'no'}-source stop, not a blocked-child stop: only that kind is answered by accepting a changed plan`;
  if (meta.node !== ref.node || meta.generation !== ref.generation || meta.runId !== ref.runId) return `stop ${ref.stopId} is about ${meta.node}@g${meta.generation} (run ${meta.runId ?? 'none'}), not ${ref.node}@g${ref.generation} (run ${ref.runId})`;
  const n = state.nodes.get(`${ref.node}@g${ref.generation}`);
  if (!n || n.phase !== PHASES.closed || n.runId !== ref.runId) return `${ref.node}@g${ref.generation} is not closed with run ${ref.runId}`;
  if (!n.deliveredBodySha256) return `${ref.node}@g${ref.generation} closed without a recorded hash of its plan body (an older closure, or a file that did not match its report): its stop is answered by a new plan or abandon`;
  return null;
}
/** The frontiers of node@generation's split that a person APPROVED (spend approved on a preview built from this plan), whether or not their children are registered yet: the derivation of a child quotes sections of this plan, and the approval is not re-asked for prose (gate page 12.11, advisor 14 Oct). */
export const approvedFrontiersOf = (state, node, generation) => [...state.frontiers.entries()].filter(([, f]) => f.parentNode === node && f.parentGeneration === generation && f.revisions.length > 0).map(([key]) => key);
export const registeredChildrenOf = (state, node, generation) => [...state.nodes.values()].filter(c => c.frontierKey && state.frontiers.get(c.frontierKey)?.parentNode === node && state.frontiers.get(c.frontierKey)?.parentGeneration === generation);
export const BLOCKED_REASONS = Object.freeze([...STICKY_REASONS, ...RECORD_REASONS]);

const PHASES = Object.freeze({ registered: 'registered', running: 'running', stopped: 'stopped', closed: 'closed' });

/**
 * Folds the committed events into the state the rules read. Pure. Events that break the table are not skipped here (the writer keeps them out); the fold applies what it is given.
 *   treeId       the id tree_started recorded (= the root run's id)
 *   nodes        Map "node@gN" -> { node, generation, runId, attempt, phase, claim, postRun, grant, topUps, frontierKey, parentNode, depth, registeredAt }
 *   active       the key of the one active node, or null (two would be a corrupt record: `activeKeys` lists all). A node is active when it is registered, running or in a post-run call, EXCEPT a registered, never-started node that is DEAD (it can never start;
 *                SLOT FIX, C&C 23 Okt 2026)
 *   frontiers    Map key -> { previewed, revisions: [n], children: [{node, generation}], splitSha256 (the verified split the preview named) }
 *   decisions    Map event id -> { affected, generated }
 *   chainAmendments  Map chain name -> { eventId, fromSha256, toSha256 } of its latest chain_limits_amended (0.8.3)
 *   capAmendments  [{ eventId, fromCapUsd, toCapUsd }] in record order (gate page 5): the cap in force is the last `toCapUsd`; src/tree-budget.js effectiveCapUsd is its ONE reader
 *   openStops    ids of needs_decision_opened events no decision or resolution has answered yet
 *   sticky       Map reason -> id of the blocked event
 *   parentBlocks Map frontierKey -> id of the `blocked: parent_changed` event standing for that frontier (M5c4). A parent_changed carries the frontierKey of the child whose start found its parent changed; it blocks the
 *                tree (sticky `parent_changed`, as any sticky reason) and marks that frontier's registered children stale until a `frontier_approved` for THAT key, written after it, clears it (an approval of another
 *                key clears nothing). A parent_changed with NO frontierKey is the tree-wide shape of the M1/M2 fixtures: it stays sticky and nothing clears it.
 */
export function foldRecord(events) {
  const nodes = new Map(); const frontiers = new Map(); const decisions = new Map(); const sticky = new Map(); const openStops = []; const stale = new Set(); const stopStale = new Map(); const stopMeta = new Map(); const closedUnstarted = new Map(); const piiAllowed = new Map(); const restoredStops = new Map(); const detectedStops = new Set();   // `detectedStops`: the (node, generation, run) keys that have a stop written by detection (src/tree-detect.js's own `have`: every source but obligation and person)
  // M5e S3 (PLAN 8.4, C&C Q2/Q4): answering a stop in place RELEASES its marks; a regenerate decision answers the stop but its marks are HELD (heldStale), not cleared: the nodes are being replaced, and the marks end only as
  // the end of the fold says. Root blocks (root_affected) carry the ROOT stop that stands for them and clear only when a root milestone resolution answers that stop.
  let heldReleasedBelow = 0; const heldReleasedKeys = new Set();       // S8 held state: root eras below this number are PASSED OVER (K2: kept, not dead; X1: the first children frontier of a later root generation is approved; abandon retires them: heldEras() is empty then); individual keys passed over by held_released (X2). There is NO release by the next root generation (X4 was removed 13 Oct 2026, see below)
  // CR-RB-004: WHEN each generation was opened (its event's position in the record), per key and per path, so a parent's new children start above the numbers an older lineage of their path opened (childGenerationOf, generationOf)
  let seq = 0; const openedAt = new Map(); const openingsOf = new Map();
  let maxOpenedBoundary = new Map(); const maxOpened = new Map(); const heldDecision = new Map(); const heldStale = new Map(); const rootBlocks = new Map(); const staleWhy = new Map();
  // The ROOT is never regenerated, so its mark is never HELD (it lives on the root stop and is released when a root milestone resolution answers that stop): keys of R are filtered out of what a regenerate holds.
  const notRoot = keys => new Set([...keys].filter(k => !String(k).startsWith('R@g')));
  const drafts = new Map();         // GAP A: stop id -> the NEWEST session draft { id, text, reason, sha256, at, replaces } (an older draft stays in the record and is never offered)
  const deferred = new Map();       // DEFERRAL (6d): stop id -> { id, conditions, reason, actor } - the session handed an open stop to the person
  const accepted = new Set();       // KEEP: "node@g" keys of node_closed needs_decision results a person or the session accepted as they are
  const answerStop = (id, hold = false) => { const i = openStops.indexOf(id); if (i >= 0) openStops.splice(i, 1); if (hold && stopStale.has(id)) heldStale.set(id, notRoot(stopStale.get(id))); stopStale.delete(id); };
  const parentBlocks = new Map(); const parentStale = new Map();      // M5c4: per frontier key; the stale marks of a parent_changed live apart from the stop's, so the provisional "a decision clears every stale mark" rule cannot wipe them
  let started = false; let treeId = null; let lastId = 0; let abandoned = null; const capAmendments = []; const chainAmendments = new Map();
  const advice = new Map();        // ROADMAP 77: adviceId -> { adviceId, grantUsd, stopId, claim, expiresAtMs, runs: [{ runId, kind }], ended: null | { reason, returnedUsd }, id, answeredBy } (a side request, never a node)
  const keyOf = e => `${e.node}@g${e.generation}`;
  for (const e of events) {
    seq += 1;
    lastId = Math.max(lastId, Number(String(e.id).slice(1)) || 0);
    const n = nodes.get(keyOf(e));
    switch (e.event) {
      case 'tree_started': started = true; treeId = e.treeId; break;
      case 'frontier_previewed': { const f = frontiers.get(e.frontierKey) || newFrontier(); f.previewed = true; f.parentNode = e.parentNode ?? null; f.parentGeneration = e.parentGeneration ?? null; f.children = e.children; f.splitSha256 = e.splitSha256 ?? null; f.previewHash = e.boundSha256 ?? null; f.kind = e.kind ?? 'split'; f.openedBy = e.openedBy ?? null; frontiers.set(e.frontierKey, f); break; }
      case 'frontier_approved': { const f = frontiers.get(e.frontierKey) || newFrontier(); if (f.revisions.length === 0 && f.parentNode === 'R' && typeof f.parentGeneration === 'number' && f.parentGeneration >= 2) heldReleasedBelow = Math.max(heldReleasedBelow, f.parentGeneration);       // X1: the FIRST approval of the children frontier of a re-planned root PASSES OVER the held children of every earlier root generation (K2: they stay held and offerable, they do not die)
        f.revisions.push(e.revision); f.approvals.push({ revision: e.revision, boundSha256: e.boundSha256 ?? null, answeredBy: answeredByOf(e) }); f.blocked = false; frontiers.set(e.frontierKey, f); parentBlocks.delete(e.frontierKey); parentStale.delete(e.frontierKey); break; }
      case 'node_registered': nodes.set(keyOf(e), { dependsOn: Array.isArray(e.dependsOn) ? e.dependsOn.filter(d => d && typeof d.node === 'string').map(d => ({ node: d.node, generation: d.generation, thinContractSha256: typeof d.thinContractSha256 === 'string' ? d.thinContractSha256 : null })) : [], node: e.node, generation: e.generation, runId: e.runId, attempt: e.attempt, phase: PHASES.registered, claim: null, postRun: null, grant: e.grant, topUps: [], frontierKey: e.frontierKey, parentNode: e.parentNode, depth: e.depth, acceptedBodySha256: null, acceptedBy: null, bodyHistory: [], closedBodySha256: null, bundleSha256: typeof e.bundleSha256 === 'string' ? e.bundleSha256 : null, bundleBytes: Number.isInteger(e.bundleBytes) ? e.bundleBytes : null, builtAtId: e.id, builtFrom: Array.isArray(e.builtFrom) ? e.builtFrom : null, rebuiltAtId: null }); break;
      // REBUILD: the node's CURRENT input bundle is the newest of its registration and its rebuilds (readers take it from the node, never from the node_registered event: test/tree-bundle-readers.test.js)
      case 'node_bundle_rebuilt': if (n) { n.bundleSha256 = e.bundleSha256; n.bundleBytes = e.bundleBytes; n.builtAtId = e.id; n.builtFrom = e.builtFrom; n.rebuiltAtId = e.id; } break;
      case 'node_started': if (n) { n.phase = PHASES.running; n.claim = { event: 'node_started', purpose: 'first', pid: e.pid, host: e.host, id: e.id }; } break;
      case 'node_resumed':
        if (!n) break;
        if (e.purpose === 'post_run') n.postRun = { pid: e.pid, host: e.host, id: e.id };
        else { n.phase = PHASES.running; n.claim = { event: 'node_resumed', purpose: 'resume', pid: e.pid, host: e.host, id: e.id }; }
        break;
      case 'node_stopped': if (n) { n.phase = PHASES.stopped; n.claim = null; } break;
      // member verb: the NEWEST choice stands (the other choice for an unconsumed stop replaces it; the consumer compares `stop` with the run's current stop id, so an older choice for an earlier stop is never read as pending)
      case 'node_choice': if (n) n.choice = { choice: e.choice, stop: e.stop, id: e.id, ...(Array.isArray(e.picks) ? { picks: e.picks } : {}) }; break;
      // a grant without the gate that authorized it is not a grant (M5d): the fold does not count it
      case 'grant_issued': if (n && isStr(e.gateId) && isStr(e.shownSha256)) n.topUps.push({ amount: e.amount, unit: e.unit }); break;
      case 'node_released': if (n) n.postRun = null; break;
      // M5f (a) (C&C, M5c go): the record holds ONE verified split per node@generation; the table refuses a second, so the first stands (a reader never has to choose)
      case 'split_verified': if (n && !n.verifiedSplit) n.verifiedSplit = { sha: e.splitSha256, runId: e.runId, id: e.id, children: Array.isArray(e.children) ? e.children : null }; break;
      // c3b: a child closed by a person before it was ever registered. NOT a nodes row (every nodes row has a run folder and a grant; gateTree, budgetOf and returnedUsdOf rely on that): its own field. The event answers its stop.
      case 'bundle_input_allowed': piiAllowed.set(keyOf(e), { types: [...e.types], stopId: e.stopId, gateId: e.gateId, shownSha256: e.shownSha256, at: e.at }); answerStop(e.stopId); break;
      case 'node_closed_unstarted': closedUnstarted.set(keyOf(e), { stopId: e.stopId, gateId: e.gateId, shownSha256: e.shownSha256, at: e.at }); answerStop(e.stopId); break;
      case 'node_closed':
        if (n) {
          n.phase = PHASES.closed; n.claim = null; n.outcome = e.outcome; n.closedStatus = e.status ?? null; n.deliveredBodySha256 = typeof e.deliveredBodySha256 === 'string' ? e.deliveredBodySha256 : null; n.closedBodySha256 = n.deliveredBodySha256; n.thinContractSha256 = typeof e.thinContractSha256 === 'string' ? e.thinContractSha256 : null; n.planCopy = e.planCopy ?? null; n.copyFailed = typeof e.copyFailed === 'string' ? e.copyFailed : null; n.share = e.share; n.returnedUsd = typeof e.returnedUsd === 'number' ? e.returnedUsd : null;
          // Q2 (C&C, M5d; the approval part amended by R1, see below): a parent_changed block that stands for this node's frontier clears when the close that just happened leaves EVERY registered child of that frontier closed (an incomplete close by a person counts).
          // Event-ordered on purpose: a block written AFTER its children closed is not cleared by them, and a frontier with no registered child clears only by a new approval (never vacuously true).
          const k = n.frontierKey;
          if (typeof k === 'string' && parentBlocks.has(k)) {
            const kids = [...nodes.values()].filter(x => x.frontierKey === k);
            if (kids.length && kids.every(x => x.phase === PHASES.closed)) {
              // R1 (M5 API reviews): the BLOCK lifts (the tree is not stuck, the marks clear), the APPROVAL does not while the preview offered a child that was never registered: that approval showed the parent as it was before the
              // change, so it must not revive for the sibling; only a frontier_approved written after the block does (f.blocked stays until then). When every child it offered is registered and closed, nothing is left to start.
              parentBlocks.delete(k); parentStale.delete(k);
              const f = frontiers.get(k);
              // a frontier with no recorded child (no preview) offered nothing the old approval could be shown to cover: fail closed, the block stays until a new approval (R3, the R1 edge)
              const offered = f ? (f.children ?? []).filter(c => c.admitted !== false) : [];
              if (f && offered.length > 0 && offered.every(c => nodes.has(`${c.node}@g${c.generation}`))) f.blocked = false;
            }
          }
        }
        break;
      // Row 4 (M5d): a stop's stale marks are ITS OWN (stopStale), and answering a stop clears that stop's marks only. The stale set is built at the end as a UNION of the open stops' sets and the parent_changed marks, so a
      // node marked by two stops stays stale until both are answered, and a parent_changed frontier's marks never clear by a decision.
      // `affected` lives in stopMeta BESIDE stopStale on purpose: stopStale is CONSUMED when a stop is answered (its marks move or vanish), stopMeta keeps the set the event RECORDED (what ineligibleBelowRoot needs for the origin child stop after it was answered). Not a duplicate.
      case 'needs_decision_opened': if (e.source !== 'obligation' && e.source !== 'person') detectedStops.add(`${e.node}@g${e.generation}:${e.runId}`); openStops.push(e.id); stopMeta.set(e.id, { node: e.node ?? null, generation: e.generation ?? null, runId: e.runId ?? null, source: e.source ?? null, blockedCodes: e.source === 'blocked' && Array.isArray(e.blockedBy) ? e.blockedBy.map(b => b.code) : null, ...(e.source === 'bundle_input' && e.child ? { child: e.child } : {}), ...(e.source === 'bundle_input' ? { piiTypes: [...new Set((e.findings || []).filter(f => String(f.name).startsWith('pii:') && !String(f.name).startsWith('pii:secret')).map(f => String(f.name).split(':')[1]))], otherFindings: (e.findings || []).some(f => !String(f.name).startsWith('pii:') || String(f.name).startsWith('pii:secret')), oversize: (e.findings || []).some(f => String(f.name).startsWith('oversize:')) } : {}), ...(e.source === 'obligation' && typeof e.originStopId === 'string' ? { originStopId: e.originStopId, ...(typeof e.obligation === 'string' ? { obligation: e.obligation } : {}) } : {}), affected: (e.affected || []).map(a => `${a.node}@g${a.generation}`) }); stopStale.set(e.id, new Set((e.affected || []).map(a => `${a.node}@g${a.generation}`))); break;
      // The sitting answered the one stop it names (restore gap): the stop's OWN stale marks are released like any in-place answer (a node another open stop also marks stays stale), nothing is held, no decision exists.
      case 'stop_draft_written': drafts.set(e.stopId, { id: e.id, text: e.text, reason: e.reason, sha256: e.sha256, at: e.at, replaces: drafts.get(e.stopId)?.id ?? null, changeAsked: null }); break;
      case 'stop_draft_change_asked': { const d = drafts.get(e.stopId); if (d && d.id === e.draftId) d.changeAsked = { id: e.id, text: e.text, at: e.at }; break; }
      case 'stop_deferred': if (!deferred.has(e.stopId)) deferred.set(e.stopId, { id: e.id, conditions: [...e.conditions], reason: e.reason, actor: e.actor ?? null }); break;       // the session says it cannot decide: the stop stays open for the person (nothing is answered or released)
      case 'stop_restored': answerStop(e.stopId); restoredStops.set(e.stopId, e.id); break;
      // 2b: answers exactly its stop and moves the node's record-held body hash to the accepted one, keeping the previous in `bodyHistory`. A revert (the bytes the panel signed are back) puts the authority back to null.
      case 'plan_accepted': {
        answerStop(e.stopId);
        if (n) {
          n.bodyHistory.push({ previous: e.previousBodySha256, accepted: e.acceptedBodySha256, eventId: e.id, actor: e.actor, via: e.via ?? null, revert: e.revert === true });
          n.deliveredBodySha256 = e.acceptedBodySha256;
          if (e.revert === true) { n.acceptedBodySha256 = null; n.acceptedBy = null; }
          else { n.acceptedBodySha256 = e.acceptedBodySha256; n.acceptedBy = { actor: e.actor, via: e.via ?? null, eventId: e.id, ...(typeof e.reason === 'string' ? { reason: e.reason } : {}) }; }
        }
        break;
      }
      case 'decision_recorded': {
        const inPlace = e.form === 'milestone' || e.form === 'keep';
        // a milestone decision opens no generation (recovery must not open one), and leaves its stop open until the milestone_resolved that names it
        decisions.set(e.id, { answeredBy: answeredByOf(e), affected: e.affected, generated: inPlace, form: e.form ?? null, obligation: typeof e.obligation === 'string' ? e.obligation : null, stopId: e.stopId ?? null, covers: e.covers ?? [], hasText: isStr(e.text), replansRoot: e.replansRoot === true, node: e.node ?? null, generation: e.generation ?? null, milestone: e.milestone ?? null, resolved: false, listed: new Set((e.affected ?? []).map(a => `${a.node}@g${a.generation}`)) });
        if (e.form === 'keep' && e.stopId) {
          // KEEP (C&C thcmcp-6d, Muad 19 Okt): the person (or the session, with its written reason) accepts a node_closed needs_decision result as it is. The stop is answered and its marks RELEASED (answerStop without hold, as milestone_resolved does); nothing is opened; the node joins `accepted`. The raw closedStatus is NOT changed (restore compares it with the snapshot).
          answerStop(e.stopId); accepted.add(`${e.node}@g${e.generation}`);
        }
        if (!inPlace && e.stopId) {
          // a root re-plan (S8) answers its stop WITHOUT carrying the stop's own marks: for an obligation root stop they are the carriers' whole closure, and only the decision's own `affected` set is held (rulings row 130, design note 16.7)
          answerStop(e.stopId, e.replansRoot !== true); heldDecision.set(e.stopId, e.id);
          // the decision's OWN affected set is held too (M5e S4: an obligation decision widens it with the carriers, which the stop never marked)
          const own = heldStale.get(e.stopId) ?? new Set();
          for (const a of e.affected ?? []) if (a.node !== 'R') own.add(`${a.node}@g${a.generation}`);
          heldStale.set(e.stopId, own);
          // F2 (see retiredObligationOf): a re-plan retires EVERY open root stop (the era boundary below) and so supersedes the obligation decisions they came from: their marks on the carriers are released and their pending generations are
          // never opened (`generated`, with no `opened`: recovery skips them, `decisionDeadKeys` never sees them). Done HERE, on the decision, so it does not depend on the `generation_opened` that follows it being written.
          if (e.replansRoot === true) for (const origin of retiredObligationOf({ stopMeta, decisions, openStops }, e.stopId).origins.values()) {
            heldStale.delete(origin.originStopId);
            decisions.get(origin.decisionId).generated = true;
          }
        }
        break;
      }
      case 'milestone_resolved': {
        const d = decisions.get(e.decisionId);
        // R12 (M5 API reviews; C&C): a node's stop stands for ALL its needs-decision milestones, so it is answered only by the LAST one. `remaining` (written by the --milestone writer, which can read the split the fold cannot) lists the
        // milestones still unresolved after this one; a non-empty list answers nothing and releases nothing. An absent field is an older record: it answers, as it did.
        if (d) {
          d.resolved = true;
          if (!(Array.isArray(e.remaining) && e.remaining.length)) for (const sid of [d.stopId, ...(d.covers ?? [])].filter(Boolean)) { answerStop(sid); if (e.node === 'R') rootBlocks.delete(sid); }       // only a ROOT milestone resolution clears the block of a ROOT stop it answers (C&C Q2); it answers EVERY open root stop it covers
        }
        break;
      }
      case 'generation_opened': {
        const d = decisions.get(e.decisionId); if (d) { d.generated = true; d.opened = e.nodes ?? []; }
        if ((e.nodes ?? []).some(o => o.node === 'R')) maxOpenedBoundary = new Map(maxOpened);       // the era boundary: what was opened BEFORE the newest root opening (childGenerationOf skips only those)
        for (const o of e.nodes ?? []) maxOpened.set(o.node, Math.max(maxOpened.get(o.node) ?? 0, o.generation));
        for (const o of e.nodes ?? []) { openedAt.set(`${o.node}@g${o.generation}`, seq); if (!openingsOf.has(o.node)) openingsOf.set(o.node, []); openingsOf.get(o.node).push({ generation: o.generation, seq }); }
        // X4 REMOVED (13 Oct 2026, C&C ruling on Muad's 12 Oct 2026 21:25 decision: every route that re-plans the root KEEPS old sub-plans for the reuse check and never sets them aside first). A root generation N >= 3 that opens used to release the held children of
        // eras below N-1 before any reuse check ran, when R@g(N-1) had offered no children. Now a held node stays held across root generations until a release that actually runs or replaces the check: X1 (the first children frontier of a later root generation
        // is approved), X2 (held_released), or abandon. A root generation that offers no frontier releases nothing.
        // S8 THE ERA BOUNDARY (design note 5a; rulings row 130): a root generation >= 2 opens, and the old era is over. Root-era only: a tree with no root re-plan never reaches this branch.
        //  - every stop opened before it is RETIRED (answered): its node no longer exists in the plan, and nothing would ever offer or answer it again
        //  - the sticky root_affected block is LIFTED (it stood for a root that is being replaced) and the old parent_changed blocks are dropped (they guard frontiers of the old era; one written LATER stays)
        //  (a `record_corrupt` and the other sticky reasons are not touched)
        if ((e.nodes ?? []).some(o => o.node === 'R' && o.generation >= 2)) {
          for (const id of [...openStops]) answerStop(id);
          rootBlocks.clear(); parentBlocks.clear(); parentStale.clear();
        }
        break;
      }
      case 'held_released': for (const k of e.nodes ?? []) heldReleasedKeys.add(k); break;
      // ROADMAP 57 (contract section 2/4): the tree is over. Nothing replaces the stops it retires, so `abandoned.retiredStops` names them for the views (the node of each is in stopMeta, which answerStop does not touch). The SAME retire as the root-generation
      // branch of `generation_opened` above (answerStop for every open stop, the root and parent blocks lifted, their stale marks dropped); every held era is passed over as X1 passes it (heldReleasedBelow = the latest root generation) and heldEras() returns nothing for an abandoned tree, so
      // `heldKeys` is empty afterwards and the formerly held nodes fall under deadKeys' orphan clause. `record_corrupt` and the other sticky reasons are untouched. The table refuses every later event except the three plain records.
      // gate page 5: a new total for the whole tree. It changes NOTHING else in the fold: no stop is answered, no sticky reason or block cleared, no node touched (a raise ADDS authorization; a record_corrupt / privacy / human-rejection stop stands).
      case 'advice_registered': if (!advice.has(e.adviceId)) advice.set(e.adviceId, { adviceId: e.adviceId, grantUsd: e.grantUsd, stopId: e.stopId, claim: { pid: e.pid, host: e.host }, expiresAtMs: e.expiresAtMs, runs: [], ended: null, id: e.id, answeredBy: answeredByOf(e) }); break;
      case 'advice_run_added': { const a = advice.get(e.adviceId); if (a && !a.ended && !a.runs.some(r => r.runId === e.runId)) a.runs.push({ runId: e.runId, kind: e.kind }); break; }
      case 'advice_ended': { const a = advice.get(e.adviceId); if (a && !a.ended) a.ended = { reason: e.reason, returnedUsd: e.returnedUsd }; break; }
      case 'cap_amended': capAmendments.push({ eventId: e.id, fromCapUsd: e.fromCapUsd, toCapUsd: e.toCapUsd }); break;
      case 'chain_limits_amended': chainAmendments.set(e.chain, { eventId: e.id, fromSha256: e.fromSha256, toSha256: e.toSha256 }); break;       // changes nothing else in the fold: no stop, block or node (it makes the tree accept a file; readTreeRecord lays it over tree.chains)
      case 'tree_abandoned': {
        abandoned = { eventId: e.id, at: e.at, gateId: e.gateId, shownSha256: e.shownSha256, retiredStops: [...openStops] };
        const latestRoot = Math.max(0, maxOpened.get('R') ?? 0, ...[...nodes.values()].filter(x => x.node === 'R').map(x => x.generation));
        heldReleasedBelow = Math.max(heldReleasedBelow, latestRoot);
        for (const id of [...openStops]) answerStop(id);
        rootBlocks.clear(); parentBlocks.clear(); parentStale.clear();
        break;
      }
      case 'blocked':
        if (e.reason === 'parent_changed') {
          // keyed on the REASON, not on whether a frontierKey is present (held_changed / split_changed records carry one too)
          const key = typeof e.frontierKey === 'string' ? e.frontierKey : '';
          parentBlocks.set(key, e.id);
          if (key) { const f = frontiers.get(key); if (f) f.blocked = true; parentStale.set(key, new Set([...nodes.values()].filter(x => x.frontierKey === key).map(x => `${x.node}@g${x.generation}`))); }
        } else if (e.reason === 'root_affected' && typeof e.stopId === 'string') rootBlocks.set(e.stopId, e.id);       // M5e S4 writes it with the ROOT stop's id; one without a stop id stays sticky (the shape of the M1/M2 fixtures)
        // `record_corrupt` is DERIVED from the current read (src/tree-record.js stateOf adds it while the file does not read), never from a recorded line: the line is the incident's history, and a stored mark would survive the repair (PLAN line 89: blocked "until a person
        // restores the file"; the same reason DECISIONS 123 gives for accounting_blocked). Entry 3, 14 Oct 2026; the T9d pin that a RECORDED line survives an era boundary was an artefact of the fold, not a decision.
        else if (STICKY_REASONS.includes(e.reason) && e.reason !== 'record_corrupt') sticky.set(e.reason, e.id);
        break;
      default: break;
    }
  }
  const activeKeys = [...nodes].filter(([, s]) => isActive(s)).map(([k]) => k);
  const staleSrc = new Map();       // key -> [{ kind: 'stop' | 'decision' | 'parent', id }]: WHICH remedy applies (answer the stop / wait for the replacement / approve the frontier again)
  const mark = (k, why, src) => { stale.add(k); if (!staleWhy.has(k)) { staleWhy.set(k, []); staleSrc.set(k, []); } staleWhy.get(k).push(why); staleSrc.get(k).push(src); };
  for (const [id, marks] of stopStale) for (const k of marks) mark(k, `stop ${id} put it in question`, { kind: 'stop', id });
  for (const [fk, marks] of parentStale) for (const k of marks) mark(k, `its parent changed (frontier ${String(fk).slice(0, 8)})`, { kind: 'parent', id: fk });
  // HELD marks of regenerate decisions (C&C, M5e S5, option (i): SUPERSEDED WITH THE PARENT). Before the decision's generation_opened every held mark is pending. After it, a held node is either REPLACED (a newer generation is
  // opened) or a DESCENDANT of a replaced node (it dies with its parent: the parent's new split is authoritative, PLAN 8.4/9.1 item 5). Both stay stale for good and nothing releases them: with topmost-only generation_opened
  // every affected node is one or the other, so there is no third class to release (the old "release once the replacement closed passed" branch was dead code and is gone). Everything that matters reads the NEWEST generation
  // (orphansOf and src/tree-loop.js), so a permanently stale old generation blocks nothing.
  const within = (n, a) => n === a || n.startsWith(`${a}/`);
  for (const [stopId, marks] of heldStale) {
    const d = decisions.get(heldDecision.get(stopId));
    for (const k of marks) {
      const m = /^(.*)@g(\d+)$/.exec(k); const node = m ? m[1] : k; const gen = m ? Number(m[2]) : 1;
      const id = heldDecision.get(stopId); const src = { kind: 'decision', id };
      if (!d?.opened) { mark(k, `decision ${id} is replacing it`, src); continue; }
      // Option 4: when the replaced thing is an adopted ROOT, the decision opened its SLOT (another path), so the node under it is found through the LISTED root as well (a path-prefix test against the slot alone never matched: the same path-vs-slot keying defect as the registration guard)
      const parent = d.opened.find(o => o.node !== node && within(node, o.node)) ?? [...(d.listed ?? [])].map(k => ({ node: k.replace(/@g\d+$/, '') })).find(l => l.node !== node && within(node, l.node));
      // K1 sub-plan route (C2a-record commit 2): the stop's marks are carried into the decision (answerStop hold), but a descendant of a replaced node that the decision does NOT list was judged holdable by the table at append (src/tree-transitions.js subplanAffectedWanted): it is a CANDIDATE (subCandidates), not replaced for good. Before the generation opens every mark stays pending (above), so there is no window. A record written before this commit lists every descendant, so it folds as before.
      if (parent && d.listed && d.form === 'regenerate' && d.replansRoot !== true && !d.listed.has(k)) continue;
      mark(k, d.opened.some(o => o.node === node && o.generation > gen) ? `decision ${id} is replacing it (superseded)` : parent ? `superseded with its parent ${parent.node}, replaced by decision ${id}` : `decision ${id} is replacing it`, src);
    }
  }
  // K4 (C2a-record commit 3): the nodes ADOPTED into another slot ('R/M1@g1' -> a value whose shape C2b defines). EMPTY until C2b writes the event that fills it, so nothing in this commit can mark a node adopted and every reader behaves as before. Declared here so the predicate below has ONE place to ask.
  const adopted = new Map();
  // K8 (C2a-record commit 4; C&C condition: the state guard): `adopted` is filled ONLY from the `reused` entries of the preview the approval BINDS. `f.children` is the LATEST preview's, and `approvalValid` holds only while the latest approval's hash equals that preview's, so an earlier preview of the same frontier key (or an approval of an older one) never adopts anything. A blocked or stale approval adopts nothing. First binding wins (the table refuses a second one).
  // C2b-1c (the adoption LAPSE; Regenerate_Adopted_Note_2026-10-18.md): an adoption belongs to the plan that made it. When the adopting frontier's PARENT has a newer generation (registered or OPENED by a decision), the plan is replaced and the adoption ends the moment the decision opens its generation, as an orphan does: the node is an orphan again (its own frontier's parent was replaced) and a kept candidate. Judged by the PLAIN comparison over the registered nodes and `maxOpened`,
  // never by `adopted` itself (the rule must not feed its own input). Known limit: when the adopting parent sits inside another adopted branch (C2b-3's nested case) the numbers of the other branch are seen too.
  // Regenerate of a reused node (Muad: option 4, RegenSlot_Plan_2026-10-18.md): planning the node again opens the next generation of its SLOT, so the slot's own path having a newer generation (registered or OPENED) than the slot's ends the adoption the moment the decision opens it, before anything is registered for the replacement.
  const plainLatest = path => Math.max(0, maxOpened.get(path) ?? 0, ...[...nodes.values()].filter(n => n.node === path).map(n => n.generation));
  for (const [fk, f] of frontiers) {
    if (!approvalValid(f)) continue;
    if (typeof f.parentNode === 'string' && typeof f.parentGeneration === 'number' && plainLatest(f.parentNode) > f.parentGeneration) continue;
    for (const c of f.children ?? []) if (c.reused && plainLatest(c.node) <= c.generation) { const k = `${c.reused.adoptsNode}@g${c.reused.adoptsGeneration}`; if (!adopted.has(k)) adopted.set(k, { slot: `${c.node}@g${c.generation}`, frontierKey: fk, runId: c.reused.runId }); }
  }
  // C2b-1b (K4 closure; found while re-keying the readers): `adopted` holds the ROOT of an adopted branch only. The nodes BELOW it keep their old paths and are not orphans (their frontier's parent is the adopted node), but a newer generation of their path (the new plan's own node there) would make the plain comparison call them replaced.
  // `adoptedBelow` (key -> the key of the adopted root above it) is derived on read from the frontier chain: a node whose frontier was proposed by an adopted node, or by a node already below one. The predicate treats both alike. Empty while nothing is adopted.
  const adoptedBelow = new Map();
  for (let changed = true, round = 0; changed && round <= nodes.size; round += 1) {       // each round that changes anything adds a key, so the loop ends by itself; the bound is the number of nodes (a chain cannot be longer) and never cuts a real one short
    changed = false;
    for (const [k, n] of nodes) {
      if (adopted.has(k) || adoptedBelow.has(k)) continue;
      const f = frontiers.get(n.frontierKey);
      if (typeof f?.parentNode !== 'string' || typeof f.parentGeneration !== 'number') continue;
      const above = `${f.parentNode}@g${f.parentGeneration}`;
      const root = adopted.has(above) ? above : adoptedBelow.get(above);
      if (root !== undefined) { adoptedBelow.set(k, root); changed = true; }
    }
  }
  const state = { maxOpenedBoundary, openedAt, openingsOf, accepted, deferred, drafts, started, treeId, nodes, closedUnstarted, piiAllowed, adopted, adoptedBelow, active: activeKeys[0] ?? null, activeKeys, frontiers, decisions, openStops: [...openStops], stopMeta, restoredStops, detectedStops, maxOpened, stale, staleWhy, staleSrc, sticky, parentBlocks, heldReleasedBelow, heldReleasedKeys, abandoned, capAmendments, chainAmendments, advice, lastId };
  // Two things are read off the FINISHED fold, so they come after the object exists (deadKeys reads nodes, frontiers, decisions, staleSrc and the held/adopted maps; never sticky, stale, parentBlocks or active).
  const dead = deadKeys(state);
  // (1) A4 (C&C thcmcp-cd, 23 Okt 2026): a parent_changed block whose frontier's PARENT is dead guards nothing, when the parent died through a SUB-PLAN regenerate. Such a frontier can neither register nor start a child (the node_registered rows approvalValid :1214,
  // frontierParentReplaced and retiredParentBy; node_started and node_resumed refuse a dead key), and the block would refuse EVERY paid event tree-wide (sticky, the paid-event row), the registration of the replacement included. It is dropped by STATE, not by the
  // order of events: this departs from the event-ordering of Q2/R1/R3 above on purpose (a block written LATER on such a frontier guards nothing either). A block on a frontier whose parent is LIVE stays: it still guards the replacements that register under the old
  // approval (approving the frontier again lifts it). SCOPE (C&C, same day, after test/tree-root-generation.test.js T9d): the ROOT era is NOT touched. A node under a root generation that a root re-plan has left behind (its root generation is below the newest) keeps
  // the era boundary's rules (:362/:380: the old blocks are lifted there, and a block written LATER stands). The drop releases no money (S8 G3 already released the holds of dead nodes) and admits no paid event under the dead frontier.
  const rootNow = latestGenerationOf(state, 'R');
  const rootGenOf = key => {       // the root generation a node lives under, walking up the frontiers that proposed it; null when the chain does not reach a root (then the block is kept)
    let k = key;
    for (let i = 0; i <= nodes.size; i += 1) {
      const m = /^(.*)@g(\d+)$/.exec(k);
      if (!m) return null;
      if (m[1] === 'R') return Number(m[2]);
      const pf = frontiers.get(nodes.get(k)?.frontierKey);
      if (!pf || typeof pf.parentNode !== 'string' || typeof pf.parentGeneration !== 'number') return null;
      k = `${pf.parentNode}@g${pf.parentGeneration}`;
    }
    return null;
  };
  for (const fk of [...parentBlocks.keys()]) {
    const f = frontiers.get(fk);
    if (!f || typeof f.parentNode !== 'string' || typeof f.parentGeneration !== 'number') continue;
    const parentKey = `${f.parentNode}@g${f.parentGeneration}`;
    if (!dead.has(parentKey) || rootGenOf(parentKey) !== rootNow) continue;       // dead through a sub-plan regenerate under the CURRENT root; a root re-plan's old era is the era boundary's
    parentBlocks.delete(fk); parentStale.delete(fk);
    for (const [k, srcs] of [...staleSrc]) {       // the 'parent' marks this block put on the frontier's nodes go with it
      const kept = srcs.map((src, i) => [src, i]).filter(([src]) => !(src.kind === 'parent' && src.id === fk));
      if (kept.length === srcs.length) continue;
      if (!kept.length) { staleSrc.delete(k); staleWhy.delete(k); stale.delete(k); continue; }
      const why = staleWhy.get(k); staleSrc.set(k, kept.map(([src]) => src)); staleWhy.set(k, kept.map(([, i]) => why[i]));
    }
  }
  // `sticky` is derived ONCE, here, from what is left of parentBlocks and rootBlocks, so no reader sees the blocks from before the drop (the order of the two keys is the order they always had).
  if (parentBlocks.size) sticky.set('parent_changed', [...parentBlocks.values()].at(-1));
  if (rootBlocks.size) sticky.set('root_affected', [...rootBlocks.values()].at(-1));
  // (2) THE SLOT FIX (Option A, C&C thcmcp-cd 23 Okt 2026; it REVERSES the 12 Oct design of test/tree-dead-nodes.test.js "the ACTIVE dead node", whose follow-on is ROADMAP 65): a node that is REGISTERED, never started (no claim, no post-run call) and DEAD can
  // never start (node_started refuses a dead key), so it does not hold the one slot; before this it held it until a person ran `--close`. A dead node that RUNS keeps the slot (the check "never races a running node" still holds). Nothing is closed here.
  state.activeKeys = activeKeys.filter(k => { const n = nodes.get(k); return !(n.phase === PHASES.registered && !n.claim && !n.postRun && dead.has(k)); });
  state.active = state.activeKeys[0] ?? null;
  return state;
}

/** The latest generation of a path the record knows: the newest REGISTERED one or the newest one a decision OPENED (0 if neither). */
export const latestGenerationOf = (state, path) => Math.max(0, ...[...state.nodes.values()].filter(n => n.node === path).map(n => n.generation), state.maxOpened?.get(path) ?? 0);
/**
 * C2b-2 money fix-up 2: the adopted run that FILLS the slot `key` (path@gN) while its adoption is live -> that run's key, else null. ONE helper in front of the table row (a registration on such a slot is refused) and of the chooser (it never tries one), so a preview that lost its `reused` entry cannot strand the loop or buy a second filler for a slot (a finished run fills it, a fresh run on the same key was a $4.00 grant on finished work).
 * Pure: reads `state.adopted` only. After the adoption lapses (the adopting parent or the slot was planned again) the fold no longer holds it and the slot is free.
 */
export function slotHeldBy(state, key) {
  for (const [k, a] of state.adopted ?? []) if (a.slot === key) return k;
  return null;
}
/**
 * Is this generation of the path older than one that is registered or opened? (a replaced node, or a frontier child that was never registered and has been replaced) K4 (C2a-record commit 3; C2a_Gate_Page.md section 6, option I1'): ADOPTED-AWARE, in this ONE place. A node that was adopted into
 * another slot keeps its own key and its own run, so a newer generation of its PATH (the new plan's node that reuses the path) does not replace it. `state.adopted` is empty until C2b, so today the answer is the plain comparison. The readers that compare a generation to the newest one directly move onto this in C2b, each with a real-record row.
 */
export function isSupersededGeneration(state, path, generation) {
  const k = `${path}@g${generation}`;
  const root = state.adopted?.has(k) ? k : state.adoptedBelow?.get(k);
  // C2b-1b: a node of an ADOPTED branch is judged inside its own lineage, never by the newest generation of its PATH (that is the new plan's node, in another place): it is replaced only by a newer generation registered under the same adopted root (a node of the branch that was regenerated after the adoption).
  // An opened-but-unregistered generation does NOT count against it (the opened numbers are keyed by path and cannot say whose lineage they belong to); it is replaced when its replacement registers. The adopted root itself has no such successor.
  if (root !== undefined) return [...state.nodes.values()].some(m => m.node === path && m.generation > generation && state.adoptedBelow?.get(`${m.node}@g${m.generation}`) === root);
  return generation < latestGenerationOf(state, path);
}
/**
 * K4 (C2a-record commit 3): the LIVE nodes of each path - the newest generation, plus any older generation that was ADOPTED (it is live beside the new-era node of the same path). `latestByPath` returns ONE node per path and so can never hold both; this returns every live node, newest first, keyed by path.
 * `nodes`: any iterable of { node, generation } (default: every registered node). Pure. No reader calls it yet (C2b moves the path-newest readers onto it); with `state.adopted` empty it holds exactly the newest node of each path.
 */
export function liveNodesByPath(state, nodes = state.nodes.values()) {
  const out = new Map();
  for (const n of nodes) {
    if (isSupersededGeneration(state, n.node, n.generation)) continue;
    if (!out.has(n.node)) out.set(n.node, []);
    out.get(n.node).push(n);
  }
  for (const list of out.values()) list.sort((a, b) => b.generation - a.generation);
  return out;
}
/**
 * C2b-2: the node that FILLS a slot, when the slot at `path` is filled by a finished run of an earlier plan (`state.adopted`): the adopted node, or null. A consumer whose provider sits at that slot pins THIS node (its run, its thin contract), never an older node that happened to have the path.
 * The newest slot generation wins when a path was a slot more than once. Pure.
 */
export function occupantOf(state, path) {
  let best = null;
  for (const [candidateKey, a] of state.adopted ?? []) {
    const m = /^(.*)@g(\d+)$/.exec(a.slot); if (!m || m[1] !== path) continue;
    const n = state.nodes.get(candidateKey); if (n && (!best || Number(m[2]) > best.gen)) best = { gen: Number(m[2]), n };
  }
  return best?.n ?? null;
}

/**
 * C2b-1b (re-keying the path-keyed readers; plan Review/Build_0.8.3/m7/C2b1b_Plan_2026-10-18.md section 1): the PLACE of a node in the plan now in force, derived on read, never stored. A node's key `path@gN` stays its identity; a reader that keeps one entry per PATH keys by place instead,
 * so an ADOPTED node beside the new node of its old path are two entries. place = the node's path; except an ADOPTED node, whose place is the path of the slot it fills, and a node BELOW an adopted node, whose place is that slot's path plus the rest of its own path. With nothing adopted it is the path
 * for every node (the full suite is the evidence). `n` = { node, generation }.
 */
export function placeOf(state, n) {
  const k = `${n.node}@g${n.generation}`;
  const slotPathOf = rootKey => String(state.adopted.get(rootKey).slot).replace(/@g\d+$/, '');
  if (state.adopted?.has(k)) return slotPathOf(k);
  const root = state.adoptedBelow?.get(k);
  if (root !== undefined && state.adopted?.has(root)) return slotPathOf(root) + n.node.slice(root.replace(/@g\d+$/, '').length);
  return n.node;
}
/**
 * C2b-1b: the LIVE nodes among `nodes` for a reader that used to take the newest node of each path (the `latestByPath` map): that newest node, PLUS every node among them that was adopted or sits below an adopted node (it is live beside the new-era node of its path). A list, not a Map: two live nodes may share a path.
 * With nothing adopted it holds exactly the values `latestByPath` held. Its own call of it is a permanent entry of the BASELINE (it DEFINES the live set).
 */
export function liveNodesOf(state, nodes = state.nodes.values()) {
  const list = [...nodes]; const newest = new Set(latestByPath(list).values());
  return list.filter(n => newest.has(n) || ((state.adopted?.has(`${n.node}@g${n.generation}`) || state.adoptedBelow?.has(`${n.node}@g${n.generation}`)) && !isSupersededGeneration(state, n.node, n.generation)));
}
/** Was the frontier proposed by a generation of its parent that has since been replaced (registered or opened newer)? THE one comparison behind orphansOf, the chooser and the table's refusal. "<", never "!=". */
export const frontierParentReplaced = (state, f) => typeof f?.parentGeneration === 'number' && typeof f.parentNode === 'string' && isSupersededGeneration(state, f.parentNode, f.parentGeneration);
/**
 * The decision that RETIRED the parent of frontier `f`, or null (money fix-up 3, 19 Okt 2026): a recorded regenerate decision LISTS the nodes it replaces or sets aside (the root re-plan: R and everything it cannot hold), and the screen says they "start nothing more" from now on. From that record on, an approval that was given for such a parent's children registers nothing more: a child
 * the person approved in the earlier plan must not start (and hold a grant) after the person decided to plan again. `frontierParentReplaced` only fires once a newer generation of the PARENT'S PATH is registered or opened, which on the root route is long after the decision (the set-aside R/M1@g1 keeps its path until R/M1@g2 registers). ONE predicate for the chooser and the table row.
 */
export function retiredNodeBy(state, key) {
  for (const [id, d] of state.decisions) if (d.form === 'regenerate' && d.listed?.has(key)) return id;
  return null;
}
export function retiredParentBy(state, f) {
  if (typeof f?.parentNode !== 'string' || typeof f.parentGeneration !== 'number') return null;
  return retiredNodeBy(state, `${f.parentNode}@g${f.parentGeneration}`);
}
/** The decision that retired this REGISTERED node: it lists the node itself, or lists the parent of the frontier the node was registered under. Start and resume read it (the screen says the set-aside nodes "start nothing more"); until the decision's generation opens the node is stale (the continuation check refuses it) and then dead, this is the table's own refusal behind both. */
export const retiredNodeOrParentBy = (state, n) => retiredNodeBy(state, `${n.node}@g${n.generation}`) ?? retiredParentBy(state, state.frontiers.get(n.frontierKey));

/** KEEP: does this node's close still say needs_decision for every reader? The raw closedStatus stays on the record; an ACCEPTED node (a `keep` decision) no longer counts as one that ended needs_decision. The ONE helper every closedStatus reader calls. */
export const endedNeedsDecision = (state, n) => n.closedStatus === 'needs_decision' && !state.accepted?.has(`${n.node}@g${n.generation}`);
/**
 * KEEP refusals, ONE function for the table row and the decide form's preflight: why this 'keep' cannot be recorded, or null. node_closed stops ONLY (never blocked, bundle_input or any other source: PII gates stay the person's); the node closed, passed and ended
 * needs_decision; not dead, not held, not retired by a decision, not already accepted; its plan has no needs-decision milestone (those are answered with --milestone). B-DRAFT sentences.
 */
export function keepRefusal(state, { stopId, node, generation }, { milestonesOf = null } = {}) {
  const key = `${node}@g${generation}`;
  const meta = state.stopMeta.get(stopId);
  if (!state.openStops.includes(stopId) || !meta) return `stop ${stopId} is not open`;
  if (meta.source !== 'node_closed') return `stop ${stopId} does not come from a finished run with status needs_decision (source: ${meta.source ?? 'unknown'}). A keep answers only that kind of stop; use the answer shown for this stop`;
  if (meta.node !== node || meta.generation !== generation) return `stop ${stopId} is about ${meta.node}@g${meta.generation}, not ${key}`;
  if (node === 'R') return 'the root plan cannot be accepted with --keep';
  const n = state.nodes.get(key);
  if (!n || n.phase !== PHASES.closed || n.outcome !== 'passed' || n.closedStatus !== 'needs_decision') return `${key} is not a finished, passed run that ended needs_decision`;
  if (state.accepted.has(key)) return `${key} is already accepted`;
  if (deadKeys(state).has(key) || heldKeys(state).has(key)) return `${key} was replaced or is held for a new plan, so it cannot be accepted with --keep`;
  const retired = retiredNodeOrParentBy(state, n);
  if (retired !== null) return `${key} was replaced or set aside by decision ${retired}, so it cannot be accepted with --keep`;
  if (typeof milestonesOf === 'function' && milestonesOf(n).some(m => m.status === 'needs-decision')) return `${key}'s plan has a milestone that needs a decision. Resolve it with --milestone; a keep would skip the question the plan asked`;
  return null;
}
/**
 * ORPHANS, derived from the events (no record of their own, nothing to clear): a registered node whose frontier was proposed by an OLDER generation of its parent than the parent path's latest (registered or opened). It is dead with
 * its parent. ONE definition for its four readers: providerEligibility and treeGraph leave orphans out, the chooser skips their frontiers, the table refuses a registration under one. The comparison is "<", never "!=".
 */
export function orphansOf(state) {
  const out = new Set();
  const live = [...state.nodes.values()].filter(n => n.node !== 'R');
  // S8 G1 (M6, rulings row 130): TRANSITIVE. A node is an orphan when its own frontier's parent generation was superseded OR when that parent is itself an orphan - a grandchild of a replaced child has a frontier whose parent
  // generation was never replaced itself, so it stayed a live (stale for good) path. Run to a fixed point (a node's parent is registered before it, but the map order is not the depth order).
  for (let grew = true; grew;) {
    grew = false;
    for (const n of live) {
      const k = `${n.node}@g${n.generation}`;
      if (out.has(k) || state.adopted?.has(k)) continue;           // K8: an ADOPTED node fills a slot of the new plan: it is live, not an orphan, and its subtree follows it
      const f = state.frontiers.get(n.frontierKey);
      if (frontierParentReplaced(state, f) || (f && out.has(`${f.parentNode}@g${f.parentGeneration}`))) { out.add(k); grew = true; }
    }
  }
  return out;
}
/**
 * The words every dead-key sentence ends in, ONE copy (already-false unit, C&C thcmcp-cd 24 Okt 2026; A-DRAFT). They hold on every route into deadKeys: a node a decision LISTED (replaced when the new plan names it again, set aside when it does not) and a node above which one was
 * (an orphan at any depth: orphansOf is transitive, so the parent of a grandchild orphan was never replaced itself), a superseded root generation included (replaced by the re-plan's decision). The earlier words ("its plan, or an ancestor's, was replaced") were false for a listed consumer
 * that never wrote a plan. Old records keep the text they were written with; nothing reads these words (checked by grep: no reader in src/).
 */
export const DEAD_REASON = 'replaced or set aside by a decision, or a node above it was';
/**
 * DEAD (S8 G3, rulings row 130): what nothing can come back to - the orphans, and every node a regenerate decision HELD and whose decision has opened its generation (`staleSrc` kind 'decision' with `decisions.get(id).opened`: replaced, or a
 * descendant of a replaced node). NOT a merely stop-stale node (its stop can be answered in place and it resumes) and NOT a parent_changed-stale one (the frontier is approved again): releasing their money would grant it twice. ONE
 * definition for its readers (budgetOf, the node_started / node_resumed / grant_issued rows, the resume chooser); none of them may read `state.stale` for this. Plus every superseded ROOT generation.
 */
export function deadKeys(state) {
  // S8 held state (contract M6_HeldState_Contract_2026-10-12.md): a HELD node is an orphan only because the root was replaced and is still waiting for the new root plan's children frontier (or its release); it is not dead yet
  const held = heldKeys(state);
  const out = new Set([...orphansOf(state)].filter(k => !held.has(k)));
  // a SUPERSEDED ROOT generation: R is never an orphan and never gets a held mark, so it is dead by this clause (once a decision opened the next root generation)
  const rootNow = latestGenerationOf(state, 'R');
  for (const n of state.nodes.values()) if (n.node === 'R' && n.generation < rootNow) out.add(`R@g${n.generation}`);
  for (const k of decisionDeadKeys(state)) out.add(k);
  return out;
}
/** The keys a regenerate decision HELD for good and whose generation it has opened (staleSrc kind 'decision'): replaced, or a descendant of a replaced node. A piece of deadKeys, read alone by heldKeys. */
const decisionDeadKeys = state => { const out = new Set(); for (const [k, srcs] of state.staleSrc) if (srcs.some(s => s.kind === 'decision' && state.decisions.get(s.id)?.opened)) out.add(k); return out; };
/**
 * HELD (S8, contract M6_HeldState_Contract_2026-10-12.md; design note 16.4/16.7): the nodes that are orphans ONLY because the root was replaced and that the replacing decision did not list as dead - an eligible child of the old root (it and
 * every descendant closed, passed, not needs_decision, no open stop) between the decision's `generation_opened` and the release (X1: the first approval of the children frontier of a later root generation, whichever generation offers one; X2:
 * `held_released`; abandon). There is NO release by the next root generation (X4 removed 13 Oct 2026: Muad's 12 Oct 21:25 rule). A node whose frontier chain is broken by an earlier child regenerate is NOT a candidate: it died then. Held and dead never overlap (heldKeys is read by deadKeys, never the other way). Derived on read, nothing stored.
 * K2 (M7 apply, C2a-record, C2a_Gate_Page.md section 3; Muad 12 Oct 2026 21:25: a sub-plan is not thrown away before it is checked for reuse): RELEASE IS NOT DEATH. X1 (the approval of a later root generation's children frontier) and X2
 * (`held_released`) no longer remove a node from this set: they ANNOTATE it as passed over (`keptKeys`), and it stays a candidate for every later frontier until it is adopted (S8-9 C2b) or the tree is abandoned. ABANDON still retires every
 * candidate (state.abandoned: nothing is held, nothing can be adopted). The fold keeps `heldReleasedBelow` / `heldReleasedKeys` (accepted records stay readable); they now only say which held nodes were passed over.
 */
export function heldKeys(state, { route = 'all' } = {}) {
  const out = route === 'sub' ? new Set() : new Set(heldEras(state).keys());
  if (route !== 'root') for (const k of subCandidates(state).keys()) out.add(k);
  return out;
}
/**
 * K1, THE SUB-PLAN ROUTE (M7 apply, C2a-record commit 2; C2a_Gate_Page.md section 3: "root re-plan OR a single sub-plan regenerate: one operation"): the finished, passed descendants of a node a regenerate decision replaced are CANDIDATES, not dead. The decision's `affected` lists the replaced
 * nodes (the stopped node, its consumers, each at its generation) and every descendant that cannot be held; a descendant it does NOT list was judged holdable by the table when the decision was appended (subplanAffectedWanted). So a candidate is an ORPHAN whose nearest replaced ancestor was replaced by a regenerate decision that opened its generation and did not list the node.
 * A record written before this commit lists every descendant, so it has none (they stay dead). -> Map key -> the replaced proposer's key ('P@g1'). `withSetAside`: the nodes the decision listed are walked too (candidatesOf shows them with their reason). Derived on read, nothing stored.
 */
function subCandidates(state, { withSetAside = false } = {}) {
  const out = new Map();
  if (state.abandoned) return out;
  const orphans = orphansOf(state); const rootAll = heldEras(state, { withSetAside });
  for (const n of state.nodes.values()) {
    if (n.node === 'R') continue;
    const k = `${n.node}@g${n.generation}`;
    if (!orphans.has(k) || rootAll.has(k) || state.adopted?.has(k)) continue;
    let x = n; let proposer = null;
    for (let i = 0; i < 50 && x; i += 1) {
      const f = state.frontiers.get(x.frontierKey);
      if (!f || typeof f.parentNode !== 'string' || f.parentNode === 'R') break;                  // a root child is the root route's (heldEras)
      const pk = `${f.parentNode}@g${f.parentGeneration}`;
      if (replacedInLineage(state, f.parentNode, f.parentGeneration)) { proposer = pk; break; }       // the same lineage notion as the root route's climb (heldEras)
      x = state.nodes.get(pk);
    }
    if (!proposer) continue;
    const [pNode, pGen] = [proposer.replace(/@g\d+$/, ''), Number(proposer.replace(/^.*@g/, ''))];
    const d = [...state.decisions.values()].find(dd => dd.form === 'regenerate' && dd.replansRoot !== true && Array.isArray(dd.opened) && dd.opened.some(o => o.node === pNode && o.generation > pGen));
    if (!d) continue;                                                                              // replaced by no decision that opened it: dead, as before
    if (d.listed.has(k) && !withSetAside) continue;                                                 // the decision listed it: replaced for good
    // the node must also be holdable on its own NOW (closed, passed, not needs_decision, no open stop): the table guarantees it only for a decision appended after this commit; an older or hand-written partial list must not turn a running or stopped node into a held one
    const holdable = n.phase === PHASES.closed && n.outcome === 'passed' && !endedNeedsDecision(state, n) && !state.openStops.some(id => { const m = state.stopMeta.get(id); return m?.node === n.node && m?.generation === n.generation; });
    if (!holdable && !withSetAside) continue;
    out.set(k, proposer);
  }
  return out;
}
/**
 * REPLACED IN ITS OWN LINEAGE (C2a-record, the eraOf fix): a non-root regenerate decision OPENED a newer generation of this node's path (`decisions[].opened`), so this generation was replaced by a decision about it. A newer generation that exists only because the path was REUSED is NOT a replacement of it: either another root era's node (a new R/M1@g2 under R@g2, beside R/M1@g1 under R@g1) or the NEW PLAN of a regenerated parent reusing a child path (R/M1/M1@g2 beside R/M1/M1@g1, the common milestone-id case). The sub route (subCandidates) and the root route's climb (heldEras) use this one definition.
 */
const replacedInLineage = (state, node, generation) => [...state.decisions.values()].some(d => d.form === 'regenerate' && d.replansRoot !== true && Array.isArray(d.opened) && d.opened.some(o => o.node === node && o.generation > generation));
/** The held nodes with the root generation whose children frontier each hangs under (the era): ONE walk for heldKeys, keptKeys and candidatesOf (`withSetAside`: the nodes a decision set aside are walked too). Empty for an abandoned tree. */
function heldEras(state, { withSetAside = false } = {}) {
  const held = new Map();
  if (state.abandoned) return held;                              // ABANDON retires every candidate: nothing is held, nothing can be adopted
  const rootNow = latestGenerationOf(state, 'R');
  const orphans = orphansOf(state); const decisionDead = decisionDeadKeys(state);
  const era = new Map();                                        // node key -> the root generation whose children frontier it hangs under, or null
  const eraOf = n => {
    const k = `${n.node}@g${n.generation}`;
    if (era.has(k)) return era.get(k);
    era.set(k, null);                                           // cycle guard
    const f = state.frontiers.get(n.frontierKey); let out = null;
    if (f && typeof f.parentGeneration === 'number') {
      if (f.parentNode === 'R') out = f.parentGeneration < rootNow ? f.parentGeneration : null;
      // C2a-record (the eraOf fix, own commit): the climb stops where the parent was REPLACED IN ITS OWN LINEAGE (a regenerate decision opened a newer generation of it: the sub route owns what hangs below), NOT where another root era merely REUSED the parent's path (R/M1@g2 under R@g2 beside R/M1@g1 under R@g1 replaces nothing). Before, path reuse ended the climb and a finished child of a kept candidate died silently (the HANDSHAKE shape).
      else if (!replacedInLineage(state, f.parentNode, f.parentGeneration)) { const parent = state.nodes.get(`${f.parentNode}@g${f.parentGeneration}`); out = parent ? eraOf(parent) : null; }
    }
    era.set(k, out); return out;
  };
  for (const n of state.nodes.values()) {
    if (n.node === 'R') continue;
    const k = `${n.node}@g${n.generation}`; const e = eraOf(n);
    if (e === null || !orphans.has(k) || state.adopted?.has(k) || (decisionDead.has(k) && !withSetAside)) continue;
    held.set(k, e);
  }
  return held;
}
/**
 * PASSED OVER (K2): the candidates a frontier approval (X1: the first approval of a later root generation's children frontier) or a `held_released` record (X2) went past without adopting. A subset of heldKeys, derived on read; a view
 * annotation, never a state change: a kept candidate is refused every action a held one is refused, and stays offered to every later comparison.
 */
/**
 * CANDIDATES (K1, M7 apply C2a-record; C2a_Gate_Page.md section 3): every node a ROOT re-plan orphaned and that is not adopted, with where it came from and WHY it is or is not usable - nothing is dropped from the list because it is ineligible (the screen must be able to say why).
 * -> [{ key, node, generation, runId, era, proposedBy: { node, generation }, state: 'held' | 'kept' | 'set_aside', eligible: true | { code, detail } }] sorted by key. `held`: waiting for the new plan's children; `kept`: passed over by a frontier approval or a
 * `held_released` record (K2); `set_aside`: the replacing decision set it aside because it fails itself (code: not_finished | not_passed | needs_decision | open_stop | set_aside). Derived on read. An abandoned tree has no candidates.
 */
export function candidatesOf(state) {
  if (state.abandoned) return [];
  const all = heldEras(state, { withSetAside: true }); const subAll = subCandidates(state, { withSetAside: true }); const held = heldKeys(state); const kept = keptKeys(state);
  const out = [];
  for (const [key, era] of [...[...all].map(([k, e]) => [k, e, 'root', null]), ...[...subAll].map(([k, p]) => [k, null, 'sub', p])]) {
    const n = state.nodes.get(key); const f = state.frontiers.get(n.frontierKey);
    // `route`: 'root' (a root re-plan; `era` is the root generation) or 'sub' (a sub-plan regenerate, C2a-record commit 2; `era` is null and `proposedBy` is the REPLACED plan the node hangs under, which may be above its own parent)
    const base = { key, node: n.node, generation: n.generation, runId: n.runId, era, route: era === null ? 'sub' : 'root', proposedBy: era === null && subAll.get(key) ? { node: subAll.get(key).replace(/@g\d+$/, ''), generation: Number(subAll.get(key).replace(/^.*@g/, '')) } : { node: f?.parentNode ?? null, generation: f?.parentGeneration ?? null } };
    if (held.has(key)) { out.push({ ...base, state: kept.has(key) ? 'kept' : 'held', eligible: true }); continue; }
    const stopOn = state.openStops.some(id => { const m = state.stopMeta.get(id); return m?.node === n.node && m?.generation === n.generation; });
    const why = n.phase !== PHASES.closed ? { code: 'not_finished', detail: `${n.phase}` }
      : n.outcome !== 'passed' ? { code: 'not_passed', detail: `${n.outcome ?? 'no outcome'}` }
      : endedNeedsDecision(state, n) ? { code: 'needs_decision', detail: 'ended with the Status needs_decision' }
      : stopOn ? { code: 'open_stop', detail: 'a stop is open on it' }
      : { code: 'set_aside', detail: 'set aside by the replacing decision' };
    out.push({ ...base, state: 'set_aside', eligible: why });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
export const HELD_PHRASE = 'held pending the new root plan';
/** B-DRAFT (M7 apply, C2a-record; C&C 18 Okt 2026: text moves in the commit that makes it untrue): what a refusal, a view or a choice screen calls a node that a later frontier approval went past without adopting it. */
export const KEPT_PHRASE = 'kept from an earlier root plan (a later root plan did not use it)';
/** B-DRAFT (M7 apply, C2a-record commit 2): the sub-plan route's phrases name the replaced plan, not the root plan. */
export const subHeldPhrase = replaces => `held pending the new plan of ${replaces}`;
export const subKeptPhrase = replaces => `kept from an earlier plan of ${replaces} (the new plan did not use it)`;
export const heldPhraseOf = (state, key) => {
  const sub = subCandidates(state).get(key);
  if (sub) return keptKeys(state).has(key) ? subKeptPhrase(sub.replace(/@g\d+$/, '')) : subHeldPhrase(sub.replace(/@g\d+$/, ''));
  return keptKeys(state).has(key) ? KEPT_PHRASE : HELD_PHRASE;
};
/** Which route made this node a candidate and which plan it hangs under: { route: 'root', replaces: null } | { route: 'sub', replaces: 'R/M1' } | null. The readers' rows carry it (additive fields). */
export const candidateOriginOf = (state, key) => {
  if (heldEras(state).has(key)) return { route: 'root', replaces: null };
  const sub = subCandidates(state).get(key);
  return sub ? { route: 'sub', replaces: sub.replace(/@g\d+$/, '') } : null;
};
export function keptKeys(state, { route = 'all' } = {}) {
  const out = new Set();
  if (route !== 'sub') for (const [k, e] of heldEras(state)) if (state.heldReleasedKeys.has(k) || e < state.heldReleasedBelow) out.add(k);
  // the sub-plan route: PASSED OVER = a children frontier of the replaced node's NEWER generation was approved (the analogue of X1: the comparison ran and did not adopt it); no release record exists for this route
  if (route !== 'root') for (const [k, proposer] of subCandidates(state)) {
    const pNode = proposer.replace(/@g\d+$/, ''); const pGen = Number(proposer.replace(/^.*@g/, ''));
    if ([...state.frontiers.values()].some(f => f.parentNode === pNode && typeof f.parentGeneration === 'number' && f.parentGeneration > pGen && f.revisions.length > 0)) out.add(k);
  }
  return out;
}
/**
 * The nodes a root re-plan CANNOT hold (contract section 1; pure): for each direct child of the root generation being replaced, the child and every descendant (its frontier-parent closure) must be closed, passed, not
 * needs_decision, with no open stop of its own, not already dead, and not stale for a reason other than this replacement (the marks of the stop being answered, `answeringStopId`, do not count: an obligation root stop marks the
 * carriers' whole closure and releases those marks with the stop). K1 (C2a-record): each node is judged ON ITS OWN - only the node that fails itself is ineligible (before: one failing node made the child AND its whole subtree ineligible). -> the sorted keys; the replacing decision's `affected` is `R@g` plus exactly these.
 */
/**
 * F2 (Muad, 12 Oct 2026: a sub-plan is not thrown away before it is checked for reuse). A ROOT stop opened by an obligation decision (source `obligation`) came from a decision on a CHILD stop; that decision keeps the closure of
 * the carriers in its `affected` BECAUSE it has an in-place route (a root milestone resolution regenerates the carriers) - which is why this set is NOT shortened at the writer. When the root is RE-PLANNED instead, the carriers' fate
 * is decided by eligibility (`ineligibleBelowRoot`), and the origin decision's marks and its pending generation must not count. -> { stops, decisions }: the root stops with an origin that the re-plan answering `answeringStopId`
 * retires (the answered one and every other open one: the era boundary answers them all) and the obligation decisions they came from (events only; an origin that names no decision, or a stop with no origin, adds nothing).
 * `state` may be the fold's own locals: it reads only `stopMeta`, `decisions` and `openStops`.
 */
function retiredObligationOf(state, answeringStopId) {
  const stops = new Set(); const decisions = new Set(); const origins = new Map();       // origins: stop id -> its { originStopId, decisionId }; a stop is in `stops` only with one, so a reader that walks `origins` cannot meet a null origin (BUG-C-056 fix-up, C&C thcmcp-cd 24 Okt 2026)
  const consider = id => { const o = obligationOriginOf(state, id); if (o) { stops.add(id); decisions.add(o.decisionId); origins.set(id, o); } };
  if (answeringStopId) consider(answeringStopId);
  for (const id of state.openStops) consider(id);
  return { stops, decisions, origins };
}
/**
 * CR-2G-004 with D3 F5-2 (ONE predicate for two readers): the obligation decisions a root re-plan supersedes (every open root stop with an origin, the answered one included: retiredObligationOf). Recovery's opening skips exactly these while
 * root_affected stands (src/tree-recovery.js, D2 F5a), and a root re-plan does not wait for them (unopenedBeforeReplan below), so the printed "run `council tree resume` first" can never point at a decision the resume will not open.
 */
export function supersededByRootReplan(state, answeringStopId = null) { return retiredObligationOf(state, answeringStopId).decisions; }
/** CR-2G-004: the recorded decisions a root re-plan must wait for: not in place, not opened, not a root re-plan (its own guard), not superseded by this re-plan. Opening one into the NEW era would feed its text to a child of a plan the person chose without it. -> [decision id]. */
export function unopenedBeforeReplan(state, answeringStopId = null) {
  const superseded = supersededByRootReplan(state, answeringStopId);
  return [...state.decisions].filter(([id, d]) => !d.generated && d.replansRoot !== true && !superseded.has(id)).map(([id]) => id);
}
/** The child stop and the obligation decision a ROOT obligation stop came from: { originStopId, decisionId } | null. null for any other stop, for a stop with no `originStopId`, and for one whose origin names no decision (a
 *  hand-written record): the F2 allowance and the supersede then do nothing - they fail closed. Events only (`state` may be the fold's own locals: it reads `stopMeta` and `decisions`). */
export function obligationOriginOf(state, stopId) {
  const m = state.stopMeta.get(stopId);
  if (!m || m.node !== 'R' || typeof m.originStopId !== 'string') return null;
  // BUG-C-056 (bug audit 2026-10-24): one child stop can hold several decisions (an in-place milestone decision leaves a stop open for the rest of its milestones), so the FIRST decision on the origin stop is not always the one that opened this root stop: it is the one that carries the obligation the root stop names. A record from before the field (the root stop names none) keeps the first match.
  for (const [decisionId, d] of state.decisions) if (d.stopId === m.originStopId && (typeof m.obligation !== 'string' || d.obligation === m.obligation)) return { originStopId: m.originStopId, decisionId };
  return null;
}
export function ineligibleBelowRoot(state, { answeringStopId = null } = {}) {
  const { rootGen, live, fine, subtree, keyOf_, placeOf } = holdabilityOf(state, answeringStopId);
  const out = new Set();
  for (const top of live) {
    if (placeOf(top) !== `R@g${rootGen}`) continue;       // D2 F10 + D3 F10-1 (CR-2A-002): the tops are the nodes that sit, BY PLACE, under the current root plan: its own children and the nodes its frontier adopted
    // K1 (M7 apply, C2a-record; C2a_Gate_Page.md section 3, Astra #3/#5): ELIGIBILITY IS PER NODE. Before, one node that failed anywhere in a child's subtree made the child AND its whole subtree ineligible (dead from the decision). Now only the node that fails itself is set
    // aside; its finished neighbours stay candidates, and whether a whole branch can be adopted is a different question (wholeness, K6, answered at the comparison).
    for (const n of subtree(top)) if (!fine(n)) out.add(keyOf_(n));
  }
  return [...out].sort();
}
// HALF-FINISHED (found by C&C's read of 3945050): a node is whole only when EVERY node its verified split names is registered, with nothing opened and not registered above the newest registered generation of that path
// (a replacement under way), and no previewed/approved children frontier of it has an unregistered member. A verified split whose children the record does not list (a record from before the field) is unknown, so not whole.
export function pendingBelowOf(state, n) {
  // THIS node's lineage: a frontier whose parent is n at its generation. Its first split's frontier and the replacement frontier a regenerate of one of its children registers under (src/tree-frontier.js findPendingFrontier) both are.
  const ownFrontier = key => { const f = state.frontiers.get(key); return f?.parentNode === n.node && f.parentGeneration === n.generation; };
  // CR-RC-019 (builder 19's trace of T's cross-read C-2, 26 Okt 2026): the newest generation of a child path registered IN THIS LINEAGE. Read by path alone, the children a replaced generation of n's path registered there (orphans,
  // still in the record) answered for n: a regenerated sub-plan with a verified split and none of its own children read as whole, and a root re-plan held it instead of setting it aside
  const registeredGen = path => Math.max(0, ...[...state.nodes.values()].filter(x => x.node === path && ownFrontier(x.frontierKey)).map(x => x.generation));
  const names = n.verifiedSplit ? n.verifiedSplit.children : [];
  if (names === null) return true;
  // BUG-C-057 (bug audit 2026-10-24): a slot that a FINISHED run fills (a `reused` child of an approved frontier; `state.adopted` holds its slot) is never registered, so it is not a child left to register (tree-recovery.js does not count it either)
  // The adoption must be the one a frontier of THIS node (this generation) made: `adopted` is lapse-scoped to the newest generation of each parent path, but a parent path can have an older generation that is still live (adopted itself), and that generation's own split child is not filled by what the newer generation's frontier adopted (C&C thcmcp-cd 24 Okt 2026).
  const slotFilled = path => [...(state.adopted ?? new Map()).values()].some(a => ownFrontier(a.frontierKey) && typeof a.slot === 'string' && a.slot.replace(/@g\d+$/, '') === path);
  if (names.some(path => (registeredGen(path) === 0 && !slotFilled(path)) || (state.maxOpened.get(path) ?? 0) > registeredGen(path))) return true;
  return [...state.frontiers.values()].some(f => f.parentNode === n.node && f.parentGeneration === n.generation && (f.children ?? []).some(c => !c.reused && !state.nodes.has(`${c.node}@g${c.generation}`) && !(registeredGen(c.node) > c.generation)));
}
/**
 * The ONE per-node holdability test (K1): `fine(n)` = this node can be a candidate (closed, passed, not needs_decision, no open stop of its own, not half-finished, not stale for any reason but the stop being answered). Shared by the root re-plan
 * (ineligibleBelowRoot) and the sub-plan regenerate (subplanAffectedWanted): one definition, so the writer and the table can never disagree about who is held. `subtree(n)` = n and its frontier-parent closure among the live nodes.
 */
function holdabilityOf(state, answeringStopId) {
  const rootGen = Math.max(0, ...[...state.nodes.values()].filter(n => n.node === 'R').map(n => n.generation));
  const retired = retiredObligationOf(state, answeringStopId);
  const dead = deadKeys(state);
  const keyOf_ = n => `${n.node}@g${n.generation}`;
  const live = [...state.nodes.values()].filter(n => n.node !== 'R' && !dead.has(keyOf_(n)));
  // D2 F10 with D3 F10-1 (CR-2A-002, "judge the root route by place, as the sub-plan route does by path"): a node sits under the parent of the frontier that holds it NOW - an ADOPTED node under its adopting frontier's parent
  // (state.adopted: { slot, frontierKey }), every other node under its own frontier's parent - so the walk reaches an adopted node at any depth (before, it stayed under the plan it was first registered by, and a re-plan never judged it)
  const placeOf = n => { const a = state.adopted?.get(keyOf_(n)); const f = state.frontiers.get(a ? a.frontierKey : n.frontierKey); return f ? `${f.parentNode}@g${f.parentGeneration}` : null; };
  const childrenOf = new Map();
  for (const n of live) { const pk = placeOf(n); if (!pk) continue; if (!childrenOf.has(pk)) childrenOf.set(pk, []); childrenOf.get(pk).push(n); }
  const subtree = n => { const out = [n]; for (const c of childrenOf.get(keyOf_(n)) ?? []) out.push(...subtree(c)); return out; };
  const stopNodes = new Set(state.openStops.map(id => { const m = state.stopMeta.get(id); return m?.node ? `${m.node}@g${m.generation}` : null; }).filter(Boolean));
  const pendingBelow = n => pendingBelowOf(state, n);       // HALF-FINISHED: see pendingBelowOf
  // F2 fix-up (C&C Q5, 12 Oct): the nodes the origin CHILD stop itself put in question (its own recorded `affected`, written before the obligation decision widened it) stay disqualifying whatever their source: the child's own stop is a
  // shown reason, and its dependents follow 'a sub-plan whose supplier is redone is redone too'. Only the obligation decision's WIDENING is released above.
  const ownOfOrigin = new Set();
  for (const origin of retired.origins.values()) for (const k of state.stopMeta.get(origin.originStopId)?.affected ?? []) ownOfOrigin.add(k);
  const fine = n => n.phase === PHASES.closed && !ownOfOrigin.has(keyOf_(n)) && !pendingBelow(n) && n.outcome === 'passed' && !endedNeedsDecision(state, n) && !stopNodes.has(keyOf_(n))
    && !(state.staleSrc.get(keyOf_(n)) ?? []).some(src => !((src.kind === 'stop' && (src.id === answeringStopId || retired.stops.has(src.id))) || (src.kind === 'decision' && retired.decisions.has(src.id))));
  return { rootGen, live, fine, subtree, keyOf_, placeOf };
}
const splitKey = k => ({ node: String(k).replace(/@g\d+$/, ''), generation: Number(String(k).replace(/^.*@g/, '')) });
const topmostPaths = nodes => nodes.filter(a => !nodes.some(b => b !== a && a.node.startsWith(`${b.node}/`)));
/** The registered, live nodes strictly below one of `tops` (node paths) that CANNOT be held (K1 holdability), as keys. Never the root (the root route has its own: ineligibleBelowRoot). */
function unholdableBelow(state, answeringStopId, tops) {
  const { live, fine, keyOf_ } = holdabilityOf(state, answeringStopId);
  const paths = tops.map(t => t.node);
  return live.filter(n => paths.some(p => n.node.startsWith(`${p}/`)) && !fine(n)).map(keyOf_);
}
/**
 * K8 (C2a-record commit 4; C2a_Gate_Page.md section 4 item 5): the slot rule as a RECORD rule. -> null | a refusal sentence. Each `reused` entry of a split frontier's children must name a CURRENT CANDIDATE (held or kept; not when the tree is abandoned) with the candidate's own run id, must not be adopted by ANOTHER approved frontier, and no candidate may fill two slots of one frontier. A candidate this frontier already adopted is fine (a re-preview or re-approval of the same frontier). The slot is the child carrying the entry, so "a slot that is not in the frontier" cannot be written.
 * The table reads no files, so it cannot check `fieldsSha256` (that the old and new text really match is the comparison's job, C2b); on a hand-edited record the same-account limit applies.
 */
function reusedRefusal(state, frontierKey, children) {
  const cands = new Map(candidatesOf(state).map(c => [c.key, c])); const seen = new Set();
  for (const c of children ?? []) {
    const r = c.reused; if (!r) continue;
    const key = `${r.adoptsNode}@g${r.adoptsGeneration}`; const slot = `${c.node}@g${c.generation}`;
    if (seen.has(key)) return `candidate ${key} is named for two slots of one frontier (${slot} and another): one candidate fills at most one slot`;
    seen.add(key);
    const a = state.adopted?.get(key);
    if (a && a.frontierKey !== frontierKey) return `candidate ${key} is already adopted by frontier ${String(a.frontierKey).slice(0, 8)} into ${a.slot}: a slot is filled by exactly the approval of its frontier, and a candidate fills one`;
    if (a) continue;
    const cand = cands.get(key);
    if (!cand) return `${slot} reuses ${key}, which is not a candidate of this tree (not held or kept, or the tree was abandoned)`;
    if (cand.eligible !== true) return `${slot} reuses ${key}, which cannot be used: ${cand.eligible.detail}`;
    if (cand.runId !== r.runId) return `${slot} reuses ${key} with run ${r.runId}, but the candidate's own run is ${cand.runId}`;
  }
  return null;
}
/**
 * K1, THE SUB-PLAN ROUTE (M7 apply, C2a-record commit 2): what a regenerate decision answering a SUB-PLAN stop must list in `affected`. ONE function for the writer (src/tree-decide-stop.js) and the table (case 'decision_recorded'), so they can never disagree.
 * It is the topmost nodes of the stop's recorded affected set S (the stopped node and its consumers, registered or not: they are REPLACED, each gets a new generation) plus every registered node below them that cannot be held. The rest of S (the finished,
 * passed descendants with no open stop of their own) is NOT listed: those nodes are candidates for the new plan's reuse check, not dead. -> [{ node, generation }] sorted by node. The root is never in it (a root stop is the root re-plan's).
 */
export function subplanAffectedWanted(state, stopId) {
  const S = (state.stopMeta.get(stopId)?.affected ?? []).map(splitKey).filter(a => a.node !== 'R');
  const tops = topmostPaths(S);
  const out = new Map(tops.map(t => [`${t.node}@g${t.generation}`, { node: t.node, generation: t.generation }]));
  for (const k of unholdableBelow(state, stopId, tops)) out.set(k, splitKey(k));
  return [...out.values()].sort((x, y) => (x.node < y.node ? -1 : x.node > y.node ? 1 : x.generation - y.generation));
}
/**
 * The table's judgement of a regenerate decision's `affected` for a stop that is not the root's. -> null | a refusal sentence.
 * - the ordinary route: the list must EQUAL subplanAffectedWanted (a missing replaced or unholdable node is refused: it would make a running or stopped node held; an eligible descendant listed is refused: it would throw reusable work away; a node outside the set is refused);
 * - the OBLIGATION route (`event.obligation`): its `affected` is widened at decide time from the verified split files (affectedFor, not on the record), so only the SAFETY half is bound: every unholdable node below a listed (non-root) topmost node is listed.
 */
export function subplanDecisionRefusal(state, event, facts = {}) {
  const listed = new Set((event.affected ?? []).map(a => `${a.node}@g${a.generation}`));
  const word = ks => ks.join(', ');
  // a sub-plan regenerate never races a running node (mirrors the root route; A-DRAFT sentence): an active node at or under a listed path would be listed dead while it runs; both routes
  const listedPaths = [...listed].map(k => splitKey(k).node).filter(n => n !== 'R');
  const racing = racingRefusalOf(state, [...listed], facts);
  if (racing) return racing;
  if (typeof event.obligation === 'string') {
    const tops = topmostPaths([...listed].map(splitKey).filter(a => a.node !== 'R'));
    const missing = unholdableBelow(state, event.stopId, tops).filter(k => !listed.has(k));
    return missing.length ? `a regenerate lists every node below the replaced ones that cannot be held (not finished and passed, or with an open stop): missing ${word(missing)}` : null;
  }
  const wanted = new Set(subplanAffectedWanted(state, event.stopId).map(a => `${a.node}@g${a.generation}`));
  const missing = [...wanted].filter(k => !listed.has(k)); const extra = [...listed].filter(k => !wanted.has(k));
  if (!missing.length && !extra.length) return null;
  return `a regenerate lists exactly the nodes it replaces (the stopped node and its consumers) and the nodes below them that cannot be held (not finished and passed, or with an open stop); the finished sub-plans that passed are kept for the new plan, not listed: ${missing.length ? `missing ${word(missing)}` : ''}${missing.length && extra.length ? '; ' : ''}${extra.length ? `not to be listed ${word(extra)}` : ''}`;
}
/** The newest generation of each path among `nodes` (any iterable of { node, generation, ... }) -> Map path -> node. ONE definition for its readers: providerEligibility, treeGraph and the readiness facts each pass the LIVE nodes (orphans out first). */
export function latestByPath(nodes) {
  const m = new Map();
  for (const n of nodes) { const o = m.get(n.node); if (!o || n.generation > o.generation) m.set(n.node, n); }
  return m;
}

/** The newest generation of `path` that a person closed before it was ever registered (c3b), 0 when none. A generation consumed by such a close is not free for a registration. */
export const closedUnstartedGenerationOf = (state, path) => Math.max(0, ...[...(state.closedUnstarted?.keys() ?? [])].map(k => { const m = /^(.*)@g(\d+)$/.exec(k); return m && m[1] === path ? Number(m[2]) : 0; }));

/**
 * The generation a child of a frontier gets: ONE above the newest REGISTERED node of its path that an OLDER generation of the parent proposed (a first split: 1; the split of a replaced parent: above what the dead parent's children had
 * registered), so a replaced parent's children never collide with, or are shown as, the old ones. It counts REGISTERED nodes (state.nodes) and, once a root generation >= 2 is opened, the generations a decision OPENED for the path (S8,
 * state.maxOpened) - never a generation that was only proposed. It is NEVER BELOW THE PARENT'S OWN GENERATION: a replaced parent's descendants are marked stale at the OLD generations (held by the decision), so its new children must not
 * reuse those keys even when nothing was registered. It does not depend on what THIS frontier already registered, so the frontier's key stays the same while its children register.
 */
export function childGenerationOf(state, parentGeneration, childPath) {
  let g = 0;
  for (const x of state.nodes.values()) {
    if (x.node !== childPath) continue;
    const pg = state.frontiers.get(x.frontierKey)?.parentGeneration;
    if (typeof pg === 'number' && pg < parentGeneration) g = Math.max(g, x.generation);
  }
  // S8 (design note 5a, T9b): once a ROOT generation >= 2 is opened, a generation an OLD-era decision OPENED for this path but nobody registered would give the new child the SAME key (and the held stale mark of that old decision): the new child starts above it.
  // Era-2 unit (Era2Frontier_Plan_2026-10-19.md): only openings from BEFORE the newest root opening count. A decision of the CURRENT era opened this number for exactly this replacement, so it registers there (opened == registered; the decision's text reaches its context part 7).
  if ((state.maxOpened?.get('R') ?? 0) >= 2) g = Math.max(g, state.maxOpenedBoundary?.get(childPath) ?? 0);
  // CR-RB-004 (the same hazard below the root): a generation of this path that an OLDER lineage opened before this parent generation was opened (a child regenerate whose replacement nobody approved, then the parent planned
  // again) would give the new child that SAME key, and with it that decision's text as the child's own opening decision (src/tree-derive-load.js openedBy). The new child starts above it. Only openings from BEFORE the parent's
  // opening count: a decision under THIS parent generation opened its number for exactly that replacement, which registers there (as the era rule above). A parent generation never opened (generation 1, or numbered by a split) adds nothing
  for (const o of state.openingsOf?.get(childPath) ?? []) if (openedInReplacedLineage(state, childPath, o.generation, parentGeneration)) g = Math.max(g, o.generation);
  // never below the parent's own generation: a replaced parent's descendants are marked stale at the OLD generations (held by the decision), so its new children must not reuse those keys even when nothing was registered
  return Math.max(parentGeneration, g + 1);
}

/**
 * THE generation a path is at as far as a stop or a decision is concerned (M5 API reviews R13, Astra F4): the newest generation of the path that is registered (live, not an orphan) or that a decision OPENED, and for a
 * path with neither - never registered, or only dead orphans of a replaced parent - the generation the next frontier of its parent registers it at (childGenerationOf over the parent's latest generation). The affected set
 * marks nodes stale at this generation, so the marks and the frontier's preview agree on every path, registered or not.
 */
/**
 * CR-RB-004, the ONE predicate of its three readers: was `node@generation` OPENED before its parent path's generation (`parentGeneration`, by default the newest) was opened? Then it belongs to a replaced lineage: the parent was
 * planned again, the new plan numbers its children above it (childGenerationOf), the stop side does not name it (generationOf), and its replacement frontier is never offered (src/tree-frontier.js findPendingFrontier), so the
 * decision typed for the old child never reaches a node of the new plan. A parent generation never opened (generation 1, or numbered by a split) replaces nothing: a decision under it re-forms its frontier as before.
 */
export function openedInReplacedLineage(state, node, generation, parentGeneration = null) {
  const cut = node.lastIndexOf('/');
  if (cut < 0) return false;
  const parentAt = state.openedAt?.get(`${node.slice(0, cut)}@g${parentGeneration ?? latestGenerationOf(state, node.slice(0, cut))}`);
  const at = state.openedAt?.get(`${node}@g${generation}`);
  return parentAt !== undefined && at !== undefined && at < parentAt;
}
export function generationOf(state, path) {
  const orphans = orphansOf(state);
  // BUG-C-061 (bug audit 2026-10-24): an opened number counts only while NO registered node holds it. A number that a (now dead) node of a replaced parent consumed is not the next registration's: childGenerationOf below gives that (the preview side numbers the child the same way).
  const opened = state.maxOpened?.get(path) ?? 0;
  // CR-RB-004: nor an opening of a replaced lineage (openedInReplacedLineage): the next registration starts above it (childGenerationOf), so the stop side names what the preview names
  let g = opened > 0 && !openedInReplacedLineage(state, path, opened) && ![...state.nodes.values()].some(n => n.node === path && n.generation === opened) ? opened : 0;
  for (const n of state.nodes.values()) if (n.node === path && !orphans.has(`${n.node}@g${n.generation}`)) g = Math.max(g, n.generation);
  if (g > 0) return g;
  const cut = path.lastIndexOf('/');
  if (cut < 0) return 1;
  return childGenerationOf(state, Math.max(1, latestGenerationOf(state, path.slice(0, cut))), path);
}

const newFrontier = () => ({ previewed: false, revisions: [], approvals: [], children: [], splitSha256: null, previewHash: null, blocked: false });

/**
 * Is a frontier's approval valid (PLAN 8.2: a change to the children, the formula or a ceiling invalidates it)? Valid = the latest approval's bound hash equals the latest preview's, and BOTH exist. It FAILS CLOSED: an approval
 * without a hash, with another one, or for a frontier whose preview carried none is invalid (R3b: the table requires the hash on every preview, so there is no "no hash anywhere" case left).
 */
export function approvalValid(frontier) {
  if (!frontier || !frontier.approvals.length) return false;
  if (frontier.blocked) return false;          // a parent_changed stands for this frontier (M5c4): only an approval NEWER than the block makes it valid again
  const last = frontier.approvals[frontier.approvals.length - 1];
  return typeof last.boundSha256 === 'string' && last.boundSha256 === frontier.previewHash;
}

/** Is this node active (PLAN 8.1)? Registered, running, or holding a post-run claim. A stopped node and a closed one are not. */
export const isActive = s => s.phase === PHASES.registered || s.phase === PHASES.running || s.postRun !== null;

/**
 * SG-1 (C&C ruling 20 Okt 2026, REFINED 23 Okt 2026: "a node with no process is NOT active for SG-1"; CnC_M7_Lists.md:175 asked about a RUNNING descendant "while its process lives"): does a process run for this node? Running, or holding a post-run claim.
 * A registered, never-started node has none: regenerating its parent sets it aside as dead and nothing is lost. `isActive` stays the wider reading the other rows use.
 */
export const hasProcess = s => s.phase === PHASES.running || s.postRun !== null;
/** The first node path at or under a listed node (keys `path@gN`) whose process runs, or null. One function for the table row and the decide form's preflight, so what the person is told before typing is what the record would refuse. */
export function racingNodeOf(state, listedKeys, facts = {}) {
  const listedPaths = listedKeys.map(k => splitKey(k).node).filter(n => n !== 'R');
  for (const [key, s] of state.nodes) {
    if (!hasProcess(s)) continue;
    const node = splitKey(key).node;
    if (!listedPaths.some(l => node === l || node.startsWith(`${l}/`))) continue;
    // `gone`: the record says it runs (the PHASE decides, C&C 23 Okt 2026) but its claim's process is not alive on this host: liveness only changes the WORDS, never the transition
    return { node, key, gone: s.phase === PHASES.running && s.postRun === null && !!s.claim && !claimAlive(s.claim, facts) };
  }
  return null;
}
/**
 * The refusal sentence of the SG-1 guard, or null. One function for the table row and the decide form's preflight. A node the record says runs whose process is GONE is told so, with the two real ways out
 * (A-DRAFT; C&C 23 Okt 2026: "liveness informs the person, it never unlocks a transition"): close it; or, when its run folder already holds the end, `council tree resume` records how it ended (tree-close.js:30-31). NOT "resume" alone: a resume of a node with a dead claim and no end CONTINUES the member run (tree-run.js:11, a paid resume), which the person who wants the node set aside does not want. `rootId` names the root run when the caller knows it.
 */
export function racingRefusalOf(state, listedKeys, facts = {}, { rootId = null } = {}) {
  const racing = racingNodeOf(state, listedKeys, facts);
  if (!racing) return null;
  if (!racing.gone) return `node ${racing.node} is active: a sub-plan regenerate never races a running node`;
  const root = rootId ?? '<root run id>';
  return `node ${racing.node} is marked running but its process is gone: a sub-plan regenerate never races a node the record says runs. Close it (\`council tree decide ${root} --close ${racing.key}\`); if its run already ended, \`council tree resume ${root}\` records how it ended first. Then decide again`;
}

/** Is the process behind a claim alive? A claim from another host is never judged stale from here (PLAN 8.3), so it counts as alive. Injectable for tests. */
/** The LIVE registered nodes that are not closed, in record order: the ONE reading of "finished" the person-opened root stop uses (S8-8): the table's row and the form's preflight both call it. A DEAD node (replaced or set aside by a decision, or a node above it was) never closes and does not count. */
export function unfinishedLiveNodes(state) {
  const dead = deadKeys(state);
  return [...state.nodes.values()].filter(x => x.phase !== PHASES.closed && !dead.has(`${x.node}@g${x.generation}`));
}
/**
 * S8-8 fix-up (C&C, 13 Oct 2026; Haiku batch 3 J1-15-1): the LIVE closed nodes whose run ended with the Status needs_decision and whose stop detection has not written yet (the sitting died between the close and its detection). A person's stop
 * waits until they are written: else a re-plan that answers it makes such a node dead and its stop can never be written. The key is the one src/tree-detect.js uses (node, generation, run). -> the nodes, in record order.
 */
export function undetectedDecisionCloses(state) {
  const dead = deadKeys(state);
  return [...state.nodes.values()].filter(n => n.phase === PHASES.closed && n.closedStatus === 'needs_decision' && !dead.has(`${n.node}@g${n.generation}`) && !state.detectedStops.has(`${n.node}@g${n.generation}:${n.runId}`));
}
/** ROADMAP 57: the one sentence every refusal and reader of an abandoned tree says (`state.abandoned`, from the fold). The tree id is the reader's to add. */
export const abandonedSentence = state => `This tree was abandoned by a person (event ${state.abandoned.eventId}, ${state.abandoned.at}). It is final: nothing more is registered, started, approved, decided or checked in it, and it cannot be reopened. What it spent stays counted. To try again, start a new tree: \`council tree start --task <task> --chain <root chain> --child-chain <name> --max-usd <usd>\`.`;
/**
 * ROADMAP 57: the members of the tree a process of THIS host or another host may still be working for: a RUNNING node whose claim is alive (another host's claim is never judged dead from here: claimAlive) or a post-run call whose process is
 * alive. A registered-never-started node, one paused at an external seat, one stopped at its cap and a running node with a DEAD claim are not live. -> [{ key, kind: 'claim' | 'post_run', pid, host }]
 */
export function liveMembersOf(state, facts = {}) {
  const out = [];
  for (const [key, n] of state.nodes) {
    if (n.phase === PHASES.running && n.claim && claimAlive(n.claim, facts)) out.push({ key, kind: 'claim', pid: n.claim.pid, host: n.claim.host });
    if (n.postRun && claimAlive(n.postRun, facts)) out.push({ key, kind: 'post_run', pid: n.postRun.pid, host: n.postRun.host });
  }
  return out;
}
export const claimAlive = (claim, { pidAlive = isPidAlive, host = hostname() } = {}) => !claim || claim.host !== host || pidAlive(claim.pid);
/**
 * ROADMAP 77: the recommendation requests that still hold their grant: not ended. -> [adviceId] in record order. At most ONE is ever unended (the table refuses a second registration).
 * `liveAdviceOf` is the narrower question abandon asks: unended AND its claim alive AND the wait for the brief's approval not expired (`facts.nowMs`, default the clock); an expired or dead request is the reconcile's to end, not a reason to refuse.
 */
export const openAdviceOf = state => [...state.advice.values()].filter(a => !a.ended).map(a => a.adviceId);
/**
 * ROADMAP 77: the ONE release rule for a request nobody answered: not ended, NO call added, and either the wait for the brief's approval has run out (`expired`) or its claim is dead on this host (`never_started`).
 * -> [{ adviceId, reason, returnedUsd }] (the whole grant: nothing was spent). Used by reconcileAdvice (src/tree-advice-record.js) and by planRecovery (src/tree-recovery.js): one copy. A request WITH a call is not decided here
 * (a call may outlive the process that registered it; its folder says whether it ended: reconcileAdvice).
 */
export function unansweredAdviceOf(state, facts = {}) {
  const nowMs = facts.nowMs ?? Date.now();
  return [...state.advice.values()].filter(a => !a.ended && a.runs.length === 0 && (nowMs >= a.expiresAtMs || !claimAlive(a.claim, facts)))
    .map(a => ({ adviceId: a.adviceId, reason: nowMs >= a.expiresAtMs ? 'expired' : 'never_started', returnedUsd: a.grantUsd }));
}
export function liveAdviceOf(state, facts = {}) {
  const nowMs = facts.nowMs ?? Date.now();
  return [...state.advice.values()].filter(a => !a.ended && claimAlive(a.claim, facts) && nowMs < a.expiresAtMs).map(a => ({ adviceId: a.adviceId, pid: a.claim.pid, host: a.claim.host }));
}

const refuse = (event, reason) => ({ code: 'transition_refused', transition: event.event, reason });

/** The body-history entry a plan carried when something was built from it: for each source { node, generation } the id of the newest plan_accepted (a revert is one) in the record, or null when none. REBUILD (gate page 14, C&C condition A). */
export function builtFromOf(state, sources) {
  return sources.map(x => {
    const last = state.nodes.get(`${x.node}@g${x.generation}`)?.bodyHistory?.at(-1);
    return { node: x.node, generation: x.generation, eventId: last ? last.eventId : null };
  });
}

/**
 * REBUILD (gate page 14, C&C condition A): the plan-body changes a node's input bundle has NOT seen. The bundle records `builtFrom` (the plans whose text entered it, with the newest body event of each at that moment: written from what the derivation consumed, src/tree-derive.js
 * `sources`); a plan whose newest body event is NEWER than the recorded one has changed since (an accept, or a revert to the signed text: both are plan_accepted). -> [{ node, generation, eventId, acceptedBodySha256 }]. ONE function: the rebuild asks it for its trigger, the table for what `because`
 * must name, the locked start for its refusal. A node registered before this unit has no `builtFrom`: it is read as its parent (at the generation its frontier names) and its `dependsOn`, each built at the node's last `node_registered` / `node_bundle_rebuilt`.
 */
export function bodyEventsNewerThanBuild(state, n) {
  const idNum = id => Number(String(id).slice(1)) || 0;
  let sources = n.builtFrom;
  if (!Array.isArray(sources)) {
    sources = [];
    const f = state.frontiers.get(n.frontierKey);
    if (typeof n.parentNode === 'string' && typeof f?.parentGeneration === 'number') sources.push({ node: n.parentNode, generation: f.parentGeneration, eventId: n.builtAtId });
    for (const d of Array.isArray(n.dependsOn) ? n.dependsOn : []) sources.push({ node: d.node, generation: d.generation, eventId: n.builtAtId });
  }
  const out = [];
  for (const src of sources) {
    const last = state.nodes.get(`${src.node}@g${src.generation}`)?.bodyHistory?.at(-1);
    if (last && idNum(last.eventId) > idNum(src.eventId)) out.push({ node: src.node, generation: src.generation, eventId: last.eventId, acceptedBodySha256: last.accepted });
  }
  return out.sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation));
}

/**
 * ONE condition, in one place (M5c5): the only active node is a child of THIS frontier AND is idle: registered and not started, or interrupted (its claim's process is gone on this host). A child whose process is alive is running and blocks. A frontier is previewed and approved when nothing is active, OR when that is
 * all that is: approving again (a parent_changed block, a figure that moved) writes no paid event, and without this the block could never be lifted while its own child sits registered. Used by the table
 * (`frontier_previewed`) and by `tree approve` (src/tree-approve.js).
 */
export const activeIsOwnChild = (state, frontierKey, facts = {}) => {
  const n = state.active !== null ? state.nodes.get(state.active) : null;
  if (!n || n.frontierKey !== frontierKey || n.postRun) return false;
  return !(n.phase === PHASES.running && n.claim && claimAlive(n.claim, facts));       // a node whose process is alive is RUNNING, not waiting: nothing is re-approved under it
};

/**
 * The PLAN 8.5 table. null when `event` may be appended to a record that folds to `state`, else { code, transition, reason }. `facts.pidAlive` and `facts.host` are injectable.
 * Records that are not node transitions (blocked, guard_refused, integration_recorded, accounting_accepted, reservation_mirrored, readiness) are always allowed and never make a node active.
 */
/** K10: who answered, as the fold carries it: { actor, via, reason } from the event, or null when the record predates the field (never read as a person). */
const answeredByOf = e => (e.actor === 'person' || e.actor === 'session') ? { actor: e.actor, via: isStr(e.via) ? e.via : null, reason: isStr(e.reason) ? e.reason : null } : null;
/** K10: the ONE phrase every reader uses for a decision's or an approval's `answeredBy` (B-DRAFT; the readers wire it in C4). A record without the field says so; it is never shown as a person's answer. */
export const answeredByPhrase = rec => {
  const a = rec?.answeredBy ?? null;
  if (!a) return 'unknown (before the field)';
  if (a.actor === 'person') return a.via === 'elicitation' ? 'a person, through a dialog' : 'a person at the terminal';
  return `the session (reason: ${a.reason ?? 'none recorded'})`;
};
/**
 * K10 (C2a-record commit 5): WHO answered. ONE function for every gate-bound row of the table, so no row can forget a part of it. -> null | a refusal sentence (B-DRAFT: the four sentences are read by a person when a writer is refused).
 * `actor` is required (a new event without it is refused: a later writer that forgets it cannot produce a record that reads as a person's), `via` must be a channel that actor can use, and the session's answer carries its written reason.
 * `sessionAllowed` is true only for the forms Atomic_Tree_Budget_Gate_Page section 4 lets the session answer (a frontier approval of a split, a top-up); every other row is a person's.
 * The table cannot read the gate ledger; the VALUE comes from the one gate read that spends the approval (src/tree-gate.js recordTreeUse), never from a verb caller.
 */
export function answeredByRefusal(event, { sessionAllowed = false } = {}) {
  if (event.actor !== 'person' && event.actor !== 'session') return 'an answer to a gate records who gave it (actor: person or session); without it nobody can tell whether a person answered';
  if (!ANSWER_VIAS[event.actor].includes(event.via)) return `an answer by ${event.actor === 'person' ? 'a person' : 'the session'} names its channel (${ANSWER_VIAS[event.actor].join(' or ')})`;
  if (event.actor === 'session') {
    if (!sessionAllowed) return 'this answer is a person\'s only: the session cannot give it';
    if (!isStr(event.reason) || !event.reason.trim()) return 'the session\'s answer or request carries its written reason: none was given';
  }
  return null;
}
export function transitionRefusal(state, event, facts = {}) {
  const name = event.event;
  // ROADMAP 57, FIRST LINE (before the unreadable-report check below and the RECORDS return, so an abandoned tree always gets this one sentence): once abandoned, every event but the three plain records is refused
  if (state.abandoned && !['blocked', 'guard_refused', 'reservation_mirrored', 'advice_reservation_mirrored'].includes(name)) return refuse(event, abandonedSentence(state));
  const RECORDS = ['blocked', 'guard_refused', 'integration_recorded', 'accounting_accepted', 'reservation_mirrored', 'advice_reservation_mirrored', 'readiness'];
  if (name === 'accounting_accepted' && event.unreadableReports !== undefined) {
    // an acceptance of an unreadable report names a member of THIS tree and carries the key the gate gave that problem (`<run id>:report.json`); the figure itself is the writer's, re-read under the lock
    for (const u of event.unreadableReports) {
      if (![...state.nodes.values()].some(x => x.runId === u.runId) && ![...state.advice.values()].some(x => x.runs.some(r => r.runId === u.runId))) return refuse(event, `the unreadable report of ${u.runId} is accepted for a run that is not a member of this tree`);
      if (!Array.isArray(event.reservationIds) || !event.reservationIds.includes(`${u.runId}:report.json`)) return refuse(event, `the acceptance of the unreadable report of ${u.runId} names the key ${u.runId}:report.json`);
    }
  }
  // K10: these two plain records are a person's answer only once they claim a gate (a bare event is ignored by the readers, which count only a complete one); then they say who answered
  if ((name === 'accounting_accepted' || name === 'integration_recorded') && isStr(event.gateId)) { const bad = answeredByRefusal(event); if (bad) return refuse(event, bad); }
  if (RECORDS.includes(name)) return null;
  const key = event.node !== undefined ? `${event.node}@g${event.generation}` : null;
  const n = key ? state.nodes.get(key) : null;
  const sticky = [...state.sticky.keys()];
  const otherActive = state.active !== null && state.active !== key;
  if (name === 'tree_started') return state.started ? refuse(event, 'the tree is already started') : null;
  if (!state.started) return refuse(event, 'the tree has not started (no tree_started yet)');
  // No paid start or resume runs anywhere in the tree while the record is corrupt, an ancestor changed, the root is affected, or accounting is blocked (PLAN 4.3, 7.6).
  const paid = ['node_registered', 'node_started', 'node_resumed', 'advice_registered', 'advice_run_added'].includes(name);
  if (paid && sticky.length) return refuse(event, `the tree is blocked: ${sticky.join(', ')}`);
  switch (name) {
    case 'frontier_previewed':
      // R3b (M5 API reviews, Opus 3-2): the bound hash is REQUIRED on every preview (an approval is valid only against it); with none there would be nothing for an approval to be compared with
      if (!isStr(event.boundSha256)) return refuse(event, 'a frontier preview carries the hash of the text it binds (boundSha256); without it no approval could be checked against it');
      if (event.kind === 'root_replan') {
        // S8 (design note 3.3): the frontier of a ROOT replacement has no parent, and it is opened by a decision that re-plans the root and has opened ITS generation; it lists exactly that one root generation, still the newest and not registered
        if (!(event.parentNode === null && event.parentGeneration === null && event.parentRunId === null && event.splitSha256 === null)) return refuse(event, 'a root replacement frontier has no parent (parentNode, parentGeneration, parentRunId and splitSha256 are null)');
        const d = isStr(event.openedBy) ? state.decisions.get(event.openedBy) : null;
        if (!d || !d.replansRoot || !d.opened) return refuse(event, `a root replacement frontier is opened by a decision that re-plans the root and has opened its generation (openedBy ${JSON.stringify(event.openedBy ?? null)} is not one)`);
        const want = d.opened.find(o => o.node === 'R');
        if (!want || event.children.length !== 1 || event.children[0].node !== 'R' || event.children[0].generation !== want.generation) return refuse(event, `a root replacement frontier lists exactly the root generation its decision opened (R@g${want?.generation ?? '?'})`);
        if (latestGenerationOf(state, 'R') !== want.generation || [...state.nodes.values()].some(s => s.node === 'R' && s.generation === want.generation)) return refuse(event, `R@g${want.generation} is superseded or already registered`);
      } else if (event.parentNode === null || event.parentGeneration === null || event.parentRunId === null || event.splitSha256 === null) return refuse(event, 'a split frontier names its parent and the split it was proposed from (parentNode, parentGeneration, parentRunId, splitSha256)');
      // K8: a root replacement frontier adopts nothing; a split frontier's `reused` entries obey the slot rule
      if (event.kind === 'root_replan' && event.children.some(c => c.reused)) return refuse(event, 'a root replacement frontier adopts nothing (its child is the new root plan)');
      if (event.kind !== 'root_replan') { const bad = reusedRefusal(state, event.frontierKey, event.children); if (bad) return refuse(event, bad); }
      return state.active !== null && !activeIsOwnChild(state, event.frontierKey, facts) ? refuse(event, `node ${state.active} is active; a frontier is previewed when nothing is (or when the only active node is one of its own children)`) : null;
    case 'held_released': {
      // X2 (contract section 5): only a re-planned root (generation >= 2) that is closed has held children to release, and only keys that are held now
      const root = [...state.nodes.values()].filter(x => x.node === 'R').sort((a, b) => b.generation - a.generation)[0];
      if (!root || root.generation < 2) return refuse(event, 'no root re-plan has replaced the root: there are no held nodes to release');
      if (root.phase !== PHASES.closed) return refuse(event, `the new root plan R@g${root.generation} is ${root.phase}: held nodes are released only once it is closed`);
      const held = heldKeys(state);
      const notHeld = (event.nodes ?? []).filter(k => !held.has(k));
      return notHeld.length ? refuse(event, `${notHeld.join(', ')} ${notHeld.length === 1 ? 'is' : 'are'} not held`) : null;
    }
    case 'frontier_approved':
      if (!state.frontiers.get(event.frontierKey)?.previewed) return refuse(event, 'no frontier_previewed for that frontier key');
      // R3 (M5 API reviews, three of three): an approval is a person's decision, never a bare record. It carries the gate whose approval it spends and the hash of the text read (like grant_issued, decision_recorded, accounting_accepted)
      if (!(isStr(event.gateId) && isStr(event.shownSha256))) return refuse(event, 'a frontier approval carries the gate whose approval authorized it and the hash of the text read (gateId, shownSha256); without them it is not an approval');
      // K10: who answered. The session may answer a split frontier (inside the typed cap, A's section 4); a frontier whose children do not derive from the verified split (a root replacement) is the person's (Muad's packet-3 answer 4)
      { const bad = answeredByRefusal(event, { sessionAllowed: state.frontiers.get(event.frontierKey).kind !== 'root_replan' }); if (bad) return refuse(event, bad); }
      if (event.actor === 'session') {       // the Atomic conditions the record can hold (src/tree-approve-session.js checks the rest before it asks): a first approval of a split frontier, with the figures the writer saw. B-DRAFT sentences
        const f0 = state.frontiers.get(event.frontierKey); const sc = event.sessionConditions;
        if (f0.revisions.length > 0) return refuse(event, 'a re-approval of a frontier is the person\'s: the session approves a frontier once');
        if (!isObj(sc) || !Number.isFinite(sc.availableUsd) || !Number.isFinite(sc.grantsUsd) || sc.unknownSpendHeldUsd !== 0) return refuse(event, 'a frontier approval by the session carries the figures it saw (sessionConditions: availableUsd, grantsUsd, unknownSpendHeldUsd 0)');
        if (sc.grantsUsd > sc.availableUsd + 1e-9) return refuse(event, `the session approves a frontier only when its grants (${sc.grantsUsd}) are within the free amount (${sc.availableUsd})`);
      }
      {  // K8, STALE = a candidate the bound preview adopts stopped being free since the preview (another frontier's approval adopted it, or the tree was abandoned): the record-level backstop behind the writer's re-describe (tree-approve R15)
        const f = state.frontiers.get(event.frontierKey);
        if (f.kind !== 'root_replan' && f.previewHash === (event.boundSha256 ?? null)) { const bad = reusedRefusal(state, event.frontierKey, f.children); if (bad) return refuse(event, `the approval is stale: ${bad}`); }
      }
      return null;
    case 'node_bundle_rebuilt': {
      // a DEAD node (replaced or set aside by a decision, or a node above it was) is never rebuilt: its start is refused as dead, and a rebuild would write files for a child that cannot run. A HELD node (pending the new root plan) is not rebuilt either: the due change stays on the record and the sitting after the hold rebuilds.
      if (deadKeys(state).has(key)) return refuse(event, `${key} is dead (${DEAD_REASON}): its input is never rebuilt`);
      if (heldKeys(state).has(key)) return refuse(event, `${key} is ${heldPhraseOf(state, key)}: its input is not rebuilt${keptKeys(state).has(key) ? '' : ' until the hold is released'}`);
      if (!n) return refuse(event, `${key} is not registered`);
      if (n.phase !== PHASES.registered) return refuse(event, `${key} has started: the input of a node that started is the one its run read, and only a node that has not started is rebuilt`);
      if (event.runId !== n.runId) return refuse(event, `${key}'s run is ${n.runId}, not ${String(event.runId)}`);
      if (event.previousBundleSha256 !== n.bundleSha256) return refuse(event, `the event names the previous input bundle ${String(event.previousBundleSha256).slice(0, 12)}, the record holds ${String(n.bundleSha256 ?? 'none').slice(0, 12)}`);
      for (const f of ['grant', 'chain', 'obligations', 'dependsOn', 'splitSha256']) if (event[f] !== undefined) return refuse(event, `a rebuild changes the text of an input and nothing else: it carries no ${f}`);
      const due = bodyEventsNewerThanBuild(state, n);
      if (!due.length) return refuse(event, `no plan that ${key}'s input quotes has been accepted or put back since the input was built, so there is nothing to rebuild it from`);
      const sig = list => JSON.stringify(list.map(b => `${b.node}@g${b.generation}:${b.eventId}:${b.acceptedBodySha256}`).sort());
      if (sig(event.because) !== sig(due)) return refuse(event, `the rebuild must name exactly the newest plan change of each plan the input quotes (${due.map(b => `${b.node}@g${b.generation}:${b.eventId}`).join(', ')}), with the text each one holds`);
      // a rebuild keeps watching every plan the earlier bundle was built from: one that drops a watched plan would never be told of a later change to it (the case the page question calls losing a state)
      if (Array.isArray(n.builtFrom)) { const keyOfB = b => `${b.node}@g${b.generation}`; const have = new Set(event.builtFrom.map(keyOfB)); const lost = n.builtFrom.map(keyOfB).filter(k => !have.has(k)); if (lost.length) return refuse(event, `the rebuild drops ${lost.join(', ')}, a plan the input was built from: it stays watched`); }
      if (JSON.stringify(builtFromOf(state, event.builtFrom)) !== JSON.stringify(event.builtFrom)) return refuse(event, 'the rebuild records the plans it was built from with their newest changes, and those are not the ones the record holds now');
      if (sticky.length) return refuse(event, `the tree is blocked: ${sticky.join(', ')}`);
      return null;
    }
    case 'split_verified':      // a record that the node's plan holds a verified split (M3): it moves no node, but it names a node that exists, and a node@generation holds ONE (M5f (a))
      if (!n) return refuse(event, `${key} is not registered`);
      return n.verifiedSplit ? refuse(event, `${key} already has a verified split (${String(n.verifiedSplit.sha).slice(0, 12)}): the record never holds two for one node and generation`) : null;
    case 'node_registered': {
      if (n) return refuse(event, `${key} is already registered`);
      if (state.closedUnstarted.has(key)) return refuse(event, `${key} was closed by a person before it started: it is never registered (a new generation of it is)`);
      if (state.active !== null) return refuse(event, `node ${state.active} is active; registration is one node at a time`);
      if (event.node === 'R' && event.generation === 1) {            // row R1 (unchanged)
        if ([...state.nodes.values()].some(s => s.node === 'R')) return refuse(event, 'the root is already registered');
        if (event.parentNode !== null || event.frontierKey !== null || event.depth !== 0) return refuse(event, 'the root is node R, generation 1, depth 0, with no parent and no frontier');
        if (event.runId !== state.treeId) return refuse(event, `the root run is the tree itself: its run id is the tree id ${state.treeId}, not ${event.runId}`);
        return null;
      }
      if (event.node === 'R') {                                       // row R2 (S8): a root generation >= 2, registered after its decision opened it and its replacement frontier was approved
        const roots = [...state.nodes.values()].filter(s => s.node === 'R').sort((a, b) => b.generation - a.generation);
        if (!roots.length) return refuse(event, 'the root generation 1 is not registered yet');
        if (event.generation !== latestGenerationOf(state, 'R') || event.generation <= roots[0].generation) return refuse(event, `${key} is not the root generation a decision opened (the newest is R@g${latestGenerationOf(state, 'R')}, the newest registered R@g${roots[0].generation})`);
        if (event.parentNode !== null || event.depth !== 0) return refuse(event, 'a root generation has depth 0 and no parent');
        if (!isStr(event.frontierKey)) return refuse(event, 'a root generation is registered under the root replacement frontier that was approved for it (frontierKey)');
        const rf = state.frontiers.get(event.frontierKey);
        if (!rf || rf.kind !== 'root_replan' || !rf.revisions.length) return refuse(event, 'no frontier_approved for that root replacement frontier');
        if (!approvalValid(rf)) return refuse(event, 'the approval for that root replacement frontier is no longer valid (what it bound has changed)');
        if (!rf.children.some(c => c.node === 'R' && c.generation === event.generation)) return refuse(event, `${key} is not the root generation of that frontier`);
        if (!RUN_FOLDER.test(String(event.runId)) || event.runId === state.treeId || [...state.nodes.values()].some(s => s.runId === event.runId)) return refuse(event, `the run id ${event.runId} of ${key} is a fresh run folder id: not the tree id and not a run the tree already holds`);
        if (event.replacesRunId !== roots[0].runId) return refuse(event, `${key} replaces the run ${roots[0].runId} (R@g${roots[0].generation}), not ${event.replacesRunId ?? 'none'} (replacesRunId)`);
        if (!isStr(event.bundleSha256) || !isStr(event.taskSha256)) return refuse(event, `${key}: a root generation is registered with the sha256 of its input bundle and of the task bytes it was planned from (bundleSha256, taskSha256)`);
        return null;
      }
      if (![...state.nodes.values()].some(s => s.node === 'R')) return refuse(event, 'the root is not registered yet');
      if (event.parentNode === null || event.frontierKey === null) return refuse(event, 'a child names its parent and its frontier');
      const f = state.frontiers.get(event.frontierKey);
      if (!f || !f.revisions.length) return refuse(event, 'no frontier_approved for that frontier key');
      if (!approvalValid(f)) return refuse(event, 'the approval for that frontier key is no longer valid (what it bound has changed, or it carries no hash while the preview does)');
      if (!f.children.some(c => c.node === event.node && c.generation === event.generation)) return refuse(event, `${key} is not a child of that frontier`);
      const heldBy = slotHeldBy(state, key);
      if (heldBy !== null) return refuse(event, `${key} is filled by the finished run ${heldBy}: a slot a finished run fills is never registered fresh (plan the adopting parent or the slot again to free it)`);       // C2b-2 money fix-up 2
      if (isSupersededGeneration(state, event.node, event.generation)) return refuse(event, `${key} is superseded: a newer generation of ${event.node} is registered or opened`);
      if (frontierParentReplaced(state, f)) return refuse(event, `${key} belongs to a frontier of ${event.parentNode}@g${f.parentGeneration}, which was replaced: its new split is the one that counts`);
      const retiredBy = retiredParentBy(state, f);
      if (retiredBy !== null) return refuse(event, `${key} belongs to a frontier of ${f.parentNode}@g${f.parentGeneration}, which decision ${retiredBy} replaced or set aside: an approval given before that decision registers nothing more`);       // B-DRAFT (money fix-up 3)
      return null;
    }
    case 'node_started':
      if (!n) return refuse(event, `${key} is not registered`);
      if (n.phase !== PHASES.registered) return refuse(event, `${key} is ${n.phase}; node_started is the first claim of a registered node`);
      if (event.runId !== n.runId) return refuse(event, `run ${event.runId} is not the run registered for ${key} (${n.runId})`);
      // S8 (C&C, af0bdd4 follow-up): budgetOf releases a dead node's hold in every phase but running and closed, so every record that would make a dead node SPEND again is refused here, once, for every caller
      if (deadKeys(state).has(key)) return refuse(event, `${key} is dead (${DEAD_REASON}): it is never started`);
      // S8 held state, as in node_resumed: deadKeys leaves a HELD key out, so a registered, never-started node under a held parent needs its own line (fix-up 4, money backstop; the sentence is B-DRAFT)
      if (heldKeys(state).has(key)) return refuse(event, `${key} is ${heldPhraseOf(state, key)}: it is not started`);
      const retiredStart = retiredNodeOrParentBy(state, n);
      if (retiredStart !== null) return refuse(event, `${key} was replaced or set aside by decision ${retiredStart} (or its parent was): it is never started`);       // B-DRAFT (money fix-up 3, start)
      return null;
    case 'node_stopped':
      if (!n || n.phase !== PHASES.running) return refuse(event, `${key} is not running`);
      return null;
    case 'grant_issued':
      if (!(n && n.phase === PHASES.stopped)) return refuse(event, `${key} is not stopped; a top-up follows a budget stop`);
      // S8 G8 (defence in depth behind the CLI's R10 refusal in tree-decide.js): a dead node is never resumed, so a top-up would promise a resume that cannot happen
      if (deadKeys(state).has(key)) return refuse(event, `${key} is dead (${DEAD_REASON}): a top-up would promise a resume that cannot happen`);
      if (!(isStr(event.gateId) && isStr(event.shownSha256))) return refuse(event, `${key}: a top-up carries the gate whose approval authorized it and the hash of the text read (gateId, shownSha256); without them it is not a grant`);
      { const bad = answeredByRefusal(event); return bad ? refuse(event, `${key}: ${bad}`) : null; }     // K10: a top-up is a person's only (Muad 14 Okt 12:22: "a top-up or cap raise stays typed"; 6d ruling 19 Okt; OLD: the session may answer it inside the typed cap)
    case 'node_choice': {
      // member verb, the record-side half of the verb's refusals (the file-side half, the round stop itself and an already consumed choice, is src/tree-choice.js): a choice is about a RUNNING node whose run is the registered one, whose claim is dead,
      // and that is neither dead nor held (a choice would promise a resume that cannot happen)
      if (!n) return refuse(event, `${key} is not registered`);
      if (deadKeys(state).has(key)) return refuse(event, `${key} is dead (${DEAD_REASON}): a choice would promise a resume that cannot happen`);
      if (heldKeys(state).has(key)) return refuse(event, `${key} is ${heldPhraseOf(state, key)}: it is neither resumed nor given a choice`);
      if (event.runId !== n.runId) return refuse(event, `run ${event.runId} is not the run registered for ${key} (${n.runId})`);
      if (n.phase !== PHASES.running) return refuse(event, `${key} is ${n.phase}; a choice is for a node stopped at its overseer limit, which stays running`);
      if (claimAlive(n.claim, facts)) return refuse(event, `${key} is running (pid ${n.claim?.pid} is alive)`);
      // the conflict choice carries its picks and names a conflict stop; the overseer-limit choices carry neither (a conflict stop id never names a round limit)
      if (event.choice === 'prevail' && (!Array.isArray(event.picks) || !event.picks.length || !/^conflict:/.test(event.stop))) return refuse(event, `${key}: a conflict choice names a conflict stop and carries one pick for every conflict the decider asked about`);
      if (event.choice !== 'prevail' && (event.picks !== undefined || /^conflict:/.test(event.stop))) return refuse(event, `${key}: only a conflict choice carries picks or names a conflict stop`);
      return null;
    }
    case 'node_resumed': {
      if (!n) return refuse(event, `${key} is not registered`);
      if (otherActive) return refuse(event, `node ${state.active} is active`);
      if (event.runId !== n.runId) return refuse(event, `run ${event.runId} is not the run registered for ${key} (${n.runId})`);
      // both purposes (resume and post_run) would spend money on a replaced plan (a post-run call is the paid handoff --from-run: work on the plan). For a registered or stopped node budgetOf released its hold; for a running node whose claim is gone the hold is KEPT (a dead node is closed by the person: `decide --close <node>@g<n>`)
      if (deadKeys(state).has(key)) return refuse(event, `${key} is dead (${DEAD_REASON}): it is never ${event.purpose === 'post_run' ? 'given a post-run call' : 'resumed'}`);
      // S8 held state: a HELD node (its plan's fate is pending the new root plan) makes no call of either purpose - a post-run call is a paid call on a finished run
      if (heldKeys(state).has(key)) return refuse(event, `${key} is ${heldPhraseOf(state, key)}: it is neither resumed nor given a post-run call`);
      const retiredResume = retiredNodeOrParentBy(state, n);
      if (retiredResume !== null) return refuse(event, `${key} was replaced or set aside by decision ${retiredResume} (or its parent was): it is never ${event.purpose === 'post_run' ? 'given a post-run call' : 'resumed'}`);       // B-DRAFT (money fix-up 3, resume)
      if (event.purpose === 'post_run') {
        if (n.phase !== PHASES.closed) return refuse(event, `${key} is ${n.phase}; a post-run call follows a closed node`);
        return n.postRun ? refuse(event, `${key} already has a post-run call in flight`) : null;
      }
      if (n.phase === PHASES.stopped) return null;
      if (n.phase === PHASES.running && !claimAlive(n.claim, facts)) return null;       // the node re-claims itself when its own earlier claim's process is dead
      return refuse(event, n.phase === PHASES.running ? `${key} is running (pid ${n.claim?.pid} is alive)` : `${key} is ${n.phase}; resume follows a budget stop or a dead claim`);
    }
    // c3b: the close of a child that was NEVER registered. DEAD KEY, decided here (the scan test names it in ACCEPTS): a dead key is NOT refused. The close kills nothing - the child was never registered, so nothing runs, nothing is spent and
    // nothing is returned - and it is the only exit of an open `bundle_input` stop whose child's plan was replaced meanwhile (a stop with no exit would be a self-lock); the stop is answered by the same event either way.
    case 'node_closed_unstarted': {
      if (!isNodePath(event.node) || !isGen(event.generation)) return refuse(event, 'the close of a child that never started names the child (node, generation)');
      if (n) return refuse(event, `${key} is registered: a registered node is closed with its run (node_closed), not here`);
      if (state.closedUnstarted.has(key)) return refuse(event, `${key} is already closed`);
      const meta = isStr(event.stopId) && state.openStops.includes(event.stopId) ? state.stopMeta.get(event.stopId) : null;
      if (!meta || meta.source !== 'bundle_input') return refuse(event, `a close before a start answers an open stop of the input kind (stopId ${JSON.stringify(event.stopId ?? null)} is not one)`);
      const target = meta.child ?? { node: meta.node, generation: meta.generation };
      if (target.node !== event.node || target.generation !== event.generation) return refuse(event, `stop ${event.stopId} is about ${target.node}@g${target.generation}, not ${key}`);
      if (!isStr(event.gateId) || !isStr(event.shownSha256)) return refuse(event, `${key}: a close by a person carries the gate whose approval authorized it and the hash of the text read (gateId, shownSha256)`);
      { const bad = answeredByRefusal(event); if (bad) return refuse(event, `${key}: ${bad}`); }     // K10: a close is a person's
      return null;
    }
    // T-b: the allowance for a child that was never registered. Like the close of such a child it answers an OPEN `bundle_input` stop about THIS child; unlike it, it keeps the child alive, so it refuses what the registration could not use: a stop recorded
    // on the ROOT for a node other than the child it names, a stop that also holds key-scan findings (a tree takes no override of the key scan), a type the stop did not find, and a second allowance for one key.
    case 'price_answered': {
      // PRICE ANSWER (Muad 19 Okt: "the controller session finds the price"): the session adds or RAISES one price row for EVERY run in the project; never lowers one; the source is cited. Money boundary: this event moves no grant and no hold (a top-up stays typed). B-DRAFT sentences
      if (!isStr(event.gateId) || !isStr(event.shownSha256)) return refuse(event, 'a price answer carries the gate whose approval authorized it and the hash of the text read (gateId, shownSha256)');
      { const bad = answeredByRefusal(event, { sessionAllowed: true }); if (bad) return refuse(event, bad); }
      if (state.nodes.get(`${event.node}@g${event.generation}`)?.runId !== event.runId) return refuse(event, `a price answer names the member it unblocks: ${event.node}@g${event.generation} with run ${event.runId} is not in this tree`);
      if (event.after.in !== event.inUsdPerM || event.after.out !== event.outUsdPerM) return refuse(event, 'the price answer\'s figures are the row it wrote (after)');
      if (event.before !== 'none' && (event.after.in < event.before.in || event.after.out < event.before.out)) return refuse(event, `a price is added or raised, never lowered (${event.model})`);
      return null;
    }
    case 'stop_draft_written': {
      // GAP A (A-DRAFT sentences): the SESSION hands the person a draft for an open stop of the ROOT. Nothing is decided, answered or spent; the scans of text and reason are the callers' (the draft step and the terminal), as for every other text, so the table judges the record only.
      if (!isStr(event.stopId) || !state.openStops.includes(event.stopId)) return refuse(event, `a draft is for an open stop (stopId ${JSON.stringify(event.stopId ?? null)} is not one)`);
      if (state.stopMeta.get(event.stopId)?.node !== 'R') return refuse(event, `stop ${event.stopId} is not a stop of the root: the session answers a sub-plan stop itself, and a draft is for the root re-plan, which a person approves`);
      if (event.actor !== 'session') return refuse(event, 'only the session writes a draft: a person types the decision');
      { const bad = answeredByRefusal(event, { sessionAllowed: true }); if (bad) return refuse(event, bad); }
      if (!isStr(event.reason) || !event.reason.trim()) return refuse(event, 'a draft carries the session\'s written reason');
      if (!isStr(event.text) || !event.text.trim()) return refuse(event, 'a draft carries its text');
      if (event.sha256 !== createHash('sha256').update(event.text, 'utf8').digest('hex')) return refuse(event, 'the draft\'s sha256 is not the hash of its text');
      return null;
    }
    case 'stop_draft_change_asked': {
      // GAP A (A-DRAFT sentences): the person's request for a change of the newest draft of an open ROOT stop; the scans of the text are the terminal's (the caller).
      if (!isStr(event.stopId) || !state.openStops.includes(event.stopId)) return refuse(event, `a change request is for an open stop of the root (stopId ${JSON.stringify(event.stopId ?? null)} is not one)`);
      if (state.stopMeta.get(event.stopId)?.node !== 'R') return refuse(event, `stop ${event.stopId} is not a stop of the root`);
      if (event.actor !== 'person' || event.via !== 'terminal') return refuse(event, 'a change request is the person\'s act at the terminal');
      { const bad = answeredByRefusal(event, { sessionAllowed: false }); if (bad) return refuse(event, bad); }
      if (!isStr(event.text) || !event.text.trim()) return refuse(event, 'a change request carries the person\'s words');
      if (state.drafts.get(event.stopId)?.id !== event.draftId) return refuse(event, `${event.draftId} is not the newest draft of stop ${event.stopId}`);
      return null;
    }
    case 'stop_deferred': {
      // the SESSION hands an open stop to the person with named condition codes (never the agent's feeling); it decides nothing, spends nothing and answers nothing. B-DRAFT sentences
      if (!isStr(event.stopId) || !state.openStops.includes(event.stopId)) return refuse(event, `a deferral names an open stop (stopId ${JSON.stringify(event.stopId ?? null)} is not one)`);
      if (event.actor !== 'session') return refuse(event, 'only the session defers a stop to the person: a person answers it');
      { const bad = answeredByRefusal(event, { sessionAllowed: true }); if (bad) return refuse(event, bad); }
      if (!isStr(event.reason) || !event.reason.trim()) return refuse(event, 'a deferral carries the session\'s written reason');
      if (state.deferred.has(event.stopId)) return refuse(event, `stop ${event.stopId} was already deferred to the person`);
      return null;
    }
    case 'bundle_input_allowed': {
      if (!isNodePath(event.node) || !isGen(event.generation)) return refuse(event, 'the allowance for a child that never started names the child (node, generation)');
      if (deadKeys(state).has(key)) return refuse(event, `${key} is dead (${DEAD_REASON}): an allowance for it would never be used`);
      if (heldKeys(state).has(key)) return refuse(event, `${key} is ${heldPhraseOf(state, key)}: no allowance is recorded for it`);
      if (n) return refuse(event, `${key} is registered: its input was already accepted`);
      if (state.closedUnstarted.has(key)) return refuse(event, `${key} was closed by a person before it started`);
      if (state.piiAllowed.has(key)) return refuse(event, `${key} already has an allowance`);
      const meta = isStr(event.stopId) && state.openStops.includes(event.stopId) ? state.stopMeta.get(event.stopId) : null;
      if (!meta || meta.source !== 'bundle_input') return refuse(event, `an allowance answers an open stop of the input kind (stopId ${JSON.stringify(event.stopId ?? null)} is not one)`);
      // a stop recorded on the ROOT (a model-written root plan carries the finding into the child's input; `child` names the unregistered node) is answered through the CHILD's key like any other (C&C ruling (c): the allowance for a root's own task covers that text only)
      const target = meta.child ?? { node: meta.node, generation: meta.generation };
      if (target.node !== event.node || target.generation !== event.generation) return refuse(event, `stop ${event.stopId} is about ${target.node}@g${target.generation}, not ${key}`);
      if (meta.otherFindings) return refuse(event, `stop ${event.stopId} also holds key-shaped text, which a tree takes no override for: an allowance cannot answer it`);
      if (!Array.isArray(event.types) || event.types.some(t => !(meta.piiTypes ?? []).includes(t))) return refuse(event, `${key}: the allowance names a type the stop did not find (found: ${(meta.piiTypes ?? []).join(', ') || 'none'})`);
      if (!isStr(event.gateId) || !isStr(event.shownSha256)) return refuse(event, `${key}: an allowance by a person carries the gate whose approval authorized it and the hash of the text read (gateId, shownSha256)`);
      { const bad = answeredByRefusal(event); if (bad) return refuse(event, `${key}: ${bad}`); }
      return null;
    }
    case 'node_released':
      return n && n.postRun ? null : refuse(event, `${key} has no post-run call to release`);
    case 'node_closed':
      if (!n) return refuse(event, `${key} is not registered`);
      if (n.postRun || n.phase === PHASES.closed) return refuse(event, `${key} is ${n.postRun ? 'in a post-run call' : 'already closed'}`);
      if (n.phase === PHASES.registered && event.outcome !== 'incomplete') return refuse(event, `${key} never started; only a person ends it, as incomplete`);
      // `incomplete` is the outcome only a person writes (a run's own end is passed / not_passed): through the gate, never bare (M5d, src/tree-close.js)
      if (event.outcome === 'incomplete' && !(isStr(event.gateId) && isStr(event.shownSha256))) return refuse(event, `${key}: a close by a person carries the gate whose approval authorized it and the hash of the text read (gateId, shownSha256)`);
      if (event.outcome === 'incomplete') { const bad = answeredByRefusal(event); if (bad) return refuse(event, `${key}: ${bad}`); }     // K10: a close by a person says who answered
      return null;
    case 'needs_decision_opened':
      if (event.source === 'integration') return null;
      // a stop asks a person about a plan that stands: a dead key (replaced or set aside by a decision, or a node above it was) gets none - test/tree-dead-key-scan.test.js, the third dead-key row that was missing (node_started, node_resumed)
      if (key && deadKeys(state).has(key)) return refuse(event, `${key} is dead (${DEAD_REASON}): no stop is opened on it`);
      if (key && heldKeys(state).has(key)) return refuse(event, `${key} is ${heldPhraseOf(state, key)}: no stop is opened on it`);
      // S5b part B: the ONE stop that names a node that is NOT in the record. It can never name a registered or superseded node, only the generation the next registration would use, of a child its parent's verified split names.
      // Recorded on the child itself, or - when the ROOT's own text carries the finding - on the live root (`child` names the unregistered node), so that a new root plan answers it.
      if (event.source === 'bundle_input') {
        const target = isObj(event.child) ? event.child : { node: event.node, generation: event.generation };
        if (!isNodePath(target.node) || !isGen(target.generation)) return refuse(event, 'a stop before registration names the child (node, generation)');
        const tkey = `${target.node}@g${target.generation}`;
        if (isObj(event.child) && !(event.node === 'R' && n && n.phase === PHASES.closed && latestGenerationOf(state, 'R') === event.generation)) return refuse(event, `${tkey}: a stop recorded on the root is on the live root plan, finished`);
        if (state.nodes.has(tkey)) return refuse(event, `${tkey} is registered: a stop before registration names a node that is not`);
        if (state.closedUnstarted.has(tkey)) return refuse(event, `${tkey} was closed by a person before it started: no stop is opened before its registration`);
        const pk = isObj(event.parent) ? `${event.parent.node}@g${event.parent.generation}` : null;
        const parent = pk ? state.nodes.get(pk) : null;
        if (!parent || parent.phase !== PHASES.closed || !parent.verifiedSplit) return refuse(event, `${pk ?? 'a parent'} is not a closed node with a verified split: ${tkey} is not a child it names`);
        if (target.node.slice(0, target.node.lastIndexOf('/')) !== event.parent.node || !(parent.verifiedSplit.children ?? []).includes(target.node)) return refuse(event, `${target.node} is not a child that the verified split of ${event.parent.node} names`);
        if (isSupersededGeneration(state, target.node, target.generation) || target.generation !== generationOf(state, target.node)) return refuse(event, `${tkey} is not the generation the next registration of ${target.node} would use (${generationOf(state, target.node)})`);
        if (!Array.isArray(event.findings) || !event.findings.length) return refuse(event, `${tkey}: a stop before registration names what was found (findings)`);
        if (!Array.isArray(event.affected) || !event.affected.some(a => a.node === target.node && a.generation === target.generation)) return refuse(event, `${tkey}: the set the stop puts in question holds the node itself`);
        if (state.openStops.some(id => { const m = state.stopMeta.get(id); const mt = m?.child ?? m; return mt?.node === target.node && mt?.generation === target.generation; })) return refuse(event, `${tkey} already has an open stop`);
        return null;
      }
      // c3b: a child a person closed before it ever started has no nodes row and is "closed" all the same: the closed_incomplete stop of the blocked-child rule (no runId) may name it
      if (event.source === 'blocked' && key && state.closedUnstarted.has(key)) return null;
      // S8-8 (the person-opened root stop; Muad 11 Oct 2026: "a person may open a root stop himself (ready-but-wrong plans)"): the ONE stop a person writes, on the ROOT plan that is the newest, with nothing left to halt. THE TABLE is the authority for everything it can see
      // (the dead and held refusals above already ran); the one fact it cannot see, a children frontier waiting for approval, is the form's preflight. Before this branch the row never looked at `source`: a hand-written `source: 'person'` on a closed child with no gate was accepted.
      if (event.source === 'person') {
        if (event.node !== 'R' || !n) return refuse(event, 'a person opens a stop on the ROOT plan only');
        if (n.phase !== PHASES.closed) return refuse(event, `${key} is not closed: a person opens a stop only on a root plan that has finished`);
        if (event.generation !== latestGenerationOf(state, 'R')) return refuse(event, `${key} is not the newest root plan (R@g${latestGenerationOf(state, 'R')} is)`);
        if (state.active !== null) return refuse(event, `${state.active} is active: nothing may be running when a person opens a stop on the root plan`);
        const unfinished = unfinishedLiveNodes(state);
        if (unfinished.length) return refuse(event, `${unfinished[0].node}@g${unfinished[0].generation} is not closed: a person opens this stop on a finished tree (every registered node closed)`);
        const undetected = undetectedDecisionCloses(state);
        if (undetected.length) return refuse(event, `${undetected[0].node}@g${undetected[0].generation} ended with the Status needs_decision and its stop is not written yet: a person's stop waits until it is`);
        if (!isStr(event.gateId) || !/^[0-9a-f]{64}$/.test(event.shownSha256 ?? '')) return refuse(event, 'a person\'s stop carries the gate whose approval authorized it and the hash of the text read (gateId, shownSha256)');
        if (!isStr(event.reason) || !event.reason.trim()) return refuse(event, 'a person\'s stop carries the reason that was typed (reason), not empty');
        { const bad = answeredByRefusal(event); if (bad) return refuse(event, bad); }     // K10: person only; here `reason` is the typed reason, so a session answer (which would need its own) is refused outright
        if (state.openStops.some(id => state.stopMeta.get(id)?.node === 'R')) return refuse(event, 'the root plan already has an open stop');
        if ([...state.decisions.values()].some(d => d.replansRoot === true && !d.generated)) return refuse(event, 'a new root plan is already being opened: the stop it answers is closed');
        return null;
      }
      return n && n.phase === PHASES.closed ? null : refuse(event, `${key ?? 'a node'} is not closed`);
    case 'decision_recorded':
      if (!state.openStops.length) return refuse(event, 'no open stop');
      // M5d: a decision names the stop it answers, and the gate whose approval authorized it (a person's decision, never a bare record)
      if (!isStr(event.stopId) || !state.openStops.includes(event.stopId)) return refuse(event, `a decision names an open stop (stopId ${JSON.stringify(event.stopId ?? null)} is not one)`);
      if (!isStr(event.gateId) || !isStr(event.shownSha256)) return refuse(event, 'a decision carries the gate whose approval authorized it and the hash of the text read (gateId, shownSha256)');
      // session channel (6d ruling 2, 19 Okt): the session may answer a KEEP, a milestone resolution in place of a non-root node ("the slot as it is") and a SUB-PLAN regenerate; a ROOT re-plan (replansRoot, or any answer to a stop of the root) and an OBLIGATION decision stay a person's
      const sessionOk = event.form === 'keep' || (event.form === 'milestone' && event.node !== 'R') || (event.form === 'regenerate' && event.replansRoot !== true && !isStr(event.obligation) && state.stopMeta.get(event.stopId)?.node !== 'R');
      { const bad = answeredByRefusal(event, { sessionAllowed: sessionOk }); if (bad) return refuse(event, bad); }
      { const handed = [event.stopId, ...(Array.isArray(event.covers) ? event.covers : [])].find(id => state.deferred.has(id)); if (event.actor === 'session' && handed !== undefined) return refuse(event, `stop ${handed} was handed to the person by the session: only the person answers it now`); }       // B-DRAFT
      if (event.allowanceBytes !== undefined && (event.actor === 'session' || event.replansRoot !== true)) return refuse(event, 'a raised size (allowanceBytes) belongs to a new root plan decided by a person at a terminal: the session never raises it');       // B-DRAFT (Muad: a raised limit is the person\'s)
      if (event.actor === 'session' && event.form === 'regenerate' && event.planMode === 'fresh' && event.oldPlan?.form === 'data') return refuse(event, 'the session chose planMode "fresh" but the decision offers the earlier plan as data: the two must agree');       // B-DRAFT (the merge seam: the writer sent the person\'s default)
      if (event.actor === 'session' && event.form === 'regenerate' && event.planMode !== 'fresh' && event.planMode !== 'data') return refuse(event, 'a regenerate by the session states planMode fresh or data with its reason: there is no default');       // B-DRAFT (6d)     // K10: a decision that answers a stop is a person's; a KEEP may also be the session's, with its written reason
      if (event.form !== 'regenerate' && event.form !== 'milestone' && event.form !== 'keep') return refuse(event, 'a decision is the regenerate form, the milestone form or the keep form (form)');
      if (event.form === 'keep') {
        // the fold trusts the event's fields, so the row binds them: a keep never re-plans the root, lists nodes, covers other stops or names a milestone (B-DRAFT sentences). The table cannot read the plan, so "no needs-decision milestone" is the decide form's check only.
        if (event.replansRoot === true) return refuse(event, 'a keep is not a root re-plan (replansRoot)');
        if ((event.affected ?? []).length) return refuse(event, 'a keep carries no affected nodes: it replaces nothing');
        if (Array.isArray(event.covers) && event.covers.length) return refuse(event, 'a keep carries no covers: it answers the one stop it names');
        if (event.milestone !== undefined) return refuse(event, 'a keep names no milestone: a milestone is resolved with --milestone');
      }
      if (event.form === 'keep') { const bad = keepRefusal(state, { stopId: event.stopId, node: event.node, generation: event.generation }); return bad ? refuse(event, bad) : null; }
      if (event.form === 'milestone' && !(isNodePath(event.node) && isGen(event.generation) && isStr(event.milestone))) return refuse(event, 'a milestone decision names the node, generation and milestone it resolves');
      // S8 (rulings row 130, REVERSING PLAN 8.4's "the root is never regenerated"): a regenerate answer to a ROOT stop is a root re-plan and says so (`replansRoot`); the preconditions that need files (the task bytes, the money) are the decide form's, the ones the record can judge are here
      // ROADMAP 77 (step 4, B-DRAFT sentences): a root re-plan is decided only after the recommendation request ended (an open hold would shrink the new root's grant), and a decision that says its text is a recommendation names a request of THIS stop that ended settled.
      if (event.replansRoot === true) { const open = openAdviceOf(state); if (open.length) return refuse(event, `a recommendation request (${open[0]}) is still open: it ends before the decision is recorded`); }
      if (event.fromSessionDraft !== undefined) {
        // GAP A (A-DRAFT sentences): the person approved the SESSION's text as written. The draft must be the newest one of this stop and the decision text its text, byte for byte, so a draft changed after it was shown can never be recorded.
        if (event.replansRoot !== true) return refuse(event, 'only a root re-plan carries a session draft (fromSessionDraft)');
        if (event.fromRecommendation !== undefined) return refuse(event, 'a decision text comes from a recommendation or from a session draft, not both');
        if (event.actor !== 'person') return refuse(event, 'a session draft is approved by a person: the decision is the person\'s act');
        const d = state.drafts.get(event.stopId);
        if (!d || d.id !== event.fromSessionDraft.draftId) return refuse(event, `${event.fromSessionDraft.draftId} is not the newest draft of stop ${event.stopId}: the session wrote a newer one, or there is none`);
        if (event.text !== d.text) return refuse(event, 'the decision text is not the draft\'s text');
      }
      if (event.fromRecommendation !== undefined) {
        if (event.replansRoot !== true) return refuse(event, 'only a root re-plan carries a recommendation (fromRecommendation)');
        const a = state.advice.get(event.fromRecommendation.adviceId);
        if (!a || a.ended?.reason !== 'settled' || a.stopId !== event.stopId) return refuse(event, `${event.fromRecommendation.adviceId} is not a recommendation request of this stop that was answered (settled)`);
      }
      if (event.replansRoot === true) {
        const stopNode = state.stopMeta.get(event.stopId)?.node ?? null;
        if (event.form !== 'regenerate') return refuse(event, 'only the regenerate form re-plans the root (replansRoot)');
        if (stopNode !== 'R') return refuse(event, `stop ${event.stopId} belongs to ${stopNode ?? 'no node'}, not to the root: replansRoot answers a stop of the root`);
        if (state.active !== null) return refuse(event, `node ${state.active} is active: a root re-plan never races a running node`);
        { const waiting = unopenedBeforeReplan(state, event.stopId); if (waiting.length) return refuse(event, `decision ${waiting.join(', ')} is recorded and its new generation is not opened yet: a root re-plan waits for it (run \`council tree resume\` first)`); }     // CR-2G-004
        if ([...state.decisions.values()].some(d => d.replansRoot && !d.opened) || latestGenerationOf(state, 'R') > Math.max(...[...state.nodes.values()].filter(s => s.node === 'R').map(s => s.generation))) return refuse(event, 'a root re-plan is already pending: its new root is not registered yet');
        const newest = [...state.nodes.values()].filter(s => s.node === 'R').sort((a, b) => b.generation - a.generation)[0];
        if (!newest || newest.phase !== PHASES.closed) return refuse(event, `the root plan ${newest ? `R@g${newest.generation} is ${newest.phase}` : 'is not registered'}: a root plan is replaced only once it is closed`);
        // the fold trusts `affected`, so the row binds it (contract section 3): R@g and EXACTLY the nodes that cannot be held (a decision that left out a stopped child would make it held, with its grant hold and a way to resume)
        const listed = new Set((event.affected ?? []).map(a => `${a.node}@g${a.generation}`));
        const wanted = new Set([`R@g${newest.generation}`, ...ineligibleBelowRoot(state, { answeringStopId: event.stopId })]);
        const missing = [...wanted].filter(k => !listed.has(k)); const extra = [...listed].filter(k => !wanted.has(k));
        if (missing.length || extra.length) return refuse(event, `a root re-plan lists exactly R@g${newest.generation} and the nodes that cannot be held (not finished and passed, or with an open stop): ${missing.length ? `missing ${missing.join(', ')}` : ''}${missing.length && extra.length ? '; ' : ''}${extra.length ? `not to be listed ${extra.join(', ')}` : ''}`);
      } else if (event.form === 'regenerate' && state.stopMeta.get(event.stopId)?.node === 'R') return refuse(event, `stop ${event.stopId} belongs to the root: a regenerate answer to it re-plans the root and must say so (replansRoot); otherwise it is answered by a root milestone resolution`);
      // K1, the sub-plan route (M7 apply, C2a-record commit 2): the fold trusts `affected`, so the row binds it to the stop's recorded set (see subplanDecisionRefusal)
      else if (event.form === 'regenerate') { const bad = subplanDecisionRefusal(state, event, facts); if (bad) return refuse(event, bad); }
      if (event.form === 'milestone') {
        // PLAN 8.4: a resolution in place answers the stop of the node whose split marks the milestone needs-decision (the stop that node's Status opened), never another node's
        for (const c of event.covers ?? []) { const cm = state.stopMeta.get(c); if (!state.openStops.includes(c) || !cm || cm.node !== event.node || cm.generation !== event.generation) return refuse(event, `${c} is not an open stop of ${event.node}@g${event.generation}: a resolution covers the open stops of its own node only`); }
        const sm = state.stopMeta.get(event.stopId);
        if (!sm || sm.node !== event.node || sm.generation !== event.generation) return refuse(event, `a milestone decision answers only the stop of ${event.node}@g${event.generation}, the node whose split holds the milestone (stop ${event.stopId} belongs to ${sm?.node ?? 'no node'}@g${sm?.generation ?? '?'})`);
      }
      return null;
    case 'milestone_resolved': {
      // row 11 (M5d): it names a recorded decision WITH text, of the milestone form, for this very milestone, whose stop is still open and which resolved nothing yet
      const d = state.decisions.get(event.decisionId);
      if (!d || !d.hasText) return refuse(event, `milestone_resolved names no recorded decision with text (decisionId ${JSON.stringify(event.decisionId ?? null)})`);
      if (d.form !== 'milestone') return refuse(event, `decision ${event.decisionId} is not a milestone decision`);
      if (d.node !== event.node || d.generation !== event.generation || d.milestone !== event.milestone) return refuse(event, `decision ${event.decisionId} was recorded for ${d.node}@g${d.generation}:${d.milestone}, not this milestone`);
      if (event.changesProvides === true) return refuse(event, `${event.node}@g${event.generation}:${event.milestone}: an answer that changes what the node provides to a sibling is the regenerate form, not a resolution in place`);
      if (event.node !== 'R' && event.changesProvides !== false) return refuse(event, `${event.node}@g${event.generation}:${event.milestone}: the person states that the answer changes nothing the node provides to a sibling (changesProvides false); a resolution of a stopped child carries it`);
      if (d.resolved) return refuse(event, `decision ${event.decisionId} already resolved its milestone`);
      if ([...state.decisions.values()].some(x => x.resolved && x.node === event.node && x.generation === event.generation && x.milestone === event.milestone)) return refuse(event, `${event.node}@g${event.generation}:${event.milestone} is already resolved`);
      if (![d.stopId, ...(d.covers ?? [])].every(sid => sid && state.openStops.includes(sid))) return refuse(event, 'a stop this decision answers is not open');
      return null;
    }
    case 'generation_opened': {
      const d = state.decisions.get(event.decisionId);
      if (!d) return refuse(event, `no decision_recorded ${event.decisionId}`);
      if (d.generated) return refuse(event, `decision ${event.decisionId} already opened its generation`);
      // Option 4 (RegenSlot_Addendum2 section 10): the opening of a decision that plans a reused branch again names the SLOT, never a path inside the branch. Guard 1: one (path, generation) twice in one event. Guard 2: a path of a node INSIDE an adopted branch is opened only when a listed node OUTSIDE the branch sits on that path (the new plan's own node there); otherwise the number would collide with the new plan's.
      const seen = new Set();
      for (const o of event.nodes ?? []) { const k = `${o.node}@g${o.generation}`; if (seen.has(k)) return refuse(event, `${k} is opened twice in one event`); seen.add(k); }
      const below = new Set([...(state.adoptedBelow?.keys() ?? [])].map(k => k.replace(/@g\d+$/, '')));
      const outside = new Set((d.affected ?? []).filter(a => !state.adopted?.has(`${a.node}@g${a.generation}`) && !state.adoptedBelow?.has(`${a.node}@g${a.generation}`)).map(a => a.node));
      for (const o of event.nodes ?? []) if (below.has(o.node) && !outside.has(o.node)) return refuse(event, `${o.node} lies inside an adopted branch: planning part of a reused branch again plans its slot again, so a path inside it is never opened (plan the slot)`);
      return null;
    }
    case 'stop_restored': {
      // Restore gap (gate page sections 3 and 8). The record-side half of the close test; the file-side half (the snapshot, the re-read) is src/tree-restore.js, whose numbers this event carries.
      const meta = state.stopMeta.get(event.stopId);
      if (!meta || !state.openStops.includes(event.stopId)) return refuse(event, `stop ${event.stopId} is not an open stop: a restore answers exactly one open stop`);
      if (meta.source !== 'blocked') return refuse(event, `stop ${event.stopId} is a ${meta.source ?? 'no'}-source stop, not a blocked-child stop: only that kind is closed by a restored file`);
      if (meta.node !== event.node || meta.generation !== event.generation || meta.runId !== event.runId) return refuse(event, `stop ${event.stopId} is about ${meta.node}@g${meta.generation} (run ${meta.runId ?? 'none'}), not ${event.node}@g${event.generation} (run ${event.runId})`);
      const codes = meta.blockedCodes ?? [];
      // D2 F4c: every code needs its own live test; contract_check closes alone too (the files it reads are read live: a file put back changes the check), on the sitting's own re-run exiting 0
      const other = codes.filter(c => !RESTORABLE_CODES.includes(c));
      if (!codes.length || other.length) return refuse(event, `stop ${event.stopId} names ${other.length ? other.join(', ') : 'no reason'}: a restored file closes a stop only for ${RESTORABLE_CODES.join(', ')}`);
      if (codes.includes('contract_check') && event.contractExit !== 0) return refuse(event, `stop ${event.stopId} names contract_check: the event must carry the contract check's exit (0), re-run by the sitting on the restored files`);
      if (!codes.includes('contract_check') && event.contractExit !== undefined) return refuse(event, `stop ${event.stopId} names no contract_check, so it carries no contract check exit`);
      const wantRechecked = RECHECKED_BY_SITTING.filter(c => codes.includes(c));
      if (JSON.stringify([...(event.rechecked ?? [])].sort()) !== JSON.stringify([...wantRechecked].sort())) return refuse(event, `stop ${event.stopId} names ${wantRechecked.length ? wantRechecked.join(', ') : 'no code the sitting re-checks live'}: the event's rechecked list must name exactly ${wantRechecked.length ? 'that' : 'none (leave it out)'}`);
      const n = state.nodes.get(`${event.node}@g${event.generation}`);
      if (!n || n.phase !== PHASES.closed || n.runId !== event.runId) return refuse(event, `${event.node}@g${event.generation} is not closed with run ${event.runId}`);
      if (codes.includes('expansion_refused') && !(n.verifiedSplit && n.verifiedSplit.runId === event.runId)) return refuse(event, `stop ${event.stopId} names expansion_refused: ${event.node}@g${event.generation} holds no split_verified for run ${event.runId}, so its split is still not verified`);
      if (!n.deliveredBodySha256) return refuse(event, `${event.node}@g${event.generation} closed without a recorded hash of its plan body (an older closure, or a file that did not match its report): only a person answers its stop`);
      if (event.deliveredBodySha256 !== n.deliveredBodySha256) return refuse(event, `the event names plan body hash ${event.deliveredBodySha256.slice(0, 12)}, the record holds hash ${n.deliveredBodySha256.slice(0, 12)}`);
      if (event.observedBodySha256 !== n.deliveredBodySha256) return refuse(event, `the file on disk hashes to ${event.observedBodySha256.slice(0, 12)}, not to the ${n.deliveredBodySha256.slice(0, 12)} the node closed with: a changed file is not closed by the sitting`);
      if (n.thinContractSha256 && event.thinContractSha256 !== n.thinContractSha256) return refuse(event, `the thin contract on disk (${String(event.thinContractSha256 ?? 'none').slice(0, 12)}) is not the one the node closed with (${n.thinContractSha256.slice(0, 12)})`);
      // provider_pin (gate page 9.3, C&C ruling 9.3): the stop is closed only when every pin the dependent REGISTERED against reads the same from the provider's own files now; the event carries both numbers and the table repeats the comparison against the registration
      const pinned = (n.dependsOn ?? []).filter(d => d.thinContractSha256);
      if (!codes.includes('provider_pin')) { if (event.providerPins !== undefined) return refuse(event, `stop ${event.stopId} names no provider_pin, so it carries no provider pins`); }
      else {
        if (!Array.isArray(event.providerPins)) return refuse(event, `stop ${event.stopId} names provider_pin: the event must carry the provider pins it re-read (providerPins)`);
        for (const d of pinned) {
          const p = event.providerPins.find(x => x.node === d.node && x.generation === d.generation);
          if (!p) return refuse(event, `provider ${d.node}@g${d.generation} is pinned by ${event.node}@g${event.generation} and the event re-read no pin of it`);
          if (isSupersededGeneration(state, d.node, d.generation)) return refuse(event, `provider ${d.node} has moved past generation ${d.generation}: the pin ${event.node} registered against is no longer the provider's newest plan`);
          if (p.boundThinContractSha256 !== d.thinContractSha256) return refuse(event, `the bound pin of ${d.node}@g${d.generation} in the event (hash ${p.boundThinContractSha256.slice(0, 12)}) is not the one ${event.node}@g${event.generation} registered against (hash ${d.thinContractSha256.slice(0, 12)})`);
          if (p.observedThinContractSha256 !== p.boundThinContractSha256) return refuse(event, `the provider ${d.node}@g${d.generation} reads hash ${p.observedThinContractSha256.slice(0, 12)}, not the hash ${p.boundThinContractSha256.slice(0, 12)} ${event.node}@g${event.generation} registered against: the pin has not come back`);
        }
        const extra = event.providerPins.filter(x => !pinned.some(d => d.node === x.node && d.generation === x.generation));
        if (extra.length) return refuse(event, `the event names provider pins ${event.node} never registered against (${extra.map(x => `${x.node}@g${x.generation}`).join(', ')})`);
      }
      return null;
    }
    case 'plan_accepted': {
      // 2b (gate page section 12; C&C 14 Oct 2026). Each refusal has its OWN sentence (each is read by a person, E items) and its own test. The record-side half: the file-side half (the snapshot, the hashes, the scans) is src/tree-accept.js, whose numbers this event carries.
      const early = planAcceptStopRefusal(state, event);
      if (early) return refuse(event, early);
      const meta = state.stopMeta.get(event.stopId);
      const codes = meta.blockedCodes ?? [];
      // Astra (c) (Muad 25 Okt 2026 14:45 "Yes to all"; D3 F2-5): the free edit-and-accept route is KEPT for a stop of a plan whose own text could not give a child its input (derivation_refused, the provider missing a promised heading):
      // narrowly, only with the writer's evidence that every refused child derives from the ACCEPTED bytes (rechecked), and under every check below (the same split, the same thin contract, the scans, who may answer)
      const derivation = codes.includes('derivation_refused');
      const outside = codes.filter(c => !PLAN_ACCEPT_CODES.includes(c) && c !== 'derivation_refused');
      if ((!derivation && !codes.includes('plan_unreadable')) || outside.length) return refuse(event, `stop ${event.stopId} names ${outside.length ? outside.join(', ') : 'no unreadable plan'}: a changed plan is accepted only for a stop whose cause is the plan file itself (${PLAN_ACCEPT_CODES.join(' and ')})`);
      if (derivation && !(Array.isArray(event.rechecked) && event.rechecked.includes('derivation_refused'))) return refuse(event, `stop ${event.stopId} names derivation_refused: the acceptance carries the writer's re-derivation of the refused children against the accepted plan (rechecked)`);
      if (!derivation && event.rechecked !== undefined) return refuse(event, `stop ${event.stopId} names no derivation_refused, so the acceptance carries no re-derivation`);
      if (event.actor === 'sitting') return refuse(event, 'the sitting never accepts a changed plan: a change to an accepted plan is answered by the session (with its reason) or by a person');
      const n = state.nodes.get(`${event.node}@g${event.generation}`);
      if (event.previousBodySha256 !== n.deliveredBodySha256) return refuse(event, `the event names the previous plan body ${event.previousBodySha256.slice(0, 12)}, the record holds ${n.deliveredBodySha256.slice(0, 12)}`);
      const revert = event.revert === true;
      if (revert) {
        if (!n.acceptedBodySha256) return refuse(event, `${event.node}@g${event.generation} holds no accepted plan, so there is nothing to put back to the text the panel signed`);
        if (event.acceptedBodySha256 !== n.closedBodySha256) return refuse(event, `a revert goes back to the plan the node closed with (${String(n.closedBodySha256 ?? 'none').slice(0, 12)}), not to ${event.acceptedBodySha256.slice(0, 12)}`);
      } else {
        if (event.acceptedBodySha256 === n.deliveredBodySha256) return refuse(event, 'the file is the plan the record already holds: that is the sitting\'s restore, not an accepted change');
        if (event.acceptedBodySha256 === n.closedBodySha256) return refuse(event, 'the file is the text the panel signed: putting it back is a revert of an accepted change, recorded as one'); 
      }
      // who may answer: the record shows the conditions (gate page 10.1, 12.11)
      if (event.actor === 'session' || event.actor === 'person') {
        if (event.via !== 'mcp' && event.via !== 'terminal' && event.via !== 'elicitation') return refuse(event, `an answer by ${event.actor} names its channel (mcp, terminal or elicitation)`);       // K10 (plan 4.1): one shared channel vocabulary; elicitation added, no writer produces it yet
      }
      if (event.actor === 'session' && !(typeof event.reason === 'string' && event.reason.trim())) return refuse(event, 'the session\'s answer carries its written reason: none was given');
      if (event.actor === 'person' && !(isStr(event.gateId) && isSha(event.shownSha256))) return refuse(event, 'a person\'s acceptance carries the gate that was typed and the sha256 of the text that was read');
      // the content side: a changed thin contract, or a changed split, is not a body-only change (every actor; the split until unit 2e, gate page 12.10 Q-B5)
      if (n.thinContractSha256 && event.thinContractSha256 !== n.thinContractSha256) return refuse(event, `the thin contract on disk (${String(event.thinContractSha256 ?? 'none').slice(0, 12)}) is not the one the node closed with (${n.thinContractSha256.slice(0, 12)}): the report itself was changed, not only the plan`);
      if ((n.verifiedSplit?.sha ?? null) !== event.splitSha256) return refuse(event, `the split of the changed plan (${String(event.splitSha256 ?? 'none').slice(0, 12)}) is not the split that was checked (${String(n.verifiedSplit?.sha ?? 'none').slice(0, 12)}): this route accepts a changed plan only when its split is the one that was checked; the answers are a new plan (regenerate) or abandon`);
      // 2c (C&C 14 Oct 2026, condition 3): a scan finding refuses for EVERY actor, not only the session: the accepted body becomes the input of the sub-plans derived from it and their own scan would refuse it at their start (the writer names the shapes; this row is the table's own guard for a hand-written event).
      // piiFindings counts the BLOCKING personal-data findings (hard-stop); under warn the writer records 0 here and the count warn let through in scan.piiWarned, which this row does not refuse (CR-SOL-001, the owner's answer of 25 Okt 2026)
      if (event.scan.keyFindings > 0 || (event.scan.piiFindings ?? 0) > 0) return refuse(event, `the changed plan has ${event.scan.keyFindings} key-scan and ${event.scan.piiFindings ?? 0} personal-data finding(s): nothing is accepted that the tree's own key and personal-data checks refuse; edit the file and ask again`);
      if (event.actor === 'session') {
        if (event.node === 'R') return refuse(event, 'the root\'s plan is the person\'s: a session does not accept a change to the root');
        const kids = registeredChildrenOf(state, event.node, event.generation);
        if (kids.length && !revert) return refuse(event, `${event.node}@g${event.generation} has ${kids.length} registered child${kids.length === 1 ? '' : 'ren'} derived from its old plan (${kids.slice(0, 3).map(k => k.node).join(', ')}${kids.length > 3 ? ', ...' : ''}): a person accepts a change to it`);
        const approved = approvedFrontiersOf(state, event.node, event.generation);
        if (approved.length && !kids.length && !revert) return refuse(event, `the children of ${event.node}@g${event.generation} were already approved (${approved.slice(0, 2).join(', ')}) on a preview built from its old plan, and their bundles quote sections of it: a person accepts a change to it`);
        const deps = registeredDependentsOf(state, event.node, event.generation);
        if (deps.length && !revert) return refuse(event, `${deps.length} registered node${deps.length === 1 ? '' : 's'} depend${deps.length === 1 ? 's' : ''} on ${event.node}@g${event.generation} (${deps.slice(0, 3).map(k => k.node).join(', ')}${deps.length > 3 ? ', ...' : ''}) and were registered against its old plan: a person accepts a change to it`);
      }
      return null;
    }
    case 'tree_abandoned': {
      // the typed gate: a person's decision, never a bare record (the shape check has the fields; the hash is 64 hex). Not blocked by the sticky reasons: a tree under parent_changed / root_affected is exactly what a person abandons.
      if (!/^[0-9a-f]{64}$/.test(event.shownSha256 ?? '')) return refuse(event, 'an abandon is a person\'s decision: it carries the gate that was typed and the sha256 of the text that was read');
      { const bad = answeredByRefusal(event); if (bad) return refuse(event, bad); }     // K10: an abandon is a person's
      const liveAdvice = liveAdviceOf(state, facts);
      if (liveAdvice.length) return refuse(event, `a recommendation request (${liveAdvice[0].adviceId}) is still in progress (registered by pid ${liveAdvice[0].pid} on ${liveAdvice[0].host}): a tree cannot be abandoned while one is`);   // ROADMAP 77: the hold of an unfinished request is released first (it ends, or its wait for the brief expires)
      const live = liveMembersOf(state, facts);
      if (live.length) return refuse(event, `${live[0].key} still has a live ${live[0].kind === 'post_run' ? 'post-run call' : 'claim'} (pid ${live[0].pid} on ${live[0].host})${live.length > 1 ? ` and ${live.length - 1} more` : ''}: a tree with a running member cannot be abandoned`);
      return null;
    }
    case 'limit_raised': { const bad = answeredByRefusal(event); return bad ? refuse(event, bad) : null; }       // K10: a raised ceiling is a person's, gate or no gate: effectiveLimits (src/tree-budget.js) raises the limit on ANY such line, so a new one says who answered. The stop it answers is M5's; the raise-only rule is checked by `decide` (PLAN 8.6)
    case 'cap_amended': {
      // gate page 5: the pure-state half of the rules (the money half - the total may not be below what is committed - needs the run folders and lives in amendCap, under the tree lock; the READ side of that rule is the gate's over_committed). An abandoned tree is refused above.
      { const bad = answeredByRefusal(event); if (bad) return refuse(event, bad); }     // K10: a new total is a person's (A's section 4)
      const revision = state.capAmendments.length + 1;
      if (event.expectedRevision !== revision) return refuse(event, `the cap was amended since it was read (this would be amendment ${revision}, not ${event.expectedRevision})`);
      const inForce = state.capAmendments.at(-1)?.toCapUsd;
      if (inForce !== undefined && event.fromCapUsd !== inForce) return refuse(event, `an amendment starts from the cap in force (${inForce}), not from ${event.fromCapUsd}`);
      if (event.toCapUsd === event.fromCapUsd) return refuse(event, `${event.toCapUsd} is the cap already in force: nothing to amend`);
      return null;
    }
    case 'chain_limits_amended': {
      // the pure half: a person's answer, and one chain's amendments follow each other (the file hash a later one starts from is the hash the earlier one accepted). The other half (the tree names the chain, the file on disk is the one shown, nothing but its limits differs) needs tree.json and the file and lives in amendChainLimits, under the lock.
      { const bad = answeredByRefusal(event); if (bad) return refuse(event, bad); }
      if (event.fromSha256 === event.toSha256) return refuse(event, 'the chain file is the one already accepted: nothing to amend');
      const last = state.chainAmendments.get(event.chain);
      if (last && last.toSha256 !== event.fromSha256) return refuse(event, `the chain's limits were amended since they were read (the tree now accepts ${last.toSha256.slice(0, 12)}, not ${String(event.fromSha256).slice(0, 12)})`);
      return null;
    }
    // ROADMAP 77. The hold (the grant) is the session's OR the person's to answer (C&C ruling, 20 Okt 2026: the session answers only the grant, inside the tree's typed cap, with its reason); the brief approval that follows is the add-on's own gate and is not recorded here.
    case 'advice_registered': {
      { const bad = answeredByRefusal(event, { sessionAllowed: true }); if (bad) return refuse(event, bad); }
      if (state.advice.has(event.adviceId)) return refuse(event, `${event.adviceId} is already registered`);
      const open = openAdviceOf(state);
      if (open.length) return refuse(event, `${open[0]} still holds its grant: one recommendation request at a time`);
      return null;
    }
    case 'advice_run_added': {
      const a = state.advice.get(event.adviceId);
      if (!a) return refuse(event, `${event.adviceId} is not a registered recommendation request`);
      if (a.ended) return refuse(event, `${event.adviceId} has ended (${a.ended.reason}): its grant is released and no call can be added to it`);
      if ([...state.nodes.values()].some(x => x.runId === event.runId) || [...state.advice.values()].some(x => x.runs.some(r => r.runId === event.runId))) return refuse(event, `${event.runId} already belongs to this tree`);
      if (event.kind === 'first' ? a.runs.length !== 0 : a.runs.length !== 1) return refuse(event, event.kind === 'first' ? `${event.adviceId} already has its first call` : `${event.adviceId} has ${a.runs.length === 0 ? 'no first call' : 'its one more ask'} already: a request is the first call and at most one more`);
      return null;
    }
    case 'advice_ended': {
      const a = state.advice.get(event.adviceId);
      if (!a) return refuse(event, `${event.adviceId} is not a registered recommendation request`);
      if (a.ended) return refuse(event, `${event.adviceId} has already ended (${a.ended.reason})`);
      if (event.returnedUsd > a.grantUsd + 1e-7) return refuse(event, `${event.adviceId} cannot give back more than its grant`);
      return null;
    }
    default: return refuse(event, 'not a transition of the table');
  }
}
