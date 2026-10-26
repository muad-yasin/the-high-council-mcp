// `council tree start --task <file> --chain <root chain> --child-chain <name> --max-usd <usd>` (0.8.3 M6 S5; PLAN 8.3 step 0, 10.1, 10.3). The person's one explicit request that makes a recursive-councils tree: it makes the
// ROOT run folder, writes the tree's record, registers the root with the WHOLE cap as its grant and runs the root as an ordinary run (`--tree-node`), in the foreground, like `tree resume`.
//
// Contract: startHandler({ flags, work, stdin, stdout, stderr, now, deps }) -> exit code
//   0 the root run finished        1 a thing named cannot be used (task, chain) / another sitting holds the tree / the root could not be started
//   5 a seat of the root or child chain has no price row (refused under the cap, as a normal run is)
//   2 usage: a required option is missing, or --max-usd is not a finite number above 0 (`none` is refused: a tree needs a finite cap)
//   2 also (15 Oct 2026, TREE CEILING): on a PAID tree (either chain has a paid seat) --max-usd above COUNCIL_MAX_USD_LIMIT, or that variable set and unreadable / an unfilled host placeholder; asked LAST, after the dry-run return and the key, price-row and key-scan refusals, before anything is written (src/tree-ceiling.js)
//   --dry-run (ROADMAP 56, src/tree-projection.js): the checks up to where a normal run's dry run exits (options, task, chain files, lint, milestones, policy), then the PROJECTED cost of a tree on the two chains, exit 0. It makes no run id, folder, lock or
//     record, starts nothing, asks no key, no key scan, no personal-data check, and needs no --max-usd (checked as always when given). Its refusals are start's own, same text and exit code.
//   3 the root paused at an external seat   4 the root stopped at its cap   19 the tree refused the root's start   anything else: the root run's own exit code, named
//   Nothing is written, no folder is made and nothing is spent before every check below has passed. REQUIRED options are the handler's refusals (one per missing option, in the order task, chain, child-chain, max-usd);
//   the parser (src/tree-cli.js) accepts a bare `start`.
// State written, in this order, each durable before the next: runs/<id>/tree/ (a folder), the sitting lock tree/.sitting.lock (held to the end, so a `tree resume` on the same tree finds it held and starts nothing),
// tree.json + `tree_started`, the root's lineage file tree/inputs/R@g1/node.json, ONE `node_registered` for R (generation 1, grant == the cap, no `grant_issued`), then the root's run folder (written by its own CLI).
// The lineage file is NOT an input bundle (the generation-1 root has no bundleSha256): nothing may hash-check it as one (test/tree-start.test.js pins that).
// No decision here is made by a model: the options are the person's, the figures come from the chain files, the cap is the person's number. This file reads no environment variable itself and parses no argument
// (src/tree-cli.js hands it the parsed flags); the key check goes through src/run-preflight.js and src/providers.js keyFor (src/key-env.js), exactly as the root run's own CLI does.
// The task is pinned in tree.json (rootTask: src/tree-task-pin.js) so a root that never ran still has its task on record.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from './api.js';
import { isChainName, outdatedChainHint } from './chain-name.js';
import { isDeniedPath } from './tools.js';
import { RunLockedError, acquireRunLock } from './run-lock.js';
import { SITTING_LOCK_FILE } from './tree-run.js';
import { fileProblemLine, writeTreeFiles } from './tree-files.js';
import { chainIsPaid } from './start-scope.js';
import { typedCeilingRefusal } from './tree-ceiling.js';
import { bundleDirOf, configSha256, limitsOnlyWords } from './tree-continuation.js';
import { limitFreeSha256Of, priceLimitsOf } from './price-limits.js';
import { DEFAULT_LIMITS, readTreeRecord, startTree, stateOf, treeDirOf } from './tree-record.js';
import { projectTree, projectionLines } from './tree-projection.js';
import { registerRoot } from './tree-register.js';
import { DEFAULT_BUNDLE_ALLOWANCE_BYTES, budgetOf, effectiveCapUsd, lifetimeCapOf } from './tree-budget.js';
import { TREE_FIELDS } from './tree-member.js';
import { terminalSafe } from './terminal-safe.js';
import { unpricedSeats } from './unpriced.js';
import { formatCouncilError } from './errors.js';
import { formatUsd } from './cost.js';
import { everySeatOf, resolveChainSeats } from './chain.js';
import { chainLintLines, inputSecretFindings, missingKeyLines, piiGateReport, policyGate, policyRefusalText, secretScanRefusalLines } from './run-preflight.js';
import { TREE_PII_ALLOW_TYPES, TREE_PII_MODES, piiAllowProblem, treePiiModeFrom } from './tree-pii-mode.js';
import { DENIED_TASK_WORDS, checkRootTaskPin, makeRootTaskPin, rootTaskPinFrom } from './tree-task-pin.js';
import { nextRunId } from './run-files.js';   // the one run id generator, as an ordinary run makes its ids

