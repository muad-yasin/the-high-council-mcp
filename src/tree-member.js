// A tree member's own CLI (0.8.3 M1; PLAN 7.6 steps 1, 3 and 5, 8.3 steps 3 and 5). A member is a whole ordinary run started with `--tree-node <file>` (or resumed from a `run.json` that carries `tree`). This module is
// what that run does about the tree record, and nothing else: src/cli.js calls it at two points.
//
//   0.8.3 M2: the claim below is now ONE hold of the tree lock for the whole of PLAN 7.6 steps 1-4: the accounting gate (src/tree-budget.js), the continuation checks (src/tree-continuation.js), the lifetime cap and the claim,
//   so nothing can change between the checks and the claim. The cap the run is held to is `min(asked, lifetime cap)`, and BOTH are written on the claim event. A post-run paid call (`handoff --from-run`) takes the same
//   sequence with purpose `post_run` and releases its claim on every exit. A member that cannot record its claim does not run (fail closed).
//
//   CLAIM, just before the first paid call and after every pre-flight refusal: under the tree lock, validate the record and write the member's own `node_started` (first claim of a registered node) or
//   `node_resumed` with purpose `resume`. The event is chosen from the RECORD, never from `--resume`: a node whose CLI died after writing run.json but before its claim is still on its first start. The orchestrator
//   never writes `node_started`, so a child can never end before its start is durable. A refusal (the table does not allow it) is a TreeRefusal: exit 19, a `blocked` record, nothing run, nothing spent.
//
//   END, as the process exits: `node_stopped` for a run that stopped at its cap (exit 4), `node_closed` for a run whose report.json this sitting wrote, nothing for anything else. A pause at an external seat (exit 3) leaves the
//   node active on purpose; a crash or a refusal after the claim (16, 17, 5, 10, 11, 1...) writes no end event, so the node reads as an interrupted ordinary execution and a person's `tree resume` continues it (DECISIONS,
//   8 Oct). The hook runs only after the claim, never throws, and does nothing when the claim already has its end event (recovery and the hook can both get there; a duplicate must never write `blocked`).
//
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { parseMilestones } from './milestones.js';
import { bodyOfDelivered } from './tree-split.js';
import { writeAtomic } from './stop-files.js';
import { TreeRefusal, appendTreeEvent, appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { treePiiAllowFrom, treePiiModeFrom } from './tree-pii-mode.js';
import { nodeKey } from './tree-identity.js';
import { isNodePath, transitionRefusal } from './tree-transitions.js';
import { accountingAcceptLines, budgetOf, gateTree, lifetimeCapOf, returnedUsdOf, unreadableFloorOf } from './tree-budget.js';
import { memberCeilingRefusal } from './tree-ceiling.js';
import { bundleIdentityRefusal, continuationRefusal, deadRefusal, parentChangedEvent, rebuildDueRefusal, wayOutOf } from './tree-continuation.js';

/** The fields of the lineage file and of run.json's `tree` field (PLAN 4.4, 10.4). Only the first four are required; the others are filled by the milestones that compute them (M3 the split hash, M4 the bundle hash). */
export const TREE_FIELDS = Object.freeze(['treeId', 'node', 'generation', 'attempt', 'parentNode', 'depth', 'splitSha256', 'bundleSha256']);

/** Reads and checks a `--tree-node` file (a small JSON object in the node's input bundle). Throws an Error whose message the CLI prints after `--tree-node:`. */
export function readTreeNodeFile(path) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { throw new Error(`${path} is not a readable JSON file (${err.code || err.message})`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('the file must hold one JSON object');
  if (typeof raw.treeId !== 'string' || !/^[0-9TZ-]+$/.test(raw.treeId)) throw new Error('treeId: the root run id (digits, T, Z and "-")');
  if (!isNodePath(raw.node)) throw new Error('node: a path of milestone ids from the root, such as R or R/M2 (a letter first; no dots)');
  if (!Number.isInteger(raw.generation) || raw.generation < 1) throw new Error('generation: a whole number, 1 or more');
  const attempt = raw.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt: a whole number, 1 or more');
  return Object.fromEntries(TREE_FIELDS.map(k => [k, k === 'attempt' ? attempt : (raw[k] ?? null)]));
}

/** What run.json carries (additive field `tree`): the lineage, nothing else. */
export const runTreeField = lineage => Object.fromEntries(TREE_FIELDS.map(k => [k, lineage[k] ?? null]));

/** The root run's folder: members are flat siblings in `runs/`, so it is `<runs dir>/<tree id>`. */
export const treeRootDirOf = (runDir, lineage) => join(dirname(runDir), lineage.treeId);

/** The ONE writer of a member's refusal: a `blocked` record (reason, the node, the step it would have been) and a TreeRefusal. `memberStart` (under the lock, before any claim) and `memberPreflight` both end here. */
function refuseMember(rootDir, { key, claimName, reason, check, detail }, { facts, now } = {}) {
  appendTreeEventLocked(rootDir, { event: 'blocked', reason, scope: key, transition: claimName, ...(check ? { check } : {}), detail }, { facts, now });
  throw new TreeRefusal({ code: reason, transition: claimName, reason: detail });
}
const claimNameOf = (purpose, n) => (purpose === 'post_run' ? 'node_resumed' : !n || n.phase === 'registered' ? 'node_started' : 'node_resumed');

/** What the record says when a member reaches its claim with the key-scan override on (the backstop: the early refusals in cli.js come first). */
const secretOverrideDetail = key => `${key}: a tree member runs with the outbound key scan on, and takes no override (--allow-secret-shaped): its text is written by models, not chosen by a person`;

/**
 * Is the personal-data mode this member was started WITH the mode its tree carries? Returns the refusal detail or null. ONE copy for `memberPreflight` (early, before run.json: a refusal AFTER run.json trapped the node, because the
 * saved mode made every later sitting take the resume path and be refused again) and `memberStart` (the locked backstop). S5b (B's contract 3.7, C&C gate 1): a missing argument is the fail-open shape; a tree.json field that reads
 * `unusable` fails CLOSED (damage is never read as "off").
 */
/** The way out of a personal-data MODE mismatch: start the member under the tree's mode (nothing was saved by the refused start); otherwise close the node, or, for the root, which cannot be closed, start a new tree. */
const modeWayOut = lineage => (lineage.node === 'R'
  ? ' Start it under the tree\'s mode; the root cannot be closed, so if that is not possible start a new tree with `council tree start`.'
  : ` Start it under the tree's mode (\`council tree resume ${lineage.treeId}\` does), or close the node: \`council tree decide ${lineage.treeId} --close ${lineage.node}@g${lineage.generation}\`.`);

function piiModeDetail({ record, key, piiGate, lineage }) {
  const treeMode = treePiiModeFrom(record.tree);
  if (treeMode.status === 'unusable') return `${key}: the tree's personal-data mode in tree.json is unusable (${treeMode.reason}): no member of this tree starts while it is. The route is a new tree, started with \`council tree start\`.`;
  const wanted = treeMode.status === 'on' ? treeMode.mode : null;
  if (piiGate !== wanted) return `${key} was started ${piiGate ? `with --pii-gate ${piiGate}` : 'without --pii-gate'}, but this tree's personal-data mode is ${wanted ?? 'off'}: a member runs under the tree's mode, never another.${modeWayOut(lineage)}`;
  return null;
}

/**
 * T-b (19 Okt 2026): the personal-data types a PERSON allowed for this member, read from the tree RECORD and nowhere else: the ROOT (R, every generation: a root plan's task.md is the task's bytes) = tree.json `piiAllow` (`tree start --allow-pii`), any other node = the `bundle_input_allowed` event for
 * exactly that node and generation (`tree decide --allow-pii-node`). The member's own scan adds these to its (always empty) typed allow list: a member still takes no --allow-pii of its own (memberFlagRefusal, memberStart), so the F1 closure stands and
 * the only allowance a tree member runs under is one a person recorded after seeing what it covers. An unreadable record or a damaged field reads as none (the scan then stops: fail closed). -> [type].
 */
export function recordedPiiAllow({ rootDir, lineage }) {
  try {
    const record = readTreeRecord(rootDir);
    if (!record.exists || !record.tree || record.corrupt.length) return [];
    if (lineage.node === 'R') { const a = treePiiAllowFrom(record.tree); return a.status === 'on' ? a.types : []; }
    return [...(stateOf(record).piiAllowed?.get(nodeKey(lineage.node, lineage.generation))?.types ?? [])];
  } catch { return []; }
}

/**
 * The flags a tree member does not take, as the person meets them BEFORE anything is written (cli.js, right after the lineage is read; no lock, no tree record: a typed flag is a usage error and must not append to the record).
 * `typed`: { allowSecretShaped, allowPii } from this command line; `saved`: the same from the run's run.json on a resume. A value SAVED in run.json (a run that predates this refusal) is refused with the way out, because
 * removing a flag from the command line cannot help: `council tree decide <tree> --close <node>`. Returns { code, text } (exit 19 for a saved value, 2 for a typed one) or null.
 */
export function memberFlagRefusal({ lineage, typed = {}, saved = {} }) {
  const key = `${lineage.node}@g${lineage.generation}`;
  const what = [];
  if (saved.allowSecretShaped) what.push('--allow-secret-shaped');
  if (Array.isArray(saved.allowPii) && saved.allowPii.length) what.push('--allow-pii');
  if (what.length) return { code: 19, text: `${key}: this run's run.json saved ${what.join(' and ')}, which a tree member does not take (this run.json was saved without that check). This start was refused: nothing was run and nothing was spent by it.${wayOutOf(lineage)}` };
  if (typed.allowSecretShaped) return { code: 2, text: '--allow-secret-shaped: a tree member takes no override of the outbound key scan (a member\'s text is written by models, not chosen by you). Nothing was run and nothing was spent.' };
  if (typed.allowPii) return { code: 2, text: '--allow-pii: a tree member takes no --allow-pii of its own (its text is written by models, not chosen by you). To send personal data in one sub-plan you answer its stop after seeing where it sits: council tree decide <root> --allow-pii-node <node>@g<N>; for the root task, council tree start --allow-pii <types>. Nothing was run and nothing was spent.' };
  return null;
}

/**
 * The member's EARLY checks (13 Oct 2026, gate 1 of the member unit; the personal-data mode joined in the fix-up): is the node's input the one registered, and is the personal-data mode it was started with its tree's? Run by cli.js BEFORE the PII gate and the key scan, so a tampered bundle is named as tampered (exit 19) and
 * not as a secret (exit 11): tampering first, then secrets, then personal data. It NEVER claims: under the tree lock it reads the record, runs the SAME `bundleIdentityRefusal` that `memberStart` runs as its locked backstop, and on
 * a refusal writes the `blocked` record through the SAME writer (`refuseMember`) and throws a TreeRefusal; otherwise it returns and the gates run as before. A node the record does not know, or the generation-1 root (no
 * bundle), is left to `memberStart`. `rootDir`: the root run's folder.
 */
export function memberPreflight({ rootDir, lineage, purpose = 'run', inputs, piiGate, facts, now }) {
  if (piiGate !== null && piiGate !== 'warn' && piiGate !== 'hard-stop') throw new TypeError(`memberPreflight: piiGate must be 'warn', 'hard-stop' or null (the mode the run was started with), got ${JSON.stringify(piiGate)}`);
  if (purpose === 'post_run') return;
  const first = readTreeRecord(rootDir);
  if (!first.exists || !first.tree) return;                     // memberStart refuses it (no_tree) with its own sentence
  const key = nodeKey(lineage.node, lineage.generation);
  withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    if (record.corrupt.length) return;                          // memberStart's table check refuses a corrupt record with its own `blocked` line
    const state = stateOf(record);
    const n = state.nodes.get(key);
    const registered = record.events.find(e => e.event === 'node_registered' && e.node === lineage.node && e.generation === lineage.generation);
    if (!n) return;                                                                                // a node the record does not know: memberStart refuses it with its own sentence
    // already-false unit (L3; C&C ruling 23 Okt 2026): a DEAD node never starts, so it is refused FIRST, in the order and with the words of the locked backstop (continuationRefusal checks dead before rebuild_due and identity). Every check below ends in a way out ("close the node", "resume rebuilds it") that a dead node cannot take; and the refusal comes before run.json exists, so no run folder is left behind.
    const dead = deadRefusal(state, key);
    if (dead) refuseMember(rootDir, { key, claimName: claimNameOf(purpose, n), reason: 'continuation_refused', check: dead.check, detail: dead.detail }, { facts, now });
    // the identity check is for a node that has a bundle: not the generation-1 root, which has none
    if (registered && !(lineage.node === 'R' && lineage.generation === 1)) {
      const why = bundleIdentityRefusal({ rootDir, node: n, registered, lineage, inputs });
      if (why) refuseMember(rootDir, { key, claimName: claimNameOf(purpose, n), reason: 'continuation_refused', check: why.check, detail: why.detail }, { facts, now });
      // REBUILD: refused HERE, before run.json exists, so the refused start leaves no run folder holding the old input's context hash (the next sitting rebuilds and starts fresh); the locked start repeats it as the backstop
      const stale = rebuildDueRefusal({ rootDir, state: stateOf(record), node: n });
      if (stale) refuseMember(rootDir, { key, claimName: claimNameOf(purpose, n), reason: 'continuation_refused', check: stale.check, detail: stale.detail }, { facts, now });
    }
    // then the personal-data MODE, for EVERY node the record knows, the root included (a root run by hand under the wrong mode saved it to run.json and was refused again on every resume, and the root cannot be closed): the same refusal memberStart makes, but BEFORE run.json exists (see piiModeDetail)
    const modeDetail = piiModeDetail({ record, key, piiGate, lineage });
    if (modeDetail) refuseMember(rootDir, { key, claimName: claimNameOf(purpose, n), reason: 'pii_mode_mismatch', check: 'pii_mode', detail: modeDetail }, { facts, now });
  });
}

