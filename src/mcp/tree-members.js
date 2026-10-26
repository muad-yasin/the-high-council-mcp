// The containment check of the tree tools (0.8.2 item 2: every run folder a tool touches is a real folder with no symbolic link in it). A tree tool reads MEMBER run folders whose names the tree's record registers, and the record
// lives in the project folder (a cloned project can ship one); so before any step, EVERY run folder the record registers is checked, and one that refuses ends the call and is named. A missing folder (a registered node that has not
// started) is fine. ONE function for `tree_status` and `tree_decide` (CR-3B-001: tree_decide checked only the root folder, and read a member's plan through a link that tree_status refused).
import { RUN_FOLDER } from '../run-status.js';
import { trustedRunDir } from '../run-files.js';

/** The registered member run ids of a tree record, sorted. */
export const memberRunIds = record => [...new Set(record.events.filter(e => e.event === 'node_registered' && typeof e.runId === 'string').map(e => e.runId))].sort();

/** -> null when every registered member folder may be read, else the sentence that ends the call. */
export function memberFolderRefusal(runsDir, record) {
  for (const id of memberRunIds(record)) {
    const m = RUN_FOLDER.test(id) ? trustedRunDir(runsDir, id) : { refusal: 'not a run folder name' };
    if (m.refusal && m.refusal !== 'no such run') return `the tree's member run ${id} is not a folder this tool may read: ${m.refusal}`;
  }
  return null;
}
