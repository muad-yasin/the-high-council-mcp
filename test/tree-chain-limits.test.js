// 0.8.3 (Muad 23 Okt 2026, "2: ii"): a person accepts a changed PRICE LIMIT (a seat's own provider.max_price prompt/completion) in a chain file a tree pinned: `council tree decide <root> --accept-chain-limits <chain>`
// (src/tree-chain-limits.js). Rows: TL-1 the continuation check (limits-only difference names the command; any other difference is refused as before; an accepted file passes, only the latest accepted hash counts); TL-1b a limits-only copy under ANOTHER name gets no accept command (Q3);
// TL-2 the table (a person's answer only; amendments of one chain follow each other); TL-3 the form on a real tree: refusal before acceptance, the screen, the event, tree.json untouched, every depth of the file moves, and THE MONEY ROW:
// a frontier approved at the old limit, then a raise that moves the at-most, is refused at registration (ceiling_changed, src/tree-loop.js) until the person approves the new figure; TL-4 refusals ask nobody and write nothing;
// TL-5 the library under the lock re-reads the file; TL-6 the real CLI verb knows the flag (the `=` form needs src/cli.js VALUE_FLAGS), refuses without a terminal and writes nothing; TL-7 reuse is the third reader of the same fact:
// the reuse screen (src/tree-reuse-load.js) refuses a finished child while an edit of the limits is unaccepted and compares it `same` once accepted (F9 compares flags only, so there is nothing in src/tree-reuse.js to change). All-mock, $0.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Of } from '../src/thin-contract.js';
import { TREE_DIR, TREE_FILE, TreeRefusal, appendTreeEvent, readTreeRecord, startTree, stateOf } from '../src/tree-record.js';
import { EVENTS_SCHEMA, foldRecord, transitionRefusal } from '../src/tree-transitions.js';
import { continuationRefusal } from '../src/tree-continuation.js';
import { decideHandler } from '../src/tree-decide.js';
import { amendChainLimits, buildAcceptChainLimits } from '../src/tree-chain-limits.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { registerNextChild } from '../src/tree-loop.js';
import { makeRootTaskPin } from '../src/tree-task-pin.js';
import { realRoot } from './helpers/real-root.js';
import { pricedDebate } from './helpers/child-chains.js';
import { eventsOf } from './helpers/sitting.js';
import { presenceProblems } from './helpers/event-presence.js';
import { terminal } from './helpers/terminal.js';
import { runTree } from '../src/tree-run.js';
import { loadChainConfig } from '../src/tree-derive-load.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
const reuse = await import('../src/tree-reuse.js');
const loader = await import('../src/tree-reuse-load.js');
import { GATE_FIELDS, ROOT_ID, claim, hostnameOf } from './helpers/tree-fixture.js';

const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
const A = 'a'.repeat(64); const B = 'b'.repeat(64); const C = 'c'.repeat(64);

/** pricedDebate whose handoff seat (the one fixture seat with a price row, 1000/1000) carries its OWN limit. A limit above the row raises the chain's upper estimate (cost.js worstCaseOf). */
const pinnedDebate = (p, c) => { const d = pricedDebate(); return { ...d, seats: { ...d.seats, handoff: { ...d.seats.handoff, extra: { provider: { max_price: { prompt: p, completion: c } } } } } }; };
const NAME = 'pinned-debate';
async function pinnedTree() {
  const r = await realRoot({ childChain: NAME, extraChains: { [NAME]: pinnedDebate(1500, 1500) } });
  made.push(r.t.work);
  return r;
}
const chainFileOf = r => join(r.t.work, 'chains', `${NAME}.json`);
const writeChain = (r, p, c, more = {}) => writeFileSync(chainFileOf(r), JSON.stringify({ ...pinnedDebate(p, c), ...more, name: NAME }, null, 2));
const decide = (r, flags, answers) => {
  const io = terminal(answers);
  return { io, run: () => decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }) };
};
const amended = r => eventsOf(r).filter(e => e.event === 'chain_limits_amended');
const approveFrontier = r => {
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...d.preview, boundSha256: d.boundSha256 });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: d.frontierKey, revision: 1, boundSha256: d.boundSha256 });
  return d;
};

