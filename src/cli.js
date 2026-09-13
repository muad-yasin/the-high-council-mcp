#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, checkSeats, setCache, setBudget, budgetState, ExternalPause, BudgetExceeded } from './chain.js';
import { summarise, formatUsd, priceOf, estimateChainRows } from './cost.js';
import { providerNames, envKeyName } from './providers.js';
import { spendReport, costToday } from './spend.js';
import { verdictStats } from './verdict-stats.js';
import { withIntegrityFooter } from './integrity.js';
import { generateResumeBrief } from './resume-brief.js';
import { preflightCheck } from './preflight.js';
import { stageKindOf } from './stage-contract.js';
import { validateDeliverable } from './partial-deliverable.js';
import { fingerprintInputs, withStalenessCheck } from './cache-integrity.js';

const here = dirname(fileURLToPath(import.meta.url));

// Two roots, and the distinction matters once this is installed from npm
// rather than cloned. `pkg` is where the shipped assets live (chains/,
// pricing.json) - inside node_modules for an npx user. `work` is the user's
// own directory, where their .env, their task files and their run output
// belong. Resolving a task path against pkg sends an npx user looking for
// their own file inside node_modules, which is exactly what it did.
// In a cloned checkout the two are the same directory, so nothing changes.
const pkg = resolve(here, '..');
const work = process.cwd();

// Minimal .env loader. No dependency for four lines of parsing. The user's
// own directory wins; the package copy is the fallback that makes a cloned
// checkout behave as before.
const envPath = [join(work, '.env'), join(pkg, '.env')].find(existsSync) || join(work, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// `npx <local-tarball-or-package-spec> council demo` is a real invocation, not
// a hypothetical one: once npx has resolved a package spec to this package's
// one bin, it does not also strip a literal repeat of the bin's own name from
// the arguments that follow, so that repeat lands as argv[0] here. The
// `doctor`/`demo` checks below key off argv[0], so a redundant leading
// `council` (or its `relay` alias) silently fell through to the usage banner
// instead of running - caught by the 2026-09-13 tarball verification pass.
// Drop one such leading token before anything else looks at argv[0].
const rawArgv = process.argv.slice(2);
const argv = (rawArgv[0] === 'council' || rawArgv[0] === 'relay') ? rawArgv.slice(1) : rawArgv;
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return (next && !next.startsWith('--')) ? next : true;
}

// `council doctor` answers "can this actually run, right now, on this
// machine" for a stranger who just installed it - which keys are present (by
// name only, never the value), which shipped chains are runnable with those
// keys (or need nothing at all: mock and external seats never need a key),
// and the worst-case price of each. Zero network calls: this only reads env
// var names and chains/*.json and does the same static pricing math as
// --dry-run (estimateChainRows, shared from cost.js, not re-derived here).
if (argv[0] === 'doctor') {
  console.log(`\nAPI keys (name only - the value is never read here beyond presence/absence):`);
  const names = providerNames();
  const nw = Math.max(...names.map(n => n.length));
  const present = new Set();
  for (const name of names) {
    const envName = envKeyName(name);
    const has = !!process.env[envName];
    if (has) present.add(name);
    console.log(`  ${name.padEnd(nw)}  ${envName.padEnd(20)}  ${has ? 'set' : 'not set'}`);
  }

  console.log(`\nChains (runnable = every seat's provider has its key set, or is mock/external):`);
  const chainsDir = join(pkg, 'chains');
  const files = readdirSync(chainsDir).filter(f => f.endsWith('.json')).sort();
  const cw = Math.max(...files.map(f => f.length - 5));
  for (const f of files) {
    const cfg = JSON.parse(readFileSync(join(chainsDir, f), 'utf8'));
    const seats = [
      cfg.seats.criteria, cfg.seats.builder, cfg.seats.reviser, cfg.seats.finalist,
      cfg.seats.skeleton, cfg.seats.handoff, cfg.seats.questions, cfg.seats.judge,
      ...(cfg.seats.proposers || []), ...(cfg.seats.critics || []),
    ].filter(Boolean);
    const missing = checkSeats(seats);
    const runnable = missing.length === 0;
    const worst = estimateChainRows(cfg).reduce((sum, r) => sum + r.usd, 0);
    const label = f.replace(/\.json$/, '');
    console.log(`  ${label.padEnd(cw)}  ${(runnable ? 'runnable' : 'blocked ').padEnd(8)}  worst-case ${formatUsd(worst).padStart(9)}/run${runnable ? '' : `  (missing: ${missing.join(', ')})`}`);
  }
  console.log(`\nNo network calls were made - this only reads environment variable names and chains/*.json.`);
  process.exit(0);
}

