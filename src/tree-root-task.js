// Where the ROOT task of a tree lives: the task file the root run was started with, as its run.json records it (resolved against the run's own working folder). A leaf module (it imports only the file readers) so that
// src/tree-expansion.js (the verification of a split checks a child's context_refs against the root task) and src/tree-frontier.js (the derivation) read the root task from ONE place without an import cycle between them.
import { resolve } from 'node:path';
import { readRunJson } from './run-files.js';

/** The absolute path of the root task file of the tree whose root run folder is `rootDir`. Throws when the root run records no task. */
export function rootTaskPathOf(rootDir, work) {
  const meta = readRunJson(rootDir, 'run.json');
  if (!meta || typeof meta.task !== 'string') throw new Error('the root run has no task recorded in run.json');
  return resolve(typeof meta.cwd === 'string' ? meta.cwd : work, meta.task);
}
