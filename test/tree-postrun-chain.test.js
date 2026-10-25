// 0.8.3 already-false unit, Q3 (Builder C, 24 Okt 2026; plan note Review/Build_0.8.3/m8/C_Q3_Plan_2026-10-24.md; C&C thcmcp-cd ruling "BOTH scopes"): the tree's chain check of a member's call. Two defects, one fix:
//   (a) continuationRefusal skipped the check when `chainPath` was null although the node registered a chain hash: it now REFUSES (fail closed), and a file that cannot be read says so ("null now" is gone);
//   (b) the post-run call of `council handoff --from-run` (cli.js) looked the member's own chain file up by the member's own chain name while the call sent `hConfigPath` (`--chain <other>` names another file): the check validated a file the call never uses. It now checks `hConfigPath`.
// Every state is made by the real CLI on the all-mock chain (`mock-budget`) over a registered node with a REAL input bundle (the fixture of test/tree-member-key-order.test.js); the only hand-made input is the named chain path of the unit rows. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as api from '../src/api.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { registerRoot, registerChildUnchecked } from '../src/tree-register.js';
import { bundleDirOf, bundleSha256Of, continuationRefusal } from '../src/tree-continuation.js';
import { IDS, ROOT_ID, approveFrontier, chainSha, cli, lineageFile, newTree, rootOpts } from './helpers/tree-fixture.js';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');       // the package's own chains/ (the files chainSha hashes)
const ENV = work => ({ PATH: process.env.PATH, HOME: work });
const records = t => readTreeRecord(t.rootDir).events;

/** A tree whose root ran, and the node R/M1 registered with a REAL bundle, then run to its end ($0): a closed member whose post-run call is `handoff --from-run`. */
async function closedMember() {
  const t = newTree({ cap: 200 });
  registerRoot(t.rootDir);
  assert.equal((await api.run(rootOpts(t))).exitCode, 0);
  const key = approveFrontier(t.rootDir, ['R/M1']);
  const bdir = bundleDirOf(t.rootDir, 'R/M1', 1); mkdirSync(bdir, { recursive: true });
  writeFileSync(join(bdir, 'task.md'), 'Plan a tiny change.\n');
  registerChildUnchecked(t.rootDir, { frontierKey: key, node: 'R/M1', generation: 1, runId: IDS[0], parentRunId: ROOT_ID, chain: { name: t.childChain, sha256: (t.shaIn ?? chainSha)(t.childChain) }, grant: { amount: 60, unit: 'usd' }, bundleSha256: bundleSha256Of(bdir) });
  const runDir = join(t.runsDir, IDS[0]);
  const done = spawnSync(process.execPath, [cli, '--chain', t.childChain, '--task', join(bdir, 'task.md'), '--run-id', IDS[0], '--max-usd', '30', '--tree-node', lineageFile(t.work, 'R/M1')], { cwd: t.work, encoding: 'utf8', env: ENV(t.work), timeout: 60_000 });
  assert.equal(done.status, 0, done.stdout + done.stderr);
  return { t, runDir };
}
// --max-usd 30: the member's chain is priced (mock-budget): its handoff call projects $8.63 over the $0.516 the run spent, so a cap of $5 stops the CONTROL before the tree check (box set-b46ec07e)
const handoff = (m, extra = []) => spawnSync(process.execPath, [cli, 'handoff', '--from-run', m.runDir, '--max-usd', '30', ...extra], { cwd: m.t.work, encoding: 'utf8', env: ENV(m.t.work), timeout: 60_000 });
const postRunClaims = t => records(t).filter(e => e.event === 'node_resumed' && e.node === 'R/M1' && e.purpose === 'post_run');
const chainRefusals = t => records(t).filter(e => e.event === 'blocked' && e.check === 'chain' && e.scope === 'R/M1@g1');

