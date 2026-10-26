// Reproduce or refuse (0.8.3 M3; PLAN 5.5, failure-state table rows 3 and 9). Before any expansion of a node, each of these is checked explicitly and IN THIS ORDER; a successful `contract check` alone is never
// treated as the panel's approval, and the first failure is reported with its item and the field it names:
//   1. the panel passed and signed THIS text: report.json `passed`, `signed_text.signed_off`, `delivered_text.same_as_signed` (so no dispute, challenge or final edit changed it after the review) and
//      `handoff_text.made_from_signed`;
//   2. the files on disk are the files the run wrote: `contract check` exits 0 (src/run-contract-check.js, the command's own function);
//   3. the block is the signed block and the handoff reproduced it: the marked block of the BODY of deliverable.md (the file without the harness's notes, found by delivered_text.body_sha256) and the one in
//      HANDOFF.md are compared field by field as canonical JSON; a plan with no block cannot expand (`no_split`);
//   4. the split is valid (every check of PLAN 5.3) and, when a frontier key is given, that frontier's approval exists, is still valid and was made for this split.
// A refusal is a `blocked` record (reason expansion_refused, the check named) and NOTHING else: no child folder, no change to `passed`. Items 1-3 are also what a child's start re-checks on every ancestor
// (PLAN 7.6 step 2, src/tree-continuation.js defaultAncestorCheck). Pure of models; reads files; writes only the record, and only through the two functions at the bottom.
import { basename, dirname } from 'node:path';
import { contractCheckOf } from './run-contract-check.js';
import { readRunFile, readRunJson, trustedRunDir } from './run-files.js';
import { criterionIds } from './criteria-ledger.js';
import { appendTreeEvent, readTreeRecord, stateOf } from './tree-record.js';
import { approvalValid } from './tree-transitions.js';
import { childNode, nodeKey } from './tree-identity.js';
import { bodyOfDelivered, checkSplit, extractSplitBlocks, firstDifference, splitSha256 } from './tree-split.js';
import { DeriveRefusal, resolveContextRefs } from './tree-context-refs.js';
import { rootTaskOf } from './tree-root-task.js';

const refusal = (item, check, field, detail) => ({ item, check, field, detail });

/** The words of a refusal, for a message and for the `detail` of the blocked record. */
export const refusalWords = r => `PLAN 5.5 item ${r.item} (${r.check}): ${r.field}: ${r.detail}`;

/**
 * { refusal, sha256, block }: `refusal` is null when every item up to `upTo` holds, else { item, check, field, detail } for the FIRST that fails. `sha256` and `block` are the verified split once item 3 has passed.
 *   runDir          the node's run folder (a trusted one: runs/<id>)
 *   work            the working folder (the task file a `contract check` reads is resolved from it)
 *   upTo            3 for an ancestor check (a child's start); 4 for an expansion
 *   inheritedGlobal / ancestorQuestions   the tree's inputs to PLAN 5.3 checks 3 and 8 (item 4): REQUIRED when upTo is 4 (an empty list at the root), else it throws
 *   deny                    the secret denylist predicate a reader of an UNTRUSTED run folder passes (src/run-contract-check.js, R16); the CLI on the person's own folder passes none
 *   frontierKey, frontier   the frontier being approved (state.frontiers.get(key)), checked at item 4 when a key is given
 *   accepted                the body hash the RECORD accepts for this node (planAuthorityOf; gate page 12), or null: the body is then read against it (items 2 and 3) instead of report.json's own hash
 */