// `council demo` runs a $0, offline, no-keys-needed chain end to end with the
// mock provider (calls nothing real) and prints the resulting deliverable and
// debate board to stdout, so a stranger who just installed this can see the
// whole mechanism - proposals, anonymised debate, panel sign-off - work
// before ever touching a real key.
if (argv[0] === 'demo') {
  const demoChainName = 'mock-debate';
  const demoConfig = JSON.parse(readFileSync(join(pkg, 'chains', `${demoChainName}.json`), 'utf8'));
  console.log(`\nThe High Council - offline demo (chain: ${demoChainName}, provider: mock)`);
  console.log(`No API key, no network call, $0. This is what the mechanism looks like end to end.\n`);
  const demoResult = await runChain({
    request: 'Demo request. The mock provider ignores this text - see chains/mock-debate.json for what it always returns.',
    config: demoConfig,
    log: line => console.log(line),
  });
  console.log(`\n${'='.repeat(72)}\nDELIVERABLE\n${'='.repeat(72)}\n`);
  console.log(demoResult.deliverable);
  if (demoResult.board) {
    console.log(`\n${'='.repeat(72)}\nDEBATE BOARD\n${'='.repeat(72)}\n`);
    console.log(demoResult.board);
  }
  if (demoResult.handoff) {
    console.log(`\n${'='.repeat(72)}\nHANDOFF\n${'='.repeat(72)}\n`);
    console.log(demoResult.handoff);
  }
  console.log(`\nThat was $0 and touched no network - the mock provider calls nothing real.`);
  console.log(`Next: "council doctor" to see which real chains you can run with your own keys,`);
  console.log(`or "council --chain verify --dry-run" to price a real run before spending anything.`);
  process.exit(0);
}

// `council --spend [--days N]` answers "what have I spent across every run",
// which neither run_status (one run) nor the per-run cap (one run) can.
if (argv.includes('--spend')) {
  const days = Number(flag('days', 1));
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days: expected a positive number of days');
    process.exit(2);
  }
  const r = spendReport(join(work, 'runs'), { days });
  console.log(`\nSpend across ${r.count} run(s) since ${r.since.toISOString().slice(0, 16).replace('T', ' ')}  (${join(work, 'runs')})`);
  if (!r.count) {
    console.log(`  no runs in this window.${r.note ? `  ${r.note}` : ''}`);
  } else {
    const w = Math.max(...r.runs.map(x => (x.chain || '?').length));
    for (const x of r.runs) {
      console.log(`  ${x.id}  ${(x.chain || '?').padEnd(w)}  ${formatUsd(x.usd).padStart(9)}  ${x.state}`);
    }
    console.log(`  ${''.padEnd(24)}  ${''.padEnd(w)}  ${formatUsd(r.totalUsd).padStart(9)}  total`);
    if (r.runs.some(x => !x.complete)) console.log(`\n  Runs still going or stopped short are counted from the stages they already paid for.`);
  }
  if (r.unreadable) console.log(`  ${r.unreadable} run folder(s) could not be read and are not counted.`);
  console.log(`\n  Derived from the run folders on disk. Nothing is recorded anywhere else, and nothing leaves this machine.`);
  process.exit(0);
}

