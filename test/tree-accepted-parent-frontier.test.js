// An ACCEPTED parent's children frontier (C&C thcmcp-a1, 26 Okt 2026: builder 19's trace of describeFrontier's `accepted`). describeFrontier ran the parent's expansion check with `accepted: planAuthorityOf(pending.parent)`, and
// findPendingFrontier's `parent` is { node, generation, runId }: it never carries the record's accepted body hash. So for a parent whose changed plan the record ACCEPTED (plan_accepted, the typed --accept-plan of G2 (c)), the check
// compared the file with report.json's own hash, found drift, and refused the frontier that registration and readiness (which read the node's own hash, src/tree-derive-load.js) treat as sound: a dead end on a free route.
// Real verbs on all-mock chains ($0): the root plan is edited OUTSIDE its split fence (the split and every reference it names unchanged), the sitting opens the plan_unreadable stop, the person's accept records plan_accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { decideHandler } from '../src/tree-decide.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { eventsOf } from './helpers/sitting.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { terminal } from './helpers/terminal.js';

test('a root plan accepted after an edit outside its split fence: its children frontier is described (the accepted body is the authority), as registration reads it', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() });
  const file = join(r.runDir, 'deliverable.md');
  const before = readFileSync(file, 'utf8');
  assert.ok(before.includes('A plan.'), 'precondition: the prose line outside the fence');
  writeFileSync(file, before.replace('A plan.', 'A plan, changed once.'));
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0 });
  const stop = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === 'R').at(-1);
  assert.ok(stop?.blockedBy.some(b => b.code === 'plan_unreadable'), `precondition: the edit opens the plan stop: ${JSON.stringify(stop)}`);
  const io = terminal([stop.id, 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);       // the person's typed accept (`council tree decide --accept-plan --stop`), as test/tree-bundle-rebuild.test.js drives it
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { 'accept-plan': true, stop: stop.id }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, `precondition: the accept is recorded: ${io.shown()}${io.errors()}`);
  const state = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(typeof state.nodes.get('R@g1')?.acceptedBodySha256, 'string', 'precondition: the record accepts the changed body');
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending?.key && pending.parent.node === 'R', `precondition: R's children frontier waits: ${JSON.stringify(pending && { key: pending.key, parent: pending.parent })}`);
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, `the accepted plan's frontier is described: ${JSON.stringify(d.refusal)}`);       // red at e9cb2dea (expected): item 2 contract_check, `contract check` exits 1 (drift)
  assert.equal(d.frontierKey, pending.key);
});
