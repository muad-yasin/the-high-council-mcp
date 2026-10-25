// 0.8.3 M6 REBUILD unit (gate page Review/Build_0.8.3/m6-closing/Restore_Gap_Gate_Page.md section 14, 14.10, 14.11; C&C PASS ON CONDITIONS 14 Oct 2026; Muad: "Rebuild them (Recommended)"): a sub-plan registered and NOT started has its input bundle rebuilt from the accepted plan before it
// starts (src/tree-rebuild.js). Real all-mock trees: a real sitting registers the child and stops, the person's accept goes through the real `decideHandler`, the next sitting rebuilds. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { clearStop, requestStop, runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { rebuildRegisteredBundle, setAsideStaleRunFolder } from '../src/tree-rebuild.js';
import { contextBundleText, contextFileList } from '../src/context-files.js';
import { contextHashOf } from '../src/scope-freeze.js';
import { registerRoot } from '../src/tree-register.js';
import * as api from '../src/api.js';
import { realRoot } from './helpers/real-root.js';
import { pricedChildren } from './helpers/child-chains.js';
import { GATE_FIELDS } from './helpers/tree-fixture.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { registerNextChild } from '../src/tree-loop.js';
import { openBlockedChildStops } from '../src/tree-blocked-child.js';
import { computeReadiness } from '../src/tree-readiness.js';
import { acceptChangedPlan } from '../src/tree-accept.js';
import { bundleDirName, bundleSha256Of, continuationRefusal, parentChangedEvent } from '../src/tree-continuation.js';
import { bodyEventsNewerThanBuild, builtFromOf, deadKeys, transitionRefusal } from '../src/tree-transitions.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { ROOT_ID, newTree } from './helpers/tree-fixture.js';
import { terminal } from './helpers/terminal.js';

async function notStartedTree() {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, hooks: { afterRegister: next => { if (next.kind === 'registered' && next.node.startsWith('R/M1/')) requestStop(r.t.rootDir); } } });
  const first = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(n => n.node.startsWith('R/M1/'));
  assert.equal(first.phase, 'registered', 'a child is registered and not started');
  return { r, start, first };
}
const nodeOf = (r, node) => [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node);
const planFile = (r, node) => join(r.t.runsDir, nodeOf(r, node).runId, 'deliverable.md');
const sit = (r, start) => runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
const stopsOf = (r, node) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === node);
const accepted = r => eventsOf(r).filter(e => e.event === 'plan_accepted');
const rebuilds = r => eventsOf(r).filter(e => e.event === 'node_bundle_rebuilt');
const decide = async (r, flags, answers) => {
  const io = terminal(answers); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).catch(e => 'threw').finally(() => clearTimeout(timer));
  return { code, errors: io.errors() };
};
/** Edit R/M1's plan with `fn`, let a real sitting open the stop, answer it with the person's accept form. */
async function editAndAccept(r, start, fn) {
  writeFileSync(planFile(r, 'R/M1'), fn(readFileSync(planFile(r, 'R/M1'), 'utf8')));
  await sit(r, start);
  const stop = stopsOf(r, 'R/M1').at(-1);
  assert.ok(stop && stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), 'a stop is open');
  const out = await decide(r, { 'accept-plan': true, stop: stop.id }, [stop.id, 'y']);
  assert.equal(out.code, 0, out.errors);
  clearStop(r.t.rootDir);
  return stop;
}
const inputsOf = r => join(r.t.rootDir, 'tree', 'inputs');
const ctxOf = (r, k) => readFileSync(join(inputsOf(r), bundleDirName(k.node, k.generation), 'context.md'), 'utf8');
const replacedOf = (r, k) => readdirSync(inputsOf(r)).filter(d => d.startsWith(`${bundleDirName(k.node, k.generation)}.replaced-`));
const A = t => t.replace('A plan.', 'A plan, changed once.');
const B = t => t.replace('A plan, changed once.', 'A plan, changed twice.');