// `council --cost-today [--date YYYY-MM-DD]` answers "what have I spent today", by the
// local calendar day rather than --spend's rolling 24h window, with a per-model breakdown
// across every run counted - the granularity v2 plan §8 wanted a ledger file for, derived
// instead from the same run-folder files --spend already reads (see DECISIONS.md).
if (argv.includes('--cost-today')) {
  const dateArg = flag('date', null);
  const date = dateArg && dateArg !== true ? new Date(`${dateArg}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) {
    console.error('--date: expected YYYY-MM-DD');
    process.exit(2);
  }
  const r = costToday(join(work, 'runs'), { date });
  // r.date is local midnight; toISOString() converts to UTC and can print the wrong
  // calendar day in any non-UTC timezone, so format from local parts instead.
  const dayLabel = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}-${String(r.date.getDate()).padStart(2, '0')}`;
  console.log(`\nSpend on ${dayLabel} across ${r.count} run(s)  (${join(work, 'runs')})`);
  if (!r.count) {
    console.log(`  no runs on this day.${r.note ? `  ${r.note}` : ''}`);
  } else {
    const w = Math.max(...r.runs.map(x => (x.chain || '?').length));
    for (const x of r.runs) {
      console.log(`  ${x.id}  ${(x.chain || '?').padEnd(w)}  ${formatUsd(x.usd).padStart(9)}  ${x.state}`);
    }
    console.log(`  ${''.padEnd(24)}  ${''.padEnd(w)}  ${formatUsd(r.totalUsd).padStart(9)}  total`);
    if (r.perModel.length) {
      console.log(`\n  By model:`);
      for (const m of r.perModel) console.log(`    ${m.model.padEnd(40)}  ${formatUsd(m.usd).padStart(9)}`);
    }
  }
  if (r.unreadable) console.log(`  ${r.unreadable} run folder(s) could not be read and are not counted.`);
  console.log(`\n  Derived from the run folders on disk. Nothing is recorded anywhere else, and nothing leaves this machine.`);
  process.exit(0);
}

// `council --stats [--days N]` answers "how is the debate mechanism itself
// doing" - sign-off rate, rounds, objections, cost and the biggest prompt
// files - per chain and per lab, across every run on disk.
if (argv.includes('--stats')) {
  const days = Number(flag('days', 30));
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days: expected a positive number of days');
    process.exit(2);
  }
  const r = verdictStats(join(work, 'runs'), { days });
  console.log(`\nVerdict stats across ${r.runsSeen} run(s) since ${r.since.toISOString().slice(0, 16).replace('T', ' ')}  (${join(work, 'runs')})`);
  if (!r.chains.length) {
    console.log(`  no completed runs in this window.${r.note ? `  ${r.note}` : ''}`);
  } else {
    console.log(`\nBy chain:`);
    const w = Math.max(...r.chains.map(c => c.chain.length));
    for (const c of r.chains) {
      console.log(`  ${c.chain.padEnd(w)}  runs=${c.runs}  signoff=${c.signoffRate === null ? '-' : `${Math.round(c.signoffRate * 100)}%`}` +
        `  rounds=${c.meanRoundsToSignoff === null ? '-' : c.meanRoundsToSignoff.toFixed(1)}` +
        `  objections=${c.objections}  withdrawn=${c.withdrawals}  accepted=${c.accepted}` +
        `  dropouts=${c.dropouts}  unparseable=${c.unparseable}` +
        `  cost=${c.meanCostUsd === null ? '-' : formatUsd(c.meanCostUsd)}` +
        `  wall=${c.meanWallMs === null ? '-' : `${Math.round(c.meanWallMs / 1000)}s`}`);
    }
    console.log(`\nBy lab:`);
    for (const l of r.labs) {
      console.log(`  ${l.lab}: proposed=${l.proposed} accepted=${l.accepted} withdrawn=${l.withdrawn} cut=${l.cut} dropouts=${l.dropouts} unparseable=${l.unparseable}`);
    }
    if (r.largestPrompts.length) {
      console.log(`\nLargest prompt file per stage type:`);
      for (const p of r.largestPrompts.slice(0, 10)) {
        console.log(`  ${p.stageType}: ${p.file} (${p.run}) - ${(p.bytes / 1024).toFixed(1)}KB, ~${p.tokensApprox} tokens`);
      }
    }
  }
  if (r.unreadable) console.log(`\n  ${r.unreadable} run folder(s) could not be read and are not counted.`);
  console.log(`\n  Derived from the run folders on disk. Nothing is recorded anywhere else, and nothing leaves this machine.`);
  process.exit(0);
}

