// `council tree check <rootId> <id> pass|fail` (0.8.3 M6 slice S2; PLAN 9.1 item 4; design Review/Build_0.8.3/M6_S2_Design_Note_2026-10-11.md, rulings rows 70-77). The person records, at a terminal, that the integration check of
// an AGREEMENT passed or failed. A `pass` counts only while every version it was bound to is still current (src/tree-ready.js bindingOf / integrationStatusOf: the one place a `bound` is built and compared); a `fail` opens a
// needs_decision stop that belongs to no node. A HELD ITEM (a check the harness cannot enforce, an obligation a guard refused or that is carried in context only) is addressed by its label - the obligation's ORIGIN `R@g1:C2`,
// or `<node>@g<n>:ref-<12 hex>` for an entry with no identity - and is ONE target whatever its kinds, bound to the thin-contract pin of every node that carries it.
//
// Order, the same as `council tree decide` (src/tree-decide.js):
//   1. build: read the record and check every rule below; a refusal asks nobody, requests no gate and writes nothing;
//   2. request a `tree_check` gate with the exact text and ask at the terminal: the person TYPES the qualified id, never a bare "y";
//   3. after the yes the text is built AGAIN: if it (so the versions and the rules behind it) changed while the person read, the approval is NOT used and nothing is recorded;
//   4. the approval is spent (`tree_checked`, once), then ONE tree-lock hold: the rules and the binding are computed again INSIDE it, before the first append, and compared with the binding that was shown; any difference is
//      a TreeRefusal (exit 19: the approval is spent and nothing is recorded). Only then `integration_recorded` and, for a fail, `needs_decision_opened` (source integration, no node), adjacent in the record.
//
// The rules (design 1.6): the result word is exactly pass or fail; the id names an agreement of a verified split (a bare id only when exactly one node holds it); the owner has no newer generation than the id names; both
// children of the agreement are in the tree; no node of either subtree has a reason from REFUSED_CODES (one judgement, reused from the readiness rule: a stale, running, unfinished or unsigned participant cannot be bound);
// a participant's thin contract is the one its node_closed pinned (when the closing event carries a pin: every production writer writes one; a closing event without one is not refused on it); a second pass while one is current, a pass while this agreement's integration stop is open, and a second fail at the same versions are refused.
// This file reads no environment variable and parses no argument (src/tree-cli.js hands it the parsed positionals).
import { dirname, join } from 'node:path';
import { canonicalJson, sha256Of } from './thin-contract.js';
import { terminalSafeMarked } from './terminal-safe.js';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { TREE_GATE_KINDS, askTreeGate, recordTreeUse, requestTreeGate } from './tree-gate.js';
import { isSupersededGeneration, latestGenerationOf, orphansOf, placeOf } from './tree-transitions.js';
import { isWithin } from './tree-deps.js';
import { nodeKey } from './tree-identity.js';
import { parseQid, qidIndex, qualify, resolveQid } from './tree-qid.js';
import { readPlanOf } from './tree-derive-load.js';
import { affectedFor } from './tree-affected.js';
import { agreementEndsOf, gatherReadinessFacts, heldTargetsOf, integrationStatusOf, verdictOf } from './tree-ready.js';
import { recordReadinessAfter } from './tree-readiness.js';
import { abandonedSentence, finalSentenceOf, recordRefusalLine } from './tree-abandon.js';

/** The readiness reasons that refuse a recording when they are scoped to a node of either subtree (an EXACT list; test/tree-check.test.js writes it out again). The agreement/held reasons (`integration_unrecorded`,
 * `held_unrecorded`, `integration_failed`) are NOT in it: two held items on one subtree would refuse each other and nothing could be recorded first. Tree-level reasons never refuse. */
