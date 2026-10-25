// The paid repair recommendation, the HOLD (0.8.3 ROADMAP 77, step 1: the grant). Plan note Review/Build_0.8.3/m7/Roadmap77_Paid_Repair_Plan_Note_2026-10-20.md section 10; A's gate note m7/A_Paid_Repair_Recommendation_Gate_Note.md (C&C PASS ON CONDITIONS 18 Okt) for the
// shape; the ORDER is C&C's ruling of 20 Okt: the hold comes FIRST (the session or the person answers the grant y/N), the PERSON then approves the brief (the add-on's own gate, not recorded here), then each call is sent.
// RECORDS AND MONEY ONLY: no CLI, no MCP, no offer text, no model. Every function takes the tree lock once (the `registerChildAdmitted` pattern): re-read the record, check, append.
//   registerAdviceAdmitted  the grant: refused unless the record reads, the accounting gate passes, nothing is active, no other request holds, the cap is not exhausted and grantUsd <= available. Appends `advice_registered`.
//   adviceStart             adds ONE call (the first, or the one more ask) to an open request, before it is sent. -> { capUsd (what is left of the grant: the call's --max-usd), mirror(line) }
//   endAdvice               ends a request and gives back what its calls did not spend. Called by the flow (settled, declined, stopped) and by reconcile.
//   reconcileAdvice         ends a request nobody will finish: its brief approval expired or its claim is dead, and no call of it is still running.
// The hold waits on a PERSON (the brief approval), so `expiresAtMs` (registration time + the brief quote's TTL, passed in by the flow: this file imports nothing from the add-on) bounds it; a live pid cannot be its only release.
// Attribution: the session answering the GRANT rests on a C&C ruling (the MONEY heading's reading, 14 Okt, "his to reverse"), never on Muad's words. The money rows are adviceMoneyOf (src/tree-budget.js), kept out of budget.nodes (AP-3).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { MONEY_EPS, budgetOf, capFactsOf, gateTree } from './tree-budget.js';
import { claimAlive, liveAdviceOf, unansweredAdviceOf } from './tree-transitions.js';
import { deriveRunStatus } from './run-status.js';

const scopeOf = adviceId => `advice:${adviceId}`;

/** A run folder's end, as the run status derives it. 'missing' = no folder yet (added to the request, not sent). */
export const defaultRunStatusOf = runDir => {
  if (!existsSync(runDir)) return 'missing';
  let meta = null; try { meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')); } catch { /* no run.json yet: deriveRunStatus reads the gate's state */ }
  return deriveRunStatus(runDir, meta);
};
export const RUNNING = new Set(['running', 'paused', 'awaiting_user_cap', 'pending']);

/**
 * The unended recommendation requests an ABANDON must wait for (BUG-B-015): the table's narrow rule (liveAdviceOf: claim alive and the wait for the brief's approval not expired) AND any request with a call whose folder still runs. A call may outlive both the process that
 * registered it and the wait for the brief (a detached run holds its grant until it ends; reconcileAdviceLocked releases a request only when every call folder shows an end), and once the tree is abandoned the table refuses `advice_ended`, so such a request could never be ended.
 * -> [{ adviceId, pid, host }]. `runStatusOf(runDir)` is injectable (default: the run status derived from the folder).
 */
export function adviceAbandonHoldsOf(rootDir, state, { facts, runStatusOf = defaultRunStatusOf } = {}) {
  const runsDir = dirname(rootDir);
  const out = liveAdviceOf(state, facts);
  const seen = new Set(out.map(a => a.adviceId));
  for (const a of state.advice.values()) {
    if (a.ended || seen.has(a.adviceId) || !a.runs.length) continue;
    if (a.runs.some(r => RUNNING.has(runStatusOf(join(runsDir, r.runId))))) out.push({ adviceId: a.adviceId, pid: a.claim.pid, host: a.claim.host });
  }
  return out;
}