/**
 * The member's start (see the header): PLAN 7.6 steps 1-4 in ONE hold of the tree lock. In order: the table must allow the claim (otherwise the ordinary refusal and its `blocked` record); the accounting gate must pass
 * (else a `blocked` record, reason accounting_blocked, and a refusal: the tree is accounting_blocked exactly while the gate fails); the continuation checks must pass (a `blocked` record with reason continuation_refused
 * and the failed check's name); the node must have a LIVE grant (`lifetimeCapOf(...).live`: min(grant - spent, rootCap - treeSpent - heldByOthers) above zero; "no live grant" is a refusal HERE, never a run that
 * claims and then stops at once); then the claim is written with the cap the run will be held to: `capUsd = min(capAskedUsd, lifetimeCapUsd)`, carried on the event together with both inputs.
 *   purpose 'run'       node_started for a registered node, node_resumed (purpose resume) otherwise: chosen from the RECORD, never from --resume
 *   purpose 'post_run'  node_resumed (purpose post_run): a paid call after the run ended (`handoff --from-run`)
 * `capAskedUsd` must be a finite number: `--max-usd none` is refused for a member before anything is written, and is refused again here as a belt-and-braces check. `chainPath` is the chain file the run uses.
 * `ceiling` (REQUIRED, 15 Oct 2026 TREE CEILING): null when the member's chain is free-only, else src/cli.js readUsdCeiling's { usd, source, unreadable }. Refusals (exit 19, ONE `blocked` per refused start, reason continuation_refused): check `ceiling_unreadable` (a paid member and COUNCIL_MAX_USD_LIMIT
 * unreadable or an unfilled placeholder: before the gate) and check `ceiling` (the tree's cap in force above the ceiling: after the gate, before the claim). src/tree-ceiling.js memberCeilingRefusal.
 * Returns { claim, capUsd, lifetimeCapUsd, mirror } where `mirror(line)` is the function to hand openReservations (PLAN 7.2 item 6). Throws a TreeRefusal on any refusal and an Error on anything else; the caller exits 19
 * for both (a member that cannot record its claim does not run). `facts`, `now`, `pid`, `host` are injectable for tests.
 */
