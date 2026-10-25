// The High Council as a JS library: the one public, stable surface of this package besides the
// `council` command and the MCP server. Everything else under src/ is internal and may change in
// any release; `package.json`'s `exports` map makes that the rule rather than a convention.
//
// A run goes through the CLI as a child process, exactly as the MCP server's start_run does,
// never through runChain() in this process. runChain() keeps its spend ceiling in module state
// that is null (no ceiling) until the CLI sets it, shares that state across every call in one
// process, and leaves the key check, the run folder, report.json and the run lock to the CLI.
// A library caller would have to rebuild all of that and remember to; going through the CLI means
// every guard the CLI has applies to every run started here, with nothing to remember.
//
// Keys come from the environment, as for the CLI: the caller's process.env, the `env` option, or a
// .env in `cwd`. This module never reads, logs or stores a key value.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChainSeats } from './chain.js';
import { setRounds, roundsSetting } from './overseer-rounds.js';
import { isChainName, outdatedChainHint } from './chain-name.js';
import { estimateChainRows } from './cost.js';
import { setUserPrices } from './price-table.js';
import { deriveRunStatus } from './run-status.js';
import { readStoppedMarker } from './stop-files.js';
import { harnessVersion } from './version.js';
import { nextRunId } from './run-files.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const cli = join(pkg, 'src', 'cli.js');
const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** The installed package version, e.g. "0.7.7". */
export function version() {
  return harnessVersion();
}

// Same lookup order as the CLI: the user's chains/ in `cwd` first, then the shipped ones.
function chainPath(name, cwd) {
  if (!isChainName(name)) throw new TypeError(`chain: a chain name such as "mock" or "plan-default-opro-council", got ${JSON.stringify(name)}`);
  const found = [join(cwd, 'chains', `${name}.json`), join(pkg, 'chains', `${name}.json`)].find(existsSync);
  if (!found) throw new Error(`no such chain: ${name} (looked in ${join(cwd, 'chains')} and the package's chains/).${outdatedChainHint(name)}`);
  return found;
}

/** Chains available from `cwd`: the user's own chains/ first, then the shipped ones. No network. */
export function listChains({ cwd = process.cwd() } = {}) {
  const seen = new Map();
  for (const [dir, source] of [[join(resolve(cwd), 'chains'), 'user'], [join(pkg, 'chains'), 'package']]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const name = f.slice(0, -5);
      if (seen.has(name)) continue;
      const cfg = readJson(join(dir, f));
      seen.set(name, { name, description: cfg?.description ?? null, source });
    }
  }
  return [...seen.values()];
}

/**
 * Worst-case price of one run of a chain, from its own declared token assumptions - the same
 * numbers as `council --chain <name> --dry-run`. Calls nothing, needs no key, costs nothing.
 */