// `council --mcp` starts the MCP server instead of running a chain. The
// package ships one bin, so this is what makes a single npx invocation work
// as an MCP command: `npx -y the-high-council --mcp`. Checked before any
// other argument handling, since the server takes none of them.
if (argv.includes('--mcp')) {
  await import('./mcp/server.js');
} else {

const chainName = flag('chain', 'verify');
const taskPath = flag('task', null);
const fromRun = flag('from-run', null);
const resumeRun = flag('resume', null);
const dryRun = argv.includes('--dry-run');

// Per-run spend ceiling. A BYOK tool that a stranger points their own API
// keys at ships with a ceiling ON by default; --max-usd none is the explicit
// way to run without one, and says so in the log.
const DEFAULT_MAX_USD = 5;
const maxUsdArg = flag('max-usd', process.env.MAX_USD_PER_RUN ?? String(DEFAULT_MAX_USD));
let maxUsd;
if (maxUsdArg === true) { console.error('--max-usd: needs a value, e.g. --max-usd 2 or --max-usd none'); process.exit(2); }
else if (maxUsdArg === 'none' || maxUsdArg === 'off' || maxUsdArg === '0') maxUsd = null;
else {
  maxUsd = Number(maxUsdArg);
  if (!Number.isFinite(maxUsd) || maxUsd < 0) {
    console.error(`--max-usd: expected a number of dollars or "none", got "${maxUsdArg}"`);
    process.exit(2);
  }
}

if (argv.includes('--help') || (!taskPath && !dryRun && !resumeRun)) {
  console.log(`The High Council - a chained multi-model harness

  council demo                         $0, offline, no keys needed: run a full
                                       mock chain (proposals, debate, sign-off)
                                       and print the deliverable and board
  council doctor                       which API keys you have (names only),
                                       which chains you can run with them, and
                                       each one's worst-case price. No network call.
  council --task tasks/example.md [--chain verify|seven] [--rounds N]
  council --task tasks/x.md --chain plan-relay --from-run runs/<earlier run>
                                       reuse that run's criteria and first draft,
                                       so two panels can be compared on one draft
  council --task tasks/x.md --chain plan-unanimous --from-run runs/<r> --draft file.md --rounds 1
                                       panel-only: grade this draft against that run's criteria
  council --task tasks/x.md --chain plan-debate --context context/war-of-love
                                       append standing direction docs to the request
  council --resume runs/<r>            continue a run that paused at an external seat
                                       (after writing runs/<r>/<label>.md); completed
                                       stages replay from disk and cost nothing
  council --chain seven --dry-run      estimate tokens and cost, call nothing
  council --spend [--days 7]           what every run has cost, across runs,
                                       read back off disk. Nothing is recorded
                                       and nothing leaves this machine.
  council --cost-today [--date Y-M-D]  what has been spent today, by calendar day,
                                       with a per-model breakdown. Same disk-only source.
  council --stats [--days 30]          how the debate mechanism itself is doing:
                                       sign-off rate, rounds, objections, dropouts,
                                       cost/wall time and the biggest prompt files,
                                       per chain and per lab. Same disk-only source.
  council --task tasks/x.md --max-usd 2 stop the run before any stage that could
                                       take it past $2. Default $5, or
                                       MAX_USD_PER_RUN. --max-usd none disables
                                       the ceiling. A stopped run resumes with
                                       --resume and a higher ceiling; stages
                                       already on disk replay for free.

Chains live in chains/*.json. Runs are written to runs/<timestamp>/.
The 'relay' command is kept as an alias for 'council'; both run this file.`);
  // Asking for --help is success (exit 0) even with no task given; landing
  // here with neither --help nor a task/dry-run/resume is the error case
  // (exit 1) - these used to be conflated into one `taskPath ? 0 : 1`, which
  // made a bare `--help` exit 1.
  process.exit(argv.includes('--help') ? 0 : 1);
}

// --resume: everything about the run comes from its own run.json.
let resumeMeta = null;
if (resumeRun) {
  resumeMeta = JSON.parse(readFileSync(join(resolve(resumeRun), 'run.json'), 'utf8'));
}
const chainNameEff = resumeMeta?.chain || chainName;
// A user's own chains/ takes precedence, so a custom chain works from an
// npm install without editing anything inside node_modules.
const configPath = [join(work, 'chains', `${chainNameEff}.json`), join(pkg, 'chains', `${chainNameEff}.json`)]
  .find(existsSync) || join(pkg, 'chains', `${chainNameEff}.json`);
if (!existsSync(configPath)) {
  console.error(`No such chain: ${configPath}`);
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (flag('rounds', null)) config.maxRounds = Number(flag('rounds'));

// --from-run: the earlier run's criteria and first draft are reused verbatim,
// so whatever differs in the outcome is the panel, not a fresh coin toss.
let handedDraft = null;
if (fromRun) {
  // A run that crashed has no report.json but does have criteria.md - the
  // criteria stage's raw reply - so the criteria can still be reused.
  const reportPath = join(resolve(fromRun), 'report.json');
  if (existsSync(reportPath)) {
    config.criteria = JSON.parse(readFileSync(reportPath, 'utf8')).criteria;
  } else {
    const raw = readFileSync(join(resolve(fromRun), 'criteria.md'), 'utf8');
    config.criteria = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).criteria;
  }
  handedDraft = readFileSync(join(resolve(fromRun), 'build.md'), 'utf8');
}
// --draft <file>: review this exact text instead of building one. With
// --from-run it replaces that run's build.md; the criteria still come from
// the run. With --rounds 1 this is a panel-only pass: no builder, no reviser.
const draftPath = resumeMeta ? resumeMeta.draft : flag('draft', null);
if (draftPath) handedDraft = readFileSync(resolve(work, draftPath), 'utf8');
if (resumeMeta?.fromRun && !fromRun) {
  const rp = join(resolve(work, resumeMeta.fromRun), 'report.json');
  if (existsSync(rp)) config.criteria = JSON.parse(readFileSync(rp, 'utf8')).criteria;
}

const allSeats = [
  config.seats.criteria,
  config.seats.builder,
  config.seats.reviser,
  config.seats.finalist,
  config.seats.skeleton,
  config.seats.handoff,
  config.seats.questions,
  ...(config.seats.proposers || []),
  ...(config.seats.critics || []),
].filter(Boolean);

if (dryRun) {
  // A dry run prices the chain from the config's own declared token
  // assumptions. It calls nothing, so it costs nothing.
  console.log(`\nChain: ${config.name} - ${config.description}`);
  console.log(`Rounds: ${config.maxRounds}\n`);
  const rows = estimateChainRows(config, { fromRun });
  const w = Math.max(...rows.map(r => r.seat.length));
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(12)} ${r.seat.padEnd(w)}  ${String(r.input).padStart(7)} in  ${String(r.output).padStart(6)} out  ${r.priced ? formatUsd(r.usd) : 'unpriced'}`);
  }
  const t = rows.reduce((s, r) => ({ i: s.i + r.input, o: s.o + r.output, u: s.u + r.usd }), { i: 0, o: 0, u: 0 });
  console.log(`\n  TOTAL        ${''.padEnd(w)}  ${String(t.i).padStart(7)} in  ${String(t.o).padStart(6)} out  ${formatUsd(t.u)}  per run`);
  console.log(`\n  Worst case is the full round cap. A clean first critique stops early and costs less.`);
  const unpriced = rows.filter(r => !r.priced).map(r => r.seat);
  if (unpriced.length) console.log(`  No price on file for: ${[...new Set(unpriced)].join(', ')}`);
  process.exit(0);
}

const missing = checkSeats(allSeats);
if (missing.length) {
  console.error(`\nMissing API keys for: ${missing.join(', ')}`);
  console.error(`Set them as environment variables, or put them in ${envPath} (see README's "Setup" section), or pick a chain that uses fewer labs.`);
  console.error(`Run "council doctor" to see exactly which keys each shipped chain needs.`);
  process.exit(1);
}

const taskPathEff = resumeMeta?.task || taskPath;
const taskFile = resolve(work, taskPathEff);
if (!existsSync(taskFile)) {
  console.error(`\nNo task file at ${taskFile}`);
  console.error(`The task file is the request the council plans against - plain prose, written by you.`);
  console.error(`Create one and run again, e.g.:\n`);
  console.error(`    mkdir -p tasks`);
  console.error(`    echo "What I want planned, in plain words." > ${taskPathEff}`);
  process.exit(1);
}
let request = readFileSync(taskFile, 'utf8');
// v2 plan §7.2: fingerprint scope is the task's own text and the chain config, not the
// --context document bundle appended below - captured before that append happens.
const rawTaskTextForCacheFingerprint = request;
// --context: standing direction documents, appended to every request so the
// harness plans within the same direction the humans discuss (context/README.md).
const contextArg = resumeMeta ? resumeMeta.context : flag('context', null);
if (contextArg) {
  const { readdirSync, statSync } = await import('node:fs');
  const files = [];
  for (const entry of String(contextArg).split(',').map(x => x.trim()).filter(Boolean)) {
    const p = resolve(entry);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (f.endsWith('.md') && f !== 'README.md') files.push(join(p, f));
    } else files.push(p);
  }
  const docs = files.map(f => `## ${f.split('/').pop()}\n\n${readFileSync(f, 'utf8')}`).join('\n\n---\n\n');
  request += `\n\n---\n\n# Standing context - direction documents\n\nThese are the mission, the decisions already taken and the ideas parked for later, as the people running this project keep them. Plan within them. Do not restate them, do not re-decide anything they settle, and do not pull a parked idea into scope unless the request above asks for it. Where the request and a document conflict, the request wins and you say so under "Assumptions".\n\n${docs}`;
  console.log(`context: ${files.length} document(s) appended (${files.map(f => f.split('/').pop()).join(', ')})`);
}
const runId = resumeMeta ? basename(resolve(resumeRun)) : new Date().toISOString().replace(/[:.]/g, '-');
const runDir = join(work, 'runs', runId);
mkdirSync(runDir, { recursive: true });
if (!resumeMeta) {
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ chain: chainNameEff, task: taskPathEff, context: contextArg || null, fromRun: fromRun || null, draft: draftPath || null, rounds: config.maxRounds, maxUsd }, null, 2));
} else if (resumeMeta.rounds) config.maxRounds = resumeMeta.rounds;
// Stage cache: <label>.md holds the text, <label>.usage.json what it cost.
// Both are written as each stage completes, so a resume replays them.
const cacheFingerprint = fingerprintInputs(rawTaskTextForCacheFingerprint, config);
setCache({
  get: withStalenessCheck(
    label => {
      const t = join(runDir, `${label}.md`);
      if (!existsSync(t)) return null;
      const u = existsSync(join(runDir, `${label}.usage.json`)) ? JSON.parse(readFileSync(join(runDir, `${label}.usage.json`), 'utf8')) : {};
      return { text: readFileSync(t, 'utf8'), ...u };
    },
    cacheFingerprint,
    label => {
      console.log(`  CACHE STALENESS WARNING: stage "${label}" was cached against different task/chain-config inputs than are now in force; re-running it.`);
      appendFileSync(join(runDir, 'WARNINGS.md'), `- cache_stale: stage "${label}" invalidated - task text or chain config changed since it was cached\n`);
    },
  ),
});
// A resumed run inherits the ceiling it was started under unless this
// invocation names a different one - otherwise resuming would silently drop
// the cap the run was created with.
const maxUsdEff = argv.includes('--max-usd') ? maxUsd
  : (resumeMeta && 'maxUsd' in resumeMeta) ? resumeMeta.maxUsd
  : maxUsd;