function openRecord(rootDir) {
  const record = readTreeRecord(rootDir);
  if (record.corrupt.length || !record.tree) return { record, bad: record.corrupt.length ? `the tree record is corrupt (${record.corrupt.map(c => c.reason).join('; ')})` : 'there is no tree.json' };
  return { record };
}

/**
 * The grant. `answer` = { actor: 'person', via: 'terminal' | 'elicitation' } or { actor: 'session', via: 'mcp', reason }. Throws a TreeRefusal (and writes a `blocked` record) when it is not admitted; nothing is held then.
 * -> the `advice_registered` event.
 */
export function registerAdviceAdmitted(rootDir, { adviceId, grantUsd, stopId, gateId, shownSha256, answer, ttlMs, pid = process.pid, host = hostname() }, { now = () => Date.now(), facts } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('registerAdviceAdmitted: ttlMs is the brief quote\'s time to live (QUOTE_TTL_MS), passed in by the caller');
  return withTreeLock(rootDir, () => {
    reconcileAdviceLocked(rootDir, { now, facts });          // a request nobody will finish is released first, in this same hold: an expired hold never blocks the next one
    const { record, bad } = openRecord(rootDir);
    const refuse = (reason, detail) => {
      appendTreeEventLocked(rootDir, { event: 'blocked', reason, scope: scopeOf(adviceId), transition: 'advice_registered', check: 'admission', detail }, { facts, now });
      throw new TreeRefusal({ code: reason, transition: 'advice_registered', reason: detail });
    };
    const event = { event: 'advice_registered', adviceId, grantUsd, purpose: 'recommendation', stopId, gateId, shownSha256, pid, host, expiresAtMs: now() + ttlMs, ...answer };
    if (bad) return appendTreeEventLocked(rootDir, event, { facts, now });          // throws the table's own refusal / the corrupt-record error, as registerChildAdmitted does
    const gate = gateTree(rootDir, { record });
    if (!gate.ok) refuse('accounting_blocked', `the accounting gate fails: ${gate.problems.slice(0, 3).map(p => `${p.code} (${p.detail})`).join('; ')}`);
    const state = stateOf(record);
    // the same fold fields rootReplanPreflight (2.3) and the table's decision rows read: a LIVE registered-never-started node counts as active (a dead one does not: SLOT FIX, C&C 23 Okt 2026)
    if (state.active !== null) refuse('continuation_refused', `${state.active} is active: a recommendation is not asked for while a node is registered or running`);
    const budget = budgetOf(rootDir, { record, gate });
    if (capFactsOf(record, budget).exhausted) refuse('continuation_refused', 'the tree\'s cap is used up: no recommendation is held for');
    if (!(grantUsd > 0) || grantUsd > budget.availableUsd + MONEY_EPS) refuse('continuation_refused', `not admitted: budget (a grant of ${grantUsd} does not fit the ${budget.availableUsd.toFixed(4)} the cap has free)`);
    return appendTreeEventLocked(rootDir, event, { facts, now });
  });
}

/** What the request's calls have spent so far, from the gate's own figures (an unsettled reservation counts at its worst case). Reads the folders; call it inside the lock. */
function requestMoney(rootDir, record, adviceId) {
  const gate = gateTree(rootDir, { record });
  return { gate, row: budgetOf(rootDir, { record, gate }).advice.find(r => r.adviceId === adviceId) };       // read through budgetOf (AP-3)
}

/**
 * Adds one call to an open request, BEFORE it is sent. Refused when the request is not open (ended: the table says so too), when the brief's approval came after `expiresAtMs`, or when the gate fails.
 * -> { event, capUsd, mirror } : `capUsd` is what is left of the grant, the call's --max-usd; `mirror(line)` writes `advice_reservation_mirrored` for one line of the call's own reservation file.
 */
