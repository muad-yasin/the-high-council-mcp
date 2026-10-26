// The tree's two view files, TREE_HANDOFF.md and tree/report.json, and WHO writes them (0.8.3 M6, the stale-views follow-up of the 12 Oct must-fix that wired the sitting). The files are views of the record: the record is
// the truth, they are rewritten whole from it after every step that moves it. Two kinds of caller, ONE writer, ONE lock of its own:
//   - a SITTING (src/tree-run.js afterStep) calls `writeTreeFiles` after each step;
//   - a VERB (`council tree approve | decide | check`, via `recordReadinessAfter` in src/tree-readiness.js, and `tree start`) changes the record without being a sitting and calls the same function.
// THE VIEWS LOCK (`tree/.views.lock`, C&C's ruling on fb5a50f): view writes serialise on their OWN lock, never on the sitting lock. `.sitting.lock` keeps its ONE meaning - "a sitting of this tree is running" - because accepted code
// reads it by name as exactly that (tree-root-replan's sittingHeld, the "another sitting holds this tree" refusals of resume and start, the S8-4/S8-8 preconditions). Whoever holds the views lock reads the record AFTER taking it
// (the writers gather inside their call), so a slow writer can never put an older record over a newer file: the files never go backwards. A busy lock is WAITED for (a short bounded wait, like the record lock's); a lock still
// held after that is a NAMED problem (`the views lock is held by pid <n>`), never silence.
// IMPORT DIRECTION (named in the commit): this module is below src/tree-readiness.js and src/tree-run.js (it imports neither), so the readiness module can call it without a cycle; `writeTreeFiles` and
// `SITTING_LOCK_FILE` moved here from src/tree-run.js (which re-exports both, so no importer changes).
// A failing write is NEVER fatal and never silent: it is a `{ file, error }` problem the caller prints as one plain line (`fileProblemLine`, terminal-safe); it is not written to the record (`blocked` has a closed list of
// reasons, none is about a file, and a view that cannot be written is not an authorization).
import { basename } from 'node:path';
import { RunLockedError, acquireRunLock, lockHolder } from './run-lock.js';
import { terminalSafe } from './terminal-safe.js';
import { treeDirOf } from './tree-record.js';
import { writeTreeHandoff } from './tree-handoff.js';
import { writeTreeReport } from './tree-report.js';

/** The sitting lock (a pid lock like a run folder's, NOT the record's short lock): one sitting of a tree at a time. `runTree` holds it itself unless its caller already does and says so. */
export const SITTING_LOCK_FILE = '.sitting.lock';

export const VIEWS_LOCK_FILE = '.views.lock';
const VIEWS_TRIES = 150;      // x 20 ms = 3 s: a writer builds both files in tens of milliseconds, so a holder that long is stuck, not busy
const VIEWS_WAIT_MS = 20;
const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const oneLine = e => String(e?.message ?? e).split('\n')[0].slice(0, 300);

/**
 * THE HOOK the two writers' headers promise (src/tree-handoff.js seam 2, src/tree-report.js): after a step has been committed to the record, `TREE_HANDOFF.md` and `tree/report.json` are written from it, under the views lock
 * (see the header). -> [{ file, error }]: the files that could not be written, [] when both were; a views lock that stayed busy is ONE problem with file `tree files`. It NEVER throws: a failing writer (a symbolic link in place of
 * the file, a full disk, an unreadable record) must neither kill the caller - the record is the truth and the files are views of it - nor vanish. `council tree status` reads the record live and never depends on the files.
 * `tries`, `waitMs`, `sleep` and `beforeWrite` (called with the lock held, before the first write) are TEST seams.
 */
export function writeTreeFiles(rootDir, { work, tries = VIEWS_TRIES, waitMs = VIEWS_WAIT_MS, sleep = sleepSync, beforeWrite = null } = {}) {
  const dir = treeDirOf(rootDir);
  let release = null; let busy = null;
  for (let i = 0; i < Math.max(1, tries); i += 1) {
    try { release = acquireRunLock(dir, { file: VIEWS_LOCK_FILE }); break; } catch (e) {
      if (!(e instanceof RunLockedError)) return [{ file: 'tree files', error: oneLine(e) }];
      busy = e;
      if (i < tries - 1) sleep(waitMs);
    }
  }
  if (!release) return [{ file: 'tree files', error: `the views lock is held by pid ${lockHolder(dir, { file: VIEWS_LOCK_FILE })?.pid ?? busy?.holder?.pid ?? '?'}` }];
  try {
    if (beforeWrite) beforeWrite();
    const problems = [];
    for (const [file, write] of [['TREE_HANDOFF.md', writeTreeHandoff], ['report.json', writeTreeReport]]) {
      try { write(rootDir, { work }); } catch (e) { problems.push({ file, error: oneLine(e) }); }
    }
    return problems;
  } finally { release(); }
}

/** The one plain line for a file that could not be written by a VERB (a sitting's is src/tree-resume.js sittingTail). The error text is a filesystem string: untrusted on a terminal, so the whole line is made terminal-safe. */
export const fileProblemLine = (rootDir, p) => terminalSafe(`${p.file} could not be written (${p.error}). The command's work is recorded; \`council tree status ${basename(rootDir)}\` reads the record itself.`);
