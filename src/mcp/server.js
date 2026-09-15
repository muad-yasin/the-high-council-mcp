#!/usr/bin/env node
// The High Council as an MCP server: Claude Code (or any MCP client) as command and
// control of the harness. Stdio transport, no network. Tools mirror the CLI:
// start a run, watch it, read what it produced, grade a draft panel-only,
// price a chain. Runs are spawned detached so a long run outlives the tool
// call; the client polls with run_status.
//
//   claude mcp add high-council -- npx -y the-high-council
//   from a clone: claude mcp add high-council -- node /absolute/path/to/src/mcp/server.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync, openSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSections, flatten, parseLedger, words } from '../ui/parse.js';
import { spendReport, costToday } from '../spend.js';
import { stageKindOf, buildStageContract, renderStagePromptBundle } from '../stage-contract.js';
import { verifyIntegrityFooter } from '../integrity.js';
import { generateResumeBrief } from '../resume-brief.js';
import { verdictStats } from '../verdict-stats.js';
import { metricsReport } from '../metrics.js';
import { checkClaimStaleness } from '../peer-claim.js';
import { submitStageAnswer } from '../stage-submission.js';

const here = dirname(fileURLToPath(import.meta.url));
// Same split as the CLI: `pkg` ships with the package (chains/, the CLI
// itself), `work` belongs to the user. An MCP client launches this server with
// the user's project as cwd, so task files and run output land where they can
// find them rather than inside node_modules. In a clone the two are identical.
const pkg = resolve(here, '../..');
const work = process.cwd();
const runsDir = join(work, 'runs');
const cli = join(pkg, 'src', 'cli.js');
// How to start the CLI as a child process. From source that's `node src/cli.js`; inside a
// packaged binary (`process.pkg` is set by @yao-pkg/pkg) there is no `node` or on-disk cli.js
// to hand it, but the binary itself IS the CLI, so it is re-invoked with the same arguments.
const cliCommand = args => process.pkg ? [process.execPath, args] : ['node', [cli, ...args]];
// pkg's runtime marks a child spawned from process.execPath with PKG_EXECPATH, which makes that
// child start as plain node and read `--chain` as a script path. It skips the marker when the
// caller already set the variable, so an empty value keeps the child running as the council CLI.
const cliEnv = process.pkg ? { ...process.env, PKG_EXECPATH: '' } : process.env;

const text = s => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });
const safeRun = id => /^[0-9TZ-]+$/.test(id) && existsSync(join(runsDir, id));
const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// What a run has spent and what it has left. Source of truth is report.json
// once the run finished; while it is still running (or was stopped short)
// the per-stage <label>.usage.json files are the only record, so they are
// summed directly.
function budgetOf(dir, report) {
  const stopped = readJson(join(dir, 'STOPPED-budget.json'));
  let spent = report?.totals?.usd;
  if (spent === undefined || spent === null) {
    spent = !existsSync(dir) ? 0 : readdirSync(dir)
      .filter(f => f.endsWith('.usage.json'))
      .reduce((sum, f) => sum + (readJson(join(dir, f))?.usd ?? 0), 0);
  }
  const cap = report?.maxUsd ?? stopped?.capUsd ?? readJson(join(dir, 'run.json'))?.maxUsd ?? null;
  return {
    spentUsd: spent,
    capUsd: cap,
    remainingUsd: cap === null || cap === undefined ? null : Math.max(0, cap - spent),
    stoppedByCap: stopped ? { stage: stopped.stoppedAt, seat: stopped.seat, projectedStageUsd: stopped.projectedStageUsd } : null,
  };
}