setBudget(maxUsdEff);

// A previous sitting may have stopped this run at the ceiling. Clear that
// marker now that we are past it, so a run that goes on to finish is not
// still advertising itself as capped.
for (const f of ['STOPPED-budget.json', 'STOPPED-budget.md']) {
  if (existsSync(join(runDir, f))) rmSync(join(runDir, f));
}

const logPath = join(runDir, 'run.log');
const log = (...parts) => {
  const line = parts.join(' ');
  console.log(line);
  appendFileSync(logPath, line + '\n');
};

log(`council run ${runId}${resumeMeta ? ' (resumed)' : ''}`);
log(`chain: ${config.name} (${config.maxRounds} round cap)`);
log(`cap:   ${maxUsdEff === null ? 'none - this run has no spend ceiling' : `${formatUsd(maxUsdEff)} per run (--max-usd)`}`);
log(`task:  ${taskPathEff}`);

// v2 plan §6: before any stage runs, before a single metered API call, a static keyword
// check for the specific class of conflict this project already hit once (a chain requiring
// an appended section against text demanding a standalone document). Warns, never blocks.
if (!resumeMeta) {
  const preflightWarnings = preflightCheck(config, request);
  if (preflightWarnings.length) {
    for (const w of preflightWarnings) log(`  PRE-FLIGHT WARNING: ${w.message}`);
    if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
    appendFileSync(join(runDir, 'WARNINGS.md'), preflightWarnings.map(w => `- pre_flight: ${w.message}\n`).join(''));
  }
}