export const REFUSED_CODES = Object.freeze([
  'generation_pending', 'not_started', 'running', 'stopped', 'closed_incomplete', 'report_unreadable', 'plan_unreadable', 'not_passed', 'unsigned_change', 'contract_check', 'no_milestone_lint', 'status_policy', 'stale', 'provider_pin',
  'split_unreadable', 'split_changed', 'expansion_refused', 'split_not_verified', 'unexpanded', 'needs_decision_unresolved', 'open_stop',
]);
/** The owner's own split reasons: an agreement is read out of the owner's VERIFIED split, so a plan that no longer matches it cannot be bound either. */
const OWNER_CODES = Object.freeze(['split_unreadable', 'split_changed', 'expansion_refused', 'split_not_verified']);

const nodeOfScope = scope => { const m = /^(R(?:\/[A-Za-z][A-Za-z0-9_-]*)*)@g[1-9]\d*$/.exec(String(scope)); return m ? m[1] : null; };

/** The addressable agreements: every non-orphan node's VERIFIED split block, as the qid index plus the node/agreement behind each entry. */
function agreementIndex({ state, runsDir }) {
  const orphans = orphansOf(state);
  const blocks = [];
  for (const n of state.nodes.values()) {
    if (!n.verifiedSplit || orphans.has(nodeKey(n.node, n.generation))) continue;
    const block = readPlanOf(runsDir, n).block;
    if (block) blocks.push({ node: n.node, generation: n.generation, block });
  }
  return { index: qidIndex(blocks), blocks };
}

/** Resolves what the person typed: { target: { kind, node, generation, id, qid, from, to, agreement } } | { refusal }. A bare id is accepted only when exactly one node holds it; otherwise the matches are listed and nothing changes. */
export function resolveCheckTarget(record, state, runsDir, arg) {
  const { index, blocks } = agreementIndex({ state, runsDir });
  const res = resolveQid(arg, index, { kind: 'agreement' });
  // a held item is addressed by its label exactly (design 1.4: an obligation's ORIGIN `R@g1:C2`, or `<node>@g<n>:ref-<12 hex>`); a bare id is only ever an agreement's
  const held = heldTargetsOf({ record, state }).filter(t => t.label === String(arg));
  if (held.length && res.ok) return { refusal: `${arg} names both an agreement and a held item; nothing was changed`, matches: [] };
  if (held.length) { const t = held[0]; return { target: { ...t, roots: t.carriers.map(c => c.node) } }; }
  // C&C (row 119): an id that names nothing says so for BOTH kinds of thing it could have named
  if (!res.ok) return { refusal: res.matches.length ? `${res.reason}: ${res.matches.join(', ')}` : res.reason.replace(/^no agreement /, 'no agreement or held item named '), matches: res.matches };
  const m = res.match;
  const block = blocks.find(b => b.node === m.node && b.generation === m.generation).block;
  const agreement = block.agreements.find(a => a.id === m.id);
  const ends = agreementEndsOf(placeOf(state, state.nodes.get(nodeKey(m.node, m.generation)) ?? m), block, agreement);       // C2b-2: the owner's PLACE (an adopted owner's children sit under the slot it fills); a path for every node that is where its path says
  if (!ends) return { refusal: `${qualify(m)}: its plan does not name the two children of the agreement (${agreement.from}, ${agreement.to})` };
  return { target: { kind: 'agreement', node: m.node, generation: m.generation, id: m.id, qid: qualify(m), from: ends.from, to: ends.to, roots: [ends.from, ends.to], agreement } };
}

const idNum = id => Number(String(id).slice(1)) || 0;

/** The nodes a failed check of `target` stops: the closure of its two children (agreement) or of its carriers (held item). The one computation: the verb shows it, the lock hold compares it, and the sitting's recovery of a missing stop writes it. */
export function failAffectedOf({ record, state, runsDir, target }) {
  return affectedFor({ record, state, runsDir, node: target.roots[0], obligationCarriers: target.roots, seedless: true }).affected;
}

