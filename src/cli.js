#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, checkSeats, setCache, setBudget, budgetState, ExternalPause, BudgetExceeded } from './chain.js';
import { summarise, formatUsd, priceOf, estimateChainRows } from './cost.js';
import { providerNames, envKeyName, keyFor } from './providers.js';
import { spendReport, costToday } from './spend.js';
import { verdictStats, independenceStatsCsv } from './verdict-stats.js';
import { withIntegrityFooter } from './integrity.js';
import { generateResumeBrief } from './resume-brief.js';
import { preflightCheck, checkArtifactReferences } from './preflight.js';
import { stageKindOf } from './stage-contract.js';
import { validateDeliverable } from './partial-deliverable.js';
import { fingerprintInputs, withStalenessCheck } from './cache-integrity.js';
import { taskHashOf, checkFrozenScope } from './scope-freeze.js';
import { withdrawalLedger } from './withdrawal-ledger.js';
import { schemaVersionWarning } from './schema-version.js';
import { forecastCost } from './cost-forecast.js';
import { renderBoardHtml } from './board-export.js';
import { buildTranscript, renderTranscriptText } from './replay.js';
import { lintChain } from './chain-lint.js';
import { computeRoleDiagnostics } from './role-diagnostics.js';
import { formatCouncilError, ERROR_CATALOG } from './errors.js';

// v5 §1 candidate 4: distinct exit codes for a degradable condition (a
// stranger can fix it and continue - a missing key, an unpriced model)
// vs. a fatal one (nothing more can happen this invocation - a chain
// file that can't even be parsed). 1-4 are already used by this file's
// own existing exit paths (usage errors, ExternalPause, BudgetExceeded).
const EXIT_DEGRADABLE = 5;
const EXIT_FATAL = 6;
import { scanArtifacts } from './key-redaction.js';

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

// The shape of a run's report.json, in one place - bug-audit finding
// (2026-09-13, v5 Phase 2): `council init`'s canned demo run used to
// hand-roll a second, independently-maintained literal missing fields
// (criteria, proposals, ...) the real writer below includes, so
// `--from-run` against an init-produced run silently reran the criteria
// stage instead of reusing it - no crash, just a broken promise. Both
// writers now build from this one function.
function reportJsonShape({ runId, chain, task, result, fromRun = null, maxUsd = null, config = null }) {
  // v6 §7: failure-mode diagnostics, computed from this run's own real
  // debate output - never from the phase 4 measurement harness, which
  // is a deterministic heuristic probe and cannot speak to real debate
  // diversity (see docs/v6-decisions.md). Additive-only: a chain with
  // no debate stage keeps debate as-is (null); one that did debate
  // always gets a diagnostics object, with nulls/empty flags rather
  // than an absent key when there's nothing to compute.
  const roleLabs = new Set(
    [
      config?.seats?.criteria, config?.seats?.builder, config?.seats?.reviser, config?.seats?.finalist,
      config?.seats?.skeleton, config?.seats?.handoff, config?.seats?.questions, config?.seats?.judge,
      ...(config?.seats?.proposers || []), ...(config?.seats?.critics || []),
    ].filter(s => s?.role).map(s => s.lab || s.provider) // same lab || provider fallback chain.js's own labOf uses
  );
  const debate = result.debate
    ? { ...result.debate, diagnostics: computeRoleDiagnostics(result.debate, roleLabs) }
    : result.debate;

  return {
    runId,
    chain,
    task,
    fromRun,
    criteria: result.criteria,
    questions: result.questions,
    passed: result.passed,
    lastCritique: result.lastCritique,
    signoff: result.signoff,
    proposals: result.proposals,
    dropouts: result.dropouts,
    debate,
    scoreboard: result.scoreboard,
    disputes: result.disputes,
    orphanSections: result.orphanSections,
    withdrawalCycles: result.withdrawalCycles,
    totals: result.totals,
    maxUsd,
    stages: result.stages.map(({ text, ...rest }) => rest),
  };
}

// A run folder's report.json can exist but still be unreadable - truncated
// by a killed run, or hand-edited - and every read-only reporting command
// (doctor --run, export-board, replay) must degrade to a clean error
// rather than an uncaught SyntaxError and a raw stack trace.
function readReportOrExit(reportPath, cmdLabel) {
  let text;
  try { text = readFileSync(reportPath, 'utf8'); } catch {
    console.error(`${cmdLabel}: no report.json in ${dirname(reportPath)}`);
    process.exit(2);
  }
  try { return JSON.parse(text); } catch {
    console.error(`${cmdLabel}: report.json in ${dirname(reportPath)} is not valid JSON`);
    process.exit(2);
  }
}

