// Types for the public JS API (src/api.js). Hand-written; the code stays JavaScript.
// Stable within a minor version: these names, options and result fields. `report` follows the
// report.json contract (fields are added, never renamed or removed without a major version).

/** Where a run stands, derived from its run folder. */
export type RunStatus = 'done' | 'budget_stopped' | 'failed' | 'blocked' | 'paused' | 'running' | 'stopped';

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
  status: RunStatus | 'not_started';
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
  /** Aborting kills the run's process; stages already on disk stay there and can be resumed. */
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