export function expansionCheck({ runDir, work, upTo = 4, inheritedGlobal, ancestorQuestions, frontierKey = null, frontier = null, deny = null, accepted = null }) {
  // C&C, M3 PASS: `inheritedGlobal` and `ancestorQuestions` are the tree's inputs to PLAN 5.3 checks 3 and 8. The pure checkSplit treats them as optional (the report field is block-local), but an EXPANSION must never
  // run those two checks "by silence": at item 4 the caller passes both (an empty list at the root), or this throws. An ancestor check (upTo 3) needs neither.
  if (upTo >= 4) {
    for (const [name, v] of [['inheritedGlobal', inheritedGlobal], ['ancestorQuestions', ancestorQuestions]]) {
      if (!Array.isArray(v)) throw new TypeError(`expansionCheck: ${name} is required for an expansion (PLAN 5.3 checks 3 and 8 need it): pass the tree's list, or [] at the root`);
    }
  }
  const out = r => ({ refusal: r, sha256: null, block: null });
  const report = readRunJson(runDir, 'report.json');
  if (!report) return out(refusal(1, 'report_missing', 'report.json', 'report.json is missing or unreadable'));
  // 1. the panel passed and signed this text
  if (report.passed !== true) return out(refusal(1, 'panel_passed', 'passed', 'the panel did not pass this plan (report.json passed is not true)'));
  if (report.signed_text?.signed_off !== true) return out(refusal(1, 'signed_off', 'signed_text.signed_off', 'the panel did not sign off its text'));
  if (report.delivered_text?.same_as_signed !== true) {
    const by = Array.isArray(report.delivered_text?.changed_by) ? report.delivered_text.changed_by : [];
    return out(refusal(1, 'delivered_is_signed', 'delivered_text.same_as_signed', `the delivered text is not the signed text${by.length ? ` (changed by ${JSON.stringify(by)})` : ''}`));
  }
  if (report.handoff_text?.made_from_signed !== true) {
    // A harness note above the body (the cold-reader block) is the one way a clean, signed, unchanged plan lands here: the handoff is made from the delivered text, note included, so it is not made from the signed text
    // alone. Read literally (C&C, 8 Oct 2026, DECISIONS): such a run does not expand in 0.8.3. Say so in plain words.
    const notes = Array.isArray(report.delivered_text?.harness_notes) ? report.delivered_text.harness_notes : [];
    return out(refusal(1, 'handoff_from_signed', 'handoff_text.made_from_signed', notes.length
      ? `the handoff was made from the delivered text, and a harness note (${notes.join(', ')}) sits above the plan's body, so it was not made from the signed text alone; a run with a harness note above its body does not expand in 0.8.3`
      : 'the handoff was not made from the signed text'));
  }
  // 2. the files on disk are the files the run wrote
  const trusted = trustedRunDir(dirname(runDir), basename(runDir));
  if (trusted.refusal) return out(refusal(2, 'contract_check', 'run folder', trusted.refusal));
  const checked = contractCheckOf(trusted.dir, { work, deny, accepted });
  if (checked.exit !== 0) {
    const drift = checked.shown?.out?.filter(l => l.startsWith('DRIFT')).join('; ');
    return out(refusal(2, 'contract_check', 'contract check', `\`contract check\` exits ${checked.exit}${checked.exit === 1 ? ' (drift)' : checked.exit === 2 ? ' (nothing outside report.json could be checked)' : ''}${drift ? `: ${drift}` : ''}`));
  }
  // 3. the block is the signed block, and the handoff reproduced it
  const deliverable = readRunFile(trusted.dir, 'deliverable.md');
  if (typeof deliverable.text !== 'string') return out(refusal(3, 'body_block', 'deliverable.md', deliverable.refusal || 'deliverable.md is missing'));
  const body = bodyOfDelivered(deliverable.text, accepted ? { ...report.delivered_text, body_sha256: accepted } : report.delivered_text);
  if (body.error) return out(refusal(3, 'body_block', 'delivered_text.body_sha256', body.error));
  const inBody = extractSplitBlocks(body.body);
  if (!inBody.length) return out(refusal(3, 'no_split', 'deliverable.md', 'the plan holds no split block (a plan without one cannot expand; the person reads that run\'s own handoff)'));
  if (inBody.length > 1) return out(refusal(3, 'split_invalid', 'deliverable.md', `the plan holds ${inBody.length} split blocks; it must hold exactly one`));
  let bodyBlock;
  try { bodyBlock = JSON.parse(inBody[0].text); } catch { return out(refusal(3, 'split_invalid', 'deliverable.md', 'the plan\'s split block does not parse as JSON')); }
  const handoff = readRunFile(trusted.dir, 'HANDOFF.md');
  if (typeof handoff.text !== 'string') return out(refusal(3, 'handoff_block', 'HANDOFF.md', handoff.refusal || 'HANDOFF.md is missing'));
  const inHandoff = extractSplitBlocks(handoff.text);
  if (inHandoff.length !== 1) return out(refusal(3, 'handoff_block', 'HANDOFF.md', inHandoff.length ? `HANDOFF.md holds ${inHandoff.length} split blocks; it must reproduce exactly one` : 'HANDOFF.md does not reproduce the split block'));
  let handoffBlock;
  try { handoffBlock = JSON.parse(inHandoff[0].text); } catch { return out(refusal(3, 'handoff_block', 'HANDOFF.md', 'the split block in HANDOFF.md does not parse as JSON')); }
  const diff = firstDifference(bodyBlock, handoffBlock);
  if (diff) return out(refusal(3, 'handoff_differs', diff.path, `the handoff's copy differs from the signed block at ${diff.path} (signed: ${diff.expected}; handoff: ${diff.actual})`));
  const sha = splitSha256(bodyBlock);
  // the plan's body as the derivation reads it (src/tree-derive-load.js readNodePlan: the same bytes, the same hash), for the reference check of verifySplit
  const plan = { name: 'deliverable.md', text: body.body, sha256: accepted ?? report.delivered_text?.body_sha256 ?? null };
  if (upTo < 4) return { refusal: null, sha256: sha, block: bodyBlock, plan };
  // 4. the split is valid, and the frontier is approved
  const ids = Array.isArray(report.criteria_ids) ? report.criteria_ids : criterionIds(report.criteria);
  const split = checkSplit({ text: body.body, criteriaIds: ids, inheritedGlobal, ancestorQuestions });
  const repeated = split.findings.find(f => f.rule === 'repeated_question');
  if (repeated) return { refusal: refusal(4, 'repeated_question', repeated.id ?? 'open_question', repeated.message), sha256: sha, block: bodyBlock };
  if (!split.valid) { const f = split.findings[0]; return { refusal: refusal(4, 'split_invalid', f.rule, `${f.message}${split.findings.length > 1 ? ` (and ${split.findings.length - 1} more finding${split.findings.length > 2 ? 's' : ''})` : ''}`), sha256: sha, block: bodyBlock }; }
  if (frontierKey !== null) {
    if (!frontier?.revisions?.length) return { refusal: refusal(4, 'approval', 'frontier_approved', `no frontier_approved exists for frontier ${String(frontierKey).slice(0, 12)}`), sha256: sha, block: bodyBlock };
    if (!approvalValid(frontier)) return { refusal: refusal(4, 'approval', 'frontier_approved', 'the frontier\'s approval is no longer valid (what it bound has changed, or it carries no hash while the preview does)'), sha256: sha, block: bodyBlock };
    if (frontier.splitSha256 !== sha) return { refusal: refusal(4, 'approval', 'splitSha256', `the frontier was previewed for split ${String(frontier.splitSha256).slice(0, 12)}, not for the verified block ${sha.slice(0, 12)}`), sha256: sha, block: bodyBlock };
  }
  return { refusal: null, sha256: sha, block: bodyBlock, plan };
}

