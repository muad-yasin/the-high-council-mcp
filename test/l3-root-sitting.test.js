// 0.8.4 L3 fix-up (a3): the FIRST sitting of a tree's root (`tree resume` on a root whose run never started) builds its `awaiting_choice` result from the root's exit code (src/tree-resume.js); it now carries the stop the root waits at,
// so the sitting line says what a member's does: the clause for a finish, and no --continue-node at a stall with no pass left. The root starter is a stub that writes report-partial.json into the root's folder and answers exit 23
// ($0, nothing is spent); the fixture is that of test/tree-resume-root.test.js (T3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { configSha256 } from '../src/tree-continuation.js';
import { DEFAULT_HANDLERS, treeCommand } from '../src/tree-cli.js';
import { startTree } from '../src/tree-record.js';
import { registerRoot } from '../src/tree-register.js';
import { makeRootTaskPin } from '../src/tree-task-pin.js';
import { resumeHandler } from '../src/tree-resume.js';
import { installSplitRoot } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const ID = '2026-10-12T10-00-00-000Z';
const io = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); let o = ''; let e = ''; stdout.on('data', d => { o += d; }); stderr.on('data', d => { e += d; }); return { stdin: new PassThrough(), stdout, stderr, out: () => o, err: () => e }; };
function interruptedS3() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-l3-root-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  installSplitRoot(dir);
  writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  const rootDir = join(dir, 'runs', ID);
  const chains = [['split-root', 0], ['priced-debate', 1], ['priced-debate', 2]].map(([name, depth]) => ({ depth, name, sha256: configSha256(join(dir, 'chains', `${name}.json`)) }));
  startTree(rootDir, { rootCapUsd: 5, chains, rootTask: makeRootTaskPin(join(dir, 'tasks', 'x.md'), dir) });
  mkdirSync(join(rootDir, 'tree', 'inputs', 'R@g1'), { recursive: true });
  writeFileSync(join(rootDir, 'tree', 'inputs', 'R@g1', 'node.json'), `${JSON.stringify({ treeId: ID, node: 'R', generation: 1, attempt: 1, parentNode: null, depth: 0, splitSha256: null, bundleSha256: null }, null, 2)}\n`);
  registerRoot(rootDir);
  return { dir, rootDir };
}
const forbidden = () => { throw new Error('the sitting must not start or resume a node here'); };
const row = (layer, round, state) => ({ round, layer, state, labs: [`lab${layer}`] });
async function firstSitting(partial, exitCode = 23) {
  const t = interruptedS3(); const d = io();
  const startRootRun = async () => { if (partial) writeFileSync(join(t.rootDir, 'report-partial.json'), JSON.stringify(partial)); return { exitCode }; };
  const code = await treeCommand(['resume', ID], { work: t.dir, ...d, handlers: { ...DEFAULT_HANDLERS, resume: ctx => resumeHandler({ ...ctx, deps: { startRootRun, startRun: forbidden, resumeRun: forbidden } }) } });
  return { code, text: d.out() + d.err() };
}

test('L3-R1 the ROOT\'s first sitting: a stall with no pass left offers no --continue-node and the finish parenthesis says layer 3 did not sign off; an overseer_cap stop says it with "the top layer"; no readable stop reads exactly as before', async () => {
  const none = await firstSitting({ stop: { kind: 'stall_stop', why: 'last_pass', top_layer: 3, pass: 2, overseer_round: 0, pass_left: false, stalled: [] }, layers: [row(1, 2, 'objected'), row(2, 2, 'not_asked'), row(3, 2, 'not_asked')] });
  assert.ok(none.text.includes('No pass is left, so there is no `--continue-node`. Your choice: `council tree decide '), none.text);
  assert.ok(none.text.includes('the result stays not agreed, and layer 3 did not sign off on this plan); then'), none.text);
  assert.doesNotMatch(none.text, /tree decide \S+ --continue-node R/);
  const cap = await firstSitting({ stop: { kind: 'overseer_cap', pass: 4, overseer_round: 3, rounds: 3, cap: 3 }, layers: [row(1, 4, 'signed_off'), row(2, 4, 'signed_off'), row(3, 4, 'objected')] });
  assert.ok(cap.text.includes('the result stays not agreed, and the top layer did not sign off on this plan); then'), cap.text);
  assert.match(cap.text, /tree decide \S+ --continue-node R/, 'a pass is left: continue is offered');
  // exit 25 (the decider asked for the person) maps to the same status; its stop is a conflict stop, which must not get the round-stop clause (PIN: green on both trees; the older gap that a root's conflict stop gets the round-stop "Your choice" line is not touched here)
  const conflict = await firstSitting({ stop: { kind: 'conflict', pass: 3, overseer_round: 2 }, layers: [row(1, 3, 'signed_off'), row(2, 3, 'signed_off'), row(3, 3, 'objected')] }, 25);
  assert.doesNotMatch(conflict.text, /did not sign off/);
  const old = await firstSitting(null);
  assert.ok(old.text.includes('(the dispute stage and the handoff run, the result stays not agreed); then `council tree resume'), old.text);
  assert.doesNotMatch(old.text, /did not sign off/);
});
