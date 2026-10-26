// D1 RF-7 (14 Oct 2026, C&C: "the untested member mirror path gets a test in D1"): `handoff --from-run` on a REAL recursive-councils tree member (built by the shared fixture and a real `api.run` of the member, not a hand-written run.json; SG-14's fake lineage dies
// in memberStart before the call). The post-run call holds a node_resumed claim and mirrors its reservations into the tree's record. When the usage record cannot be written, the fresh worst-case line goes through the SAME mirror, so the tree's
// accounting counts it once, the claim is released, the handoff that was paid for is written, and the command exits 16. The tree's accounting GATE then fails closed on that call (`settlement_without_evidence`: a settled call with no usage file), exactly
// as it does for any call whose process died between settle and record: the worst-case line keeps the money in every total, and a person accepts the accounting before the tree goes on (pinned below as the one expected problem).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/api.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { budgetOf, gateTree } from '../src/tree-budget.js';
import { registerRoot } from '../src/tree-register.js';
import { unsettledReservations } from '../src/spend-reservations.js';
import { runSpentUsd } from '../src/spend.js';
import { root as repoRoot, cli, IDS, approveFrontier, newTree, registerKid, lineageFile, rootOpts } from './helpers/tree-fixture.js';

const mockDebate = () => JSON.parse(readFileSync(join(repoRoot, 'chains', 'mock-debate.json'), 'utf8'));
const pricedChain = () => { const c = mockDebate(); return { ...c, seats: { ...c.seats, handoff: { provider: 'mock', model: 'mock-priced', maxTokens: 50 } } }; };

test('RF-7 handoff on a real tree member whose usage record cannot be written: the worst-case line goes through the mirror, the claim is released, the handoff is written, exit 16; the accounting gate fails closed on the evidence-less settlement', async () => {
  const t = newTree({ cap: 100, childChain: 'priced-debate', extraChains: { 'priced-debate': pricedChain() } });
  registerRoot(t.rootDir);
  assert.equal((await api.run(rootOpts(t))).exitCode, 0);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); registerKid(t, key, 'R/M1', IDS[0], 50);
  assert.equal((await api.run({ chain: 'priced-debate', task: 'tasks/x.md', cwd: t.work, runId: IDS[0], treeNode: lineageFile(t.work, 'R/M1'), maxUsd: 50 })).exitCode, 0);
  const memberDir = join(t.runsDir, IDS[0]);
  const earlier = runSpentUsd(memberDir);
  const filesBefore = readdirSync(memberDir);
  writeFileSync(join(memberDir, 'superseded'), 'in the way');                 // recordCall's mkdirSync throws EEXIST after the call returned
  const r = spawnSync(process.execPath, [cli, 'handoff', '--from-run', memberDir, '--max-usd', '30'], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work } });
  assert.equal(r.status, 16, r.stdout + r.stderr);
  assert.match(r.stderr, /^handoff: the call was made, but its cost could not be recorded \(EEXIST\)\. This run's total now counts it at its worst case, \$[0-9.]+, because the real figure is not on disk; the provider's own bill has the real one\.\n/m);
  assert.match(r.stderr, /^handoff: the reply above was written\. This command exits 16 only because the cost of the call could not be recorded\.$/m);
  const un = unsettledReservations(memberDir);
  assert.equal(un.length, 1, 'one unsettled worst-case line in the member\'s run file');
  assert.ok(runSpentUsd(memberDir) > earlier, 'the member\'s total counts the call');
  const worst = Number(/worst case, \$([0-9.]+)/.exec(r.stderr)[1]);
  const fresh = readTreeRecord(t.rootDir).events.filter(e => e.event === 'reservation_mirrored' && e.runId === IDS[0] && e.line.event === 'reserved').pop().line;
  assert.ok(Math.abs(fresh.usd - worst) < 0.006, `the worst-case line reached the tree's record through the mirror (${fresh.usd} vs ${worst})`);
  // the standing question for the member path: the tree's figure for the member is the run folder's figure (once), not the run's figure plus the tree's own copy of the mirrored lines
  const b = budgetOf(t.rootDir); const mem = b.nodes.find(n => n.node === 'R/M1');
  assert.ok(Math.abs(mem.spentUsd - runSpentUsd(memberDir)) < 0.006, `the tree counts the member at the run folder's figure: ${mem.spentUsd} vs ${runSpentUsd(memberDir)}`);
  const g = gateTree(t.rootDir);
  assert.deepEqual(g.problems.map(p => p.code), ['settlement_without_evidence'], 'the gate fails closed on the one settlement that has no usage file, and on nothing else');
  const ev = readTreeRecord(t.rootDir).events.filter(e => e.node === 'R/M1');
  const resumed = ev.find(e => e.event === 'node_resumed'); const released = ev.find(e => e.event === 'node_released');
  assert.ok(resumed && resumed.purpose === 'post_run', 'the post-run claim was taken');
  assert.ok(released && ev.indexOf(released) > ev.indexOf(resumed), 'and released when the command ended');
  assert.equal(stateOf(readTreeRecord(t.rootDir)).active, null);
  const written = readdirSync(memberDir).filter(f => /^HANDOFF.*\.md$/.test(f) && !filesBefore.includes(f));
  assert.equal(written.length, 1, `the handoff that was paid for is written: ${written}`);
});