log(resumeMeta ? `resume: stages already on disk replay for free` : '');
let result;
try {
  result = await runChain({
    request,
    config,
    draft: handedDraft,
    log,
    onStage: s => {
      if (s.cached) return;
      // v2 plan §7.1: validate against the stage contract's required_sections before
      // trusting this deliverable - same class of bug as the lab-dropout fix, just one
      // stage later in the pipeline. Warns loudly and records it; does not, and cannot
      // from here, change chain.js's own in-run control flow (§11: mechanism untouched).
      const kind = stageKindOf(s.label);
      if (kind) {
        const check = validateDeliverable(kind, s.text);
        if (!check.ok) {
          log(`  PARTIAL OUTPUT WARNING: stage "${s.label}" (${kind}) - ${check.reason}`);
          appendFileSync(join(runDir, 'WARNINGS.md'), `- partial_output: stage "${s.label}" (${kind}) - ${check.reason}\n`);
        }
      }
      writeFileSync(join(runDir, `${s.label}.md`), s.text);
      writeFileSync(join(runDir, `${s.label}.usage.json`), JSON.stringify({ provider: s.provider, model: s.model, usage: s.usage, usd: s.usd, ms: s.ms, inputsFingerprint: cacheFingerprint }));
      // v2 plan §5: regenerate at every stage-completion boundary, always from
      // disk state, never itself trusted as the source of truth.
      writeFileSync(join(runDir, 'RESUME.md'), generateResumeBrief({ runId, dir: runDir, runMeta: { chain: chainNameEff, task: taskPathEff }, chainConfig: config }));
    },
  });
} catch (err) {
  if (err instanceof ExternalPause) {
    const need = join(runDir, `NEEDS-${err.label}.md`);
    writeFileSync(need, withIntegrityFooter(`# External stage: ${err.label}\n\nWrite the reply to \`${join(runDir, `${err.label}.md`)}\` and run:\n\n    node src/cli.js --resume runs/${runId}\n\n## System prompt\n\n${err.system}\n\n## User prompt\n\n${err.user}`));
    log(`\nPAUSED: stage "${err.label}" is an external seat.`);
    log(`  prompt:  ${need}`);
    log(`  answer:  write ${join(runDir, `${err.label}.md`)}`);
    log(`  resume:  node src/cli.js --resume runs/${runId}`);
    process.exit(3);
  }
  if (err instanceof BudgetExceeded) {
    // Deliberately NO report.json and NO deliverable.md: a run folder that
    // carries those reads as a finished run everywhere else in this codebase.
    // What lands instead says plainly that the run stopped short.
    const state = budgetState();
    writeFileSync(join(runDir, 'STOPPED-budget.json'), JSON.stringify({
      stoppedAt: err.label,
      seat: err.seat,
      spentUsd: err.spent,
      capUsd: err.cap,
      projectedStageUsd: err.projected,
      note: 'Stopped before the stage above was paid for. Completed stages are on disk and replay for free on resume.',
    }, null, 2));
    writeFileSync(join(runDir, 'STOPPED-budget.md'), `# Run stopped: per-run spend cap reached

This run stopped **before** stage \`${err.label}\` (${err.seat}) was called, so that stage was
never paid for.

- spent so far: **${formatUsd(err.spent)}**
- ceiling: **${formatUsd(err.cap)}**
- that stage could have cost up to: **${formatUsd(err.projected)}**

Stage cost is projected as the whole prompt billed as input plus the seat's entire \`maxTokens\`
budget billed as output, so the real cost would very likely have been lower. The ceiling is
enforced against the worst case on purpose.

## Continue it

Every completed stage is on disk and replays for free, so resuming only pays for what is left:

    node src/cli.js --resume runs/${runId} --max-usd ${(Math.ceil((err.cap + err.projected) * 100) / 100).toFixed(2)}

Or \`--max-usd none\` to continue with no ceiling.
`);
    log(`\nSTOPPED: per-run spend cap reached before stage "${err.label}".`);
    log(`  spent:   ${formatUsd(err.spent)} of ${formatUsd(err.cap)} ceiling`);
    log(`  stage:   ${err.seat} could cost up to ${formatUsd(err.projected)}`);
    log(`  detail:  ${join(runDir, 'STOPPED-budget.md')}`);
    log(`  resume:  node src/cli.js --resume runs/${runId} --max-usd <higher>`);
    process.exit(4);
  }
  throw err;
}

