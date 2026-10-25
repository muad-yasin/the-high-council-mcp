// REBUILD of a registered, not-started sub-plan's input (0.8.3 M6 REBUILD unit; gate page Review/Build_0.8.3/m6-closing/Restore_Gap_Gate_Page.md section 14 and its dated addendum; Muad's answer, 14 Oct 2026: "Rebuild them (Recommended)" to "When a person
// accepts an edited plan, some sub-plans may already be set up but not started, built from the old text. What should the accept do about them?").
//
// A node is registered with the four files of its input bundle and their hash. Its context.md quotes the parent's plan (part 4) and each provider's plan (part 3), and the quote's label carries the whole document's sha256, so when such a plan's body
// changes (an accept, or a revert to the text the panel signed) after the bundle was built, the bundle is no longer what a derivation from the plan as it stands would write. Before the node STARTS, the sitting calls rebuildRegisteredBundle:
//
//   rebuildRegisteredBundle(rootDir, { work, rootTaskPath, facts, now, deps }) -> { kind: 'none' } | { kind: 'rebuilt', node, event, bundleDir } | { kind: 'refused', node, check, detail }
//
// One tree-lock hold from the derivation THROUGH the append (a plan_accepted takes the same lock, so no accept interleaves); the locked start (src/tree-continuation.js `rebuild_due`) covers the window after the lock is released.
// ORDER: (1) trigger = bodyEventsNewerThanBuild (the record only); (2) derive in full with the SAME call registerNextChild uses; (3) refuse, with a `blocked` record and no write, when the new derivation would change what the person approved: the obligation map, the
// dependsOn pins, the split, the held items, the context size, a key or personal-data finding in the new files; (4) write the new files FIRST (a differing folder of this not-started node is always replaced, the old one moved aside as `<name>.replaced-<n>`, never
// deleted: a crashed earlier rebuild, an accept that landed since and a hand edit all look the same here and all lose to the plan as it stands); (5) THEN append the ONE event. A crash between (4) and (5) leaves the folder equal to the fresh derivation and the
// registration old: the next sitting derives again, finds the files in place and appends the event only. No money: no grant, no chain, no gate.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { appendTreeEventLocked, fsyncDir, readTreeRecord, stateOf, treeDirOf, withTreeLock } from './tree-record.js';
import { bodyEventsNewerThanBuild, builtFromOf, deadKeys, transitionRefusal } from './tree-transitions.js';
import { DeriveRefusal, deriveChild, writeBundle } from './tree-derive.js';
import { NotExpandable, loadChainConfig, loadDerivation, readPlanOf } from './tree-derive-load.js';
import { heldDigest, rootTaskPathOf } from './tree-frontier.js';
import { bundleInputCheck, rootTaskCoverage } from './tree-bundle-input.js';
import { nodeKey } from './tree-identity.js';
import { treeInputScanModeFrom } from './tree-pii-mode.js';
import { bundleAllowanceBytesOf } from './tree-budget.js';
import { canonicalJson } from './thin-contract.js';
import { MAX_CONTEXT_FILE_BYTES, contextBundleText, contextFileList } from './context-files.js';
import { contextHashOf } from './scope-freeze.js';
import { runSpendOf } from './spend.js';
import { bundleDirOf } from './tree-continuation.js';