/** The integration stop written for the failure `failure` (an `integration_recorded` event) of agreement `qid`, or null: a later `needs_decision_opened` of source integration naming the same id, open or answered or retired. */
const stopOfFailure = (record, qid, failure) => record.events.find(e => e.event === 'needs_decision_opened' && e.source === 'integration' && e.agreement === qid && idNum(e.id) > idNum(failure?.id)) ?? null;

/** The verified-split owners whose plan files do not give back a split block: the files the agreement index silently skips. [{ node, generation, runId }]. */
function unreadableOwnersOf(state, runsDir) {
  const orphans = orphansOf(state);
  return [...state.nodes.values()].filter(n => n.verifiedSplit && !orphans.has(nodeKey(n.node, n.generation)) && !readPlanOf(runsDir, n).block).map(n => ({ node: n.node, generation: n.generation, runId: n.runId }));
}

/**
 * The failed integration checks whose stop was never written (the process ended between the two appends of recordCheck), read from the record NOW: { missing: [{ agreement, affected }], unreadable: [{ agreement, reason, files }] }.
 * A failure NEEDS a stop when it is the newest result of its agreement, it is CURRENT (the same notion checkPlan's duplicate refusal uses: bound to the versions the plan files give now) and no stop of source integration
 * for it was written after it. FAILS CLOSED: when the owner's plan files (or a participant's report) do not read, nothing can be said about the versions, so NO stop is proposed and the files are named; a failure whose
 * owner is no longer live (replaced, orphaned) or whose binding moved on is history and is skipped, because readiness reads it as open again and not as failed.
 */
export function integrationGapsOf({ record, state, runsDir }) {
  const newest = new Map();
  for (const e of record.events) if (e.event === 'integration_recorded' && typeof e.agreement === 'string') newest.set(e.agreement, e);
  const missing = []; const unreadable = [];
  let owners = null;
  for (const [qid, failure] of newest) {
    if (failure.result !== 'fail' || stopOfFailure(record, qid, failure)) continue;
    const resolved = resolveCheckTarget(record, state, runsDir, qid);
    if (resolved.refusal) {
      const p = parseQid(qid);
      owners ??= unreadableOwnersOf(state, runsDir);
      const owner = p?.qualified ? owners.find(o => o.node === p.node && o.generation === p.generation) : null;
      if (owner) unreadable.push({ agreement: qid, reason: `the plan of ${owner.node}@g${owner.generation} cannot be read`, files: [`${owner.runId}/report.json`, `${owner.runId}/deliverable.md`] });
      continue;       // not addressable now (its owner was replaced or is not verified): history, not a failure that waits for its stop
    }
    const { target } = resolved;
    const status = integrationStatusOf({ record, state, runsDir, target });
    if (!status.now) {
      // an agreement's binding reads the owner's verified split; a held item's binding that cannot be made means a carrier is gone (history), not a file that does not read
      const owner = target.kind === 'agreement' ? state.nodes.get(nodeKey(target.node, target.generation)) : null;
      if (owner) unreadable.push({ agreement: qid, reason: 'its versions cannot be read (the verified split or plan of the node that carries the agreement)', files: [`${owner.runId}/report.json`, `${owner.runId}/deliverable.md`] });
      continue;
    }
    const blind = status.now.participants.filter(p => !p.thinContractSha256);
    if (!status.current && blind.length) { unreadable.push({ agreement: qid, reason: `the report of ${blind.map(p => `${p.node}@g${p.generation}`).join(', ')} cannot be read`, files: blind.map(p => `${state.nodes.get(nodeKey(p.node, p.generation))?.runId}/report.json`) }); continue; }
    if (!status.current) continue;       // bound to other versions: history
    missing.push({ agreement: qid, affected: failAffectedOf({ record, state, runsDir, target }) });
  }
  return { missing, unreadable };
}

/**
 * Everything the rules read, computed from the record NOW: { refusal } or { target, bound, status, plan }. Called three times by the verb (before the gate, after the yes, inside the lock) and writes nothing.
 * `work` is the working folder `contract check` resolves task files from (the readiness rule needs it).
 */