const PKG_CHAINS = join(dirname(fileURLToPath(import.meta.url)), '..', 'chains');
/** The file the root's lineage is read from by `--tree-node`, inside the root's own bundle folder (tree/inputs/R@g1/). */
export const ROOT_LINEAGE_FILE = 'node.json';


/** The chain file for a name, the way every tree reader finds it (the working folder's chains/ first, then the package's): { path, config, sha256 } or { error }. */
// what tree.json records for a chain entry: the file's hash, the hash without its seats' price limits and the limits as they are (src/price-limits.js; src/tree-chain-limits.js reads them)
const limitsOf = c => ({ sha256: c.sha256, limitFreeSha256: c.limitFreeSha256, priceLimits: c.priceLimits });

function chainFile(work, name) {
  if (!isChainName(name)) return { error: `${JSON.stringify(name)} is not a chain name (letters, digits, ".", "_", "-")` };
  const path = [join(work, 'chains', `${name}.json`), join(PKG_CHAINS, `${name}.json`)].find(existsSync);
  if (!path) return { error: `the chain ${name} is not in ${join(work, 'chains')} or in the package.${outdatedChainHint(name)}` };
  let config;
  try { config = JSON.parse(readFileSync(path, 'utf8')); } catch { return { error: `the chain file ${path} is not valid JSON` }; }
  const text = readFileSync(path, 'utf8');
  return { path, config, sha256: configSha256(path), limitFreeSha256: limitFreeSha256Of(text), priceLimits: priceLimitsOf(config) };
}

/** The shipped chains that write the milestone lint, derived from the package's chains/ folder (never typed: the list moves with the release). */
export function shippedMilestoneChains() {
  const names = [];
  for (const f of readdirSync(PKG_CHAINS)) {
    if (!f.endsWith('.json')) continue;
    try { if (JSON.parse(readFileSync(join(PKG_CHAINS, f), 'utf8')).handoff_contract?.milestones === true) names.push(f.slice(0, -5)); } catch { /* an unreadable shipped chain is the chain linter's business */ }
  }
  return names.sort();
}

const writesMilestones = config => config?.handoff_contract?.milestones === true;

