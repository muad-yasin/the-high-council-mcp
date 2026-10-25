// CR-RC-001 (fix-up ON TOP of f36c9c51 + 4c54a046): a derivation_refused stop is judged by the stopped plan's ROLE in each re-derivation (src/tree-ready.js rederivationOutcome, the one rule the sitting's close test and the accept
// writer read). While the consumer's frontier has no valid approval (here a parent_changed on it), the consumer is re-derived as a PREVIEW, and a preview never runs providerPieces (src/tree-derive.js), where a provider's owned
// refusal is thrown. So (a) a stop on the PROVIDER is neither closed by the sitting nor answered by an accept on a preview: the check that refused never ran; after the frontier is approved again the full derivation runs and the
// repaired provider is accepted. (b) A stop on the PARENT still resolves on a preview (its references are checked before the preview gate): the accept of a repaired parent plan is taken with `rechecked` (D2 F4c / LB-3 unchanged).
// Real all-mock trees, $0. Hand-made lines are named: the parent_changed in (a) is built by parentChangedEvent (its one builder) and written through the table, because the real route needs a sibling's start against a changed
// parent whose file is then put back; (b)'s two lines are the old-record route of tree-recheck-close.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf, TreeRefusal } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { acceptChangedPlan } from '../src/tree-accept.js';
import { approveHandler } from '../src/tree-approve.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { parentChangedEvent } from '../src/tree-continuation.js';
import { splitSha256 } from '../src/tree-split.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren, splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, plan3 } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const refusalOf = fn => { try { fn(); } catch (e) { if (e instanceof TreeRefusal) return e.reason; throw e; } assert.fail('no refusal'); };
const openIds = r => stateOf(readTreeRecord(r.t.rootDir)).openStops;
const restoredOf = (r, id) => eventsOf(r).filter(e => e.event === 'stop_restored' && e.stopId === id);

// as test/tree-accept-derivation.test.js builds it: R/M1 (the provider) lacks the "Overview" heading its consumer R/M2's agreement names; the stop opens on R/M1 (derivation_refused) and R/M2 is held
async function providerStopped() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: plan3(b) });
  approvePending(r);
  writeFileSync(join(r.t.work, 'no-overview.md'), '# The provider plan\n\n## Store\nThe store keeps every record.\n\nREVISED MOCK DELIVERABLE\n');
  const start = draftStarter(r, { 'R/M1': 'no-overview.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const stop = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === 'R/M1').at(-1);
  assert.ok(stop?.blockedBy.some(x => x.code === 'derivation_refused'), JSON.stringify(stop));
  const m1 = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  return { r, start, stop, file: join(r.t.runsDir, m1.runId, 'deliverable.md'), frontierKey: m1.frontierKey };
}

test('CR-RC-001 (a): a PROVIDER-owned derivation_refused stop under a parent_changed on its consumer\'s frontier stays open (the preview never checked the provider), an accept on the preview is refused with its way on; approved again, the repaired provider is accepted with rechecked', { timeout: 900_000 }, async () => {
  const { r, start, stop, file, frontierKey } = await providerStopped();
  appendTreeEvent(r.t.rootDir, parentChangedEvent({ scope: 'R/M2@g1', frontierKey, detail: 'hand-made: an ancestor of R/M2 no longer passed PLAN 5.5 items 1-3 at a start (the file was put back since)' }));     // hand-made 1
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir })?.key, frontierKey, 'the consumer\'s frontier waits for a new approval');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  assert.equal(restoredOf(r, stop.id).length, 0, 'the sitting did not close the provider\'s stop on a preview');
  assert.ok(openIds(r).includes(stop.id), 'the stop stays open');
  writeFileSync(file, readFileSync(file, 'utf8').replace('## Store\n', '## Overview\nget(id) and put(record).\n\n## Store\n'));     // a REAL repair: the preview cannot confirm even this
  const accept = () => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'session', via: 'mcp', reason: 'adds the Overview section the parent promised; same split, same obligations', runsDir: r.t.runsDir, work: r.t.work });
  const reason = refusalOf(accept);
  assert.match(reason, /R\/M2@g1: derived as a preview only \(its frontier waits for a new approval\), and a preview does not read what its providers settled: approve the frontier again with `council tree approve \S+`, then the check runs in full/, reason);
  assert.equal(eventsOf(r).filter(e => e.event === 'plan_accepted').length, 0, 'nothing is recorded');
  const io = terminal([frontierKey.slice(0, 8), 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, `approved again: ${io.shown()}${io.errors()}`);
  const out = accept();
  assert.deepEqual(out.event.rechecked, ['derivation_refused'], 'the full derivation ran and every held child derives from the repaired plan');
  assert.equal(openIds(r).includes(stop.id), false, 'the stop is answered');
});

test('CR-RC-001 (b), unchanged: a PARENT-owned derivation_refused stop still resolves on a preview: the parent plan repaired to hold the heading its child names is accepted with rechecked (the frontier was never approved: the same preview branch)', { timeout: 600_000 }, async () => {
  const block = block3(); block.children[0].context_refs = ['No such heading'];
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3(block), verify: false });
  appendTreeEvent(r.t.rootDir, { event: 'split_verified', node: 'R', generation: 1, runId: ROOT_ID, splitSha256: splitSha256(block), children: block.children.map(c => `R/${c.milestone}`) });     // hand-made 1 (the old-record route)
  appendTreeEvent(r.t.rootDir, { event: 'blocked', reason: 'expansion_refused', scope: 'R/M1@g1', transition: 'derivation', check: 'missing_context', detail: 'the reference "No such heading" names no source document' });   // hand-made 2
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0 });
  const stop = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === 'R').at(-1);
  assert.ok(stop?.blockedBy.some(b => b.code === 'derivation_refused'), JSON.stringify(stop));
  const file = join(r.runDir, 'deliverable.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('## Overview\nA plan.\n', '## No such heading\nThe section the child names.\n\n## Overview\nA plan.\n'));
  const out = acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: { gateId: 'g-test', shownSha256: 'a'.repeat(64) }, runsDir: r.t.runsDir, work: r.t.work });
  assert.deepEqual(out.event.rechecked, ['derivation_refused']);
  assert.equal(openIds(r).includes(stop.id), false, 'the stop is answered');
});