test('[REBUILD] after a real accept the sitting rebuilds the registered child ONCE before it starts: new text, the record names what it was built from, the old input is moved aside, the child starts', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  const reg = eventsOf(r).find(e => e.event === 'node_registered' && e.node === first.node);
  assert.ok(Array.isArray(reg.builtFrom), 'the registration records builtFrom');
  assert.ok(reg.builtFrom.some(b => b.node === 'R/M1' && b.generation === 1 && b.eventId === null), 'builtFrom names the parent plan its text came from');
  await editAndAccept(r, start, A);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(nodeOf(r, first.node).phase, 'closed', 'the child started and closed on the rebuilt files');
  const [ev, ...more] = rebuilds(r).filter(e => e.node === first.node);
  assert.equal(more.length, 0, 'exactly one rebuild');
  const acc = accepted(r).at(-1);
  assert.deepEqual(ev.because, [{ node: 'R/M1', generation: 1, eventId: acc.id, acceptedBodySha256: acc.acceptedBodySha256 }]);
  assert.deepEqual(ev.builtFrom.find(b => b.node === 'R/M1'), { node: 'R/M1', generation: 1, eventId: acc.id });
  assert.notEqual(ev.previousBundleSha256, ev.bundleSha256);
  assert.match(ctxOf(r, first), /A plan, changed once\./);
  assert.equal(replacedOf(r, first).length, 1, 'the old input was moved aside, never deleted');
});

test('[REBUILD] A REVERT IS A BODY CHANGE: accept, then put the signed text back before any sitting: the rebuild names the revert, carries the SAME bundle hash as before, the original text is back, and the child starts', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  const original = readFileSync(planFile(r, 'R/M1'), 'utf8');
  const registeredHash = nodeOf(r, first.node).bundleSha256;
  await editAndAccept(r, start, A);
  writeFileSync(planFile(r, 'R/M1'), original);
  await sit(r, start);
  const stop2 = stopsOf(r, 'R/M1').at(-1);
  assert.equal((await decide(r, { 'accept-plan': true, stop: stop2.id }, [stop2.id, 'y'])).code, 0);
  clearStop(r.t.rootDir);
  assert.deepEqual(accepted(r).map(e => e.revert === true), [false, true]);
  assert.equal(bodyEventsNewerThanBuild(stateOf(readTreeRecord(r.t.rootDir)), nodeOf(r, first.node)).length, 1, 'the revert is a body change the bundle has not seen');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const ev = rebuilds(r).filter(e => e.node === first.node);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].because[0].eventId, ev[0].previousBundleSha256, ev[0].bundleSha256], [accepted(r).at(-1).id, registeredHash, registeredHash]);
  assert.equal(nodeOf(r, first.node).phase, 'closed');
  assert.match(ctxOf(r, first), /A plan\./);
});

test('[REBUILD] CRASHED REBUILD, THEN A SECOND ACCEPT: the folder holds derivation #1, the registration the original, the fresh derivation is #2: no stop, no blocked record; the folder is replaced (the crashed one is kept aside) and the child starts on #2', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  const registeredHash = nodeOf(r, first.node).bundleSha256;
  await editAndAccept(r, start, A);
  assert.throws(() => rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work, deps: { afterWrite: () => { throw new Error('crash after the files, before the event'); } } }), /crash after the files/);
  assert.equal(rebuilds(r).length, 0, 'no event: the crash came first');
  await editAndAccept(r, start, B);
  const blockedBefore = eventsOf(r).filter(e => e.event === 'blocked').length;
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const ev = rebuilds(r).filter(e => e.node === first.node);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].previousBundleSha256, registeredHash, 'built from the registered original');
  assert.equal(ev[0].because[0].eventId, accepted(r).at(-1).id);
  assert.match(ctxOf(r, first), /A plan, changed twice\./);
  assert.equal(eventsOf(r).filter(e => e.event === 'blocked').length, blockedBefore, 'PIN (holds with no rebuild at all; blocked records come only from refusals): no blocked record, no stop');
  assert.ok(replacedOf(r, first).length >= 2, 'the original and the crashed rebuild are both kept aside');
  assert.equal(nodeOf(r, first.node).phase, 'closed', 'PIN (a child that is allowed to start closes on the mock chain)');
});

test('[REBUILD] CRASHED REBUILD, THEN A PLAIN SITTING: the files are already the fresh derivation, so the sitting appends ONLY the event (nothing is moved aside again)', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  const registeredHash = nodeOf(r, first.node).bundleSha256;
  await editAndAccept(r, start, A);
  assert.throws(() => rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work, deps: { afterWrite: () => { throw new Error('crash'); } } }), /crash/);
  const asideAfterCrash = replacedOf(r, first).length;
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const ev = rebuilds(r).filter(e => e.node === first.node);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].previousBundleSha256, registeredHash);
  assert.equal(replacedOf(r, first).length, asideAfterCrash, 'PIN of EXISTING behaviour (e55a378 src/tree-derive.js:365, `differsIn === null` -> written:false): the second pass found the files in place and moved nothing');
  assert.equal(nodeOf(r, first.node).phase, 'closed');
});