/** The first thing wrong with the options, as { code, message }, or null. Pure apart from reading the task file and the chain files. */
/** `dry` (--dry-run, ROADMAP 56): the same questions up to where a normal run's dry run exits (options, task, chain files, lint, milestones, policy) and no further - no keys, no price-row refusal, no key scan - and `--max-usd` is optional (checked as always when given). */
function checkOptions(flags, work, { dry = false, ceiling, piiSetting = { mode: 'hard-stop', refusal: null } } = {}) {
  const needs = [['task', '--task <file>', 'the task the root plan answers'], ['chain', '--chain <name>', 'the chain the root plan runs on'], ['child-chain', '--child-chain <name>', 'the chain every sub-plan runs on'], ['max-usd', '--max-usd <usd>', 'the cap of the whole tree']];
  for (const [key, shown, why] of needs) if (flags[key] === undefined && !(dry && key === 'max-usd')) return { code: 2, message: `council tree start needs ${shown}: ${why}` };
  const raw = String(flags['max-usd'] ?? '').trim();
  if (raw.toLowerCase() === 'none') return { code: 2, message: 'a tree needs a finite cap: --max-usd none is refused' };
  const cap = dry && flags['max-usd'] === undefined ? null : /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) return { code: 2, message: `--max-usd needs a plain number of dollars above 0, not ${JSON.stringify(flags['max-usd'])}` };
  // the personal-data mode (S5b part A): the normal run's own check and sentence (src/cli.js --pii-gate), here at the same point - before anything else is read - and refused before anything is written
  const piiTyped = flags['pii-gate'] ?? null;
  if (piiTyped !== null && !TREE_PII_MODES.includes(piiTyped)) return { code: 2, message: `--pii-gate: expected "warn" or "hard-stop", got "${piiTyped}"` };
  // 0.8.3 (owner 18 Okt 2026, C&C ruling): the gate stops by default and the SETTING (COUNCIL_PII_GATE, src/pii-mode.js) binds trees too: the tree's mode is the flag, else the setting, else hard-stop, written once to tree.json (the one source every
  // member is held to). Members read the record, never the environment, so a member cannot disagree with its tree. A tree written before this has no field and reads as off (its members still scan under warn).
  // `piiSetting` is src/cli.js's reading of COUNCIL_PII_GATE (this module reads no environment variable; a caller that gives none gets the default, hard-stop); a value that is neither warn nor hard-stop comes in as `piiSetting.refusal` and is refused here (exit 2).
  if (piiSetting.refusal) return { code: 2, message: piiSetting.refusal };   // a setting that is neither warn nor hard-stop refuses, whatever --pii-gate says (C&C ruling 18 Okt 2026; src/pii-mode.js: the mode falls back to hard-stop, never to an absent field)
  const piiGate = piiTyped ?? piiSetting.mode;
  // T-b (19 Okt 2026): `--allow-pii <types found>` is the person's way on AFTER SEEING the stop for the ROOT task (the stop screen prints it). Four fixed words; it only means something under the stop (hard-stop), recorded once in tree.json `piiAllow` and read by the
  // root run's own scan. Sub-plans the models write later are NOT covered: each gets its own stop and its own `tree decide --allow-pii-node`. A member still takes no --allow-pii of its own.
  let piiAllow = null;
  if (flags['allow-pii'] !== undefined) {
    const words = String(flags['allow-pii']).split(',').map(x => x.trim()).filter(Boolean);
    if (!words.length || piiAllowProblem(words)) return { code: 2, message: `--allow-pii: expected some of ${TREE_PII_ALLOW_TYPES.join(', ')} (each once), got ${JSON.stringify(String(flags['allow-pii']).slice(0, 60))}` };
    if (piiGate !== 'hard-stop') return { code: 2, message: '--allow-pii: the personal-data gate is on warn for this tree, so there is no stop to allow; drop one of the two' };
    piiAllow = words;
  }
  const taskPath = resolve(work, flags.task);
  let st = null;
  try { st = statSync(taskPath); } catch { /* reported below */ }
  if (!st || !st.isFile()) return { code: 1, message: `--task ${flags.task}: no such task file` };
  if (isDeniedPath(relative(work, taskPath))) return { code: 1, message: `--task ${flags.task}: ${DENIED_TASK_WORDS}` };
  try { readFileSync(taskPath); } catch { return { code: 1, message: `--task ${flags.task}: the file cannot be read` }; }
  const chains = {};
  for (const [key, shown] of [['chain', '--chain'], ['child-chain', '--child-chain']]) {
    const c = chainFile(work, flags[key]);
    if (c.error) return { code: 1, message: `${shown}: ${c.error}` };
    chains[key] = c;
  }
  // the chain lint is the FIRST question, as in the run (src/cli.js exitOnLint, exit 1; a normal run never reaches any other question about a chain that fails it): on the chain as its file says it. It includes the denied-model rule, so a user's own chain with a denied model is refused here and not after the records exist
  for (const [key, shown] of [['chain', 'root'], ['child-chain', 'child']]) {
    const lines = chainLintLines(chains[key].config, chains[key].path);
    if (lines) return { code: 1, message: `the ${shown} chain ${flags[key]} cannot start:`, lines };
  }
  // row 65 (a tree built on a chain that does not write the milestone lint could never be ready) is a question of the tree's own, asked after the run's own
  for (const key of ['chain', 'child-chain']) {
    const c = chains[key];
    if (!writesMilestones(c.config)) {
      const list = shippedMilestoneChains();
      return { code: 1, message: `the ${key === 'chain' ? 'root' : 'child'} chain ${flags[key]} does not set handoff_contract.milestones to true: a tree built on it could never be ready; use a chain that does${list.length ? ` (for example ${list.join(', ')})` : ''}` };
    }
  }
  // What the root run's own CLI would refuse AFTER the tree's records exist (a registered root whose start was refused is started again by `tree resume`, but a person who is refused here loses nothing and keeps no half-made tree): asked here, before any write, through the
  // SAME functions the run calls (src/run-preflight.js; the run's order: the chain lint first, above, then the policy file, the keys, the price rows, the key scan), for the root chain and the child chain. The root run's defaults are the ones that apply:
  // `start` takes no override of the key scan (--allow-secret-shaped: src/tree-cli.js) and offers --allow-pii only as the root task's recorded way on after seeing the stop (T-b); the PII gate WARNS by default (0.8.3: the flag, else COUNCIL_PII_GATE, else warn) and is asked below, before the key scan.
  const seats = {};
  for (const [key, shown] of [['chain', 'root'], ['child-chain', 'child']]) {
    const config = { ...chains[key].config, name: chains[key].config.name || flags[key] };
    chains[key].resolved = resolveChainSeats(config); chains[key].resolvedName = config.name; seats[key] = everySeatOf(chains[key].resolved);
    chains[key].shown = shown;
  }
  const taskText = () => readFileSync(taskPath, 'utf8');
  for (const key of ['chain', 'child-chain']) {
    const gate = policyGate({ config: chains[key].resolved, allSeats: seats[key], work, taskText: key === 'chain' ? taskText : () => '' });
    if (gate.parseError) return { code: 6, message: `the ${chains[key].shown} chain ${flags[key]} cannot start:`, lines: [policyRefusalText(gate, { work })] };
    if (gate.policy !== null && !gate.ok) return { code: 12, message: `the ${chains[key].shown} chain ${flags[key]} cannot start:`, lines: [policyRefusalText(gate, { work, chainName: chains[key].resolvedName })] };
  }
  // a dry run stops here, where a normal run's dry run exits: before the keys, the price-row refusal and the key scan (the projection shows an unpriced seat instead)
  if (dry) return { dry: true, cap, taskPath, chains, piiGate };
  for (const key of ['chain', 'child-chain']) {
    const lines = missingKeyLines(chains[key].resolved, seats[key]);
    if (lines) return { code: 5, message: `the ${chains[key].shown} chain ${flags[key]} cannot start:`, lines };
  }
  for (const key of ['chain', 'child-chain']) {
    // a seat with no price row cannot be held to a cap (src/unpriced.js; the same refusal a normal run makes, exit 5)
    const unpriced = unpricedSeats(chains[key].resolved);
    if (unpriced.length) return { code: 5, message: `the ${chains[key].shown} chain ${flags[key]} cannot start:`, lines: ['', ...unpriced.flatMap(u => [formatCouncilError('COUNCIL-E002', { provider: u.provider, model: u.model, roles: u.roles, capUsd: cap }), ''])] };
  }
  // the PII gate on the root's task (the mode is always set since 0.8.3; the null guard stays for a caller that hands none): the SAME function the run calls (src/run-preflight.js piiGateReport), BEFORE the key scan, as cli.js asks them. `warn` never refuses and start prints nothing for it:
  // the root run is a member whose own CLI prints and records the findings (printing here too would show them twice). The closing lines offer --allow-pii <types found> for the ROOT task only (T-b); later sub-plans are model-written and each gets its own stop.
  if (piiGate !== null) {
    const pii = piiGateReport({ mode: piiGate, allow: piiAllow ?? [], sources: [['the task file and --context documents', taskText()]], forTree: true, keyScanRefuses: true });
    if (pii.blocked) return { code: 11, message: `the root chain ${flags.chain} cannot start:`, lines: pii.lines };
  }
  for (const key of ['chain', 'child-chain']) {
    const found = inputSecretFindings({ taskFile: taskPath, taskText: key === 'chain' ? taskText() : '', config: chains[key].resolved });
    if (found.length) return { code: 11, message: `the ${chains[key].shown} chain ${flags[key]} cannot start:`, lines: secretScanRefusalLines(found, { forTree: true }) };
  }
  // TREE CEILING (15 Oct 2026, C&C; gate note section 11 item 4): COUNCIL_MAX_USD_LIMIT bounds the typed total of a PAID tree. Asked HERE, at the end, because whether the tree is paid is known only once both chains are resolved, after the dry-run
  // return (the CLI's own --dry-run exits before its ceiling checks, so a tree's stays ceiling-blind) and after the key, price-row and key-scan refusals (the CLI's T9 refusal is also among its last); nothing has been written yet. A tree with no paid seat is
  // never refused: a person with only free seats loses nothing. `ceiling` is src/cli.js's reader (a thunk, read only here); a caller that gives none for a PAID tree is refused (fail closed), never waved through.
  if (['chain', 'child-chain'].some(key => chainIsPaid(chains[key].resolved))) {
    if (typeof ceiling !== 'function') return { code: 2, message: 'a paid tree cannot start: the COUNCIL_MAX_USD_LIMIT reader was not given, so the ceiling cannot be checked. Nothing was started.' };
    const refusal = typedCeilingRefusal({ capText: String(flags['max-usd']).trim(), capUsd: cap, ceiling: ceiling() });
    if (refusal) return { code: 2, message: refusal };
  }
  return { cap, taskPath, chains, piiGate, piiAllow };
}