writeFileSync(join(runDir, 'deliverable.md'), result.deliverable);
// Final regeneration: the last onStage-triggered RESUME.md is written before
// deliverable.md exists, so without this it would keep reporting "in progress"
// forever on an already-finished run.
writeFileSync(join(runDir, 'RESUME.md'), generateResumeBrief({ runId, dir: runDir, runMeta: { chain: chainNameEff, task: taskPathEff }, chainConfig: config }));
if (result.proposalPool?.length && result.proposalPool.length > result.proposals.length) {
  writeFileSync(join(runDir, 'proposals-pool.md'), `# Every proposal every lab wrote (${result.proposalPool.length}); "kept" ones went to the builder\n\n` + result.proposalPool.map(p =>
    `## ${p.kept ? 'KEPT' : 'dropped'} - ${p.lab}/${p.model}, attempt ${p.attempt}\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`).join('\n\n'));
}
if (result.board) writeFileSync(join(runDir, 'BOARD.md'), `# Debate board - run ${runId}\n\nEvery proposal, what the other labs posted on it, and the author's reply.\n\n${result.board}`);
if (result.handoff) writeFileSync(join(runDir, 'HANDOFF.md'), result.handoff);
if (result.proposals?.length) {
  writeFileSync(join(runDir, 'proposals.md'), result.proposals.map(p =>
    `## ${p.id} (${p.lab}/${p.model})\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`).join('\n\n'));
}
writeFileSync(join(runDir, 'report.json'), JSON.stringify({
  runId,
  chain: config.name,
  task: taskPathEff,
  fromRun: fromRun || resumeMeta?.fromRun || null,
  criteria: result.criteria,
  questions: result.questions,
  passed: result.passed,
  lastCritique: result.lastCritique,
  signoff: result.signoff,
  proposals: result.proposals,
  dropouts: result.dropouts,
  debate: result.debate,
  scoreboard: result.scoreboard,
  totals: result.totals,
  maxUsd: maxUsdEff,
  stages: result.stages.map(({ text, ...rest }) => rest),
}, null, 2));