test('[REBUILD] THE START GUARD, through a REAL start: a plan accepted AFTER the sitting rebuilt (between the rebuild and the member\'s locked start) is refused at the member\'s start with `rebuild_due` (nothing claimed, no provider call, no run folder left behind); the next sitting rebuilds again and the child starts', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  await editAndAccept(r, start, A);
  let slipped = false;
  // the slip window: the sitting has rebuilt and is about to start the member; a second accept lands in it (the starter is called by the sitting right after the rebuild)
  const slipping = async args => {
    if (!slipped) {
      slipped = true;
      writeFileSync(planFile(r, 'R/M1'), B(readFileSync(planFile(r, 'R/M1'), 'utf8')));
      {
        // the sitting's own detector for a changed plan (the blocked-child stop), called here because the sitting itself is busy starting this member
        const opened = openBlockedChildStops(r.t.rootDir, { verdict: computeReadiness(r.t.rootDir, { work: r.t.work }).verdict });
        const stop = opened.find(e => e.node === 'R/M1');
        assert.ok(stop, 'a stop opened on R/M1');
        acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: { gateId: 'g-test', shownSha256: 'a'.repeat(64) }, runsDir: r.t.runsDir });
      }
    }
    return start(args);
  };
  await runTree(r.t.rootDir, { work: r.t.work, startRun: slipping });
  assert.equal(slipped, true, 'the accept landed in the window');
  assert.equal(rebuilds(r).filter(e => e.node === first.node).length, 1, 'the first sitting rebuilt once (accept #1)');
  assert.equal(nodeOf(r, first.node).phase, 'registered', 'the member did not start');
  const refused = eventsOf(r).filter(e => e.event === 'blocked' && e.check === 'rebuild_due');
  assert.equal(refused.length, 1, 'the locked start refused with rebuild_due');
  assert.match(refused[0].detail, /was accepted or put back after this sub-plan's input was built, so the input is not built from the plan as it stands\. Nothing was started: run `council tree resume .*` again; it rebuilds the input from the plan first, or says why it cannot\.$/);   // EDITED in the M7 apply (E179b; one accepted plan: "was"; old: "...again and the input is rebuilt from the plan first.")
  assert.equal(eventsOf(r).filter(e => e.event === 'node_started' && e.node === first.node).length, 0, 'nothing was claimed');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(rebuilds(r).filter(e => e.node === first.node).length, 2, 'the next sitting rebuilt again');
  assert.equal(nodeOf(r, first.node).phase, 'closed');
  assert.match(ctxOf(r, first), /A plan, changed twice\./);
});

test('[REBUILD] CONDITION A, a PROVIDER\'s accept: a consumer registered (not started) with dependsOn on a provider is rebuilt when the PROVIDER\'s plan is accepted; its builtFrom names the provider (the plan whose text is in part 3), and the new provider text is in its context.md', { timeout: 300_000 }, async () => {
  const r = await realRoot({ ...pricedChildren() });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...d.preview, boundSha256: d.boundSha256 });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: d.frontierKey, revision: 1, boundSha256: d.boundSha256 });
  const k1 = registerNextChild(r.t.rootDir, { work: r.t.work });
  writeFileSync(join(r.t.work, 'k1-plan.md'), '# The provider plan\n\n## Overview\nThe store keeps every record.\n\nREVISED MOCK DELIVERABLE\n');
  const res = await api.run({ chain: r.t.childChain, task: join(k1.bundleDir, 'task.md'), criteria: join(k1.bundleDir, 'criteria.json'), context: join(k1.bundleDir, 'context.md'), runId: k1.runId, treeNode: join(k1.bundleDir, 'node.json'), draft: 'k1-plan.md', rounds: 1, maxUsd: k1.grantUsd, cwd: r.t.work });
  assert.equal(res.exitCode, 0, res.outputTail);
  const k2 = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(k2.kind, 'registered', JSON.stringify(k2));
  const reg = k2.event;
  assert.ok(Array.isArray(reg.builtFrom), 'the registration records builtFrom');
  assert.ok(reg.builtFrom.some(b => b.node === 'R/M1') && reg.builtFrom.some(b => b.node === 'R'), 'the registration records the provider and the parent it was built from');
  const NEW = 'The store keeps every record for a year.';
  const deliverable = join(r.t.runsDir, k1.runId, 'deliverable.md');
  writeFileSync(deliverable, readFileSync(deliverable, 'utf8').replace('The store keeps every record.', NEW));
  const opened = openBlockedChildStops(r.t.rootDir, { verdict: computeReadiness(r.t.rootDir, { work: r.t.work }).verdict });
  const stop = opened.find(e => e.node === 'R/M1');
  assert.ok(stop, 'a stop opened on the provider');
  acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: { gateId: 'g-test', shownSha256: 'a'.repeat(64) }, runsDir: r.t.runsDir });
  const acc = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'plan_accepted').at(-1);
  const out = rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work });
  assert.equal(out.kind, 'rebuilt', JSON.stringify(out));
  assert.deepEqual(out.event.because, [{ node: 'R/M1', generation: 1, eventId: acc.id, acceptedBodySha256: acc.acceptedBodySha256 }]);
  assert.ok(readFileSync(join(out.bundleDir, 'context.md'), 'utf8').includes(NEW), 'the dependent\'s part 3 quotes the accepted provider text');
});