/** The line after the root run, per its exit code: what the person does next. */
function afterRoot({ code, rootId, started }) {
  // the root's own CLI can still refuse AFTER the records exist (a missing key, a policy file, the PII gate, the outbound key scan...): it makes no run.json then, and `tree resume` starts that root again (src/tree-resume.js, beginRoot), so the person is told the one route there is
  if (![0, 3, 4, 19].includes(code) && !started) return [`The root run did not start (exit code ${code}; no run was made, nothing was spent). Fix what the lines above say, then run: council tree resume ${rootId} (it starts the root run).`];
  switch (code) {
    // nothing has verified the root's split yet (the sitting does, in `tree resume`), so `approve` would still answer "nothing waits": the step after a finished root is `resume`, which verifies the split and says whether sub-plans wait for approval
    case 0: return [`The root run finished. Next: council tree resume ${rootId} (it checks the plan's split and tells you whether sub-plans wait for your approval)`];
    case 3: return [`The root run waits for an external answer. Write the reply its NEEDS file asks for into runs/${rootId}/, then run: council tree resume ${rootId}`];
    case 4: return [`The root run stopped at its cap. See: council tree status ${rootId}`];
    case 19: return [`The tree refused to start the root run (exit 19). Nothing was spent. See: council tree status ${rootId}`];
    default: return [`The root run ended with exit code ${code}. See: council tree status ${rootId}`];
  }
}

