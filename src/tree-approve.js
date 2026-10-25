// `council tree approve <rootId>` (0.8.3 M5b2c; PLAN 8.2). The person's approval of the next frontier: show exactly what would start, ask at a terminal (the typed frontier-key prefix, then y/N), and only then record it.
// Order, and why:
//   1. describe the next pending frontier from the record (src/tree-frontier.js, reads only); a refusal is recorded as `blocked` (expansion_refused) and nothing else;
//   2. the text goes under tree/gate-texts/ and a gate is requested on the ROOT run folder; the answer is taken ONLY by the gate's terminal answer (src/tree-gate.js). Until the person answers, NOTHING is
//      added to events.jsonl: a gate left unanswered past its expiry approves nothing and records nothing (PLAN 8.2);
//   3. after the person says yes, the frontier is described AGAIN: if anything it shows has changed in the minutes they read it (the money, a limit, a ceiling), the approval is NOT used and nothing is recorded;
//   4. `frontier_previewed` (the hash of exactly what was shown, once per distinct hash), then the gate's approval is spent (one use), and only then `frontier_approved` is appended with the hash, the gate
//      id and the hash of the text shown. A crash between the spend and the append loses an approval, never keeps one twice.
// Nothing is started here: no child folder, no run, no spend. The children start with `council tree resume`.
// This file reads no environment variable and parses no argument (src/tree-cli.js hands it the parsed flags; `approve` takes none).
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf } from './tree-record.js';
import { terminalSafeMarked } from './terminal-safe.js';
import { recordExpansionRefusal, refusalWords } from './tree-expansion.js';
import { activeIsOwnChild } from './tree-transitions.js';
import { recordDerivationRefusal } from './tree-derive.js';
import { describeFrontier, findPendingFrontier } from './tree-frontier.js';
import { renderFrontierText, prefixOf, money } from './tree-stop.js';
import { TREE_GATE_KINDS, askTreeGate, recordTreeUse, requestTreeGate } from './tree-gate.js';
import { recordReadinessAfter } from './tree-readiness.js';
import { finalSentenceOf, recordRefusalLine, treeFinalRefusal } from './tree-abandon.js';

const EXIT_REFUSED = 19;                    // the same exit the member commands use when the tree refuses (src/cli.js EXIT_TREE_REFUSED)