test('[REBUILD, pin: no red of its own, true by construction] A REGENERATED PARENT (14.11 item 2): after the stop is answered with a NEW PLAN the registered children are DEAD; nothing is due for them and the rebuild leaves their folder untouched and writes no event, whatever is accepted on the new generation', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  writeFileSync(planFile(r, 'R/M1'), A(readFileSync(planFile(r, 'R/M1'), 'utf8')));
  await sit(r, start);
  const stop = stopsOf(r, 'R/M1').at(-1);
  const out = await decide(r, { stop: stop.id }, ['Rewrite the overview.\n.', stop.id, 'y']);
  assert.equal(out.code, 0, out.errors);
  clearStop(r.t.rootDir);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  const state = stateOf(readTreeRecord(r.t.rootDir));
  assert.ok(deadKeys(state).has(`${first.node}@g${first.generation}`), 'the old child is dead');
  const folder = join(inputsOf(r), bundleDirName(first.node, first.generation));
  const hashBefore = bundleSha256Of(folder);
  assert.deepEqual(bodyEventsNewerThanBuild(state, state.nodes.get(`${first.node}@g${first.generation}`)), [], 'nothing is due for a child that watches the OLD generation');
  assert.deepEqual(rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work }), { kind: 'none' });
  assert.equal(bundleSha256Of(folder), hashBefore, 'the dead child\'s folder is untouched');
  assert.equal(rebuilds(r).length, 0);
});

test('[REBUILD] THE WRITE ORDER: the table is asked about the event BEFORE any file is written: a rebuild the table refuses (here, a sticky block on the tree) leaves the input folder byte for byte as it was, nothing moved aside, no event', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  await editAndAccept(r, start, A);
  appendTreeEvent(r.t.rootDir, parentChangedEvent({ scope: `${first.node}@g${first.generation}`, frontierKey: nodeOf(r, first.node).frontierKey, detail: 'test: a parent changed', ancestor: 'R/M1' }));
  assert.ok(stateOf(readTreeRecord(r.t.rootDir)).sticky.size > 0, 'the tree is blocked');
  const folder = join(inputsOf(r), bundleDirName(first.node, first.generation));
  const before = bundleSha256Of(folder); const names = readdirSync(inputsOf(r)).sort().join(',');
  let out; try { out = rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work }); } catch (e) { out = { kind: 'threw', detail: e.message }; }
  // the folder is looked at FIRST (15 Oct 2026, re-red: with the table asked AFTER the write the call throws at the final append, and the folder had already been replaced)
  assert.equal(bundleSha256Of(folder), before, 'the folder is byte for byte as it was');
  assert.equal(readdirSync(inputsOf(r)).sort().join(','), names, 'nothing was moved aside or added');
  assert.equal(rebuilds(r).length, 0);
  assert.equal(out.kind, 'refused', JSON.stringify(out));
  assert.match(out.detail, /the tree is blocked/);
  // D2 F13g S12 (A-DRAFT; lane T, G5+6): the way out names the close and nothing without a command. RED at f7ccc764: the detail ended "... --close <scope>`) or answer the plan it quotes with a new plan."
  assert.ok(out.detail.endsWith(` The sub-plan is not started. Close it (\`council tree decide ${basename(r.t.rootDir)} --close ${first.node}@g${first.generation}\`).`), out.detail);
  assert.doesNotMatch(out.detail, /answer the plan it quotes/);
});

