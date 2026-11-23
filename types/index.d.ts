// Types for the public JS API (src/api.js). Hand-written; the code stays JavaScript.
// Stable within a minor version: these names, options and result fields. `report` follows the
// report.json contract (fields are added, never renamed or removed without a major version).

/**
 * Where a run stands, derived from its run folder: every value src/run-status.js deriveRunStatus can return (test/run-status-type.test.js derives the list from the code).
 * 'awaiting_user_cap': a paid run waits for the spending limit a person types. 'awaiting_excerpt_approval': a run is stopped at an approval of excerpts of the project; a resume of it is refused (exit 26) while the approval waits for the person or cannot be read, and with the privacy switch on, once the person's answers are in (reason `excerpt_answers_to_apply`) or the approval has expired unanswered (reason `excerpt_gate_expired`), the run is resumable (needs `resume`): the next resume applies the answers or asks again. 'awaiting_choice': the run stopped and waits for a person's choice (an overseer limit, a conflict, a refused price).
 * 'user_stopped', 'client_cancel_stopped' and 'wall_clock_stopped': the run was stopped on purpose or by its clock. The five approval values are an advice call's folder before its run has started. Legacy since 0.8.4: the advice add-on is removed, so only an old folder or record can show these eight words; they stay in the union so code that switches on them still compiles.
 * 'owner_paused' (0.8.4): the person or the handler session asked the running run to pause between two passes (`council pause`) and it stopped there (exit 23); a plain `council --resume` continues it, and when is the person's call.
 */
export type RunStatus =
  | 'done' | 'budget_stopped' | 'failed' | 'blocked' | 'paused' | 'running' | 'stopped'
  | 'awaiting_user_cap' | 'awaiting_excerpt_approval' | 'awaiting_choice' | 'owner_paused' | 'user_stopped' | 'client_cancel_stopped' | 'wall_clock_stopped'
  | 'awaiting_approval' | 'approved' | 'declined' | 'approval_expired' | 'approval_invalid';

/**
 * Per-run spend ceiling. Omitted: the CLI default (MAX_USD_PER_RUN, else $12).
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
  /** Present when the chain's Claude seats go through OpenRouter, and when the chain was priced straight to Anthropic only because a key is unusable (`why` is 'key_state'; the price needs no key). */
  claudeRoute?: { route: 'anthropic' | 'openrouter' | 'session'; why: string; seats: number };
  /** Present only when zero retention is on: how many seats it reaches (`covered`) and how many it does not (`notCovered`), the seats it cannot serve (`stops`, each with the model, a `why` and the number of seats), the sentence a start would be refused with (`refusal`, null when none) and the lines a dry run prints. */
  zeroRetention?: { on: true; covered: number; notCovered: number; stops: { model: string; why: string; count: number }[]; refusal: string | null; lines: string[] };
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
  /** The stopped call's worst case (what is reserved and charged). */
  projectedStageUsd: number;
  /** The figure the next resume must clear at this stage: the call's expected cost, or the whole worst case when the stage re-runs both attempts. Absent in a record written before 28 Oct 2026 (read it as projectedStageUsd). */
  gateStageUsd?: number;
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
  /** Where the chain's Claude seats are called: 'auto' (default: straight to Anthropic, or through OpenRouter when only an OpenRouter key is set), 'anthropic', 'openrouter' or 'session' (every Claude seat answered by the person's own Claude Code session). The same as `--claude-route`. */
  claudeRoute?: 'auto' | 'anthropic' | 'openrouter' | 'session';
  /** 'on' makes every call through OpenRouter name only the hosts that OpenRouter's list gives for its model as zero-retention hosts, and refuses the start, before anything is sent, for a seat that no such host serves; seats called straight to their lab are not covered. 'off' switches it off. Leave it out to keep what the run began with (a new run: off). The same as `--zero-retention`. */
  zeroRetention?: 'on' | 'off';
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
export declare function price(options: { chain: string; cwd?: string; rounds?: number; claudeRoute?: 'auto' | 'anthropic' | 'openrouter' | 'session'; zeroRetention?: 'on' | 'off'; env?: Record<string, string | undefined> }): Price;
export declare function run(options: RunOptions): Promise<RunResult>;
export declare function resume(options: ResumeOptions): Promise<RunResult>;
export declare function readRun(runDir: string, options?: { cwd?: string }): RunFolder;
export declare function listRuns(options?: { cwd?: string; limit?: number }): RunFolder[];