/**
 * Writes the refusal as a `blocked` record (reason expansion_refused, scope the node, the check named) and nothing else. Returns the event (null when `once` found the same line).
 * `transition`: 'expansion' (the default: the node's verification, which readiness counts until a split_verified exists) or 'approval' (`tree approve` met it: history, D2 F3). `once`: write one line per (scope, check, detail).
 */
export function recordExpansionRefusal(rootDir, { node, generation }, r, { facts, now, transition = 'expansion', once = false } = {}) {
  const fields = { event: 'blocked', reason: 'expansion_refused', scope: nodeKey(node, generation), transition, check: r.check, detail: refusalWords(r) };
  if (once && readTreeRecord(rootDir).events.some(e => e.event === 'blocked' && e.scope === fields.scope && e.transition === transition && e.check === fields.check && e.detail === fields.detail)) return null;
  return appendTreeEvent(rootDir, fields, { facts, now });
}

/**
 * Items 1-4 for a node whose run has ended (no frontier yet): on success a `split_verified` record names the node, its run and the verified block's sha256; on a refusal a `blocked` record names the item and the field.
 * Creates no folder and never touches report.json. Returns { refusal, sha256, event }.
 */
export function verifySplit(rootDir, { node, generation, runId, runDir, work, inheritedGlobal, ancestorQuestions, rootTaskPath }, { facts, now } = {}) {
  // No `accepted` here, while nodesToVerify's guard (src/tree-loop.js) asks the same check WITH the node's accepted body hash. The two cannot disagree: a plan is accepted only when its split is the one that was checked
  // (the table's plan_accepted row, src/tree-transitions.js), so a node with a split block is verified before any accept, and a verified node is never verified again; a leaf (no block) may be accepted unverified, but
  // nodesToVerify never lists it (holdsSplitFence reads the accepted body and finds no fence), and an accept that adds a block is refused by the same row. (CR-RC-013: traced, the route does not exist.)
  const r = expansionCheck({ runDir, work, inheritedGlobal, ancestorQuestions });
  if (r.refusal) return { refusal: r.refusal, sha256: r.sha256, event: recordExpansionRefusal(rootDir, { node, generation }, r.refusal, { facts, now, once: true }) };
  // M5f (a): the record holds ONE verified split per node@generation. The same block again is the existing record (no second event, the same return value); another block is a refusal, written as a `blocked`
  // record with check `split_changed` (the word the frontier path uses): the plan changed after it was verified, and the first verification stands.
  const had = stateOf(readTreeRecord(rootDir)).nodes.get(nodeKey(node, generation))?.verifiedSplit;
  if (had) {
    if (had.sha === r.sha256) return { refusal: null, sha256: r.sha256, event: readTreeRecord(rootDir).events.find(e => e.id === had.id) };
    const refused = refusal(4, 'split_changed', 'splitSha256', `${nodeKey(node, generation)} was verified with split ${String(had.sha).slice(0, 12)}; its plan now reads as ${String(r.sha256).slice(0, 12)}: the first verification stands`);
    return { refusal: refused, sha256: r.sha256, event: recordExpansionRefusal(rootDir, { node, generation }, refused, { facts, now }) };
  }
  // CR-2E-003 (the owner's decision, Muad 25 Okt 2026 14:45: "Yes to all" on Astra's Q1; C&C's G1 rulings): every child's context_refs are resolved NOW, by the resolver the derivation uses (src/tree-context-refs.js), against the root task
  // and this plan's body, so a split whose references cannot be read is refused HERE (check `context_refs`, a verify-time refusal of the plan's own text: the blocked stop opens on THIS node, whose new plan is the answer) and never at
  // approve. A provider's headings are not checked here: the provider has not run (the derivation at registration checks them). What each child resolved to is recorded (`resolvedRefs`: the child id and the resolver's hash), so a
  // later derivation can tell a split that resolved then and fails now (a file changed) from one that never resolved.
  const refs = contextRefsCheck({ node, block: r.block, plan: r.plan, rootDir, work, rootTaskPath });
  if (refs.refusal) return { refusal: refs.refusal, sha256: r.sha256, event: recordExpansionRefusal(rootDir, { node, generation }, refs.refusal, { facts, now, once: true }) };
  // `children` (S8 held state): the paths the verified block names, so the record alone can say whether a node is half-finished (a named child never registered); the fold cannot read the plan
  return { refusal: null, sha256: r.sha256, event: appendTreeEvent(rootDir, { event: 'split_verified', node, generation, runId, splitSha256: r.sha256, children: (r.block?.children ?? []).map(c => childNode(node, c.milestone)), resolvedRefs: refs.resolved }, { facts, now }) };
}

