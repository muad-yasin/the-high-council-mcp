// Types for the public JS API (src/api.js). Hand-written; the code stays JavaScript.
// Stable within a minor version: these names, options and result fields. `report` follows the
// report.json contract (fields are added, never renamed or removed without a major version).

/**
 * Where a run stands, derived from its run folder: every value src/run-status.js deriveRunStatus can return (test/run-status-type.test.js derives the list from the code).
 * 'awaiting_user_cap': a paid run waits for the spending limit a person types. 'awaiting_choice': the run stopped and waits for a person's choice (an overseer limit, a conflict, a refused price).
 * 'user_stopped', 'client_cancel_stopped' and 'wall_clock_stopped': the run was stopped on purpose or by its clock. The five approval values are an advice call's folder before its run has started.
 */
export type RunStatus =
  | 'done' | 'budget_stopped' | 'failed' | 'blocked' | 'paused' | 'running' | 'stopped'
  | 'awaiting_user_cap' | 'awaiting_choice' | 'user_stopped' | 'client_cancel_stopped' | 'wall_clock_stopped'
  | 'awaiting_approval' | 'approved' | 'declined' | 'approval_expired' | 'approval_invalid';

/**
 * Per-run spend ceiling. Omitted: the CLI default (MAX_USD_PER_RUN, else $7).
 * A positive number of US dollars, or 'none' to run without one. 0 is refused.
 */
export type MaxUsd = number | 'none';

export interface ChainInfo {
  name: string;
  description: string | null;
  /** 'user' for a chain in <cwd>/chains, which wins over a shipped one of the same name. */
  source: 'user' | 'package';
}

export interface PriceRow {
  label: string;
  /** provider/model */
  seat: string;
  input: number;
  output: number;
  usd: number;
  priced: boolean;
}

export interface Price {
  chain: string;
  rounds: number | null;
  rows: PriceRow[];
  /** Worst case for one run at the full round cap. */
  totalUsd: number;
  /** Real seats with no price on record (mock and external seats are never listed). */
  unpriced: string[];
}

/** report.json. The named fields are the public contract; more fields may appear. */
export interface Report {
  runId?: string;
  chain?: string;
  passed?: boolean;
  proposals: unknown[];
  debate?: { posts: unknown[]; replies: unknown[]; [k: string]: unknown };
  signoff: unknown[];
  scoreboard?: unknown;
  totals: { usd?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export interface BudgetStop {
  stoppedAt: string;
  seat: string;
  spentUsd: number;
  capUsd: number;
  projectedStageUsd: number;
}

export interface RunFolder {
  runId: string;
  runDir: string;
  status: RunStatus;
  /** run.json, or null if unreadable. */
  meta: Record<string, unknown> | null;
  /** report.json once the run has finished, else null. */
  report: Report | null;
  /** STOPPED-budget.json when the spend ceiling stopped the run, else null. */
  budgetStop: BudgetStop | null;
  files: string[];
}

export interface RunResult {
  runId: string;
  /** null only when the CLI refused before creating the folder. */
  runDir: string | null;
  /** The CLI's exit code; the README's exit-code table says what each means. */
  exitCode: number | null;
  signal: string | null;
  /** 'tree_refused' (since 0.8.3) when exitCode is 19: a recursive-councils tree refused to start or resume the run (nothing was run, nothing was spent). Exit 4 stays the spend cap. */
  status: RunStatus | 'not_started' | 'tree_refused';
  report: Report | null;
  /** The last lines the CLI printed. Never contains a key value. */
  outputTail: string;
}

export interface CommonRunOptions {
  /** The working directory: tasks, chains/, .env and runs/ are resolved here. Default process.cwd(). */
  cwd?: string;
  maxUsd?: MaxUsd;
  /** Added to process.env for this run only; a key set to undefined is removed. Use it for API keys. */
  env?: Record<string, string | undefined>;
  onOutput?: (text: string, stream: 'stdout' | 'stderr') => void;
  /** Aborting kills the run's process; stages already on disk stay there and can be resumed. `run()` then rejects, once the process has exited, with an AbortError carrying `runId` and `runDir` (null if the folder was never made). */
  signal?: AbortSignal;
}

export interface RunOptions extends CommonRunOptions {
  chain: string;
  /** Path to the task file, relative to cwd or absolute. */
  task: string;
  rounds?: number;
  /** Review this draft instead of building one. */
  draft?: string;
  /** Reuse an earlier run's criteria. */
  fromRun?: string;
  context?: string;
  /** The acceptance list, as a file (--criteria): one criterion per line, or a JSON array. The run uses it instead of asking a criteria seat. */
  criteria?: string;
  /** The run's folder name (digits, T, Z and "-", the form of the default). The folder must not already hold a run. Default: the start time. */
  runId?: string;
  /** Makes the run a member of a recursive-councils tree: a JSON file naming its tree, node and generation (--tree-node). The tree record must have registered the node; otherwise the run is refused (exit 19). */
  treeNode?: string;
  /** The personal-data gate. Default 'hard-stop': a finding stops the run (exit 11). 'warn' (print and go on) is the developer's own typed choice, the same act as `--pii-gate warn`. */
  piiGate?: 'warn' | 'hard-stop';
}

export interface ResumeOptions extends CommonRunOptions {
  runDir: string;
}

export declare function version(): string;
export declare function listChains(options?: { cwd?: string }): ChainInfo[];
export declare function price(options: { chain: string; cwd?: string; rounds?: number }): Price;
export declare function run(options: RunOptions): Promise<RunResult>;
export declare function resume(options: ResumeOptions): Promise<RunResult>;
export declare function readRun(runDir: string, options?: { cwd?: string }): RunFolder;
export declare function listRuns(options?: { cwd?: string; limit?: number }): RunFolder[];