export function checkPlan({ rootDir, work, arg, result }) {
  if (result !== 'pass' && result !== 'fail') return { refusal: `the result is exactly pass or fail, not ${JSON.stringify(String(result))}` };
  const record = readTreeRecord(rootDir);
  if (!record.tree || record.corrupt.length) return { refusal: 'the tree record is not readable' };
  const state = stateOf(record);
  if (!state.started) return { refusal: 'the tree has not started' };
  const runsDir = dirname(rootDir);
  const resolved = resolveCheckTarget(record, state, runsDir, arg);
  if (resolved.refusal) return { refusal: resolved.refusal };
  const { target } = resolved;
  const isAgreement = target.kind === 'agreement';
  if (isAgreement) {
    if (isSupersededGeneration(state, target.node, target.generation)) return { refusal: `${target.qid}: ${target.node} is now generation ${latestGenerationOf(state, target.node)}; check the agreement of its newest generation` };
    const live = new Map();
    const orphans = orphansOf(state);
    for (const n of state.nodes.values()) if (!orphans.has(nodeKey(n.node, n.generation))) live.set(placeOf(state, n), n);       // C2b-2: by PLACE (the ends of an agreement are places); two nodes of one path no longer overwrite each other
    for (const end of [target.from, target.to]) if (!live.has(end)) return { refusal: `${target.qid}: ${end} is not registered in the tree` };
  }
  const status = integrationStatusOf({ record, state, runsDir, target });
  if (!status.now) return { refusal: `${target.qid}: its versions cannot be read (the owner's verified split or plan)` };
  if (result === 'pass' && status.current && status.result === 'pass') return { refusal: `${target.qid}: a pass is already recorded and current; there is nothing to record again` };
  if (result === 'fail' && status.current && status.result === 'fail') {
    // a failure and its stop are two records: a process that ended between them leaves the failure with no stop, and the sitting writes the missing one (integrationGapsOf); the person is told which of the two cases this is
    return { refusal: stopOfFailure(record, target.qid, status.latest)
      ? `${target.qid}: a failure is already recorded at these versions and its stop is a duplicate; answer that stop instead`
      : `${target.qid}: a failure is already recorded at these versions and its stop was never written. Run \`council tree resume\`: it writes the stop once the plan files can be read` };
  }
  const openIntegration = record.events.filter(e => e.event === 'needs_decision_opened' && e.source === 'integration' && e.agreement === target.qid && state.openStops.includes(e.id));
  if (result === 'pass' && openIntegration.length) return { refusal: `${target.qid}: an integration stop (${openIntegration[0].id}) is open for this agreement; a pass is not recorded while it is open` };
  const verdict = verdictOf(gatherReadinessFacts(rootDir, { work }));
  const ownerKey = isAgreement ? nodeKey(target.node, target.generation) : null;
  const inSubtree = p => p !== null && target.roots.some(root => isWithin(p, root));
  const blocking = verdict.reasons.filter(r => (REFUSED_CODES.includes(r.code) && inSubtree(nodeOfScope(r.scope))) || (isAgreement && OWNER_CODES.includes(r.code) && r.scope === ownerKey));
  if (blocking.length) return { refusal: `${target.qid} cannot be bound yet: ${blocking.slice(0, 4).map(r => `${r.scope} - ${r.code}`).join('; ')}${blocking.length > 4 ? `; and ${blocking.length - 4} more` : ''}` };
  for (const p of status.now.participants) {
    const closed = record.events.filter(e => e.event === 'node_closed' && e.node === p.node && e.generation === p.generation).at(-1);
    if (!p.thinContractSha256) return { refusal: `${target.qid}: the thin contract of ${p.node}@g${p.generation} cannot be read` };
    if (closed?.thinContractSha256 && closed.thinContractSha256 !== p.thinContractSha256) return { refusal: `${target.qid}: the thin contract of ${p.node}@g${p.generation} changed since it closed` };
  }
  // a fail stops these nodes (the closure of the two children, M5e's builder); the person is shown them and the lock hold compares them
  const affected = result === 'fail' ? failAffectedOf({ record, state, runsDir, target }) : null;
  return { target, bound: status.now, status, record, state, runsDir, affected };
}

