// SESSION CHANNEL, the frontier approval (plan Review/Build_0.8.3/m7/Frontier_Session_Plan_2026-10-19.md; Atomic_Tree_Budget_Gate_Page.md section 4 and 12 Q6; C&C thcmcp-6d, 19 Okt 2026).
// The controlling session approves the NEXT frontier in two calls, as a person does with `council tree approve`, but only when the Atomic conditions hold; anything else is the person's and is refused BEFORE any gate is written:
//   - a first approval of a SPLIT frontier (never a root re-plan, never a re-approval or a reopened frontier, never the first children frontier of a re-planned root: X1 passes over held children);
//   - every child is admitted and none is cut below its ceiling (the preview is fully funded), no child carries a refused guard, an unenforced check or a held item (an obligation that is not carried is a state change);
//   - no unknown spend is held and the accounting gate passes; a written reason. The text shown is NOT screened for credentials or personal data (6d, Muad: overengineering): the session is local, the root task is checked at the start, and a child's input is checked at registration.
// The sequence is tree-approve.js's own (describe, compare, preview if new, spend the gate, approve). This file imports no gate module and names no gate-answer function (the scan in test/gate-answer.test.js): the gate goes through tree-gate.js.
// An approval moves no dollar: grants are issued at registration under the tree lock against `available` (the real money fence, untouched). The record carries `sessionConditions` (the figures the writer saw) as an audit backstop.
// All sentences are B-DRAFT.
import { sha256Of } from './thin-contract.js';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from './tree-record.js';
import { activeIsOwnChild } from './tree-transitions.js';
import { describeFrontier, findPendingFrontier, frontierReopened } from './tree-frontier.js';
import { notAdmittedWords, renderFrontierText } from './tree-stop.js';
import { refusalWords } from './tree-expansion.js';
import { recordFrontierRefusal } from './tree-approve.js';
import { terminalSafeMarked } from './terminal-safe.js';
import { lockHolder } from './run-lock.js';
import { SITTING_LOCK_FILE } from './tree-files.js';
import { TREE_GATE_KINDS, answerTreeGateAsSession, recordTreeUse, requestTreeGate } from './tree-gate.js';
import { recordReadinessAfter } from './tree-readiness.js';
import { finalSentenceOf, recordRefusalLine, treeFinalRefusal } from './tree-abandon.js';

const person = why => `${why}. This approval is a person's: \`council tree approve\``;       // B-DRAFT
const some = v => (Array.isArray(v) ? v.length > 0 : !!v);

/** Everything the session may check without writing: the pending frontier, the Atomic conditions, the text. -> { refusal } | { ok, pending, described, text, conditions }. */
function frontierPre({ rootDir, work, reason, deny = null }, { needReason = true } = {}) {
  if (needReason && (typeof reason !== 'string' || reason.trim().length < 3)) return { refusal: 'the answer carries the USER\'s own yes in their words (reason): ask the user first, show them the quoted text, and pass what they said. Nothing was recorded.' };       // B-DRAFT (Muad 21 Okt 2026: a session may not approve money on a written reason alone)
  const record = readTreeRecord(rootDir);
  if (!record.tree || record.corrupt.length) return { refusal: `the record does not read (${record.corrupt.length} problem(s)); nothing can be approved on it` };
  const state = stateOf(record);
  { const final = treeFinalRefusal(state); if (final) return { refusal: `${final} Nothing was asked and nothing was written.` }; }
  if (lockHolder(treeDirOf(rootDir), { file: SITTING_LOCK_FILE })) return { refusal: 'a sitting of this tree is running: a frontier approved now could be picked up without anyone typing "council tree resume". Ask again when it has ended. Nothing was recorded.' };       // B-DRAFT
  const pending = findPendingFrontier({ rootDir, record, state });
  if (!pending) return { refusal: 'nothing waits for approval: no finished plan in this tree has a verified split whose children are not already approved' };
  if (state.active !== null && !activeIsOwnChild(state, pending.key)) return { refusal: `${state.active} is running or paused at an external seat; a frontier is approved when nothing is active` };
  if (pending.kind === 'root_replan') return { refusal: person('the new root plan') };
  const f = state.frontiers.get(pending.key);
  if (f?.revisions?.length || frontierReopened(record, pending.key)) return { refusal: person('this frontier was approved before or was reopened by a change') };
  if (pending.parent?.node === 'R' && pending.parent.generation >= 2) return { refusal: person('this is the first children frontier of a re-planned root: its approval passes over the held children of the earlier root plan') };
  const described = describeFrontier({ rootDir, work, pending, deny });       // R16: the MCP route passes the denylist (src/mcp/tree-decide.js)
  if (described.refusal) return { refusal: `the frontier cannot be put to anyone yet: ${refusalWords(described.refusal)}`, frontierRefusal: { pending, r: described.refusal } };     // recorded by the caller (this function writes nothing)
  const { view } = described; const kids = view.children ?? [];
  const open = kids.filter(c => !c.registered && !c.reused);
  if (open.some(c => !c.admitted)) return { refusal: person(`${open.filter(c => !c.admitted).map(c => c.node).join(', ')} is not admitted (${notAdmittedWords(open.find(c => !c.admitted).notAdmittedReason) ?? 'see the preview'})`) };
  if (open.some(c => c.mayStop)) return { refusal: person('a child would get less than its ceiling, so it may stop before it finishes') };
  if (kids.some(c => some(c.refused) || some(c.notEnforced) || some(c.held))) return { refusal: person('a child carries a refused guard, an unenforced check or a held item: approving it accepts an obligation that is not carried') };
  const b = view.budget ?? {};
  if (!(Number.isFinite(b.availableUsd) && b.unknownSpendHeldUsd === 0)) return { refusal: person('money of unknown size is held, or the free amount is not known') };
  const grantsUsd = Math.round(open.reduce((n, c) => n + (c.grant || 0), 0) * 10000) / 10000;
  if (grantsUsd > b.availableUsd + 1e-9) return { refusal: person(`the grants (${grantsUsd}) are above the free amount (${b.availableUsd})`) };
  const text = terminalSafeMarked(`${renderFrontierText(view)}\nThe session must have asked the user before it answers: the answer records the user's own yes in their words, and THC cannot check that the session asked. Nothing runs until a person types "council tree resume".\n`);       // B-DRAFT
  return { ok: true, pending, described, text, conditions: { availableUsd: b.availableUsd, grantsUsd, unknownSpendHeldUsd: 0 } };
}

