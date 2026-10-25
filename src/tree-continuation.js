// The continuation checks of PLAN 7.6 step 2 (0.8.3 M2): everything that must still be true before a tree member may start, resume or make a post-run paid call. They run in the member's own CLI, under the tree lock, after
// the accounting gate and BEFORE anything is claimed, "from any surface" (the orchestrator, a direct CLI resume, `api.resume`, MCP): a refused continuation writes no claim, so it leaves no phantom active node.
// Each refusal names its check (the `check` field of the `blocked` record):
//   chain      the chain file the run uses is not the one registered (its sha256, PLAN 4.2, 6.1)
//   bundle     the node's input bundle (`tree/inputs/<node>@g<n>/`: task, criteria, context) was edited since registration, or node.json names a bundle the registration does not
//   inputs_not_bundle  (M4 FIX, C&C) the task, criteria and context the run was STARTED with are not the bundle's own task.md, criteria.json and context.md, compared by CONTENT HASH (never by path: copies and
//              symlinks are fine); an absent --criteria when the bundle has one is a refusal, and --context must be exactly the bundle's file
//   approval   the frontier approval the node was registered under is no longer valid (src/tree-transitions.js approvalValid: it fails closed)
//   ancestor   a parent or an ancestor no longer passes PLAN 5.5 items 1-3 (the panel passed and signed this text; `contract check` exits 0; the split block is the signed block and the handoff reproduced it: M3)
//   stale      a stop put the node in question (PLAN 8.4)
//   provider   a provider its `dependsOn` names has a newer generation, or its thin contract changed (PLAN 8.1, 8.4)
//   blocked    a tree-wide state that persists until a person acts (parent_changed, root_affected)
// For the ROOT (PLAN 7.6 step 2, root form) only chain and blocked apply: it has no frontier, parent or provider. The root's TASK hash is not checked in M2: tree.json does not record one yet (`tree start`, M6).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { canonicalJson, sha256Of } from './thin-contract.js';
import { limitFreeSha256Of } from './price-limits.js';
import { readRunJson } from './run-files.js';
import { expansionCheck, refusalWords } from './tree-expansion.js';
import { DEAD_REASON, approvalValid, bodyEventsNewerThanBuild, deadKeys, isNodePath, isSupersededGeneration, planAuthorityOf } from './tree-transitions.js';

/**
 * THE one `blocked: parent_changed` record (0.8.3 M5c4; PLAN 12 row 3, M5-DEFAULTS 23). Written by exactly two callers: a member's start or resume whose parent or ancestor no longer passes PLAN 5.5 items 1-3
 * (src/tree-member.js, under the tree lock) and the loop's registration of a child whose parent no longer does (src/tree-loop.js). It blocks the tree (no start or resume anywhere), invalidates the approval of the
 * frontier it names and marks that frontier's registered children stale; all three are DERIVED from this one record by the fold (src/tree-transitions.js foldRecord), and a `frontier_approved` for the SAME key written
 * after it clears them (an approval of another key clears nothing).
 * What a person can do about it: (1) restore the parent's files exactly and approve the frontier again (`council tree approve`), or (2) decide: regenerate or close the affected work (`decide`, M5d/M5e). There is NO
 * third route of "the plan was edited and is now a different one": an edited plan is not the plan the panel signed (PLAN 5.5 item 1: delivered != signed), so the parent is not expandable under ANY frontier key.
 */
/** `scope` is the CHILD's key (`R/M2@g1`), whichever writer: the child whose start or registration found the parent changed (the stale marks derive from the frontier's children). */
export function parentChangedEvent({ scope, frontierKey, detail, ancestor = null }) {
  if (typeof frontierKey !== 'string' || !frontierKey) throw new TypeError('parentChangedEvent: a parent_changed record names the frontier it invalidates (frontierKey); without it the block could never be cleared');
  return { event: 'blocked', reason: 'parent_changed', scope, frontierKey, check: 'ancestor', detail, ...(ancestor ? { ancestor } : {}) };
}

