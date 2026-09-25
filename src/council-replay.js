// Item D of the v6 harness-feature round (relay/runs/2026-09-15T15-12-52-325Z/deliverable.md,
// "Item D — Council replay"): rerun an already-decided task's exact original input against
// today's model roster, and diff the new verdict against the one already recorded.
//
// This is a transparency/learning tool, not a correctness mechanism. Nothing this module
// produces or logs may claim the new run is "better" - only that it is different, or the same,
// from the original. See computeVerdictDiff's own header for the same rule on the diff shape.
//
// Named `council-replay.js`, not `replay.js` - src/replay.js already exists (v5 candidate 9,
// the `council replay --run <folder>` transcript command). That is an unrelated, pre-existing
// feature under a name this plan also uses in prose ("council replay"); this module is a
// different mechanism and deliberately does not reuse or touch that file, to avoid a real
// import collision.
//
// Derive-never-record (src/spend.js's own pattern, cited by the plan as precedent): this module
// writes nothing but a new sibling run folder. It keeps no ledger, no index, and no record of
// which runs have been replayed - that fact, if ever wanted, is derivable from which
// `<run-dir>.replay-*` sibling folders exist on disk.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { runChain } from './chain.js';
import { reportJsonShape, renderBoardMd } from './report-shape.js';
import { taskHashOf } from './scope-freeze.js';
import { computeVerdictDiff } from './verdict-diff.js';

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

/**
 * Load a chain config by name, exactly the way `council run` resolves `--chain <name>` (the
 * config file under `chainsDir/<name>.json`) - "today's roster" for replay purposes is simply
 * whatever that file contains right now, since chain config files are not snapshotted into the
 * run folder at run time (run.json records only the chain's *name*). If the file has been
 * edited since the original run - a model swapped, a seat added - replay picks that up, which
 * is the whole point of the mechanism; if it hasn't, replay is running the same config.
 */
function loadChainConfig(chainsDir, name) {
  const p = join(chainsDir, `${name}.json`);
  if (!existsSync(p)) throw new Error(`council-replay: no chain config "${name}" at ${p}`);
  return readJson(p);
}

/**
 * Build the date-stamped sibling folder name for a replay of `runDir`, e.g.
 * `runs/2026-09-01T00-00-00-000Z.replay-2026-09-15`. Encapsulated so the CLI and the tests
 * agree on the exact shape without duplicating the string.
 */
export function replayDirFor(runDir, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10); // YYYY-MM-DD, one replay-folder per calendar day
  return `${runDir}.replay-${stamp}`;
}

/**
 * Run item D end to end against one existing run folder. Never makes an efficacy claim in
 * anything it returns or writes - only what differed.
 *
 * @param {string} runDir - path to the original, already-completed run folder.
 * @param {object} opts
 * @param {string} opts.chainsDir - directory holding `<chainName>.json` chain configs (today's
 *   roster lives here - see loadChainConfig's own comment).
 * @param {string} [opts.workDir] - base directory the original run's recorded task path is
 *   resolved against (matches how `council run` resolves task paths against `work`, its own
 *   process.cwd()). Defaults to process.cwd().
 * @param {Date} [opts.date] - for reproducible tests; defaults to now.
 * @param {(msg: string) => void} [opts.log]
 * @param {boolean} [opts.allowTaskDrift=false] - conservative default: if the task file on disk
 *   no longer matches the hash the original run recorded, replay refuses rather than silently
 *   running a different input under the name of the original task (see the module-level note
 *   on this in council-replay.test.js and the final report's "conservative call" section - the
 *   plan requires the input be byte-identical, and there is no amendments mechanism for a
 *   read-only comparison tool the way there is for --resume). Set true only to intentionally
 *   bypass this for a fixture that doesn't care.
 * @returns {Promise<{ replayDir: string, report: object, diff: object }>}
 */
export async function runCouncilReplay(runDir, {
  chainsDir,
  workDir = process.cwd(),
  date = new Date(),
  log = () => {},
  allowTaskDrift = false,
} = {}) {
  const runMeta = readJson(join(runDir, 'run.json'));
  const originalReport = readJson(join(runDir, 'report.json'));

  const taskPath = resolve(workDir, runMeta.task);
  if (!existsSync(taskPath)) {
    throw new Error(`council-replay: recorded task file not found: ${taskPath}`);
  }
  const taskText = readFileSync(taskPath, 'utf8');
  const currentHash = taskHashOf(taskText);
  if (runMeta.taskHash && currentHash !== runMeta.taskHash && !allowTaskDrift) {
    throw new Error(
      `council-replay: task file has changed since the original run (recorded ${runMeta.taskHash}, ` +
      `now ${currentHash}) - replay tests roster drift, not task drift, so the input must be ` +
      `byte-identical. Restore ${taskPath} to what the original run started with, or pass ` +
      `allowTaskDrift if this is deliberate.`
    );
  }

  const config = loadChainConfig(chainsDir, runMeta.chain);
  log(`council-replay: replaying ${runDir} (chain "${runMeta.chain}") against today's roster`);

  const result = await runChain({ request: taskText, config, log });
  const replayRunId = basename(replayDirFor(runDir, date));
  const newReport = reportJsonShape({ runId: replayRunId, chain: config.name, task: runMeta.task, taskCwd: runMeta.cwd || workDir, taskText, result, config });

  const diff = computeVerdictDiff(originalReport, newReport);

  const replayDir = replayDirFor(runDir, date);
  mkdirSync(replayDir, { recursive: true });
  writeFileSync(join(replayDir, 'report.json'), JSON.stringify(newReport, null, 2));
  writeFileSync(join(replayDir, 'deliverable.md'), result.deliverable || '');
  const board = renderBoardMd({ runId: replayRunId, result });
  if (board) writeFileSync(join(replayDir, 'BOARD.md'), board);
  writeFileSync(join(replayDir, 'replay-diff.json'), JSON.stringify(diff, null, 2));
  writeFileSync(join(replayDir, 'replay-source.json'), JSON.stringify({
    originalRunDir: resolve(runDir),
    originalChain: runMeta.chain,
    replayedAt: date.toISOString(),
  }, null, 2));

  return { replayDir, report: newReport, diff };
}
