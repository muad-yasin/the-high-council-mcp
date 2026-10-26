// The STOP marker of a tree (`tree/STOP`, written by `council tree stop`; not an event: the record is for authorizations). A LEAF module (0.8.3 M6 S8-6a): it imports nothing of the tree's view or run modules, so the view
// files (src/tree-handoff.js, src/tree-report.js) and the MCP blocks can say "a stop was requested" without the import cycle tree-handoff -> tree-run -> tree-files -> tree-handoff. src/tree-run.js re-exports all three names
// (the SITTING_LOCK_FILE pattern), so no importer changes.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { TREE_DIR } from './tree-record.js';

export const STOP_MARKER = 'STOP';
export const stopMarkerPath = rootDir => join(rootDir, TREE_DIR, STOP_MARKER);
export const stopRequested = rootDir => existsSync(stopMarkerPath(rootDir));