const short = h => String(h ?? '').slice(0, 12);

/** The exact text a person reads and hashes (one terminalSafe over all of it, model-written words included). */
export function checkText({ target, bound, result, affected = null }) {
  const L = [];
  if (target.kind === 'agreement') {
    const a = target.agreement;
    L.push(`Record that the integration check of ${target.qid} ${result === 'pass' ? 'PASSED' : 'FAILED'}?`, '');
    L.push(`Agreement ${target.qid} (owner ${target.node}, generation ${target.generation})`);
    L.push(`  from ${target.from} to ${target.to}`);
    L.push(`  what: ${a.what}`);
    L.push(`  provider_refs: ${(a.provider_refs ?? []).join(', ') || '(none)'}`);
    L.push(`  integration check: ${a.integration_check}`, '');
  } else {
    const kinds = target.kinds.map(k => k.replace(/_/g, ' ')).join(' and ');
    L.push(`Record that the check of the ${kinds} ${target.qid} ${result === 'pass' ? 'PASSED' : 'FAILED'}?`, '');
    L.push(`Held item ${target.qid} (${kinds})`);
    L.push(`  text: ${target.full}`);
    L.push(`  carried by: ${target.carriers.map(c => `${c.node}@g${c.generation}`).join(', ')}`, '');
  }
  L.push('It will be bound to these versions:');
  for (const p of bound.participants) L.push(`  ${p.node}@g${p.generation} (thin contract ${short(p.thinContractSha256)})`);
  L.push('');
  if (result === 'pass') L.push('A pass counts as long as every version above is still current. A new generation, a node registered later anywhere in either subtree, or a changed thin contract makes it stale, and the check must be recorded again.');
  else L.push(`A failure opens a needs_decision stop on this agreement and stops these nodes: ${(affected ?? []).map(a => `${a.node}@g${a.generation}`).join(', ') || '(none)'}. The tree is not ready until a decision answers that stop.`);
  L.push('', `To approve, type the id: ${target.qid}`);
  return terminalSafeMarked(`${L.join('\n')}\n`);
}

/** The pure build of the whole verb: { refusal } or { text, expect, target, bound, result }. */
export function buildCheck({ rootDir, work, arg, result }) {
  const plan = checkPlan({ rootDir, work, arg, result });
  if (plan.refusal) return { refusal: plan.refusal };
  return { text: checkText({ target: plan.target, bound: plan.bound, result, affected: plan.affected }), expect: plan.target.qid, target: plan.target, bound: plan.bound, affected: plan.affected, result };
}

/** Records the result (and a fail's stop) under ONE tree-lock hold; every rule and the binding are computed again inside it and must still be what the person was shown. */
export function recordCheck({ rootDir, work, arg, result, shown, gateId, shownSha256, actor, via, now }) {
  return withTreeLock(rootDir, () => {
    { const st = stateOf(readTreeRecord(rootDir)); if (st.abandoned) throw new TreeRefusal({ code: 'continuation_refused', transition: 'integration_recorded', reason: abandonedSentence(st) }); }       // ROADMAP 57: the authority, under the lock
    const again = checkPlan({ rootDir, work, arg, result });
    if (again.refusal) throw new TreeRefusal({ code: 'continuation_refused', transition: 'integration_recorded', reason: `what you were shown no longer holds: ${again.refusal}` });
    if (canonicalJson(again.bound) !== canonicalJson(shown.bound)) throw new TreeRefusal({ code: 'continuation_refused', transition: 'integration_recorded', reason: `${shown.target.qid}: a version it was to be bound to changed while you were reading` });
    if (result === 'fail' && canonicalJson(again.affected) !== canonicalJson(shown.affected)) throw new TreeRefusal({ code: 'continuation_refused', transition: 'integration_recorded', reason: `${shown.target.qid}: the nodes a failure would stop changed while you were reading` });
    const clock = now ? { now } : {};
    const event = appendTreeEventLocked(rootDir, { event: 'integration_recorded', agreement: shown.target.qid, result, gateId, shownSha256, actor, via, bound: again.bound }, clock);
    let stop = null;
    if (result === 'fail') {
      stop = appendTreeEventLocked(rootDir, { event: 'needs_decision_opened', source: 'integration', agreement: shown.target.qid, affected: again.affected }, clock);
    }
    return { event, stop };
  });
}

