// The printed ways on that more than one module prints (RULE 1c: every printed way out is one the state accepts, and each command is typed once). It imports nothing, so any module can read it without an import cycle
// (src/tree-member.js, src/tree-resume.js, src/tree-ready.js, src/tree-status.js through tree-resume's re-export). Not only commands: a cause printed in two places with its way on lives here too (previewOnlyWords).

/** The command that ends a tree: the abandon form of `council tree decide`. */
export const abandonCommand = rootId => `\`council tree decide ${rootId} --abandon\``;

/** D2 F18 S13 (A-DRAFT): the way on when a chain file is not the one the tree registered. */
export const chainWayOn = rootId => `put the chain file back as the tree registered it, or end the tree with ${abandonCommand(rootId)}`;

/** CR-RC-001 (A-DRAFT) + CR-RC-016: why a derivation a provider's stop waits on was not checked, and the way on. The accept writer's refusal and the sitting's open-stop line print this one copy (src/tree-ready.js rederivationOutcome, src/tree-resume.js sittingTail). */
export const previewOnlyWords = treeId => `derived as a preview only (its frontier waits for a new approval), and a preview does not read what its providers settled: approve the frontier again with \`council tree approve ${treeId}\`, then the check runs in full`;

/** The way on for a node stopped at its budget cap: a larger grant, through the top-up form (src/tree-decide.js buildTopUp takes only a node in phase `stopped`). */
export const topUpWayOn = (rootId, node) => `Resuming it needs a larger grant: \`council tree decide ${rootId} --top-up ${node} --amount <usd>\`.`;
/**
 * A-DRAFT (WORDING U1-w18): the lines for a run of a tree (the root or a member) stopped at an approval of excerpts of the project (exit 26), in the tree's sitting text. `at` names the node and run; `approval` = { gate, status }
 * (src/run-status.js awaitingExcerptApproval). The member waits for the person's ANSWERS at the gate, then `council tree resume`; it is never offered continue, finish or --prevail-node.
 */
export function excerptApprovalLines({ at, runId, rootId, approval }) {
  return [`${at} is stopped at an approval of excerpts of your project, and waits for YOUR answers.`, approval?.status === 'invalid' ? '  Its approval record cannot be read, so it is not resumed. Nothing was run and nothing was spent.' : `  Answer at a terminal with \`council gate answer runs/${runId} ${approval?.gate}\`, then run \`council tree resume ${rootId}\`.`];
}

