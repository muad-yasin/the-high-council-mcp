// A member of a recursive-councils tree is resumed by its tree, never alone (0.8.3 M5f, L20; PLAN 12 row 6). `memberResumeRedirect(runMeta, runId)` answers, from a run's own run.json, whether the run is a member
// and, if so, the exact sentence and command that point at the tree: the MCP tools submit_stage and resume_run return it and spawn nothing, and the CLI's `--resume` of a member prints the same.
// The tree id comes from run.json's `tree` field (the lineage the member was started with), never from the folder name. run.json is project-writable text: the id, node and generation are shown (and put into
// a command line) only when they have the shape of a real one; a run.json whose id is not of that shape still redirects, without a command.
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NODE = /^R(\/[A-Za-z][A-Za-z0-9_-]*)*$/;

export function memberResumeRedirect(runMeta, runId, council = 'council') {
  const t = runMeta?.tree;
  if (t === undefined || t === null || typeof t !== 'object' || Array.isArray(t)) return null;           // a run that is not a member
  const treeId = typeof t.treeId === 'string' && ID.test(t.treeId) ? t.treeId : null;
  const node = typeof t.node === 'string' && NODE.test(t.node) ? t.node : null;
  const generation = Number.isInteger(t.generation) && t.generation >= 1 && t.generation < 1e6 ? t.generation : null;
  const run = typeof runId === 'string' && ID.test(runId) ? runId : null;
  const command = treeId ? `${council} tree resume ${treeId}` : null;
  const who = `${run ? `run ${run}` : 'this run'} is ${node ? `node ${node}${generation ? `@g${generation}` : ''}` : 'a node'} of ${treeId ? `tree ${treeId}` : 'a recursive-councils tree'}`;
  const text = `${who}. A tree member is resumed only by its tree, never alone: ${command ? `run \`${command}\` in a terminal` : `run \`${council} tree resume <the tree's root run id>\` in a terminal (the tree id in this run's run.json could not be read)`}. Nothing was resumed and nothing was spent.`;
  return { treeId, node, generation, runId: run, command, council, text };
}

/** The command a tree member continues with: `<council> tree resume <treeId>` (the same id the redirect reads from run.json); without a readable id, the words that say where to find it. `council` is the invocation the CLI names elsewhere. */
export const memberResumeCommand = (member, council = member.council ?? 'council') => `${council} tree resume ${member.treeId ?? '<the tree\'s root run id>'}`;

/** One line naming tree, node@generation, run and (when given) stage, for the pause notice and the resume brief of a member. Shape-checked values only (see above). */
export const memberWho = (member, stage) => `tree ${member.treeId ?? '(id unreadable)'}, node ${member.node ?? '?'}${member.generation ? `@g${member.generation}` : ''}, run ${member.runId ?? '?'}${stage ? `, stage ${stage}` : ''}`;

/** The money way for a member whose budget stop (exit 4) needs more: the tree raises the node's grant (`tree decide --top-up`), then resumes it. A member has no `--max-usd none` and no direct `--resume`. */
export const memberTopUpCommand = (member, council = member.council ?? 'council') => `${council} tree decide ${member.treeId ?? '<the tree\'s root run id>'} --top-up ${member.node ?? '<node>'} --amount <usd>`;

/** `<council> tree decide <treeId> --close <node>`: the person gives a member up (its unspent grant returns to the pool). The exit that exists for a member that cannot finish: a stop whose cause stays (a key-shaped prompt, a cut-off draft, a task the preflight objects to) would otherwise be resumed into the same stop. */
export const memberCloseCommand = (member, council = member.council ?? 'council') => `${council} tree decide ${member.treeId ?? '<the tree\'s root run id>'} --close ${member.node ?? '<node>'}`;

/** `<council> tree decide <treeId> --continue-node <node>` / `--finish-node <node>` (the member verb, C&C 16 Okt 2026): the person's choice for a member stopped at its overseer limit. Value flags with their own names; the old `--continue` / `--finish` spelling is the direct run's (a member refuses it). */
export const memberContinueCommand = (member, council = member.council ?? 'council') => `${council} tree decide ${member.treeId ?? '<the tree\'s root run id>'} --continue-node ${member.node ?? '<node>'}`;
/** `<council> tree decide <treeId> --prevail-node <node> --prevail <n>=<objection id>|neither[,...]` (the member verb for the decider's ask, exit 25): the person's pick for a member stopped at a conflict. `picks` is the value text (the stop's own ids when the caller knows them). */
export const memberPrevailCommand = (member, council = member.council ?? 'council', picks = '<n>=<objection id>|neither[,...]') => `${council} tree decide ${member.treeId ?? '<the tree\'s root run id>'} --prevail-node ${member.node ?? '<node>'} --prevail ${picks}`;
export const memberFinishCommand = (member, council = member.council ?? 'council') => `${council} tree decide ${member.treeId ?? '<the tree\'s root run id>'} --finish-node ${member.node ?? '<node>'}`;

/**
 * THE continue text of every STOPPED-*.md a tree MEMBER writes (M5g 4b; one place, so a new stop cannot ship a direct `--resume` line again: test/tree-member-stops.test.js scans src/cli.js for it). A member is resumed only by its tree; the
 * text names the tree's commands and an exit, and never says `--resume` or `--max-usd none` (not even to say "not"). `kind`: budget | secret | error | truncated | preflight.
 */
export function memberStopContinue(member, kind, council = member.council ?? 'council') {
  const who = `This run is a tree member (${memberWho(member, null)}); a member is resumed only by its tree.`;
  const resume = `    ${memberResumeCommand(member, council)}`; const close = `    ${memberCloseCommand(member, council)}`;
  const giveUp = `To give the node up instead (what it has not spent goes back to the tree's pool; everything it spent stays counted):\n\n${close}\n`;
  switch (kind) {
    case 'budget': return `${who} The tree raises its grant, then resumes it; a member never runs without a ceiling.\n\n    ${memberTopUpCommand(member, council)}\n${resume}\n\n${giveUp}`;
    case 'secret': return `${who} Fix the cause first: the key-shaped text came from an earlier stage's output or the chain, and the tree's resume has no override for this refusal, so resuming without a fix stops here again.\n\n${resume}\n\n${giveUp}`;
    case 'error': return `${who} Fix the cause, then the tree resumes it once:\n\n${resume}\n\n${giveUp}`;
    case 'truncated': return `${who} The saved stages replay for free and the reply that stopped the run stays on disk. If the cause is that reply, replace it (or move it aside), then the tree resumes it. The tree pins a node's chain file and input files, so a token limit cannot be changed for a member: resuming without a fix stops here again.\n\n${resume}\n\n${giveUp}`;
    case 'round_stop': return `${who} It stopped at its overseer-round limit, at a layer's revision limit, or because a seat of a layer stayed silent for too many passes in a row, and is NOT agreed. Your choice goes through the tree: to go on (it extends the limit that was reached, under its own grant):\n\n    ${memberContinueCommand(member, council)}\n\nTo end it here (the dispute stage and the handoff run, the result stays "not agreed"):\n\n    ${memberFinishCommand(member, council)}\n\nThen \`${memberResumeCommand(member, council).trim()}\` applies it. ${giveUp}`;
    case 'conflict': return `${who} The decider asked for YOU to choose which objection prevails, or neither. Your pick goes through the tree:\n\n    ${memberPrevailCommand(member, council, member.picksTemplate)}\n\nThen \`${memberResumeCommand(member, council).trim()}\` applies it. ${giveUp}`;
    case 'preflight': return `${who} The task description is this node's own input, written by the tree and pinned by it, so it cannot be edited for a member; a resume asks the same seats the same question again. The exit is to give the node up:\n\n${close}\n`;
    default: throw new Error(`memberStopContinue: unknown kind ${kind}`);
  }
}