export function rebuildRegisteredBundle(rootDir, { work, rootTaskPath = rootTaskPathOf(rootDir, work), facts, now, deps = {} } = {}) {
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    if (record.corrupt.length || !record.tree) return { kind: 'none' };
    const state = stateOf(record);
    if (state.active === null) return { kind: 'none' };
    const n = state.nodes.get(state.active);
    if (!n || n.phase !== 'registered' || n.postRun || (n.node === 'R' && n.generation === 1)) return { kind: 'none' };
    if (deadKeys(state).has(`${n.node}@g${n.generation}`)) return { kind: 'none' };         // a dead node (its plan or an ancestor's was replaced) is never rebuilt: the start refuses it as dead
    const due = bodyEventsNewerThanBuild(state, n);
    if (!due.length) return { kind: 'none' };
    const scope = `${n.node}@g${n.generation}`;
    const reg = record.events.find(e => e.event === 'node_registered' && e.node === n.node && e.generation === n.generation);
    const refuse = (check, detail) => {
      const fields = { scope, transition: 'derivation', check, detail, frontierKey: n.frontierKey };
      if (!record.events.some(e => e.event === 'blocked' && e.scope === scope && e.check === check && e.detail === detail)) appendTreeEventLocked(rootDir, { event: 'blocked', reason: 'expansion_refused', ...fields }, { facts, now });
      return { kind: 'refused', node: n.node, generation: n.generation, check, detail };
    };
    const way = ` The sub-plan is not started. Close it (\`council tree decide ${basename(rootDir)} --close ${scope}\`).`;       // D2 F13g S12 (A-DRAFT): the clause "or answer the plan it quotes with a new plan" named no command, and is dropped
    // the parent is the generation the node's FRONTIER names, never the newest (after a regenerate the old child belongs to the old parent)
    const parent = state.nodes.get(`${n.parentNode}@g${state.frontiers.get(n.frontierKey)?.parentGeneration}`);
    if (!parent) return refuse('rebuild_parent', `${scope}'s parent ${n.parentNode} is not in the record, so its input cannot be rebuilt.${way}`);
    let args; let derived;
    try {
      // the child's id in the parent's split is not its milestone: the signed block names it (the plan is read against the accepted hash, src/tree-derive-load.js readPlanOf)
      const childId = readPlanOf(dirname(rootDir), parent).block?.children?.find(c => c.milestone === n.node.split('/').at(-1))?.id;
      if (!childId) return refuse('rebuild_refused', `the split of ${parent.node} as it stands has no child for ${scope}.${way}`);
      args = loadDerivation({ rootDir, parentRef: { node: parent.node, generation: parent.generation }, childId, generation: n.generation, rootTaskPath, work });
      derived = deriveChild(args);
    } catch (e) {
      if (e instanceof DeriveRefusal) return refuse('rebuild_refused', `the input of ${scope} cannot be rebuilt from the plan as it stands (${e.code}: ${e.detail}).${way}`);
      if (e instanceof NotExpandable) return refuse('rebuild_refused', `the input of ${scope} cannot be rebuilt: ${e.message}.${way}`);
      throw e;
    }
    if (deps.afterDerive) deps.afterDerive();
    const changed = what => refuse('rebuild_changed', `rebuilding the input of ${scope} from the plan as it stands would change ${what}, which a rebuild never does: only the quoted text moves.${way}`);
    if (!derived.startable) return changed('the acceptance list (no item is left)');
    if (reg.obligations && canonicalJson(reg.obligations) !== canonicalJson(derived.obligationMap)) return changed('the obligations it carries');
    if (canonicalJson(reg.dependsOn ?? []) !== canonicalJson(derived.dependsOn)) return changed('the plans it depends on');
    if (reg.splitSha256 !== undefined && reg.splitSha256 !== null && reg.splitSha256 !== args.parent.blockSha256) return changed('the split of its parent');
    try { loadChainConfig({ tree: record.tree, depth: n.node.split('/').length - 1, work }); } catch (e) { return changed(`its chain (${e.message})`); }
    const preview = record.events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === n.frontierKey && (e.boundSha256 ?? null) === (state.frontiers.get(n.frontierKey)?.previewHash ?? null)).at(-1);
    const shown = preview?.children?.find(c => c.node === n.node && c.generation === n.generation);
    if (shown && shown.heldSha256 !== heldDigest(derived)) return changed('the items it is held for');
    const bytes = Buffer.byteLength(derived.files['context.md'] ?? '', 'utf8');
    if (bytes > MAX_CONTEXT_FILE_BYTES) return refuse('rebuild_context_size', `the rebuilt context.md of ${scope} is ${bytes} bytes, over the ${MAX_CONTEXT_FILE_BYTES} the CLI accepts.${way}`);
    const found = bundleInputCheck({ files: derived.files, carrierSpans: derived.carrierSpans, piiMode: treeInputScanModeFrom(record.tree), allow: state.piiAllowed?.get(nodeKey(n.node, n.generation))?.types ?? [], rootCover: rootTaskCoverage(record.tree, derived), maxBytes: bundleAllowanceBytesOf(record.tree) });   // T-b: a child a person allowed keeps its allowance when its bundle is rebuilt
    if (found.findings.length) return refuse('rebuild_input', `the rebuilt input of ${scope} holds ${found.findings.length} key-shaped or personal-data finding${found.findings.length === 1 ? '' : 's'} (the quoted plan carries it), so it is not written.${way}`);
    // the EVENT first, and the table is asked about it BEFORE anything is written (the one source, as candidatePlanAccept does): a refusal leaves the folder exactly as it was, so a refused rebuild can never leave files the record does not know
    // every plan this bundle is built from now PLUS every plan the earlier one was built from (a rebuild never stops watching one), once each
    const watchedNow = [...new Map([...derived.sources, ...(Array.isArray(n.builtFrom) ? n.builtFrom : [])].map(x => [`${x.node}@g${x.generation}`, { node: x.node, generation: x.generation }])).values()].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation));
    const candidate = {
      event: 'node_bundle_rebuilt', node: n.node, generation: n.generation, runId: n.runId,
      previousBundleSha256: n.bundleSha256, bundleSha256: derived.bundleSha256, bundleBytes: derived.bundleBytes, because: due, builtFrom: builtFromOf(state, watchedNow),
    };
    const table = transitionRefusal(state, candidate, facts);
    if (table) return refuse('rebuild_refused', `${table.reason}.${way}`);
    const bundle = writeBundle(rootDir, derived, { rebuild: true });
    if (deps.afterWrite) deps.afterWrite();
    const event = appendTreeEventLocked(rootDir, candidate, { facts, now });
    return { kind: 'rebuilt', node: n.node, generation: n.generation, event, bundleDir: bundle.dir };
  });
}