test('[REBUILD] THE LOCKED BACKSTOP: `continuationRefusal` (the locked start) refuses with rebuild_due when a plan the input quotes changed since it was built, reading the record only, and not after the rebuild', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
// CHANGED ACCEPTED (already-false unit, Q3; C&C thcmcp-cd 24 Okt 2026): continuationRefusal now REFUSES a null `chainPath` when the node registered a chain hash (it used to skip the chain check). OLD: `chainPath: null`. NEW: the chain file of this fixture's registered chain (the file whose hash the registration holds), so the chain check really runs and passes. WHY: a null path with a registered hash is now a refusal; the test is about the check that FOLLOWS the chain check, which must still be reached.
  const refusal = () => { const record = readTreeRecord(r.t.rootDir); const state = stateOf(record); const node = state.nodes.get(`${first.node}@g${first.generation}`); const registered = record.events.find(e => e.event === 'node_registered' && e.node === first.node); const chainPath = [join(r.t.work, 'chains', `${registered.chain.name}.json`), join(dirname(fileURLToPath(import.meta.url)), '..', 'chains', `${registered.chain.name}.json`)].find(existsSync); return continuationRefusal({ rootDir: r.t.rootDir, record, state, node, registered, chainPath, work: r.t.work, deps: { ancestorCheck: () => null } }); };
  assert.equal(refusal(), null, 'nothing is due before an accept');
  await editAndAccept(r, start, A);
  assert.equal(refusal()?.check, 'rebuild_due');
  assert.equal(rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work }).kind, 'rebuilt');
  assert.equal(refusal(), null, 'right after the rebuild nothing is due');
});

test('[REBUILD] THE TABLE: a hand-written node_bundle_rebuilt is refused unless a plan the input quotes changed, the node has not started, and `because` and `builtFrom` are exactly what the record holds', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  assert.ok(Array.isArray(first.builtFrom), 'the node carries the plans its input was built from (the fold)');
  const cand = (over = {}) => { const state = stateOf(readTreeRecord(r.t.rootDir)); const n = state.nodes.get(`${first.node}@g${first.generation}`); const due = bodyEventsNewerThanBuild(state, n); return { event: 'node_bundle_rebuilt', node: n.node, generation: n.generation, runId: n.runId, previousBundleSha256: n.bundleSha256, bundleSha256: 'b'.repeat(64), bundleBytes: 10, because: due, builtFrom: builtFromOf(state, n.builtFrom), ...over }; };
  const why = e => transitionRefusal(stateOf(readTreeRecord(r.t.rootDir)), e)?.reason ?? null;
  assert.match(why({ ...cand(), because: [{ node: 'R/M1', generation: 1, eventId: 'e1', acceptedBodySha256: 'a'.repeat(64) }] }), /nothing to rebuild it from/, 'nothing changed yet');
  await editAndAccept(r, start, A);
  assert.equal(why(cand()), null, 'the right candidate passes');
  assert.match(why(cand({ previousBundleSha256: 'c'.repeat(64) })), /names the previous input bundle/);
  assert.match(why(cand({ grant: { amount: 1, unit: 'usd' } })), /carries no grant/);
  assert.match(why(cand({ because: [{ ...cand().because[0], acceptedBodySha256: 'd'.repeat(64) }] })), /must name exactly the newest plan change/);
  assert.match(why(cand({ builtFrom: [{ node: 'R/M1', generation: 1, eventId: null }] })), /not the ones the record holds now/, 'a builtFrom that still carries the OLD body event is not what the record holds');
  assert.match(why(cand({ builtFrom: [{ node: 'R', generation: 1, eventId: null }] })), /drops R\/M1@g1, a plan the input was built from/, 'a rebuild that drops a watched plan (its parent) would never hear of a later change to it');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.match(why({ ...cand(), because: [{ node: 'R/M1', generation: 1, eventId: 'e1', acceptedBodySha256: 'a'.repeat(64) }] }), /has started/);
});