export function adviceStart(rootDir, { adviceId, runId, kind, briefSha256, shownSha256 }, { now = () => Date.now(), facts } = {}) {
  return withTreeLock(rootDir, () => {
    const { record, bad } = openRecord(rootDir);
    const refuse = (reason, detail) => {
      appendTreeEventLocked(rootDir, { event: 'blocked', reason, scope: scopeOf(adviceId), transition: 'advice_run_added', check: 'admission', detail }, { facts, now });
      throw new TreeRefusal({ code: reason, transition: 'advice_run_added', reason: detail });
    };
    if (bad) throw new TreeRefusal({ code: 'record_corrupt', transition: 'advice_run_added', reason: bad });
    const a = stateOf(record).advice.get(adviceId);
    if (a && !a.ended && now() >= a.expiresAtMs) refuse('continuation_refused', `the brief was approved after the wait for it ran out (${adviceId}); its grant is released the next time the tree is read`);
    const { gate, row } = requestMoney(rootDir, record, adviceId);
    if (!gate.ok) refuse('accounting_blocked', `the accounting gate fails: ${gate.problems.slice(0, 3).map(p => `${p.code} (${p.detail})`).join('; ')}`);
    const event = appendTreeEventLocked(rootDir, { event: 'advice_run_added', adviceId, runId, kind, briefSha256, shownSha256 }, { facts, now });
    const capUsd = Math.max(0, (row?.grantUsd ?? 0) - (row?.spentUsd ?? 0));
    return { event, capUsd, mirror: adviceMirrorOf(rootDir, { adviceId, runId }, { facts, now }) };
  });
}

/** `mirror(line)` writes `advice_reservation_mirrored` for one line of an advice run's own reservation file. The sender gets it from adviceStart; the advice run's OWN process builds it from the marker (adviceMirrorFromMarker). */
export function adviceMirrorOf(rootDir, { adviceId, runId }, { now = () => Date.now(), facts } = {}) {
  return line => withTreeLock(rootDir, () => appendTreeEventLocked(rootDir, { event: 'advice_reservation_mirrored', adviceId, runId, line }, { facts, now }));
}

/** The file the sender writes into a tree request's run folder, before the run starts: which tree record and which request the run's reservations are mirrored into. The record's table still decides whether a line is accepted. */
export const ADVICE_TREE_MARKER = 'tree-advice.json';
export function writeAdviceTreeMarker(runDir, { rootDir, adviceId }) {
  writeFileSync(join(runDir, ADVICE_TREE_MARKER), JSON.stringify({ schema: 'tree-advice/1', rootDir, adviceId, runId: basename(runDir) }), { flag: 'wx' });
}

/**
 * -> null when the folder has no marker (an ordinary advice call); { mirror, adviceId, remainingUsd } when it has a good one; throws a plain Error when a marker is there but unusable (the caller refuses to start: a run whose spend would not reach the tree's record
 * must not be sent). The marker must name this very folder, the tree record must read, and it must hold that request open with this call already added (adviceStart), so a start that the record would refuse is refused BEFORE the approval is used.
 */
export function adviceMirrorFromMarker(runDir, { now, facts } = {}) {
  const file = join(runDir, ADVICE_TREE_MARKER);
  if (!existsSync(file)) return null;
  let m; try { m = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error(`${ADVICE_TREE_MARKER} cannot be read`); }
  if (m?.schema !== 'tree-advice/1' || typeof m.rootDir !== 'string' || typeof m.adviceId !== 'string' || m.runId !== basename(runDir)) throw new Error(`${ADVICE_TREE_MARKER} does not name this folder`);
  const record = readTreeRecord(m.rootDir);
  if (record.corrupt.length || !record.tree) throw new Error('the tree record cannot be read');
  const a = stateOf(record).advice.get(m.adviceId);
  if (!a || a.ended) throw new Error(`the tree request ${m.adviceId} is not open`);
  if (!a.runs.some(r => r.runId === m.runId)) throw new Error(`the tree request ${m.adviceId} has not added this call`);
  // what is left of the grant: the same row adviceStart reads (an unsettled reservation counts at its worst case in `spentUsd`; a request can hold several runs)
  const { gate, row } = requestMoney(m.rootDir, record, m.adviceId);
  if (!gate.ok || !row) throw new Error('the tree record\'s accounting does not pass, so the grant\'s remainder cannot be read');
  return { mirror: adviceMirrorOf(m.rootDir, { adviceId: m.adviceId, runId: m.runId }, { now, facts }), adviceId: m.adviceId, remainingUsd: Math.max(0, row.grantUsd - row.spentUsd) };
}

