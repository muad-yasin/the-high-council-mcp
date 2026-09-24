#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, rmSync, readdirSync, statSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, checkSeats, everySeatOf, resolveChainSeats, setCache, setBudget, budgetState, countEarlierSpend, setProgressHook, setChargeHook, ExternalPause, BudgetExceeded, PreflightBlocked, DraftTruncated, renderDisputeReviewBoard } from './chain.js';
import { BLOCKING_SEVERITIES } from './security-review.js';
import { deriveRunStatus, ARTIFACTS_BLOCKED_FILE } from './run-status.js';
import { acquireRunLock, RunLockedError } from './run-lock.js';
import { parseRoundFromLabel, classifyStageCompletion, classifyVerdictEvent, sumCostFromStageLogText } from './run-state.js';
import { resolveParentSpanId, recordRoundStageAndCheckClose, replaySpanStateFromStageLogText, sumRoundUsdFromStageLogText } from './spans.js';
import { appendSpanRecord, buildSpanRecord } from './progress-spans.js';
import { computeOutcome } from './outcome.js';
import { reportJsonShape, renderBoardMd } from './report-shape.js';
import { summarise, formatUsd, priceOf, estimateChainRows } from './cost.js';
import { providerNames, envKeyName, keyFor, isKeyOptional, call } from './providers.js';
import { DEMO_REQUEST } from './mock-demo.js';
import { readCompletedRun, generateDigestText, writeDigest } from './dissent-digest.js';
import { deniedReasonsOf, DeniedModel } from './denied-models.js';
import { spendReport, costToday } from './spend.js';
import { verdictStats, independenceStatsCsv } from './verdict-stats.js';
import { metricsReport } from './metrics.js';
import { withIntegrityFooter } from './integrity.js';
import { generateResumeBrief } from './resume-brief.js';
import { preflightCheck, checkArtifactReferences } from './preflight.js';
import { fenceFile, scanTaskForSecrets, FENCE_HEADER, FENCE_MAX_BYTES } from './fence.js';
import { scanForPii, applyPiiGate } from './pii-gate.js';
import { harnessVersion } from './version.js';
import { stageKindOf } from './stage-contract.js';
import { validateDeliverable } from './partial-deliverable.js';
import { fingerprintInputs } from './cache-integrity.js';
import { archiveSuperseded, supersededSpendOf, recordLostCharge } from './superseded.js';
import { taskHashOf, checkFrozenScope } from './scope-freeze.js';
import { withdrawalLedger } from './withdrawal-ledger.js';
import { schemaVersionWarning } from './schema-version.js';
import { forecastCost } from './cost-forecast.js';
// A static import, not a dynamic one - see the comment on runMcpServer in mcp/server.js for why.
// mcp/server.js's own self-invocation guard means this import alone never starts a server; only
// the explicit call below, inside the --mcp branch, does.
import { runMcpServer } from './mcp/server.js';
import { renderBoardHtml } from './board-export.js';
import { buildTranscript, renderTranscriptText } from './replay.js';
import { lintChain } from './chain-lint.js';
import { reshuffleSeats } from './rematch.js';
import { computeVerdictDiff } from './verdict-diff.js';
import { computeRoleDiagnostics } from './role-diagnostics.js';
import { formatCouncilError, ERROR_CATALOG } from './errors.js';
import { loadPolicy, buildPolicyContext, evaluatePolicy, parseChangeRequestFields, POLICY_PATH } from './policy.js';
import { deriveDisagreementGroups } from './disagreement-groups.js';
import { shouldEnableAudit, loadHmacKey, createAuditWriter } from './audit.js';
import { runCouncilReplay, replayDirFor } from './council-replay.js';

// v5 §1 candidate 4: distinct exit codes for a degradable condition (a
// stranger can fix it and continue - a missing key, an unpriced model)
// vs. a fatal one (nothing more can happen this invocation - a chain
// file that can't even be parsed). 1-4 are already used by this file's
// own existing exit paths (usage errors, ExternalPause, BudgetExceeded).
const EXIT_DEGRADABLE = 5;
const EXIT_FATAL = 6;
// Final security-review gate (src/security-review.js): the run itself completed and every artifact
// is on disk, but the gate did not pass. Kept distinct from every code above so a caller can tell a
// blocked or unjudged build from a crashed or degraded run.
const EXIT_SECURITY_BLOCKED = 7;
const EXIT_SECURITY_NOT_JUDGED = 8;
// Bug-audit fix, 2026-09-23 (Review/BugAudit_CLI_2026-09-23.md #7): several different outcomes
// shared one code - 5 was both "a key is missing" and "preflight blocked the task", 2 was both a
// usage error and the artifact gate, 6 was a fatal error, a policy refusal and a locked run, and 1
// covered the PII gate and a changed task. A caller (a script, the MCP server, CI) could not tell
// them apart. Every guard that refuses a run now has its own code; the README lists them all.
const EXIT_ARTIFACTS_BLOCKED = 9;
const EXIT_PREFLIGHT_BLOCKED = 10;
const EXIT_PII_BLOCKED = 11;
const EXIT_POLICY_REFUSED = 12;
const EXIT_RUN_LOCKED = 13;
const EXIT_SCOPE_CHANGED = 14;
const EXIT_ALREADY_FINISHED = 15;
// CLI audit #5 (Review/PreRelease_Audit_cli_2026-09-23.md): a run that crashed mid-stage (a dead
// local model, a provider error nothing caught) rethrew and exited 1 - the code the README reserves
// for lint and missing input - with a raw stack and nothing in the run folder saying it stopped.
const EXIT_RUN_FAILED = 16;
// Pre-release audit 2026-09-23 (PreRelease_Audit_revise #1): a build, revise, dispute, final or
// handoff reply was cut off at its token cap and its one bigger-cap retry was cut off too (or the
// seat is external). The run stops rather than grade, report or ship the fragment.
const EXIT_DRAFT_TRUNCATED = 17;
import { scanArtifacts } from './key-redaction.js';
import { resetToolCallLog, renderToolsMd } from './tools.js';
import { arguedWarnings } from './argued.js';

const here = dirname(fileURLToPath(import.meta.url));

// Write under a temp name in the same directory, then rename: readers see the old file or the whole
// new one, never a torn write.
function writeFileAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

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
if (argv[0] === '--version' || argv[0] === '-v') {
  console.log(harnessVersion());
  process.exit(0);
}
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return (next && !next.startsWith('--')) ? next : true;
}

