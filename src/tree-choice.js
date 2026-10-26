// The member's CHOICE (0.8.3 member verb; gate note Member_Verb_Gate_Note.md, delta addendum Member_Verb_Delta_Addendum.md, C&C rulings 15 and 16 Okt 2026): a member that stopped at its overseer limit (exit 23, runEndOf = round_stopped)
// stays `running` with no end event and waits. `council tree decide <root> --continue-node <node>` / `--finish-node <node>` writes ONE event, `node_choice`, and nothing else: no run starts, nothing is spent.
// Consumption is DERIVED (commit 2: pendingChoiceOf): a choice is pending until the member's run.json holds a roundChoices entry for its stop id; nothing is "marked consumed".
//   readStopOfRun(runDir)        -> { stop, id } | null        the stop the member is waiting at, from its partial report (fail closed: unreadable = null, never a guessed id)
//   roundChoiceOf(runDir, id)    -> the roundChoices entry for that stop id, or null (run.json, project-writable text: shape-checked)
//   choiceRefusal({...})         -> { kind, reason } | null     ONE function for the verb (before it writes) and chooseNode (under the lock)
//   pendingChoiceOf(runDir, n)   -> { choice, stop, applied } | null   a recorded choice the sitting still has to act on (derived; see below)
//   applyChoice(runDir, p)       -> writes the member's roundChoices entry (the same shape the standalone --continue/--finish writes) unless it is there
//   chooseNode(rootDir, {...})   -> { event, already, stop }    the only writer of node_choice
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { DEAD_REASON, claimAlive, deadKeys, heldKeys, heldPhraseOf, keptKeys } from './tree-transitions.js';
import { runEndOf, waitsForChoice } from './tree-member.js';
import { parsePrevail } from './conflict-decider.js';
import { closeReturnOf, unreadableFloorOf } from './tree-budget.js';
import { stopIdOf, roundChoiceEntry } from './overseer-rounds.js';
import { PARTIAL_REPORT_FILE } from './report-shape.js';

const keyOf = n => `${n.node}@g${n.generation}`;
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** The stop a member waits at: { stop, id } from report-partial.json, or null when that file does not read or holds no usable stop. No stop id is ever guessed (ruling 6). */
export function readStopOfRun(runDir) {
  const stop = readJson(join(runDir, PARTIAL_REPORT_FILE))?.stop;
  if (stop === null || typeof stop !== 'object' || Array.isArray(stop) || typeof stop.kind !== 'string' || !Number.isInteger(stop.overseer_round) || !Number.isInteger(stop.pass)) return null;
  return { stop, id: stopIdOf(stop) };
}

/**
 * The conflict stop a member waits at (exit 25, the decider asked for the person): { stop, id } from report-partial.json, or null when that file does not read or holds no usable conflict stop (fails closed: no id is guessed).
 * The id is `conflict:<overseer_round, or x when the stop carries none>:<pass>`; a pass is used once per run (the stage cache replays a repeated label) and a run stops at its first unanswered ask, so it is unique.
 */
/** The id of a conflict stop: `conflict:<overseer_round, or x when the stop carries none>:<pass>` (the one place that writes it; cli.js uses it too). */
export const conflictStopIdOf = stop => `conflict:${Number.isInteger(stop.overseer_round) ? stop.overseer_round : 'x'}:${stop.pass}`;

export function readConflictStopOfRun(runDir) {
  const stop = readJson(join(runDir, PARTIAL_REPORT_FILE))?.stop;
  if (stop === null || typeof stop !== 'object' || Array.isArray(stop) || stop.kind !== 'conflict' || !Number.isInteger(stop.pass) || !Array.isArray(stop.conflicts) || !stop.conflicts.length) return null;
  if (!stop.conflicts.every(c => c && Number.isInteger(c.n) && Array.isArray(c.ids) && c.ids.length && c.ids.every(i => typeof i === 'string'))) return null;
  return { stop, id: conflictStopIdOf(stop) };
}

/** Validates picks [{ n, prevail }] against a conflict stop with the same parser the standalone --prevail uses (every conflict answered, each pick an objection of its own conflict or "neither"): { ok, picks } | { ok: false, why }. */
export const picksOf = (picks, stop) => Array.isArray(picks) && picks.length ? parsePrevail(picks.map(p => `${p?.n}=${p?.prevail}`).join(','), stop) : { ok: false, why: 'no picks' };
const samePicks = (a, b) => JSON.stringify([...(a ?? [])].map(p => [p.n, p.prevail]).sort((x, y) => x[0] - y[0])) === JSON.stringify([...(b ?? [])].map(p => [p.n, p.prevail]).sort((x, y) => x[0] - y[0]));

