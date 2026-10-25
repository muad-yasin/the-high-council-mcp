// 0.8.3 M6 S5b part B, commit 1 (B's contract 3.7 and section 8 S5b-7; C&C gate 1 ruling 2): ONE source for a tree's personal-data mode (tree.json `piiGate`, read by src/tree-pii-mode.js) and ONE enforcer at the member
// (src/tree-member.js memberStart): a member started under another mode than the tree's is refused with exit 19, a `blocked` record of reason `pii_mode_mismatch` and no claim, no provider call. The starter (src/tree-run.js apiStarter) passes the
// mode, so the normal path never mismatches. Real trees on the all-mock chain, $0. TRAP (B's note): a hand-edited tree.json also breaks the record's hash, so the `unusable` fixture rewrites the `tree_started` hash to match and the tests assert the REASON.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { memberStart } from '../src/tree-member.js';
import { registerNextChild } from '../src/tree-loop.js';
import { runTree } from '../src/tree-run.js';
import { bundleDirOf } from '../src/tree-continuation.js';
import { sha256Of } from '../src/thin-contract.js';
import * as api from '../src/api.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, eventsOf } from './helpers/sitting.js';

// a real root with a mode, its first child REGISTERED (not started)
async function registeredChild(over = {}) {
  const r = await trackedRealRoot({ ...pricedChildren(), ...over }); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  const bundle = bundleDirOf(r.t.rootDir, reg.node, reg.event.generation);
  const lineage = JSON.parse(readFileSync(join(bundle, 'node.json'), 'utf8'));
  const start = (piiGate, piiAllow = []) => memberStart({ runDir: join(r.t.runsDir, reg.runId), runId: reg.runId, lineage, purpose: 'run', capAskedUsd: reg.grantUsd, chainPath: join(r.t.work, 'chains', 'priced-debate.json'),
    inputs: { task: join(bundle, 'task.md'), criteria: join(bundle, 'criteria.json'), context: join(bundle, 'context.md') }, piiGate, piiAllow, allowSecretShaped: false, ceiling: null, work: r.t.work });
  return { r, reg, bundle, start };
}
const mismatches = r => eventsOf(r).filter(e => e.event === 'blocked' && e.reason === 'pii_mode_mismatch');

test('the member enforces the tree\'s mode: a hard-stop tree refuses a member started with no flag or with warn (exit 19 path: TreeRefusal pii_mode_mismatch, a blocked record naming both, no claim), accepts hard-stop', () => {
  return registeredChild({ piiGate: 'hard-stop' }).then(({ r, start }) => {
    for (const [given, said] of [[null, /without --pii-gate, but this tree's personal-data mode is hard-stop/], ['warn', /with --pii-gate warn, but this tree's personal-data mode is hard-stop/]]) {
      assert.throws(() => start(given), e => e.name === 'TreeRefusal' && e.code === 'pii_mode_mismatch' && said.test(e.reason));
    }
    assert.equal(mismatches(r).length, 2, 'each refusal wrote its own blocked record');
    assert.ok(mismatches(r).every(e => e.scope === 'R/M1@g1' && e.transition === 'node_started' && e.check === 'pii_mode'));
    assert.equal(eventsOf(r).filter(e => e.event === 'node_started' && e.node === 'R/M1').length, 0, 'no claim was written for the child');
    const ok = start('hard-stop'); assert.equal(ok.claim.event, 'node_started', 'the matching mode starts');
  });
});

