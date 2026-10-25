// Fixtures shared by the tree tests (0.8.3 M2). Not a test file: it exports builders only. A tree is a temp working folder with `runs/`, a started tree record, and run folders that are either REAL (started through the
// CLI on the all-mock chains, $0) or SYNTHETIC (files written by hand, so each accounting scenario of PLAN 7.1/7.2 can be built exactly).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Of } from '../../src/thin-contract.js';
import { limitFreeSha256Of, priceLimitsOf } from '../../src/price-limits.js';
import { appendTreeEvent, startTree } from '../../src/tree-record.js';
import { makeRootTaskPin } from '../../src/tree-task-pin.js';
import { frontierKey } from '../../src/tree-identity.js';
import { registerChildUnchecked, registerRoot } from '../../src/tree-register.js';
import { plan3 } from './split-fixture.js';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const cli = join(root, 'src', 'cli.js');
export const ROOT_ID = '2026-10-08T11-00-00-000Z';
export const IDS = Array.from({ length: 14 }, (_, i) => `2026-10-08T11-${String(10 + i).padStart(2, '0')}-00-000Z`);
export const SPLIT = 'b'.repeat(64);
/** The gate fields a top-up or an acceptance must carry (M5d: topUp and acceptAccounting THROW without them): fixture values for the tests that call the library directly. K10 (C2a-record commit 5): and who answered it (`actor`, `via`), which the table REQUIRES on every new gate-bound event; a person at a terminal, as every real tree gate is. */
export const GATE_FIELDS = Object.freeze({ gateId: 'g-fixture', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' });
/** the bound hash every fixture preview carries (the table requires one) and every fixture approval repeats (R3b); `approveFrontier` defaults to it */
export const FIXTURE_BOUND = 'f'.repeat(64);
/** a fixture frontier_approved's fields: the gate and the hash of the fixture preview */
export const APPROVAL_FIELDS = Object.freeze({ ...GATE_FIELDS, boundSha256: FIXTURE_BOUND });
/** The sha256 of a shipped chain's file text: what a tree records for the chain a node runs (PLAN 4.2, 7.6 step 2). */
/** What `tree start` records for a chain file beside its hash (tree.json chains[]): limitFreeSha256 and priceLimits (src/price-limits.js). */
export const limitsRecordOf = text => ({ limitFreeSha256: limitFreeSha256Of(text), priceLimits: priceLimitsOf(JSON.parse(text)) });
export const chainSha = name => sha256Of(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
/** `shaOf(name)`: the hash of a chain by name; chains of the test's own (split-root) are hashed by the caller from their file in the working folder. */
export const chainsFor = (rootChain = SPLIT_ROOT, childChain = 'mock-budget', shaOf = chainSha) => [0, 1, 2].map(depth => ({ depth, name: depth ? childChain : rootChain, sha256: shaOf(depth ? childChain : rootChain) }));

/**
 * The root chain of the tree tests (M3): `mock-debate` with a handoff seat that reproduces the plan's split block (src/providers.js mock-handoff-split), kept in the test's working folder so chains/ is untouched. A child's start
 * checks PLAN 5.5 items 1-3 on every ancestor, and item 3 needs a root whose plan carries a block and whose handoff copied it. The root's plan is handed in as a draft (`plan.md`, round 1), so the run is still $0 and mock.
 */
export const SPLIT_ROOT = 'split-root';
/** What the default split root's handoff call costs (0.8.3 M6 fixtures): it writes milestones on `mock-handoff-split-milestones`, 30 tokens in + 10 out at the fixture row 1000/1000 USD per million tokens = (30 + 10) * 1000 / 1e6 = $0.04. The model it replaced (`mock-handoff-split`) has no price row, so the root cost $0. Each node whose handoff is that mock adds the same $0.04. */
export const SPLIT_ROOT_HANDOFF_USD = 0.04;
const mockDebate = () => JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
export const splitRootConfig = () => { const c = mockDebate(); return { ...c, name: SPLIT_ROOT, seats: { ...c.seats, handoff: { provider: 'mock', model: 'mock-handoff-split-milestones', maxTokens: 2000 } }, handoff_contract: { milestones: true } }; };
/** Writes chains/split-root.json and plan.md into a working folder; returns the chain file's sha256. */
export function installSplitRoot(work, { plan = plan3() } = {}) {
  mkdirSync(join(work, 'chains'), { recursive: true });
  writeFileSync(join(work, 'chains', `${SPLIT_ROOT}.json`), JSON.stringify(splitRootConfig(), null, 2));
  writeFileSync(join(work, 'plan.md'), plan);
  return sha256Of(readFileSync(join(work, 'chains', `${SPLIT_ROOT}.json`), 'utf8'));
}
/** The api.run options that start a tree's root (node R) on its chain; a root on the split-root chain is run on its plan.md draft. */
export const rootOpts = t => ({ chain: t.rootChain ?? SPLIT_ROOT, task: 'tasks/x.md', cwd: t.work, runId: ROOT_ID, treeNode: lineageFile(t.work, 'R'), ...((t.rootChain ?? SPLIT_ROOT) === SPLIT_ROOT ? { draft: 'plan.md', rounds: 1 } : {}) });

// Every working folder newTree makes is removed when the test process exits (C&C's ruling, 9 Oct 2026: on 8 Oct the RAM-backed /tmp filled; ~400 MB an hour under mutation runs). KEEP_TREE_TMP=1 keeps them for a look.
const madeTrees = new Set();
process.on('exit', () => { if (process.env.KEEP_TREE_TMP) return; for (const dir of madeTrees) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a leftover is a nuisance, never a failure */ } } });

/** A working folder with a task and a started tree (tree.json + tree_started), the root NOT yet registered. */
// BUNDLE UNIT (19 Okt 2026): the real default allowance (100,000 bytes) prices a child for a 25k-token input, which moves every fixture-chain ceiling; the fixtures' chains assume a 1000-token prompt, so their trees are started with an allowance of 4000 bytes (= that prompt): the figures stay at their declared sizes and the bundle must fit in 4000 bytes. BG-rows set their own.
export const FIXTURE_BUNDLE_ALLOWANCE_BYTES = 4000;
export function newTree({ cap = 100, rootChain = SPLIT_ROOT, childChain = 'mock-budget', extraChains = {}, limits, piiGate, bundleAllowanceBytes = FIXTURE_BUNDLE_ALLOWANCE_BYTES } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'thc-budget-'));
  madeTrees.add(work);
  mkdirSync(join(work, 'tasks'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  // chains of the test's own (a seat on a local server, say) live in the working folder's chains/, where the CLI looks first; their hash is taken from that file
  if (Object.keys(extraChains).length) mkdirSync(join(work, 'chains'), { recursive: true });
  let splitRootSha = rootChain === SPLIT_ROOT ? installSplitRoot(work) : null;
  for (const [name, config] of Object.entries(extraChains)) writeFileSync(join(work, 'chains', `${name}.json`), JSON.stringify({ ...config, name }, null, 2));
  // a test may replace the split root itself (the M5c held fixture turns criterion kinds on): its hash is the replaced file's
  if (splitRootSha && extraChains[SPLIT_ROOT]) splitRootSha = sha256Of(readFileSync(join(work, 'chains', `${SPLIT_ROOT}.json`), 'utf8'));
  const shaIn = name => (name === SPLIT_ROOT && splitRootSha ? splitRootSha : extraChains[name] ? sha256Of(readFileSync(join(work, 'chains', `${name}.json`), 'utf8')) : chainSha(name));
  // what `council tree start` records beside the hash (src/tree-start.js limitsOf): the file's hash without its seats' price limits and the limits as they are; the text is the file the hash was taken from
  const chainTextIn = name => readFileSync(existsSync(join(work, 'chains', `${name}.json`)) ? join(work, 'chains', `${name}.json`) : join(root, 'chains', `${name}.json`), 'utf8');
  const rootDir = join(work, 'runs', ROOT_ID);
  // the root task is PINNED in tree.json, as `council tree start` does (src/tree-task-pin.js): a root re-plan reads the task from the pin and has no other source (S8-3 fix-up, C&C 12 Oct)
  startTree(rootDir, { rootCapUsd: cap, rootTask: makeRootTaskPin(join(work, 'tasks', 'x.md'), work), ...(limits ? { limits } : {}), ...(piiGate ? { piiGate } : {}), ...(bundleAllowanceBytes ? { bundleAllowanceBytes } : {}), chains: [0, 1, 2].map(depth => { const name = depth ? childChain : rootChain; return { depth, name, sha256: shaIn(name), ...limitsRecordOf(chainTextIn(name)) }; }) });
  return { work, rootDir, runsDir: join(work, 'runs'), cap, rootChain, childChain, shaIn };
}

/** Writes the lineage file a member is started with (`--tree-node`), returns its path. */
export function lineageFile(work, node, generation = 1, treeId = ROOT_ID) {
  const dir = join(work, 'bundles'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `${node.replace(/\//g, '.')}@g${generation}.json`);
  writeFileSync(file, JSON.stringify({ treeId, node, generation, attempt: 1, parentNode: node === 'R' ? null : node.split('/').slice(0, -1).join('/'), depth: node.split('/').length - 1 }));
  return file;
}

/** A frontier of `nodes` under R, previewed and approved. `hash`: the optional bound hash on both (the fail-closed rule is tested with it). `split`: the verified split's sha256 the frontier is previewed for (M3: a real block's hash). */
export function approveFrontier(rootDir, nodes, { generation = 1, openedBy = null, hash = FIXTURE_BOUND, approvalHash = hash, parentGeneration = 1, split = SPLIT } = {}) {
  const children = nodes.map(node => ({ node, generation }));
  const key = frontierKey({ parentNode: 'R', parentGeneration, parentRunId: ROOT_ID, splitSha256: split, openedBy, children });
  appendTreeEvent(rootDir, { event: 'frontier_previewed', frontierKey: key, parentNode: 'R', parentGeneration, parentRunId: ROOT_ID, splitSha256: split, children, boundSha256: hash });
  appendTreeEvent(rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: key, revision: 1, ...(approvalHash ? { boundSha256: approvalHash } : {}) });
  return key;
}