/** The conflictChoices entries of a run (run.json, project-writable text) for one pass: [{ pass, n, prevail, via }] with a sound shape. */
export function conflictEntriesOf(runDir, pass) {
  const list = readJson(join(runDir, 'run.json'))?.conflictChoices;
  return Array.isArray(list) ? list.filter(c => c && typeof c === 'object' && c.pass === pass && Number.isInteger(c.n) && typeof c.prevail === 'string') : [];
}
const entriesMatch = (entries, picks) => samePicks(entries.map(c => ({ n: c.n, prevail: c.prevail })), picks);

/** The roundChoices entry of a run for one stop id (run.json: the person's recorded choice, whoever wrote it), or null. */
export function roundChoiceOf(runDir, id) {
  const list = readJson(join(runDir, 'run.json'))?.roundChoices;
  const hit = Array.isArray(list) ? list.find(c => c && typeof c === 'object' && c.stop === id) : null;
  return hit && (hit.choice === 'continue' || hit.choice === 'finish') ? hit : null;
}

/** 'dead' (replaced or set aside by a decision, or a node above it was), 'held' (waits for the new root plan), 'kept' (a later root plan did not use it, C2a-record) or null, for one node key. A dead, held or kept node is never given a choice and never offered one. */
export const replacedOf = (state, key) => deadKeys(state).has(key) ? 'dead' : keptKeys(state).has(key) ? 'kept' : heldKeys(state).has(key) ? 'held' : null;

/** The nodes that wait for the person's choice: running, claim gone, run ended at an overseer limit or at a conflict the decider asked about, and neither dead nor held. */
export function waitingForChoice(state, runsDir, facts = {}) {
  return [...state.nodes.values()].filter(x => x.phase === 'running' && !claimAlive(x.claim, facts) && waitsForChoice(runEndOf(join(runsDir, x.runId))) && !replacedOf(state, `${x.node}@g${x.generation}`)).map(x => x.node);
}

/** Why a person cannot give this node a choice right now, or null. Used by the verb (before anything is written) and by chooseNode (under the tree lock). */
export function choiceRefusal({ state, runsDir, node, generation, facts = {}, rootId = null, want = 'round' }) {
  const n = state.nodes.get(`${node}@g${generation}`);
  if (!n) return { kind: 'unknown', reason: `no such node in this tree: ${node}` };
  const give = n.node === 'R' ? `to end the whole tree for good use \`council tree decide ${rootId ?? '<tree id>'} --abandon\`` : `to give the node up use \`council tree decide ${rootId ?? '<tree id>'} --close ${n.node}\``;
  const replaced = replacedOf(state, `${n.node}@g${n.generation}`);
  if (replaced === 'dead') return { kind: 'dead', reason: `${keyOf(n)} is dead (${DEAD_REASON}): a choice would promise a resume that cannot happen; ${give}` };
  if (replaced === 'held' || replaced === 'kept') return { kind: replaced, reason: `${keyOf(n)} is ${heldPhraseOf(state, `${n.node}@g${n.generation}`)}: it is neither resumed nor given a choice` };
  if (n.postRun) return { kind: 'post_run', reason: `${keyOf(n)} is in a post-run paid call (pid ${n.postRun.pid}); it ends the call first` };
  if (n.phase !== 'running') return { kind: 'phase', reason: `${keyOf(n)} is ${n.phase === 'stopped' ? 'stopped at its budget cap (that needs --top-up, not a choice)' : n.phase}: a choice is for a node stopped at its overseer limit` };
  if (claimAlive(n.claim, facts)) return { kind: 'claim', reason: `${keyOf(n)} is running: pid ${n.claim.pid} on ${n.claim.host} holds its claim` };
  const runDir = join(runsDir, n.runId);
  const end = runEndOf(runDir);
  if (want === 'conflict') {
    if (end?.kind !== 'conflict_stopped') return { kind: 'not_conflict_stopped', reason: `${keyOf(n)} is not stopped at a conflict the decider asked you to choose${end ? ` (its run ended: ${end.kind})` : ' (it is not waiting for a choice)'}` };
    const atC = readConflictStopOfRun(runDir);
    if (!atC) return { kind: 'stop_unreadable', reason: `${keyOf(n)}'s stop does not read (${PARTIAL_REPORT_FILE} is missing or holds no conflict stop), so no choice can be recorded for it; ${give}` };
    // no 'consumed' refusal here (unlike the overseer limit): run.json's entries are project-writable text, so one must never lock the person out; a pick given again simply replaces the entry at the next `tree resume` (pendingChoiceOf: applied false)
    return null;
  }
  if (end?.kind === 'conflict_stopped') return { kind: 'conflict_stop', reason: `${keyOf(n)} is stopped at a conflict the decider asked you to choose, not at an overseer limit: answer it with \`council tree decide ${rootId ?? '<tree id>'} --prevail-node ${n.node} --prevail <n>=<objection id>|neither\`, then \`council tree resume ${rootId ?? '<tree id>'}\` applies it` };
  if (end?.kind !== 'round_stopped') return { kind: 'not_round_stopped', reason: `${keyOf(n)} is not stopped at an overseer limit${end ? ` (its run ended: ${end.kind})` : ' (it is not waiting for a choice)'}` };
  const at = readStopOfRun(runDir);
  if (!at) return { kind: 'stop_unreadable', reason: `${keyOf(n)}'s stop does not read (${PARTIAL_REPORT_FILE} is missing or holds no stop), so no choice can be recorded for it; ${give}` };
  const done = roundChoiceOf(runDir, at.id);
  // "consumed" counts only an entry the TREE RECORD backs (the same stop id and the same choice): run.json is project-writable text, so an entry nobody recorded must never lock the person out; the sitting replaces it from the record (applyChoice)
  if (done && n.choice && n.choice.stop === at.id && n.choice.choice === done.choice) return { kind: 'consumed', reason: `${keyOf(n)}'s choice for this stop (${at.id}) was already applied to its run (${done.choice}); it can only be changed by the next stop` };
  return null;
}

