// The printed ways on that more than one module prints (RULE 1c: every printed way out is one the state accepts, and each command is typed once). It imports nothing, so any module can read it without an import cycle
// (src/tree-member.js, src/tree-resume.js, src/tree-ready.js, src/tree-status.js through tree-resume's re-export).

/** The command that ends a tree: the abandon form of `council tree decide`. */
export const abandonCommand = rootId => `\`council tree decide ${rootId} --abandon\``;

/** D2 F18 S13 (A-DRAFT): the way on when a chain file is not the one the tree registered. */
export const chainWayOn = rootId => `put the chain file back as the tree registered it, or end the tree with ${abandonCommand(rootId)}`;

/** The way on for a node stopped at its budget cap: a larger grant, through the top-up form (src/tree-decide.js buildTopUp takes only a node in phase `stopped`). */
export const topUpWayOn = (rootId, node) => `Resuming it needs a larger grant: \`council tree decide ${rootId} --top-up ${node} --amount <usd>\`.`;