/**
 * PREFLIGHT-TO-LOCK (C&C ruling 15 Oct 2026, gate page 14.13): a registered node's run folder can hold a run.json written by a start that was REFUSED before its claim (an accept landed between the member's preflight and its locked
 * start, src/cli.js writes run.json before memberStart). That run.json carries the contextHash of the OLD input; the next start takes the resume path (src/tree-run.js runIt), whose frozen-context check refuses it, so the node could not start
 * by itself until a person acted. The sitting asks this BEFORE it starts the node, whether or not a rebuild was due:
 *
 *   setAsideStaleRunFolder(rootDir, { facts, now }) -> { kind: 'none' } | { kind: 'moved', node, generation, from, to } | { kind: 'refused', node, check, detail }
 *
 * MOVED (never deleted) into the tree's own area, `tree/replaced-runs/<run id>.replaced-<n>` (C&C ruling 15 Oct 2026: NO run reader scans it; a suffixed sibling in runs/ would show in MCP list_runs as a refused row and in api.listRuns as a run that never ran) only when ALL hold: the active node is registered and has no claim of any kind (the fold, not one event name) and is not the root's first generation; its run folder is not the
 * tree's own folder (R@g1's run folder IS rootDir and holds tree/); the folder has a run.json whose contextHash is a string that differs from the hash the CLI would compute for the node's CURRENT context.md (the same functions:
 * contextFileList + contextBundleText + contextHashOf, src/cli.js); and the folder holds NO spend (no spend-reservations.jsonl, no *.usage.json: tree spend is derived from run folders, so moving one that holds any would make dollars
 * vanish from the cap). A folder that holds spend is left where it is and ONE \`blocked\` record names it. NOTE (C&C): that HOLDS-SPEND state (registered, no claim, a usage file present) is NOT produced by any CLI path, because spend is written inside invoke() after the claim; the branch fails closed on a hand-made folder, and `--close` there is not a designed remedy to build on. A run.json with NO contextHash is left alone: the CLI trusts it and takes today's as its baseline (checkFrozenContext), so it is no hard lock.
 */
export function setAsideStaleRunFolder(rootDir, { facts, now } = {}) {
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    if (record.corrupt.length || !record.tree) return { kind: 'none' };
    const state = stateOf(record);
    if (state.active === null) return { kind: 'none' };
    const n = state.nodes.get(state.active);
    if (!n || n.phase !== 'registered' || n.claim || n.postRun || (n.node === 'R' && n.generation === 1)) return { kind: 'none' };
    if (deadKeys(state).has(`${n.node}@g${n.generation}`)) return { kind: 'none' };
    const folder = join(dirname(rootDir), n.runId);
    if (resolve(folder) === resolve(rootDir) || !existsSync(join(folder, 'run.json'))) return { kind: 'none' };
    let stored;
    try { stored = JSON.parse(readFileSync(join(folder, 'run.json'), 'utf8')).contextHash; } catch { return { kind: 'none' }; }          // an unreadable run.json is the CLI's own refusal to make
    if (typeof stored !== 'string' || stored === '') return { kind: 'none' };
    const current = contextHashOf(contextBundleText(contextFileList(join(bundleDirOf(rootDir, n.node, n.generation), 'context.md'))));
    if (stored === current) return { kind: 'none' };
    const scope = `${n.node}@g${n.generation}`;
    // what holds spend: the tree's own reader (src/spend.js runSpendOf: report.json, the usage files and the reservations, a figure that does not read counts as unknown) AND, failing closed, the mere presence of any of those files
    const spend = readdirSync(folder).filter(f => f === 'spend-reservations.jsonl' || f === 'report.json' || f.endsWith('.usage.json'));
    const read = runSpendOf(folder);
    if (spend.length || read.usd > 0 || read.unknownFigures > 0) {
      const detail = `the run folder runs/${n.runId} of ${scope} was built for an earlier input but also holds ${spend.length ? spend.slice(0, 3).join(', ') : 'a spend figure'}: it is not moved (spend is read from run folders). Close the sub-plan: \`council tree decide ${basename(rootDir)} --close ${scope}\`.`;
      if (!record.events.some(e => e.event === 'blocked' && e.scope === scope && e.check === 'run_folder_stale' && e.detail === detail)) appendTreeEventLocked(rootDir, { event: 'blocked', reason: 'expansion_refused', scope, transition: 'derivation', check: 'run_folder_stale', detail, frontierKey: n.frontierKey }, { facts, now });
      return { kind: 'refused', node: n.node, generation: n.generation, check: 'run_folder_stale', detail };
    }
    const asideDir = join(treeDirOf(rootDir), 'replaced-runs');
    mkdirSync(asideDir, { recursive: true });
    let k = 1; while (existsSync(join(asideDir, `${n.runId}.replaced-${k}`))) k++;
    const to = join(asideDir, `${n.runId}.replaced-${k}`);
    renameSync(folder, to);
    fsyncDir(asideDir); fsyncDir(dirname(folder));
    return { kind: 'moved', node: n.node, generation: n.generation, from: folder, to };
  });
}