// `council doctor` answers "can this actually run, right now, on this
// machine" for a stranger who just installed it - which keys are present (by
// name only, never the value), which shipped chains are runnable with those
// keys (or need nothing at all: mock and external seats never need a key),
// and the worst-case price of each. Zero network calls: this only reads env
// var names and chains/*.json and does the same static pricing math as
// --dry-run (estimateChainRows, shared from cost.js, not re-derived here).
if (argv[0] === 'doctor') {
  // `council doctor --run <folder>` (v5 §1 candidate 3): read-only check of
  // one run's withdrawal chains for a section that ended up with no
  // surviving owner - recomputed from proposals on disk rather than
  // trusting a stored field, so it still catches an older report.json
  // written before orphanSections existed.
  const runArg = flag('run', null);
  if (runArg) {
    const runDir = resolve(work, runArg);
    const reportPath = join(runDir, 'report.json');
    const report = readReportOrExit(reportPath, 'council doctor --run');
    const ledger = withdrawalLedger(report.proposals || []);
    if (ledger.orphanSections.length) {
      console.error(`withdrawal cycle detected: ${ledger.withdrawalCycles} cycle(s), ${ledger.orphanSections.length} orphaned proposal(s) with no surviving owner: ${ledger.orphanSections.join(', ')}`);
      process.exit(1);
    }
    console.log(`No orphaned withdrawal chains in ${runDir}.`);
    process.exit(0);
  }

  // `council doctor --chain <file>` (v5 §1 candidate 5): fail-loud lint of
  // one chain config - missing stage contracts, unreachable stages, and
  // unrecognized provider references - before anything is ever run against
  // it. Takes a path (own chains/ or a shipped one), not a bare chain name,
  // so a chain still being drafted (not yet named/installed) can be linted.
  const chainArg = flag('chain', null);
  if (chainArg) {
    const chainPath = resolve(work, chainArg);
    if (!existsSync(chainPath)) {
      console.error(`council doctor --chain: no such file ${chainPath}`);
      process.exit(2);
    }
    let cfg;
    try { cfg = JSON.parse(readFileSync(chainPath, 'utf8')); } catch {
      console.error(`council doctor --chain: ${chainPath} is not valid JSON`);
      process.exit(2);
    }
    const findings = lintChain(cfg, chainPath);
    if (findings.length) {
      console.error(`\n${chainPath}: ${findings.length} problem(s)\n`);
      for (const f of findings) {
        console.error(`  [${f.kind}] ${f.message}`);
        console.error(`    fix: ${f.fix}\n`);
      }
      process.exit(1);
    }
    console.log(`${chainPath}: no lint problems.`);
    process.exit(0);
  }

  // `council doctor --scan-artifacts` (v5 §1 candidate 11): a key-shaped string pasted into a
  // task file or chain config is the one thing that can turn BYOK into a leaked secret, and this
  // repo is public. Scans the user's own task files and chain configs; never prints the matched
  // text, only where it was found.
  if (argv.includes('--scan-artifacts')) {
    const roots = [join(work, 'tasks'), join(work, 'chains'), join(pkg, 'chains')].filter(existsSync);
    const { findings, filesScanned } = scanArtifacts(roots);
    if (findings.length) {
      console.error(`key-redaction scan: ${findings.length} possible key(s) found across ${filesScanned} file(s) scanned:`);
      for (const f of findings) console.error(`  ${f.file}:${f.line}:${f.column} - looks like ${f.pattern} (value not shown)`);
      console.error(`\nRemove or rotate any real key found above before committing or sharing these files.`);
      process.exit(1);
    }
    console.log(`key-redaction scan: no key-shaped strings found across ${filesScanned} file(s) in ${roots.join(', ')}.`);
    process.exit(0);
  }

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
    // v5 §1 candidate 13: warn, never fail - an old chain file is read exactly as it always was.
    const warning = schemaVersionWarning(cfg);
    if (warning) console.log(`    schemaVersion: ${warning.split('\n').join('\n    ')}`);
  }
  console.log(`\nNo network calls were made - this only reads environment variable names and chains/*.json.`);

  // v5 §1 candidate 4: doctor's own diagnostic block also names every code
  // a stranger might see from a hard-fail path, so a code seen in a
  // terminal is greppable straight back to this same command.
  console.log(`\nError codes (see TROUBLESHOOTING.md for the full message and fix for each):`);
  for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
    console.log(`  ${code}  [${entry.kind}]  ${entry.title}`);
  }
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