// CHANGED ACCEPTED TEST (lane T, G2 commit 6, LB-3: C&C's ruling on the fresh-eyes read, 25 Okt 2026). BEFORE: the edit removing "## Overview" (which every child's context_refs name) was ACCEPTED and the rebuild then refused (ONE
// rebuild_refused record, the child held, `decide --close` the way out). AFTER: every accept of a plan with a verified split runs the one resolver against the accepted text, so that accept is itself refused, naming the child and the
// heading, and nothing is written: the plan the child quotes never loses the section. (The rebuild's own refusal stays for a section the accept cannot check: a provider body accepted without a heading its consumer quotes.)
test('[REBUILD] LB-3: an edit that removes a section the child quotes is REFUSED at the accept (the one resolver against the accepted text): nothing is accepted, rebuilt or moved, and the child\'s input is unchanged', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  const hashBefore = nodeOf(r, first.node).bundleSha256;
  writeFileSync(planFile(r, 'R/M1'), readFileSync(planFile(r, 'R/M1'), 'utf8').replace('## Overview', '## Summary'));
  await sit(r, start);
  const stop = stopsOf(r, 'R/M1').at(-1);
  assert.ok(stop && stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), 'a stop is open');
  const out = await decide(r, { 'accept-plan': true, stop: stop.id }, [stop.id, 'y']);
  assert.notEqual(out.code, 0, out.errors);
  assert.match(out.errors, /the changed plan breaks a reference of its own split: R\/M1\/M\d \(K\d\): .*Overview/);
  assert.equal(eventsOf(r).filter(e => e.event === 'plan_accepted').length, 0);
  assert.equal(rebuilds(r).length, 0);
  assert.equal(nodeOf(r, first.node).bundleSha256, hashBefore);
  assert.equal(replacedOf(r, first).length, 0, 'nothing was written or moved');
});

test('[REBUILD] WHICH PLANS ARE WATCHED (pure, on the fold): a bundle records the plans it was built from with the body event each carried; a newer event on THAT node and generation is due, a newer generation of the parent is not; an accept before the build is not', () => {
  const nodes = new Map([
    ['R/M1@g1', { node: 'R/M1', generation: 1, bodyHistory: [{ eventId: 'e40', accepted: 'a'.repeat(64) }] }],
    ['R/M1@g2', { node: 'R/M1', generation: 2, bodyHistory: [{ eventId: 'e99', accepted: 'b'.repeat(64) }] }],
    ['R/P@g1', { node: 'R/P', generation: 1, bodyHistory: [{ eventId: 'e20', accepted: 'c'.repeat(64) }, { eventId: 'e60', accepted: 'd'.repeat(64) }] }],
  ]);
  const state = { nodes, frontiers: new Map() };
  const n = { node: 'R/M1/M1', builtFrom: [{ node: 'R/M1', generation: 1, eventId: 'e40' }, { node: 'R/P', generation: 1, eventId: 'e20' }] };
  assert.deepEqual(bodyEventsNewerThanBuild(state, n), [{ node: 'R/P', generation: 1, eventId: 'e60', acceptedBodySha256: 'd'.repeat(64) }], 'only the plan changed since it was read; the NEWER GENERATION of the parent (e99) is not watched');
});