test('TL-1 the continuation check: a file that differs only in its seats\' price limits names the one command; any other difference is refused as before; an accepted file passes and only the latest accepted hash counts', async () => {
  const r = await pinnedTree();
  const text0 = readFileSync(chainFileOf(r), 'utf8'); const sha0 = sha256Of(text0);
  const record = () => readTreeRecord(r.t.rootDir);
  const registered = { chain: { name: NAME, sha256: sha0 } };
  const check = (path = chainFileOf(r)) => continuationRefusal({ rootDir: r.t.rootDir, record: record(), state: stateOf(record()), node: { node: 'R', generation: 1 }, registered, chainPath: path, work: r.t.work });
  assert.notEqual(check()?.check, 'chain', 'the file the tree registered passes the chain check');
  writeChain(r, 3000, 6000);
  const limitsOnly = check();
  assert.equal(limitsOnly.check, 'chain');       // red at 8c71d2b: the old words only ("is not the one registered")
  assert.match(limitsOnly.detail, /^R@g1: only the seats' price limits in pinned-debate\.json changed: to accept them, run `council tree decide .* --accept-chain-limits pinned-debate` at a terminal\.$/);
  assert.ok(limitsOnly.detail.length < 340, `short enough for council tree resume's 400-character line (${limitsOnly.detail.length})`);
  writeChain(r, 3000, 6000, { maxRounds: 9 });
  assert.match(check().detail, /is not the one registered \(/, 'a change of anything else keeps today\'s refusal');
  // accepted: the tree now accepts the new file, and ONLY that one
  writeChain(r, 3000, 6000);
  const d = decide(r, { 'accept-chain-limits': NAME }, [NAME, 'y']); assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.notEqual(check()?.check, 'chain', 'the accepted file passes for a node registered under the old one');
  writeChain(r, 1500, 1500);
  assert.equal(check().check, 'chain', 'the original file is no longer what the tree accepts');
});

// already-false unit, Q3 (C&C thcmcp-cd 24 Okt 2026, the advisor's flag): a post-run call can send a chain file of ANOTHER name (`--chain <other>`); a limits-only copy of the pinned chain saved under that name must not be offered `--accept-chain-limits` (accepting pins limits for a file the call does not send). Red on the old src: the words are offered for copy-of-pinned.json.
test('TL-1b the continuation check: a limits-only copy of the pinned chain under ANOTHER name is refused as a changed file, with no accept command (the registered chain\'s own file keeps the words)', async () => {
  const r = await pinnedTree();
  const sha0 = sha256Of(readFileSync(chainFileOf(r), 'utf8'));
  const record = () => readTreeRecord(r.t.rootDir);
  const registered = { chain: { name: NAME, sha256: sha0 } };
  const check = path => continuationRefusal({ rootDir: r.t.rootDir, record: record(), state: stateOf(record()), node: { node: 'R', generation: 1 }, registered, chainPath: path, work: r.t.work });
  writeChain(r, 3000, 6000);                                                       // a limits-only edit of the registered file
  const copy = join(dirname(chainFileOf(r)), 'copy-of-pinned.json');
  writeFileSync(copy, readFileSync(chainFileOf(r), 'utf8'));                       // the same limits-only text, under another name
  assert.match(check(chainFileOf(r)).detail, /^R@g1: only the seats' price limits in pinned-debate\.json changed: to accept them/, 'control: the registered chain\'s own file gets the accept command');
  const other = check(copy);
  assert.equal(other.check, 'chain');
  assert.match(other.detail, /^R@g1: the chain file copy-of-pinned\.json is not the one registered \([0-9a-f]{12} registered, [0-9a-f]{12} now\)$/, `a limits-only copy under another name is a changed file: ${other.detail}`);
  assert.doesNotMatch(other.detail, /accept-chain-limits/);
});

test('TL-2 the table: a person\'s answer only, and one chain\'s amendments follow each other', () => {
  const base = { schema: EVENTS_SCHEMA, at: new Date().toISOString() };
  const started = { ...base, id: 'e1', event: 'tree_started', treeId: ROOT_ID, treeJsonSha256: A };
  const ev = (id, extra = {}) => ({ ...base, id, event: 'chain_limits_amended', chain: NAME, fromSha256: A, toSha256: B, limitFreeSha256: C, fromLimits: [], toLimits: [], gateId: 'g1', shownSha256: A, actor: 'person', via: 'terminal', ...extra });
  const state = foldRecord([started]);
  assert.equal(state.started, true, 'fixture: the tree has started, so the refusals below are the event\'s own');
  assert.equal(transitionRefusal(state, ev('e2')), null);
  assert.match(transitionRefusal(state, ev('e2', { actor: 'session', via: 'mcp', reason: 'the user said yes' }))?.reason, /this answer is a person's only: the session cannot give it/);
  assert.match(transitionRefusal(state, ev('e2', { actor: undefined, via: undefined }))?.reason, /records who gave it/);
  assert.match(transitionRefusal(state, ev('e2', { toSha256: A }))?.reason, /nothing to amend/);
  const after1 = foldRecord([started, ev('e2')]);
  assert.equal(transitionRefusal(after1, ev('e3', { fromSha256: B, toSha256: C })), null, 'the next amendment starts from the hash the last one accepted');
  assert.match(transitionRefusal(after1, ev('e3', { fromSha256: A, toSha256: C }))?.reason, /were amended since they were read/);
});

test('TL-3 the form on a real tree, and THE MONEY ROW: the screen, the event, tree.json untouched, both depths of the file move; a frontier approved at the old limit is refused at registration once the at-most moved, until it is approved again', async () => {
  const r = await pinnedTree();
  const treeJson = () => readFileSync(join(r.t.rootDir, TREE_DIR, TREE_FILE));
  const before = treeJson();
  const entries = readTreeRecord(r.t.rootDir).tree.chains.filter(c => c.name === NAME);
  assert.equal(entries.length, 2); assert.ok(entries.every(c => /^[0-9a-f]{64}$/.test(c.limitFreeSha256) && c.priceLimits.length === 1), 'tree start recorded the hash without the limits and the limits themselves');
  const old = approveFrontier(r);
  writeChain(r, 3000, 3000);
  const attempt = () => { try { return registerNextChild(r.t.rootDir, { work: r.t.work }); } catch (e) { return { thrown: String(e.message) }; } };
  assert.match(JSON.stringify(attempt()), /is not the one the tree registered/, 'before the person accepts it the changed file is refused');
  const d = decide(r, { 'accept-chain-limits': NAME }, [NAME, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const shown = d.io.shown();
  assert.match(shown, /Accept changed price limits in the chain pinned-debate\?   \(tree /);
  assert.match(shown, /seats\.handoff \(mock\/mock-handoff-split-milestones\): prompt 1500 -> 3000\n.*seats\.handoff \(mock\/mock-handoff-split-milestones\): completion 1500 -> 3000/);
  assert.match(shown, /upper estimate \(priced for an input of up to [0-9.]+ KB\): \$[0-9.]+ before, \$[0-9.]+ after\./);
  assert.match(shown, /Who reads this file: depths 1, 2; /);
  assert.match(shown, /To approve, type the chain name: pinned-debate\n/);
  const [ev] = amended(r); assert.equal(amended(r).length, 1);
  assert.equal(ev.chain, NAME); assert.equal(ev.actor, 'person'); assert.equal(ev.toSha256, sha256Of(readFileSync(chainFileOf(r), 'utf8')));
  assert.deepEqual(ev.fromLimits, [{ path: ['seats', 'handoff'], limits: { prompt: 1500, completion: 1500 } }]);
  assert.deepEqual(ev.toLimits, [{ path: ['seats', 'handoff'], limits: { prompt: 3000, completion: 3000 } }]);
  assert.deepEqual(presenceProblems(amended(r)), [], 'the event carries its fields (event-presence audit: the real form is the writer)');
  assert.deepEqual(treeJson(), before, 'tree.json is byte-identical');
  const now = readTreeRecord(r.t.rootDir).tree.chains.filter(c => c.name === NAME);
  assert.ok(now.length === 2 && now.every(c => c.sha256 === ev.toSha256 && c.startedSha256 === ev.fromSha256), 'both depths that read the file moved together, the started hash is kept');
  assert.match(d.io.shown(), /Recorded: accept the price limits of chain pinned-debate\. Nothing was started and nothing was spent\. `council tree resume /);
  // THE MONEY ROW: approved at the old limit, the at-most moved with the raise: registration refuses (src/tree-loop.js ceiling_changed) and the frontier is shown again
  const refused = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([refused.kind, refused.check], ['refused', 'ceiling_changed'], JSON.stringify(refused));
  assert.match(refused.detail, /the most R\/M1@g1's chain can cost is [0-9.]+ now, not the [0-9.]+ the approval showed/);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.has('R/M1@g1'), false, 'nothing registered at the old approval');
  const fresh = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.ok(fresh.preview.children[0].ceilingUsd > old.preview.children[0].ceilingUsd, 'the approval screen now shows the higher upper estimate');
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...fresh.preview, boundSha256: fresh.boundSha256 });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: fresh.frontierKey, revision: 2, boundSha256: fresh.boundSha256 });
  assert.equal(registerNextChild(r.t.rootDir, { work: r.t.work }).kind, 'registered', 'approved again at the new figure, the child registers');
});

test('TL-4 refusals ask nobody and write nothing: a chain the tree does not name, a file that is the accepted one, a file changed in more than its limits, a tree that recorded no limit-free hash, a node with a live claim', async () => {
  const r = await pinnedTree();
  const events0 = eventsOf(r).length;
  const build = nameArg => buildAcceptChainLimits({ rootDir: r.t.rootDir, rootId: ROOT_ID, nameArg, work: r.t.work, facts: {} });
  assert.match(build('nope').refusal, /--accept-chain-limits: this tree names no chain "nope" \(its chains: .*pinned-debate/);
  assert.match(build(undefined).refusal, /needs the name of the chain/);
  assert.match(build(undefined).refusal, new RegExp(`\\(its chains: [^)]*${NAME}[^)]*\\): council tree decide ${ROOT_ID} --accept-chain-limits <chain>$`), build(undefined).refusal);       // red with src/tree-chain-limits.js of d057731: the line printed '<root>'
  assert.match(build(NAME).refusal, /pinned-debate\.json is the file the tree accepted: there is nothing to accept/);
  writeChain(r, 3000, 3000, { maxRounds: 9 });
  assert.match(build(NAME).refusal, /differs from the file the tree accepted in more than the price limits of its seats[^]*start a new tree with council tree start/);
  assert.equal(eventsOf(r).length, events0, 'nothing written by any of them');
  // a node with a live claim reads its chain while it runs: refused (a registered child whose claim is this very process)
  writeChain(r, 1500, 1500);       // the accepted file again, so the frontier can be approved and a child registered
  approveFrontier(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim(reg.node, reg.runId, process.pid, 1, hostnameOf()) });
  writeChain(r, 3000, 3000);
  assert.match(build(NAME).refusal, /R\/M1@g1 has a live claim \(pid \d+ on .*\): it reads its chain while it runs/);
  // a tree that was started before 0.8.3 recorded the limit-free hash: not amendable, said in words
  const work = mkdtempSync(join(tmpdir(), 'tl4-')); made.push(work);
  mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains')); writeFileSync(join(work, 'tasks', 'x.md'), 'Plan.\n');
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ name: 'c', seats: {} }));
  const sha = sha256Of(readFileSync(join(work, 'chains', 'c.json'), 'utf8'));
  const rootDir = join(work, 'runs', ROOT_ID);
  startTree(rootDir, { rootCapUsd: 5, rootTask: makeRootTaskPin(join(work, 'tasks', 'x.md'), work), chains: [0, 1, 2].map(depth => ({ depth, name: 'c', sha256: sha })) });
  assert.match(buildAcceptChainLimits({ rootDir, rootId: ROOT_ID, nameArg: 'c', work, facts: {} }).refusal, /did not record what c is without its price limits/);
});

test('TL-5 the library re-reads the file under the lock: a file that changed since the screen, or limits accepted since it was read, are refused with a record of the refusal', async () => {
  const r = await pinnedTree();
  writeChain(r, 3000, 3000);
  const first = buildAcceptChainLimits({ rootDir: r.t.rootDir, rootId: ROOT_ID, nameArg: NAME, work: r.t.work, facts: {} });
  assert.ok(first.apply, first.refusal);
  writeChain(r, 4000, 4000);       // changed while the person read
  assert.throws(() => first.apply({ gateId: GATE_FIELDS.gateId, shownSha256: GATE_FIELDS.shownSha256, actor: 'person', via: 'terminal' }), e => e instanceof TreeRefusal && /changed while you read it/.test(e.reason));
  assert.equal(amended(r).length, 0);
  assert.equal(eventsOf(r).filter(e => e.event === 'blocked' && e.check === 'accept_chain_limits').length, 1, 'the refusal is recorded');
  const second = buildAcceptChainLimits({ rootDir: r.t.rootDir, rootId: ROOT_ID, nameArg: NAME, work: r.t.work, facts: {} });
  second.apply({ gateId: GATE_FIELDS.gateId, shownSha256: GATE_FIELDS.shownSha256, actor: 'person', via: 'terminal' });
  assert.equal(amended(r).length, 1);
  const e1 = readTreeRecord(r.t.rootDir).tree.chains.find(c => c.name === NAME);
  writeChain(r, 5000, 5000);
  const stale = { chain: NAME, fromSha256: e1.startedSha256, toSha256: sha256Of(readFileSync(chainFileOf(r), 'utf8')), limitFreeSha256: e1.limitFreeSha256, fromLimits: [], toLimits: [], work: r.t.work, gateId: GATE_FIELDS.gateId, shownSha256: GATE_FIELDS.shownSha256, actor: 'person', via: 'terminal' };
  assert.throws(() => amendChainLimits(r.t.rootDir, stale), e => e instanceof TreeRefusal && /were accepted since you read them/.test(e.reason), 'a screen read before another acceptance is refused');
});

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
test('TL-6 THE REAL VERB: `council tree decide <root> --accept-chain-limits=<chain>` is a known option (the `=` form splits only if src/cli.js lists it), an unknown chain is refused in words (exit 1), a limits-only edit with no terminal is refused for want of a person (exit 2), and neither writes anything', { timeout: 120_000 }, async () => {
  const r = await pinnedTree();
  const events0 = eventsOf(r).length;
  const cli = args => spawnSync(process.execPath, [CLI, 'tree', 'decide', ROOT_ID, ...args], { cwd: r.t.work, encoding: 'utf8', input: '', timeout: 60_000, env: { PATH: process.env.PATH, HOME: r.t.work } });
  const unknown = cli(['--accept-chain-limits=nope']);
  assert.equal(unknown.status, 1, unknown.stdout + unknown.stderr);       // red with src/cli.js of 6d902ac: the `=` form is not split and the option is refused as unknown (exit 2)
  assert.match(unknown.stderr, /this tree names no chain "nope"/);
  writeChain(r, 3000, 3000);
  const noTerminal = cli([`--accept-chain-limits=${NAME}`]);
  assert.equal(noTerminal.status, 2, noTerminal.stdout + noTerminal.stderr);
  assert.match(noTerminal.stderr, /gate answer needs a person at a terminal/);
  assert.equal(eventsOf(r).length, events0, 'nothing was written by either');
  assert.equal(amended(r).length, 0);
});

test('TL-7 reuse is the third reader of the same fact: a finished child whose chain file differs only in a price limit is not reusable until the person accepts the limits (the loader names the file), then every child compares `same` as before; a record without the limit-free hash, or a file changed in more than its limits, stays refused', async () => {
  const r = await pinnedTree(); approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.ok(out.started.length >= 2, JSON.stringify(out));
  const rootTaskPath = join(r.t.work, 'tasks', 'x.md'); const parent = { node: 'R', generation: 1 };
  const screen = () => {
    const rows = loader.loadChildren({ rootDir: r.t.rootDir, work: r.t.work, rootTaskPath, newParent: parent, oldParent: parent, slotGeneration: 2, eligibility: () => ({ eligible: true, why: null }), wholeBranch: () => true });
    const verdicts = reuse.compareChildren({ children: rows, ambiguousKeys: loader.newRootAmbiguousKeys({ rootDir: r.t.rootDir, newParent: parent }) });
    return { rows, verdicts: verdicts.map(v => [v.node, v.verdict, v.field]) };
  };
  const control = screen();
  assert.ok(control.verdicts.length >= 2 && control.verdicts.every(v => v[1] === 'same'), JSON.stringify(control.verdicts));
  writeChain(r, 3000, 3000);
  const before = screen();
  assert.ok(before.rows.every(c => /is not the one the tree registered \(sha256 differs\); only the seats' price limits in pinned-debate\.json changed/.test(c.oldProblem ?? '')), JSON.stringify(before.rows.map(c => c.oldProblem)));
  assert.ok(before.verdicts.every(v => v[1] === 'changed'), 'unaccepted: nothing is reused');
  const d = decide(r, { 'accept-chain-limits': NAME }, [NAME, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const after = screen();
  assert.deepEqual(after.verdicts, control.verdicts, 'accepted: the finished children are reusable, exactly as before the raise');
  assert.ok(after.rows.every(c => c.oldProblem === null && c.old), JSON.stringify(after.rows.map(c => c.oldProblem)));
  // a record that kept no limit-free hash cannot tell a limits-only edit from any other: the raw compare refuses it
  const tree = readTreeRecord(r.t.rootDir).tree;
  const noHash = { ...tree, chains: tree.chains.map(({ limitFreeSha256, priceLimits, ...rest }) => ({ ...rest, sha256: rest.startedSha256 })) };       // the entry as a tree started before the limit-free hash recorded it: the hash of the file it started with (limits 1500), none of the limits-only words
  assert.throws(() => loadChainConfig({ tree: noHash, depth: 1, work: r.t.work }), /is not the one the tree registered \(sha256 differs\)$/);
  // the file changed in more than its limits: refused again, with no sentence about limits
  writeChain(r, 4000, 4000, { maxRounds: 9 });
  const wider = screen();
  assert.ok(wider.rows.every(c => /is not the one the tree registered \(sha256 differs\)\)?$/.test(c.oldProblem ?? '') && !/price limits/.test(c.oldProblem)), JSON.stringify(wider.rows.map(c => c.oldProblem)));
});