test('Q3 unit: continuationRefusal REFUSES a null chainPath, an unreadable one and a differently named file; the member\'s own file passes (control)', async () => {
  const { t } = await closedMember();
  const record = readTreeRecord(t.rootDir); const state = stateOf(record);
  const node = state.nodes.get('R/M1@g1');
  const registered = record.events.find(e => e.event === 'node_registered' && e.node === 'R/M1' && e.generation === 1);
  const ask = (chainPath, purpose = 'post_run') => continuationRefusal({ rootDir: t.rootDir, record, state, node, registered, lineage: null, inputs: null, chainPath, purpose, work: t.work, deps: { ancestorCheck: () => null } });
  const ownFile = join(PKG, 'chains', `${t.childChain}.json`);       // the registered chain: the file its hash was taken from
  assert.notEqual(ask(ownFile)?.check, 'chain', 'control: the member\'s own chain file passes the chain check');
  const none = ask(null);
  assert.equal(none?.check, 'chain', `a registered chain hash and no chain file is refused: ${JSON.stringify(none)}`);
  assert.match(none.detail, /^R\/M1@g1: no chain file was named for this call, so it cannot be checked against the one registered$/);
  const gone = ask(join(t.work, 'chains', 'vanished.json'));
  assert.equal(gone?.check, 'chain');
  assert.match(gone.detail, /^R\/M1@g1: the chain file vanished\.json cannot be read, so it cannot be checked against the one registered\. Restore it and run the command again$/);
  assert.doesNotMatch(gone.detail, /null now/);
  const other = join(PKG, 'chains', 'mock.json');
  const post = ask(other, 'post_run');
  assert.equal(post?.check, 'chain');
  assert.match(post.detail, /^R\/M1@g1: the chain file mock\.json is not the one registered \([0-9a-f]{12} registered, [0-9a-f]{12} now\)\. Without --chain the call uses the chain recorded for the node \(mock-budget\)$/);
  const run = ask(other, 'run');
  assert.equal(run?.check, 'chain');
  assert.doesNotMatch(run.detail, /Without --chain/, 'only a post-run call can leave out --chain');
});

test('Q3 real verb: `handoff --from-run <member> --chain <other>` is refused as a changed chain (exit 19, a blocked chain record, no call); without --chain the same call goes through and writes its post-run claim', async () => {
  const m = await closedMember();
  // the files a call writes: usage files, the HANDOFF files, the reservations line, the superseded copies (the run folder's lock files and run.log change with any process and are not the call)
  const callFiles = (dir = m.runDir, rel = '') => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = join(dir, e.name), name = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name === 'superseded' || rel.startsWith('superseded') ? callFiles(path, name) : [];
    return /\.usage\.json$|^HANDOFF|^handoff-from-run|^spend-reservations\.jsonl$/.test(e.name) || rel.startsWith('superseded') ? [`${name}:${createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12)}`] : [];
  }).sort();
  const beforeControl = callFiles();
  const control = handoff(m);
  assert.equal(control.status, 0, `control: the post-run call without --chain: ${control.stdout}${control.stderr}`);
  assert.equal(postRunClaims(m.t).length, 1, 'control: it wrote a node_resumed (post_run) claim: the driver reaches the tree check');
  const folderBefore = callFiles(); const eventsBefore = records(m.t).length;
  assert.notDeepEqual(folderBefore, beforeControl, 'control: a call that goes through changes these files (so the unchanged check below is not an empty one)');
  const r = handoff(m, ['--chain', 'mock']);
  assert.equal(r.status, 19, `the call with --chain mock is refused (exit 19): ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /the chain file mock\.json is not the one registered/);
  assert.match(r.stderr, /Without --chain the call uses the chain recorded for the node \(mock-budget\)\n/);
  assert.equal(chainRefusals(m.t).length, 1, 'ONE blocked record: continuation_refused / chain');
  assert.equal(postRunClaims(m.t).length, 1, 'no second post-run claim');
  assert.deepEqual(callFiles(), folderBefore, 'no call was made: no usage, HANDOFF, reservation or superseded file changed');
  assert.ok(records(m.t).length > eventsBefore && records(m.t).slice(eventsBefore).every(e => e.event === 'blocked'), 'only the refusal was written');
});