export function price({ chain, cwd = process.cwd(), rounds } = {}) {
  const config = readJson(chainPath(chain, resolve(cwd)));
  if (!config) throw new Error(`chain ${chain} is not valid JSON`);
  // the project's own price rows (pricing.user.json in cwd, 0.8.3 user price row P2b): this call prices IN-PROCESS, so it reads them; a file that cannot be read in full throws a UserPriceFileError (nothing is priced with less than the file says). run()/resume() spawn the CLI, which reads the same file itself.
  setUserPrices(resolve(cwd));
  if (rounds !== undefined) {
    if (!Number.isInteger(rounds) || rounds < 1) throw new RangeError(`rounds: a whole number, 1 or more, got ${rounds}`);
    setRounds(config, rounds);
  }
  const rows = estimateChainRows(resolveChainSeats(config)).map(r => ({ ...r }));
  const totalUsd = rows.reduce((s, r) => s + r.usd, 0);
  const unpriced = [...new Set(rows.filter(r => !r.priced && !/^(mock|external)\//.test(r.seat)).map(r => r.seat))];
  return { chain: config.name ?? chain, rounds: roundsSetting(config) ?? null, rows, totalUsd, unpriced };
}

// The ceiling is never silently off. undefined: the CLI's own default (MAX_USD_PER_RUN, else $7).
// A positive number: that ceiling. 'none': no ceiling, said explicitly. 0 is refused, because a
// caller who wrote 0 almost certainly meant "spend nothing", and reading it as "spend without limit"
// is the costliest possible guess. Since 0.7.9 the CLI and the MCP tools refuse it too.
function maxUsdArgs(maxUsd) {
  if (maxUsd === undefined) return [];
  if (maxUsd === 'none') return ['--max-usd', 'none'];
  if (typeof maxUsd !== 'number' || !Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new RangeError(`maxUsd: a positive number of dollars, or the string 'none' for no ceiling, got ${JSON.stringify(maxUsd)}`);
  }
  return ['--max-usd', String(maxUsd)];
}

// 0.8.3 M1 (D13): `run` takes the run id from the caller when it is given one, so the id a tree registers is the id the run uses. The same character set the CLI's --run-id accepts. The folder may already exist
// only as a tree root's (it then holds nothing but `tree/`, which the CLI also allows); a folder that already holds a run is refused, since a new run never writes into an existing run.
function checkedRunId(runId, work) {
  if (typeof runId !== 'string' || !/^[0-9TZ-]+$/.test(runId)) throw new TypeError(`runId: digits, T, Z and "-" only, got ${JSON.stringify(runId)}`);
  const dir = join(work, 'runs', runId);
  if (existsSync(join(dir, 'run.json'))) throw new Error(`runId: ${dir} is already a run (it has a run.json); resume it instead`);
  return runId;
}

function runCli(args, { cwd, env, onOutput, signal }) {
  return new Promise((resolvePromise, reject) => {
    // `env` adds to process.env; a key set to undefined removes it for this run only.
    const childEnv = { ...process.env, ...(env || {}) };
    for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    const tail = [];
    const take = stream => chunk => {
      const s = chunk.toString('utf8');
      tail.push(s);
      if (tail.length > 200) tail.shift();
      if (onOutput) onOutput(s, stream);
    };
    child.stdout.on('data', take('stdout'));
    child.stderr.on('data', take('stderr'));
    // Bug audit 2026-09-28 (area 4 MED-1): an abort rejected on 'error', before the child had exited,
    // so a caller that resumed at once could meet a run still marked running. The abort now settles
    // only on 'close'; any other spawn error rejects at once, as before.
    let aborted = null;
    child.on('error', err => { if (err?.name === 'AbortError') aborted = err; else reject(err); });
    child.on('close', (code, sig) => aborted ? reject(aborted) : resolvePromise({ exitCode: code, signal: sig, outputTail: tail.join('').split('\n').slice(-40).join('\n') }));
  });
}

// MIGRATION GUARD (T7, 18 Okt 2026; delete in a later release): 0.8.2 and earlier let a library caller pass `allowSecretShaped` to send key-shaped text. The owner removed it ("Remove it, so nobody can send a task that contains a key"); only a person at a
// terminal can still pass --allow-secret-shaped. A caller written for 0.8.2 that still passes `true` is refused LOUDLY before anything runs, not ignored: its stated intent would otherwise be dropped silently.
function refuseRemovedSecretOverride(value) {
  if (value !== true) return;   // `false` states the default (scan on): honouring it drops no intent; only `true` (send key-shaped text) is refused (C&C ruling, 18 Okt 2026)
  throw Object.assign(new Error('allowSecretShaped was removed in 0.8.3: a library caller can no longer send key-shaped text. Remove the option and take the key out of the input; a person who really wants to send it runs the council command at a terminal with --allow-secret-shaped.'), { code: 'ERR_OPTION_REMOVED' });
}

/**
 * Start a run and wait for the CLI to stop: finished, paused at an external seat, stopped by the
 * spend ceiling, or refused by a guard. Resolves in every one of those cases (read `status` and
 * `exitCode`); rejects only when the child process could not be started or was aborted.
 */
export async function run({ chain, task, cwd = process.cwd(), maxUsd, rounds, draft, fromRun, context, criteria, runId, treeNode, piiGate, allowSecretShaped, env, onOutput, signal } = {}) {
  refuseRemovedSecretOverride(allowSecretShaped);
  const work = resolve(cwd);
  chainPath(chain, work); // a clear error here beats a CLI usage message
  if (typeof task !== 'string' || !task) throw new TypeError('task: a path to the task file');
  const id = runId === undefined ? nextRunId() : checkedRunId(runId, work);
  const args = ['--chain', chain, '--task', resolve(work, task), '--run-id', id, ...maxUsdArgs(maxUsd)];
  if (rounds !== undefined) {
    if (!Number.isInteger(rounds) || rounds < 1) throw new RangeError(`rounds: a whole number, 1 or more, got ${rounds}`);
    args.push('--rounds', String(rounds));
  }
  if (draft) args.push('--draft', resolve(work, draft));
  if (fromRun) args.push('--from-run', resolve(work, fromRun));
  if (context) args.push('--context', resolve(work, context));
  // 0.8.3 M1 (D13): `criteria` hands the run its acceptance list (a file; --criteria), `treeNode` makes it a member of a recursive-councils tree (a lineage file; --tree-node).
  if (criteria) args.push('--criteria', resolve(work, criteria));
  if (treeNode) args.push('--tree-node', resolve(work, treeNode));
  if (piiGate) {
    if (piiGate !== 'warn' && piiGate !== 'hard-stop') throw new RangeError(`piiGate: 'warn' or 'hard-stop', got ${JSON.stringify(piiGate)}`);
    args.push('--pii-gate', piiGate);
  }
  const runDir = join(work, 'runs', id);
  // Area 4 MED-1: an aborted run's stages stay on disk and can be resumed, so the rejection says
  // which run it was (`runId`, and `runDir` once the folder exists).
  const res = await runCli(args, { cwd: work, env, onOutput, signal }).catch(err => {
    if (err && typeof err === 'object') Object.assign(err, { runId: id, runDir: existsSync(runDir) ? runDir : null });
    throw err;
  });
  return named19({ runId: id, runDir: existsSync(runDir) ? runDir : null, ...res, ...(existsSync(runDir) ? statusOf(runDir) : { status: 'not_started', report: null }) });
}

/**
 * Resume a paused run (after its external stage was answered) or one the spend ceiling stopped
 * (pass a higher maxUsd). Stages already on disk replay from disk and cost nothing again.
 */
export async function resume({ runDir, cwd = process.cwd(), maxUsd, allowSecretShaped, env, onOutput, signal } = {}) {
  refuseRemovedSecretOverride(allowSecretShaped);
  const work = resolve(cwd);
  const dir = resolve(work, runDir ?? '');
  if (!runDir || !existsSync(join(dir, 'run.json'))) throw new Error(`runDir: not a run folder with a run.json: ${dir}`);
  const res = await runCli(['--resume', dir, ...maxUsdArgs(maxUsd)], { cwd: work, env, onOutput, signal });
  return named19({ runId: basename(dir), runDir: dir, ...res, ...statusOf(dir) });
}

// 0.8.3 M2 (owner decision 4): exit 19 is a recursive-councils tree refusing the start or resume of one of its runs; the library names it, since the run folder alone (derived status) cannot say why nothing ran. Exit 4 keeps its one
// meaning, the spend cap, and is never reported as this.
function named19(result) {
  return result.exitCode === 19 ? { ...result, status: 'tree_refused' } : result;
}

function statusOf(dir) {
  const meta = readJson(join(dir, 'run.json'));
  return { status: deriveRunStatus(dir, meta), report: readJson(join(dir, 'report.json')) };
}

/**
 * Read one run folder: its status, run.json, and report.json once the run has finished.
 * Read-only; never starts or resumes anything.
 */
export function readRun(runDir, { cwd = process.cwd() } = {}) {
  const dir = resolve(cwd, runDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`no such run folder: ${dir}`);
  const meta = readJson(join(dir, 'run.json'));
  const stopped = readJson(join(dir, 'STOPPED-budget.json'));
  return {
    runId: basename(dir),
    runDir: dir,
    status: deriveRunStatus(dir, meta),
    meta,
    report: readJson(join(dir, 'report.json')),
    budgetStop: stopped,
    // 0.8.1 M6 (additive): an advice call stopped by a person, its client or its wall clock: its STOPPED-<cause>.json, with the
    // cause as `stoppedBy`. null otherwise. budgetStop keeps meaning the spend cap only.
    stop: (() => { const m = readStoppedMarker(dir); return m ? { ...(m.data || {}), stoppedBy: m.stoppedBy } : null; })(), // the file name names the cause
    files: readdirSync(dir).filter(f => statSync(join(dir, f)).isFile()).sort(),
  };
}

/** Run folders under `cwd`/runs, newest first, each as readRun() returns it. */
export function listRuns({ cwd = process.cwd(), limit = 20 } = {}) {
  const runsDir = join(resolve(cwd), 'runs');
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter(d => statSync(join(runsDir, d)).isDirectory())
    .sort().reverse().slice(0, limit)
    .map(d => readRun(join(runsDir, d)));
}