function runSummary(id) {
  const dir = join(runsDir, id);
  const report = readJson(join(dir, 'report.json'));
  const log = existsSync(join(dir, 'run.log')) ? readFileSync(join(dir, 'run.log'), 'utf8') : '';
  const last = log.trim().split('\n').slice(-3).join(' | ');
  const alive = isAlive(id);
  const budget = budgetOf(dir, report);
  return {
    id,
    chain: report?.chain || (log.match(/^chain: (\S+)/m) || [])[1] || null,
    task: report?.task || (log.match(/^task: +(\S+)/m) || [])[1] || null,
    state: report ? (report.passed ? 'done: every lab signed off' : 'done: open objections')
      : budget.stoppedByCap ? `stopped: per-run spend cap reached before stage ${budget.stoppedByCap.stage} - resume with a higher --max-usd`
      : waiting(dir) ? `paused: waiting for external stage ${waiting(dir)}`
      : alive ? 'running'
      : 'stopped without a report (crashed, killed, or paused and answered but not resumed)',
    usd: report?.totals?.usd ?? null,
    budget,
    signoff: report?.signoff ?? null,
    scoreboard: report?.scoreboard?.labs ?? null,
    waitingFor: existsSync(dir) ? readdirSync(dir).filter(f => f.startsWith('NEEDS-')).map(f => f.slice(6, -3)).filter(l => !existsSync(join(dir, `${l}.md`))) : [],
    files: existsSync(dir) ? readdirSync(dir).filter(f => !f.endsWith('.usage.json')).sort() : [],
    lastLogLines: last,
  };
}

function waiting(dir) {
  if (!existsSync(dir)) return null;
  const w = readdirSync(dir).filter(f => f.startsWith('NEEDS-')).map(f => f.slice(6, -3)).filter(l => !existsSync(join(dir, `${l}.md`)));
  return w[0] || null;
}

function isAlive(id) {
  try {
    const out = execFileSync('pgrep', ['-af', process.pkg ? process.execPath : 'src/cli.js'], { encoding: 'utf8' });
    // The run id is not on the command line; match by the newest cli process
    // whose run.log is this run's. Cheap approximation: any cli.js alive and
    // this run has no report yet.
    return out.trim().length > 0 && !existsSync(join(runsDir, id, 'report.json'));
  } catch { return false; }
}

