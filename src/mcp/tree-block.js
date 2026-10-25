// The additive `tree` block of the MCP tool `run_status` for a tree member (0.8.3 M6 slice S7, commit c; PLAN 10.2): the tree id, the logical node, its generation and the tree's ACTIVE node.
// READ-ONLY: it opens the tree record and nothing else, takes no lock, writes no file.
//
// THE CONTRACT
//   treeBlock(runsDir, runId, marker) -> { treeId, node, generation, activeNode, verdict, stopMarker, abandoned, note? }
//     abandoned   true when a person abandoned the tree (ROADMAP 57): activeNode and verdict are then null; false otherwise, and in every `note` path (where nothing can be said).
//     stopMarker  true when the tree's `council tree stop` marker stands (S8-6a) AND the record lists this run (the same trust rule as the active node and the verdict); false otherwise, and in every `note` path.
//     marker      the shape-checked { treeId, node, generation } that runSummary already read from the run's own run.json (src/tree-redirect.js memberResumeRedirect); any of the three may be null.
//     activeNode  `node@gN` of the one node the record says is active (PLAN 8.1), or null when none is; null is a real answer ("nothing is running"), not an error. A key the record cannot name is never guessed.
//     note        present when activeNode could not be established, or rests on a damaged record, and says why in a plain sentence (no tree id in run.json, the root folder is not readable here, the root has no record,
//                 the record does not list this run, the record could not be read, a line of it is unreadable). run_status is the polling tool: a record that is missing or corrupt gives a note, never an exception.
//   verdict     the tree's RECORDED verdict (PLAN 10.2): 'ready', 'incomplete' or 'blocked' as the newest `readiness` event of the record says, read through lastReadinessOf (src/tree-readiness.js, the one reader of it); null when
//               none was recorded yet, or when the record cannot name the tree's state for this run (the same cases as activeNode). NEVER computed here: a verdict computed on the spot would be a second source and could disagree with
//               `council tree status`, the handoff and the report; a recorded one is what those show. A readiness line whose verdict is not one of the three words is not accepted by the record reader (it is a damaged line, named in `note`).
// WHY THE RECORD IS TRUSTED ONLY SO FAR: run.json is project-writable text, so the tree id in it can name any folder. The root folder goes through trustedRunDir (a real folder with no symbolic link) first, and the
// active node is shown only if the record itself lists THIS run (a node_registered event for it); otherwise a forged run.json could display another tree's state.
import { trustedRunDir } from '../run-files.js';
import { readTreeRecord, stateOf } from '../tree-record.js';
import { planAuthorityOf } from '../tree-transitions.js';
import { lastReadinessOf } from '../tree-readiness.js';
import { stopRequested } from '../tree-stop-marker.js';

const NODE = /^R(\/[A-Za-z][A-Za-z0-9_-]*)*$/;

export function treeBlock(runsDir, runId, marker) {
  const base = { treeId: marker.treeId, node: marker.node, generation: marker.generation, activeNode: null, verdict: null, stopMarker: false, abandoned: false };
  const note = text => ({ ...base, note: text });
  if (marker.treeId === null) return note('the tree id in this run\'s run.json could not be read');
  const root = trustedRunDir(runsDir, marker.treeId);
  if (root.refusal) return note(`the tree's root run is not readable here (${root.refusal})`);
  let record;
  try { record = readTreeRecord(root.dir); } catch { return note('the tree\'s record could not be read'); }
  if (!record.exists) return note('the root run has no tree record');
  if (!record.events.some(e => e.event === 'node_registered' && e.runId === runId)) return note('the tree\'s record does not list this run');
  let state;
  try { state = stateOf(record); } catch { return note('the tree\'s record could not be read'); }
  // a damaged line does not hide what the readable lines say, but it is said (`council tree status` names the line)
  const damaged = record.corrupt.length ? { note: 'the tree\'s record has a line that cannot be read, so the active node is what the readable lines show' } : {};
  // ROADMAP 57 (c3): a tree a person abandoned is FINAL: no active node (a stranded root must not look active) and no verdict (a recorded `ready` from before is stale, and the retired stops no longer hold one back)
  if (state.abandoned) return { ...base, abandoned: true, stopMarker: stopRequested(root.dir), ...damaged };
  // the tree's recorded verdict and the stop marker, shown (like the active node) only because the record itself lists this run: the same trust rule, so a forged tree id in run.json cannot show another tree's marker
  const verdict = lastReadinessOf(record)?.verdict ?? null;
  // 2b (gate page 12.11 condition 2): a bare `ready` is never shown beside a plan no panel signed: the keys of the nodes whose plan the record accepted travel with it (node keys only: harness words, no run text)
  const acceptedPlans = [...state.nodes.values()].filter(x => planAuthorityOf(x)).map(x => `${x.node}@g${x.generation}`).sort();
  const accepted = acceptedPlans.length ? { acceptedPlans } : {};
  const stopMarker = stopRequested(root.dir);       // a `council tree stop` marker stands (a file, not a record event): an agent driving this run should know the tree will not start anything further
  const key = state.active;
  if (key === null) return { ...base, verdict, ...accepted, stopMarker, ...damaged };
  const n = state.nodes.get(key);
  if (!n || typeof n.node !== 'string' || !NODE.test(n.node) || !Number.isInteger(n.generation) || n.generation < 1) return note('the tree\'s record names an active node that cannot be read');
  return { ...base, activeNode: `${n.node}@g${n.generation}`, verdict, ...accepted, stopMarker, ...damaged };
}