/** The handler src/tree-cli.js calls for `check`. Exit codes as `decide`: 0 recorded, 1 refused or not confirmed (nothing written), 2 usage / no terminal, 19 the tree refuses to record it. */
export async function checkHandler({ rootDir, rootId, args, work, stdin, stdout, stderr, now }) {
  const out = s => stdout.write(`${s}\n`); const err = s => stderr.write(`${s}\n`);
  const clock = now ? { now } : {};
  const [arg, result] = args ?? [];
  if (result !== 'pass' && result !== 'fail') { err(`tree check: the result is exactly pass or fail, not ${JSON.stringify(String(result))}. Nothing was asked and nothing was written.`); return 2; }
  { const final = finalSentenceOf(rootDir); if (final) { err(`tree check: ${final} Nothing was asked and nothing was written.`); return 1; } }       // ROADMAP 57: a final tree records no check
  const first = buildCheck({ rootDir, work, arg, result });
  if (first.refusal) { err(`tree check: ${first.refusal}. Nothing was asked and nothing was written.`); return 1; }
  if (!stdin.isTTY || !stdout.isTTY) { err('tree check: a result is recorded at a terminal (stdin and stdout must both be one); there is no flag or file for it. Nothing was written.'); return 2; }
  const gate = requestTreeGate(rootDir, { kind: TREE_GATE_KINDS.check, text: first.text }, clock);
  if (!gate.ok) { err(`tree check: cannot ask for the result (${gate.code}): ${gate.message}`); return 1; }
  const code = await askTreeGate(rootDir, gate.gate.id, { expectPrefix: first.expect, typedLabel: 'the id', stdin, stdout, stderr, ...clock });
  if (code !== 0) return code;
  { const final = finalSentenceOf(rootDir); if (final) { err(`tree check: ${final} Your approval was NOT used and nothing was recorded.`); return 1; } }       // ROADMAP 57: a gate pending when the tree was abandoned is not used
  const again = buildCheck({ rootDir, work, arg, result });
  if (again.refusal || again.text !== first.text) {
    err('tree check: what you were shown has changed while you were reading it (a version or a precondition). Your approval was NOT used and nothing was recorded. Run the command again to see the new text.');
    return 1;
  }
  const shownSha256 = sha256Of(first.text);
  try {
    const used = recordTreeUse(rootDir, gate.gate.id, 'tree_check', { agreement: first.target.qid, result }, clock);
    if (!used.ok) { err(`tree check: the approval could not be used (${used.code}): ${used.message}. Nothing was recorded.`); return 1; }
    const done = recordCheck({ rootDir, work, arg, result, shown: first, gateId: gate.gate.id, shownSha256, ...used.answeredBy, now });
    // PLAN 9.2: a recorded result changes what the verdict rests on, so the verdict is recorded now, after the lock is released; a lock held elsewhere never undoes what was just recorded (the next tree step records it)
    recordReadinessAfter(rootDir, { work, now });
    out(`Recorded: the integration check of ${first.target.qid} ${result === 'pass' ? 'passed' : `FAILED; stop ${done.stop.id} is open. \`council tree decide ${rootId} --stop ${done.stop.id}\` answers it`}.`);
  } catch (e) {
    if (!(e instanceof TreeRefusal)) throw e;
    err(recordRefusalLine({ verb: 'tree check', reason: e.reason, rootDir }));
    return 19;
  }
  return 0;
}