// `council init [--yes]` (v5 §1 candidate 6): the gap between "the demo
// ran" and "I can run my own task" is where a clone gets abandoned -
// `doctor` says what's broken and `demo` shows output, but neither
// leaves a stranger with a chain file they own and understand. This
// does: doctor's key check, a starter chain + task file written to the
// user's own directory, a real (no-network) price of that starter
// chain, then a canned, all-mock, 3-seat run executed end to end so the
// first artifact a stranger inspects is a real run folder, not just
// terminal output. `--yes` skips nothing interactive - there is nothing
// interactive to skip - it only exists so a script can invoke this
// without wondering whether it will ever prompt.
if (argv[0] === 'init') {
  console.log(`\ncouncil init - a first chain and task you own, plus one real run to look at.\n`);

  console.log(`API keys (name only - the value is never read here beyond presence/absence):`);
  const names = providerNames();
  const nw = Math.max(...names.map(n => n.length));
  let anyKeySet = false;
  for (const name of names) {
    const envName = envKeyName(name);
    const has = !!process.env[envName];
    if (has) anyKeySet = true;
    console.log(`  ${name.padEnd(nw)}  ${envName.padEnd(20)}  ${has ? 'set' : 'not set - a chain using this lab would abort (COUNCIL-E001), not degrade'}`);
  }

  const chainsDir = join(work, 'chains');
  const tasksDir = join(work, 'tasks');
  mkdirSync(chainsDir, { recursive: true });
  mkdirSync(tasksDir, { recursive: true });

  // JSON has no comment syntax, so "commented" here means the same
  // "_note" convention src/pricing.json already uses: a real, readable
  // field that JSON.parse happily ignores as unused chain config.
  const starterChain = {
    _note: 'Your first chain. One lab writes a plan, another lab reviews it once. Edit the seats below to use whichever labs you have keys for - see README.md#chains for the full field list.',
    name: 'my-first-chain',
    description: 'A minimal real chain: one builder, one critic, one round.',
    maxRounds: 1,
    seats: {
      criteria: { _note: 'Writes the acceptance criteria before anything else exists.', provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 2000 },
      builder: { _note: 'Writes the first draft.', provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 8000 },
      critics: [{ _note: 'Reviews the draft against the criteria. Add a second seat here for a real second opinion.', provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 8000 }],
    },
  };
  // Never overwrite a file the user was told to edit - the starter chain's
  // own _note says "edit the seats below", and a silent overwrite on a
  // rerun would erase exactly that edit with no warning.
  const starterChainPath = join(chainsDir, 'my-first-chain.json');
  if (existsSync(starterChainPath)) {
    console.log(`\n${starterChainPath} already exists - left as-is.`);
  } else {
    writeFileSync(starterChainPath, JSON.stringify(starterChain, null, 2));
    console.log(`\nWrote ${starterChainPath}`);
  }

  const starterTaskPath = join(tasksDir, 'my-first-task.md');
  if (existsSync(starterTaskPath)) {
    console.log(`${starterTaskPath} already exists - left as-is.`);
  } else {
    writeFileSync(starterTaskPath, `A short plan for a personal weekly reading list: what it tracks, how an entry gets added, how "done" is marked. Plain prose - this file is read by the criteria stage as-is, nothing else parses it.\n`);
    console.log(`Wrote ${starterTaskPath}`);
  }

  console.log(`\nPrice of your starter chain (no network call, no key needed for this step):`);
  const rows = estimateChainRows(starterChain);
  const w = Math.max(...rows.map(r => r.seat.length));
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(12)} ${r.seat.padEnd(w)}  ${r.priced ? formatUsd(r.usd) : 'unpriced'}`);
  }
  const worst = rows.reduce((s, r) => s + r.usd, 0);
  console.log(`  worst case: ${formatUsd(worst)} for the whole chain`);

  console.log(`\nRunning a canned, offline, $0 task end to end so you can see a real run folder before touching a key:`);
  const cannedConfig = {
    name: 'council-init-demo',
    maxRounds: 1,
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      critics: [{ provider: 'mock', model: 'mock-critic-a' }],
    },
  };
  const initRunId = `${new Date().toISOString().replace(/[:.]/g, '-')}-init`;
  const initRunDir = join(work, 'runs', initRunId);
  mkdirSync(initRunDir, { recursive: true });
  const initResult = await runChain({
    request: readFileSync(starterTaskPath, 'utf8'),
    config: cannedConfig,
    log: line => console.log(`  ${line}`),
  });
  writeFileSync(join(initRunDir, 'deliverable.md'), initResult.deliverable);
  writeFileSync(join(initRunDir, 'report.json'), JSON.stringify(reportJsonShape({
    runId: initRunId, chain: cannedConfig.name, task: starterTaskPath, result: initResult, config: cannedConfig,
  }), null, 2));

  console.log(`\nWrote ${initRunDir} - a real run folder (report.json, deliverable.md) from the canned demo task, $0, no network call.`);
  console.log(`\nNext, with a real key set: node src/cli.js --chain my-first-chain --task ${starterTaskPath.replace(work + '/', '')} --dry-run`);
  console.log(`Then, for real: node src/cli.js --chain my-first-chain --task ${starterTaskPath.replace(work + '/', '')}`);
  if (!anyKeySet) console.log(`\nNo API keys are set yet - see README.md#setup, or "council doctor" any time to re-check.`);
  process.exit(0);
}