test('a tree with NO mode refuses a member that brings one, and accepts a member with none (the strictness is not a way round: one source, one enforcer)', async () => {
  const { r, start } = await registeredChild();
  assert.throws(() => start('warn'), e => e.code === 'pii_mode_mismatch' && /with --pii-gate warn, but this tree's personal-data mode is off/.test(e.reason));
  assert.equal(mismatches(r).length, 1);
  assert.equal(start(null).claim.event, 'node_started');
});

test('an UNUSABLE field in tree.json (with a matching tree_started hash, the trap) is refused by REASON for every start, fail closed: damage is never read as "off"', async () => {
  const { r, start } = await registeredChild({ piiGate: 'hard-stop' });
  const file = join(treeDirOf(r.t.rootDir), 'tree.json');
  const text = readFileSync(file, 'utf8').replace('"piiGate": "hard-stop"', '"piiGate": 7');
  assert.notEqual(text, readFileSync(file, 'utf8'), 'the fixture changed the field');
  writeFileSync(file, text);
  const evFile = join(treeDirOf(r.t.rootDir), 'events.jsonl');
  const lines = readFileSync(evFile, 'utf8').split('\n'); const first = JSON.parse(lines[0]); first.treeJsonSha256 = sha256Of(text); lines[0] = JSON.stringify(first);
  writeFileSync(evFile, lines.join('\n'));
  assert.deepEqual(readTreeRecord(r.t.rootDir).corrupt, [], 'the record reads as sound: the hash matches');
  for (const given of [null, 'hard-stop', 'warn']) assert.throws(() => start(given), e => e.code === 'pii_mode_mismatch' && /unusable/.test(e.reason), String(given));
});

test('started BY HAND through the real CLI with no flag, a member of a hard-stop tree is refused with exit 19 (the claim never exists); the refusal leaves the node registered', async () => {
  const { r, reg, bundle } = await registeredChild({ piiGate: 'hard-stop' });
  const hand = await api.run({ chain: reg.event.chain.name, task: join(bundle, 'task.md'), criteria: join(bundle, 'criteria.json'), context: join(bundle, 'context.md'), runId: reg.runId, treeNode: join(bundle, 'node.json'), cwd: r.t.work, maxUsd: reg.grantUsd });
  assert.equal(hand.exitCode, 19, hand.outputTail);
  assert.equal(hand.status, 'tree_refused');
  assert.equal(mismatches(r).length, 1);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').phase, 'registered');
});

test('the STARTER passes the tree\'s mode: the sitting starts a member of a hard-stop tree through the real api.run, and its run.json says it ran under the mode', async () => {
  const { r } = await registeredChild({ piiGate: 'hard-stop' });
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1 });
  assert.deepEqual(out.started.map(s => [s.node, s.exitCode]), [['R/M1', 0]], JSON.stringify(out));
  const n = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  assert.equal(JSON.parse(readFileSync(join(r.t.runsDir, n.runId, 'run.json'), 'utf8')).piiGate?.mode, 'hard-stop', 'the run was started with the tree\'s mode');
  assert.equal(mismatches(r).length, 0);
});

test('a tree has NO allow-list (C&C F1): a member started by hand under the right mode but with --allow-pii is refused (exit 19 path: pii_mode_mismatch, no claim) - the types it would have suppressed are not its own to suppress; a missing list is a programming error, not a pass', async () => {
  const { r, start } = await registeredChild({ piiGate: 'hard-stop' });
  assert.throws(() => start('hard-stop', ['email', 'secret']), e => e.name === 'TreeRefusal' && e.code === 'pii_mode_mismatch' && /a tree member takes no --allow-pii/.test(e.reason) && /email,secret/.test(e.reason));
  assert.equal(mismatches(r).length, 1); assert.equal(eventsOf(r).filter(e => e.event === 'node_started' && e.node === 'R/M1').length, 0, 'no claim');
  assert.throws(() => start('hard-stop', null), TypeError);
  assert.equal(start('hard-stop', []).claim.event, 'node_started', 'the same member with an empty list starts');
});

test('the same, through the real CLI (member unit, 13 Oct 2026: refused EARLY, before run.json and with no tree record, because a refusal after run.json trapped the node on resume): `--pii-gate hard-stop --allow-pii email,secret` on a member of a hard-stop tree exits 2 with the allow-list sentence; no claim, no provider call, nothing written; memberStart keeps its own refusal above as the backstop', async () => {
  const { r, reg, bundle } = await registeredChild({ piiGate: 'hard-stop' });
  const cli = resolve(new URL('../src/cli.js', import.meta.url).pathname);
  const args = [cli, '--chain', reg.event.chain.name, '--task', join(bundle, 'task.md'), '--run-id', reg.runId, '--max-usd', String(reg.grantUsd), '--context', join(bundle, 'context.md'), '--criteria', join(bundle, 'criteria.json'), '--tree-node', join(bundle, 'node.json'), '--pii-gate', 'hard-stop', '--allow-pii', 'email,secret'];
  const out = spawnSync(process.execPath, args, { cwd: r.t.work, encoding: 'utf8' });
  assert.equal(out.status, 2, out.stderr);
  assert.match(out.stderr, /--allow-pii: a tree member takes no --allow-pii of its own/);   // CHANGED ACCEPTED (19 Okt 2026, PII stop unit): OLD /--allow-pii: a tree has no allow-list/. WHY: a person now CAN allow after seeing (tree decide --allow-pii-node), so the sentence names that way instead of saying a tree has none; the member's own flag is still refused (exit 2)
  assert.equal(mismatches(r).length, 0, 'a typed flag appends nothing to the record');
  assert.equal(eventsOf(r).filter(e => e.event === 'node_started' && e.node === 'R/M1').length, 0);
});
