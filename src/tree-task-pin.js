// The root task pin of a recursive-councils tree (0.8.3 M6 S5 commit 3; C&C ruling 12 Oct): which task the tree's root answers, recorded in tree.json by `council tree start` as
//   rootTask: { task, cwd, taskHash }
// the same three values run.json carries for a run - the task file's path as the run recorded it (absolute when `start` writes it), the folder the run was started from (a relative path resolves against it,
// as rootTaskPathOf does for run.json), and the hash src/scope-freeze.js taskHashOf makes of the file's text (the one hash function: run.json's `taskHash` is made by it). With it a root that never ran
// (no run.json) still has its task on record; the sitting that starts such a root and S8's re-plan of a root both read it from here.
// Persistence (backend-developer checklist): tree.json stays schema `tree/1` - the field is additive and optional; a tree.json written before it (frozen at 35a9b38: test/fixtures/tree-json/) has no `rootTask` and
// reads as "unknown", never a throw; a damaged field reads as "unusable" with a reason. Extra keys inside the field are not damage (the record is additive). A task outside the working folder is accepted: a normal
// run accepts one, and the pin must not refuse what the run accepts. This file reads no environment variable; it reads the task file only in makeRootTaskPin and readTaskAgainstPin.
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { taskHashOf } from './scope-freeze.js';
import { isDeniedPath } from './tools.js';

/** The words for a task file the secret denylist names (R16's list, src/tools.js isDeniedPath): `tree start` refuses one, and the root task reader never opens one (CR-RC-006). One copy. */
export const DENIED_TASK_WORDS = 'a file of that name is never read (it looks like a secrets file)';

// src/integrity.js fingerprint(): the first 12 hex characters of the text's sha256 - the one `taskHash` run.json carries (a change detector for the frozen-scope check, not a tamper seal)
const HEX12 = /^[0-9a-f]{12}$/;

/** The reason a value is not a usable pin, or null. Pure. */
export function rootTaskProblem(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return 'rootTask is not an object';
  if (typeof x.task !== 'string' || !x.task) return 'rootTask.task is not a non-empty string';
  if (typeof x.cwd !== 'string' || !x.cwd) return 'rootTask.cwd is not a non-empty string';
  if (typeof x.taskHash !== 'string' || !HEX12.test(x.taskHash)) return 'rootTask.taskHash is not 12 lower-case hex characters (the hash run.json carries)';
  return null;
}

/** What tree.json says about the root task: { status: 'unknown' } (no field: a tree written before the pin), { status: 'ok', pin }, or { status: 'unusable', reason }. Never throws. */
export function rootTaskPinFrom(tree) {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree) || !Object.hasOwn(tree, 'rootTask')) return { status: 'unknown' };
  const reason = rootTaskProblem(tree.rootTask);
  if (reason) return { status: 'unusable', reason };
  const { task, cwd, taskHash } = tree.rootTask;
  return { status: 'ok', pin: { task, cwd, taskHash } };
}

/** The pin for a task file about to be run from `cwd`: the path as given (absolute for `start`), the folder, the hash of the file's text. Throws like readFileSync when the file cannot be read. */
export function makeRootTaskPin(taskFile, cwd) {
  return { task: taskFile, cwd, taskHash: taskHashOf(readFileSync(taskFile, 'utf8')) };
}

/**
 * THE read of a root task file against its pin (C&C's Q5 ruling B, 25 Okt 2026): the file is read ONCE, its hash compared with the pin's, and the TEXT returned, so nothing that reads the root task has a gap between the check and the read.
 * `pin` null = no pin to compare (a tree.json written before the pin: dev fixtures only, trees first ship in 0.8.3). -> { ok: true, path, text } | { ok: false, code: 'root_task_unreadable' | 'root_task_changed', reason, error? }. Never throws.
 */
export function readTaskAgainstPin(path, pin) {
  // CR-RC-006: a recorded task path the denylist names is refused BEFORE anything is opened, on every route: `tree start` refuses it (src/tree-start.js, the same test: the path relative to the folder the tree was started
  // from, which is the pin's cwd), so one here can only be an edit after the start. The answer is the same whether such a file exists or not (no existence oracle). The basename is checked too, for a pin with no folder.
  if ((typeof pin?.cwd === 'string' && isDeniedPath(relative(pin.cwd, path))) || isDeniedPath(basename(path))) return { ok: false, code: 'root_task_unreadable', reason: `the task file ${basename(path)}: ${DENIED_TASK_WORDS}` };
  let text;
  try { if (!statSync(path).isFile()) throw new Error('not a file'); text = readFileSync(path, 'utf8'); } catch (error) { return { ok: false, code: 'root_task_unreadable', reason: `the task file ${basename(path)} cannot be read`, error }; }
  if (pin && taskHashOf(text) !== pin.taskHash) return { ok: false, code: 'root_task_changed', reason: `the task file ${basename(path)} has changed since the tree was started (its hash differs from the pinned one)` };     // the file's NAME, never its absolute path: the sentence reaches readiness, which the tree handoff prints (fix-up ON TOP of a943f492)
  return { ok: true, path, text };
}

/** Does the file the pin names still hold the text it was pinned with? -> { ok: true, path, text } | { ok: false, reason }. Never throws. The read is readTaskAgainstPin's (one read: the text it returns is the text it checked). */
export function checkRootTaskPin(pin) {
  if (rootTaskProblem(pin)) return { ok: false, reason: `the pin is damaged (${rootTaskProblem(pin)})` };
  return readTaskAgainstPin(isAbsolute(pin.task) ? pin.task : resolve(pin.cwd, pin.task), pin);
}