/**
 * Ends a request: its unspent grant is given back (held becomes 0). `reason` is one of ADVICE_END_REASONS. `returnedUsd` is the grant minus what the gate shows its calls spent, never below zero.
 * Fails closed on an unreadable folder: the gate fails then, and the grant is not claimed back as returned (returnedUsd 0), though a request that ended holds nothing and its spend stays counted by the gate.
 */
export function endAdvice(rootDir, { adviceId, reason }, { now = () => Date.now(), facts } = {}) {
  return withTreeLock(rootDir, () => {
    const { record, bad } = openRecord(rootDir);
    if (bad) throw new TreeRefusal({ code: 'record_corrupt', transition: 'advice_ended', reason: bad });
    const { gate, row } = requestMoney(rootDir, record, adviceId);
    const returnedUsd = gate.ok && row ? Math.max(0, row.grantUsd - row.spentUsd) : 0;
    return appendTreeEventLocked(rootDir, { event: 'advice_ended', adviceId, reason, returnedUsd }, { facts, now });
  });
}

/**
 * Ends the requests nobody will finish. -> [advice_ended events written]. A request with NO call is ended once its brief approval has expired (`expired`) or its claim is dead on this host (`never_started`). A request WITH calls
 * is ended only when the wait expired or the claim died AND every call's folder shows an end (a call may outlive the process that registered it: the detached run holds the grant until it ends); `settled` when all finished,
 * else `crashed`. `runStatusOf(runDir)` is injectable (default: the run status derived from the folder). A claim of another host is never judged dead from here (claimAlive).
 */
export const reconcileAdvice = (rootDir, opts = {}) => withTreeLock(rootDir, () => reconcileAdviceLocked(rootDir, opts));
/** The body of reconcileAdvice, for a caller that already holds the tree lock (admission releases an expired hold in the SAME hold, so a stale request never blocks the next one). */
export function reconcileAdviceLocked(rootDir, { now = () => Date.now(), facts, runStatusOf = defaultRunStatusOf } = {}) {
  {
    const { record, bad } = openRecord(rootDir);
    if (bad) return [];
    const out = [];
    const runsDir = dirname(rootDir);
    const nowMs = now();
    const state = stateOf(record);
    // no call: the ONE release rule (src/tree-transitions.js unansweredAdviceOf), shared with recovery
    for (const x of unansweredAdviceOf(state, { ...facts, nowMs })) out.push(appendTreeEventLocked(rootDir, { event: 'advice_ended', ...x }, { facts, now }));
    // with calls: ended only when the wait expired or the claim died AND every call's folder shows an end
    for (const a of state.advice.values()) {
      if (a.ended || a.runs.length === 0 || !(nowMs >= a.expiresAtMs || !claimAlive(a.claim, facts))) continue;
      const statuses = a.runs.map(r => runStatusOf(join(runsDir, r.runId)));
      if (statuses.some(s => RUNNING.has(s))) continue;                    // a call is still going: its grant stays held
      const { gate, row } = requestMoney(rootDir, record, a.adviceId);
      const returnedUsd = gate.ok && row ? Math.max(0, row.grantUsd - row.spentUsd) : 0;
      out.push(appendTreeEventLocked(rootDir, { event: 'advice_ended', adviceId: a.adviceId, reason: statuses.every(s => s === 'done') ? 'settled' : 'crashed', returnedUsd }, { facts, now }));
    }
    return out;
  }
}