/** The reference check of a split before it is verified: { refusal } for the FIRST child whose context_refs do not resolve, else { resolved: [{ child, sha256 }] } in the block's order. Reads the root task file; writes nothing. */
function contextRefsCheck({ node, block, plan, rootDir, work, rootTaskPath }) {
  // the root task through the ONE pin-checked reader (C&C's Q5 ruling B): a split verified while the file differs from the pin is refused (root_task_changed, RECHECKED: putting the file back verifies it again), so no resolvedRefs are
  // recorded from bytes the tree was not started with
  const task = rootTaskOf(rootDir, { work, path: rootTaskPath });
  if (task.refusal?.code === 'root_task_changed') return { refusal: refusal(4, 'root_task_changed', 'root task', task.refusal.detail) };
  if (task.refusal) return { refusal: refusal(4, 'root_task_unreadable', 'root task', `the root task cannot be read (${task.refusal.detail}), so the children's context_refs cannot be checked`) };
  const rootTask = { name: task.name, text: task.text, sha256: task.sha256 };
  const resolved = [];
  for (const c of block.children) {
    try { resolved.push({ child: c.id, sha256: resolveContextRefs({ refs: c.context_refs, rootTask, parentPlan: plan }).sha256 }); } catch (e) {
      if (!(e instanceof DeriveRefusal)) throw e;
      return { refusal: refusal(4, 'context_refs', `${childNode(node, c.milestone)} (${c.id})`, e.detail) };       // printed: "PLAN 5.5 item 4 (context_refs): R/M1 (K1): <the resolver's sentence>"
    }
  }
  return { resolved };
}