// reportJsonShape() and the BOARD.md text now live in src/report-shape.js, shared with --replay.

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
    const status = has ? 'set' : isKeyOptional(name) ? 'not required (local - a dummy or missing key is fine)' : 'not set';
    console.log(`  ${name.padEnd(nw)}  ${envName.padEnd(20)}  ${status}`);
  }

  console.log(`\nChains (runnable = every seat's provider has its key set, or is mock/external):`);
  const chainsDir = join(pkg, 'chains');
  const files = readdirSync(chainsDir).filter(f => f.endsWith('.json')).sort();
  const cw = Math.max(...files.map(f => f.length - 5));
  for (const f of files) {
    const cfg = JSON.parse(readFileSync(join(chainsDir, f), 'utf8'));
    // Pre-release audit 2026-09-23 (lint #3): this listing hand-built its own seat list and missed
    // the challenger, cold reader, claims, ambiguity, descending, preflight and default security
    // reviewer seats, so it called a chain "runnable" that a real run refuses. It now uses the same
    // enumerator the real run path checks (everySeatOf after vendor resolution).
    let seats;
    try { seats = everySeatOf(resolveChainSeats(cfg)); } catch { seats = everySeatOf(cfg); }
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
// before ever touching a real key. The seats are mock-debate's, renamed to
// the `mock-demo-*` models, whose replies are the scripted photo-renamer
// scenario in src/mock-demo.js rather than the tests' placeholder text.
if (argv[0] === 'demo') {
  const demoConfig = JSON.parse(readFileSync(join(pkg, 'chains', 'mock-debate.json'), 'utf8'));
  const demoSeat = seat => ({ ...seat, model: seat.model.replace(/^mock-/, 'mock-demo-'), ...(seat.lab ? { lab: seat.lab.replace(/^mock-/, 'lab-') } : {}) });
  demoConfig.name = 'demo';
  for (const [role, seat] of Object.entries(demoConfig.seats)) {
    demoConfig.seats[role] = Array.isArray(seat) ? seat.map(demoSeat) : demoSeat(seat);
  }
  console.log(`\nThe High Council - offline demo (provider: mock)`);
  console.log(`No API key, no network call, $0. Every seat's reply below is scripted in advance`);
  console.log(`(src/mock-demo.js) - no model is judging anything. What is real is the mechanism`);
  console.log(`around them: blind proposals, anonymised debate, the board, panel rounds, the ledger.`);
  console.log(`\nThe request:\n\n${DEMO_REQUEST.replace(/^/gm, '  ')}\n`);
  const demoResult = await runChain({
    request: DEMO_REQUEST,
    config: demoConfig,
    log: line => console.log(line),
  });
  console.log(`\n${'='.repeat(72)}\nDELIVERABLE (the plan)\n${'='.repeat(72)}\n`);
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
    const status = has ? 'set' : isKeyOptional(name) ? 'not required (local - a dummy or missing key is fine)' : 'not set - a chain using this lab would abort (COUNCIL-E001), not degrade';
    console.log(`  ${name.padEnd(nw)}  ${envName.padEnd(20)}  ${status}`);
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
  console.log(`\nNext, with a real key set: council --chain my-first-chain --task ${starterTaskPath.replace(work + '/', '')} --dry-run`);
  console.log(`Then, for real: council --chain my-first-chain --task ${starterTaskPath.replace(work + '/', '')}`);
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

// `council digest --run <folder> [--provider p --model m]` (v6 item E): a short, plain-English
// paragraph explaining why the panel disagreed (or that it didn't), written into the completed
// run's own folder as digest.md. Deliberately its own top-level subcommand, never a stage inside
// runChain - see src/dissent-digest.js's header comment and test/no-digest-in-prompt-paths.test.js
// for the structural read-only guarantee this depends on. --provider/--model are optional: with
// neither given, the digest is the fixed deterministic template (renderDigestTemplate), no model
// call at all - the one real BYOK call this feature ever makes is opt-in, named explicitly by the
// operator, never automatic.
// `council fence --task <task.md> --repo <path> <file> [file...]` (2026-09-20). Appends real
// file contents to a task file, fenced and labelled, for the operator to read BEFORE the run.
// Deliberately not automatic: a person decides what a third-party lab gets to see, and the
// task file is the record of exactly that. See src/fence.js for why this shape and not a tool.
if (argv[0] === 'fence') {
  const taskArg = flag('task', null);
  const repoArg = flag('repo', null);
  if (!taskArg || taskArg === true || !repoArg || repoArg === true) {
    console.error('fence: --task <task.md> and --repo <path> are both required');
    console.error('usage: council fence --task task.md --repo ../SMO SaveSystem.cs run-tests.sh');
    process.exit(2);
  }
  // Positional file arguments: everything that is not a flag or a flag's value.
  const flagsWithValues = new Set(['--task', '--repo']);
  const files = [];
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { if (flagsWithValues.has(argv[i])) i += 1; continue; }
    files.push(argv[i]);
  }
  if (!files.length) {
    console.error('fence: name at least one file to fence, relative to --repo');
    process.exit(2);
  }
  const taskPathAbs = resolve(work, taskArg);
  if (!existsSync(taskPathAbs)) {
    console.error(`fence: no such task file: ${taskArg}`);
    process.exit(2);
  }
  const repoRoot = resolve(work, repoArg);
  if (!existsSync(repoRoot)) {
    console.error(`fence: no such repository: ${repoArg}`);
    process.exit(2);
  }

  let appended = '';
  const summary = [];
  for (const f of files) {
    try {
      const block = fenceFile(repoRoot, f);
      appended += block.text;
      summary.push(block);
    } catch (err) {
      // One refused file fails the whole command: a partially-fenced task looks fenced,
      // and the operator would have to notice the absence to catch it.
      console.error(`fence: ${err.message}`);
      process.exit(2);
    }
  }

  const existing = readFileSync(taskPathAbs, 'utf8');
  const header = existing.includes('# Source, fenced verbatim') ? '' : FENCE_HEADER;
  const next = `${existing.replace(/\s*$/, '')}\n${header}${appended}`;

  // Scan the RESULT, not just what was added: a credential already sitting in the task's
  // prose is just as sent as one inside a fence.
  const scan = scanTaskForSecrets(next);
  if (!scan.clean) {
    console.error(`fence: ${scan.message}`);
    console.error('fence: the task file was NOT modified.');
    process.exit(2);
  }

  writeFileSync(taskPathAbs, next);
  console.log(`Fenced ${summary.length} file(s) into ${taskArg}:`);
  for (const b of summary) {
    const notes = [
      b.truncated ? `truncated at ${FENCE_MAX_BYTES} bytes of ${b.bytes}` : `${b.bytes} bytes`,
      b.redacted ? `${b.redacted} value(s) redacted as possible secrets` : null,
    ].filter(Boolean).join(', ');
    console.log(`  ${b.rel} - ${notes}`);
  }
  console.log('\nRead the task file before running it. Everything in it is sent to every seat,');
  console.log('and therefore to every lab behind them.');
  process.exit(0);
}

if (argv[0] === 'digest') {
  const runArg = flag('run', null);
  if (!runArg) {
    console.error('digest: --run <folder> is required');
    process.exit(2);
  }
  const runDir = resolve(work, runArg);
  let report;
  try {
    report = readCompletedRun(runDir);
  } catch (e) {
    console.error(`digest: ${e.message}`);
    process.exit(2);
  }
  const providerArg = flag('provider', null);
  const modelArg = flag('model', null);
  // Money path #5: the digest's model call is refused for a denied model before anything is sent.
  if (providerArg) {
    const denied = deniedReasonsOf({ provider: providerArg, model: modelArg });
    if (denied.length) {
      console.error(`digest: refused - ${denied.join('; ')}. This harness never calls a denied model.`);
      process.exit(2);
    }
  }
  const text = await generateDigestText({
    report,
    call: providerArg ? call : null,
    provider: providerArg,
    model: modelArg,
  });
  const path = writeDigest(runDir, text);
  console.log(`Wrote ${path}`);
  process.exit(0);
}

// Bug-audit fix, 2026-09-23 (Review/BugAudit_MoneyPath_2026-09-23.md #3): parsed here, above
// --rematch and --replay, because both of those call runChain() - and they used to do it before
// this block ran and before setBudget(), so they spent under the module default of no ceiling.
// Per-run spend ceiling. A BYOK tool that a stranger points their own API
// keys at ships with a ceiling ON by default; --max-usd none is the explicit
// way to run without one, and says so in the log.
const DEFAULT_MAX_USD = 7;
const SIDE_RUN_FOLDER = /\.(rematch-\d+|replay-\d{4}-\d{2}-\d{2})$/;
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

// --rematch / --replay stop at the ceiling like a normal run. They have no stage cache and no
// per-stage usage files, so this marker is the only record of what the stopped sitting spent -
// spend.js falls back to it, which is how --spend still counts a capped rematch or replay.
function writeSideRunBudgetStop(dir, err, what) {
  // Money path #1: err.spent was read when the cap was hit, before sibling calls still in flight
  // settled; their cost reaches budgetState() only afterwards. By the time this runs they have
  // settled (runChain waits for them), so the budget is the true figure.
  err.spent = Math.max(err.spent || 0, budgetState().spent);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'STOPPED-budget.json'), JSON.stringify({
    stoppedAt: err.label, seat: err.seat, spentUsd: err.spent, capUsd: err.cap, projectedStageUsd: err.projected,
  }, null, 2));
  console.error(`${what}: STOPPED - per-run spend cap reached before stage "${err.label}" (${formatUsd(err.spent)} spent of ${formatUsd(err.cap)}; ${err.seat} could cost up to ${formatUsd(err.projected)}). Raise it with --max-usd <higher> or --max-usd none.`);
  process.exit(4);
}


// `--rematch <run-dir> [--rematch-seed N]` (item C, relay/runs/2026-09-15T15-12-52-325Z/
// deliverable.md): re-runs an already-decided task with labs re-shuffled/re-anonymized
// (src/rematch.js), then writes a concrete, checkable diff of the new verdict against the
// original (src/verdict-diff.js, schemas/verdict-diff.json) - order/framing robustness, not a
// re-judgment of the deliverable's quality. Config-load-time reshuffle in this CLI wrapper only;
// src/chain.js and src/tools.js are both untouched (0-line delta, per the plan).
// Resume-cache audit #3 (Review/PreRelease_Audit_ResumeCache_2026-09-23.md): --rematch and --replay
// have no stage cache and do not catch an external pause, so on a chain with an external seat they
// paid everything up to that seat and then died - no NEEDS file, nothing to resume, and --spend never
// saw the cost. They also re-run from the task text alone, ignoring the original run's --context,
// --draft and --from-run criteria, so the diff would blame the roster for a difference in inputs.
// Both are refused up front, before anything is paid.
function refuseSideRun(what, config, runMeta) {
  const external = everySeatOf(config).filter(s => s.provider === 'external');
  if (external.length) {
    console.error(`${what}: chain "${config.name}" has ${external.length} external seat(s). ${what} cannot pause for an external answer, so it would pay up to that seat and stop with nothing to resume. Refused before any call.`);
    process.exit(2);
  }
  const inputs = ['context', 'draft', 'fromRun'].filter(k => runMeta?.[k]);
  if (inputs.length) {
    console.error(`${what}: the original run also used ${inputs.map(k => `--${k === 'fromRun' ? 'from-run' : k}`).join(', ')}, which ${what} does not carry over, so any difference would come from the inputs, not the panel. Refused before any call.`);
    process.exit(2);
  }
}

const rematchArg = flag('rematch', null);
if (rematchArg) {
  const originalRunDir = resolve(work, rematchArg);
  const originalReportPath = join(originalRunDir, 'report.json');
  const originalReport = readReportOrExit(originalReportPath, '--rematch');
  const originalRunMetaPath = join(originalRunDir, 'run.json');
  if (!existsSync(originalRunMetaPath)) {
    console.error(`--rematch: no run.json in ${originalRunDir} - can't recover the original task/chain.`);
    process.exit(2);
  }
  // Replay audit #3: an unparseable run.json degrades to a clean exit 2, like readReportOrExit.
  let originalRunMeta;
  try { originalRunMeta = JSON.parse(readFileSync(originalRunMetaPath, 'utf8')); } catch {
    console.error(`--rematch: run.json in ${originalRunDir} is not valid JSON - can't recover the original task/chain.`);
    process.exit(2);
  }
  const seedArg = flag('rematch-seed', null);
  // Default random, but always recorded on disk (run.json below) so a rematch that used a random
  // seed is still reproducible after the fact by reading what it actually ran with.
  const seed = seedArg !== null ? Number(seedArg) : Math.floor(Math.random() * 1_000_000);
  if (!Number.isInteger(seed)) {
    console.error(`--rematch-seed: expected an integer, got ${seedArg}`);
    process.exit(2);
  }

  const originalTaskPath = originalRunMeta.task;
  if (!originalTaskPath || !existsSync(resolve(work, originalTaskPath))) {
    console.error(`--rematch: original task file not found (recorded as "${originalTaskPath}" in ${originalRunMetaPath}).`);
    process.exit(2);
  }
  const originalRequest = readFileSync(resolve(work, originalTaskPath), 'utf8');

  const chainName = originalRunMeta.chain;
  const chainConfigPath = [join(work, 'chains', `${chainName}.json`), join(pkg, 'chains', `${chainName}.json`)]
    .find(existsSync);
  if (!chainConfigPath) {
    console.error(`--rematch: chain "${chainName}" (recorded in ${originalRunMetaPath}) has no chain config on disk.`);
    process.exit(2);
  }
  const originalConfig = resolveChainSeats(JSON.parse(readFileSync(chainConfigPath, 'utf8')));
  const rematchConfig = reshuffleSeats(originalConfig, seed);
  refuseSideRun('--rematch', originalConfig, originalRunMeta);

  const missing = checkSeats([
    rematchConfig.seats?.criteria, rematchConfig.seats?.builder, rematchConfig.seats?.reviser,
    rematchConfig.seats?.finalist, ...(rematchConfig.seats?.critics || []), ...(rematchConfig.seats?.proposers || []),
  ].filter(Boolean));
  if (missing.length) {
    console.error(`\nMissing API keys for: ${missing.join(', ')}`);
    process.exit(1);
  }

  const rematchRunId = `${basename(originalRunDir)}.rematch-${seed}`;
  const rematchRunDir = join(dirname(originalRunDir), rematchRunId);
  // Replay audit #4: the same seed again re-paid the whole rematch and overwrote the earlier folder.
  if (existsSync(rematchRunDir)) {
    console.error(`--rematch: ${rematchRunId} already exists - that seed was already run. Use another --rematch-seed, or move the old folder aside first. Nothing was run.`);
    process.exit(2);
  }
  mkdirSync(rematchRunDir, { recursive: true });
  writeFileSync(join(rematchRunDir, 'run.json'), JSON.stringify({
    chain: chainName, task: originalTaskPath, rematchOf: basename(originalRunDir), rematchSeed: seed,
  }, null, 2));

  console.log(`\nrematch of ${basename(originalRunDir)} (chain: ${chainName}, seed: ${seed})`);
  setBudget(maxUsd);
  console.log(`cap:   ${maxUsd === null ? 'none - this rematch has no spend ceiling' : `${formatUsd(maxUsd)} (--max-usd)`}`);
  let rematchResult;
  try {
    rematchResult = await runChain({
      request: originalRequest,
      config: rematchConfig,
      log: line => console.log(line),
    });
  } catch (err) {
    if (err instanceof BudgetExceeded) writeSideRunBudgetStop(rematchRunDir, err, '--rematch'); // exits 4, like a normal run
    console.error(`--rematch: the reshuffled run did not complete (${err.message}). No diff written - a rematch that never reached a verdict has nothing to diff.`);
    process.exit(1);
  }

  writeFileSync(join(rematchRunDir, 'deliverable.md'), rematchResult.deliverable);
  const rematchBoard = renderBoardMd({ runId: rematchRunId, result: rematchResult });
  if (rematchBoard) writeFileSync(join(rematchRunDir, 'BOARD.md'), rematchBoard);
  const newReport = reportJsonShape({
    runId: rematchRunId, chain: chainName, task: originalTaskPath, result: rematchResult,
  });
  writeFileSync(join(rematchRunDir, 'report.json'), JSON.stringify(newReport, null, 2));

  const diff = computeVerdictDiff(originalReport, newReport);
  writeFileSync(join(rematchRunDir, 'rematch-diff.json'), JSON.stringify(diff, null, 2));

  console.log(`\nrematch verdict: ${newReport.passed ? 'PASSED' : 'OPEN OBJECTIONS'} (original: ${originalReport.passed ? 'PASSED' : 'OPEN OBJECTIONS'})`);
  console.log(`signoff_match: ${diff.signoff_match}  verdict_category_changed: ${diff.verdict_category_changed}  objection_overlap_ratio: ${diff.objection_overlap_ratio.toFixed(2)}`);
  if (diff.critics_objecting_added.length) console.log(`critics newly objecting: ${diff.critics_objecting_added.join(', ')}`);
  if (diff.critics_objecting_removed.length) console.log(`critics no longer objecting: ${diff.critics_objecting_removed.join(', ')}`);
  console.log(`\nWrote ${rematchRunDir} (deliverable.md, report.json, rematch-diff.json).`);
  process.exit(0);
}