test('[REBUILD] READERS: no reader outside the fold takes the bundle hash from the node_registered event (it is the node\'s), and only src/tree-rebuild.js asks writeBundle to replace a registered node\'s bundle', () => {
  const root = new URL('../src/', import.meta.url).pathname;
  const hits = (re) => readdirSync(root).filter(f => f.endsWith('.js')).flatMap(f => [...readFileSync(join(root, f), 'utf8').matchAll(re)].map(() => f));
  assert.deepEqual(hits(/\b(?:registered|reg)\??\.bundleSha256\b/g).sort(), ['tree-continuation.js', 'tree-reuse-load.js'], 'only the two fallbacks to the registration (the node has no hash of its own)');
  assert.deepEqual([...new Set(hits(/writeBundle\([^)]*\{\s*rebuild:\s*true/g))], ['tree-rebuild.js']);
});

test('[REBUILD] CARRY (c): a hand-written plan_accepted WITHOUT `scan` is refused by the shape check before the table is asked (no TypeError)', async () => {
  const { r } = await notStartedTree();
  const n = nodeOf(r, 'R/M1');
  assert.throws(() => appendTreeEvent(r.t.rootDir, { event: 'plan_accepted', stopId: 'e1', node: 'R/M1', generation: 1, runId: n.runId, actor: 'person', previousBodySha256: 'a'.repeat(64), acceptedBodySha256: 'b'.repeat(64), splitSha256: null }), e => !(e instanceof TypeError && /Cannot read/.test(e.message)) && /scan/.test(e.message));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- 15 Oct 2026 (C&C): always due, unchanged and shortened sections
const sectionOfCtx = ctx => ctx.match(/heading "Overview" -----\n([\s\S]*?)----- end/)[1];
const labelShaOfCtx = ctx => ctx.match(/\(sha256 ([0-9a-f]{64})\), heading "Overview"/)[1];

test('[REBUILD] ALWAYS DUE (Muad: "Rebuild them"; C&C 15 Oct 2026): an accept that changes a part of the plan the child does NOT quote still rebuilds it ONCE: the quoted section is byte for byte the same, its label carries the new document hash, the old input is kept aside', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  const before = ctxOf(r, first); const registered = nodeOf(r, first.node).bundleSha256;
  await editAndAccept(r, start, t => t.replace('Small.', 'Small, mostly.'));
  const out = rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work });
  assert.equal(out.kind, 'rebuilt', JSON.stringify(out));
  const after = ctxOf(r, first);
  assert.equal(sectionOfCtx(after), sectionOfCtx(before), 'the quoted section is the same bytes');
  assert.notEqual(labelShaOfCtx(after), labelShaOfCtx(before), 'the label carries the sha256 of the whole accepted document');
  assert.notEqual(nodeOf(r, first.node).bundleSha256, registered, 'so the bundle hash moved');
  assert.equal(rebuilds(r).filter(e => e.node === first.node).length, 1);
  assert.equal(replacedOf(r, first).length, 1, 'N accepts before a child starts = N replaced-n folders (disk only)');
});

test('[REBUILD] A SHORTENED SECTION is a change (never "the same" by prefix): the rebuilt input holds the shorter section and not the tail that was cut', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  await editAndAccept(r, start, t => t.replace('A plan.', 'A plan. And a long tail that will be cut.'));
  assert.equal(rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work }).kind, 'rebuilt');
  assert.match(sectionOfCtx(ctxOf(r, first)), /long tail that will be cut/);
  await editAndAccept(r, start, t => t.replace('A plan. And a long tail that will be cut.', 'A plan. And'));
  assert.equal(rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work }).kind, 'rebuilt');
  const section = sectionOfCtx(ctxOf(r, first));
  assert.match(section, /A plan\. And\n+$/);
  assert.doesNotMatch(section, /long tail/);
  assert.equal(replacedOf(r, first).length, 2, 'two accepts, two folders kept aside');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- PREFLIGHT-TO-LOCK (gate page 14.13)
const bundleCtxHash = (r, k) => contextHashOf(contextBundleText(contextFileList(join(inputsOf(r), bundleDirName(k.node, k.generation), 'context.md'))));
const runFolderOf = (r, k) => join(r.t.runsDir, nodeOf(r, k.node).runId);
// the moved run folders live in the tree's own area (C&C 15 Oct 2026, ruling (b)): no run reader scans tree/replaced-runs
const asideDir = r => join(r.t.rootDir, 'tree', 'replaced-runs');
const asideRunFolders = (r, k) => (existsSync(asideDir(r)) ? readdirSync(asideDir(r)) : []).filter(d => d.startsWith(`${nodeOf(r, k.node).runId}.replaced-`));
const runsDirSuffixed = r => readdirSync(r.t.runsDir).filter(d => d.includes('.replaced-'));

test('[PREFLIGHT-TO-LOCK] WRITE-AFTER-REBUILD ORDER: run.json written AFTER the rebuild (the hash of the rebuilt input), then a second accept: the next sitting rebuilds again, moves the stale run folder aside (kept, never deleted) and starts the child FRESH; the tree\'s own folder is untouched', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  await editAndAccept(r, start, A);
  assert.equal(rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work }).kind, 'rebuilt');
  // what src/cli.js writes between the member's preflight and its locked start (cli.js writes run.json before memberStart): not drivable in-process between the two, so the file is written here with the hash the CLI would have computed
  const folder = runFolderOf(r, first);
  mkdirSync(folder); writeFileSync(join(folder, 'run.json'), JSON.stringify({ contextHash: bundleCtxHash(r, first), startedAt: 'test' }));
  await editAndAccept(r, start, B);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(asideRunFolders(r, first).length, 1, 'the stale run folder was moved aside, once');
  assert.ok(existsSync(join(asideDir(r), asideRunFolders(r, first)[0], 'run.json')), 'kept, not deleted, under tree/replaced-runs');
  assert.deepEqual(runsDirSuffixed(r), [], 'nothing suffixed is left in runs/, where list_runs and listRuns would show it');
  assert.equal(nodeOf(r, first.node).phase, 'closed', 'the child started fresh and finished');
  assert.match(ctxOf(r, first), /A plan, changed twice\./);
  assert.equal(JSON.parse(readFileSync(join(folder, 'run.json'), 'utf8')).contextHash, bundleCtxHash(r, first), 'the fresh start wrote the hash of the CURRENT input (the same function the CLI uses)');
  assert.ok(existsSync(join(r.t.rootDir, 'tree', 'tree.json')) || existsSync(join(r.t.rootDir, 'tree')), 'the tree record is where it was');
  assert.equal(eventsOf(r).filter(e => e.event === 'blocked' && e.check === 'run_folder_stale').length, 0, 'no blocked record on the plain move');
});