/** Call 1: the exact text and its hash; a pending gate the SESSION asked for. -> { refusal } | { gateId, text, shownSha256, expiresAt }. */
export function sessionFrontierQuote(a, { now } = {}) {
  const pre = frontierPre(a, { needReason: false });
  // D3 F2-2: the session route records a frontier refusal like `tree approve` (one writer: recordFrontierRefusal), so a derivation refusal is a trigger readiness re-derives; it opens no stop here (no MCP route runs a sitting's
  // writes): the next sitting opens it, and until then status says the next resume opens it
  if (pre.frontierRefusal) recordFrontierRefusal(a.rootDir, pre.frontierRefusal.pending, pre.frontierRefusal.r, now ? { now } : {});
  if (pre.refusal) return { refusal: pre.refusal };
  const gate = requestTreeGate(a.rootDir, { kind: TREE_GATE_KINDS.frontier, text: pre.text, requestedBy: 'session' }, now ? { now } : {});
  if (!gate.ok) return { refusal: `cannot ask for the approval (${gate.code}): ${gate.message}` };
  return { gateId: gate.gate.id, text: pre.text, shownSha256: sha256Of(pre.text), expiresAt: gate.gate.expires_at };
}

/** Call 2: the hash back with the reason. -> { refusal } | { recorded }. */
export function sessionFrontierAnswer(a, { now } = {}) {
  const clock = now ? { now } : {};
  if (typeof a.gate !== 'string' || typeof a.shown !== 'string') return { refusal: 'the second call carries the gate id and the hash returned by the first (gate, shown)' };
  const pre = frontierPre(a); if (pre.refusal) return pre;
  if (sha256Of(pre.text) !== a.shown) return { refusal: 'what was quoted has changed (the money, a limit or a ceiling) or is not the text you hold. Nothing was recorded. Ask again to see the new figures.' };
  const ans = answerTreeGateAsSession(a.rootDir, a.gate, { shownSha256: a.shown, reason: a.reason.trim() }, clock);
  if (!ans.ok) return { refusal: ans.message };
  { const final = finalSentenceOf(a.rootDir); if (final) return { refusal: `${final} The approval was NOT used and nothing was recorded.` }; }
  const again = frontierPre(a);       // what was shown must still be what would start (R15), after the gate answer as in tree-approve.js
  if (again.refusal || again.described.boundSha256 !== pre.described.boundSha256 || again.text !== pre.text) return { refusal: 'what you were shown has changed while the approval was given. The approval was NOT used and nothing was recorded. Ask again.' };
  const { described } = pre;
  try {
    const f = stateOf(readTreeRecord(a.rootDir)).frontiers.get(described.frontierKey);
    if (!f?.previewed || f.previewHash !== described.boundSha256) appendTreeEvent(a.rootDir, { event: 'frontier_previewed', ...described.preview, boundSha256: described.boundSha256 }, clock);
    const used = recordTreeUse(a.rootDir, a.gate, 'tree_frontier', { frontierKey: described.frontierKey }, clock);
    if (!used.ok) return { refusal: `the approval could not be used (${used.code}): ${used.message}. Nothing was approved.` };
    const revision = (f?.revisions.length ?? 0) + 1;
    appendTreeEvent(a.rootDir, { event: 'frontier_approved', frontierKey: described.frontierKey, revision, boundSha256: described.boundSha256, gateId: a.gate, shownSha256: a.shown, sessionConditions: pre.conditions, ...used.answeredBy }, clock);
  } catch (e) {
    if (!(e instanceof TreeRefusal)) throw e;
    return { refusal: recordRefusalLine({ verb: 'tree approve', reason: e.reason, rootDir: a.rootDir, again: 'Ask again: the next quote shows the current state.' }) };
  }
  recordReadinessAfter(a.rootDir, { work: a.work, ...clock });
  return { recorded: `frontier ${described.frontierKey.slice(0, 12)} approved by the session (up to ${pre.conditions.grantsUsd} USD of ${pre.conditions.availableUsd} free); nothing has started: run \`council tree resume\`` };       // B-DRAFT
}