// `council export-board --run <folder> --out <file>` (v5 §1 candidate 8):
// a run's proposals/debate/replies/verdict as one self-contained HTML
// file - no external assets, no template-engine dependency, no server.
if (argv[0] === 'export-board') {
  const runArg = flag('run', null);
  const outArg = flag('out', 'board.html');
  if (!runArg) {
    console.error('export-board: --run <folder> is required');
    process.exit(2);
  }
  const runDir = resolve(work, runArg);
  const reportPath = join(runDir, 'report.json');
  const report = readReportOrExit(reportPath, 'export-board');
  const outPath = resolve(work, outArg);
  writeFileSync(outPath, renderBoardHtml(report));
  console.log(`Wrote ${outPath}`);
  process.exit(0);
}

// `council replay --run <folder> [--json]` (v5 §1 candidate 9): a
// numbered, indented, step-by-step transcript of a run's reasoning - a
// CLI-native complement to export-board's shareable HTML artifact.
if (argv[0] === 'replay') {
  const runArg = flag('run', null);
  if (!runArg) {
    console.error('replay: --run <folder> is required');
    process.exit(2);
  }
  const runDir = resolve(work, runArg);
  const reportPath = join(runDir, 'report.json');
  const report = readReportOrExit(reportPath, 'replay');
  const steps = buildTranscript(report);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(steps, null, 2));
  } else {
    console.log(renderTranscriptText(steps));
  }
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
        `  dropouts=${c.dropouts}  unparseable=${c.unparseable}  shapeOnlyRounds=${c.shapeOnlyRounds}` +
        `  cost=${c.meanCostUsd === null ? '-' : formatUsd(c.meanCostUsd)}` +
        `  wall=${c.meanWallMs === null ? '-' : `${Math.round(c.meanWallMs / 1000)}s`}`);
    }
    console.log(`\nBy lab:`);
    for (const l of r.labs) {
      console.log(`  ${l.lab}: proposed=${l.proposed} accepted=${l.accepted} withdrawn=${l.withdrawn} cut=${l.cut} dropouts=${l.dropouts} unparseable=${l.unparseable}`);
    }
    console.log(`\nIndependence skew (novel-objection rate, solo-signoff rate - descriptive only, never auto-reweighted):`);
    for (const l of r.labs) {
      const novel = l.novelObjectionRate === null ? '-' : `${Math.round(l.novelObjectionRate * 100)}%`;
      const solo = l.soloSignoffRate === null ? '-' : `${Math.round(l.soloSignoffRate * 100)}%`;
      console.log(`  ${l.lab}: novelObjections=${novel} (${l.novelObjections}/${l.objections})  soloSignoff=${solo} (${l.soloSignoffs}/${l.signoffs})${l.lowIndependence ? '  [low independence]' : ''}`);
    }
    if (argv.includes('--csv')) {
      console.log(`\nIndependence skew CSV:`);
      console.log(independenceStatsCsv(r.labs));
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

// `council --forecast-cost --chain <name>` (v5 §1 candidate 7): a
// realistic-case range from this chain's own history on this machine,
// repriced at today's pricing.json - distinct from `--dry-run`'s
// worst-case estimate from the chain's declared token assumptions.
if (argv.includes('--forecast-cost')) {
  const chainNameArg = flag('chain', 'verify');
  const days = Number(flag('days', 90));
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days: expected a positive number of days');
    process.exit(2);
  }
  const f = forecastCost(chainNameArg, join(work, 'runs'), { days });
  console.log(`\nCost forecast for chain "${f.chain}", from ${f.runsUsed} historical run(s) in the last ${f.days} day(s):`);
  if (f.low === null) {
    console.log(`  no estimate - ${f.note}. Try "council --chain ${f.chain} --dry-run" for a worst-case estimate with no history needed.`);
  } else {
    console.log(`  ${formatUsd(f.low)} - ${formatUsd(f.high)}  (mean ${formatUsd(f.mean)})`);
    console.log(`  This is a range from what this chain has actually cost before, repriced at today's rates - not a promise. A run outside this range is possible.`);
    if (f.partial) console.log(`  PARTIAL: ${f.note}`);
  }
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
// v5 §1 candidate 4, COUNCIL-E003: a malformed chain file is a fatal,
// stranger-facing condition - caught here rather than left to an
// uncaught SyntaxError. Handled inline (not left to the later try/catch
// around the run itself, which starts well after this point) so the
// tone-shaped message prints even though nothing has been invoked yet.
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {
  console.error(`\n${formatCouncilError('COUNCIL-E003', { path: configPath })}`);
  process.exit(EXIT_FATAL);
}
if (flag('rounds', null)) config.maxRounds = Number(flag('rounds'));

// v5 §1 candidate 5: fail loud, before a single metered call, on a chain
// config that is broken rather than merely risky - distinct from
// preflightCheck's warn-never-block posture below, which is about task
// text, not chain config validity. Skipped on --resume: the chain already
// ran a first round successfully, so its config already proved runnable.
if (!resumeMeta) {
  const lintFindings = lintChain(config, configPath);
  if (lintFindings.length) {
    console.error(`\nchain lint: ${configPath} has ${lintFindings.length} problem(s) and will not run:\n`);
    for (const f of lintFindings) {
      console.error(`  [${f.kind}] ${f.message}`);
      console.error(`    fix: ${f.fix}\n`);
    }
    process.exit(1);
  }
}

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
  // mock/external are synthetic seats that are never billed and were never
  // going to be in pricing.json - only a real provider's missing price is
  // worth telling anyone about.
  const unpriced = [...new Set(rows.filter(r => !r.priced && !r.seat.startsWith('mock/') && !r.seat.startsWith('external/')).map(r => r.seat))];
  if (unpriced.length) {
    console.log('');
    for (const seat of unpriced) {
      const [provider, model] = seat.split('/');
      console.log(`  ${formatCouncilError('COUNCIL-E002', { provider, model }).replace(/\n/g, '\n  ')}`);
    }
  }
  process.exit(0);
}