/** `R.M2.M1@g1`: a dot cannot appear in a milestone id, so the folder name is unambiguous (R_A_B and R/A/B would collide with a slash turned into an underscore). */
export const bundleDirName = (node, generation) => {
  // The folder is named after the node path, so the path must be a real one (a letter-first milestone id per segment: no `.`, `..`, empty segment, slash-free name, backslash or drive letter can get through): M1's shape rule is what makes this safe.
  if (!isNodePath(node) || !Number.isInteger(generation) || generation < 1) throw new TypeError(`bundleDirName: ${JSON.stringify(node)} @g${generation} is not a node path and generation`);
  return `${node.split('/').join('.')}@g${generation}`;
};
export const bundleDirOf = (rootDir, node, generation) => join(rootDir, 'tree', 'inputs', bundleDirName(node, generation));

/** The lineage file the CLI reads (`--tree-node`); it sits in the bundle folder but is NOT part of the bundle's hash: it carries `bundleSha256`, so including it would make the hash contain itself. */
export const NODE_FILE = 'node.json';

/**
 * The sha256 of an input bundle given as { name: text }: the canonical JSON of the sorted [{ name, sha256 }] of its files, node.json excluded by name (it carries this hash). ONE implementation: bundleSha256Of reads a folder
 * into this, and the derivation hashes the files it is about to write with it.
 */
export function bundleHashOfFiles(files) {
  const list = Object.keys(files).filter(name => name !== NODE_FILE).sort().map(name => ({ name, sha256: sha256Of(files[name]) }));
  return sha256Of(canonicalJson(list));
}

/** The sha256 of an input bundle folder (the regular files directly in it, node.json excluded). null when the folder is missing. The derivation (src/tree-derive.js) writes the bundle; this is the hash it records. */
export function bundleSha256Of(dir) {
  let names;
  try { names = readdirSync(dir); } catch { return null; }
  const files = {};
  for (const name of names) { try { if (statSync(join(dir, name)).isFile()) files[name] = readFileSync(join(dir, name), 'utf8'); } catch { /* not a readable regular file: left out, so the hash differs */ } }
  return bundleHashOfFiles(files);
}

/** The sha256 of a chain file's text: what a tree records for the chain a node runs. */
export const configSha256 = path => sha256Of(readFileSync(path, 'utf8'));
/**
 * The sentence for a chain file that differs from the one the tree accepted in NOTHING but its seats' price limits (provider.max_price prompt/completion; src/price-limits.js, src/tree-chain-limits.js), else null. `entry` is the
 * tree.chains entry (it holds the hash without the limits, recorded at `tree start`); `text` is the file's text when the caller has it. One helper for every reader of the pinned hash, so the person gets the same way on whichever refuses first (A-DRAFT).
 */
export function limitsOnlyWords({ tree, entry, path, text }) {
  if (!entry?.limitFreeSha256 || !path) return null;
  try { const t = text ?? readFileSync(path, 'utf8'); if (limitFreeSha256Of(t) !== entry.limitFreeSha256) return null; } catch { return null; }
  return `only the seats' price limits in ${basename(path)} changed: to accept them, run \`council tree decide ${tree?.treeId} --accept-chain-limits ${entry.name}\` at a terminal.`;
}