export const claim = (node, runId, pid, generation = 1, host) => ({ node, generation, runId, pid, host: host ?? 'localhost' });

/** The root, registered with the whole cap, started and closed by direct appends (a synthetic run folder with a run.json), so children can be registered. */
export function closedRootTree(opts = {}) {
  const t = newTree(opts);
  registerRoot(t.rootDir);
  syntheticRun(t, ROOT_ID, {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R', ROOT_ID, process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R', generation: 1, runId: ROOT_ID, outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' });
  return t;
}
export const hostnameOf = () => hostname();

/** closedRootTree plus a CLOSED child R/M1 (a synthetic run, Status needs_decision): a regenerate answers a CHILD's stop (the root is never regenerated, PLAN 8.4), so the stop fixtures that regenerate need one. */
export function closedChildTree(opts = {}) {
  const t = closedRootTree(opts);
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: 'needs_decision', share: 'revoked' });
  return t;
}

/** Registers a child of an approved frontier with a grant. */
export function registerKid(t, key, node, runId, grantUsd, generation = 1, chain = null) {
  return registerChildUnchecked(t.rootDir, { frontierKey: key, node, generation, runId, parentRunId: ROOT_ID, chain: chain ?? { name: t.childChain, sha256: (t.shaIn ?? chainSha)(t.childChain) }, grant: { amount: grantUsd, unit: 'usd' } });
}