test('[PREFLIGHT-TO-LOCK] A FOLDER THAT HOLDS SPEND IS NEVER MOVED: one `blocked` (run_folder_stale), the folder and its usage file stay, a second sitting writes no second record', { timeout: 900_000 }, async () => {
  const { r, start, first } = await notStartedTree();
  await editAndAccept(r, start, A);
  assert.equal(rebuildRegisteredBundle(r.t.rootDir, { work: r.t.work }).kind, 'rebuilt');
  const folder = runFolderOf(r, first);
  mkdirSync(folder); writeFileSync(join(folder, 'run.json'), JSON.stringify({ contextHash: bundleCtxHash(r, first) })); writeFileSync(join(folder, 'draft.usage.json'), '{}');
  await editAndAccept(r, start, B);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(out.status, 'refused');
  assert.equal(out.check, 'run_folder_stale');
  assert.equal(asideRunFolders(r, first).length, 0, 'PIN for the location (nothing moves under either target, so no target-absent tree can fail it): not moved');
  assert.ok(existsSync(join(folder, 'draft.usage.json')), 'its spend file is where it was');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(eventsOf(r).filter(e => e.event === 'blocked' && e.check === 'run_folder_stale').length, 1);
  assert.equal(nodeOf(r, first.node).phase, 'registered');
});

test('[PREFLIGHT-TO-LOCK, pin: the none results are guarded by a precondition and a positive control] THE ROOT\'S OWN FOLDER IS NEVER MOVED, and a run.json with NO contextHash is left alone (the CLI trusts it: checkFrozenContext, so it is no hard lock)', { timeout: 300_000 }, async () => {
  const t = newTree({ cap: 100 });
  registerRoot(t.rootDir);
  writeFileSync(join(t.rootDir, 'run.json'), JSON.stringify({ contextHash: 'abcdef012345' }));
  { const st = stateOf(readTreeRecord(t.rootDir)); const act = st.nodes.get(st.active); assert.equal(`${act.node}@g${act.generation}:${act.phase}`, 'R@g1:registered', 'precondition: the active node is the registered root'); }
  assert.deepEqual(setAsideStaleRunFolder(t.rootDir), { kind: 'none' }, 'R generation 1: its run folder IS the tree\'s folder');
  assert.ok(existsSync(join(t.rootDir, 'tree')) && existsSync(join(t.rootDir, 'run.json')), 'tree/ and run.json are where they were');
  assert.deepEqual(readdirSync(t.runsDir).filter(d => d.includes('.replaced-')), [], 'nothing was moved aside');
  const { r, first } = await notStartedTree();
  const folder = runFolderOf(r, first);
  mkdirSync(folder); writeFileSync(join(folder, 'run.json'), JSON.stringify({ startedAt: 'test' }));
  assert.deepEqual(setAsideStaleRunFolder(r.t.rootDir), { kind: 'none' }, 'no contextHash: the CLI baselines it, nothing to move');
  assert.equal(asideRunFolders(r, first).length, 0);
  writeFileSync(join(folder, 'run.json'), JSON.stringify({ contextHash: 'abcdef012345' }));      // positive control: the same folder with a DIFFERING hash is moved, so the none above could have come out the other way
  assert.equal(setAsideStaleRunFolder(r.t.rootDir).kind, 'moved');
  assert.equal(asideRunFolders(r, first).length, 1, 'the control was moved into tree/replaced-runs');
  assert.deepEqual(runsDirSuffixed(r), [], 'and nothing suffixed sits in runs/');
});