/**
 * Records the choice: under the tree lock, re-checks the refusal and appends `node_choice { node, generation, runId, choice, stop }`. The SAME choice for the SAME unconsumed stop again adds no event ({ already: true }); the other choice
 * replaces it (a new event, the newest stands). A refusal writes a `blocked` record and throws a TreeRefusal, as closeIncomplete does. Starts nothing, spends nothing.
 */
export function chooseNode(rootDir, { node, generation = 1, choice, rootId = null, picks = null }, { facts = {}, now } = {}) {
  if (choice !== 'continue' && choice !== 'finish' && choice !== 'prevail') throw new TypeError('chooseNode: choice is exactly "continue", "finish" or "prevail"');
  if ((choice === 'prevail') !== (picks !== null)) throw new TypeError('chooseNode: picks belong to "prevail" and to nothing else');
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const state = stateOf(record);
    const runsDir = dirname(rootDir);
    const refusal = choiceRefusal({ state, runsDir, node, generation, facts, rootId, want: choice === 'prevail' ? 'conflict' : 'round' })
      ?? (choice === 'prevail' ? (() => { const at0 = readConflictStopOfRun(join(runsDir, state.nodes.get(`${node}@g${generation}`).runId)); const ok = picksOf(picks, at0.stop); return ok.ok ? null : { kind: 'bad_pick', reason: ok.why }; })() : null);
    if (refusal) {
      appendTreeEventLocked(rootDir, { event: 'blocked', reason: 'continuation_refused', scope: `${node}@g${generation}`, check: 'choice', detail: refusal.reason }, { facts, now });
      throw new TreeRefusal({ code: 'continuation_refused', transition: 'node_choice', reason: refusal.reason });
    }
    const n = state.nodes.get(`${node}@g${generation}`);
    const at = choice === 'prevail' ? readConflictStopOfRun(join(runsDir, n.runId)) : readStopOfRun(join(runsDir, n.runId));
    if (n.choice && n.choice.stop === at.id && n.choice.choice === choice && (choice !== 'prevail' || samePicks(n.choice.picks, picks))) return { already: true, stop: at.id, choice, event: null };
    const event = appendTreeEventLocked(rootDir, { event: 'node_choice', node, generation, runId: n.runId, choice, stop: at.id, ...(choice === 'prevail' ? { picks } : {}) }, { facts, now });
    return { already: false, stop: at.id, choice, event, replaced: n.choice && n.choice.stop === at.id ? n.choice.choice : null };
  });
}

/** The member's remaining grant, derived (first grant plus every top-up, minus what the run spent; an unsettled reservation counts at its worst case) and whether the spend could be read. { remainingUsd, spendUnknown }. */
export function remainingGrantOf(rootDir, { node, generation = 1 }) {
  const record = readTreeRecord(rootDir);
  const state = stateOf(record);
  const n = state.nodes.get(`${node}@g${generation}`);
  const { returnedUsd, spendUnknown } = closeReturnOf(n, join(dirname(rootDir), n.runId), unreadableFloorOf(record, n.runId));
  return { remainingUsd: returnedUsd, spendUnknown: !!spendUnknown };
}

/**
 * A choice the next sitting acts on, DERIVED (nothing is marked consumed): the member is stopped at an overseer limit and the tree record holds a node_choice for exactly that stop id. `applied: true` = the member's run.json already
 * holds the matching roundChoices entry (written, but the resume never ended, e.g. a crash: resume plainly); `applied: false` = the entry is still to be written. An entry with no recorded choice, or a choice for another stop id, is not pending.
 */
