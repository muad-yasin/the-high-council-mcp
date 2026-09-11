#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, checkSeats, setCache, setBudget, budgetState, ExternalPause, BudgetExceeded } from './chain.js';
import { summarise, formatUsd, priceOf } from './cost.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// Minimal .env loader. No dependency for four lines of parsing.
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return (next && !next.startsWith('--')) ? next : true;
}

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
  council --task tasks/x.md --max-usd 2 stop the run before any stage that could
                                       take it past $2. Default $5, or
                                       MAX_USD_PER_RUN. --max-usd none disables
                                       the ceiling. A stopped run resumes with
                                       --resume and a higher ceiling; stages
                                       already on disk replay for free.

Chains live in chains/*.json. Runs are written to runs/<timestamp>/.
The 'relay' command is kept as an alias for 'council'; both run this file.`);
  process.exit(taskPath ? 0 : 1);
}

// --resume: everything about the run comes from its own run.json.
let resumeMeta = null;
if (resumeRun) {
  resumeMeta = JSON.parse(readFileSync(join(resolve(resumeRun), 'run.json'), 'utf8'));
}
const chainNameEff = resumeMeta?.chain || chainName;
const configPath = join(root, 'chains', `${chainNameEff}.json`);
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
if (draftPath) handedDraft = readFileSync(resolve(root, draftPath), 'utf8');
if (resumeMeta?.fromRun && !fromRun) {
  const rp = join(resolve(root, resumeMeta.fromRun), 'report.json');
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
  const a = config.estimate || { promptTokens: 4000, draftTokens: 6000, critiqueTokens: 1200 };
  console.log(`\nChain: ${config.name} - ${config.description}`);
  console.log(`Rounds: ${config.maxRounds}\n`);
  const rows = [];
  const push = (label, seat, input, output) => {
    if (!seat) return;
    const p = seat.provider === 'external' ? { in: 0, out: 0 } : priceOf(seat.provider, seat.model);
    const usd = p ? (input / 1e6) * p.in + (output / 1e6) * p.out : 0;
    rows.push({ label, seat: `${seat.provider}/${seat.model}`, input, output, usd, priced: !!p });
  };
  if (config.questions && !fromRun) push('questions', config.seats.questions || config.seats.criteria, a.promptTokens, 800);
  // A chain with hand-written criteria skips that stage entirely.
  if (!config.criteria?.length) push('criteria', config.seats.criteria, a.promptTokens, 400);
  let proposalTokens = 0;
  if (config.proposals && !fromRun) {
    const parts = config.proposals.parts ?? 3, per = config.proposals.maxTokens ?? 1500;
    push('skeleton', config.seats.skeleton || config.seats.builder, a.promptTokens + 400, 1200);
    const samples = config.proposals.samples ?? 1, keep = config.proposals.keep ?? parts;
    for (const seat of config.seats.proposers || config.seats.critics) {
      for (let k = 0; k < samples; k++) push(`propose-${seat.lab || seat.provider}${samples > 1 ? `-${k + 1}` : ''}`, seat, a.promptTokens + 1600, parts * per);
      if (samples > 1) push(`judge-${seat.lab || seat.provider}`, config.seats.judge || seat, a.promptTokens + 1600 + samples * parts * per, 300);
      proposalTokens += (samples > 1 ? keep : parts) * per;
    }
  }
  if (config.debate && !fromRun) {
    for (const seat of config.seats.proposers || config.seats.critics) {
      push(`debate-${seat.lab || seat.provider}`, seat, a.promptTokens + 1600 + proposalTokens, 1500);
      push(`reply-${seat.lab || seat.provider}`, seat, a.promptTokens + 3000, 800);
    }
    proposalTokens += proposalTokens; // the board roughly doubles what the builder reads
  }
  if (!fromRun) push('build', config.seats.builder, a.promptTokens + 400 + proposalTokens, a.draftTokens);
  const unanimous = config.signoff === 'unanimous';
  for (let r = 1; r <= config.maxRounds; r++) {
    if (unanimous) {
      for (const critic of config.seats.critics) {
        push(`panel-${r}-${critic.lab || critic.provider}`, critic, a.promptTokens + a.draftTokens, a.critiqueTokens);
      }
    } else {
      const critic = config.seats.critics[(r - 1) % config.seats.critics.length];
      push(`critique-${r}`, critic, a.promptTokens + a.draftTokens, a.critiqueTokens);
    }
    if (r < config.maxRounds) push(`revise-${r}`, config.seats.reviser || config.seats.builder, a.promptTokens + a.draftTokens + a.critiqueTokens + proposalTokens, a.draftTokens);
  }
  push('final', config.seats.finalist, a.promptTokens + a.draftTokens, a.draftTokens);
  if (config.handoff) push('handoff', config.seats.handoff || config.seats.builder, a.promptTokens + a.draftTokens, 1200);
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
  console.error(`Fill them in ${envPath} (copy .env.example), or pick a chain that uses fewer labs.`);
  process.exit(1);
}

const taskPathEff = resumeMeta?.task || taskPath;
const taskFile = resolve(root, taskPathEff);
if (!existsSync(taskFile)) {
  console.error(`\nNo task file at ${taskFile}`);
  console.error(`The task file is the request the council plans against - plain prose, written by you.`);
  console.error(`Create one and run again, e.g.:\n`);
  console.error(`    mkdir -p tasks`);
  console.error(`    echo "What I want planned, in plain words." > ${taskPathEff}`);
  process.exit(1);
}
let request = readFileSync(taskFile, 'utf8');
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
const runDir = join(root, 'runs', runId);
mkdirSync(runDir, { recursive: true });
if (!resumeMeta) {
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ chain: chainNameEff, task: taskPathEff, context: contextArg || null, fromRun: fromRun || null, draft: draftPath || null, rounds: config.maxRounds, maxUsd }, null, 2));
} else if (resumeMeta.rounds) config.maxRounds = resumeMeta.rounds;
// Stage cache: <label>.md holds the text, <label>.usage.json what it cost.
// Both are written as each stage completes, so a resume replays them.
setCache({
  get: label => {
    const t = join(runDir, `${label}.md`);
    if (!existsSync(t)) return null;
    const u = existsSync(join(runDir, `${label}.usage.json`)) ? JSON.parse(readFileSync(join(runDir, `${label}.usage.json`), 'utf8')) : {};
    return { text: readFileSync(t, 'utf8'), ...u };
  },
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
      writeFileSync(join(runDir, `${s.label}.md`), s.text);
      writeFileSync(join(runDir, `${s.label}.usage.json`), JSON.stringify({ provider: s.provider, model: s.model, usage: s.usage, usd: s.usd, ms: s.ms }));
    },
  });
} catch (err) {
  if (err instanceof ExternalPause) {
    const need = join(runDir, `NEEDS-${err.label}.md`);
    writeFileSync(need, `# External stage: ${err.label}\n\nWrite the reply to \`${join(runDir, `${err.label}.md`)}\` and run:\n\n    node src/cli.js --resume runs/${runId}\n\n## System prompt\n\n${err.system}\n\n## User prompt\n\n${err.user}\n`);
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
