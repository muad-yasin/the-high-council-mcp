// Which of a tree MEMBER's saved roundChoices its TREE RECORD backs (bug audit 2026-10-24, D-013 / C-024, member half; the plain-run half is closed by the owner's choice A).
// run.json is project-writable text, so an entry in it alone must never make a member go past a stop or end at one: chain.js effectiveLimits adds every `continue` entry by its kind (not by its stop id) and finishes at any stop an entry names.
// A member's choice is made through the tree (`council tree decide --continue-node|--finish-node`), which writes a `node_choice` event for this node and generation; an entry counts only when the NEWEST such event for its stop holds the same choice. Older stops' backed entries stay (a replay re-derives
// the limits from all of them); an entry no event backs, or one a newer choice replaced, is dropped. A record that does not read backs nothing (fails closed). The conflict choices have the same rule in src/tree-choice.js (backedConflictChoices).
import { readTreeRecord } from './tree-record.js';

export function backedRoundChoices(rootDir, { node, generation }, entries) {
  try {
    const newest = new Map();
    for (const e of readTreeRecord(rootDir).events) {
      if (e.event === 'node_choice' && e.node === node && e.generation === generation && (e.choice === 'continue' || e.choice === 'finish') && typeof e.stop === 'string') newest.set(e.stop, e.choice);
    }
    return (Array.isArray(entries) ? entries : []).filter(c => c && typeof c === 'object' && newest.get(c.stop) === c.choice);
  } catch { return []; }
}