const missing = checkSeats(allSeats);
if (missing.length) {
  // v5 §1 candidate 4, COUNCIL-E001: one tone-shaped message per missing
  // provider, deduplicated - a chain with three seats on the same
  // unset key gets told once, not three times.
  const missingProviders = [...new Set(allSeats.filter(Boolean).map(s => s.provider).filter(p => !keyFor(p)))];
  console.error('');
  for (const provider of missingProviders) {
    console.error(formatCouncilError('COUNCIL-E001', { provider, chain: config.name, envVar: envKeyName(provider) }));
    console.error('');
  }
  console.error(`Run "council doctor" to see exactly which keys each shipped chain needs.`);
  process.exit(EXIT_DEGRADABLE);
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
// v3 §2: frozen-scope enforcement. Hashes the raw task text alone (not the chain config -
// that's §7.2's cache fingerprint, a different property) so a run can tell whether its own
// task file changed since it started, independent of --context docs. Reuses src/integrity.js's
// own hashing rather than a second implementation.
const taskHash = taskHashOf(rawTaskTextForCacheFingerprint);
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
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ chain: chainNameEff, task: taskPathEff, context: contextArg || null, fromRun: fromRun || null, draft: draftPath || null, rounds: config.maxRounds, maxUsd, taskHash }, null, 2));
} else if (resumeMeta.rounds) config.maxRounds = resumeMeta.rounds;

