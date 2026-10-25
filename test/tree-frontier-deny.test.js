// R16 on describeFrontier (G7 item 3; C&C thcmcp-a1's brief Review/Build_0.8.3/m8/cr-fixes/Brief_19_2026-10-25.md; T's G5+6 report "Items to flag" 3, F12 doubt 1). describeFrontier runs the expansion check of the parent
// (PLAN 5.5 items 1-4), whose item 2 is `contract check` (src/run-contract-check.js): on a route that reads a run folder it does not trust (every MCP route) the recorded task path goes through the secret denylist, and a
// denied file is never read ("cannot check: task", not a comparison). Before: describeFrontier took no `deny`, so `tree_status` (src/tree-status.js, the unlisted-frontier read) and `tree_decide` form frontier
// (src/tree-approve-session.js) read and hashed the denied file: an existence / content oracle (whether the frontier is offered says whether the file holds the task's bytes).
// Fixture: two real depth-2 trees (all-mock, $0; test/helpers/depth-two-replan.js to leg 4: R/M1 split, its children frontier waits) whose R/M1 run.json `task` is re-pointed at a denied name (credentials.md). SAME holds the
// bytes the run was given; OTHER holds dummy text. A route that honours the denylist cannot tell them apart. The parent is R/M1, not R: the ROOT task is also read by rootTaskOf with no denylist (C&C's CR-RC-006, a later fix-up),
// which would refuse OTHER for its own reason. Red at 454b7384: OTHER is refused (drift) where SAME is described, on both MCP routes. The CLI control (the person's own folder, no denylist) still reads the file: OTHER drifts there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { gatherStatusFacts } from '../src/tree-status.js';
import { treeStatusResult } from '../src/mcp/tree-status.js';
import { treeDecideResult } from '../src/mcp/tree-decide.js';
import { isDeniedPath } from '../src/tools.js';
import { contractCheckOf } from '../src/run-contract-check.js';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';

const payloadOf = res => JSON.parse(res.content[0].text);

/** A depth-2 tree whose R/M1 run.json `task` names a file the denylist refuses (credentials.md): with the bytes of the task it ran (`same`), or with dummy text. -> { t: { rootDir, runsDir, work }, rootId } */
async function deniedTaskTree({ same }) {
  const S = await driveToDepthTwoReplan({ stopAtChildFrontier: true });
  const runsDir = join(S.work, 'runs');
  const runJson = join(runsDir, S.nodeOf('R/M1', 1).runId, 'run.json');
  const meta = JSON.parse(readFileSync(runJson, 'utf8'));
  const base = typeof meta.cwd === 'string' ? meta.cwd : S.work;
  const task = join(dirname(meta.task), 'credentials.md');
  assert.ok(isDeniedPath(task), `precondition: the denylist refuses ${task}`);
  writeFileSync(resolve(base, task), same ? readFileSync(resolve(base, meta.task)) : 'not the text the run was given\n');
  writeFileSync(runJson, JSON.stringify({ ...meta, task }, null, 2));
  assert.equal(contractCheckOf(dirname(runJson), { work: S.work }).exit, same ? 0 : 1, 'precondition: the CLI reads the recorded task at its new name (inside the working folder)');
  return { t: { rootDir: S.rootDir, runsDir, work: S.work }, rootId: S.rootId };
}
let trees = null;
const bothTrees = () => (trees ??= (async () => [await deniedTaskTree({ same: true }), await deniedTaskTree({ same: false })])());       // one after the other: each drives real runs

test('R16: describeFrontier with the denylist does not read a denied task path (SAME and OTHER are described alike); without it (the CLI) the file is read and OTHER drifts', { timeout: 600_000 }, async () => {
  const [same, other] = await bothTrees();
  for (const [label, r] of [['SAME', same], ['OTHER', other]]) {
    const pending = findPendingFrontier({ rootDir: r.t.rootDir });
    assert.ok(pending?.key && pending.parent?.node === 'R/M1', `${label}: precondition: R/M1's children frontier waits`);
    const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending, deny: isDeniedPath });
    assert.equal(d.refusal, undefined, `${label}: with the denylist: ${JSON.stringify(d.refusal)}`);       // red at 454b7384 for OTHER: item 2 contract_check, `contract check` exits 1 (drift)
    assert.equal(d.frontierKey, pending.key, `${label}: described`);
  }
  const open = describeFrontier({ rootDir: other.t.rootDir, work: other.t.work, pending: findPendingFrontier({ rootDir: other.t.rootDir }) });
  assert.equal(open.refusal?.check, 'contract_check', `the control: the person's own folder reads the file, and OTHER drifts: ${JSON.stringify(open.refusal)}`);
});

test('R16: MCP tree_status lists the frontier for SAME and OTHER alike (the denied file is not read); `council tree status` (no denylist) still reads it', { timeout: 600_000 }, async () => {
  const [same, other] = await bothTrees();
  const listed = r => payloadOf(treeStatusResult({ runsDir: r.t.runsDir, run: r.rootId, work: r.t.work }));
  const ps = listed(same); const po = listed(other);
  assert.equal(ps.error, undefined, JSON.stringify(ps.error)); assert.equal(po.error, undefined, JSON.stringify(po.error));
  assert.deepEqual(ps.awaitingApproval, [findPendingFrontier({ rootDir: same.t.rootDir }).key], 'precondition: SAME is listed');
  assert.deepEqual(po.awaitingApproval, [findPendingFrontier({ rootDir: other.t.rootDir }).key], 'OTHER is listed as SAME is: the payload does not depend on the denied file\'s bytes');       // red at 454b7384: []
  assert.deepEqual(gatherStatusFacts(other.t.rootDir, { work: other.t.work }).awaitingApproval, [], 'the control: the CLI reads the file, and the approve verb would refuse OTHER, so it is not listed');
});

test('R16: MCP tree_decide (form frontier, step quote) answers SAME and OTHER alike: no contract_check refusal from a file it may not read', { timeout: 600_000 }, async () => {
  const [same, other] = await bothTrees();
  const quote = r => payloadOf(treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: r.rootId, form: 'frontier', step: 'quote' } }));
  const qs = quote(same); const qo = quote(other);
  assert.doesNotMatch(String(qo.error ?? ''), /contract_check/, JSON.stringify(qo));       // red at 454b7384: "the frontier cannot be put to anyone yet: PLAN 5.5 item 2 (contract_check) ..."
  assert.deepEqual({ error: qo.error ?? null, quoted: typeof qo.text === 'string' }, { error: qs.error ?? null, quoted: typeof qs.text === 'string' }, `OTHER answers as SAME: ${JSON.stringify(qo)} vs ${JSON.stringify(qs)}`);
});