/**
 * THE ONE PLACE a tree's root run is begun (0.8.3 M6 closing; `council tree start` and `council tree resume` both call it, so the root a resume starts is the one `start` would have started). The tree's own record is read: nothing
 * here comes from run.json (a root that never ran has none) or from the caller's flags. In order, each refusal naming its cause and writing nothing:
 *   1. the task: the pin in tree.json (src/tree-task-pin.js) must exist, be usable, and the file it names must still hold the text it was pinned with;
 *   2. the root chain (tree.json `chains`, depth 0): found as `tree start` finds it, with the sha256 the tree recorded (the member's own continuation check would refuse a changed chain only AFTER R is registered);
 *   3. the personal-data mode (src/tree-pii-mode.js): an unusable value FAILS CLOSED;
 *   4. the root's lineage file tree/inputs/R@g1/node.json: written with `wx`; one that exists must be the same object, never overwritten;
 *   5. `registerRoot` unless the record already has R generation 1 (the grant is the whole cap IN FORCE; no grant_issued);
 *   6. `announce()` (the caller's pre-launch line: the cap is money) and then `startRun`, `api.run`'s shape, with the options `tree start` always passed. The figure announced and passed as `maxUsd` is the ROOT'S OWN BOUND
 *      (lifetimeCapOf of R@g1: min(its recorded grant, the cap in force less what others hold)), never tree.json's starting cap: an amendment accepted before the root ran (E54) is honoured. It equals the cap in force when
 *      the root is registered here; it is below it only when the root was registered earlier at a lower cap and the cap was then raised (the grant is an event and stays).
 * -> { refusal } (a plain sentence; the root run was not started), { launchError } (startRun threw; the first line), or { code } (the root run's exit code). It prints nothing and holds no lock: the caller holds the sitting lock.
 */