/** The handler src/tree-cli.js calls for `approve`. Returns the exit code: 0 approved, 1 not confirmed or the approval could not be used (nothing recorded as approved), 2 nothing waits / no terminal, 19 the tree refuses. */
export async function approveHandler({ rootDir, rootId, work, stdin, stdout, stderr, now, deps = {} }) {
  const describe = deps.describeFrontier ?? describeFrontier;      // the seam a test uses to move a displayed figure while the person reads (R15)
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const clock = now ? { now } : {};
  const record = readTreeRecord(rootDir);
  if (!record.tree || record.corrupt.length) { err(`tree approve: the record of ${rootId} does not read (${record.corrupt.length} problem${record.corrupt.length === 1 ? '' : 's'}); nothing can be approved on it`); return EXIT_REFUSED; }
  const state = stateOf(record);
  { const final = treeFinalRefusal(state); if (final) { err(`tree approve: ${final} Nothing was asked and nothing was written.`); return 1; } }       // ROADMAP 57: a final tree offers no approval
  const pending = findPendingFrontier({ rootDir, record, state });
  if (!pending) { out('Nothing waits for your approval: no finished plan in this tree has a verified split whose children are not already approved.'); return 2; }
  // A new frontier is approved when nothing is active. APPROVING AGAIN a frontier that was approved before (a parent_changed block, a refusal the person answers by approving) is allowed while the active node is one of
  // THAT frontier's own children (registered, not started, or interrupted): approving writes no paid event, and without this the block could never be lifted while its own child sits registered (M5c4).
  if (state.active !== null && !activeIsOwnChild(state, pending.key)) { err(`tree approve: ${state.active} is running or paused at an external seat; a frontier is approved when nothing is active`); return 1; }

  const described = describe({ rootDir, work, pending });
  if (described.refusal && pending.kind === 'root_replan') { err(`tree approve: the new root plan cannot be put to you yet. ${described.refusal.detail}`); return EXIT_REFUSED; }       // S8-5: nothing is recorded (there is no parent node a refusal could be about)
  if (described.refusal) {
    const r = described.refusal;
    try {
      if (r.derivationRefusals) for (const d of r.derivationRefusals) recordDerivationRefusal(rootDir, { node: d.node, generation: d.generation ?? 1 }, { code: d.code, detail: d.detail, message: d.detail }, clock);
      else recordExpansionRefusal(rootDir, pending.parent, r, clock);
    } catch (e) { if (!(e instanceof TreeRefusal)) throw e; }
    err(`tree approve: ${pending.parent.node} cannot be expanded yet. ${refusalWords(r)}`);
    return EXIT_REFUSED;
  }

  const text = terminalSafeMarked(renderFrontierText(described.view));     // R8: the plan's own words (scopes, agreements, held items) reach the screen and the hash only after terminalSafe, as every other gate text does
  // the terminal is checked BEFORE the gate is requested (S8-8, as `council tree decide`): a gate request writes a text file and a pending ledger line, and a refused attempt used to leave both behind
  if (!stdin.isTTY || !stdout.isTTY) { err('gate answer needs a person at a terminal: stdin and stdout must both be a terminal. Nothing was written.'); return 2; }
  const gate = requestTreeGate(rootDir, { kind: TREE_GATE_KINDS.frontier, text }, clock);
  if (!gate.ok) { err(`tree approve: cannot ask for the approval (${gate.code}): ${gate.message}`); return 1; }
  const code = await askTreeGate(rootDir, gate.gate.id, { expectPrefix: prefixOf(described.frontierKey), stdin, stdout, stderr, ...clock });
  if (code !== 0) return code;

  // ROADMAP 57: a gate that was pending when the tree was abandoned is NOT used (checked before the approval is spent)
  { const final = finalSentenceOf(rootDir); if (final) { err(`tree approve: ${final} Your approval was NOT used and nothing was recorded.`); return 1; } }
  // what the person read must still be what would start
  const again = describe({ rootDir, work, pending });
  // R15 (M5 API reviews): the bound hash covers the children, the formula and the limits; the text also shows figures it does not bind (spent, held, available, notes). What the person READ must be what is approved: the text is compared too
  if (again.refusal || again.boundSha256 !== described.boundSha256 || terminalSafeMarked(renderFrontierText(again.view)) !== text) {
    err('tree approve: what you were shown has changed while you were reading it (the money, a limit or a ceiling). Your approval was NOT used and nothing was recorded. Run `council tree approve` again to see the new figures.');
    return 1;
  }
  let revision;
  try {
    const f = stateOf(readTreeRecord(rootDir)).frontiers.get(described.frontierKey);
    if (!f?.previewed || f.previewHash !== described.boundSha256) appendTreeEvent(rootDir, { event: 'frontier_previewed', ...described.preview, boundSha256: described.boundSha256 }, clock);
    const used = recordTreeUse(rootDir, gate.gate.id, 'tree_frontier', { frontierKey: described.frontierKey }, clock);
    if (!used.ok) { err(`tree approve: the approval could not be used (${used.code}): ${used.message}. Nothing was approved.`); return 1; }
    revision = (f?.revisions.length ?? 0) + 1;
    appendTreeEvent(rootDir, { event: 'frontier_approved', frontierKey: described.frontierKey, revision, boundSha256: described.boundSha256, gateId: gate.gate.id, shownSha256: gate.gate.sha256, ...used.answeredBy }, clock);
  } catch (e) {
    if (!(e instanceof TreeRefusal)) throw e;
    err(recordRefusalLine({ verb: 'tree approve', reason: e.reason, rootDir, again: 'Run `council tree approve` again: it shows the tree\'s current state.' }));
    return EXIT_REFUSED;
  }
  recordReadinessAfter(rootDir, { work, ...clock });                 // PLAN 9.2: an approval changes what the next step may do; the verdict is recorded now, never failing the approval
  if (pending.kind === 'root_replan') {
    out(`Approved: frontier ${prefixOf(described.frontierKey)}, revision ${revision}. Up to ${money(described.view.child.admitted ? described.view.child.grant : 0)} for the new root run (R@g${described.view.generation}). Nothing has started: it starts with \`council tree resume ${rootId}\`.`);
    return 0;
  }
  // The line the person reads LAST must say what the text above it says (found by the real-verb probe of the Finding-A fix-up): it counts ONLY the children this approval starts - admitted and not registered yet, the same rule as the "Approving authorizes" line in
  // src/tree-stop.js - and names the already-registered ones as such, never as runs to start. With none: "No new run, $0.00".
  const fresh = described.view.children.filter(c => c.admitted && !c.registered && !c.reused);
  const already = described.view.children.filter(c => c.registered);
  const reusedKids = described.view.children.filter(c => c.reused);
  const total = Math.round(fresh.reduce((n, c) => n + c.grant, 0) * 10000) / 10000;
  const head = `Approved: frontier ${prefixOf(described.frontierKey)}, revision ${revision}.`;
  const alreadyText = already.length ? ` Already registered, not started by this approval: ${already.map(c => c.node).join(', ')}.` : '';
  const reusedText = reusedKids.length ? ` Reused, nothing new started: ${reusedKids.map(c => `${c.node} (${c.reused.adoptsNode} generation ${c.reused.adoptsGeneration})`).join(', ')}.` : '';       // B-DRAFT (C2b-2)
  out(fresh.length
    ? `${head} Up to ${money(total)} for ${fresh.length} new child run${fresh.length === 1 ? '' : 's'} (${fresh.map(c => c.node).join(', ')}).${alreadyText}${reusedText} Nothing has started: the new children start with \`council tree resume ${rootId}\`.`
    : `${head} No new run, ${money(0)}.${alreadyText} Run \`council tree resume ${rootId}\` to go on.`);
  return 0;
}
