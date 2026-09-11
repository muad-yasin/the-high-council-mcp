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
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSections, flatten, parseLedger, words } from '../ui/parse.js';
import { spendReport } from '../spend.js';

const here = dirname(fileURLToPath(import.meta.url));
// Same split as the CLI: `pkg` ships with the package (chains/, the CLI
// itself), `work` belongs to the user. An MCP client launches this server with
// the user's project as cwd, so task files and run output land where they can
// find them rather than inside node_modules. In a clone the two are identical.
const pkg = resolve(here, '../..');
const work = process.cwd();
const runsDir = join(work, 'runs');
const cli = join(pkg, 'src', 'cli.js');

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
    const out = execFileSync('pgrep', ['-af', 'src/cli.js'], { encoding: 'utf8' });
    // The run id is not on the command line; match by the newest cli process
    // whose run.log is this run's. Cheap approximation: any cli.js alive and
    // this run has no report yet.
    return out.trim().length > 0 && !existsSync(join(runsDir, id, 'report.json'));
  } catch { return false; }
}

const server = new McpServer({ name: 'the-high-council', version: '0.1.0' });

server.tool('list_chains', 'Chains available to run, with their description and worst-case price from a dry run.', {}, async () => {
  const chains = readdirSync(join(pkg, 'chains')).filter(f => f.endsWith('.json')).map(f => {
    const c = readJson(join(pkg, 'chains', f));
    return { name: c.name, description: c.description, maxRounds: c.maxRounds, signoff: c.signoff || 'first', proposals: !!c.proposals, debate: !!c.debate, handoff: !!c.handoff };
  });
  return text(chains);
});

server.tool('dry_run', 'Price a chain without calling any model.', { chain: z.string() }, async ({ chain }) => {
  const out = execFileSync('node', [cli, '--chain', chain, '--dry-run'], { encoding: 'utf8', cwd: work });
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
  const args = [cli, '--chain', chain, '--task', resolve(work, task)];
  if (context) args.push('--context', resolve(work, context));
  if (draft) args.push('--draft', resolve(work, draft));
  if (from_run) args.push('--from-run', resolve(work, from_run));
  if (rounds) args.push('--rounds', String(rounds));
  if (max_usd !== undefined) args.push('--max-usd', max_usd === 0 ? 'none' : String(max_usd));
  mkdirSync(runsDir, { recursive: true });
  const before = new Set(readdirSync(runsDir));
  const logPath = join(work, `council-${Date.now()}.log`);
  const fd = (await import('node:fs')).openSync(logPath, 'a');
  const child = spawn('node', args.slice(0), { cwd: work, detached: true, stdio: ['ignore', fd, fd] });
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
  return text({ run, stage: label, prompt: readFileSync(join(dir, `NEEDS-${label}.md`), 'utf8'), answerWith: `submit_stage(run, "${label}", <text>)` });
});

server.tool('submit_stage', 'Write the answer for an external stage into the run folder, then resume the run in the background. The stage must be the one external_prompt reported.', { run: z.string(), stage: z.string().regex(/^[a-z0-9-]+$/), content: z.string() }, async ({ run, stage, content }) => {
  if (!safeRun(run)) return text({ error: 'no such run' });
  const dir = join(runsDir, run);
  if (waiting(dir) !== stage) return text({ error: `run is not waiting for "${stage}"`, waitingFor: waiting(dir) });
  writeFileSync(join(dir, `${stage}.md`), content);
  writeFileSync(join(dir, `${stage}.usage.json`), JSON.stringify({ provider: 'external', model: 'claude-code-session', usage: { input: 0, output: words(content) }, usd: 0, ms: 0 }));
  return text({ written: `${stage}.md`, words: words(content), ...(await resume(run)) });
});

server.tool('resume_run', 'Resume a paused run after its external stage was answered (submit_stage does this for you), or a run stopped by the spend cap (pass a higher max_usd). Completed stages replay from disk and cost nothing.', { run: z.string(), max_usd: z.number().min(0).optional().describe('raise the per-run ceiling for the rest of this run. 0 removes it.') }, async ({ run, max_usd }) => {
  if (!safeRun(run)) return text({ error: 'no such run' });
  return text(await resume(run, max_usd));
});

async function resume(run, maxUsd) {
  const logPath = join(work, `council-${Date.now()}.log`);
  const fs = await import('node:fs');
  const fd = fs.openSync(logPath, 'a');
  const resumeArgs = [cli, '--resume', join('runs', run)];
  if (maxUsd !== undefined) resumeArgs.push('--max-usd', maxUsd === 0 ? 'none' : String(maxUsd));
  const child = spawn('node', resumeArgs, { cwd: work, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  return { resumed: true, run, pid: child.pid, log: logPath, note: 'poll run_status(run); it may pause again at the next external stage' };
}

server.tool('spend_report', 'What every run has cost across a window of days, not just one run. Derived from the run folders on disk - nothing is recorded anywhere else and nothing leaves this machine. Use this to answer "what have I spent today" before starting another run.', {
  days: z.number().min(0.1).max(365).optional().describe('how far back to look, in days. Defaults to 1.'),
}, async ({ days = 1 }) => {
  const r = spendReport(runsDir, { days });
  return text({
    since: r.since.toISOString(),
    days,
    totalUsd: r.totalUsd,
    runs: r.runs.map(x => ({ id: x.id, chain: x.chain, usd: x.usd, state: x.state })),
    count: r.count,
    ...(r.unreadable ? { unreadableRunFolders: r.unreadable } : {}),
    ...(r.note ? { note: r.note } : {}),
    source: 'derived from runs/ on disk; no ledger is kept and nothing is transmitted',
  });
});

server.tool('list_runs', 'Runs on disk, newest first, with state and cost.', { limit: z.number().int().min(1).max(100).optional() }, async ({ limit = 15 }) => {
  if (!existsSync(runsDir)) return text([]);
  const ids = readdirSync(runsDir).filter(d => statSync(join(runsDir, d)).isDirectory()).sort().reverse().slice(0, limit);
  return text(ids.map(runSummary));
});

server.tool('run_status', 'State of one run: stage reached, panel verdicts, scoreboard, files produced, cost.', { run: z.string() }, async ({ run }) => {
  if (!safeRun(run)) return text({ error: 'no such run' });
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