export async function beginRoot(rootDir, { work, startRun, now, announce = () => {}, onOutput }) {
  const clock = now ? { now } : {};
  const record = readTreeRecord(rootDir);
  const tree = record.tree;
  if (record.corrupt.length || !tree) return { refusal: `the tree record cannot be read (${record.corrupt.map(c => c.reason).join('; ') || 'no tree.json'}), so its root run cannot be started. Nothing was started or spent.` };
  const pin = rootTaskPinFrom(tree);
  if (pin.status === 'unknown') return { refusal: `the root run of tree ${tree.treeId} never started, and this tree was started before its task was recorded in it, so the task it answers is not known. Nothing was started or spent. Start a new tree with council tree start.` };
  if (pin.status === 'unusable') return { refusal: `the task recorded in tree ${tree.treeId} cannot be used (${pin.reason}). Nothing was started or spent. Start a new tree with council tree start.` };
  const task = checkRootTaskPin(pin.pin);
  if (!task.ok) return { refusal: `the root run of tree ${tree.treeId} cannot be started: ${task.reason}. Nothing was started or spent. Start a new tree with council tree start, with the task you want.` };
  const rootChain = tree.chains.find(c => c.depth === 0);
  const chain = chainFile(work, rootChain.name);
  if (chain.error) return { refusal: `the root run of tree ${tree.treeId} cannot be started: the root chain ${rootChain.name} cannot be used (${chain.error}). Nothing was started or spent. Start a new tree with council tree start.` };
  if (chain.sha256 !== rootChain.sha256) return { refusal: `the root run of tree ${tree.treeId} cannot be started: the chain file ${chain.path} has changed since the tree was started (its hash differs from the recorded one)${limitsOnlyWords({ tree, entry: rootChain, path: chain.path }) ? `; ${limitsOnlyWords({ tree, entry: rootChain, path: chain.path })} Nothing was started or spent.` : '. Nothing was started or spent. Start a new tree with council tree start.'}` };
  const mode = treePiiModeFrom(tree);
  if (mode.status === 'unusable') return { refusal: `the root run of tree ${tree.treeId} cannot be started: its personal-data mode cannot be read (${mode.reason}), and a tree never runs with the check off by accident. Nothing was started or spent.` };
  const lineageDir = bundleDirOf(rootDir, 'R', 1);
  const lineageFile = join(lineageDir, ROOT_LINEAGE_FILE);
  const lineage = Object.fromEntries(TREE_FIELDS.map(k => [k, { treeId: tree.treeId, node: 'R', generation: 1, attempt: 1, parentNode: null, depth: 0 }[k] ?? null]));
  const lineageText = `${JSON.stringify(lineage, null, 2)}\n`;
  mkdirSync(lineageDir, { recursive: true });
  if (existsSync(lineageFile)) {
    let same = false;
    try { same = JSON.stringify(JSON.parse(readFileSync(lineageFile, 'utf8'))) === JSON.stringify(lineage); } catch { /* not the lineage: refused below */ }
    if (!same) return { refusal: `the root run of tree ${tree.treeId} cannot be started: ${lineageFile} exists and is not the root's lineage. Nothing was started or spent; the file was left as it is.` };
  } else writeFileSync(lineageFile, lineageText, { flag: 'wx' });
  if (![...stateOf(record).nodes.values()].some(n => n.node === 'R' && n.generation === 1)) {
    try { registerRoot(rootDir, clock); } catch (e) { return { refusal: `the root of tree ${tree.treeId} could not be registered (${terminalSafe(String(e?.message ?? e)).split('\n')[0]}). Nothing was started or spent.` }; }
  }
  const nowRecord = readTreeRecord(rootDir);
  const capInForceUsd = effectiveCapUsd(nowRecord);
  const rootBoundUsd = lifetimeCapOf(budgetOf(rootDir, { record: nowRecord }), 'R@g1').lifetimeCapUsd;
  if (!(rootBoundUsd > 0)) return { refusal: `the root run of tree ${tree.treeId} cannot be started: nothing is left of its grant under the cap in force (${formatUsd(capInForceUsd)}). Nothing was started or spent.` };
  announce({ treeId: tree.treeId, chain: rootChain.name, task: task.path, capUsd: rootBoundUsd, capInForceUsd });
  try {
    const res = await startRun({ chain: rootChain.name, task: task.path, cwd: work, runId: tree.treeId, treeNode: lineageFile, maxUsd: rootBoundUsd, ...(mode.status === 'on' ? { piiGate: mode.mode } : {}), onOutput });
    return { code: Number.isInteger(res?.exitCode) ? res.exitCode : 1 };
  } catch (e) {
    return { launchError: terminalSafe(String(e?.message ?? e)).split('\n')[0] };
  }
}