// `--replay <run-dir> [--replay-date YYYY-MM-DD] [--allow-task-drift]` (v6 item D, harness
// feature round: relay/runs/2026-09-15T15-12-52-325Z/deliverable.md, "Item D — Council
// replay"): rerun an already-decided task's exact original input against today's chain config,
// then diff the new verdict against the one already recorded. Read-only with respect to
// src/chain.js and src/tools.js (0-line delta, per the plan) - the mechanism lives entirely in
// src/council-replay.js and the diff semantics it shares with item C's --rematch in
// src/verdict-diff.js. Not a claim that the new run is better or worse - see both modules'
// own headers.
if (argv.includes('--replay')) {
  const runArg = flag('replay', null);
  if (!runArg || runArg === true) {
    console.error('--replay: a run folder path is required, e.g. --replay runs/2026-09-01T00-00-00-000Z');
    process.exit(2);
  }
  const runDir = resolve(work, runArg);
  if (!existsSync(join(runDir, 'report.json')) || !existsSync(join(runDir, 'run.json'))) {
    console.error(`--replay: ${runDir} is not a completed run folder (needs run.json and report.json)`);
    process.exit(2);
  }
  const dateArg = flag('replay-date', null);
  const date = dateArg ? new Date(`${dateArg}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(date.getTime())) {
    console.error('--replay-date: expected YYYY-MM-DD');
    process.exit(2);
  }
  // Same work-then-pkg chain-config search order as a normal run (line ~749 above) - a chain
  // named by the original run may live in the user's own chains/ or in the shipped set.
  let runMetaForChain;
  try { runMetaForChain = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')); } catch {
    console.error(`--replay: run.json in ${runDir} is not valid JSON - can't recover the original task/chain.`);
    process.exit(2);
  }
  // Replay audit #4: a second replay on the same day re-paid everything and overwrote the first.
  if (existsSync(replayDirFor(runDir, date))) {
    console.error(`--replay: ${basename(replayDirFor(runDir, date))} already exists - this run was already replayed for that date. Pass another --replay-date, or move the old folder aside first. Nothing was run.`);
    process.exit(2);
  }
  const chainsDirCandidates = [join(work, 'chains'), join(pkg, 'chains')];
  const chainsDir = chainsDirCandidates.find(d => existsSync(join(d, `${runMetaForChain.chain}.json`))) || chainsDirCandidates[1];
  {
    let replayConfig = null;
    try { replayConfig = resolveChainSeats(JSON.parse(readFileSync(join(chainsDir, `${runMetaForChain.chain}.json`), 'utf8'))); } catch { /* council-replay reports a missing or bad chain itself */ }
    if (replayConfig) refuseSideRun('--replay', replayConfig, runMetaForChain);
  }
  setBudget(maxUsd);
  console.log(`cap:   ${maxUsd === null ? 'none - this replay has no spend ceiling' : `${formatUsd(maxUsd)} (--max-usd)`}`);
  try {
    const { replayDir, diff } = await runCouncilReplay(runDir, {
      chainsDir,
      workDir: work,
      date,
      log: console.log,
      allowTaskDrift: argv.includes('--allow-task-drift'),
    });
    console.log(`\nWrote ${replayDir} (report.json, deliverable.md, replay-diff.json).`);
    console.log(`signoff_match: ${diff.signoff_match}  verdict_category_changed: ${diff.verdict_category_changed}`);
  } catch (err) {
    if (err instanceof BudgetExceeded) writeSideRunBudgetStop(replayDirFor(runDir, date), err, '--replay'); // exits 4, like a normal run
    console.error(`--replay: ${err.message}`);
    process.exit(1);
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
// instead from the same run-folder files --spend already reads (see maintainers/DECISIONS.md).
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

// `council --metrics [--days N]` prints DESCRIPTIVE TELEMETRY ONLY: amendment
// rate, withdrawal rate, objection-follow-through rate and tool-call usage,
// derived from existing run logs on disk. This is not an evaluation, not a
// benchmark, and not a baseline - it is the zero-cost substitute for the
// evaluation-first direction the author declined to fund (see src/metrics.js
// header). Never read any number below as a claim that the council's output
// is better than any other tool's or person's - nothing here compares
// against anything outside this harness's own run history.
if (argv.includes('--metrics')) {
  const days = Number(flag('days', 30));
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days: expected a positive number of days');
    process.exit(2);
  }
  const r = metricsReport(join(work, 'runs'), { days });
  const pct = x => (x === null ? 'no data' : `${Math.round(x * 100)}%`);
  console.log(`\nDescriptive telemetry across ${r.runsSeen} run(s) since ${r.since.toISOString().slice(0, 16).replace('T', ' ')}  (${join(work, 'runs')})`);
  console.log(`  NOT an evaluation, benchmark or baseline - see "council --help" and README. Counts and rates only, no comparison to anything outside this harness's own run history.\n`);
  console.log(`  amendment rate:                ${pct(r.amendmentRate)}  (${r.counts.amended}/${r.counts.proposals} proposals)`);
  console.log(`  withdrawal rate:                ${pct(r.withdrawalRate)}  (${r.counts.withdrawn}/${r.counts.proposals} proposals)`);
  console.log(`  objection-follow-through rate:  ${pct(r.objectionFollowThroughRate)}  (${r.counts.objectedFollowedThrough}/${r.counts.objected} objected proposals later amended or withdrawn)`);
  console.log(`  tool-call usage:                ${pct(r.toolCallUsageRate)}  (${r.counts.acceptanceItemsNamingTool}/${r.counts.acceptanceItems} handoff acceptance items name a declared tool; ${r.counts.runsWithoutToolsSection} run(s) declared no "Available tools" section)`);
  // Pre-release audit, metrics #2: computed and README-documented, but never printed.
  console.log(`  consensus-induced regressions:  ${r.consensusInducedRegressionCount ?? 'no data'}${r.consensusInducedRegression?.excluded?.length ? `  (${r.consensusInducedRegression.excluded.length} case(s) excluded)` : ''}`);
  console.log(`  allocator rubber-stamp rate:    ${pct(r.allocatorRubberStampRate ?? null)}`);
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
  await runMcpServer();
} else {

const chainName = flag('chain', 'verify');
const taskPath = flag('task', null);
const fromRun = flag('from-run', null);
const resumeRun = flag('resume', null);
// A flag that takes a path or a name but was given none comes back from flag() as `true`, which
// then reached resolve()/readFileSync as a boolean and threw a raw TypeError (bug audit 2026-09-23,
// CLI backlog). A usage error instead, before anything else runs.
for (const name of ['chain', 'task', 'from-run', 'resume', 'draft', 'context']) {
  if (flag(name, null) === true) {
    console.error(`--${name}: needs a value, e.g. --${name} ${name === 'chain' ? 'verify' : name === 'resume' || name === 'from-run' ? 'runs/<id>' : name === 'context' ? 'context/' : '<file>'}`);
    process.exit(2);
  }
}
const dryRun = argv.includes('--dry-run');

// MLLM Coder v4 item 4: who signed off on this change request, for policy.json's
// required_signoff_paths. A bare `--signoff` with no name is refused rather than read as "signed".
const signoffFlag = flag('signoff', undefined);
if (signoffFlag === true) {
  console.error('--signoff: needs a name, e.g. --signoff alice');
  process.exit(2);
}

// v7.x item 2: PII/secrets pre-flight gate. Absent entirely (no --pii-gate flag) means this
// gate is never invoked at all - byte-identical to every prior release. `warn` logs and
// proceeds; `hard-stop` refuses the run before any provider call if it finds a match.
const piiGateMode = flag('pii-gate', null);
if (piiGateMode !== null && piiGateMode !== 'warn' && piiGateMode !== 'hard-stop') {
  console.error(`--pii-gate: expected "warn" or "hard-stop", got "${piiGateMode}"`);
  process.exit(2);
}
const piiAllow = flag('allow-pii', null);
const piiAllowList = piiAllow ? String(piiAllow).split(',').map(x => x.trim()).filter(Boolean) : [];

// The unfenced-artifact gate's two escapes (see the pre-flight block below).
// `--allow-unfenced` alone waives the whole gate for this run; given a value it
// waives only the named files, so the common case - one file that genuinely is
// just a location - does not disarm the check for everything else in the task.
const unfencedArg = flag('allow-unfenced', null);
const allowUnfenced = unfencedArg === true;
const unfencedAllowList = (unfencedArg && unfencedArg !== true)
  ? String(unfencedArg).split(',').map(x => x.trim()).filter(Boolean)
  : [];

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
  council --metrics [--days 30]        DESCRIPTIVE TELEMETRY ONLY - amendment rate,
                                       withdrawal rate, objection-follow-through rate
                                       and tool-call usage, from existing run logs.
                                       Not an evaluation, benchmark or baseline; no
                                       comparison to anything outside this harness's
                                       own run history. Same disk-only source.
  council --task tasks/x.md --pii-gate warn|hard-stop
                                       scan the task file for PII-shaped (email, checksum-
                                       valid IBAN, Luhn-valid card) and secret-shaped content
                                       before any provider call. warn logs and proceeds;
                                       hard-stop refuses the run. Off entirely unless passed.
                                       --allow-pii email,iban,card,secret suppresses named
                                       pattern classes (always printed, never a silent hole).
  council --task tasks/x.md --signoff alice
                                       name who signed off on this change request, for
                                       policy.json's required_signoff_paths. The task
                                       file's own "signoff:" line is used when the flag
                                       is absent; its "target_file:" line is the path checked.
  council --task tasks/x.md --max-usd 2 stop the run before any stage that could
                                       take it past $2. Default $7, or
                                       MAX_USD_PER_RUN. --max-usd none disables
                                       the ceiling. A stopped run resumes with
                                       --resume and a higher ceiling; stages
                                       already on disk replay for free.

  council init                         a first chain and task you own, plus one
                                       offline demo run to look at
  council export-board --run runs/<r> [--out board.html]
                                       a finished run's board as one HTML file
  council --rematch runs/<r>           the same task again with the panel reshuffled,
                                       and a verdict diff against the original
  council --replay runs/<r>            the same task and chain again today, with a diff
  council --forecast-cost --chain <name> [--days N]
                                       a realistic cost range from this chain's own
                                       past runs on this machine
  council --mcp                        run as an MCP server (stdio)
  council --version                    print the version

Chains live in chains/*.json. Runs are written to runs/<timestamp>/.
Only 'council' is installed as a command. A leading 'council' or 'relay' (the pre-rename
name) in the arguments is accepted and ignored, so older scripts keep working.`);
  // Asking for --help is success (exit 0) even with no task given; landing
  // here with neither --help nor a task/dry-run/resume is the error case
  // (exit 1) - these used to be conflated into one `taskPath ? 0 : 1`, which
  // made a bare `--help` exit 1.
  process.exit(argv.includes('--help') ? 0 : 1);
}

// --resume: everything about the run comes from its own run.json.
let resumeMeta = null;
if (resumeRun) {
  // CLI audit #2: a --rematch/--replay folder is not a resumable run. --resume re-ran it with the
  // un-reshuffled chain, paid in full and wrote a report that looked like a finished rematch; a
  // replay folder has no run.json and crashed. Both are refused, as is a folder with no run.json.
  const resumeDir = resolve(resumeRun);
  if (SIDE_RUN_FOLDER.test(basename(resumeDir))) {
    console.error(`--resume: ${basename(resumeDir)} is a --rematch/--replay folder, which cannot be resumed. Run the --rematch or --replay again instead (with a higher --max-usd if the cap stopped it).`);
    process.exit(2);
  }
  try { resumeMeta = JSON.parse(readFileSync(join(resumeDir, 'run.json'), 'utf8')); } catch (e) {
    console.error(`--resume: ${resumeDir} has no readable run.json (${e.code || e.message}) - it is not a run folder this CLI can resume.`);
    process.exit(2);
  }
  if (resumeMeta.rematchOf) {
    console.error(`--resume: ${basename(resumeDir)} is a --rematch of ${resumeMeta.rematchOf}, which cannot be resumed. Run the --rematch again instead.`);
    process.exit(2);
  }
}
const chainNameEff = resumeMeta?.chain || chainName;
// A user's own chains/ takes precedence, so a custom chain works from an
// npm install without editing anything inside node_modules.
// On resume the run's own start directory comes first (CLI audit #3's class): a custom chain lives in
// the chains/ of the directory the run was started in, not wherever the resume is typed.
const configPath = [resumeMeta?.cwd ? join(resumeMeta.cwd, 'chains', `${chainNameEff}.json`) : null, join(work, 'chains', `${chainNameEff}.json`), join(pkg, 'chains', `${chainNameEff}.json`)]
  .filter(Boolean).find(existsSync) || join(pkg, 'chains', `${chainNameEff}.json`);
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
// A positive whole number or nothing. Bug-audit fix, 2026-09-23 (GuardLayer backlog): `--rounds
// abc` became NaN, so zero review rounds ran and the run exited 0 with an unreviewed deliverable;
// `--rounds 1.5` paid for a revision no round ever graded; `--rounds 0` reviewed nothing.
{
  const roundsArg = flag('rounds', null);
  if (roundsArg !== null) {
    const n = Number(roundsArg);
    if (roundsArg === true || !Number.isInteger(n) || n < 1) {
      console.error(`--rounds: expected a whole number of review rounds, 1 or more, got ${roundsArg === true ? 'no value' : `"${roundsArg}"`}`);
      process.exit(2);
    }
    config.maxRounds = n;
  }
}

// v5 §1 candidate 5: fail loud, before a single metered call, on a chain
// config that is broken rather than merely risky - distinct from
// preflightCheck's warn-never-block posture below, which is about task
// text, not chain config validity. Also run on --resume (bug audit 2026-09-23,
// RunChainStages #5 / GuardLayer #8): it used to be skipped there on the grounds that the first
// sitting proved the config runnable - but the chain file is re-read on resume and may have been
// edited in between, and a resumed run pays for everything after the pause.
{
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
// The earlier run's criteria. A run that crashed has no report.json but does have criteria.md -
// the criteria stage's raw reply - so the criteria can still be reused. One function for the
// fresh start and the resume: the resume copy used to skip the criteria.md fallback, so a
// --from-run of a crashed run regenerated its criteria on resume, changed the cache
// fingerprint and re-paid every stage (2026-09-23 audit, MoneyPath #6).
function criteriaOfRun(dir) {
  const reportPath = join(dir, 'report.json');
  if (existsSync(reportPath)) return JSON.parse(readFileSync(reportPath, 'utf8')).criteria;
  // Resume-cache audit #2 (Review/PreRelease_Audit_ResumeCache_2026-09-23.md): an unfinished run's
  // criteria.md may be the answer a guard REJECTED - the accepted list is the last retry that ran
  // (chain.js runs the feasibility retry, then the meta retry). Taking criteria.md reused rejected
  // criteria and repeated the Zofia three-paid-rounds incident. runChain() also re-checks both
  // guards on criteria handed in this way.
  const label = ['criteria-retry', 'criteria-feasibility-retry', 'criteria'].find(l => existsSync(join(dir, `${l}.md`))) || 'criteria';
  const raw = readFileSync(join(dir, `${label}.md`), 'utf8');
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).criteria;
}
if (fromRun) {
  config.criteria = criteriaOfRun(resolve(fromRun));
  handedDraft = readFileSync(join(resolve(fromRun), 'build.md'), 'utf8');
}
// --draft <file>: review this exact text instead of building one. With
// --from-run it replaces that run's build.md; the criteria still come from
// the run. With --rounds 1 this is a panel-only pass: no builder, no reviser.
// CLI audit #3 / resume-cache #5: a relative path is resolved against the directory the run was
// started in (run.json's cwd), like the task - never against wherever the resume is typed, which
// crashed, or silently read a different file of the same name. run.json now stores it absolute.
const startDir = resumeMeta ? (resumeMeta.cwd || work) : work;
const draftPathRaw = resumeMeta ? resumeMeta.draft : flag('draft', null);
const draftPath = draftPathRaw && draftPathRaw !== true ? resolve(startDir, draftPathRaw) : draftPathRaw;
if (draftPath === true) { console.error('--draft: needs a file path, e.g. --draft plan.md'); process.exit(2); }
if (draftPath) handedDraft = readFileSync(draftPath, 'utf8');
// The earlier run's folder, as recorded: absolute for runs started since 2026-09-23, else
// relative to the directory the run was started in (run.json's cwd) - the same rule as the task.
const fromRunDirOnResume = resumeMeta?.fromRun ? resolve(resumeMeta.cwd || work, resumeMeta.fromRun) : null;
if (resumeMeta?.fromRun && !fromRun) {
  config.criteria = criteriaOfRun(fromRunDirOnResume);
  // Bug-audit fix, 2026-09-16: this branch restored the original run's criteria but never its
  // handed draft. A run started with `--from-run <X>` and NO separate `--draft` (the normal case
  // - `--from-run` alone already hands the earlier run's own build.md as the draft to review,
  // per this file's own comment above at handedDraft's first assignment) has `resumeMeta.draft`
  // as null, so line 991's `if (draftPath) handedDraft = ...` never fires on resume - the panel
  // then reviewed nothing-handed, i.e. built a brand-new draft from scratch, defeating
  // `--from-run`'s whole purpose for any run paused on an external seat. Restore it the same way
  // the original (non-resumed) `--from-run` branch above does, but only when no explicit
  // `--draft` is already set (never override draftPath's own value with fromRun's build.md).
  if (!draftPath) {
    handedDraft = readFileSync(join(fromRunDirOnResume, 'build.md'), 'utf8');
  }
}

// 7.x single-vendor mode: resolved once, before checkSeats and --dry-run both read config.seats,
// so a missing-key check and the resolution printout (the existing --dry-run output, which
// already lists each seat's provider/model) both see the real vendor routing rather than the
// direct-lab config on disk. A no-op for any chain that never sets `transport`.
config = resolveChainSeats(config);

// Every seat the run can call - including judge, challenger, coldRead, claims, ambiguity,
// descending, preflight and the default security reviewer, which a hand-kept list here missed
// (bug audit 2026-09-23, GuardLayer #2). policy.json and the missing-key check both read it.
const allSeats = everySeatOf(config);

// MLLM Coder v5 item 5: the checks the policy configured, for report.json's `policy` block. Set
// only when a policy was in force; recorded in run.json below because the gate is skipped on
// --resume, so a resumed run can only report what its first round actually enforced. That is a
// fact about a moment (the policy file may change later), which is why it is persisted rather
// than re-derived.
let policyChecks = null;

// v7.x item 1, COUNCIL-E005: the central policy file. No file at the locked path (work/
// policy.json) = today's behavior, byte-identical - this is the very first thing checked, and
// it changes nothing when absent. Skipped on --resume for the same reason lintChain is skipped
// above: the chain already proved runnable against this same policy on its first round. Runs
// before checkSeats/dryRun so a policy violation is caught before either a missing-key check or
// a price estimate - no provider is ever invoked either way, so ordering relative to those two
// doesn't change what gets spent, only what gets reported first.
// Pre-release audit 2026-09-23 (GuardLayer #4): this used to be skipped on --resume, while the
// chain itself is re-read on every sitting - so a seat added during a pause (e.g. a provider the
// policy forbids) was called on resume. The policy is evaluated on EVERY sitting now; a resume
// evaluates it against the run's own working directory.
{
  const { policy, error: policyParseError } = loadPolicy(resumeMeta?.cwd || work);
  if (policyParseError) {
    console.error(`\n${formatCouncilError('COUNCIL-E005', { path: POLICY_PATH(work), parseError: policyParseError })}`);
    process.exit(EXIT_FATAL);
  }
  if (policy) {
    const ctx = buildPolicyContext(config, allSeats, join(work, 'runs'));
    // MLLM Coder v4 item 4: the change request's target_file and the operator's signoff, so
    // required_signoff_paths can fire end to end. The task file is read here rather than at its
    // normal spot further down because the policy gate runs first. A task without a
    // `target_file:` line is not a change request, so the check passes exactly as before.
    // Signoff precedence: --signoff flag, then the task file's `signoff:` line.
    const taskText = taskPath && existsSync(resolve(work, taskPath)) ? readFileSync(resolve(work, taskPath), 'utf8') : '';
    const fields = parseChangeRequestFields(taskText);
    if (fields.target_file !== undefined) ctx.changeRequest = { target_file: fields.target_file };
    const signoff = signoffFlag || fields.signoff;
    if (signoff !== undefined) ctx.signoff = signoff;
    const { ok, reasons, checks } = evaluatePolicy(policy, ctx);
    policyChecks = checks;
    if (!ok) {
      console.error(`\n${formatCouncilError('COUNCIL-E005', { path: POLICY_PATH(work), chain: config.name, reasons })}`);
      process.exit(EXIT_POLICY_REFUSED);
    }
  }
}

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
// Where the task file is. A new run records it as an absolute path plus the directory it was
// started in, so a resume from anywhere finds it (2026-09-23 audit, CLI finding 5). An older
// run.json with a relative path is tried against its recorded cwd, else this directory. On
// resume, --task may point at the file's new location: its content is still checked against
// the run's stored hash below (frozen scope), so this can't swap in a different task.
const taskFile = !resumeMeta ? resolve(work, taskPathEff)
  : taskPath ? resolve(work, taskPath)
  : isAbsolute(resumeMeta.task) ? resumeMeta.task
  : resolve(resumeMeta.cwd || work, resumeMeta.task);
if (resumeMeta && !existsSync(taskFile)) {
  console.error(`\nThis run's task file isn't where run.json says: ${taskFile}`);
  console.error(`run.json records the task as "${resumeMeta.task}"${resumeMeta.cwd ? ` (started in ${resumeMeta.cwd})` : ' (relative, and this run predates recording its start directory)'}.`);
  console.error(`Resume from the directory the run was started in, or pass --task <path to the same task file>;`);
  console.error(`its content is checked against the run's stored hash, so it must be the same task.`);
  process.exit(1);
}
if (!existsSync(taskFile)) {
  console.error(`\nNo task file at ${taskFile}`);
  console.error(`The task file is the request the council plans against - plain prose, written by you.`);
  console.error(`Create one and run again, e.g.:\n`);
  console.error(`    mkdir -p tasks`);
  console.error(`    echo "What I want planned, in plain words." > ${taskPathEff}`);
  process.exit(1);
}
let request = readFileSync(taskFile, 'utf8');

// v5 item 2: a readable name for this run. Precedence: --label flag, then the task file's own
// `label:` line, then the task file's own basename with no input required. Only computed on a
// fresh start - a resumed run carries its label forward unchanged via run.json's spread below,
// since --label/the task file may have changed by the time someone resumes.
const labelFlagRaw = flag('label', null);
const labelFlagValue = typeof labelFlagRaw === 'string' ? labelFlagRaw : null;
const labelFieldMatch = request.match(/^label:[ \t]*(.*?)[ \t]*$/m);
const labelDefault = basename(taskPathEff).replace(/\.[^./]+$/, '');
const labelEff = labelFlagValue || (labelFieldMatch ? labelFieldMatch[1] : null) || labelDefault;

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
const contextArgRaw = resumeMeta ? resumeMeta.context : flag('context', null);
// Stored absolute in run.json (see startDir above); an older run's relative entries resolve against
// the directory it was started in.
const contextArg = contextArgRaw && contextArgRaw !== true
  ? String(contextArgRaw).split(',').map(x => x.trim()).filter(Boolean).map(e => resolve(startDir, e)).join(',')
  : contextArgRaw;
// CLI audit #1: what the artifact gate reads. The --context documents are standing direction, not
// artifacts the task claims to include, and the CLI itself writes a `## <file>.md` heading over each
// one - so gating them blocked every --context run at exit 9 (MCP start_run's `context` could never
// work, since MCP cannot pass --allow-unfenced). The gate reads the task text alone.
const requestForArtifactGate = request;
if (contextArg) {
  const files = [];
  for (const entry of String(contextArg).split(',').map(x => x.trim()).filter(Boolean)) {
    const p = entry;
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (f.endsWith('.md') && f !== 'README.md') files.push(join(p, f));
    } else files.push(p);
  }
  const docs = files.map(f => `## ${f.split('/').pop()}\n\n${readFileSync(f, 'utf8')}`).join('\n\n---\n\n');
  request += `\n\n---\n\n# Standing context - direction documents\n\nThese are the mission, the decisions already taken and the ideas parked for later, as the people running this project keep them. Plan within them. Do not restate them, do not re-decide anything they settle, and do not pull a parked idea into scope unless the request above asks for it. Where the request and a document conflict, the request wins and you say so under "Assumptions".\n\n${docs}`;
  console.log(`context: ${files.length} document(s) appended (${files.map(f => f.split('/').pop()).join(', ')})`);
}
// v7.x item 2: the PII/secrets pre-flight gate - strictly before any provider adapter is
// constructed and before a run folder is even created. Not invoked at all unless --pii-gate was
// passed (see flag parsing above). Bug-audit fix, 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md
// #3): it used to scan the task file alone, BEFORE --context was appended, and never the handed
// draft (--draft / --from-run) - both reach every seat. It now scans everything a seat will read.
// Pre-release audit 2026-09-23 (GuardLayer #3): the mode came from argv only and was not stored,
// so a resume (the pause hint, MCP resume) ran with no gate at all - while --context and --draft
// are re-read, so text added during a pause went to every seat unscanned. The mode and allow-list
// are saved in run.json on the first sitting and re-applied, with a fresh scan, on every sitting.
// A flag given on resume wins over the saved one.
const piiGateEff = piiGateMode !== null ? piiGateMode : (resumeMeta?.piiGate?.mode ?? null);
const piiAllowEff = piiGateMode !== null || piiAllow ? piiAllowList : (resumeMeta?.piiGate?.allow ?? []);
if (piiGateEff !== null) {
  const sources = [['the task file and --context documents', request], ['the handed draft (--draft / --from-run)', handedDraft]].filter(([, text]) => text);
  let blocked = false;
  for (const [where, text] of sources) {
    const scanResult = scanForPii(text, { allow: piiAllowEff });
    const { block, messages } = applyPiiGate(scanResult, piiGateEff);
    for (const m of messages) console.error(`  PII-GATE (${piiGateEff}): [${where}] ${m}`);
    if (block) {
      console.error(`\nPII-GATE: refusing to run - ${scanResult.findings.length} match(es) found in ${where} under --pii-gate hard-stop.`);
      blocked = true;
    }
  }
  if (blocked) {
    console.error(`Fix the input, or rerun with --pii-gate warn / --allow-pii <type,...> to proceed deliberately.`);
    process.exit(EXIT_PII_BLOCKED);
  }
}
// --run-id: the MCP server picks the folder name up front, so two start_run calls in the same
// instant can't both report the first folder that appeared (pre-release audit 2026-09-23,
// McpServer #2). Same character set the server's run-id check accepts.
const requestedRunId = flag('run-id', null);
if (requestedRunId !== null && (resumeMeta || !/^[0-9TZ-]+$/.test(requestedRunId))) {
  console.error(resumeMeta ? '--run-id: a resume keeps its own folder' : `--run-id: digits, T, Z and "-" only, got "${requestedRunId}"`);
  process.exit(2);
}
const runId = resumeMeta ? basename(resolve(resumeRun)) : (requestedRunId || new Date().toISOString().replace(/[:.]/g, '-'));
// A resume uses the folder it was pointed at. It used to rebuild the path as
// <cwd>/runs/<basename>, so resuming from another directory (an MCP-started run keeps an
// absolute task path) silently started a fresh folder and paid for every stage again
// (2026-09-23 audit, CLI finding 5).
const runDir = resumeMeta ? resolve(resumeRun) : join(work, 'runs', runId);
// A finished run is not resumable. Bug-audit fix, 2026-09-23 (Review/BugAudit_CLI_2026-09-23.md
// backlog): --resume on a run that already has report.json replayed its stages from disk only while
// the task and chain were unchanged; after a chain edit the cache went stale, every stage was paid
// for again, and report.json was overwritten. Refused before the run lock is taken, so a refusal
// never holds the folder. To run the same task again: a new run, --rematch or --replay.
if (resumeMeta && existsSync(join(runDir, 'report.json'))) {
  console.error(`\n--resume: ${runDir} already finished (it has a report.json). Nothing was run and nothing was spent.`);
  console.error(`To run this task again, start a new run with --task, or compare against it with --rematch ${resumeRun} / --replay ${resumeRun}.`);
  process.exit(EXIT_ALREADY_FINISHED);
}
// A new run never writes into an existing folder: two runs started in the same millisecond, or a
// reused --run-id, would otherwise share one.
if (!resumeMeta && existsSync(runDir)) {
  console.error(`\nrun folder ${runDir} already exists; a new run needs a new folder. Nothing was run and nothing was spent.`);
  process.exit(2);
}
mkdirSync(runDir, { recursive: true });
// One process per run folder, before any stage can spend: two resumes of the same run used
// to both pay for every uncached stage, each under its own cap (audit finding 4).
try {
  acquireRunLock(runDir);
} catch (err) {
  if (!(err instanceof RunLockedError)) throw err;
  console.error(`\n${err.message}`);
  process.exit(EXIT_RUN_LOCKED);
}

// 7.x item 5: audit export. `policy.json`'s documented, locked path is the user's own working
// directory (`work`, same resolution root as `.env` above) - a presence check only, item 1's own
// src/policy.js owns parsing that file, never duplicated here. Opt-in via `"audit": true` on a
// chain with no policy.json; inert (no audit.jsonl, no other change to the run folder) for
// everyone else. The writer is created even on resume, so a resumed run's remaining stages are
// still audited - only the stages already replayed from disk (onStage's `s.cached` check below)
// are skipped, same as every other per-stage artifact this callback already writes.
const auditEnabled = shouldEnableAudit({ config, policyPath: join(work, 'policy.json') });
let auditWriter = null;
if (auditEnabled) {
  let hmacKey = null;
  try {
    hmacKey = loadHmacKey({ runDir });
  } catch (err) {
    console.error(`\naudit: ${err.message}`);
    process.exit(EXIT_FATAL);
  }
  if (!hmacKey) console.error('\naudit: no AUDIT_HMAC_KEY or AUDIT_HMAC_KEY_FILE set - audit.jsonl will be written with signature: null on every line (unsigned, still hash-chained).');
  auditWriter = createAuditWriter({ runDir, run: runId, chain: chainNameEff, hmacKey });
}

// v6 item V6-2: one span-tree root per run, not per process - a resumed run keeps the same tree
// rather than starting a second, disconnected one each time it's resumed. Generated fresh only
// when the run has never carried one (a genuinely new run, or an older run.json from before this
// feature existed); once set it is spread forward on every resume below, unchanged.
const rootSpanId = resumeMeta?.rootSpanId || randomUUID();

if (!resumeMeta) {
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ chain: chainNameEff, task: taskFile, cwd: work, label: labelEff, context: contextArg || null, fromRun: fromRun ? resolve(fromRun) : null, draft: draftPath || null, rounds: config.maxRounds, maxUsd, taskHash, pid: process.pid, rootSpanId, ...(policyChecks ? { policyChecks } : {}), ...(piiGateEff !== null ? { piiGate: { mode: piiGateEff, allow: piiAllowEff } } : {}) }, null, 2));
} else {
  if (resumeMeta.rounds) config.maxRounds = resumeMeta.rounds;
  // v5 item 2: pid is rewritten on every resume - a resumed run is a new process. label and
  // every other field carry forward unchanged via the spread. v6 item V6-2: rootSpanId is
  // likewise carried forward (or set, the first time an older run.json is resumed under this
  // feature) rather than regenerated.
  // A --max-usd named on resume is saved, so the next sitting (the pause hint, MCP
  // submit_stage, resume_run without max_usd) keeps it instead of falling back to the old
  // cap - raised, the run stopped again at the old one; lowered, the next sitting went
  // back past it (audit finding 6).
  resumeMeta = { ...resumeMeta, pid: process.pid, rootSpanId, ...(argv.includes('--max-usd') ? { maxUsd } : {}), ...(piiGateEff !== null ? { piiGate: { mode: piiGateEff, allow: piiAllowEff } } : {}), ...(policyChecks ? { policyChecks } : {}) };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(resumeMeta, null, 2));
}

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
    process.exit(EXIT_SCOPE_CHANGED);
  }
  if (scopeCheck.amended) {
    // The new hash becomes this run's baseline going forward.
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...resumeMeta, taskHash }, null, 2));
    console.log(`task hash mismatch covered by a recorded amendment in ${amendmentsPath} - proceeding.`);
  }
}
// Stage cache: <label>.md holds the text, <label>.usage.json what it cost.
// Both are written as each stage completes, so a resume replays them.
const SUPERSEDED_HINT = (label, n) => n ? `superseded/${label}.${n}.*` : '(no files)';
const unverifiedReplays = [];
const cacheFingerprint = fingerprintInputs(rawTaskTextForCacheFingerprint, config);
// Pre-release audits (money path #2, resume-cache #1/#4): the getter no longer decides staleness by
// returning null - that threw the old answer's cost away. It returns what is on disk, flagged
// `staleInputs` when the task/config fingerprint differs, and invoke() in chain.js decides (it also
// compares the stage's prompt hash, which only it can compute). A stale stage is moved into
// superseded/ through `invalidate`, never overwritten. An external answer gets its prompt hash and
// fingerprint from `<label>.prompt.json`, written when the run paused to ask for it, since the
// operator (or submit_stage) writes only the answer.
setCache({
  get: label => {
    const t = join(runDir, `${label}.md`);
    if (!existsSync(t)) return null;
    let u = {};
    for (const f of [`${label}.prompt.json`, `${label}.usage.json`]) {
      if (!existsSync(join(runDir, f))) continue;
      // A torn or corrupt usage file used to throw here on every resume, until someone deleted it
      // by hand (bug audit 2026-09-23, CLI #8). It is a cache miss instead: the stage re-runs.
      try { u = { ...u, ...JSON.parse(readFileSync(join(runDir, f), 'utf8')) }; } catch {
        console.log(`  CACHE: ${f} is unreadable - treating "${label}" as not yet run.`);
        appendFileSync(join(runDir, 'WARNINGS.md'), `- cache_unreadable: ${f} could not be parsed; the stage was re-run\n`);
        return null;
      }
    }
    const staleInputs = !!u.inputsFingerprint && u.inputsFingerprint !== cacheFingerprint;
    return { text: readFileSync(t, 'utf8'), ...u, staleInputs, fromDisk: true };
  },
  // Pre-release cache audit #1: a replay that could only be checked coarsely is recorded, not silent.
  warn: (label, why) => {
    unverifiedReplays.push({ stage: label, why });
    appendFileSync(join(runDir, 'WARNINGS.md'), `- cache_unverified: stage "${label}" replayed - ${why}\n`);
  },
  invalidate: (label, why) => {
    const n = archiveSuperseded(runDir, label);
    appendFileSync(join(runDir, 'WARNINGS.md'), `- cache_stale: stage "${label}" invalidated - ${why}; the old files are kept as ${SUPERSEDED_HINT(label, n)}\n`);
  },
});
// Money path #4: charges that are not stages go to disk too, so --spend and a resume count them.
setChargeHook(c => recordLostCharge(runDir, c.label, c));
// A resumed run inherits the ceiling it was started under unless this
// invocation names a different one - otherwise resuming would silently drop
// the cap the run was created with.
const maxUsdEff = argv.includes('--max-usd') ? maxUsd
  : (resumeMeta && 'maxUsd' in resumeMeta) ? resumeMeta.maxUsd
  : maxUsd;
setBudget(maxUsdEff);
// Money path #2: what earlier sittings spent on stages that were later superseded still counts.
const earlierSupersededUsd = supersededSpendOf(runDir);
countEarlierSpend(earlierSupersededUsd);

// A previous sitting may have stopped this run at the ceiling. Clear that
// marker now that we are past it, so a run that goes on to finish is not
// still advertising itself as capped.
for (const f of ['STOPPED-budget.json', 'STOPPED-budget.md', 'STOPPED-error.md', 'STOPPED-truncated.json', 'STOPPED-truncated.md']) {
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
if (earlierSupersededUsd > 0) log(`spent earlier on superseded stages: ${formatUsd(earlierSupersededUsd)} (counted toward the cap; see superseded/)`);
log(`cap:   ${maxUsdEff === null ? 'none - this run has no spend ceiling' : `${formatUsd(maxUsdEff)} per run (--max-usd)`}`);
log(`task:  ${taskPathEff}`);

// v2 plan §6: before any stage runs, before a single metered API call, a static keyword
// check for the specific class of conflict this project already hit once (a chain requiring
// an appended section against text demanding a standalone document). Warns, never blocks.
//
// Bug-audit fix, 2026-09-23 (Review/BugAudit_CLI_2026-09-23.md #2): the whole block used to sit
// inside `if (!resumeMeta)`, so a run the artifact gate had blocked could simply be resumed - and
// its unfenced task then went through every seat. Its marker was also named NEEDS-ARTIFACTS.md,
// which run-status reads as an external pause, so MCP invited exactly that resume. The gate (free:
// no call is made) now runs on every start AND every resume, which also re-checks a task edited or
// amended in between; only the warnings are written once. The marker is BLOCKED-ARTIFACTS.md.
{
  // v3 §3: same call site, same warn-never-block posture, checking for a task that names a
  // file it never inlines verbatim rather than a section/criteria conflict.
  const contractWarnings = preflightCheck(config, request);
  const artifactFindings = checkArtifactReferences(requestForArtifactGate, { allow: unfencedAllowList });
  const preflightWarnings = [...contractWarnings, ...artifactFindings];
  if (preflightWarnings.length && !resumeMeta) {
    for (const w of preflightWarnings) log(`  PRE-FLIGHT WARNING: ${w.message}`);
    if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
    appendFileSync(join(runDir, 'WARNINGS.md'), preflightWarnings.map(w => `- pre_flight: ${w.message}\n`).join(''));
  }

  // 2026-09-20: the artifact check is a gate, not a warning. A task naming a file it never
  // fences sends every lab to guess at that file's contents, and they guess confidently -
  // the cheap-7 run shipped a false claim about a directory for exactly this reason, having
  // printed this same warning and run anyway. Exits BEFORE any metered call, so a blocked run
  // costs nothing. --allow-unfenced is the explicit override and is recorded in WARNINGS.md
  // above alongside the findings, so bypassing leaves a trace rather than erasing one.
  if (artifactFindings.length && !allowUnfenced) {
    const needsPath = join(runDir, ARTIFACTS_BLOCKED_FILE);
    writeFileSync(needsPath, [
      '# Missing artifacts',
      '',
      `This run stopped before its first API call. The task names ${artifactFindings.length} file(s)`,
      'whose contents it never includes, so no seat can read them:',
      '',
      ...artifactFindings.map(w => `- \`${w.path}\``),
      '',
      '## How to fix',
      '',
      'Fence the real content into the task file, so the run folder records exactly what was',
      'sent to each lab:',
      '',
      '```',
      `council fence --task <task.md> --repo <path> ${artifactFindings.map(w => w.path).join(' ')}`,
      '```',
      '',
      'Or, if a file is named only as a location and its contents genuinely do not matter,',
      'allow it explicitly - either `--allow-unfenced` for this run, or in the task front-matter',
      'so the decision travels with the task:',
      '',
      '```',
      '---',
      `unfenced-ok: [${artifactFindings.map(w => w.path).join(', ')}]`,
      '---',
      '```',
      '',
      'Everything fenced into the task is sent to every seat, and therefore to each lab behind',
      'them. Fence what the question needs answered, not the whole file, and never a secret.',
      '',
    ].join('\n'));
    log(`\n  BLOCKED: ${artifactFindings.length} file(s) named but never fenced. Wrote ${needsPath}`);
    log('  Nothing was called and nothing was spent. See that file for the two ways forward.');
    process.exit(EXIT_ARTIFACTS_BLOCKED);
  }
  // Passed this time (the task was fenced, or --allow-unfenced given): a marker left by an earlier
  // blocked sitting would otherwise keep the run reading as blocked.
  for (const f of [ARTIFACTS_BLOCKED_FILE, 'NEEDS-ARTIFACTS.md']) if (existsSync(join(runDir, f))) rmSync(join(runDir, f));
}

// v5 item 3: state.json, a live progress file rewritten atomically from files already on disk
// plus the in-flight stage - never read back as chain input (deleting it loses nothing). The
// classification/parsing logic itself is in src/run-state.js (pure, unit-tested with no CLI or
// process running); this block is the thin stateful wrapper: it owns the seat-status Map,
// installs chain.js's progressHook, and does the file I/O.
const seatState = new Map(
  [...(config.seats.proposers || []), ...(config.seats.critics || [])].map(s => [s.lab || s.provider, 'waiting']),
);
let currentStage = null;
let currentRound = 1;
// v6 item 2 (progress-spans.js): per-boundary start times, keyed so onStage/round-close can
// look up a real started_at instead of inventing one. Stage keys are the stage label (unique per
// progressHook 'startedAt' event); round keys are the round number, set once on that round's
// first panel/critique stage start and left alone afterward.
const stageStartedAt = new Map();
const roundStartedAt = new Map();

function applyStageCompletion(label, lab) {
  if (!lab) return;
  const r = parseRoundFromLabel(label);
  if (r) currentRound = r;
  const status = classifyStageCompletion(label);
  if (status) seatState.set(lab, status);
}

function writeStateJson() {
  const cost = sumCostFromStageLogText(existsSync(join(runDir, 'stage-log.jsonl')) ? readFileSync(join(runDir, 'stage-log.jsonl'), 'utf8') : '');
  const runMetaNow = { pid: process.pid, ...(resumeMeta || {}) };
  const state = {
    runId, label: labelEff,
    phase: deriveRunStatus(runDir, runMetaNow),
    stage: currentStage,
    round: currentRound, maxRounds: config.maxRounds,
    seats: [...seatState.entries()].map(([lab, status]) => ({ lab, status })),
    cost: { perLab: cost.perLab, spentUsd: cost.spentUsd, maxUsd: maxUsdEff },
    updatedAt: new Date().toISOString(),
  };
  const tmp = join(runDir, '.state.json.tmp');
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, join(runDir, 'state.json'));
}

// Rebuild seatState/round from whatever this run folder already recorded, so a --resume run's
// first state.json write (before any new stage even starts) reflects real history rather than
// a blank roster - stage-log.jsonl already exists for a resumed run's completed stages.
const existingStageLogText = existsSync(join(runDir, 'stage-log.jsonl')) ? readFileSync(join(runDir, 'stage-log.jsonl'), 'utf8') : '';
if (existingStageLogText) {
  for (const line of existingStageLogText.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.kind) continue;
    applyStageCompletion(entry.stage, entry.lab);
  }
}
// V6-2: same replay-from-disk reconstruction as seatState above, so a round left partially
// complete before a pause closes correctly once its remaining critics report post-resume,
// instead of starting a second, disconnected span for a round already in progress.
const { roundSpanIds, roundPanelCounts } = replaySpanStateFromStageLogText(existingStageLogText);
const criticsCount = (config.seats?.critics || []).length;

// v5 item 3, touch point 1's receiver: chain.js calls this once per real paid call, right
// before it goes out, and a second time per critique/panel/reply stage once its verdict is
// parsed (touch point 2) - see src/chain.js's progressHook call sites for the exact payloads.
setProgressHook(event => {
  if (event.startedAt) {
    currentStage = { label: event.label, lab: event.lab, startedAt: event.startedAt };
    seatState.set(event.lab, 'working');
    stageStartedAt.set(event.label, event.startedAt);
    const r = parseRoundFromLabel(event.label);
    if (r) {
      currentRound = r;
      if (!roundStartedAt.has(r)) roundStartedAt.set(r, event.startedAt);
    }
  } else {
    const status = classifyVerdictEvent(event, seatState.get(event.lab));
    if (status) seatState.set(event.lab, status);
    // V6-2: checked here, not in onStage's stage-file writer - chain.js posts a panel stage's
    // 'verdict' progressHook event (touch point 2) strictly after that stage's own onStage/
    // record() call (touch point 1) already ran, so seatState wouldn't yet reflect the very
    // critic whose verdict just closed the round if this ran at onStage time instead. Checking
    // here means the round record's seats[] snapshot always includes every critic's real,
    // just-posted status - never "working" for the seat that only just finished.
    const closedRound = recordRoundStageAndCheckClose(event.label, roundPanelCounts, criticsCount);
    if (closedRound) {
      const roundSeats = (config.seats?.critics || []).map(c => {
        const lab = c.lab || c.provider;
        return { lab, status: seatState.get(lab) || 'unknown' };
      });
      const stageLogPath = join(runDir, 'stage-log.jsonl');
      const spentUsd = sumRoundUsdFromStageLogText(existsSync(stageLogPath) ? readFileSync(stageLogPath, 'utf8') : '', closedRound);
      appendFileSync(stageLogPath, `${JSON.stringify({
        kind: 'round', round: closedRound,
        span_id: roundSpanIds.get(closedRound), parent_span_id: rootSpanId,
        seats: roundSeats, spentUsd,
      })}\n`);
      // v6 item 2: this round's own boundary in spans.jsonl. cost_so_far is real (derived from
      // the stage-log.jsonl text, which this call just re-read after the line above appended to
      // it) - not a placeholder, since the cumulative cost is already computable at this point.
      const roundStart = roundStartedAt.get(closedRound) ?? null;
      appendSpanRecord(runDir, buildSpanRecord({
        runId, stage: `round-${closedRound}`, round: closedRound,
        seatsParticipating: roundSeats.map(s => s.lab),
        startedAt: roundStart,
        startedAtReason: roundStart == null ? 'no panel/critique stage start observed for this round before it closed' : undefined,
        endedAt: new Date().toISOString(),
        outcome: 'closed',
        costSoFar: sumCostFromStageLogText(readFileSync(stageLogPath, 'utf8')).spentUsd,
      }));
    }
  }
  writeStateJson();
});
writeStateJson();

log(resumeMeta ? `resume: stages already on disk replay for free` : '');
// One run's tool calls, for TOOLS.md below (the log lives in tools.js's memory).
resetToolCallLog();
let result;
try {
  result = await runChain({
    request,
    config,
    draft: handedDraft,
    log,
    // Stable across --resume (the folder name), so run-level decisions such as the canary roll
    // are made once per run, not once per sitting.
    runId,
    onStage: s => {
      // v5 item 3: the in-flight stage just finished (cached or not - a cache hit on resume is
      // still "no longer in flight"), so it's cleared here regardless of the cached early
      // return just below, which only skips the older, non-state.json side effects that are
      // already on disk for a cache hit.
      currentStage = null;
      applyStageCompletion(s.label, s.lab);
      writeStateJson();
      if (s.cached) {
        // Pre-release cache audit #1: a trusted hit gets the hash of the prompt it was just matched
        // against written back, so an entry cached before prompt hashes existed is checked properly
        // from the next resume on.
        const up = join(runDir, `${s.label}.usage.json`);
        if (s.promptHash && existsSync(up)) {
          try {
            const u = JSON.parse(readFileSync(up, 'utf8'));
            if (!u.promptHash) writeFileAtomic(up, JSON.stringify({ ...u, promptHash: s.promptHash, inputsFingerprint: u.inputsFingerprint ?? cacheFingerprint }));
          } catch { /* unreadable: the getter already treats it as a miss next time */ }
        }
        return;
      }
      // v2 plan §7.1: validate against the stage contract's required_sections before
      // trusting this deliverable - same class of bug as the lab-dropout fix, just one
      // stage later in the pipeline. Warns loudly and records it; does not, and cannot
      // from here, change chain.js's own in-run control flow (§11: mechanism untouched).
      const kind = stageKindOf(s.label);
      if (kind) {
        const check = validateDeliverable(kind, s.text, s.usage);
        if (!check.ok) {
          log(`  PARTIAL OUTPUT WARNING: stage "${s.label}" (${kind}) - ${check.reason}`);
          appendFileSync(join(runDir, 'WARNINGS.md'), `- partial_output: stage "${s.label}" (${kind}) - ${check.reason}\n`);
        }
      }
      // Both written atomically (temp file + rename), cost first and text last: `<label>.md` is what
      // marks a stage done, so a crash between the two leaves a stage that re-runs rather than a
      // text trusted with no record of its cost, and a crash mid-write never leaves a torn file
      // for a resume to trip over (bug audit 2026-09-23, CLI #8).
      writeFileAtomic(join(runDir, `${s.label}.usage.json`), JSON.stringify({ provider: s.provider, model: s.model, usage: s.usage, usd: s.usd, ms: s.ms, inputsFingerprint: cacheFingerprint, promptHash: s.promptHash }));
      writeFileAtomic(join(runDir, `${s.label}.md`), s.text);
      if (auditWriter) auditWriter.recordStage(s);
      // v5 §1 candidate 14: one JSONL line per stage, alongside the existing markdown/usage
      // artifacts - structured so future tooling (candidate #9's replay, #2's independence
      // report) can read a run without re-parsing prose. No prompt content, same privacy
      // posture as verdict-stats.js: seat/lab/counts/cost/timing only.
      // V6-2: span_id/parent_span_id turn this flat log into a span tree - every panel/critique
      // stage's parent is its enclosing round's span, everything else's parent is the run root
      // (src/spans.js resolves which).
      appendFileSync(join(runDir, 'stage-log.jsonl'), `${JSON.stringify({
        stage: s.label, seat: `${s.provider}/${s.model}`, lab: s.lab,
        tokensIn: s.usage?.input ?? 0, tokensOut: s.usage?.output ?? 0,
        usd: s.usd, ms: s.ms, outcome: s.text ? 'ok' : 'empty',
        span_id: randomUUID(), parent_span_id: resolveParentSpanId(s.label, rootSpanId, roundSpanIds, randomUUID),
      })}\n`);
      // v6 item 2: this stage's own boundary in spans.jsonl - a separate, purely additive file
      // (src/progress-spans.js), not a rename/replacement of stage-log.jsonl above. started_at is
      // the real timestamp progressHook recorded when this stage began (absent only if this
      // stage's start event was never observed, e.g. a resumed cache-hit path that returns before
      // reaching here - that early-return already skips this whole block, so in practice this is
      // always real for a line that gets written). cost_so_far is real, re-derived from the
      // stage-log.jsonl text this call just appended to, same "derive, never record twice"
      // precedent audit.js/spend.js already use - not a placeholder.
      const stageStart = stageStartedAt.get(s.label) ?? null;
      appendSpanRecord(runDir, buildSpanRecord({
        runId, stage: s.label, round: parseRoundFromLabel(s.label),
        seatsParticipating: [s.lab || `${s.provider}/${s.model}`],
        startedAt: stageStart,
        startedAtReason: stageStart == null ? 'no progressHook startedAt event observed for this stage label' : undefined,
        endedAt: new Date().toISOString(),
        outcome: s.text ? 'ok' : 'empty',
        costSoFar: sumCostFromStageLogText(readFileSync(join(runDir, 'stage-log.jsonl'), 'utf8')).spentUsd,
      }));
      stageStartedAt.delete(s.label);
      // v2 plan §5: regenerate at every stage-completion boundary, always from
      // disk state, never itself trusted as the source of truth.
      writeFileSync(join(runDir, 'RESUME.md'), generateResumeBrief({ runId, dir: runDir, runMeta: { chain: chainNameEff, task: taskPathEff }, chainConfig: config }));
    },
  });
} catch (err) {
  if (err instanceof PreflightBlocked) {
    // Same posture as BudgetExceeded below: deliberately no report.json/deliverable.md - a
    // preflight objection means propose/build never ran, so there is no deliverable to report
    // on. preflight-verdict.json is its own artifact and is written whether or not the run
    // blocks (a resumed/fixed task file re-runs preflight fresh, same as any other stage).
    writeFileSync(join(runDir, 'preflight-verdict.json'), JSON.stringify(err.preflight, null, 2));
    const objections = err.preflight.verdicts.filter(v => v.verdict === 'object' && v.objections.length);
    writeFileSync(join(runDir, 'STOPPED-preflight.md'), `# Run stopped: preflight objected to the task description

This run stopped before \`criteria\`/\`proposals\`/\`build\` ever ran - no diff or proposal exists
for this run.

${objections.map(v => `- **${v.lab}**: ${v.objections.join(' / ')}`).join('\n')}

Fix the task description (this run's own task file, not a diff), then re-run. Nothing here is
resumable via \`--resume\` the way an \`ExternalPause\` is, since no stage after preflight ever
started.
`);
    log(`\nSTOPPED: preflight objected to the task description (${objections.length} seat(s)).`);
    log(`  detail:  ${join(runDir, 'STOPPED-preflight.md')}`);
    log(`  verdict: ${join(runDir, 'preflight-verdict.json')}`);
    process.exit(EXIT_PREFLIGHT_BLOCKED);
  }
  if (err instanceof DraftTruncated) {
    // Same posture as the budget and preflight stops: no report.json and no deliverable.md, so a
    // stopped run never reads as a finished one. The cut-off replies are on disk under their own
    // labels for inspection. A resume replays them from disk and stops again until the chain gives
    // that seat a larger maxTokens (which changes the chain, so the stage is asked again) or the
    // external reply is replaced with a complete one.
    const stopped = { stage: err.label, detail: err.detail, spentUsd: budgetState().spent };
    writeFileSync(join(runDir, 'STOPPED-truncated.json'), JSON.stringify(stopped, null, 2));
    writeFileSync(join(runDir, 'STOPPED-truncated.md'), `# Run stopped: a draft was cut off at its token cap

Stage \`${err.label}\` produced a reply that ended at the seat's token limit: ${err.detail}.

A cut-off draft is never graded, reported or shipped. Nothing after this stage ran, and there is no
\`report.json\` or \`deliverable.md\` for this run.

To continue: raise that seat's \`maxTokens\` in the chain (or, for an external seat, replace
\`${err.label}.md\` with a complete reply), then \`--resume\` this run.
`);
    log(`\nSTOPPED: stage "${err.label}" was cut off at its token cap - ${err.detail}.`);
    log(`  detail:  ${join(runDir, 'STOPPED-truncated.md')}`);
    process.exit(EXIT_DRAFT_TRUNCATED);
  }
  if (err instanceof ExternalPause) {
    const need = join(runDir, `NEEDS-${err.label}.md`);
    // The prompt this answer will be held to on resume (resume-cache audit #1/#4).
    writeFileAtomic(join(runDir, `${err.label}.prompt.json`), JSON.stringify({ provider: 'external', promptHash: err.promptHash, inputsFingerprint: cacheFingerprint }));
    writeFileSync(need, withIntegrityFooter(`# External stage: ${err.label}\n\nWrite the reply to \`${join(runDir, `${err.label}.md`)}\` and run:\n\n    council --resume runs/${runId}\n\n## System prompt\n\n${err.system}\n\n## User prompt\n\n${err.user}`));
    log(`\nPAUSED: stage "${err.label}" is an external seat.`);
    log(`  prompt:  ${need}`);
    log(`  answer:  write ${join(runDir, `${err.label}.md`)}`);
    log(`  resume:  council --resume runs/${runId}`);
    process.exit(3);
  }
  if (err instanceof BudgetExceeded) {
    // Deliberately NO report.json and NO deliverable.md: a run folder that
    // carries those reads as a finished run everywhere else in this codebase.
    // What lands instead says plainly that the run stopped short.
    const state = budgetState();
    // Money path #1: the budget after the in-flight siblings settled, not err.spent from the moment
    // the cap was hit (see writeSideRunBudgetStop).
    err.spent = Math.max(err.spent || 0, state.spent);
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

    council --resume runs/${runId} --max-usd ${(Math.ceil((err.cap + err.projected) * 100) / 100).toFixed(2)}

Or \`--max-usd none\` to continue with no ceiling.
`);
    log(`\nSTOPPED: per-run spend cap reached before stage "${err.label}".`);
    log(`  spent:   ${formatUsd(err.spent)} of ${formatUsd(err.cap)} ceiling`);
    log(`  stage:   ${err.seat} could cost up to ${formatUsd(err.projected)}`);
    log(`  detail:  ${join(runDir, 'STOPPED-budget.md')}`);
    log(`  resume:  council --resume runs/${runId} --max-usd <higher>`);
    process.exit(4);
  }
  // A denied model is a lint failure (exit 1), found at run time instead of by chain-lint.
  const denied = err instanceof DeniedModel;
  writeFileSync(join(runDir, 'STOPPED-error.md'), `# Run stopped: ${denied ? 'a denied model' : 'an error'}

${err?.message || String(err)}

No report.json or deliverable.md was written, so this run does not read as finished. Completed
stages are on disk and replay for free: fix the cause, then

    council --resume runs/${runId}
`);
  appendFileSync(logPath, `${err?.stack || String(err)}\n`);
  log(`\nSTOPPED: ${denied ? 'a denied model' : 'the run failed'} - ${err?.message || String(err)}`);
  log(`  detail:  ${join(runDir, 'STOPPED-error.md')}`);
  process.exit(denied ? 1 : EXIT_RUN_FAILED);
}

