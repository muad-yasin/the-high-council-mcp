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
  if (upTo < 4) return { refusal: null, sha256: sha, block: bodyBlock };
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
  return { refusal: null, sha256: sha, block: bodyBlock };
}

/** Writes the refusal as a `blocked` record (reason expansion_refused, scope the node, the check named) and nothing else. Returns the event. */
export function recordExpansionRefusal(rootDir, { node, generation }, r, { facts, now } = {}) {
  return appendTreeEvent(rootDir, { event: 'blocked', reason: 'expansion_refused', scope: nodeKey(node, generation), transition: 'expansion', check: r.check, detail: refusalWords(r) }, { facts, now });
}

/**
 * Items 1-4 for a node whose run has ended (no frontier yet): on success a `split_verified` record names the node, its run and the verified block's sha256; on a refusal a `blocked` record names the item and the field.
 * Creates no folder and never touches report.json. Returns { refusal, sha256, event }.
 */
export function verifySplit(rootDir, { node, generation, runId, runDir, work, inheritedGlobal, ancestorQuestions }, { facts, now } = {}) {
  const r = expansionCheck({ runDir, work, inheritedGlobal, ancestorQuestions });
  if (r.refusal) return { refusal: r.refusal, sha256: r.sha256, event: recordExpansionRefusal(rootDir, { node, generation }, r.refusal, { facts, now }) };
  // M5f (a): the record holds ONE verified split per node@generation. The same block again is the existing record (no second event, the same return value); another block is a refusal, written as a `blocked`
  // record with check `split_changed` (the word the frontier path uses): the plan changed after it was verified, and the first verification stands.
  const had = stateOf(readTreeRecord(rootDir)).nodes.get(nodeKey(node, generation))?.verifiedSplit;
  if (had) {
    if (had.sha === r.sha256) return { refusal: null, sha256: r.sha256, event: readTreeRecord(rootDir).events.find(e => e.id === had.id) };
    const refused = refusal(4, 'split_changed', 'splitSha256', `${nodeKey(node, generation)} was verified with split ${String(had.sha).slice(0, 12)}; its plan now reads as ${String(r.sha256).slice(0, 12)}: the first verification stands`);
    return { refusal: refused, sha256: r.sha256, event: recordExpansionRefusal(rootDir, { node, generation }, refused, { facts, now }) };
  }
  // `children` (S8 held state): the paths the verified block names, so the record alone can say whether a node is half-finished (a named child never registered); the fold cannot read the plan
  return { refusal: null, sha256: r.sha256, event: appendTreeEvent(rootDir, { event: 'split_verified', node, generation, runId, splitSha256: r.sha256, children: (r.block?.children ?? []).map(c => childNode(node, c.milestone)) }, { facts, now }) };
}