// v3 §2: refuse to silently resume past a changed task file. A stored taskHash on an older
// run (pre-v3) is absent, not mismatched - trusted, not treated as stale, the same posture
// §7.2's cache staleness check already takes for a missing fingerprint. AMENDMENTS.md is the
// one path past a real mismatch: an entry covering the current hash means the operator
// declared the change on the record rather than editing the task file quietly.
if (resumeMeta) {
  const amendmentsPath = join(runDir, 'AMENDMENTS.md');
  const amendmentsText = existsSync(amendmentsPath) ? readFileSync(amendmentsPath, 'utf8') : null;
  const scopeCheck = checkFrozenScope({ storedHash: resumeMeta.taskHash, currentHash: taskHash, amendmentsText });
  if (!scopeCheck.ok) {
    console.error(`\n${scopeCheck.message}\n(${amendmentsPath})`);
    process.exit(1);
  }
  if (scopeCheck.amended) {
    // The new hash becomes this run's baseline going forward.
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...resumeMeta, taskHash }, null, 2));
    console.log(`task hash mismatch covered by a recorded amendment in ${amendmentsPath} - proceeding.`);
  }
}
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
  // v3 §3: same call site, same warn-never-block posture, checking for a task that names a
  // file it never inlines verbatim rather than a section/criteria conflict.
  const preflightWarnings = [...preflightCheck(config, request), ...checkArtifactReferences(request)];
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
      // v5 §1 candidate 14: one JSONL line per stage, alongside the existing markdown/usage
      // artifacts - structured so future tooling (candidate #9's replay, #2's independence
      // report) can read a run without re-parsing prose. No prompt content, same privacy
      // posture as verdict-stats.js: seat/lab/counts/cost/timing only.
      appendFileSync(join(runDir, 'stage-log.jsonl'), `${JSON.stringify({
        stage: s.label, seat: `${s.provider}/${s.model}`, lab: s.lab,
        tokensIn: s.usage?.input ?? 0, tokensOut: s.usage?.output ?? 0,
        usd: s.usd, ms: s.ms, outcome: s.text ? 'ok' : 'empty',
      })}\n`);
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
if (result.proposalPool?.length && result.proposalPool.length > result.proposals.length) {
  writeFileSync(join(runDir, 'proposals-pool.md'), `# Every proposal every lab wrote (${result.proposalPool.length}); "kept" ones went to the builder\n\n` + result.proposalPool.map(p =>
    `## ${p.kept ? 'KEPT' : 'dropped'} - ${p.lab}/${p.model}, attempt ${p.attempt}\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`).join('\n\n'));
}
// §5 (v3 plan): declined objections are a first-class record, never part of the deliverable text
// itself, so they get their own section wherever the board already lives - the same file that
// already lists proposals and debate posts (or a standalone one, if no debate happened this run).
const disputesSection = result.disputes?.length
  ? `\n\n## Disputed objections (declined by the reviser, kept out of the deliverable)\n\n${result.disputes.map(d => `- Round ${d.round}: ${d.reason}`).join('\n')}`
  : '';
if (result.board || disputesSection) writeFileSync(join(runDir, 'BOARD.md'), `# Debate board - run ${runId}\n\n${result.board ? `Every proposal, what the other labs posted on it, and the author's reply.\n\n${result.board}` : 'No proposal debate ran this round.'}${disputesSection}`);
if (result.handoff) writeFileSync(join(runDir, 'HANDOFF.md'), result.handoff);
if (result.proposals?.length) {
  writeFileSync(join(runDir, 'proposals.md'), result.proposals.map(p =>
    `## ${p.id} (${p.lab}/${p.model})\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`).join('\n\n'));
}
writeFileSync(join(runDir, 'report.json'), JSON.stringify(reportJsonShape({
  runId, chain: config.name, task: taskPathEff, result, config,
  fromRun: fromRun || resumeMeta?.fromRun || null, maxUsd: maxUsdEff,
}), null, 2));
// Final regeneration: the last onStage-triggered RESUME.md was written before
// deliverable.md/report.json existed, so without this it would keep reporting
// "in progress" forever on an already-finished run. Run after report.json so
// an orphaned-withdrawal warning (v5 §1 candidate 3) can be read back from it.
writeFileSync(join(runDir, 'RESUME.md'), generateResumeBrief({ runId, dir: runDir, runMeta: { chain: chainNameEff, task: taskPathEff }, chainConfig: config }));

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
const boardWritten = result.board || disputesSection;
log(`output:   ${join(runDir, 'deliverable.md')}${result.handoff ? `  (+ HANDOFF.md${boardWritten ? ', BOARD.md' : ''})` : boardWritten ? '  (+ BOARD.md)' : ''}`);

}
// end of the non-MCP path (see the --mcp branch at the top of this file)
