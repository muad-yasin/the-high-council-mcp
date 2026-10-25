// Has the root of a tree never been started? ONE test, in a leaf module (S8-6b part 2a fix-up; C&C's ruling: no pass-through wrapper, no import cycle): it imports only node:fs and node:path, so `council tree resume` (src/tree-resume.js step 0),
// the status view (src/tree-status.js) and TREE_HANDOFF.md (src/tree-handoff.js) all read it from here. It lives apart from src/tree-start.js because that file's imports already reach the handoff and the report.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * True when the record has no R generation 1, or R generation 1 is registered and its run folder has no run.json (a `tree start` interrupted, or whose root run was refused before its folder was made): the test `council tree resume`
 * applies at its step 0 before it calls `beginRoot`. `state` is `stateOf(record)`; only `state.nodes` is read. The record problems and the sticky blocks that make resume refuse first are the caller's guards, not this test's.
 */
export function rootUnstartedOf(state, runsDir) {
  const rootNode = [...state.nodes.values()].find(n => n.node === 'R' && n.generation === 1);
  return !rootNode || (rootNode.phase === 'registered' && !existsSync(join(runsDir, rootNode.runId, 'run.json')));
}