export function memberStart({ runDir, runId, lineage, purpose = 'run', capAskedUsd, chainPath = null, inputs = null, piiGate, piiAllow, allowSecretShaped, work = process.cwd(), pid = process.pid, host = hostname(), facts, now, deps, ceiling }) {
  const rootDir = treeRootDirOf(runDir, lineage);
  // S5b: the personal-data mode the member was started WITH (its --pii-gate flag, or the mode its run.json saved on a resume; null = none) must be the mode the tree carries (tree.json): a missing argument is the fail-open shape
  // (a caller that forgot it would let every mode pass), so it is required like `inputs`.
  if (piiGate !== null && piiGate !== 'warn' && piiGate !== 'hard-stop') throw new TypeError(`memberStart: piiGate must be 'warn', 'hard-stop' or null (the mode the run was started with), got ${JSON.stringify(piiGate)}`);
  // F1 (C&C verdict on 3822f9a): a TREE MEMBER has no allow-list of its own. T-b (19 Okt 2026) reverses F1 in ONE way only: an allowance a PERSON recorded after seeing (tree.json piiAllow, the bundle_input_allowed event), read from the record by the member's scan (recordedPiiAllow); the flag stays refused. A member started by hand with `--pii-gate hard-stop --allow-pii email` passed the mode check, suppressed those types in its own preflight, and run.json kept the list for every resume. Required like piiGate (a missing argument is the fail-open shape).
  // The member unit (13 Oct 2026): a tree takes no override of the key scan either (Muad, 12 Oct, answer 2). The EFFECTIVE value (the flag, or what run.json saved) is a REQUIRED argument like `piiAllow`: a caller that forgot it would let
  // `--allow-secret-shaped` through (`council handoff --from-run` on a member did, probed 13 Oct 2026). The early refusals in cli.js and `memberPreflight` come first; this is the backstop every claim passes.
  if (typeof allowSecretShaped !== 'boolean') throw new TypeError(`memberStart: allowSecretShaped must be true or false (the key-scan override the run was started with), got ${JSON.stringify(allowSecretShaped)}`);
  if (!Array.isArray(piiAllow)) throw new TypeError(`memberStart: piiAllow must be the list of --allow-pii types the run was started with ([] = none), got ${JSON.stringify(piiAllow)}`);
  // C&C (M4 PASS): the inputs check must not be skippable by leaving the argument out (the fail-open shape). A start or resume (every purpose but `post_run`, the one legitimate caller without inputs: a paid call after
  // the run ended reads no plan inputs) REQUIRES them, and throws without. A node whose registration names no bundle (the root, M2's fixtures) ignores them.
  if (purpose !== 'post_run' && (inputs === null || typeof inputs !== 'object')) throw new TypeError(`memberStart: purpose ${JSON.stringify(purpose)} requires inputs ({ task, criteria, context }): the continuation check ties a start to its bundle`);
  // TREE CEILING (15 Oct 2026, C&C): COUNCIL_MAX_USD_LIMIT bounds a tree's money too. `ceiling` is REQUIRED like piiAllow (a caller that forgot it would let every tree past the ceiling): null = the member's chain is free-only, no check; otherwise the object
  // src/cli.js readUsdCeiling returns ({ usd, source, unreadable }). Checked after the type checks above so their messages stay.
  if (ceiling !== null && (typeof ceiling !== 'object' || ceiling === undefined)) throw new TypeError(`memberStart: ceiling must be null (the member's chain is free-only) or the ceiling object src/cli.js readUsdCeiling returns, got ${JSON.stringify(ceiling)}`);
  const first = readTreeRecord(rootDir);
  // A lineage that names no started tree has no record to write a refusal into; it is refused all the same (exit 19), not left to crash on the missing folder.
  if (!first.exists || !first.tree) throw new TreeRefusal({ code: 'no_tree', transition: 'node_started', reason: `there is no tree record at ${join(rootDir, 'tree')}: the tree id in the lineage file (${lineage.treeId}) names no started tree` });
  const key = nodeKey(lineage.node, lineage.generation);
  const base = { node: lineage.node, generation: lineage.generation, runId, pid, host };
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const state = stateOf(record);
    const n = state.nodes.get(key);
    const claimName = claimNameOf(purpose, n);
    const plain = claimName === 'node_started' ? { event: 'node_started', ...base } : { event: 'node_resumed', purpose: purpose === 'post_run' ? 'post_run' : 'resume', ...base };
    // The table, the record's integrity and the sticky blocks first: their refusals (and their `blocked` records) are the ones M1 defined.
    if (record.corrupt.length || !n || transitionRefusal(state, plain, facts)) return { claim: appendTreeEventLocked(rootDir, plain, { facts, now }) };   // throws
    const refuse = (reason, check, detail) => refuseMember(rootDir, { key, claimName, reason, check, detail }, { facts, now });
    // S5b (B's contract 3.7, C&C gate 1): ONE source for the tree's personal-data mode, ONE enforcer at the member. A member started by hand with no flag, a resume that dropped it, warn against hard-stop, a flag on a tree with no mode,
    // and a tree.json field that reads `unusable` (fail CLOSED: damage is never read as "off") are all refused here, exit 19, before any claim and any provider call. The starter (src/tree-run.js) passes the mode, so the normal path never mismatches.
    const modeDetail = piiModeDetail({ record, key, piiGate, lineage });
    if (modeDetail) refuse('pii_mode_mismatch', 'pii_mode', modeDetail);
    if (piiAllow.length) refuse('pii_mode_mismatch', 'pii_mode', `${key}: a tree member takes no --allow-pii of its own (the allowance is the one a person recorded in the tree: 'tree start --allow-pii' for the root task, 'tree decide --allow-pii-node' for a sub-plan; this start brought --allow-pii ${piiAllow.map(String).join(',').slice(0, 80)}): a member runs under the tree's personal-data mode alone`);
    if (allowSecretShaped) refuse('continuation_refused', 'secret_override', secretOverrideDetail(key));
    if (!Number.isFinite(capAskedUsd) || capAskedUsd <= 0) refuse('continuation_refused', 'max_usd', `a tree member needs a finite spend cap above zero (--max-usd none is refused for a member); got ${capAskedUsd}`);
    // an unreadable or placeholder ceiling at a PAID member start refuses (fail closed): exit 19 and ONE `blocked`, nothing claimed
    { const bad = memberCeilingRefusal({ key, tree: record.tree, capUsd: Infinity, committedUsd: 0, ceiling }); if (bad?.check === 'ceiling_unreadable') refuse('continuation_refused', bad.check, bad.detail); }
    const gate = gateTree(rootDir, { record });
    // D2 F13a S9 (A-DRAFT; B20a): the typed acceptance for each node with a KEYED problem (all of them, not only the three named), each on its own line: the sitting quotes the LAST lines of a refused member (src/tree-run.js tree_refused, src/tree-resume.js)
    if (!gate.ok) refuse('accounting_blocked', null, [`the accounting gate fails: ${gate.problems.slice(0, 3).map(p => `${p.code} (${p.detail})`).join('; ')}${gate.problems.length > 3 ? `; and ${gate.problems.length - 3} more` : ''}`, ...accountingAcceptLines(gate.problems, lineage.treeId)].join('\n'));
    const registered = record.events.find(e => e.event === 'node_registered' && e.node === lineage.node && e.generation === lineage.generation);
    const why = continuationRefusal({ rootDir, record, state, node: n, registered, lineage, inputs, chainPath, purpose, work, deps });
    if (why?.check === 'ancestor' && typeof why.frontierKey === 'string') {
      // a parent or ancestor changed: the tree is blocked until the frontier is approved again (the one writer of this record, src/tree-continuation.js parentChangedEvent); exit 19, no claim, no provider call
      appendTreeEventLocked(rootDir, parentChangedEvent({ scope: key, frontierKey: why.frontierKey, detail: why.detail, ancestor: why.ancestor }), { facts, now });
      throw new TreeRefusal({ code: 'parent_changed', transition: claimName, reason: why.detail });
    }
    if (why) refuse('continuation_refused', why.check, why.detail);
    const budget = budgetOf(rootDir, { record, gate });
    // the tree's cap in force against the ceiling (Q1, gate note): a cap set before the variable was set or lowered is refused at every paid member start, with the way down
    { const over = memberCeilingRefusal({ key, tree: record.tree, capUsd: budget.rootCapUsd, committedUsd: budget.treeSpentUsd + budget.unknownSpendHeldUsd + budget.heldUsd, ceiling }); if (over) refuse('continuation_refused', over.check, over.detail); }
    const life = lifetimeCapOf(budget, key);
    if (!life.live) refuse('continuation_refused', 'grant', `${key} has no live grant: min(grant ${life.grantUsd.toFixed(4)} - spent ${life.spentUsd.toFixed(4)}, root cap ${budget.rootCapUsd} - tree spent ${budget.treeSpentUsd.toFixed(4)} - held by others ${life.heldByOthersUsd.toFixed(4)}) = ${life.roomUsd.toFixed(4)}${n.node !== 'R' && n.phase !== 'closed' && purpose !== 'post_run' ? `. Nothing is left of its grant: give it up with \`council tree decide ${lineage.treeId} --close ${key}\`.` : ''}`);       // D2 F13c S10 (A-DRAFT; B21b, the LOOP of an interrupted node whose spend reached its grant): named only where `--close` takes the node (src/tree-close.js closeRefusal refuses the root and a closed node; a post-run call is on an ended run)
    const capUsd = Math.min(capAskedUsd, life.lifetimeCapUsd);
    const claim = appendTreeEventLocked(rootDir, { ...plain, capUsd, lifetimeCapUsd: life.lifetimeCapUsd, capAskedUsd }, { facts, now });
    // PLAN 7.2 item 6: each line of the member's own reservations file is copied into the record by the same call that writes it (src/spend-reservations.js `mirror`), synchronously.
    const mirror = line => appendTreeEvent(rootDir, { event: 'reservation_mirrored', runId, node: lineage.node, generation: lineage.generation, line }, { facts, now });
    return { claim, capUsd, lifetimeCapUsd: life.lifetimeCapUsd, mirror };
  });
}

/** The handoff Status of a finished run (`ready_for_build`, `needs_decision`...), or null when it has none. */
export function handoffStatusOf(runDir) {
  try { return parseMilestones(readFileSync(join(runDir, 'HANDOFF.md'), 'utf8')).status ?? null; } catch { return null; }
}

/** The audit copy of the plan as it was accepted at the close, in the run folder (restore gap 2a, gate page 9.5, C&C ruling): the bytes whose hash `deliveredBodySha256` records. */
export const PLAN_COPY_FILE = 'plan-at-close.md';

/**
 * The parts of a finished run's closing, from ONE reading of its files: { fields, body }. `fields` are the node_closed fields (passed, the handoff Status, the share - a child that stops with needs_decision gives its unspent share
 * back as `revoked`, PLAN 8.4 - the thin-contract pin and the body hash); `body` is the plan body those hashes describe, or null when deliverable.md does not hash to report.json's delivered_text (then no hash is recorded either).
 */
function closedPartsOf(runDir) {
  let report = null;
  try { report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')); } catch { return null; }
  const status = handoffStatusOf(runDir);
  const passed = report?.passed === true;
  // M4 (C&C): the run's thin-contract sha256 is pinned on the closing event, so a consumer's derivation (src/tree-derive-load.js) can tell a provider's plan that was re-sealed after the fact (PLAN 6.4 item 3).
  const thin = report?.thin_contract?.sha256;
  // Astra #13 (root piece; C&C 14 Oct 2026): the sha256 of the DELIVERED BODY is recorded on the closing event, and only when deliverable.md really hashes to it NOW (the check readNodePlan makes), so a later sitting can compare a repaired plan file against
  // the RECORD instead of against report.json, which sits beside the file it protects. A closure without the field (an older record, or a file that did not match its report) is not guessed: it fails closed to a person's answer.
  let bodySha = null; let body = null;
  try {
    const d = report?.delivered_text;
    if (typeof d?.body_sha256 === 'string') { const b = bodyOfDelivered(readFileSync(join(runDir, 'deliverable.md'), 'utf8'), d); if (b.body !== undefined) { bodySha = d.body_sha256; body = b.body; } }
  } catch { bodySha = null; body = null; }
  return { fields: { outcome: passed ? 'passed' : 'not_passed', passed, status, share: status === 'needs_decision' ? 'revoked' : 'released', ...(typeof thin === 'string' ? { thinContractSha256: thin } : {}), ...(bodySha ? { deliveredBodySha256: bodySha } : {}) }, body };
}

/** The node_closed fields a finished run's files give (see closedPartsOf), or null when report.json does not read. Reads only. */
export function closedFieldsOf(runDir) { return closedPartsOf(runDir)?.fields ?? null; }

/**
 * Keeps the audit copy of the accepted plan BEFORE the node_closed line is appended (atomic: temp file, fsync, rename, folder sync). -> { planCopy: 'plan-at-close.md' } | { planCopy: null } (no plan to keep: an EXPLICIT null) |
 * { planCopy: null, copyFailed: <code> }. A copy that cannot be written does NOT stop the close - the close is a fact about the run and must not fail on an audit copy - but the failure is RECORDED on the node_closed line (copyFailed), so
 * a later screen says "the old text is not kept" for a reason the record shows, never silently.
 */
export function keepPlanCopy(runDir, body) {
  if (typeof body !== 'string') return { planCopy: null };
  try { writeAtomic(join(runDir, PLAN_COPY_FILE), body); return { planCopy: PLAN_COPY_FILE }; } catch (e) { return { planCopy: null, copyFailed: String(e?.code ?? e?.message ?? 'write_failed').slice(0, 60) }; }
}

/** closedFieldsOf plus the audit copy: for the writers that APPEND a node_closed (the member's exit hook). The copy is written first; the caller appends the line after this returns. */
export function closedFieldsWithCopyOf(runDir) {
  const parts = closedPartsOf(runDir);
  return parts ? { ...parts.fields, ...keepPlanCopy(runDir, parts.body) } : null;
}

/** The end kinds of a member that ended CLEANLY and waits for the person's choice (an overseer limit, or the conflict decider's ask). ONE predicate for the sites that must hold such a member (recovery, close, the sitting); the sites that write or read a CHOICE stay kind-specific (src/tree-choice.js). */
export const WAITS_FOR_CHOICE_KINDS = Object.freeze(['round_stopped', 'conflict_stopped']);
export const waitsForChoice = end => !!end && WAITS_FOR_CHOICE_KINDS.includes(end.kind);

/**
 * How a run that is no longer running ended, from its files alone (recovery's source, PLAN 8.3 step 5): 'closed' with closedFieldsOf, 'stopped' (STOPPED-budget.json, no report), or null (not ended).
 * `paused` is true when an external seat is waiting for its answer (a NEEDS-<stage>.md with no <stage>.md): that is not an end.
 */
export function runEndOf(runDir) {
  if (existsSync(join(runDir, 'report.json'))) {
    const parts = closedPartsOf(runDir);
    if (parts) { const end = { kind: 'closed', ...parts.fields }; Object.defineProperty(end, 'body', { value: parts.body, enumerable: false }); return end; }     // `body` is in memory for the recovery writer's audit copy; non-enumerable so no event or JSON ever carries it
  }
  if (existsSync(join(runDir, 'STOPPED-budget.json'))) return { kind: 'stopped' };
  // round semantics 2b: a layered member that stopped at its overseer limit (exit 23) ended CLEANLY and waits for the person's choice. It is NOT a budget stop (recovery must write no node_stopped / budget for it, and no top-up can help) and NOT an interrupted run (a sitting must not resume it): its own kind, which `tree decide --close` still accepts (tree-close.js).
  if (['STOPPED-overseer_cap.json', 'STOPPED-layer_bound.json'].some(f => existsSync(join(runDir, f)))) return { kind: 'round_stopped' };
  // member verb (conflict ask, 19 Okt 2026): a member the conflict decider stopped for the person's choice (exit 25) ended cleanly and waits, like a round stop; the choice itself is a different one (src/tree-choice.js)
  if (existsSync(join(runDir, 'STOPPED-conflict.json'))) return { kind: 'conflict_stopped' };
  return null;
}

/** Is an external seat waiting for its answer? A NEEDS-<stage>.md whose <stage>.md does not exist yet. A pause exits 3 on purpose and is never an interrupted execution (PLAN 8.3 step 4, 12 row 6). */
export function pausedAtExternalSeat(runDir) {
  try { return readdirSync(runDir).some(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(runDir, f.slice('NEEDS-'.length)))); } catch { return false; }
}

/**
 * Registers the process-exit hook (see the header, END). Call it only after memberClaim succeeded; `claim` is the event it returned. A report.json present at exit was written by THIS sitting: a resume of a
 * finished run exits 15 before the claim, so the claim is never reached with a report on disk. Never throws.
 */
export function installMemberEndHook({ runDir, runId, lineage, claim, facts, now }) {
  const rootDir = treeRootDirOf(runDir, lineage);
  const key = nodeKey(lineage.node, lineage.generation);
  process.on('exit', code => {
    try {
      const rec = readTreeRecord(rootDir);
      const n = stateOf(rec).nodes.get(key);
      if (!n || n.phase !== 'running' || n.claim?.id !== claim.id) return;     // already ended, or another process claimed the node since
      const base = { node: lineage.node, generation: lineage.generation, runId };
      if (code === 4) { appendTreeEvent(rootDir, { event: 'node_stopped', ...base, reason: 'budget' }, { facts, now }); return; }
      if (code === 3) return;                                                  // paused at an external seat: still active, on purpose
      const closed = existsSync(join(runDir, 'report.json')) ? closedFieldsWithCopyOf(runDir) : null;
      // returnedUsd: returnedUsdOf (src/tree-budget.js), the one figure the member's exit and a person's close both use (PLAN 7.5)
      if (closed) appendTreeEvent(rootDir, { event: 'node_closed', ...base, ...closed, returnedUsd: returnedUsdOf(n, runDir, unreadableFloorOf(rec, n.runId)) }, { facts, now });
    } catch { /* never throw out of an exit hook; recovery reconciles from the run's files */ }
  });
}

/**
 * The exit hook of a POST-RUN claim (`handoff --from-run` on a member's finished run, PLAN 7.6 step 3, 8.1): the claim ends when the call ends, so `node_released` is appended on EVERY exit (a success, the cap at exit 4,
 * a crash path), not by the report-and-exit-4 logic of an ordinary execution. A process killed outright leaves `node_resumed` without `node_released`; recovery on the same host appends it (src/tree-recovery.js).
 * Does nothing when the claim already ended. Never throws.
 */
export function installPostRunHook({ runDir, runId, lineage, claim, facts, now }) {
  const rootDir = treeRootDirOf(runDir, lineage);
  const key = nodeKey(lineage.node, lineage.generation);
  process.on('exit', () => {
    try {
      const n = stateOf(readTreeRecord(rootDir)).nodes.get(key);
      if (!n || !n.postRun || n.postRun.id !== claim.id) return;
      appendTreeEvent(rootDir, { event: 'node_released', node: lineage.node, generation: lineage.generation, runId, reason: 'ended' }, { facts, now });
    } catch { /* never throw out of an exit hook; recovery releases a dead post-run claim */ }
  });
}