// Packaging note (v7, binary release): everything below that actually starts the server
// (construction, tool registration, stdio connect) lives inside this exported function rather
// than at module top level, so a static `import { runMcpServer } from './mcp/server.js'` -
// which `pkg`'s bundler needs to see in order to include this file in a packaged binary at all,
// since it can't follow a dynamic `import()` - loads this module's dependencies without also
// starting an MCP server on every CLI invocation. The self-invoking guard at the bottom keeps
// `node src/mcp/server.js` / `npm run mcp` (this file run directly, not imported) working
// exactly as before.
export async function runMcpServer() {
const server = new McpServer({ name: 'the-high-council', version: '0.3.0' });

server.tool('list_chains', 'Chains available to run, with their description and worst-case price from a dry run.', {}, async () => {
  const chains = readdirSync(join(pkg, 'chains')).filter(f => f.endsWith('.json')).map(f => {
    const c = readJson(join(pkg, 'chains', f));
    return { name: c.name, description: c.description, maxRounds: c.maxRounds, signoff: c.signoff || 'first', proposals: !!c.proposals, debate: !!c.debate, handoff: !!c.handoff };
  });
  return text(chains);
});

server.tool('dry_run', 'Price a chain without calling any model.', { chain: z.string() }, async ({ chain }) => {
  const out = execFileSync(...cliCommand(['--chain', chain, '--dry-run']), { encoding: 'utf8', cwd: work, env: cliEnv });
  return text(out);
});

server.tool('start_run', 'Start a harness run in the background. Returns the run id to poll with run_status. task is a path relative to your working directory (tasks/x.md) or absolute; context is optional (context/war-of-love). draft + from_run + rounds=1 makes a panel-only grading pass.', {
  chain: z.string(),
  task: z.string(),
  context: z.string().optional(),
  draft: z.string().optional().describe('path to a draft to review instead of building one'),
  from_run: z.string().optional().describe('reuse this earlier run\'s criteria'),
  rounds: z.number().int().min(1).max(5).optional(),
  max_usd: z.number().min(0).optional().describe('per-run spend ceiling in USD. Defaults to MAX_USD_PER_RUN or $5. Pass 0 for no ceiling. The run stops cleanly before any stage that could breach it, and resumes with a higher ceiling.'),
}, async ({ chain, task, context, draft, from_run, rounds, max_usd }) => {
  const args = ['--chain', chain, '--task', resolve(work, task)];
  if (context) args.push('--context', resolve(work, context));
  if (draft) args.push('--draft', resolve(work, draft));
  if (from_run) args.push('--from-run', resolve(work, from_run));
  if (rounds) args.push('--rounds', String(rounds));
  if (max_usd !== undefined) args.push('--max-usd', max_usd === 0 ? 'none' : String(max_usd));
  mkdirSync(runsDir, { recursive: true });
  const before = new Set(readdirSync(runsDir));
  const logPath = join(work, `council-${Date.now()}.log`);
  const fd = openSync(logPath, 'a');
  const child = spawn(...cliCommand(args), { cwd: work, env: cliEnv, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  // The run creates its folder within a second or two; find it.
  let id = null;
  for (let i = 0; i < 20 && !id; i++) {
    await new Promise(r => setTimeout(r, 250));
    id = readdirSync(runsDir).find(d => !before.has(d)) || null;
  }
  return text({ started: true, pid: child.pid, run: id, log: logPath, note: id ? 'poll run_status(run)' : 'run folder not seen yet; call list_runs shortly' });
});

server.tool('external_prompt', 'When a run is paused at an external seat: the exact system and user prompt that stage needs answered. Answer with submit_stage.', { run: z.string() }, async ({ run }) => {
  if (!safeRun(run)) return text({ error: 'no such run' });
  const dir = join(runsDir, run);
  const label = waiting(dir);
  if (!label) return text({ error: 'this run is not waiting for an external stage', state: runSummary(run).state });
  const prompt = readFileSync(join(dir, `NEEDS-${label}.md`), 'utf8');
  // v2 plan §10 Phase 2 item 4: a large prompt file silently truncated by a read is the
  // exact failure this project already suffered once - a session that could not see its
  // own prompt. Never hand that content back looking fine when it isn't.
  const check = verifyIntegrityFooter(prompt);
  // v3 plan §1: a claim's staleness/contest status alongside the prompt this tool already
  // returns - no new tool call needed to see whether this stage is stalled or contested.
  const claimWarning = checkClaimStaleness(dir, label);
  return text({ run, stage: label, prompt, answerWith: `submit_stage(run, "${label}", <text>)`, ...(check.ok ? {} : { integrity_warning: check.warning }), claim: claimWarning || { type: 'none' } });
});

// v2 plan §3 (~/Projects/relay/runs/2026-09-11T12-19-34-184Z/deliverable.md). A driving
// session with other work sharing its context can hand this one file's path to a fresh
// subagent instead of authoring the external stage inline itself - see docs/dispatch-pattern.md.
// Deliberately does NOT inline the stage's own system/user prompt (that is what NEEDS-<stage>.md
// already holds, and can be tens of thousands of tokens - the arbitrage this project protects,
// not a bug); it is referenced by path so the bundle itself stays small enough for a fresh
// subagent's own context to hold comfortably, and reads it in full only if it chooses to delegate.
server.tool('prepare_stage_prompt', 'For a run paused at an external seat: write stage_prompt.md, a self-contained bundle a fresh subagent can act on with zero prior context, so a driving session can dispatch the stage instead of authoring it inline. Fork a subagent, give it only this file\'s path; take its returned deliverable back to submit_stage.', { run: z.string() }, async ({ run }) => {
  if (!safeRun(run)) return text({ error: 'no such run' });
  const dir = join(runsDir, run);
  const label = waiting(dir);
  if (!label) return text({ error: 'this run is not waiting for an external stage', state: runSummary(run).state });
  const runMeta = readJson(join(dir, 'run.json'));
  const chainConfig = runMeta ? readJson(join(pkg, 'chains', `${runMeta.chain}.json`)) : null;
  const kind = stageKindOf(label);
  if (!chainConfig || !kind) return text({ error: 'could not resolve this stage to a known stage kind - the chain config or stage label is not one prepare_stage_prompt recognises', label });
  const contract = buildStageContract(chainConfig, kind);
  const taskText = runMeta?.task && existsSync(runMeta.task) ? readFileSync(runMeta.task, 'utf8') : '(task file not found on disk - see run.json for its original path)';
  const needsPath = join(dir, `NEEDS-${label}.md`);
  const boardPath = join(dir, 'BOARD.md');
  const references = [needsPath, ...(existsSync(boardPath) ? [boardPath] : []), ...(runMeta?.context ? [runMeta.context] : [])];
  const bundle = renderStagePromptBundle({ contract, taskText, chainName: runMeta?.chain, label, run, references });
  writeFileSync(join(dir, 'stage_prompt.md'), bundle);
  return text({ written: join(dir, 'stage_prompt.md'), stage: label, dispatch: 'Fork a subagent and give it only this file\'s path - not its contents inline.' });
});

server.tool('submit_stage', 'Write the answer for an external stage into the run folder, then resume the run in the background. The stage must be the one external_prompt reported. claimed_by is optional (v3 §1): a self-declared peer-session name, recorded as this stage\'s claim; every check here is warn-only and never blocks the write, so a caller that omits it sees exactly today\'s behavior.', { run: z.string(), stage: z.string().regex(/^[a-z0-9-]+$/), content: z.string(), claimed_by: z.string().optional().describe('self-declared peer-session name, recorded as this stage\'s claim before the answer is written') }, async ({ run, stage, content, claimed_by }) => {
  if (!safeRun(run)) return text({ error: 'no such run' });
  const dir = join(runsDir, run);
  // A stage this run never paused for is still rejected outright - that is not one of §1's
  // three warn-only checks, it is the pre-existing safety check this tool already had. What
  // changes for §1 is narrower: a stage that WAS an external pause point, and already has an
  // answer on disk (a late/duplicate submission), is no longer rejected here - it falls through
  // to the duplicate_answer warning below instead, so neither answer is silently lost.
  const wasExternalStage = existsSync(join(dir, `NEEDS-${stage}.md`));
  const alreadyAnswered = existsSync(join(dir, `${stage}.md`));
  if (!wasExternalStage || (!alreadyAnswered && waiting(dir) !== stage)) {
    return text({ error: `run is not waiting for "${stage}"`, waitingFor: waiting(dir) });
  }

  // v3 plan §1: three warn-only checks, all evaluated before the answer file is accepted as
  // final - none of them reject the write, none change submit_stage's existing required
  // arguments or return shape for a caller that omits claimed_by. Factored into
  // src/stage-submission.js so it's testable without the MCP transport (test/peer-claim.test.js).
  const runMeta = readJson(join(dir, 'run.json'));
  const chainConfig = runMeta ? readJson(join(pkg, 'chains', `${runMeta.chain}.json`)) : null;
  const { warnings, writtenFile, isDuplicate } = submitStageAnswer(dir, stage, content, { claimedBy: claimed_by, chainConfig });

  if (isDuplicate) {
    return text({ written: `${stage}.late.md`, words: words(content), warnings, note: `"${stage}.md" already existed and was left untouched; this submission was kept as "${stage}.late.md" for a human or driving session to resolve.` });
  }
  return text({ written: `${stage}.md`, words: words(content), ...(warnings.length ? { warnings } : {}), ...(await resume(run)) });
});

server.tool('resume_run', 'Resume a paused run after its external stage was answered (submit_stage does this for you), or a run stopped by the spend cap (pass a higher max_usd). Completed stages replay from disk and cost nothing.', { run: z.string(), max_usd: z.number().min(0).optional().describe('raise the per-run ceiling for the rest of this run. 0 removes it.') }, async ({ run, max_usd }) => {
  if (!safeRun(run)) return text({ error: 'no such run' });
  return text(await resume(run, max_usd));
});

async function resume(run, maxUsd) {
  const logPath = join(work, `council-${Date.now()}.log`);
  const fd = openSync(logPath, 'a');
  const resumeArgs = ['--resume', join('runs', run)];
  if (maxUsd !== undefined) resumeArgs.push('--max-usd', maxUsd === 0 ? 'none' : String(maxUsd));
  const child = spawn(...cliCommand(resumeArgs), { cwd: work, env: cliEnv, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  return { resumed: true, run, pid: child.pid, log: logPath, note: 'poll run_status(run); it may pause again at the next external stage' };
}

server.tool('spend_report', 'What every run has cost across a window of days, not just one run. Derived from the run folders on disk - nothing is recorded anywhere else and nothing leaves this machine. Use this to answer "what have I spent today" before starting another run.', {
  days: z.number().min(0.1).max(365).optional().describe('how far back to look, in days. Defaults to 1.'),
}, async ({ days = 1 }) => {
  const r = spendReport(runsDir, { days });
  // v2 plan §8, narrowed per DECISIONS.md: session_cost_today, by local calendar day with
  // a per-model breakdown, additive on this existing tool rather than a new one or a ledger.
  const today = costToday(runsDir);
  return text({
    since: r.since.toISOString(),
    days,
    totalUsd: r.totalUsd,
    runs: r.runs.map(x => ({ id: x.id, chain: x.chain, usd: x.usd, state: x.state })),
    count: r.count,
    ...(r.unreadable ? { unreadableRunFolders: r.unreadable } : {}),
    ...(r.note ? { note: r.note } : {}),
    session_cost_today: { totalUsd: today.totalUsd, count: today.count, perModel: today.perModel },
    source: 'derived from runs/ on disk; no ledger is kept and nothing is transmitted',
  });
});

server.tool('verdict_stats', 'How the debate mechanism itself is doing, per chain and per lab, across a window of days: sign-off rate, mean rounds to sign-off, objections raised, withdrawals vs accepted proposals, dropouts, unparseable replies, shape-only critique rounds (rounds spent entirely on document shape rather than substance), per-lab independence skew (novel-objection rate, solo-signoff rate, a low-independence flag), mean cost and wall time per run, and the largest prompt file per stage type. Derived from report.json and *.usage.json on disk - nothing is recorded anywhere else and nothing leaves this machine. Descriptive only: never reweights a panel or changes a verdict.', {
  days: z.number().min(0.1).max(3650).optional().describe('how far back to look, in days. Defaults to 30.'),
}, async ({ days = 30 }) => {
  const r = verdictStats(runsDir, { days });
  return text({
    since: r.since.toISOString(),
    days,
    runsSeen: r.runsSeen,
    chains: r.chains,
    labs: r.labs,
    largestPrompts: r.largestPrompts,
    ...(r.unreadable ? { unreadableRunFolders: r.unreadable } : {}),
    ...(r.note ? { note: r.note } : {}),
    source: 'derived from runs/ on disk; no ledger is kept and nothing is transmitted',
  });
});

server.tool('metrics_report', 'DESCRIPTIVE TELEMETRY ONLY, not an evaluation, benchmark or baseline: amendment rate, withdrawal rate, objection-follow-through rate, and tool-call usage, derived from existing run logs (report.json and HANDOFF.md) on disk across a window of days. This is the zero-cost substitute for a cut evaluation-first direction - it never compares the council against any other tool or person, and no number it returns should be read as a claim that the council\'s output is better than anything else. Nothing is recorded anywhere else and nothing leaves this machine.', {
  days: z.number().min(0.1).max(3650).optional().describe('how far back to look, in days. Defaults to 30.'),
}, async ({ days = 30 }) => {
  const r = metricsReport(runsDir, { days });
  return text({
    label: 'descriptive telemetry',
    since: r.since.toISOString(),
    days,
    runsSeen: r.runsSeen,
    amendmentRate: r.amendmentRate,
    withdrawalRate: r.withdrawalRate,
    objectionFollowThroughRate: r.objectionFollowThroughRate,
    toolCallUsageRate: r.toolCallUsageRate,
    counts: r.counts,
    ...(r.unreadable ? { unreadableRunFolders: r.unreadable } : {}),
    note: r.note,
    source: 'derived from runs/ on disk; no ledger is kept and nothing is transmitted. Descriptive telemetry only - not an evaluation, benchmark or baseline.',
  });
});

server.tool('list_runs', 'Runs on disk, newest first, with state and cost.', { limit: z.number().int().min(1).max(100).optional() }, async ({ limit = 15 }) => {
  if (!existsSync(runsDir)) return text([]);
  const ids = readdirSync(runsDir).filter(d => statSync(join(runsDir, d)).isDirectory()).sort().reverse().slice(0, limit);
  return text(ids.map(runSummary));
});

server.tool('run_status', 'State of one run: stage reached, panel verdicts, scoreboard, files produced, cost. Pass brief=true for a short, regenerated-on-demand resume brief instead - what a returning session with fresh context needs to re-enter the run.', { run: z.string(), brief: z.boolean().optional() }, async ({ run, brief }) => {
  if (!safeRun(run)) return text({ error: 'no such run' });
  if (brief) {
    // v2 plan §5: always regenerated from run.json + files on disk, never itself
    // authoritative, so RESUME.md can never become a stale source of truth.
    const dir = join(runsDir, run);
    const runMeta = readJson(join(dir, 'run.json'));
    const chainConfig = runMeta ? readJson(join(pkg, 'chains', `${runMeta.chain}.json`)) : null;
    const rb = generateResumeBrief({ runId: run, dir, runMeta, chainConfig });
    writeFileSync(join(dir, 'RESUME.md'), rb);
    return text(rb);
  }
  const s = runSummary(run);
  const log = readFileSync(join(runsDir, run, 'run.log'), 'utf8');
  s.keyLines = log.split('\n').filter(l => /^(Stage:|Round|  [a-z0-9-]+\/.*: (SIGNED OFF|\d+ failure)|    FAILED:|  board:|  .*post\(s\)|panel:|verdict:|labs:|cost:|Error)/.test(l)).slice(-40);
  return text(s);
});

server.tool('read_run_file', 'Read a file from a run folder (deliverable.md, BOARD.md, HANDOFF.md, proposals.md, build.md, revise-1.md, panel-1-<lab>.md, run.log, report.json).', { run: z.string(), file: z.string() }, async ({ run, file }) => {
  if (!safeRun(run) || !/^[A-Za-z0-9._-]+$/.test(file)) return text({ error: 'no such run or bad file name' });
  const p = join(runsDir, run, file);
  if (!existsSync(p)) return text({ error: 'no such file', files: readdirSync(join(runsDir, run)) });
  return text(readFileSync(p, 'utf8'));
});

server.tool('plan_outline', 'Section tree of a run\'s deliverable (or any markdown file) with word counts and the build-volume heuristic, plus the scope ledger if present.', { run: z.string().optional(), file: z.string().optional().describe('absolute path to a markdown file, instead of a run') }, async ({ run, file }) => {
  let md;
  if (file) md = readFileSync(resolve(file), 'utf8');
  else if (run && safeRun(run)) md = readFileSync(join(runsDir, run, 'deliverable.md'), 'utf8');
  else return text({ error: 'give run or file' });
  const tree = parseSections(md);
  const rows = flatten(tree).map(s => ({ path: s.path, words: s.words, volume: s.volume.score, files: s.volume.files.length, scripts: s.volume.scripts.length }));
  return text({ words: words(md), sections: rows, ledger: parseLedger(md) });
});

server.tool('write_task', 'Write or overwrite a task file under tasks/ (the request the harness plans against).', { name: z.string().regex(/^[a-z0-9-]+$/), content: z.string() }, async ({ name, content }) => {
  const p = join(work, 'tasks', `${name}.md`);
  writeFileSync(p, content);
  return text({ written: p, words: words(content) });
});

const transport = new StdioServerTransport();
await server.connect(transport);
}

// Run directly (`node src/mcp/server.js`, `npm run mcp`, or the packaged CLI's own `--mcp`
// path via a static import) starts the server; imported without being the entry point, it
// does not - see the comment on runMcpServer above. No top-level `await` here on purpose: a
// module with both top-level await and an `export` cannot be safely bytecode-compiled by
// pkg's CJS transform (it falls back to shipping the file as plain source, which is fine, but
// still triggers a subpath-exports resolution bug in the packaged binary - see the packaging
// plan). An IIFE avoids it without changing observable behavior in the direct/non-packaged case.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  (async () => { await runMcpServer(); })();
}
