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
import { estimateChainRows } from './cost.js';
import { deriveRunStatus } from './run-status.js';
import { harnessVersion } from './version.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const cli = join(pkg, 'src', 'cli.js');
const CHAIN_NAME = /^[A-Za-z0-9._-]+$/;
const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** The installed package version, e.g. "0.7.7". */
export function version() {
  return harnessVersion();
}

// Same lookup order as the CLI: the user's chains/ in `cwd` first, then the shipped ones.
function chainPath(name, cwd) {
  if (typeof name !== 'string' || !CHAIN_NAME.test(name)) throw new TypeError(`chain: a chain name such as "mock" or "plan-debate", got ${JSON.stringify(name)}`);
  const found = [join(cwd, 'chains', `${name}.json`), join(pkg, 'chains', `${name}.json`)].find(existsSync);
  if (!found) throw new Error(`no such chain: ${name} (looked in ${join(cwd, 'chains')} and the package's chains/)`);
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
  if (rounds !== undefined) {
    if (!Number.isInteger(rounds) || rounds < 1) throw new RangeError(`rounds: a whole number, 1 or more, got ${rounds}`);
    config.maxRounds = rounds;
  }
  const rows = estimateChainRows(resolveChainSeats(config)).map(r => ({ ...r }));
  const totalUsd = rows.reduce((s, r) => s + r.usd, 0);
  const unpriced = [...new Set(rows.filter(r => !r.priced && !/^(mock|external)\//.test(r.seat)).map(r => r.seat))];
  return { chain: config.name ?? chain, rounds: config.maxRounds ?? null, rows, totalUsd, unpriced };
}

// The ceiling is never silently off. undefined: the CLI's own default (MAX_USD_PER_RUN, else $7).
// A positive number: that ceiling. 'none': no ceiling, said explicitly. The CLI and the MCP tool
// read 0 as "no ceiling"; here 0 is refused, because a caller who wrote 0 almost certainly meant
// "spend nothing", and reading it as "spend without limit" is the costliest possible guess.
function maxUsdArgs(maxUsd) {
  if (maxUsd === undefined) return [];
  if (maxUsd === 'none') return ['--max-usd', 'none'];
  if (typeof maxUsd !== 'number' || !Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new RangeError(`maxUsd: a positive number of dollars, or the string 'none' for no ceiling, got ${JSON.stringify(maxUsd)}`);
  }
  return ['--max-usd', String(maxUsd)];
}

let lastRunMs = 0;
const nextRunId = () => {
  lastRunMs = Math.max(Date.now(), lastRunMs + 1);
  return new Date(lastRunMs).toISOString().replace(/[:.]/g, '-');
};

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
    child.on('error', reject);
    child.on('close', (code, sig) => resolvePromise({ exitCode: code, signal: sig, outputTail: tail.join('').split('\n').slice(-40).join('\n') }));
  });
}

/**
 * Start a run and wait for the CLI to stop: finished, paused at an external seat, stopped by the
 * spend ceiling, or refused by a guard. Resolves in every one of those cases (read `status` and
 * `exitCode`); rejects only when the child process could not be started or was aborted.
 */
export async function run({ chain, task, cwd = process.cwd(), maxUsd, rounds, draft, fromRun, context, piiGate, env, onOutput, signal } = {}) {
  const work = resolve(cwd);
  chainPath(chain, work); // a clear error here beats a CLI usage message
  if (typeof task !== 'string' || !task) throw new TypeError('task: a path to the task file');
  const id = nextRunId();
  const args = ['--chain', chain, '--task', resolve(work, task), '--run-id', id, ...maxUsdArgs(maxUsd)];
  if (rounds !== undefined) {
    if (!Number.isInteger(rounds) || rounds < 1) throw new RangeError(`rounds: a whole number, 1 or more, got ${rounds}`);
    args.push('--rounds', String(rounds));
  }
  if (draft) args.push('--draft', resolve(work, draft));
  if (fromRun) args.push('--from-run', resolve(work, fromRun));
  if (context) args.push('--context', resolve(work, context));
  if (piiGate) {
    if (piiGate !== 'warn' && piiGate !== 'hard-stop') throw new RangeError(`piiGate: 'warn' or 'hard-stop', got ${JSON.stringify(piiGate)}`);
    args.push('--pii-gate', piiGate);
  }
  const res = await runCli(args, { cwd: work, env, onOutput, signal });
  const runDir = join(work, 'runs', id);
  return { runId: id, runDir: existsSync(runDir) ? runDir : null, ...res, ...(existsSync(runDir) ? statusOf(runDir) : { status: 'not_started', report: null }) };
}

/**
 * Resume a paused run (after its external stage was answered) or one the spend ceiling stopped
 * (pass a higher maxUsd). Stages already on disk replay from disk and cost nothing again.
 */
export async function resume({ runDir, cwd = process.cwd(), maxUsd, env, onOutput, signal } = {}) {
  const work = resolve(cwd);
  const dir = resolve(work, runDir ?? '');
  if (!runDir || !existsSync(join(dir, 'run.json'))) throw new Error(`runDir: not a run folder with a run.json: ${dir}`);
  const res = await runCli(['--resume', dir, ...maxUsdArgs(maxUsd)], { cwd: work, env, onOutput, signal });
  return { runId: basename(dir), runDir: dir, ...res, ...statusOf(dir) };
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