const t = result.totals;
log(`\n---`);
if (result.signoff) {
  log(`panel:    ${result.signoff.map(s => `${s.provider}${s.signedOff === null ? ' ?' : s.signedOff ? ' ✓' : ' ✗'}`).join('  ')}`);
  if (result.signoff.some(s => s.signedOff === null)) log(`          ? = no usable reply (truncated, malformed, or the lab was down), abstained - neither a pass nor an objection`);
}
log(`verdict:  ${result.passed
  ? (result.signoff ? 'every lab on the panel signed off' : 'a critic from another lab passed it')
  : 'stopped with open failures (see report.json)'}`);
if (!result.passed && result.lastCritique?.failures?.length) {
  log(`open:     ${result.lastCritique.failures.length} objection(s) for human review - the labs can be wrong, read the draft before acting on these`);
  for (const f of result.lastCritique.failures) log(`  - ${f.lab ? `${f.lab}: ` : ''}${f.problem || f.criterion}`);
}
if (result.scoreboard) {
  log(`labs:     ${result.scoreboard.labs.map(l => `${l.lab} ${l.accepted}/${l.proposed}`).join('  ')}  (accepted/proposed; "built" is yours to fill after the build session)`);
}
log(`tokens:   ${t.input} in, ${t.output} out, ${t.total} total`);
log(`cost:     ${formatUsd(t.usd)}${t.unpriced.length ? ` (+ unpriced: ${t.unpriced.join(', ')})` : ''}${maxUsdEff === null ? '' : ` of ${formatUsd(maxUsdEff)} ceiling`}`);
log(`output:   ${join(runDir, 'deliverable.md')}${result.handoff ? `  (+ HANDOFF.md${result.board ? ', BOARD.md' : ''})` : result.board ? '  (+ BOARD.md)' : ''}`);

}
// end of the non-MCP path (see the --mcp branch at the top of this file)