export async function startHandler({ flags, work, stdout, stderr, now, deps = {}, ceiling, piiSetting }) {
  // everything printed may quote a chain name, a path or a provider's words: control and bidi characters are removed (src/terminal-safe.js), as `tree resume` does
  const out = s => stdout.write(`${terminalSafe(s)}\n`);
  const err = s => stderr.write(`${terminalSafe(s)}\n`);
  const clock = now ? { now } : {};
  const startRun = deps.startRun ?? (opts => api.run(opts));
  const checked = checkOptions(flags, work, { dry: flags['dry-run'] === true, ceiling, piiSetting });
  if (checked.message) { err(`tree start: ${checked.message}`); for (const l of checked.lines ?? []) err(l); return checked.code; }
  const { cap, taskPath, chains, piiGate, piiAllow } = checked;
  // BUNDLE UNIT (C&C ruling 19 Okt 2026): a task bigger than the size a child's approval is priced for would make every child and every re-plan oversize, so it is refused here, where the person is and nothing has been spent. N is never raised per tree.
  const allowanceBytes = deps.bundleAllowanceBytes ?? DEFAULT_BUNDLE_ALLOWANCE_BYTES;
  const taskBytes = Buffer.byteLength(readFileSync(taskPath, 'utf8'), 'utf8');
  if (taskBytes > allowanceBytes) { err(`tree start: the task is ${taskBytes} bytes, over the ${allowanceBytes} bytes a sub-plan's approval is priced for: every sub-plan would carry its sections and be refused. Nothing was started or spent. Shorten the task (or move detail into a separate document the plan can name) and start again.`); return 2; }
  if (checked.dry) {
    // ROADMAP 56: print what the tree could cost and stop. Nothing below runs: no run id, no folder, no lock, no record, no starter.
    const projection = projectTree({ root: { name: flags.chain, config: chains.chain.resolved, taskChars: readFileSync(taskPath, 'utf8').length }, child: { name: flags['child-chain'], config: chains['child-chain'].resolved, taskChars: deps.bundleAllowanceBytes ?? DEFAULT_BUNDLE_ALLOWANCE_BYTES }, limits: DEFAULT_LIMITS, capUsd: cap });
    for (const line of projectionLines(projection, { capUsd: cap })) out(line);
    return 0;
  }

  const rootId = (deps.newRunId ?? nextRunId)();
  const rootDir = join(work, 'runs', rootId);
  if (existsSync(rootDir)) { err(`tree start: runs/${rootId} already exists (a run id is never reused); nothing was written`); return 1; }

  // from here on files are written: the folder, then the sitting lock, so no other command can act on this tree while its root is being made and run
  mkdirSync(treeDirOf(rootDir), { recursive: true });
  let release;
  try { release = acquireRunLock(treeDirOf(rootDir), { file: SITTING_LOCK_FILE }); } catch (e) {
    if (e instanceof RunLockedError) { err(`tree start: another sitting holds this tree (${e.message}); nothing was started`); return 1; }
    throw e;
  }
  try {
    startTree(rootDir, { rootCapUsd: cap, rootTask: makeRootTaskPin(taskPath, work), ...(piiGate !== null ? { piiGate } : {}), ...(piiAllow !== null ? { piiAllow } : {}), bundleAllowanceBytes: deps.bundleAllowanceBytes ?? DEFAULT_BUNDLE_ALLOWANCE_BYTES, chains: [{ depth: 0, name: flags.chain, ...limitsOf(chains.chain) }, { depth: 1, name: flags['child-chain'], ...limitsOf(chains['child-chain']) }, { depth: 2, name: flags['child-chain'], ...limitsOf(chains['child-chain']) }], ...clock });
    const began = await beginRoot(rootDir, { work, startRun, now, announce: () => out(`Tree ${rootId} started: cap ${formatUsd(cap)} for the whole tree, root plan on ${flags.chain}, sub-plans on ${flags['child-chain']}.`), onOutput: (s, stream) => (stream === 'stderr' ? stderr : stdout).write(s) });
    // the refusals of beginRoot cannot fire here (checkOptions has just proved the same facts); one that does is still said plainly, never a stack trace
    if (began.refusal) { err(`tree start: ${began.refusal}`); return 1; }
    if (began.launchError) {
      err(`tree start: the root run could not be started: ${began.launchError}. Nothing was spent. The tree (${rootId}) exists: fix the cause, then run: council tree resume ${rootId} (it starts the root run).`);
      return 1;
    }
    const { code } = began;
    // the root run has moved the record (this process holds the sitting lock): TREE_HANDOFF.md and tree/report.json are written from it, as a sitting's step would; a failing write is one plain line, never fatal
    for (const p of writeTreeFiles(rootDir, { work })) err(fileProblemLine(rootDir, p));
    for (const line of afterRoot({ code, rootId, started: existsSync(join(rootDir, 'run.json')) })) out(line);
    return code;
  } finally {
    release();
  }
}
