// Where the ROOT task of a tree lives: the task file the root run was started with, as its run.json records it (resolved against the run's own working folder). A leaf module (it imports only the file readers) so that
// src/tree-expansion.js (the verification of a split checks a child's context_refs against the root task) and src/tree-frontier.js (the derivation) read the root task from ONE place without an import cycle between them.
// THE READER of the root task's bytes for a derivation and for the verification of a split (C&C's Q5 ruling B, 25 Okt 2026): rootTaskOf reads the file once and compares it with the pin in tree.json, so a child is never derived from text the tree
// was not started with. Found by T's trace: after a root re-plan R@g2 runs from a COPY of the task (its bundle's task.md), so R@g2's contract check never sees an edit of the original, and before the pin a child of R@g2 was derived from
// the edited bytes with nothing stopping it; and a split verified in the same step as the edit recorded resolvedRefs from bytes the pin never saw.
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readRunJson } from './run-files.js';
import { sha256Of } from './thin-contract.js';
import { readTaskAgainstPin, rootTaskPinFrom } from './tree-task-pin.js';

/** The absolute path of the root task file of the tree whose root run folder is `rootDir`. Throws when the root run records no task. */
export function rootTaskPathOf(rootDir, work) {
  const meta = readRunJson(rootDir, 'run.json');
  if (!meta || typeof meta.task !== 'string') throw new Error('the root run has no task recorded in run.json');
  return resolve(typeof meta.cwd === 'string' ? meta.cwd : work, meta.task);
}

/**
 * The root task's TEXT, checked against the pin: { path, name, text, sha256 } | { refusal: { code, detail, error? } }. Never throws.
 *   `path` defaults to the root run's recorded task (rootTaskPathOf); a caller that already resolved it passes it. The pin (tree.json `rootTask`, written once at `tree start`): `ok` compares the hash; `unusable` refuses (fail closed, the
 *   root re-plan's own sentence); `unknown` (a tree.json written before the pin: dev fixtures only, trees first ship in 0.8.3) reads as before, with no compare.
 *   code root_task_changed: the bytes are not the pinned ones (the way out: put the file back, or a new tree for a different goal); root_task_unreadable: the file does not read (`error` = the read's own error).
 */
export function rootTaskOf(rootDir, { work, path } = {}) {
  let tree = null;
  try { tree = JSON.parse(readFileSync(join(rootDir, 'tree', 'tree.json'), 'utf8')); } catch { tree = null; }       // tree.json is written once and never edited (src/tree-record.js); one that does not read has no usable pin: 'unknown'
  const pin = rootTaskPinFrom(tree);
  if (pin.status === 'unusable') return { refusal: { code: 'root_task_changed', detail: `the root task recorded in tree.json cannot be used (${pin.reason}): the task cannot be shown to be the same, and a different goal is a new tree` } };
  let file;
  try { file = path ?? rootTaskPathOf(rootDir, work); } catch (error) { return { refusal: { code: 'root_task_unreadable', detail: error.message, error } }; }
  const r = readTaskAgainstPin(file, pin.status === 'ok' ? pin.pin : null);
  if (!r.ok) return { refusal: { code: r.code, detail: r.code === 'root_task_changed' ? `${r.reason}: put it back as the tree was started with; a different goal is a new tree, started with \`council tree start\`` : r.reason, ...(r.error ? { error: r.error } : {}) } };
  return { path: file, name: basename(file), text: r.text, sha256: sha256Of(r.text) };
}