export function pendingChoiceOf(runDir, n) {
  if (typeof runDir !== 'string' || !n || n.phase !== 'running') return null;
  const kind = runEndOf(runDir)?.kind;
  if (kind === 'conflict_stopped') {
    // the conflict's choice: the TREE RECORD's node_choice (prevail, with picks) for exactly this stop id; run.json's conflictChoices alone never starts a paid resume
    const atC = readConflictStopOfRun(runDir);
    if (!atC || !n.choice || n.choice.stop !== atC.id || n.choice.choice !== 'prevail' || !picksOf(n.choice.picks, atC.stop).ok) return null;
    return { choice: 'prevail', picks: n.choice.picks, stop: atC.id, applied: entriesMatch(conflictEntriesOf(runDir, atC.stop.pass), n.choice.picks) };
  }
  if (kind !== 'round_stopped') return null;
  const at = readStopOfRun(runDir);
  if (!at || !n.choice || n.choice.stop !== at.id) return null;      // the TREE RECORD's choice is always required: run.json is project-writable text, so an entry alone never starts a paid resume
  const entry = roundChoiceOf(runDir, at.id);
  return entry && entry.choice === n.choice.choice ? { choice: n.choice.choice, stop: at.id, applied: true } : { choice: n.choice.choice, stop: at.id, applied: false };
}

/** Writes the roundChoices entry for a pending choice into the member's run.json (write-then-rename), keyed by its stop id; a no-op when it is there. The entry carries no `add`: cli.js fills it from the chain file. */
export function applyChoice(runDir, pending) {
  if (pending.applied) return;
  if (pending.choice === 'prevail') {
    // the same entry shape the standalone --prevail writes (cli.js), with `via: 'tree'`: the tree wrote it from its own record
    const atC = readConflictStopOfRun(runDir);
    if (!atC || atC.id !== pending.stop) throw new Error(`the stop of ${runDir} is not ${pending.stop} any more; nothing was written`);
    const fileC = join(runDir, 'run.json');
    const onDiskC = JSON.parse(readFileSync(fileC, 'utf8'));
    const keep = Array.isArray(onDiskC.conflictChoices) ? onDiskC.conflictChoices.filter(c => !(c?.pass === atC.stop.pass && pending.picks.some(p => p.n === c.n))) : [];
    const at = new Date().toISOString();
    const tmpC = `${fileC}.choice.tmp`;
    writeFileSync(tmpC, JSON.stringify({ ...onDiskC, conflictChoices: [...keep, ...pending.picks.map(p => ({ pass: atC.stop.pass, n: p.n, prevail: p.prevail, via: 'tree', at }))] }, null, 2));
    renameSync(tmpC, fileC);
    return;
  }
  const at = readStopOfRun(runDir);
  if (!at || at.id !== pending.stop) throw new Error(`the stop of ${runDir} is not ${pending.stop} any more; nothing was written`);
  const file = join(runDir, 'run.json');
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  const list = Array.isArray(onDisk.roundChoices) ? onDisk.roundChoices.filter(c => c?.stop !== at.id) : [];
  const tmp = `${file}.choice.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...onDisk, roundChoices: [...list, roundChoiceEntry(at.stop, pending.choice)] }, null, 2));
  renameSync(tmp, file);
}

/** For the CLI (cli.js, a member resumed outside a sitting): does the TREE RECORD hold this member's choice for exactly this stop id AND is it the SAME choice the run.json entry carries? An entry in run.json alone (project-writable text), or one that disagrees with the record, never lets a member go on. */
export function recordedChoiceFor(rootDir, { node, generation }, stopId, choice) {
  try {
    const n = stateOf(readTreeRecord(rootDir)).nodes.get(`${node}@g${generation}`);
    return !!(n && n.choice && n.choice.stop === stopId && n.choice.choice === choice);
  } catch { return false; }
}

/**
 * For the CLI (cli.js, a member resumed): of the conflictChoices run.json holds ({ pass, n, prevail }), the ones the TREE RECORD backs: a `node_choice` prevail event for THIS node and generation whose stop id ends in `:<pass>` and
 * whose picks hold { n, prevail }. For each stop only the NEWEST event counts (a pick given again replaces the earlier one). run.json is project-writable text: an entry no event backs never reaches the replay, so it can neither start a
 * paid resume nor write a pick the person never made. A record that does not read backs nothing (fails closed).
 */
export function backedConflictChoices(rootDir, { node, generation }, entries) {
  try {
    const newest = new Map();
    for (const e of readTreeRecord(rootDir).events) if (e.event === 'node_choice' && e.choice === 'prevail' && e.node === node && e.generation === generation && Array.isArray(e.picks)) newest.set(e.stop, e);
    return entries.filter(c => [...newest.values()].some(e => e.stop.endsWith(`:${c.pass}`) && e.picks.some(p => p.n === c.n && p.prevail === c.prevail)));
  } catch { return []; }
}