/** The node paths above one: ['R', 'R/M2'] for R/M2/M1. */
const pathsAbove = node => { const parts = node.split('/'); const out = []; for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/')); return out; };

/**
 * Are the inputs the run was started with the bundle's own files? `inputs` = { task, criteria, context } as the CLI resolved them (absolute paths; context may be a comma list). Each is compared by the sha256 of its CONTENT with
 * the bundle's file (never by path), so a copy or a symlink to the same bytes is fine and a changed word is not. A criteria file is required when the bundle has one (an absent list would be weaker: the chain would write its
 * own); --context must be exactly the bundle's context.md and nothing else. Returns why not, or null.
 */
function inputsAreBundle(dir, inputs) {
  const hashOf = path => { try { return typeof path === 'string' && path ? sha256Of(readFileSync(path, 'utf8')) : null; } catch { return null; } };
  const want = name => hashOf(join(dir, name));
  const wantTask = want('task.md'); const wantCriteria = want('criteria.json'); const wantContext = want('context.md');
  if (wantTask === null) return 'the bundle has no task.md to compare the task with';
  if (hashOf(inputs.task) !== wantTask) return 'the task the run was started with is not the bundle\'s task.md';
  if (wantCriteria !== null && !inputs.criteria) return 'the run was started with no --criteria although the bundle has a criteria.json (the chain would write its own list: weaker)';
  if (wantCriteria !== null && hashOf(inputs.criteria) !== wantCriteria) return 'the --criteria the run was started with is not the bundle\'s criteria.json';
  if (wantCriteria === null && inputs.criteria) return 'a --criteria was given although the bundle has no criteria.json';
  const contexts = typeof inputs.context === 'string' ? inputs.context.split(',').filter(Boolean) : [];
  if (wantContext !== null && (contexts.length !== 1 || hashOf(contexts[0]) !== wantContext)) return contexts.length > 1 ? 'the --context names more than the bundle\'s context.md' : 'the --context the run was started with is not the bundle\'s context.md';
  if (wantContext === null && contexts.length) return 'a --context was given although the bundle has no context.md';
  return null;
}

/**
 * PLAN 5.5 items 1-3 on one run (src/tree-expansion.js has the checks, in the plan's order): the panel passed and signed THIS text, `contract check` exits 0, and the split block of the signed body is the one the handoff
 * reproduced (M3 wired item 3: until then only items 1-2). Item 4 (a valid split and an approved frontier) is the expansion's own and does not apply to an ancestor. Returns null, or why not.
 */
export function defaultAncestorCheck(runDir, { work, node = null }) {
  const r = expansionCheck({ runDir, work, upTo: 3, accepted: planAuthorityOf(node) });
  return r.refusal ? refusalWords(r.refusal) : null;
}

/**
 * The IDENTITY of a node's input (0.8.3 M6, the member unit): is the bundle the one registered, does node.json name it, and are the inputs the run was started with the bundle's own files? Returns null, or { check, detail }.
 * ONE copy of the comparison, with two call sites: `continuationRefusal` (the locked backstop inside `memberStart`) and `memberPreflight` (src/tree-member.js, which runs it BEFORE the PII gate and the key scan, so a tampered
 * bundle is named as tampered and not as a secret). Every detail ends with the way out: restore the files, or close the node (the tree id is the root folder's name).
 */
/** The way out of a refused member start, root-aware: any node but R is closed with \`decide --close\`; the ROOT cannot be closed (src/tree-close.js closeRefusal, kind 'root'), so for it the files are restored, or a new tree is started. */
export const wayOutOf = ({ treeId, node, generation }, { restore = false } = {}) => (node === 'R'
  ? (restore ? ' Restore the bundle\'s files to what was recorded for it. The root cannot be closed: start a new tree with `council tree start`.' : ' The root cannot be closed: start a new tree with `council tree start`.')      // E82 (M7): pass-2's root sentence is the no-restore one; the restore branch keeps its restore route (C&C 18 Okt: a $0 restore exists where a new tree is paid; B-DRAFT: the joined sentence)
  : `${restore ? ' Restore the bundle\'s files to what was recorded for it, or close the node' : ' Close the node'}: \`council tree decide ${treeId} --close ${node}@g${generation}\`.`);
const BUNDLE_WAY_OUT = (rootDir, node) => wayOutOf({ treeId: basename(rootDir), node: node.node, generation: node.generation }, { restore: true });
export function bundleIdentityRefusal({ rootDir, node, registered, lineage = null, inputs = null }) {
  const key = `${node.node}@g${node.generation}`;
  const out = (check, detail) => ({ check, detail: `${detail}.${BUNDLE_WAY_OUT(rootDir, node)}` });
  // the node's CURRENT bundle hash: its registration, or its newest rebuild (REBUILD, gate page 14: the fold keeps it on the node)
  const currentBundleSha256 = typeof node.bundleSha256 === 'string' ? node.bundleSha256 : registered.bundleSha256;
  if (typeof currentBundleSha256 === 'string') {
    const actual = bundleSha256Of(bundleDirOf(rootDir, node.node, node.generation));
    if (actual !== currentBundleSha256) return out('bundle', `${key}: its input bundle (${bundleDirName(node.node, node.generation)}) is not the one recorded for it`);
  }
  // node.json is only a pointer to the bundle: what it names must be what the RECORD registered (it cannot be edited out or swapped to escape the check below)
  // E82 (M7): with no hash on record the sentence says that, instead of printing a hash named "none"
  if (lineage && lineage.bundleSha256 != null && lineage.bundleSha256 !== currentBundleSha256) return out('bundle', typeof currentBundleSha256 === 'string'
    ? `${key}: its node.json names the bundle ${String(lineage.bundleSha256).slice(0, 12)}, ${node.rebuiltAtId ? 'the rebuilt input holds' : 'the registration holds'} ${currentBundleSha256.slice(0, 12)}`
    : `${key}: its node.json names the bundle ${String(lineage.bundleSha256).slice(0, 12)}; no bundle hash is recorded for it`);
  if (typeof currentBundleSha256 === 'string' && inputs) {
    const why = inputsAreBundle(bundleDirOf(rootDir, node.node, node.generation), inputs);
    if (why) return out('inputs_not_bundle', `${key}: ${why}`);
  }
  return null;
}

/** A DEAD node never continues: ONE sentence for the two places that say so, `continuationRefusal` (the locked backstop) and `memberPreflight` (early, in the same order: before any check that would offer a way out the node cannot take). -> null | { check: 'dead', detail }. */
export const deadRefusal = (state, key) => (deadKeys(state).has(key) ? { check: 'dead', detail: `${key} is dead: it was ${DEAD_REASON}` } : null);

/**
 * REBUILD (gate page 14.3b): a plan this node's input quotes was accepted or put back AFTER the input was built. The sitting rebuilds before it starts a node; an accept can still land between that rebuild and the start, and the bundle on disk would then pass the identity check and the
 * node would start on the old text. This reads the record only (nothing is derived under the lock) and has ONE sentence for its two callers: `memberPreflight` (early, BEFORE run.json exists, so a refused start leaves nothing behind) and the locked `continuationRefusal` (the backstop). -> null | { check, detail }.
 */
export function rebuildDueRefusal({ rootDir, state, node }) {
  if (node.phase !== 'registered' || (node.node === 'R' && node.generation === 1)) return null;
  const due = bodyEventsNewerThanBuild(state, node);
  if (!due.length) return null;
  return { check: 'rebuild_due', detail: `${node.node}@g${node.generation}: ${due.map(b => `${b.node}@g${b.generation}`).join(', ')} ${due.length === 1 ? 'was' : 'were'} accepted or put back after this sub-plan's input was built, so the input is not built from the plan as it stands. Nothing was started: run \`council tree resume ${basename(rootDir)}\` again; it rebuilds the input from the plan first, or says why it cannot.` };
}

/**
 * Returns null when the node may continue, else { check, detail }. `registered` is the node's node_registered event. `chainPath` is the chain file the run actually uses; a null `chainPath` with a registered chain hash is REFUSED (fail closed: nothing to check it against), and `purpose` ('run' | 'resume' | 'post_run') only shapes the way-out words. `deps.ancestorCheck(runDir, { work })` is the PLAN 5.5 hook (its default is items 1-3, defaultAncestorCheck).
 */
export function continuationRefusal({ rootDir, record, state, node, registered, lineage = null, inputs = null, chainPath, purpose = 'run', work, deps = {} }) {
  const key = `${node.node}@g${node.generation}`;
  const isRoot = node.node === 'R' && node.generation === 1;            // S8: only the GENERATION-1 root skips the bundle, approval and stale checks (it has no bundle and no frontier); a later root generation has both
  const runsDir = dirname(rootDir);
  if (registered.chain?.sha256) {
    // already-false unit (Q3; C&C ruling 24 Okt 2026): FAIL CLOSED. A registered chain hash with no chain file to check it against used to skip the check ("a caller with no single file"); the post-run call of `council handoff --from-run` reached that with a lookup by the member's own chain name while the call sent another file (`--chain other`). The refusals below are RETURNED, so memberStart writes the usual `blocked continuation_refused / chain` record and exits 19; nothing here throws. The words are A-DRAFT.
    if (!chainPath) return { check: 'chain', detail: `${key}: no chain file was named for this call, so it cannot be checked against the one registered` };
    let text = null; let actual = null;
    try { text = readFileSync(chainPath, 'utf8'); actual = sha256Of(text); } catch { /* reported just below */ }
    if (actual === null) return { check: 'chain', detail: `${key}: the chain file ${basename(chainPath)} cannot be read, so it cannot be checked against the one registered. Restore it and run the command again` };
    // 0.8.3: a person may have accepted a changed price limit of this chain file (chain_limits_amended): the tree then accepts the latest accepted hash (readTreeRecord lays it over tree.chains; `startedSha256` marks an amended entry), else the registered one
    const entry = (record?.tree?.chains ?? []).find(c => c.name === registered.chain.name);
    const accepted = entry?.startedSha256 !== undefined ? entry.sha256 : registered.chain.sha256;
    if (actual !== accepted) {
      // a file under ANOTHER name is not this chain's file: its price-limit words would offer `--accept-chain-limits` for a chain the call does not use, so only a file named for the registered chain gets them
      const sameName = basename(chainPath) === `${registered.chain.name}.json`;
      // the file differs from the accepted one in nothing but its seats' price limits: the way on is the person's, one command (A-DRAFT). Kept short: `council tree resume` prints about 340 characters of a refusal.
      const words = sameName ? limitsOnlyWords({ tree: record?.tree, entry, path: chainPath, text }) : null;
      const way = purpose === 'post_run' && !sameName ? `. Without --chain the call uses the chain recorded for the node (${registered.chain.name})` : '';
      return { check: 'chain', detail: (words ? `${key}: ${words}` : `${key}: the chain file ${basename(chainPath)} is not the one registered (${String(accepted).slice(0, 12)} registered, ${String(actual).slice(0, 12)} now)`) + (words ? '' : way) };
    }
  }
  if (state.sticky.size) return { check: 'blocked', detail: `the tree is blocked: ${[...state.sticky.keys()].join(', ')}` };
  // S8: a DEAD node (deadKeys: replaced or set aside by a decision, or a node above it was - a superseded root generation included, which would otherwise skip every check below as the root) never continues; the message says so (the sentence is deadRefusal's, one copy with memberPreflight's)
  const dead = deadRefusal(state, key);
  if (dead) return dead;
  if (isRoot) return null;
  const stale = rebuildDueRefusal({ rootDir, state, node });
  if (stale) return stale;
  const identity = bundleIdentityRefusal({ rootDir, node, registered, lineage, inputs });
  if (identity) return identity;
  const frontier = state.frontiers.get(registered.frontierKey);
  if (!approvalValid(frontier)) return { check: 'approval', detail: `${key}: the frontier approval it was registered under is no longer valid` };
  if (state.stale.has(key)) return { check: 'stale', detail: `${key} is stale: a stop put it in question (PLAN 8.4)` };
  const ancestorCheck = deps.ancestorCheck || defaultAncestorCheck;
  for (const path of pathsAbove(node.node)) {
    const latest = [...state.nodes.values()].filter(n => n.node === path).sort((a, b) => b.generation - a.generation)[0];
    if (!latest) return { check: 'ancestor', detail: `${key}: its ancestor ${path} is not in the record` };
    const why = ancestorCheck(join(runsDir, latest.runId), { work, node: latest });
    if (why) return { check: 'ancestor', detail: `${key}: ancestor ${path} (${latest.runId}): ${why}`, ancestor: path, frontierKey: registered.frontierKey };
  }
  for (const dep of Array.isArray(registered.dependsOn) ? registered.dependsOn : []) {
    // C2b-1 (K4): the provider the consumer is pinned to, when that node is still live (the newest, or ADOPTED into another slot beside a newer node of its path); otherwise the newest of the path as before
    const ofPath = [...state.nodes.values()].filter(n => n.node === dep.node).sort((a, b) => b.generation - a.generation);
    const newest = ofPath.find(n => n.generation === dep.generation && !isSupersededGeneration(state, n.node, n.generation)) ?? ofPath[0];
    if (newest && newest.generation > dep.generation) return { check: 'provider', detail: `${key}: provider ${dep.node} has a newer generation (g${newest.generation}, registered against g${dep.generation})` };
    if (dep.thinContractSha256 && newest) {
      const sha = readRunJson(join(runsDir, newest.runId), 'report.json')?.thin_contract?.sha256;
      if (sha !== dep.thinContractSha256) return { check: 'provider', detail: `${key}: provider ${dep.node}'s thin contract is not the one registered` };
    }
  }
  return null;
}