writeFileSync(join(runDir, 'deliverable.md'), result.deliverable);
if (result.proposalPool?.length && result.proposalPool.length > result.proposals.length) {
  writeFileSync(join(runDir, 'proposals-pool.md'), `# Every proposal every lab wrote (${result.proposalPool.length}); "kept" ones went to the builder\n\n` + result.proposalPool.map(p =>
    `## ${p.kept ? 'KEPT' : 'dropped'} - ${p.lab}/${p.model}, attempt ${p.attempt}\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`).join('\n\n'));
}
// §5 (v3 plan): declined objections are a first-class record, never part of the deliverable text
// itself, so they get their own section wherever the board already lives - the same file that
// already lists proposals and debate posts (or a standalone one, if no debate happened this run).
const boardMd = renderBoardMd({ runId, result });
if (boardMd) writeFileSync(join(runDir, 'BOARD.md'), boardMd);
if (result.handoff) writeFileSync(join(runDir, 'HANDOFF.md'), result.handoff);
// "How this plan was argued" (src/argued.js): its own file next to the deliverable, never inside it,
// and every id or lab it names that the run never had goes to WARNINGS.md as well as report.json.
if (result.argued) {
  writeFileSync(join(runDir, result.argued.file), result.argued.text);
  const lines = arguedWarnings(result.argued.check);
  if (lines.length) {
    if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
    appendFileSync(join(runDir, 'WARNINGS.md'), lines.map(l => `- ${l}\n`).join(''));
  }
}
// v4 item 2: written on every run that had a preflight config, blocked or not - the blocked
// path also writes this same file from the PreflightBlocked catch above, before this line is
// ever reached, so this covers only the non-blocking case.
if (result.preflight) writeFileSync(join(runDir, 'preflight-verdict.json'), JSON.stringify(result.preflight, null, 2));
// v4 item 3: its own artifact, separate from report.json's pre-build `ground_truth` - a chain
// without config.verify_post never has this key, so this line never runs for it.
if (result.ground_truth_post) writeFileSync(join(runDir, 'verify-post.json'), JSON.stringify(result.ground_truth_post, null, 2));
// Final security-review gate: its own artifact, written whether the gate passed or not.
if (result.security_review) writeFileSync(join(runDir, 'security-review.json'), JSON.stringify(result.security_review, null, 2));
if (result.proposals?.length) {
  writeFileSync(join(runDir, 'proposals.md'), result.proposals.map(p =>
    `## ${p.id} (${p.lab}/${p.model})\n**Title:** ${p.title}\n**Serves:** ${p.serves}\n**What:** ${p.what}\n**Why:** ${p.why}\n**How:** ${p.how}\n**Acceptance test:** ${p.acceptance_test}`).join('\n\n'));
}
// v7.x: lint failures and dropped claims are informational, same WARNINGS.md the pre_flight/
// cache_stale/partial_output warnings above already append to - never a reason to fail the run.
if (result.lints?.length || result.claimWarnings?.length || result.toolRequestWarnings?.length) {
  if (!existsSync(join(runDir, 'WARNINGS.md'))) writeFileSync(join(runDir, 'WARNINGS.md'), '# Warnings\n\n');
  appendFileSync(join(runDir, 'WARNINGS.md'), (result.lints || []).map(l => `- lint (${l.id}): ${l.message}\n`).join(''));
  appendFileSync(join(runDir, 'WARNINGS.md'), (result.claimWarnings || []).map(w => `- claim: ${w}\n`).join(''));
  // v7.x item 3: seat-requested tool calls that exceeded the per-stage cap, or named a
  // disallowed tool, same WARNINGS.md the lint/claim lines above already append to.
  appendFileSync(join(runDir, 'WARNINGS.md'), (result.toolRequestWarnings || []).map(w => `- tool_request: ${w}\n`).join(''));
}
// Money path #2: the report's total includes what superseded stages cost (they were paid for, in
// this sitting or an earlier one), shown separately as totals.supersededUsd.
{
  const supersededUsd = supersededSpendOf(runDir);
  if (unverifiedReplays.length) result.unverifiedReplays = unverifiedReplays;
  if (supersededUsd > 0) result.totals = { ...result.totals, usd: (result.totals.usd || 0) + supersededUsd, supersededUsd };
}
// TOOLS.md: every tool call this sitting made, after redaction (pre-release audit 2026-09-23,
// FenceToolsRedaction #7 - the log was collected and never written). Appended, so a resumed run
// keeps every sitting's calls.
{
  const toolsMd = renderToolsMd();
  if (toolsMd) appendFileSync(join(runDir, 'TOOLS.md'), `${toolsMd}\n`);
}
writeFileSync(join(runDir, 'report.json'), JSON.stringify(reportJsonShape({
  runId, chain: config.name, task: taskPathEff, result, config,
  fromRun: fromRun || resumeMeta?.fromRun || null, maxUsd: maxUsdEff,
  policyChecks: policyChecks ?? resumeMeta?.policyChecks ?? null,
}), null, 2));
// v5 item 3: one last write now that report.json exists on disk, so `phase` in state.json
// reflects `done` rather than staying on whatever it said mid-run (`deriveRunStatus` checks
// report.json first; without this call, a completed run's state.json would show "running"
// forever, since nothing else touches it after the last stage's own onStage-triggered write).
currentStage = null;
writeStateJson();
// report.json existing is this codebase's own definition of "finished" (STOPPED-budget.json's
// comment above says so explicitly) - the audit chain closes here, not in a finally block, so a
// paused or budget-stopped run's audit.jsonl is correctly left without a close line.
if (auditWriter) auditWriter.close();
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
const boardWritten = !!boardMd;
log(`output:   ${join(runDir, 'deliverable.md')}${result.handoff ? `  (+ HANDOFF.md${boardWritten ? ', BOARD.md' : ''})` : boardWritten ? '  (+ BOARD.md)' : ''}`);
if (result.argued) log(`argued:   ${join(runDir, result.argued.file)}${result.argued.check.ok ? '' : '  (names things the run never had - see WARNINGS.md)'}`);
// Final security-review gate. Checked last, after every artifact (report.json, state.json, the
// audit close, RESUME.md) is on disk, so a failed gate still leaves a complete, readable run
// folder. Exit 7 = blocked, 8 = not judged; both are failures a caller must not treat as a pass.
if (result.security_review) {
  const sr = result.security_review;
  log(`security: ${sr.gate} - ${sr.seat}, ${sr.findings.length} finding(s), ${sr.blocking_count} blocking${sr.reason_code ? ` (${sr.reason_code})` : ''} - ${join(runDir, 'security-review.json')}`);
  for (const f of sr.findings.filter(f => BLOCKING_SEVERITIES.includes(f.severity))) {
    log(`  - [${f.severity}] ${f.category} ${f.file ?? '?'}:${f.line ?? '?'} - ${f.problem ?? f.evidence}`);
  }
  if (sr.gate === 'blocked') process.exit(EXIT_SECURITY_BLOCKED);
  if (sr.gate === 'not_judged') process.exit(EXIT_SECURITY_NOT_JUDGED);
}

}
// end of the non-MCP path (see the --mcp branch at the top of this file)