/** A synthetic run folder: a run.json (unless `runJson: false`) and whatever evidence the scenario needs. usage: [{ file, usd, reservationId, provider }]. */
export function syntheticRun(t, runId, { runJson = true, usage = [], superseded = [], report = null, maxUsd = 100, tree = null } = {}) {
  const dir = join(t.runsDir, runId); mkdirSync(dir, { recursive: true });
  if (runJson) writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: t.childChain, task: 'x', maxUsd, ...(tree ? { tree } : {}) }));
  for (const u of usage) writeFileSync(join(dir, `${u.file}.usage.json`), JSON.stringify({ provider: u.provider ?? 'openrouter', model: 'm', usage: { input: 1, output: 1 }, usd: u.usd, ...(u.reservationId ? { reservationId: u.reservationId } : {}) }));
  if (superseded.length) mkdirSync(join(dir, 'superseded'), { recursive: true });
  for (const u of superseded) writeFileSync(join(dir, 'superseded', `${u.file}.usage.json`), JSON.stringify({ provider: u.provider ?? 'openrouter', usd: u.usd, ...(u.reservationId ? { reservationId: u.reservationId } : {}), ...(u.kind ? { kind: u.kind } : {}) }));
  if (report) writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  return dir;
}

const at = '2026-10-08T11:00:00.000Z';
export const reservedLine = (id, usd, label = 'stage') => ({ schema: 'spend-reservations/1', event: 'reserved', id, label, seat: 'openrouter/x/y', usd, at });
export const settledLine = (id, outcome, usd) => ({ schema: 'spend-reservations/1', event: 'settled', id, outcome, usd, at });

/**
 * Writes reservation lines to a run's own file AND mirrors them in the tree record (the same objects), as the member's sink does. `file: false` skips the run file (a lost file), `mirror: false` skips the mirror.
 */
export function writeLines(t, runId, node, lines, { file = true, mirror = true, generation = 1 } = {}) {
  const dir = join(t.runsDir, runId); mkdirSync(dir, { recursive: true });
  for (const line of lines) {
    if (file) appendFileSync(join(dir, 'spend-reservations.jsonl'), `${JSON.stringify(line)}\n`);
    if (mirror) appendTreeEvent(t.rootDir, { event: 'reservation_mirrored', runId, node, generation, line });
  }
}
